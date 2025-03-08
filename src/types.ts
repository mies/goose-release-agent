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
}; 