import { Agent, type Connection, type ConnectionContext } from "agents-sdk";
import { type Bindings } from "../types";

/**
 * ChatAgent handles text-based chat interactions through HTTP and WebSocket connections.
 */
export class ChatAgent extends Agent<Bindings> {
  // Store for active connections
  private connections = new Map<string, Connection>();
  
  /**
   * Handles HTTP requests to the agent
   */
  async onRequest(request: Request) {
    // Handle direct requests to the agent
    const url = new URL(request.url);
    const message = url.searchParams.get('message') || "Hello";
    
    return new Response(`Chat response: ${message}`);
  }

  /**
   * Handles WebSocket connection events
   */
  async onConnect(connection: Connection, ctx: ConnectionContext) {
    console.log('ChatAgent: New WebSocket connection');
    
    // Generate a unique ID for this connection
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, connection);
    
    // Send welcome message
    connection.send(JSON.stringify({
      type: 'welcome',
      content: 'Connected to ChatAgent. Start sending messages!'
    }));

    // Handle disconnection
    connection.addEventListener('close', () => {
      console.log(`ChatAgent: WebSocket connection ${connectionId} closed`);
      this.connections.delete(connectionId);
    });
  }
  
  /**
   * Handles incoming messages from clients
   */
  async onMessage(connection: Connection, message: any) {
    console.log(`ChatAgent onMessage received:`, message);
    
    try {
      // If message is a string, parse it as JSON
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      
      // Process the message based on its type
      if (data.type === 'message') {
        const response = `Chat response: ${data.content}`;
        
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
        content: 'Error processing your message'
      }));
    }
  }
} 