/**
 * Type definitions for application bindings and shared types.
 */

/**
 * Environment bindings for the application.
 * Includes database and durable object namespace bindings.
 */
export type Bindings = {
  /** D1 Database binding */
  DB: D1Database;
  
  /** Agent durable object namespaces */
  ChatAgent: DurableObjectNamespace;
  AssistantAgent: DurableObjectNamespace;
  ReleaseAgent: DurableObjectNamespace;

  /** Environment variables */
  GITHUB_API_TOKEN?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  SLACK_WEBHOOK_URL?: string;
};

/**
 * Represents a software release with version information and related data
 */
export interface Release {
  id?: number;
  version: string;
  name?: string;
  repository: string;
  releaseDate: string;
  description?: string;
  generatedNotes?: string;
  publishedStatus?: 'draft' | 'published';
}

/**
 * Represents a Pull Request associated with a release
 */
export interface PullRequest {
  id?: number;
  prNumber: number;
  releaseId?: number;
  title: string;
  author: string;
  description?: string;
  url: string;
  mergedAt: string;
  labels?: string[];
  categoryId?: number;
}

/**
 * Represents a commit associated with a release or PR
 */
export interface Commit {
  id?: number;
  hash: string;
  releaseId?: number;
  pullRequestId?: number;
  message: string;
  author: string;
  authorEmail?: string;
  date: string;
}

/**
 * Category of changes (e.g., feature, fix, improvement)
 */
export interface Category {
  id?: number;
  name: string;
  description?: string;
  displayOrder?: number;
}

/**
 * Generated release notes structure
 */
export interface ReleaseNotes {
  version: string;
  name?: string;
  releaseDate: string;
  description?: string;
  categories: {
    [categoryName: string]: {
      title: string;
      items: {
        title: string;
        prNumber?: number;
        url?: string;
        author?: string;
      }[];
    }
  };
  commits?: Commit[];
  raw?: string;
}

/**
 * Release creation request
 */
export interface CreateReleaseRequest {
  version: string;
  name?: string;
  repository: string;
  description?: string;
}

/**
 * Request to generate release notes
 */
export interface GenerateNotesRequest {
  releaseId: number;
  format?: 'json' | 'markdown' | 'html';
  includeCommits?: boolean;
}

/**
 * Response containing release notes
 */
export interface GenerateNotesResponse {
  releaseNotes: ReleaseNotes;
  format: 'json' | 'markdown' | 'html';
  raw?: string;
} 