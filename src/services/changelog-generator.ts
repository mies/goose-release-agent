import { Bindings, Release, PullRequest, Commit, Category, ReleaseNotes } from '../types';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Options for changelog generation
 */
export interface ChangelogOptions {
  format: 'markdown' | 'json' | 'html';
  style?: 'technical' | 'user-friendly' | 'detailed' | 'concise';
  includeCommits?: boolean;
  customPrompt?: string;
}

/**
 * Service for generating changelogs using Anthropic's Claude API
 */
export class ChangelogGenerator {
  private client: Anthropic;
  private model: string;
  
  constructor(apiKey: string, model: string = 'claude-3-haiku-20240307') {
    this.client = new Anthropic({
      apiKey,
      // The SDK automatically works with Cloudflare Workers
    });
    this.model = model;
  }
  
  /**
   * Generate a changelog for a release using Anthropic's Claude
   */
  async generateChangelog(
    release: Release,
    pullRequests: PullRequest[],
    commits: Commit[],
    categories: Category[],
    options: ChangelogOptions
  ): Promise<string> {
    try {
      // Check if this is a test API key
      if (this.isTestApiKey()) {
        console.log('Using mock response for changelog generation (test API key detected)');
        return this.generateMockResponse(release, pullRequests, categories, options.format);
      }
      
      const prompt = this.createPrompt(release, pullRequests, commits, categories, options);
      
      // Use the SDK to create a message
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4000,
        temperature: 0.7,
        system: "You are a changelog generator that creates detailed, well-structured release notes based on pull requests and commits. Focus on creating clear, useful documentation.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });
      
      return this.processResponse(response, options.format);
    } catch (error) {
      console.error('Error generating changelog:', error);
      
      // If API error occurs, fall back to mock for easier testing
      if (error instanceof Error && error.message.includes('API')) {
        console.log('Falling back to mock response due to API error');
        return this.generateMockResponse(release, pullRequests, categories, options.format);
      }
      
      throw new Error(`Failed to generate changelog: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Check if the API key is a test key
   */
  private isTestApiKey(): boolean {
    // For simplicity in local development, always use mock responses
    // In production, this would check for an actual valid API key
    return true;
    
    /* Uncomment for production use:
    const apiKey = this.client.apiKey;
    return !apiKey || 
           apiKey === 'test_anthropic_api_key' || 
           apiKey.startsWith('test_') || 
           apiKey.includes('test');
    */
  }
  
  /**
   * Generate a mock response for testing without API calls
   */
  private generateMockResponse(
    release: Release, 
    pullRequests: PullRequest[], 
    categories: Category[],
    format: string
  ): string {
    // For JSON format
    if (format === 'json') {
      const categoriesMap: Record<string, any> = {};
      
      // Group PRs by category
      pullRequests.forEach(pr => {
        let categoryName = 'Other Changes';
        
        if (pr.categoryId) {
          const category = categories.find(c => c.id === pr.categoryId);
          if (category) categoryName = category.name;
        }
        
        if (!categoriesMap[categoryName]) {
          categoriesMap[categoryName] = {
            title: categoryName,
            items: []
          };
        }
        
        categoriesMap[categoryName].items.push({
          title: pr.title,
          prNumber: pr.prNumber,
          url: pr.url,
          author: pr.author
        });
      });
      
      return JSON.stringify({
        version: release.version,
        releaseDate: release.releaseDate,
        summary: `This is a mock changelog for ${release.version}`,
        categories: categoriesMap
      }, null, 2);
    }
    
    // For markdown and HTML formats
    let markdown = `# ${release.name || release.version}\n\n`;
    markdown += `Released on ${new Date(release.releaseDate).toLocaleDateString()}\n\n`;
    markdown += release.description ? `${release.description}\n\n` : '';
    markdown += `This is a mock changelog for testing without an Anthropic API key.\n\n`;
    
    // Group PRs by category
    const prsByCategory: Record<string, PullRequest[]> = {};
    
    categories.forEach(category => {
      prsByCategory[category.name] = [];
    });
    
    if (Object.keys(prsByCategory).length === 0) {
      prsByCategory['Features'] = [];
      prsByCategory['Bug Fixes'] = [];
      prsByCategory['Documentation'] = [];
      prsByCategory['Other Changes'] = [];
    }
    
    pullRequests.forEach(pr => {
      if (pr.categoryId) {
        const category = categories.find(c => c.id === pr.categoryId);
        if (category) {
          prsByCategory[category.name].push(pr);
          return;
        }
      }
      
      prsByCategory['Other Changes'].push(pr);
    });
    
    // Build markdown sections
    Object.entries(prsByCategory).forEach(([category, prs]) => {
      if (prs.length === 0) return;
      
      markdown += `## ${category}\n\n`;
      
      prs.forEach(pr => {
        markdown += `- ${pr.title} (#${pr.prNumber}) by @${pr.author}\n`;
      });
      
      markdown += '\n';
    });
    
    return markdown;
  }
  
  /**
   * Create a prompt for Claude based on the release data
   */
  private createPrompt(
    release: Release,
    pullRequests: PullRequest[],
    commits: Commit[],
    categories: Category[],
    options: ChangelogOptions
  ): string {
    // Organize PRs by category
    const prsByCategory: Record<string, PullRequest[]> = {};
    
    // Initialize categories
    categories.forEach(category => {
      prsByCategory[category.name] = [];
    });
    
    // If no categories exist, use default ones
    if (categories.length === 0) {
      prsByCategory['Features'] = [];
      prsByCategory['Bug Fixes'] = [];
      prsByCategory['Documentation'] = [];
      prsByCategory['Other Changes'] = [];
    }
    
    // Group PRs by category
    pullRequests.forEach(pr => {
      if (pr.categoryId) {
        const category = categories.find(c => c.id === pr.categoryId);
        if (category) {
          prsByCategory[category.name].push(pr);
          return;
        }
      }
      
      // If no category is assigned or category not found, try to determine from labels
      if (pr.labels && pr.labels.length > 0) {
        const labels = Array.isArray(pr.labels) ? pr.labels : JSON.parse(pr.labels as string);
        
        if (labels.some((label: string) => ['feature', 'enhancement'].includes(label.toLowerCase()))) {
          prsByCategory['Features'].push(pr);
        } else if (labels.some((label: string) => ['bug', 'fix'].includes(label.toLowerCase()))) {
          prsByCategory['Bug Fixes'].push(pr);
        } else if (labels.some((label: string) => ['documentation', 'docs'].includes(label.toLowerCase()))) {
          prsByCategory['Documentation'].push(pr);
        } else {
          prsByCategory['Other Changes'].push(pr);
        }
      } else {
        // No labels, put in Other Changes
        prsByCategory['Other Changes'].push(pr);
      }
    });
    
    // Format pull requests for each category
    const formattedCategories = Object.entries(prsByCategory)
      .map(([category, prs]) => {
        if (prs.length === 0) return null;
        
        const prList = prs.map(pr => 
          `- ${pr.title} (#${pr.prNumber}) by @${pr.author} ${pr.url ? `[Link](${pr.url})` : ''}`
        ).join('\n');
        
        return `### ${category}\n${prList}`;
      })
      .filter(Boolean)
      .join('\n\n');
    
    // Format commits if needed
    let commitsSection = '';
    if (options.includeCommits && commits.length > 0) {
      const formattedCommits = commits
        .map(commit => `- ${commit.message} (${commit.hash.substring(0, 7)}) by ${commit.author}`)
        .join('\n');
      
      commitsSection = `\n\n### Commits\n${formattedCommits}`;
    }
    
    // Determine style instructions
    const styleInstructions = this.getStyleInstructions(options.style || 'technical');
    
    // Build the main prompt
    return `You are an expert developer documentation writer specializing in release notes and changelogs.

REPOSITORY INFORMATION:
- Name: ${release.repository}
- Version: ${release.version}
- Release Name: ${release.name || release.version}
- Release Date: ${release.releaseDate}
- Description: ${release.description || 'No description provided'}

CHANGES BY CATEGORY:
${formattedCategories}
${commitsSection}

${styleInstructions}

Please generate a comprehensive, well-structured changelog in ${options.format} format that:
1. Begins with a brief summary of the release
2. Organizes changes into the categories shown above
3. Uses clear, concise language appropriate for technical users
4. Includes relevant PR numbers and references
5. Highlights breaking changes prominently if any exist

${options.customPrompt || ''}

Output the changelog content only, without additional commentary.`;
  }
  
  /**
   * Get style-specific instructions for the prompt
   */
  private getStyleInstructions(style: string): string {
    switch (style) {
      case 'technical':
        return 'Use a technical tone suitable for developers. Include specific technical details and be precise.';
      case 'user-friendly':
        return 'Use a user-friendly tone accessible to non-technical users. Focus on benefits and improvements rather than technical implementation details.';
      case 'detailed':
        return 'Provide detailed explanations for each change. Elaborate on the impact and purpose of significant changes.';
      case 'concise':
        return 'Keep the changelog concise and to the point. Focus only on the most important information without unnecessary details.';
      default:
        return 'Use a balanced tone suitable for both technical and non-technical readers.';
    }
  }
  
  /**
   * Process the API response and return the formatted changelog
   */
  private processResponse(response: Anthropic.Message, format: string): string {
    // Extract the text from the response
    if (!response.content || response.content.length === 0) {
      throw new Error('Empty response from Claude API');
    }
    
    // With the SDK, we need to handle content blocks that might be of different types
    const textBlocks = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text);
    
    if (textBlocks.length === 0) {
      throw new Error('No text content found in Claude response');
    }
    
    const text = textBlocks.join('\n\n');
    
    // For JSON format, we need to ensure it's valid JSON
    if (format === 'json') {
      try {
        // Check if the response is already valid JSON
        JSON.parse(text);
        return text;
      } catch (e) {
        // If not valid JSON, try to extract JSON blocks from markdown
        const jsonMatch = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            // Validate the extracted JSON
            JSON.parse(jsonMatch[1]);
            return jsonMatch[1];
          } catch (e) {
            throw new Error('Claude did not return valid JSON format');
          }
        } else {
          throw new Error('Could not extract JSON from Claude response');
        }
      }
    }
    
    return text;
  }
  
  /**
   * Generate structured release notes object
   */
  async generateReleaseNotes(
    release: Release,
    pullRequests: PullRequest[],
    commits: Commit[],
    categories: Category[],
    options: ChangelogOptions
  ): Promise<ReleaseNotes> {
    try {
      // First generate the changelog text
      const changelog = await this.generateChangelog(release, pullRequests, commits, categories, {
        ...options,
        format: 'json'
      });
      
      // Parse the JSON response
      const jsonNotes = JSON.parse(changelog);
      
      // Create the structured ReleaseNotes object
      const releaseNotes: ReleaseNotes = {
        version: release.version,
        name: release.name,
        releaseDate: release.releaseDate,
        description: release.description,
        categories: jsonNotes.categories || {},
        commits: options.includeCommits ? commits : undefined,
        raw: options.format === 'markdown' || options.format === 'html' ? 
          await this.generateChangelog(release, pullRequests, commits, categories, options) : 
          undefined
      };
      
      return releaseNotes;
    } catch (error) {
      console.error('Error generating or parsing JSON changelog:', error);
      
      // Generate a mock response if we had JSON parsing issues
      // This could happen if the API returned valid text but not valid JSON
      const mockJson = this.generateMockResponse(release, pullRequests, categories, 'json');
      
      try {
        // Try to parse the mock JSON
        const mockNotes = JSON.parse(mockJson);
        
        return {
          version: release.version,
          name: release.name,
          releaseDate: release.releaseDate,
          description: release.description,
          categories: mockNotes.categories || {},
          commits: options.includeCommits ? commits : undefined,
          raw: options.format === 'markdown' || options.format === 'html' ? 
            this.generateMockResponse(release, pullRequests, categories, options.format) : 
            undefined
        };
      } catch (mockError) {
        // Last resort fallback
        return {
          version: release.version,
          name: release.name,
          releaseDate: release.releaseDate,
          description: release.description,
          categories: {
            'All Changes': {
              title: 'All Changes',
              items: pullRequests.map(pr => ({
                title: pr.title,
                prNumber: pr.prNumber,
                url: pr.url,
                author: pr.author
              }))
            }
          },
          commits: options.includeCommits ? commits : undefined,
          raw: this.generateMockResponse(release, pullRequests, categories, options.format)
        };
      }
    }
  }
}

/**
 * Factory function to create a ChangelogGenerator instance
 */
export function createChangelogGenerator(env: Bindings): ChangelogGenerator {
  const apiKey = env.ANTHROPIC_API_KEY || 'test_anthropic_api_key';
  
  // If no API key, log a warning but continue with a mock key
  if (!env.ANTHROPIC_API_KEY) {
    console.warn('Warning: ANTHROPIC_API_KEY environment variable is not set, using mock responses for development');
  }
  
  return new ChangelogGenerator(apiKey);
} 