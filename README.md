# Copilot SDK Service

A starter template for building AI-powered API services with the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) deployed to [Azure Container Apps](https://learn.microsoft.com/azure/container-apps/).

## Overview

Copilot SDK Service is a full-stack TypeScript application that demonstrates how to build **AI-powered apps** using the GitHub Copilot SDK. It includes a chat endpoint with SSE streaming and a one-shot summarize endpoint, with a React chat UI for testing.

- **Backend** (`src/api/`) — Express server with chat (SSE streaming) and summarize (one-shot) endpoints via `@github/copilot-sdk`.
- **Frontend** (`src/web/`) — React + Vite chat UI with SSE streaming, dark/light mode, and Markdown rendering.

## Features

- **Chat + summarize endpoints** — SSE streaming chat via `/chat` and one-shot summarize via `/summarize`
- **Three model paths** — GitHub default, GitHub specific model, or Azure BYOM with `DefaultAzureCredential`
- **React test UI** — Modern chat-style interface with dark/light mode and Markdown/code rendering
- **One-command local dev** — Run all services with `azd app run` via [`azd app`](https://github.com/jongio/azd-app)
- **One-command Azure deployment** — Deploy to Azure Container Apps with `azd up`
- **Docker-based containerization** — Multi-stage Dockerfiles for optimized production builds
- **Automatic GitHub token provisioning** — Preprovision hook retrieves your token via `gh` CLI

## How It Works (Copilot SDK)

This template supports three model paths:

### GitHub Default (no config)
```typescript
const session = await client.createSession({});
const result = await session.sendAndWait({ prompt: "Hello" });
```

### GitHub Specific Model
```typescript
const session = await client.createSession({ model: "gpt-4o" });
```

### Azure BYOM (Bring Your Own Model)
```typescript
import { DefaultAzureCredential } from "@azure/identity";
const credential = new DefaultAzureCredential();
const { token } = await credential.getToken("https://cognitiveservices.azure.com/.default");

const session = await client.createSession({
  model: process.env.MODEL_NAME,
  provider: {
    type: "azure",
    baseUrl: process.env.AZURE_OPENAI_ENDPOINT,
    bearerToken: token,
  },
});
```

Configure via environment variables: `MODEL_PROVIDER`, `MODEL_NAME`, `AZURE_OPENAI_ENDPOINT`. See `src/api/model-config.ts`.

### Testing Each Model Path

All three paths can be tested locally. Set the environment variables before running the service.

You can run with either [`azd app run`](https://github.com/jongio/azd-app) (starts both API and web UI) or `pnpm dev` (API only):

**1. GitHub Default (no config needed)**

No environment variables required — the SDK picks its default model:

```bash
# Option A: azd app run (recommended — starts API + web UI, auto-installs deps)
azd app run

# Option B: manual
export GITHUB_TOKEN=$(gh auth token)
cd src/api && pnpm dev
```

**2. GitHub Specific Model**

Set `MODEL_NAME` to choose a specific GitHub-hosted model:

```bash
# Option A: azd app run
azd env set MODEL_NAME gpt-4o
azd app run

# Option B: manual
export GITHUB_TOKEN=$(gh auth token)
export MODEL_NAME=gpt-4o
cd src/api && pnpm dev
```

**3. Azure BYOM (Bring Your Own Model)**

Set `MODEL_PROVIDER=azure` along with your Azure OpenAI endpoint and deployment name. Authentication uses `DefaultAzureCredential`, so make sure you're logged in with `az login`:

```bash
# Option A: azd app run
az login
azd env set MODEL_PROVIDER azure
azd env set MODEL_NAME <your-deployment-name>
azd env set AZURE_OPENAI_ENDPOINT https://<your-resource>.openai.azure.com
azd app run

# Option B: manual
export GITHUB_TOKEN=$(gh auth token)
export MODEL_PROVIDER=azure
export MODEL_NAME=<your-deployment-name>
export AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
az login
cd src/api && pnpm dev
```

**Verify any path with:**

```bash
curl -X POST http://localhost:3100/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [pnpm](https://pnpm.io/) | 10+ | Fast, disk-efficient package manager |
| [Node.js](https://nodejs.org/) | 24+ | Runtime for the API and build tooling |
| [GitHub CLI (`gh`)](https://cli.github.com/) | Latest | Provides the `GITHUB_TOKEN` for the Copilot SDK |
| [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) | Latest | Provisions and deploys Azure resources |
| [Docker](https://docs.docker.com/get-docker/) | Latest | *(Optional)* Local container testing |

**GitHub CLI setup:**

```bash
gh auth login
gh auth refresh --scopes copilot
```

## Quick Start

### 1. Install [Azure Developer CLI (`azd`)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)

### 2. Install the [`azd app`](https://github.com/jongio/azd-app) extension

```bash
azd extension source add -n jongio -t url -l https://jongio.github.io/azd-extensions/registry.json
azd extension install jongio.azd.app
```

### 3. Init and run

```bash
azd init -t azure-samples/copilot-sdk-service
azd app run
```

The `prerun` hook automatically retrieves your `GITHUB_TOKEN` from the `gh` CLI via `scripts/get-github-token.mjs` (the same script also runs as a `preprovision` hook during `azd up`). `azd app` installs dependencies, starts both services, and provides a real-time dashboard. Open the URL shown in the dashboard output to start testing.

<details>
<summary><b>Run services manually (without azd app)</b></summary>

```bash
# Set your GitHub token
export GITHUB_TOKEN=$(gh auth token)

# Install dependencies
cd src/api && pnpm install && cd ../web && pnpm install && cd ../..

# Start the API server (in one terminal)
cd src/api && pnpm dev

# Start the web dev server (in another terminal)
cd src/web && pnpm dev
```

</details>

## Project Structure

```
copilot-sdk-service/
├── src/
│   ├── api/                    # Express backend
│   │   ├── index.ts            # App entry point — Express setup, CORS, route registration
│   │   ├── model-config.ts    # Three-path model configuration (GitHub default/specific, Azure BYOM)
│   │   ├── routes/
│   │   │   ├── summarize.ts    # POST /summarize — Copilot SDK one-shot AI processing
│   │   │   ├── chat.ts         # POST /chat — multi-turn chat with SSE streaming
│   │   │   └── health.ts       # GET /health — Health check endpoint
│   │   ├── Dockerfile          # API container (Node.js + pnpm, non-root user)
│   │   ├── package.json        # API dependencies
│   │   └── tsconfig.json       # TypeScript config (server)
│   └── web/                    # React frontend
│       ├── App.tsx             # Root component
│       ├── App.css             # App styles with dark/light mode
│       ├── main.tsx            # React entry point
│       ├── index.html          # HTML shell
│       ├── index.css           # Global styles & CSS custom properties
│       ├── types.ts            # Shared TypeScript types
│       ├── components/
│       │   ├── ChatWindow.tsx  # Message display with Markdown rendering
│       │   ├── MessageInput.tsx# Input field with submit handling
│       │   └── ThemeToggle.tsx # Dark/light mode toggle
│       ├── hooks/
│       │   ├── useService.ts   # Service request state management
│       │   └── useTheme.ts     # Theme preference with localStorage
│       ├── nginx.conf.template # Nginx config — reverse proxy to API
│       ├── Dockerfile          # Web container (Vite build + nginx)
│       ├── package.json        # Web dependencies
│       └── vite.config.ts      # Vite configuration
├── infra/                      # Azure infrastructure (Bicep)
│   ├── main.bicep              # Subscription-scoped deployment
│   ├── main.parameters.json    # Parameter mappings for azd
│   └── resources.bicep         # All Azure resources (ACR, Container Apps, Key Vault, etc.)
├── scripts/                    # Automation scripts
│   └── get-github-token.mjs    # Hook: injects GITHUB_TOKEN from gh CLI (runs on prerun and preprovision)
├── azure.yaml                  # Azure Developer CLI service definition
└── README.md
```

## Adding Endpoints

Endpoints are Express routes that use the Copilot SDK for one-shot AI processing. To add a new endpoint:

**1. Create a route file in `src/api/routes/`:**

```typescript
// src/api/routes/classify.ts
import { Router } from "express";
import { CopilotClient } from "@github/copilot-sdk";

const router = Router();

router.post("/classify", async (req, res) => {
  const client = new CopilotClient({ githubToken: process.env.GITHUB_TOKEN });
  const { getSessionOptions } = await import("../model-config.js");
  const options = await getSessionOptions();
  const session = await client.createSession(options);
  const result = await session.sendAndWait({
    prompt: `Classify the following text into a category:\n\n${req.body.text}`,
  });
  res.json({ category: result?.data?.content });
});

export default router;
```

**2. Register the route in `src/api/index.ts`:**

```typescript
import classifyRoutes from "./routes/classify.js";

app.use(classifyRoutes);
```

**3. Add a proxy rule in `src/web/nginx.conf.template`** (for production):

```nginx
location /classify {
    proxy_pass ${API_URL}/classify;
    proxy_http_version 1.1;
    proxy_set_header Host $proxy_host;
}
```

## Deploy to Azure

```bash
azd up
```

This single command handles the entire deployment pipeline:

1. **Preprovision hook** — Retrieves your `GITHUB_TOKEN` from the `gh` CLI and stores it in the `azd` environment
2. **Provisions infrastructure** — Creates Azure Container Registry, Container Apps Environment, Key Vault, Application Insights, and a managed identity (using [Azure Verified Modules](https://azure.github.io/Azure-Verified-Modules/))
3. **Builds and pushes** — Builds the Docker images and pushes them to the provisioned ACR
4. **Deploys** — Deploys both containers to Azure Container Apps with the `GITHUB_TOKEN` securely referenced from Key Vault

To initialize from the template without cloning:

```bash
azd init --template azure-samples/copilot-sdk-service
azd up
```

## Development

The easiest way to run locally is with [`azd app`](https://github.com/jongio/azd-app), which starts all services, installs dependencies, and provides a real-time dashboard:

```bash
azd app run
```

You can also run services individually:

| Command | Directory | Description |
|---------|-----------|-------------|
| `azd app run` | repo root | Start all services with auto-dependency install and dashboard |
| `pnpm dev` | `src/api` | Start the Express server with hot reload (via `tsx --watch`) |
| `pnpm dev` | `src/web` | Start the Vite dev server with HMR for the React frontend |
| `pnpm build` | `src/api` | Compile the Express server |
| `pnpm build` | `src/web` | Bundle the React frontend |

## Architecture

```mermaid
graph LR
    User -->|message| ReactUI["React UI<br/>(Vite SPA)"]
    ReactUI -->|POST /chat| API["Express API"]
    API --> SDK["Copilot SDK"]
    SDK --> Models["GitHub Models<br/>or Azure BYOM"]
    Models -->|response| SDK
    SDK -->|SSE stream| API
```

**Azure deployment topology:**

```mermaid
graph TB
    Internet -->|HTTPS| Web["Web App<br/>(nginx + React SPA)"]

    subgraph Azure Resource Group
        subgraph Container Apps Environment
            Web
            API["API App<br/>(Express + Copilot SDK)"]
        end
        ACR["Container Registry<br/>(ACR)"]
        KV["Azure Key Vault<br/>(GITHUB_TOKEN)"]
        MI["Managed Identity"]
        AI["App Insights"]
    end

    Web -->|reverse proxy| API
    API -->|pulls images| ACR
    Web -->|pulls images| ACR
    API -->|reads secrets| KV
    MI -->|authenticates| API
    MI -->|authenticates| Web
    API -->|sends telemetry| AI
```

The Web container app is **external** (internet-facing) and serves the React SPA via nginx, which reverse-proxies API requests to the internal API container app. The API container app is **internal** (no public endpoint) and communicates with the GitHub Copilot service using a `GITHUB_TOKEN` stored securely in Azure Key Vault.

## License

MIT
