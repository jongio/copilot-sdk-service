import type { CopilotClient } from "@github/copilot-sdk";

// Session options type — matches what createSession() accepts
export interface SessionOptions {
  model?: string;
  streaming?: boolean;
  provider?: {
    type: "azure" | "openai" | "anthropic";
    baseUrl: string;
    bearerToken: string;
    wireApi?: "completions" | "responses";
  };
}

// Cache the credential and token. Tokens are valid ~1 hour; refresh 5 min before expiry.
let cachedCredential: { getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number }> } | null = null;
let cachedToken: { token: string; expiresOn: number } | null = null;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

async function getAzureBearerToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresOn - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.token;
  }
  if (!cachedCredential) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    cachedCredential = new DefaultAzureCredential();
  }
  const result = await cachedCredential.getToken("https://cognitiveservices.azure.com/.default");
  cachedToken = { token: result.token, expiresOn: result.expiresOnTimestamp };
  return result.token;
}

export async function getSessionOptions(opts?: { streaming?: boolean }): Promise<SessionOptions> {
  const provider = process.env.MODEL_PROVIDER;
  const modelName = process.env.MODEL_NAME;
  const streaming = opts?.streaming ?? false;

  // Path 1: GitHub default — no model, no provider
  if (!provider && !modelName) {
    return { streaming };
  }

  // Path 2: GitHub specific — model only, no provider
  if (!provider && modelName) {
    return { model: modelName, streaming };
  }

  // Path 3: Azure BYOM — model + provider with DefaultAzureCredential
  // Token is fetched fresh per-request to avoid expiry issues
  if (provider === "azure") {
    if (!modelName) {
      throw new Error("MODEL_NAME is required when MODEL_PROVIDER is 'azure'");
    }
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) {
      throw new Error("AZURE_OPENAI_ENDPOINT is required when MODEL_PROVIDER is 'azure'");
    }

    const token = await getAzureBearerToken();

    return {
      model: modelName,
      streaming,
      provider: {
        type: "azure",
        baseUrl: endpoint,
        bearerToken: token,
      },
    };
  }

  // Unknown provider
  throw new Error(`Unknown MODEL_PROVIDER: '${provider}'. Use 'azure' or leave unset.`);
}
