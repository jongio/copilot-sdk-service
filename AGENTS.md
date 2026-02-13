# AGENTS.md

## Overview

Copilot SDK service template — single-service API deployed to Azure Container Apps.

- **`src/api/`** — Express API (TypeScript, Node 24). One-shot AI endpoints via `@github/copilot-sdk`. No chat UI.
- **`infra/`** — Azure infrastructure (Bicep). One container app + ACR + Key Vault + monitoring.

## Environment

- Node ≥ 24, pnpm for package management. **Always use `pnpm`, never `npm` or `yarn`.**
- `gh` CLI required for provisioning (provides `GITHUB_TOKEN` via `scripts/get-github-token.mjs`).

## Commands

| Task | Directory | Command |
|---|---|---|
| Run service | root | `azd app run` |
| Install deps | `src/api` | `pnpm install` |
| Build | `src/api` | `pnpm run build` |
| Dev | `src/api` | `pnpm run dev` |
| Deploy to Azure | root | `azd up` |

[`azd app run`](https://github.com/jongio/azd-app) is the recommended way to run locally.

## Coding Conventions

- ESM throughout (`"type": "module"`). Use `.js` extensions in imports.
- Routes go in `src/api/routes/`.
- File names: kebab-case for configs, camelCase for source files.

## Safety

- Never commit secrets. `GITHUB_TOKEN` is injected at deploy time via Key Vault.
- Dockerfile runs as non-root user (`app`).
