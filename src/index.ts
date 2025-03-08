import { instrument } from "@fiberplane/hono-otel";
import { createFiberplane, createOpenAPISpec } from "@fiberplane/hono";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "./db/schema";
import { Agent, routeAgentRequest, type Connection, type ConnectionContext, type AgentOptions } from "agents-sdk";
import { agentsMiddleware } from "hono-agents";

// Define your agent classes
class ChatAgent extends Agent<Bindings> {
  // Store for active connections
  private connections = new Map<string, Connection>();
  
  async onRequest(request: Request) {
    // Handle direct requests to the agent
    const url = new URL(request.url);
    const message = url.searchParams.get('message') || "Hello";
    
    return new Response(`Chat response: ${message}`);
  }

  // Handle WebSocket connection events
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
  
  // Handle incoming messages from the client
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

class AssistantAgent extends Agent<Bindings> {
  // Store for active WebSocket connections
  private connections = new Map<string, Connection>();

  async onRequest(request: Request) {
    // Handle direct requests to the agent
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || "Help me";
    
    return new Response(`Assistant response: ${query}`);
  }

  // Handle WebSocket connection events
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
  
  // Handle incoming messages from the client
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

type Bindings = {
  DB: D1Database;
  // Add your agent bindings here
  ChatAgent: DurableObjectNamespace;
  AssistantAgent: DurableObjectNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// Configure agents middleware for WebSocket handling
app.use(
  "*", // Apply to all routes
  agentsMiddleware({
    options: {
      // Route agent requests via NAMESPACE pattern
      prefix: '' // No prefix means we use the root path
    }
  })
);

// Direct WebSocket connection route for backward compatibility
app.get('/ws/:agent/:room', async (c) => {
  const agent = c.req.param('agent');
  const room = c.req.param('room');
  console.log(`[WS] Received WebSocket request for agent: ${agent}, room: ${room}`);
  
  if (!c.req.header('upgrade') || c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('This endpoint requires a WebSocket connection', 400);
  }
  
  // Map the agent parameter to the correct agent name and namespace
  const agentParam = agent.toLowerCase();
  let agentNamespace = null;
  let agentName = '';
  
  if (agentParam === 'chatagent' || agentParam === 'chat') {
    agentNamespace = c.env.ChatAgent;
    agentName = 'ChatAgent';
  } else if (agentParam === 'assistantagent' || agentParam === 'assistant') {
    agentNamespace = c.env.AssistantAgent;
    agentName = 'AssistantAgent';
  } else {
    return c.text(`Unknown agent: ${agent}`, 404);
  }
  
  if (!agentNamespace) {
    return c.text('Agent namespace not available', 500);
  }
  
  try {
    // Get a stub for the specific Durable Object
    const id = agentNamespace.idFromName(room);
    const stub = agentNamespace.get(id);
    
    // Copy all headers from the original request
    const headers = new Headers();
    for (const [key, value] of Object.entries(c.req.header())) {
      if (value !== undefined) headers.set(key, value);
    }
    
    // Add all the required Party Kit / Agent headers
    headers.set('x-partykit-namespace', agentName);
    headers.set('x-partykit-room', room);
    headers.set('x-partykit-connection-id', crypto.randomUUID());
    headers.set('x-partykit-host', new URL(c.req.url).host);
    headers.set('x-partykit-connection-type', 'websocket');
    
    console.log(`[WS] Headers being sent:`, 
                Object.fromEntries([...headers.entries()]));
    
    // Create a new request to send to the Durable Object
    const newRequest = new Request(c.req.url, {
      method: c.req.method,
      headers: headers,
      body: c.req.raw.body,
    });
    
    console.log(`[WS] Forwarding WebSocket request to ${agentName} Durable Object`);
    
    // Forward the WebSocket request directly to the Durable Object
    const response = await stub.fetch(newRequest);
    
    console.log(`[WS] Response status: ${response.status}`);
    
    return response;
  } catch (error: unknown) {
    console.error('[WS] Error establishing WebSocket connection:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`WebSocket connection error: ${errorMessage}`, 500);
  }
});

// Root route
app.get("/", (c) => {
  return c.text("Honc from above! ☁️🪿");
});

// Standard REST API route for ChatAgent
app.get("/chat", async (c) => {
  const message = c.req.query('message') || "Hello";
  
  try {
    // Create a direct request to the ChatAgent using the agent's namespace
    const id = c.env.ChatAgent.idFromName('default');
    const stub = c.env.ChatAgent.get(id);
    
    // Set the required headers for direct Durable Object interaction
    const headers = new Headers();
    headers.set('x-partykit-namespace', 'ChatAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create a new request with the appropriate query parameters
    const url = new URL('http://internal/');
    url.searchParams.set('message', message);
    
    const agentRequest = new Request(url.toString(), {
      method: 'GET',
      headers: headers
    });
    
    // Send the request to the agent
    const response = await stub.fetch(agentRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error processing chat request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Chat error: ${errorMessage}`, 500);
  }
});

// POST endpoint for ChatAgent
app.post("/chat", async (c) => {
  try {
    // Parse the request body
    const body = await c.req.json();
    const message = body.message || "Hello";
    
    // Create a direct request to the ChatAgent using the agent's namespace
    const id = c.env.ChatAgent.idFromName('default');
    const stub = c.env.ChatAgent.get(id);
    
    // Set the required headers for direct Durable Object interaction
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('x-partykit-namespace', 'ChatAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create an internal URL for the agent
    const url = new URL('http://internal/');
    
    // Create a new request
    const agentRequest = new Request(url.toString(), {
      method: 'GET', // Using GET because our onRequest handler is designed for GET
      headers: headers,
    });
    
    // Manually append the query parameter
    // This is a workaround since our onRequest handler expects query parameters
    const newUrl = new URL(agentRequest.url);
    newUrl.searchParams.set('message', message);
    
    // Create a new request with the updated URL
    const finalRequest = new Request(newUrl.toString(), {
      method: agentRequest.method,
      headers: agentRequest.headers
    });
    
    console.log(`[Chat POST] Sending request to agent:`, {
      url: finalRequest.url,
      headers: Object.fromEntries([...finalRequest.headers.entries()])
    });
    
    // Send the request to the agent
    const response = await stub.fetch(finalRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error processing chat POST request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Chat error: ${errorMessage}`, 500);
  }
});

// Standard REST API route for AssistantAgent
app.get("/assistant", async (c) => {
  const query = c.req.query('query') || "Help me";
  
  try {
    // Create a direct request to the AssistantAgent using the agent's namespace
    const id = c.env.AssistantAgent.idFromName('default');
    const stub = c.env.AssistantAgent.get(id);
    
    // Set the required headers for direct Durable Object interaction
    const headers = new Headers();
    headers.set('x-partykit-namespace', 'AssistantAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create a new request with the appropriate query parameters
    const url = new URL('http://internal/');
    url.searchParams.set('query', query);
    
    const agentRequest = new Request(url.toString(), {
      method: 'GET',
      headers: headers
    });
    
    // Send the request to the agent
    const response = await stub.fetch(agentRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error processing assistant request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Assistant error: ${errorMessage}`, 500);
  }
});

// POST endpoint for AssistantAgent
app.post("/assistant", async (c) => {
  try {
    // Parse the request body
    const body = await c.req.json();
    const query = body.query || "Help me";
    
    // Create a direct request to the AssistantAgent using the agent's namespace
    const id = c.env.AssistantAgent.idFromName('default');
    const stub = c.env.AssistantAgent.get(id);
    
    // Set the required headers for direct Durable Object interaction
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('x-partykit-namespace', 'AssistantAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create an internal URL for the agent
    const url = new URL('http://internal/');
    
    // Create a new request
    const agentRequest = new Request(url.toString(), {
      method: 'GET', // Using GET because our onRequest handler is designed for GET
      headers: headers,
    });
    
    // Manually append the query parameter
    // This is a workaround since our onRequest handler expects query parameters
    const newUrl = new URL(agentRequest.url);
    newUrl.searchParams.set('query', query);
    
    // Create a new request with the updated URL
    const finalRequest = new Request(newUrl.toString(), {
      method: agentRequest.method,
      headers: agentRequest.headers
    });
    
    console.log(`[Assistant POST] Sending request to agent:`, {
      url: finalRequest.url,
      headers: Object.fromEntries([...finalRequest.headers.entries()])
    });
    
    // Send the request to the agent
    const response = await stub.fetch(finalRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error processing assistant POST request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Assistant error: ${errorMessage}`, 500);
  }
});

// Users API
app.get("/api/users", async (c) => {
  const db = drizzle(c.env.DB);
  const users = await db.select().from(schema.users);
  return c.json({ users });
});

app.post("/api/user", async (c) => {
  const db = drizzle(c.env.DB);
  const { name, email } = await c.req.json();

  const [newUser] = await db.insert(schema.users).values({
    name: name,
    email: email,
  }).returning();

  return c.json(newUser);
});

/**
 * Serve a simplified api specification for your API
 * As of writing, this is just the list of routes and their methods.
 */
app.get("/openapi.json", c => {
  // @ts-expect-error - @fiberplane/hono is in beta and still not typed correctly
  return c.json(createOpenAPISpec(app, {
    openapi: "3.0.0",
    info: {
      title: "Honc D1 App",
      version: "1.0.0",
    },
  }))
});

/**
 * Mount the Fiberplane api explorer to be able to make requests against your API.
 * 
 * Visit the explorer at `/fp`
 */
app.use("/fp/*", createFiberplane({
  app,
  openapi: { url: "/openapi.json" }
}));

// Export the Hono app and the agent classes
export { ChatAgent, AssistantAgent };

// Direct WebSocket testing route using agentsMiddleware pattern
app.get('/:agentName/:roomId', async (c) => {
  // This route should get intercepted by the agentsMiddleware if it's a WebSocket request
  // If it reaches here, it means it wasn't handled by the middleware
  return c.text('This endpoint requires a WebSocket connection or a valid agent name', 400);
});

// WebSocket test endpoint specifically for websocat testing
app.get('/websocket-test/:agent/:room', async (c) => {
  const agent = c.req.param('agent');
  const room = c.req.param('room');
  console.log(`[WebSocket Test] Connection request for agent: ${agent}, room: ${room}`);
  
  // Check if this is a WebSocket request
  if (!c.req.header('upgrade') || c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('This endpoint requires a WebSocket connection', 400);
  }
  
  // Map the agent parameter to the correct agent name and namespace
  const agentParam = agent.toLowerCase();
  let agentNamespace = null;
  let agentName = '';
  
  if (agentParam === 'chatagent' || agentParam === 'chat') {
    agentNamespace = c.env.ChatAgent;
    agentName = 'ChatAgent';
  } else if (agentParam === 'assistantagent' || agentParam === 'assistant') {
    agentNamespace = c.env.AssistantAgent;
    agentName = 'AssistantAgent';
  } else {
    return c.text(`Unknown agent: ${agent}`, 404);
  }
  
  if (!agentNamespace) {
    return c.text('Agent namespace not available', 500);
  }
  
  try {
    // Create a DurableObjectId from the room name
    const id = agentNamespace.idFromName(room);
    // Get a stub for the Durable Object
    const stub = agentNamespace.get(id);
    
    // Copy all headers from the original request
    const headers = new Headers();
    for (const [key, value] of Object.entries(c.req.header())) {
      if (value !== undefined) headers.set(key, value);
    }
    
    // Add all the required Party Kit / Agent headers
    headers.set('x-partykit-namespace', agentName);
    headers.set('x-partykit-room', room);
    headers.set('x-partykit-connection-id', crypto.randomUUID());
    headers.set('x-partykit-host', new URL(c.req.url).host);
    headers.set('x-partykit-connection-type', 'websocket');
    
    console.log(`[WebSocket Test] Headers being sent:`, 
                Object.fromEntries([...headers.entries()]));
    
    // Create a new request to forward to the Durable Object
    const newRequest = new Request(c.req.url, {
      method: c.req.method,
      headers: headers,
      body: c.req.raw.body,
    });
    
    // Log the final URL
    console.log(`[WebSocket Test] Forwarding request to: ${newRequest.url}`);
    
    // Forward the request to the Durable Object
    const response = await stub.fetch(newRequest);
    
    console.log(`[WebSocket Test] Response status: ${response.status}`);
    
    return response;
  } catch (error: unknown) {
    console.error('[WebSocket Test] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`WebSocket connection error: ${errorMessage}`, 500);
  }
});

export default app;

// Export the instrumented app if you've wired up a Fiberplane-Hono-OpenTelemetry trace collector
//
// export default instrument(app);
