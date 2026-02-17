import { Router } from "express";
import { CopilotClient } from "@github/copilot-sdk";
import { DefaultAzureCredential } from "@azure/identity";

const router = Router();

const credential = new DefaultAzureCredential();

/** Get a bearer token for Azure OpenAI / Foundry endpoints */
async function getAzureToken(): Promise<string> {
  const tokenResponse = await credential.getToken(
    "https://cognitiveservices.azure.com/.default"
  );
  return tokenResponse.token;
}

let client: CopilotClient | null = null;

async function getClient(): Promise<CopilotClient> {
  if (!client) {
    client = new CopilotClient({
      githubToken: process.env.GITHUB_TOKEN,
    });
  }
  return client;
}

router.post("/summarize", async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text) {
    res.status(400).json({ error: "Missing 'text' field" });
    return;
  }

  try {
    const copilot = await getClient();

    const model = process.env.AZURE_DEPLOYMENT_NAME ?? "gpt-4o";

    const sessionConfig: Record<string, unknown> = {
      model,
    };

    // If Foundry endpoint is configured, use BYOM with managed identity
    const endpoint = process.env.AZURE_AI_FOUNDRY_PROJECT_ENDPOINT;
    if (endpoint) {
      const bearerToken = await getAzureToken();
      sessionConfig.provider = {
        type: "openai",
        baseUrl: `${endpoint.replace(/\/$/, "")}/openai/v1/`,
        wireApi: "responses",
        bearerToken,
      };
    }

    const session = await copilot.createSession(sessionConfig);

    const result = await session.sendAndWait({
      prompt: `Summarize the following text in 2-3 concise sentences:\n\n${text}`,
    });

    res.json({ summary: result?.data?.content ?? "" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  }
});

export default router;