import { instrument } from "@fiberplane/hono-otel";
import { createFiberplane, createOpenAPISpec } from "@fiberplane/hono";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "./db/schema";
import { agentsMiddleware } from "hono-agents";
import { routeAgentRequest } from "agents-sdk";

// Import types and agents
import { type Bindings } from "./types";
import { ChatAgent, AssistantAgent, ReleaseAgent } from "./agents";

// Import utility functions
import { queryAgent } from "./utils";

// Import services
import { createWebhookHandler } from './services/webhook-handler';

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
  return c.text("Agentic HONC! ☁️🪿🤖");
});

// Standard REST API route for ChatAgent
app.get("/chat", async (c) => {
  const message = c.req.query('message') || "Hello";
  
  try {
    return await queryAgent(c.env.ChatAgent, 'ChatAgent', { message });
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
    
    return await queryAgent(c.env.ChatAgent, 'ChatAgent', { message });
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
    return await queryAgent(c.env.AssistantAgent, 'AssistantAgent', { query });
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
    
    return await queryAgent(c.env.AssistantAgent, 'AssistantAgent', { query });
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

// Standard REST API route for ReleaseAgent
app.get("/releases", async (c) => {
  try {
    return await queryAgent(c.env.ReleaseAgent, 'ReleaseAgent', {}, 'default', '/releases');
  } catch (error: unknown) {
    console.error('Error processing releases request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Release error: ${errorMessage}`, 500);
  }
});

app.get("/release/:id", async (c) => {
  const id = c.req.param('id');
  try {
    return await queryAgent(c.env.ReleaseAgent, 'ReleaseAgent', {}, 'default', `/release/${id}`);
  } catch (error: unknown) {
    console.error('Error processing release request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Release error: ${errorMessage}`, 500);
  }
});

app.get("/categories", async (c) => {
  try {
    return await queryAgent(c.env.ReleaseAgent, 'ReleaseAgent', {}, 'default', '/categories');
  } catch (error: unknown) {
    console.error('Error processing categories request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Categories error: ${errorMessage}`, 500);
  }
});

app.post("/releases", async (c) => {
  try {
    const body = await c.req.json();
    const requestUrl = new URL('http://internal/releases');
    
    // Create a stub for the ReleaseAgent Durable Object
    const id = c.env.ReleaseAgent.idFromName('default');
    const stub = c.env.ReleaseAgent.get(id);
    
    // Set required headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('x-partykit-namespace', 'ReleaseAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create the request to the agent
    const agentRequest = new Request(requestUrl.toString(), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    
    // Send the request to the agent
    const response = await stub.fetch(agentRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error creating release:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Release creation error: ${errorMessage}`, 500);
  }
});

app.post("/prs", async (c) => {
  try {
    const body = await c.req.json();
    const requestUrl = new URL('http://internal/prs');
    
    // Create a stub for the ReleaseAgent Durable Object
    const id = c.env.ReleaseAgent.idFromName('default');
    const stub = c.env.ReleaseAgent.get(id);
    
    // Set required headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('x-partykit-namespace', 'ReleaseAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create the request to the agent
    const agentRequest = new Request(requestUrl.toString(), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    
    // Send the request to the agent
    const response = await stub.fetch(agentRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error adding pull requests:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Pull request error: ${errorMessage}`, 500);
  }
});

app.post("/commits", async (c) => {
  try {
    const body = await c.req.json();
    const requestUrl = new URL('http://internal/commits');
    
    // Create a stub for the ReleaseAgent Durable Object
    const id = c.env.ReleaseAgent.idFromName('default');
    const stub = c.env.ReleaseAgent.get(id);
    
    // Set required headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('x-partykit-namespace', 'ReleaseAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create the request to the agent
    const agentRequest = new Request(requestUrl.toString(), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    
    // Send the request to the agent
    const response = await stub.fetch(agentRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error adding commits:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Commit error: ${errorMessage}`, 500);
  }
});

app.post("/generate-notes", async (c) => {
  try {
    const body = await c.req.json();
    const requestUrl = new URL('http://internal/generate-notes');
    
    // Create a stub for the ReleaseAgent Durable Object
    const id = c.env.ReleaseAgent.idFromName('default');
    const stub = c.env.ReleaseAgent.get(id);
    
    // Set required headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('x-partykit-namespace', 'ReleaseAgent');
    headers.set('x-partykit-room', 'default');
    
    // Create the request to the agent
    const agentRequest = new Request(requestUrl.toString(), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });
    
    // Send the request to the agent
    const response = await stub.fetch(agentRequest);
    
    return response;
  } catch (error: unknown) {
    console.error('Error generating notes:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Notes generation error: ${errorMessage}`, 500);
  }
});

// GitHub webhook endpoint
app.post('/webhooks/github', async (c) => {
  try {
    // Get the raw payload
    const rawPayload = await c.req.text();
    const signature = c.req.header('X-Hub-Signature-256');
    const event = c.req.header('X-GitHub-Event');
    const webhookId = c.req.header('X-GitHub-Delivery') || 'unknown';
    
    // Create webhook handler
    const webhookHandler = createWebhookHandler(c.env);
    
    // Verify signature
    if (!signature || !(await webhookHandler.verifyWebhookSignature(rawPayload, signature))) {
      console.error(`Invalid webhook signature for ${webhookId}`);
      return c.text('Invalid webhook signature', 401);
    }
    
    // Parse the payload again for processing
    const payload = JSON.parse(rawPayload);
    const action = payload.action || 'unknown';
    
    console.log(`Received GitHub webhook: ${event}.${action} (${webhookId})`);
    
    // Process based on event type
    let result;
    
    if (event === 'release') {
      result = await webhookHandler.processReleaseEvent(payload);
      // If this is a new or updated release, generate release notes
      if (result.releaseId && (result.status === 'created' || result.status === 'updated')) {
        await webhookHandler.generateReleaseNotes(result.releaseId);
      }
    } else if (event === 'pull_request') {
      result = await webhookHandler.processPullRequestEvent(payload);
    } else if (event === 'push') {
      result = await webhookHandler.processPushEvent(payload);
    } else {
      // We don't handle other event types yet
      return c.json({ status: 'ignored', event });
    }
    
    return c.json({ success: true, event, action, result });
  } catch (error: unknown) {
    console.error('Error processing webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ status: 'error', error: errorMessage }, 500);
  }
});

// Export the agent classes
export { ChatAgent, AssistantAgent, ReleaseAgent };
export default app;

// Export the instrumented app if you've wired up a Fiberplane-Hono-OpenTelemetry trace collector
//
// export default instrument(app);
