# Scripts

Utility scripts for the Copilot SDK Service.

## `test-models.mts`

Integration test script that verifies all 3 model configuration paths work correctly across both API endpoints (`/chat` and `/summarize`).

### Test Configurations

1. **GitHub Default** - Uses SDK's default model selection
   - No `MODEL_PROVIDER` or `MODEL_NAME` set
   - SDK automatically picks the default GitHub model

2. **GitHub Specific** - Uses a specific GitHub model
   - `MODEL_NAME=gpt-4o`
   - No `MODEL_PROVIDER` set

3. **Azure BYOM** - Bring Your Own Model using Azure OpenAI
   - `MODEL_PROVIDER=azure`
   - `MODEL_NAME=<deployment-name>`
   - `AZURE_OPENAI_ENDPOINT=<endpoint-url>`
   - Uses `DefaultAzureCredential` for authentication

### Prerequisites

**Required for all tests:**
- `GITHUB_TOKEN` - GitHub personal access token with Copilot access

**Required for Azure BYOM tests:**
- `AZURE_MODEL_NAME` - Azure OpenAI deployment name
- `AZURE_OPENAI_ENDPOINT` - Azure OpenAI endpoint URL
- Azure authentication configured (via `az login` or environment variables)

### Usage

From the repository root:
```bash
npx tsx scripts/test-models.mts
```

Or from the `src/api` directory:
```bash
pnpm test:models
```

### Environment Setup

#### GitHub Token
```bash
export GITHUB_TOKEN=<your-github-token>
```

#### Azure BYOM - Option A (using azd)
```bash
azd up
export AZURE_MODEL_NAME=$(azd env get-value AZURE_MODEL_NAME)
export AZURE_OPENAI_ENDPOINT=$(azd env get-value AZURE_OPENAI_ENDPOINT)
```

#### Azure BYOM - Option B (existing resource)
```bash
export AZURE_MODEL_NAME=<your-deployment-name>
export AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
az login
```

### Output

The script runs tests for each configuration and outputs a summary table:

```
┌─────────────────────┬──────────┬─────────────┐
│ Model Path          │ /chat    │ /summarize   │
├─────────────────────┼──────────┼─────────────┤
│ GitHub Default      │ ✅ PASS  │ ✅ PASS      │
│ GitHub Specific     │ ✅ PASS  │ ✅ PASS      │
│ Azure BYOM          │ ✅ PASS  │ ✅ PASS      │
└─────────────────────┴──────────┴─────────────┘
```

Exit code: `0` if all tests pass, `1` if any fail.

### Verify Deployed App

After deploying with `azd up` or `azd deploy`, verify the live Azure endpoints:

```bash
export AZURE_CONTAINER_APP_WEB_URL=$(azd env get-value AZURE_CONTAINER_APP_WEB_URL)
npx tsx scripts/test-models.mts --deployed
```

This hits the deployed `/health`, `/chat`, and `/summarize` endpoints and reports pass/fail.

### Debugging

Set `DEBUG=1` to see server output:
```bash
DEBUG=1 npx tsx scripts/test-models.mts
```

## `get-github-token.mjs`

Helper script to obtain a GitHub token (implementation details vary by environment).
