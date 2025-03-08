import { Bindings } from '../types';

/**
 * GitHub API repository information
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  default_branch: string;
}

/**
 * GitHub API release information
 */
export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  created_at: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
}

/**
 * GitHub API pull request information
 */
export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string;
  user: {
    login: string;
  };
  html_url: string;
  merged_at: string | null;
  labels: Array<{
    name: string;
  }>;
  head: {
    sha: string;
  };
  base: {
    sha: string;
  };
}

/**
 * GitHub API commit information
 */
export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  html_url: string;
  author: {
    login: string;
  } | null;
}

/**
 * GitHub webhook payload for release events
 */
export interface GitHubReleaseWebhookPayload {
  action: string; // 'published', 'created', 'edited', 'deleted', 'prereleased', etc.
  release: GitHubRelease;
  repository: GitHubRepository;
}

/**
 * GitHub webhook payload for pull request events
 */
export interface GitHubPullRequestWebhookPayload {
  action: string; // 'opened', 'closed', 'reopened', 'edited', etc.
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
}

/**
 * GitHub webhook payload for push events
 */
export interface GitHubPushWebhookPayload {
  ref: string; // Branch or tag ref that was pushed
  repository: GitHubRepository;
  commits: Array<{
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
    timestamp: string;
    url: string;
  }>;
  head_commit: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
    timestamp: string;
    url: string;
  } | null;
}

/**
 * GitHub Service for interacting with GitHub API and processing webhooks
 */
export class GitHubService {
  private apiToken: string;
  private webhookSecret: string;

  constructor(apiToken: string, webhookSecret: string) {
    this.apiToken = apiToken;
    this.webhookSecret = webhookSecret;
  }

  /**
   * Verify the signature of a GitHub webhook
   * @param payload The webhook payload
   * @param signature The signature from X-Hub-Signature-256 header
   * @returns Whether the signature is valid
   */
  async verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
    if (!signature || !this.webhookSecret) return false;
    if (!signature.startsWith('sha256=')) return false;

    // Create the expected signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const payloadBuffer = encoder.encode(payload);
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadBuffer);
    
    // Convert the signature to a hex string
    const signatureHex = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Compare the signatures
    const expectedSignature = `sha256=${signatureHex}`;
    return expectedSignature === signature;
  }

  /**
   * Create authenticated request headers for GitHub API
   */
  private getAuthHeaders(): HeadersInit {
    return {
      'Authorization': `token ${this.apiToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Goose-Release-Agent'
    };
  }

  /**
   * Fetch a repository from GitHub API
   * @param owner Repository owner
   * @param repo Repository name
   */
  async fetchRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as GitHubRepository;
  }

  /**
   * Fetch a release from GitHub API
   * @param owner Repository owner
   * @param repo Repository name
   * @param tag Release tag
   */
  async fetchRelease(owner: string, repo: string, tag: string): Promise<GitHubRelease> {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
      headers: this.getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as GitHubRelease;
  }

  /**
   * Fetch pull requests associated with a release
   * @param owner Repository owner
   * @param repo Repository name
   * @param fromTag Previous release tag 
   * @param toTag Current release tag
   */
  async fetchPullRequestsForRelease(
    owner: string, 
    repo: string, 
    fromTag?: string, 
    toTag?: string
  ): Promise<GitHubPullRequest[]> {
    // If both tags are provided, we can fetch PRs between the two tags
    if (fromTag && toTag) {
      // First get the commit SHAs for the tags
      const [fromTagData, toTagData] = await Promise.all([
        this.fetchTagCommit(owner, repo, fromTag),
        this.fetchTagCommit(owner, repo, toTag)
      ]);

      // Find PRs that were merged between the fromTag and toTag
      const mergedPRs = await this.fetchMergedPullRequests(owner, repo);
      return mergedPRs.filter(pr => {
        if (!pr.merged_at) return false;
        
        // Check if this PR was merged after the fromTag and before or at the toTag
        const mergedAt = new Date(pr.merged_at).getTime();
        const fromDate = new Date(fromTagData.commit.author.date).getTime();
        const toDate = new Date(toTagData.commit.author.date).getTime();
        
        return mergedAt > fromDate && mergedAt <= toDate;
      });
    }
    
    // If no tags provided, just fetch recent merged PRs
    return await this.fetchMergedPullRequests(owner, repo);
  }

  /**
   * Fetch the commit for a tag
   * @param owner Repository owner
   * @param repo Repository name
   * @param tag Tag name
   */
  private async fetchTagCommit(owner: string, repo: string, tag: string): Promise<GitHubCommit> {
    // First get the tag reference
    const tagResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/tags/${tag}`, {
      headers: this.getAuthHeaders()
    });

    if (!tagResponse.ok) {
      throw new Error(`GitHub API error fetching tag: ${tagResponse.status} ${tagResponse.statusText}`);
    }

    const tagData = await tagResponse.json() as { object: { sha: string } };
    const tagSha = tagData.object.sha;

    // Now get the commit
    const commitResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/tags/${tagSha}`, {
      headers: this.getAuthHeaders()
    });

    if (!commitResponse.ok) {
      throw new Error(`GitHub API error fetching commit: ${commitResponse.status} ${commitResponse.statusText}`);
    }

    const commitData = await commitResponse.json() as GitHubCommit;
    return commitData;
  }

  /**
   * Fetch merged pull requests for a repository
   * @param owner Repository owner
   * @param repo Repository name
   * @param state Pull request state (default: 'closed')
   * @param limit Maximum number of PRs to fetch (default: 100)
   */
  async fetchMergedPullRequests(
    owner: string, 
    repo: string, 
    state: 'open' | 'closed' | 'all' = 'closed', 
    limit: number = 100
  ): Promise<GitHubPullRequest[]> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=${limit}`, 
      { headers: this.getAuthHeaders() }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const prs = await response.json() as GitHubPullRequest[];
    return prs.filter((pr: GitHubPullRequest) => pr.merged_at !== null);
  }

  /**
   * Fetch commits for a specific pull request
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber Pull request number
   */
  async fetchCommitsForPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubCommit[]> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/commits`,
      { headers: this.getAuthHeaders() }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as GitHubCommit[];
  }

  /**
   * Fetch all commits between two SHAs
   * @param owner Repository owner
   * @param repo Repository name
   * @param baseSha Base SHA
   * @param headSha Head SHA
   */
  async fetchCommitsBetween(owner: string, repo: string, baseSha: string, headSha: string): Promise<GitHubCommit[]> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`,
      { headers: this.getAuthHeaders() }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const compareData = await response.json() as { commits: GitHubCommit[] };
    return compareData.commits;
  }

  /**
   * Update a GitHub release with generated release notes
   * @param owner Repository owner
   * @param repo Repository name
   * @param releaseId GitHub release ID
   * @param body Updated release notes body
   */
  async updateReleaseNotes(owner: string, repo: string, releaseId: number, body: string): Promise<GitHubRelease> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}`,
      {
        method: 'PATCH',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ body })
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as GitHubRelease;
  }
}

/**
 * Create a GitHubService instance from environment variables
 * @param env Environment with GitHub API token and webhook secret
 */
export function createGitHubService(env: Bindings): GitHubService {
  const apiToken = env.GITHUB_API_TOKEN || '';
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET || '';
  return new GitHubService(apiToken, webhookSecret);
} 