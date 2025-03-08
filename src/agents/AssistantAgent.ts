import { Agent, type Connection, type ConnectionContext } from "agents-sdk";
import { type Bindings } from "../types";

/**
 * AssistantAgent provides assistant-style responses through HTTP and WebSocket connections.
 */
export class AssistantAgent extends Agent<Bindings> {
  // Store for active WebSocket connections
  private connections = new Map<string, Connection>();

  /**
   * Handles HTTP requests to the agent
   */
  async onRequest(request: Request) {
    // Handle direct requests to the agent
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || "Help me";
    
    return new Response(`Assistant response: ${query}`);
  }

  /**
   * Handles WebSocket connection events
   */
  async onConnect(connection: Connection, ctx: ConnectionContext) {
    console.log('AssistantAgent: New WebSocket connection');
    
    // Generate a unique ID for this connection
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, connection);
    
    // Send welcome message
    connection.send(JSON.stringify({
      type: 'welcome',
      content: 'Connected to AssistantAgent. How can I assist you?'
    }));

    // Handle disconnection
    connection.addEventListener('close', () => {
      console.log(`AssistantAgent: WebSocket connection ${connectionId} closed`);
      this.connections.delete(connectionId);
    });
  }
  
  /**
   * Handles incoming messages from clients
   */
  async onMessage(connection: Connection, message: any) {
    console.log(`AssistantAgent onMessage received:`, message);
    
    try {
      // If message is a string, parse it as JSON
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      
      // Process the message based on its type
      if (data.type === 'query') {
        const response = `Assistant response: ${data.content}`;
        
        // Send the response back to the client
        connection.send(JSON.stringify({
          type: 'response',
          content: response
        }));
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
        content: 'Error processing your query'
      }));
    }
  }
} 