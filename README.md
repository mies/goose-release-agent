# 🪿 Goose Release Agent

A powerful agent-based backend system built on the HONC stack (Hono, OTEL, Nameyourdatabase, Cloudflare). This system leverages Cloudflare Workers, Durable Objects, and D1 to create stateful, real-time agent interactions through both WebSocket and REST API interfaces.

## Features

- **Stateful Agents**: Persistent agent instances powered by Cloudflare Durable Objects
- **Real-time Communication**: WebSocket support for interactive agent sessions
- **REST API**: Clean HTTP endpoints for simple agent interactions
- **Modular Architecture**: Easily extend with new agent types
- **SQLite Storage**: Built-in state persistence through Durable Objects
- **TypeScript**: Fully typed codebase for better development experience

## Architecture

The codebase is organized into a clean, modular structure:

```
src/
├── agents/            # Agent implementations
│   ├── index.ts       # Re-exports all agents
│   ├── ChatAgent.ts   # Chat agent implementation
│   └── AssistantAgent.ts # Assistant agent implementation
├── types.ts           # Shared type definitions
├── utils/             # Utility functions
│   ├── index.ts       # Re-exports all utilities
│   └── agentUtils.ts  # Agent communication utilities
└── index.ts           # Main application entry point
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/installation) package manager
- [Cloudflare account](https://dash.cloudflare.com/sign-up) for deployment

### Local Development

1. **Clone the repository**:

```sh
git clone <repository-url>
cd goose-release-agent
```

2. **Install dependencies**:

```sh
pnpm install
```

3. **Set up environment variables**:

Create a `.dev.vars` file based on the provided example:

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your values
```

4. **Set up the database**:

```sh
# This will create the local database, run migrations, and seed the database
pnpm run db:setup
```

5. **Start the development server**:

```sh
pnpm run dev
```

## Interacting with Agents

The project includes two agent types:

- **ChatAgent**: Handles conversational interactions
- **AssistantAgent**: Provides assistant-style responses

### HTTP Endpoints

#### ChatAgent:

```sh
# GET request
curl "http://localhost:8787/chat?message=Hello%20world"

# POST request
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello via POST request"}'
```

#### AssistantAgent:

```sh
# GET request
curl "http://localhost:8787/assistant?query=What%20time%20is%20it"

# POST request
curl -X POST http://localhost:8787/assistant \
  -H "Content-Type: application/json" \
  -d '{"query":"What is the weather like?"}'
```

### WebSocket Connections

You can use any WebSocket client like [websocat](https://github.com/vi/websocat) to connect:

```sh
# ChatAgent direct connection
websocat ws://localhost:8787/ChatAgent/roomId

# Or using the legacy route
websocat ws://localhost:8787/ws/chat/roomId
```

Once connected, send messages in JSON format:

```json
{"type":"message","content":"Hello from websocat!"}
```

For the AssistantAgent:

```json
{"type":"query","content":"What's the weather like?"}
```

## Creating New Agents

To add a new agent:

1. **Create a new agent file** in `src/agents/`:

```typescript
// src/agents/NewAgent.ts
import { Agent, type Connection, type ConnectionContext } from "agents-sdk";
import { type Bindings } from "../types";

export class NewAgent extends Agent<Bindings> {
  private connections = new Map<string, Connection>();
  
  async onRequest(request: Request) {
    // Handle HTTP requests
    return new Response("Response from NewAgent");
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    // Handle WebSocket connection
    console.log('NewAgent: New connection');
    // Implementation...
  }
  
  async onMessage(connection: Connection, message: any) {
    // Handle incoming messages
    console.log('Message received:', message);
    // Implementation...
  }
}
```

2. **Export the new agent** in `src/agents/index.ts`:

```typescript
export { NewAgent } from './NewAgent';
```

3. **Add the agent to Bindings** in `src/types.ts`:

```typescript
export type Bindings = {
  // Existing bindings...
  NewAgent: DurableObjectNamespace;
};
```

4. **Add routes** in `src/index.ts`:

```typescript
// HTTP endpoint
app.get("/newagent", async (c) => {
  const param = c.req.query('param') || "default";
  try {
    return await queryAgent(c.env.NewAgent, 'NewAgent', { param });
  } catch (error: unknown) {
    // Error handling...
  }
});
```

5. **Update wrangler.toml**:

```toml
[durable_objects]
bindings = [
  # Existing bindings...
  { name = "NewAgent", class_name = "NewAgent" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChatAgent", "AssistantAgent", "NewAgent"]
```

## Deployment

To deploy your worker to Cloudflare:

1. **Create a D1 database** on Cloudflare:

```sh
pnpm exec wrangler d1 create goose-release-db
```

2. **Update the `wrangler.toml`** with your database ID.

3. **Create a `.prod.vars`** file with your production values:

```sh
cp .prod.vars.example .prod.vars
# Edit .prod.vars with your values
```

4. **Run migrations on production**:

```sh
pnpm run db:migrate:prod
```

5. **Deploy your worker**:

```sh
pnpm run deploy
```

## Technical Details

### Durable Objects

Agents are implemented as [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/), providing stateful computation and storage capabilities. Each agent has:

- **Persistent storage**: SQLite database within the Durable Object
- **Connection management**: Tracking active WebSocket connections
- **Message handlers**: Processing incoming messages and generating responses

### Agent Base Class

All agents extend the `Agent<Bindings>` class from agents-sdk and must implement:

- `onRequest`: Handles HTTP requests to the agent 
- `onConnect`: Manages WebSocket connection establishments
- `onMessage`: Processes incoming WebSocket messages

### WebSocket vs HTTP

- **WebSocket**: Better for interactive, stateful conversations
- **HTTP**: Simpler for one-off requests or integrations with other systems

### Headers for Agent Communication

When communicating with agents, specific headers are required:

```typescript
headers.set('x-partykit-namespace', agentName);
headers.set('x-partykit-room', roomId);
```

These headers help route requests to the correct agent instance.

### Agent Interactions

There are two main ways to interact with agents:

1. **Direct URL Patterns**:
   - `/ChatAgent/roomId` - Direct WebSocket to ChatAgent
   - `/AssistantAgent/roomId` - Direct WebSocket to AssistantAgent

2. **REST API Endpoints**:
   - `/chat` - HTTP endpoint for ChatAgent
   - `/assistant` - HTTP endpoint for AssistantAgent

### Data Persistence

Durable Objects provide SQLite databases for persistent storage. The agent framework manages:

- **State**: Store conversation history or user preferences
- **Connections**: Track active WebSocket connections
- **Sessions**: Maintain session information between connections

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

Based on the [HONC stack](https://honc.dev) created by [Fiberplane](https://github.com/fiberplane/create-honc-app).
