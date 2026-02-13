# Copilot SDK Service

A starter template for building AI-powered API services with the [GitHub Copilot SDK](https://github.com/github/copilot-sdk), deployed to Azure Container Apps.

Unlike the [agent template](https://github.com/jongio/copilot-sdk-agent) (multi-turn chat + React UI), this template is for **one-shot AI endpoints** — summarize, classify, extract, rate — with no chat UI.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  src/api (Express + Copilot SDK)                │
│  - POST /summarize  → one-shot AI processing    │
│  - GET  /health     → health check              │
│  - Deployed as Azure Container App              │
└─────────────────────────────────────────────────┘
```

## Prerequisites

- [Azure Developer CLI (azd)](https://aka.ms/install-azd) v1.23.0+
- [GitHub CLI (gh)](https://cli.github.com/) — for Copilot SDK auth
- [Docker](https://www.docker.com/) — for container builds
- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/)

## Quick Start

```bash
# 1. Clone and init
azd init --template jongio/copilot-sdk-service

# 2. Auth
azd auth login
gh auth login && gh auth refresh --scopes copilot

# 3. Deploy (infra + build + deploy)
azd up
```

## Local Development

```bash
# Run with azd app run (recommended)
azd app run

# Or manually:
cd src/api && pnpm install && pnpm run dev

# Test
curl -s http://localhost:3000/health
curl -s -X POST http://localhost:3000/summarize \
  -H "Content-Type: application/json" \
  -d '{"text": "The quick brown fox jumps over the lazy dog."}'
```

## Adding Endpoints

Add new routes in `src/api/routes/`. Example pattern:

```typescript
import { Router } from "express";
import { CopilotClient } from "@github/copilot-sdk";

const router = Router();

router.post("/classify", async (req, res) => {
  const client = new CopilotClient({ githubToken: process.env.GITHUB_TOKEN });
  const session = await client.createSession({ model: "gpt-4o" });
  const result = await session.sendAndWait({
    prompt: `Classify: ${req.body.text}`,
  });
  res.json({ category: result?.data?.content });
});

export default router;
```

Register in `index.ts`: `app.use(classifyRoutes);`

## License

MIT
