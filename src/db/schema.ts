import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

export type NewUser = typeof users.$inferInsert;

export const users = sqliteTable("users", {
  id: integer("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Release schema for tracking software releases
export type NewRelease = typeof releases.$inferInsert;

export const releases = sqliteTable("releases", {
  id: integer("id", { mode: "number" }).primaryKey(),
  version: text("version").notNull().unique(), // Semantic version (e.g., "1.0.0")
  name: text("name"), // Optional release name
  repository: text("repository").notNull(), // Repository identifier (e.g., "owner/repo")
  releaseDate: text("release_date").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  description: text("description"), // Overall release description
  generatedNotes: text("generated_notes"), // JSON string of generated release notes
  publishedStatus: text("published_status").default("draft"), // draft, published
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Pull Request schema
export type NewPullRequest = typeof pullRequests.$inferInsert;

export const pullRequests = sqliteTable("pull_requests", {
  id: integer("id", { mode: "number" }).primaryKey(),
  prNumber: integer("pr_number", { mode: "number" }).notNull(), // PR number in GitHub
  releaseId: integer("release_id").references(() => releases.id),
  title: text("title").notNull(),
  author: text("author").notNull(),
  description: text("description"),
  url: text("url").notNull(),
  mergedAt: text("merged_at").notNull(),
  labels: text("labels"), // JSON string of labels
  categoryId: integer("category_id").references(() => categories.id),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Commit schema
export type NewCommit = typeof commits.$inferInsert;

export const commits = sqliteTable("commits", {
  id: integer("id", { mode: "number" }).primaryKey(),
  hash: text("hash").notNull().unique(),
  releaseId: integer("release_id").references(() => releases.id),
  pullRequestId: integer("pull_request_id").references(() => pullRequests.id),
  message: text("message").notNull(),
  author: text("author").notNull(),
  authorEmail: text("author_email"),
  date: text("date").notNull(),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Change categories
export type NewCategory = typeof categories.$inferInsert;

export const categories = sqliteTable("categories", {
  id: integer("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull().unique(), // e.g., "feature", "fix", "improvement"
  description: text("description"),
  displayOrder: integer("display_order", { mode: "number" }).default(0),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});
