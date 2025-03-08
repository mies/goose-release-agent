import { Bindings } from '../types';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema';
import { 
  GitHubService, 
  GitHubReleaseWebhookPayload, 
  GitHubPullRequestWebhookPayload,
  GitHubPushWebhookPayload
} from './github';
import { ChangelogGenerator, createChangelogGenerator, ChangelogOptions } from './changelog-generator';

/**
 * WebhookHandler processes GitHub webhook events and manages the database and API interactions
 */
export class WebhookHandler {
  private db: ReturnType<typeof drizzle>;
  private githubService: GitHubService;
  private changelogGenerator: ChangelogGenerator;

  constructor(env: Bindings) {
    this.db = drizzle(env.DB);
    this.githubService = new GitHubService(
      env.GITHUB_API_TOKEN || '',
      env.GITHUB_WEBHOOK_SECRET || ''
    );
    this.changelogGenerator = createChangelogGenerator(env);
  }

  /**
   * Verify a GitHub webhook signature
   * @param payload Raw payload string
   * @param signature Signature from X-Hub-Signature-256 header
   */
  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    return this.githubService.verifyWebhookSignature(payload, signature);
  }

  /**
   * Process a GitHub release event
   * @param payload Release webhook payload
   */
  async processReleaseEvent(payload: GitHubReleaseWebhookPayload): Promise<{ status: string; releaseId?: number }> {
    const { action, release, repository } = payload;

    // We're only interested in published releases
    if (action !== 'published' && action !== 'created') {
      return { status: 'ignored', releaseId: undefined };
    }

    // Check if the release already exists in our database
    const existingReleases = await this.db.select()
      .from(schema.releases)
      .where(and(
        eq(schema.releases.repository, repository.full_name),
        eq(schema.releases.version, release.tag_name)
      ))
      .limit(1);

    let releaseId: number;

    if (existingReleases.length > 0) {
      // Update existing release
      const existingRelease = existingReleases[0];
      releaseId = existingRelease.id;

      await this.db.update(schema.releases)
        .set({
          name: release.name,
          description: release.body,
          publishedStatus: 'published',
          updatedAt: new Date().toISOString()
        })
        .where(eq(schema.releases.id, releaseId));

      return { status: 'updated', releaseId };
    } else {
      // Create new release
      const [newRelease] = await this.db.insert(schema.releases)
        .values({
          version: release.tag_name,
          name: release.name,
          repository: repository.full_name,
          description: release.body,
          releaseDate: new Date(release.published_at).toISOString(),
          publishedStatus: 'published'
        })
        .returning();

      releaseId = newRelease.id;

      // Fetch and process pull requests and commits
      await this.fetchAndStorePRsForRelease(repository.full_name, releaseId);

      return { status: 'created', releaseId };
    }
  }

  /**
   * Process a GitHub pull request event
   * @param payload PR webhook payload
   */
  async processPullRequestEvent(payload: GitHubPullRequestWebhookPayload): Promise<{ status: string; prId?: number }> {
    const { action, pull_request, repository } = payload;

    // We're only interested in merged PRs
    if (action !== 'closed' || !pull_request.merged_at) {
      return { status: 'ignored', prId: undefined };
    }

    // Find the latest release for this repository
    const releases = await this.db.select()
      .from(schema.releases)
      .where(eq(schema.releases.repository, repository.full_name))
      .limit(1);

    if (releases.length === 0) {
      // No releases for this repo yet, create a draft release
      const [newRelease] = await this.db.insert(schema.releases)
        .values({
          version: 'unreleased',
          repository: repository.full_name,
          releaseDate: new Date().toISOString(),
          publishedStatus: 'draft'
        })
        .returning();

      // Store the PR with the draft release
      const prId = await this.storePullRequest(newRelease.id, pull_request);
      return { status: 'draft-release-created', prId };
    }

    // Store PR with the latest release
    const prId = await this.storePullRequest(releases[0].id, pull_request);
    return { status: 'added', prId };
  }

  /**
   * Process a GitHub push event
   * @param payload Push webhook payload
   */
  async processPushEvent(payload: GitHubPushWebhookPayload): Promise<{ status: string; count: number }> {
    const { repository, commits, ref } = payload;

    // Only process pushes to the default branch
    if (!ref.includes(`refs/heads/${repository.default_branch}`)) {
      return { status: 'ignored', count: 0 };
    }

    // Find the latest release for this repository
    const releases = await this.db.select()
      .from(schema.releases)
      .where(eq(schema.releases.repository, repository.full_name))
      .limit(1);

    if (releases.length === 0) {
      return { status: 'no-release', count: 0 };
    }

    const releaseId = releases[0].id;
    let addedCount = 0;

    // Process each commit
    for (const commit of commits) {
      // Skip if necessary info is missing
      if (!commit.id || !commit.message || !commit.author) continue;

      // Check if commit already exists
      const existingCommits = await this.db.select()
        .from(schema.commits)
        .where(eq(schema.commits.hash, commit.id))
        .limit(1);

      if (existingCommits.length > 0) continue;

      // Find associated PR from commit message
      let pullRequestId = null;
      const prMatches = commit.message.match(/#(\d+)/);
      if (prMatches && prMatches[1]) {
        const prNumber = parseInt(prMatches[1]);
        const prs = await this.db.select()
          .from(schema.pullRequests)
          .where(and(
            eq(schema.pullRequests.prNumber, prNumber),
            eq(schema.pullRequests.releaseId, releaseId)
          ))
          .limit(1);

        if (prs.length > 0) {
          pullRequestId = prs[0].id;
        }
      }

      // Store the commit
      await this.db.insert(schema.commits)
        .values({
          hash: commit.id,
          releaseId,
          pullRequestId,
          message: commit.message,
          author: commit.author.name,
          authorEmail: commit.author.email,
          date: commit.timestamp
        });

      addedCount++;
    }

    return { status: 'processed', count: addedCount };
  }

  /**
   * Generate release notes for a release
   */
  async generateReleaseNotes(
    releaseId: number, 
    format: 'json' | 'markdown' | 'html' = 'markdown',
    includeCommits = true,
    style: 'technical' | 'user-friendly' | 'detailed' | 'concise' = 'technical',
    customPrompt?: string
  ): Promise<{ success: boolean; message?: string; notes?: any }> {
    try {
      console.log(`Generating release notes for release ID ${releaseId}`);
      
      // Fetch the release from the database
      const releases = await this.db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, releaseId))
        .limit(1);
      
      if (releases.length === 0) {
        return { success: false, message: `Release with ID ${releaseId} not found` };
      }
      
      const release = releases[0];
      
      // Convert DB release object to the expected Release type
      // This handles conversion from null to undefined for optional fields
      const releaseData = {
        id: release.id,
        version: release.version,
        name: release.name ?? undefined,
        repository: release.repository,
        releaseDate: release.releaseDate,
        description: release.description ?? undefined,
        generatedNotes: release.generatedNotes ?? undefined,
        publishedStatus: release.publishedStatus as 'draft' | 'published' | undefined
      };
      
      // Fetch all PRs associated with this release
      const pullRequestsData = await this.db.select()
        .from(schema.pullRequests)
        .where(eq(schema.pullRequests.releaseId, releaseId));
      
      // Convert DB pull requests to the expected PullRequest type
      const pullRequests = pullRequestsData.map(pr => ({
        id: pr.id,
        prNumber: pr.prNumber,
        releaseId: pr.releaseId ?? undefined,
        title: pr.title,
        author: pr.author,
        description: pr.description ?? undefined,
        url: pr.url,
        mergedAt: pr.mergedAt,
        labels: pr.labels ? JSON.parse(pr.labels) : undefined,
        categoryId: pr.categoryId ?? undefined
      }));
      
      // Fetch all commits associated with this release
      const commitsData = includeCommits ? 
        await this.db.select()
          .from(schema.commits)
          .where(eq(schema.commits.releaseId, releaseId)) : 
        [];
      
      // Convert DB commits to the expected Commit type
      const commits = commitsData.map(commit => ({
        id: commit.id,
        hash: commit.hash,
        releaseId: commit.releaseId ?? undefined,
        pullRequestId: commit.pullRequestId ?? undefined,
        message: commit.message,
        author: commit.author,
        authorEmail: commit.authorEmail ?? undefined,
        date: commit.date
      }));
      
      // Fetch all categories
      const categoriesData = await this.db.select().from(schema.categories);
      
      // Convert DB categories to the expected Category type
      const categories = categoriesData.map(category => ({
        id: category.id,
        name: category.name,
        description: category.description ?? undefined,
        displayOrder: category.displayOrder ?? undefined
      }));
      
      // Generate the changelog using Claude
      const options: ChangelogOptions = {
        format,
        style,
        includeCommits,
        customPrompt
      };
      
      console.log(`Generating changelog for ${release.version} with ${pullRequests.length} PRs and ${commits.length} commits`);
      
      const releaseNotes = await this.changelogGenerator.generateReleaseNotes(
        releaseData,
        pullRequests,
        commits,
        categories,
        options
      );
      
      // Update the release with the generated notes
      await this.db.update(schema.releases)
        .set({
          generatedNotes: JSON.stringify(releaseNotes),
          updatedAt: new Date().toISOString()
        })
        .where(eq(schema.releases.id, releaseId));
      
      // If we want to send this to the ReleaseAgent as well, we can do that here
      /*
      const generateRequest = new Request('http://internal/generate-notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-partykit-namespace': 'ReleaseAgent',
          'x-partykit-room': 'default'
        },
        body: JSON.stringify({
          releaseId,
          format,
          includeCommits
        })
      });
      */
      
      return { 
        success: true, 
        notes: releaseNotes 
      };
    } catch (error) {
      console.error('Error generating release notes:', error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Fetch and store pull requests for a release
   */
  private async fetchAndStorePRsForRelease(
    repositoryFullName: string,
    releaseId: number
  ): Promise<number> {
    const [owner, repo] = repositoryFullName.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repository name: ${repositoryFullName}`);
    }

    // Fetch merged PRs from GitHub
    const pullRequests = await this.githubService.fetchMergedPullRequests(owner, repo);
    
    let addedCount = 0;
    
    // Store each PR
    for (const pr of pullRequests) {
      await this.storePullRequest(releaseId, pr);
      addedCount++;
      
      // Also fetch and store commits for this PR
      await this.fetchAndStoreCommitsForPR(owner, repo, releaseId, pr);
    }
    
    return addedCount;
  }

  /**
   * Store a pull request in the database
   */
  private async storePullRequest(
    releaseId: number,
    pr: { 
      number: number;
      title: string;
      body?: string;
      html_url: string;
      merged_at: string | null;
      user: { login: string };
      labels?: Array<{ name: string }>;
    }
  ): Promise<number> {
    // Skip if already exists
    const existingPrs = await this.db.select()
      .from(schema.pullRequests)
      .where(and(
        eq(schema.pullRequests.prNumber, pr.number),
        eq(schema.pullRequests.releaseId, releaseId)
      ))
      .limit(1);
      
    if (existingPrs.length > 0) {
      return existingPrs[0].id;
    }
    
    // Extract labels
    const labels = pr.labels?.map(label => label.name) || [];
    
    // Determine category
    let categoryId = null;
    
    // Get all categories
    const categories = await this.db.select().from(schema.categories);
    
    // Convert labels to lowercase for case-insensitive matching
    const labelLowerCase = labels.map(l => l.toLowerCase());
    
    // Map labels to categories
    if (labelLowerCase.some(l => l.includes('feat') || l.includes('feature'))) {
      const category = categories.find(c => c.name === 'Features');
      if (category) categoryId = category.id;
    } else if (labelLowerCase.some(l => l.includes('fix') || l.includes('bug'))) {
      const category = categories.find(c => c.name === 'Bug Fixes');
      if (category) categoryId = category.id;
    } else if (labelLowerCase.some(l => l.includes('improve') || l.includes('enhancement'))) {
      const category = categories.find(c => c.name === 'Improvements');
      if (category) categoryId = category.id;
    } else if (labelLowerCase.some(l => l.includes('doc'))) {
      const category = categories.find(c => c.name === 'Documentation');
      if (category) categoryId = category.id;
    } else if (labelLowerCase.some(l => l.includes('dep'))) {
      const category = categories.find(c => c.name === 'Dependencies');
      if (category) categoryId = category.id;
    } else if (labelLowerCase.some(l => l.includes('break'))) {
      const category = categories.find(c => c.name === 'Breaking Changes');
      if (category) categoryId = category.id;
    }
    
    // Insert PR into database
    const [newPr] = await this.db.insert(schema.pullRequests)
      .values({
        prNumber: pr.number,
        releaseId,
        title: pr.title,
        description: pr.body,
        url: pr.html_url,
        author: pr.user.login,
        mergedAt: pr.merged_at || new Date().toISOString(),
        labels: JSON.stringify(labels),
        categoryId
      })
      .returning();
      
    return newPr.id;
  }

  /**
   * Fetch and store commits for a pull request
   */
  private async fetchAndStoreCommitsForPR(
    owner: string,
    repo: string,
    releaseId: number,
    pr: { number: number; head: { sha: string } }
  ): Promise<number> {
    // Fetch commits from GitHub
    const commits = await this.githubService.fetchCommitsForPullRequest(owner, repo, pr.number);
    
    // Get the PR ID from the database
    const prs = await this.db.select()
      .from(schema.pullRequests)
      .where(and(
        eq(schema.pullRequests.prNumber, pr.number),
        eq(schema.pullRequests.releaseId, releaseId)
      ))
      .limit(1);
      
    if (prs.length === 0) return 0;
    
    const pullRequestId = prs[0].id;
    let addedCount = 0;
    
    // Store each commit
    for (const commit of commits) {
      // Skip if already exists
      const existingCommits = await this.db.select()
        .from(schema.commits)
        .where(eq(schema.commits.hash, commit.sha))
        .limit(1);
        
      if (existingCommits.length > 0) continue;
      
      // Store the commit
      await this.db.insert(schema.commits)
        .values({
          hash: commit.sha,
          releaseId,
          pullRequestId,
          message: commit.commit.message,
          author: commit.commit.author.name,
          authorEmail: commit.commit.author.email,
          date: commit.commit.author.date
        });
        
      addedCount++;
    }
    
    return addedCount;
  }
}

/**
 * Create a webhook handler instance
 */
export function createWebhookHandler(env: Bindings): WebhookHandler {
  return new WebhookHandler(env);
} 