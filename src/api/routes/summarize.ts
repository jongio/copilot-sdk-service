import { Router } from "express";
import { CopilotClient } from "@github/copilot-sdk";
import { getSessionOptions } from "../model-config.js";

const router = Router();

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
  const { text } = req.body as { text?: unknown };
  if (text === undefined || text === null) {
    res.status(400).json({ error: "Missing 'text' field" });
    return;
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "'text' must be a non-empty string" });
    return;
  }
  if (text.length > 50000) {
    res.status(413).json({ error: "'text' exceeds maximum length of 50000 characters" });
    return;
  }

  try {
    const copilot = await getClient();
    const options = await getSessionOptions({ streaming: false });
    const session = await copilot.createSession(options);

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
