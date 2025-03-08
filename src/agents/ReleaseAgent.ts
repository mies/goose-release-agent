import { Agent, type Connection, type ConnectionContext } from "agents-sdk";
import { 
  type Bindings, 
  type Release, 
  type PullRequest, 
  type Commit, 
  type Category,
  type ReleaseNotes,
  type CreateReleaseRequest,
  type GenerateNotesRequest,
  type GenerateNotesResponse
} from "../types";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "../db/schema";

/**
 * ReleaseAgent handles generating release notes, changelogs, and documentation.
 * It processes merged PRs and commit messages to create structured release notes.
 */
export class ReleaseAgent extends Agent<Bindings> {
  // Store for active WebSocket connections
  private connections = new Map<string, Connection>();
  // Flag to indicate if default categories have been initialized
  private categoriesInitialized = false;

  /**
   * Initialize default categories if they don't exist
   */
  private async initializeDefaultCategories() {
    if (this.categoriesInitialized) return;

    const db = drizzle(this.env.DB);
    
    // Check if categories exist
    const existingCategories = await db.select().from(schema.categories);
    
    if (existingCategories.length === 0) {
      // Define default categories
      const defaultCategories = [
        { name: "Features", description: "New features and functionality", displayOrder: 1 },
        { name: "Bug Fixes", description: "Fixes for bugs and issues", displayOrder: 2 },
        { name: "Improvements", description: "Enhancements to existing functionality", displayOrder: 3 },
        { name: "Documentation", description: "Documentation updates", displayOrder: 4 },
        { name: "Dependencies", description: "Dependency updates", displayOrder: 5 },
        { name: "Breaking Changes", description: "Changes that break backwards compatibility", displayOrder: 0 },
      ];
      
      // Insert default categories
      for (const category of defaultCategories) {
        await db.insert(schema.categories).values(category);
      }
    }
    
    this.categoriesInitialized = true;
  }

  /**
   * Handles HTTP requests to the agent
   */
  async onRequest(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname.split('/').filter(Boolean);
    
    // Initialize default categories
    await this.initializeDefaultCategories();
    
    // Routing based on path and method
    if (request.method === 'GET') {
      if (path.includes('releases')) {
        return this.handleGetReleases(request);
      } else if (path.includes('release') && path.length > 1) {
        return this.handleGetRelease(request, path[1]);
      } else if (path.includes('categories')) {
        return this.handleGetCategories(request);
      } else if (path.includes('generate-notes') && path.length > 1) {
        return this.handleGenerateNotes(request, parseInt(path[1]));
      }
    } else if (request.method === 'POST') {
      if (path.includes('releases')) {
        return this.handleCreateRelease(request);
      } else if (path.includes('prs')) {
        return this.handleAddPullRequests(request);
      } else if (path.includes('commits')) {
        return this.handleAddCommits(request);
      } else if (path.includes('generate-notes')) {
        return this.handleGenerateNotes(request);
      }
    }
    
    // Default response with usage info
    return new Response(JSON.stringify({
      message: "ReleaseAgent is ready. Use the API to manage releases and generate notes.",
      endpoints: {
        get: [
          "/releases",
          "/release/:id",
          "/categories",
          "/generate-notes/:releaseId"
        ],
        post: [
          "/releases",
          "/prs",
          "/commits",
          "/generate-notes"
        ]
      }
    }), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }

  /**
   * Handle GET request for all releases
   */
  private async handleGetReleases(request: Request) {
    const db = drizzle(this.env.DB);
    const releases = await db.select().from(schema.releases).orderBy(desc(schema.releases.releaseDate));
    
    return new Response(JSON.stringify(releases), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle GET request for a specific release
   */
  private async handleGetRelease(request: Request, releaseId: string) {
    const db = drizzle(this.env.DB);
    
    // Try to find by ID first
    let release;
    if (!isNaN(parseInt(releaseId))) {
      release = await db.select().from(schema.releases).where(eq(schema.releases.id, parseInt(releaseId))).limit(1);
    }
    
    // If not found, try to find by version
    if (!release || release.length === 0) {
      release = await db.select().from(schema.releases).where(eq(schema.releases.version, releaseId)).limit(1);
    }
    
    if (!release || release.length === 0) {
      return new Response(JSON.stringify({ error: "Release not found" }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Get associated pull requests
    const pullRequests = await db.select()
      .from(schema.pullRequests)
      .where(eq(schema.pullRequests.releaseId, release[0].id));
    
    // Get associated commits
    const commits = await db.select()
      .from(schema.commits)
      .where(eq(schema.commits.releaseId, release[0].id));
    
    return new Response(JSON.stringify({
      ...release[0],
      pullRequests,
      commits
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle GET request for categories
   */
  private async handleGetCategories(request: Request) {
    const db = drizzle(this.env.DB);
    const categories = await db.select()
      .from(schema.categories)
      .orderBy(schema.categories.displayOrder);
    
    return new Response(JSON.stringify(categories), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle POST request to create a new release
   */
  private async handleCreateRelease(request: Request) {
    try {
      const data: CreateReleaseRequest = await request.json();
      
      if (!data.version) {
        return new Response(JSON.stringify({ error: "Version is required" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const db = drizzle(this.env.DB);
      
      // Check if release already exists
      const existingRelease = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.version, data.version))
        .limit(1);
      
      if (existingRelease && existingRelease.length > 0) {
        return new Response(JSON.stringify({ 
          error: "Release with this version already exists",
          releaseId: existingRelease[0].id
        }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Create new release
      const release: schema.NewRelease = {
        version: data.version,
        name: data.name,
        repository: data.repository,
        description: data.description,
        releaseDate: new Date().toISOString(),
        publishedStatus: 'draft'
      };
      
      const [newRelease] = await db.insert(schema.releases)
        .values(release)
        .returning();
      
      return new Response(JSON.stringify(newRelease), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error creating release:', error);
      return new Response(JSON.stringify({ error: "Failed to create release" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Handle POST request to add pull requests to a release
   */
  private async handleAddPullRequests(request: Request) {
    try {
      const data = await request.json();
      
      if (!data.releaseId || !data.pullRequests || !Array.isArray(data.pullRequests)) {
        return new Response(JSON.stringify({ error: "Invalid request format" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const db = drizzle(this.env.DB);
      
      // Check if release exists
      const release = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, data.releaseId))
        .limit(1);
      
      if (!release || release.length === 0) {
        return new Response(JSON.stringify({ error: "Release not found" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Add pull requests
      const results = [];
      for (const pr of data.pullRequests) {
        // Skip if missing required fields
        if (!pr.prNumber || !pr.title || !pr.author || !pr.url || !pr.mergedAt) {
          results.push({ status: 'skipped', pr });
          continue;
        }
        
        // Check if PR already exists
        const existingPr = await db.select()
          .from(schema.pullRequests)
          .where(and(
            eq(schema.pullRequests.prNumber, pr.prNumber),
            eq(schema.pullRequests.releaseId, data.releaseId)
          ))
          .limit(1);
        
        if (existingPr && existingPr.length > 0) {
          results.push({ status: 'exists', id: existingPr[0].id, pr });
          continue;
        }
        
        // Handle PR labels
        let labelsJson = null;
        if (pr.labels && Array.isArray(pr.labels)) {
          labelsJson = JSON.stringify(pr.labels);
        }
        
        // Determine category based on labels (simple algorithm)
        let categoryId = null;
        if (pr.labels && Array.isArray(pr.labels)) {
          const categories = await db.select().from(schema.categories);
          const labelLowerCase = pr.labels.map(l => l.toLowerCase());
          
          // Map labels to categories - this is a simple approach
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
        }
        
        // Insert the pull request
        const [newPr] = await db.insert(schema.pullRequests)
          .values({
            prNumber: pr.prNumber,
            releaseId: data.releaseId,
            title: pr.title,
            author: pr.author,
            description: pr.description,
            url: pr.url,
            mergedAt: pr.mergedAt,
            labels: labelsJson,
            categoryId: categoryId
          })
          .returning();
        
        results.push({ status: 'added', id: newPr.id, pr });
      }
      
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error adding pull requests:', error);
      return new Response(JSON.stringify({ error: "Failed to add pull requests" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Handle POST request to add commits to a release
   */
  private async handleAddCommits(request: Request) {
    try {
      const data = await request.json();
      
      if (!data.releaseId || !data.commits || !Array.isArray(data.commits)) {
        return new Response(JSON.stringify({ error: "Invalid request format" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const db = drizzle(this.env.DB);
      
      // Check if release exists
      const release = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, data.releaseId))
        .limit(1);
      
      if (!release || release.length === 0) {
        return new Response(JSON.stringify({ error: "Release not found" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Add commits
      const results = [];
      for (const commit of data.commits) {
        // Skip if missing required fields
        if (!commit.hash || !commit.message || !commit.author || !commit.date) {
          results.push({ status: 'skipped', commit });
          continue;
        }
        
        // Check if commit already exists
        const existingCommit = await db.select()
          .from(schema.commits)
          .where(eq(schema.commits.hash, commit.hash))
          .limit(1);
        
        if (existingCommit && existingCommit.length > 0) {
          results.push({ status: 'exists', id: existingCommit[0].id, commit });
          continue;
        }
        
        // Find associated PR if a PR number is mentioned in the commit message
        let pullRequestId = null;
        const prMatches = commit.message.match(/#(\d+)/);
        if (prMatches && prMatches[1]) {
          const prNumber = parseInt(prMatches[1]);
          const pr = await db.select()
            .from(schema.pullRequests)
            .where(and(
              eq(schema.pullRequests.prNumber, prNumber),
              eq(schema.pullRequests.releaseId, data.releaseId)
            ))
            .limit(1);
          
          if (pr && pr.length > 0) {
            pullRequestId = pr[0].id;
          }
        }
        
        // Insert the commit
        const [newCommit] = await db.insert(schema.commits)
          .values({
            hash: commit.hash,
            releaseId: data.releaseId,
            pullRequestId: pullRequestId,
            message: commit.message,
            author: commit.author,
            authorEmail: commit.authorEmail,
            date: commit.date
          })
          .returning();
        
        results.push({ status: 'added', id: newCommit.id, commit });
      }
      
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error adding commits:', error);
      return new Response(JSON.stringify({ error: "Failed to add commits" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Handle request to generate release notes
   */
  private async handleGenerateNotes(request: Request, releaseId?: number) {
    try {
      let requestData: GenerateNotesRequest;
      
      if (request.method === 'POST') {
        requestData = await request.json();
      } else {
        requestData = {
          releaseId: releaseId!,
          format: 'json',
          includeCommits: false
        };
      }
      
      if (!requestData.releaseId) {
        return new Response(JSON.stringify({ error: "Release ID is required" }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const format = requestData.format || 'json';
      
      const db = drizzle(this.env.DB);
      
      // Get release information
      const release = await db.select()
        .from(schema.releases)
        .where(eq(schema.releases.id, requestData.releaseId))
        .limit(1);
      
      if (!release || release.length === 0) {
        return new Response(JSON.stringify({ error: "Release not found" }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Get all categories
      const categories = await db.select()
        .from(schema.categories)
        .orderBy(schema.categories.displayOrder);
      
      // Get pull requests for this release
      const pullRequests = await db.select()
        .from(schema.pullRequests)
        .where(eq(schema.pullRequests.releaseId, requestData.releaseId));
      
      // Get commits if requested
      let commits: any[] = [];
      if (requestData.includeCommits) {
        commits = await db.select()
          .from(schema.commits)
          .where(eq(schema.commits.releaseId, requestData.releaseId));
      }
      
      // Group PRs by category
      const categorizedPRs: { [key: string]: any[] } = {};
      const uncategorizedPRs: any[] = [];
      
      // Initialize categories
      for (const category of categories) {
        categorizedPRs[category.name] = [];
      }
      
      // Assign PRs to categories
      for (const pr of pullRequests) {
        if (pr.categoryId) {
          const category = categories.find(c => c.id === pr.categoryId);
          if (category) {
            categorizedPRs[category.name].push(pr);
          } else {
            uncategorizedPRs.push(pr);
          }
        } else {
          uncategorizedPRs.push(pr);
        }
      }
      
      // If there are uncategorized PRs, add them to a special category
      if (uncategorizedPRs.length > 0) {
        categorizedPRs['Other Changes'] = uncategorizedPRs;
      }
      
      // Build release notes structure
      const releaseNotes: ReleaseNotes = {
        version: release[0].version,
        name: release[0].name || undefined,
        releaseDate: release[0].releaseDate,
        description: release[0].description || undefined,
        categories: {}
      };
      
      // Add categories with their PRs
      for (const [categoryName, prs] of Object.entries(categorizedPRs)) {
        if (prs.length === 0) continue;
        
        releaseNotes.categories[categoryName] = {
          title: categoryName,
          items: prs.map(pr => ({
            title: pr.title,
            prNumber: pr.prNumber,
            url: pr.url,
            author: pr.author
          }))
        };
      }
      
      // Add commits if requested
      if (requestData.includeCommits) {
        releaseNotes.commits = commits.map(commit => ({
          hash: commit.hash,
          message: commit.message,
          author: commit.author,
          date: commit.date
        }));
      }
      
      // Generate formatted notes
      let raw = '';
      if (format === 'markdown') {
        raw = this.generateMarkdownNotes(releaseNotes);
      } else if (format === 'html') {
        raw = this.generateHtmlNotes(releaseNotes);
      } else {
        raw = JSON.stringify(releaseNotes, null, 2);
      }
      
      // Save generated notes to the release
      await db.update(schema.releases)
        .set({ 
          generatedNotes: raw,
          updatedAt: new Date().toISOString()
        })
        .where(eq(schema.releases.id, requestData.releaseId));
      
      // Prepare response
      const response: GenerateNotesResponse = {
        releaseNotes,
        format: format as any,
        raw
      };
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error generating release notes:', error);
      return new Response(JSON.stringify({ error: "Failed to generate release notes" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Generate markdown format of release notes
   */
  private generateMarkdownNotes(notes: ReleaseNotes): string {
    let markdown = `# ${notes.version}`;
    
    if (notes.name) {
      markdown += ` - ${notes.name}`;
    }
    
    markdown += `\n\n**Released:** ${new Date(notes.releaseDate).toLocaleDateString()}\n\n`;
    
    if (notes.description) {
      markdown += `${notes.description}\n\n`;
    }
    
    // Add each category and its items
    for (const [categoryName, category] of Object.entries(notes.categories)) {
      markdown += `## ${category.title}\n\n`;
      
      for (const item of category.items) {
        markdown += `- ${item.title}`;
        
        if (item.prNumber) {
          markdown += ` ([#${item.prNumber}](${item.url}))`;
        }
        
        if (item.author) {
          markdown += ` - @${item.author}`;
        }
        
        markdown += '\n';
      }
      
      markdown += '\n';
    }
    
    // Add commits if present
    if (notes.commits && notes.commits.length > 0) {
      markdown += `## Commits\n\n`;
      
      for (const commit of notes.commits) {
        markdown += `- ${commit.hash.substring(0, 7)}: ${commit.message} - ${commit.author}\n`;
      }
    }
    
    return markdown;
  }

  /**
   * Generate HTML format of release notes
   */
  private generateHtmlNotes(notes: ReleaseNotes): string {
    let html = `<h1>${notes.version}`;
    
    if (notes.name) {
      html += ` - ${notes.name}`;
    }
    
    html += `</h1>`;
    
    html += `<p><strong>Released:</strong> ${new Date(notes.releaseDate).toLocaleDateString()}</p>`;
    
    if (notes.description) {
      html += `<p>${notes.description}</p>`;
    }
    
    // Add each category and its items
    for (const [categoryName, category] of Object.entries(notes.categories)) {
      html += `<h2>${category.title}</h2>`;
      html += `<ul>`;
      
      for (const item of category.items) {
        html += `<li>${item.title}`;
        
        if (item.prNumber) {
          html += ` (<a href="${item.url}">#${item.prNumber}</a>)`;
        }
        
        if (item.author) {
          html += ` - <em>@${item.author}</em>`;
        }
        
        html += '</li>';
      }
      
      html += `</ul>`;
    }
    
    // Add commits if present
    if (notes.commits && notes.commits.length > 0) {
      html += `<h2>Commits</h2>`;
      html += `<ul>`;
      
      for (const commit of notes.commits) {
        html += `<li><code>${commit.hash.substring(0, 7)}</code>: ${commit.message} - <em>${commit.author}</em></li>`;
      }
      
      html += `</ul>`;
    }
    
    return html;
  }

  /**
   * Handles WebSocket connection events
   */
  async onConnect(connection: Connection, ctx: ConnectionContext) {
    console.log('ReleaseAgent: New WebSocket connection');
    
    // Generate a unique ID for this connection
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, connection);
    
    // Send welcome message
    connection.send(JSON.stringify({
      type: 'welcome',
      content: 'Connected to ReleaseAgent. Send commands to manage releases and generate notes.'
    }));

    // Handle disconnection
    connection.addEventListener('close', () => {
      console.log(`ReleaseAgent: WebSocket connection ${connectionId} closed`);
      this.connections.delete(connectionId);
    });
  }
  
  /**
   * Handles incoming messages from clients
   */
  async onMessage(connection: Connection, message: any) {
    console.log(`ReleaseAgent onMessage received:`, message);
    
    try {
      // If message is a string, parse it as JSON
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      
      // Process the message based on its type
      if (data.type === 'create-release') {
        await this.handleWebSocketCreateRelease(connection, data);
      } else if (data.type === 'add-prs') {
        await this.handleWebSocketAddPRs(connection, data);
      } else if (data.type === 'add-commits') {
        await this.handleWebSocketAddCommits(connection, data);
      } else if (data.type === 'generate-notes') {
        await this.handleWebSocketGenerateNotes(connection, data);
      } else {
        console.log(`Unhandled message type: ${data.type}`);
        connection.send(JSON.stringify({
          type: 'error',
          content: `Unhandled message type: ${data.type}`
        }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      
      // Send error message back to the client
      connection.send(JSON.stringify({
        type: 'error',
        content: 'Error processing your message'
      }));
    }
  }

  /**
   * Handle WebSocket request to create a release
   */
  private async handleWebSocketCreateRelease(connection: Connection, data: any) {
    try {
      const request = new Request('http://internal/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.release || {})
      });
      
      const response = await this.onRequest(request);
      const responseBody = await response.json();
      
      connection.send(JSON.stringify({
        type: 'release-created',
        status: response.status,
        data: responseBody
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        content: 'Failed to create release'
      }));
    }
  }

  /**
   * Handle WebSocket request to add pull requests
   */
  private async handleWebSocketAddPRs(connection: Connection, data: any) {
    try {
      const request = new Request('http://internal/prs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseId: data.releaseId,
          pullRequests: data.pullRequests || []
        })
      });
      
      const response = await this.onRequest(request);
      const responseBody = await response.json();
      
      connection.send(JSON.stringify({
        type: 'prs-added',
        status: response.status,
        data: responseBody
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        content: 'Failed to add pull requests'
      }));
    }
  }

  /**
   * Handle WebSocket request to add commits
   */
  private async handleWebSocketAddCommits(connection: Connection, data: any) {
    try {
      const request = new Request('http://internal/commits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseId: data.releaseId,
          commits: data.commits || []
        })
      });
      
      const response = await this.onRequest(request);
      const responseBody = await response.json();
      
      connection.send(JSON.stringify({
        type: 'commits-added',
        status: response.status,
        data: responseBody
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        content: 'Failed to add commits'
      }));
    }
  }

  /**
   * Handle WebSocket request to generate release notes
   */
  private async handleWebSocketGenerateNotes(connection: Connection, data: any) {
    try {
      const request = new Request('http://internal/generate-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseId: data.releaseId,
          format: data.format || 'json',
          includeCommits: data.includeCommits || false
        })
      });
      
      const response = await this.onRequest(request);
      const responseBody = await response.json();
      
      connection.send(JSON.stringify({
        type: 'notes-generated',
        status: response.status,
        data: responseBody
      }));
    } catch (error) {
      connection.send(JSON.stringify({
        type: 'error',
        content: 'Failed to generate release notes'
      }));
    }
  }
} 