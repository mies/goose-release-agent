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

#### ReleaseAgent:

```sh
curl -X POST http://localhost:8787/releases \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0.0",
    "repository": "owner/repo",
    "name": "First Official Release",
    "description": "This release includes several new features and bug fixes."
  }'
  ```

### GitHub Webhook Integration

The system provides automatic release notes generation through GitHub webhooks. When configured, it will:

1. Automatically detect new GitHub releases
2. Collect associated pull requests and commits
3. Categorize changes based on PR labels
4. Generate structured release notes

#### Setting Up GitHub Webhooks

1. **Configure environment variables**:

Add the following to your `.dev.vars` file:
```
GITHUB_API_TOKEN="your_github_personal_access_token"
GITHUB_WEBHOOK_SECRET="your_webhook_secret_here"
```

2. **Create a GitHub webhook**:
   
   - Go to your GitHub repository → Settings → Webhooks → Add webhook
   - Set Payload URL to: `https://your-worker-url.workers.dev/webhooks/github`
   - Content type: `application/json`
   - Secret: Same value as `GITHUB_WEBHOOK_SECRET`
   - Events: Select `Releases`, `Pull requests`, and `Pushes`

3. **Testing locally with ngrok**:

   To test webhooks locally, you can use [ngrok](https://ngrok.com/):
   ```sh
   ngrok http 8787
   ```
   Then use the ngrok URL for your GitHub webhook.

#### Webhook Payload Structure

The webhook endpoint (`/webhooks/github`) accepts the following events:

- **Release events**: Triggered when a release is published, created, or edited
- **Pull request events**: Tracks merged PRs to associate with releases
- **Push events**: Collects commits to provide detailed change information

#### Manual Testing

You can manually test the webhook with curl:

```sh
# Test a release event
curl -X POST http://localhost:8787/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: release" \
  -H "X-GitHub-Delivery: test-id" \
  -H "X-Hub-Signature-256: sha256=<generated-signature>" \
  -d '{
    "action": "published",
    "release": {
      "id": 12345,
      "tag_name": "v1.0.0",
      "name": "Release 1.0.0",
      "body": "Initial release"
    },
    "repository": {
      "id": 54321,
      "full_name": "owner/repo",
      "name": "repo",
      "owner": {
        "login": "owner"
      },
      "default_branch": "main"
    }
  }'
```

To generate a valid signature for testing, first make sure your `.dev.vars` file includes the webhook secret:

```
# In .dev.vars
GITHUB_WEBHOOK_SECRET="your_webhook_secret_here"
GITHUB_API_TOKEN="your_github_api_token_here"
```

Then use the included test script, which will automatically use the secret from your `.dev.vars` file:

```sh
# Make the script executable
chmod +x test-webhook.sh

# Run the test webhook script (uses secret from .dev.vars)
./test-webhook.sh

# Or specify a custom secret and event type
./test-webhook.sh "custom_secret" "pull_request"
```

The script automatically:
1. Creates an appropriate payload for the event type
2. Generates a valid HMAC SHA-256 signature using your webhook secret
3. Sends the webhook to your local server

Alternatively, you can use the Node.js script for more detailed signature generation:

```sh
# Make the script executable
chmod +x generate-signature.js

# Generate a signature for a JSON file
./generate-signature.js < test-payload.json

# Or provide a specific webhook secret
./generate-signature.js "your_secret" < test-payload.json
```

To generate a valid signature, you can use a tool like [webhook-signature-generator](https://webhook.site/webhook-signature-generator).

#### How the Webhook Handler Works

The GitHub webhook integration is implemented with a clean, modular architecture:

1. **GitHub Service** (`src/services/github.ts`)
   - Handles all direct GitHub API interactions
   - Verifies webhook signatures for security
   - Fetches repository, release, PR, and commit data
   - Provides typed interfaces for GitHub API responses

2. **Webhook Handler** (`src/services/webhook-handler.ts`)
   - Processes GitHub webhook events
   - Stores data in the D1 database
   - Associates PRs with releases
   - Triggers release notes generation

3. **Event Processing Flow**:
   - **Release events**: When a release is published or created, the handler stores its information and fetches associated PRs.
   - **PR events**: When a PR is merged, it's associated with the latest release or a draft release is created.
   - **Push events**: Commits are collected and associated with PRs and releases.

4. **Data Model**:
   - Releases are stored with version, name, repository, and generated notes
   - Pull requests include title, author, description, and are categorized
   - Commits are associated with PRs and releases for detailed change tracking

5. **Automatic Categorization**:
   - PRs are automatically categorized based on their labels:
     - `feature`, `enhancement`: Categorized as "Features"
     - `bug`, `fix`: Categorized as "Bug Fixes"
     - `documentation`, `docs`: Categorized as "Documentation"
     - Other PRs are placed in an "Other Changes" category

This webhook-based approach allows for automatic release notes generation without manual intervention, ensuring consistent and comprehensive documentation of changes.

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
