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

router.post("/chat", async (req, res) => {
  const { message, history } = req.body as {
    message?: unknown;
    history?: unknown;
  };

  if (message === undefined || message === null) {
    res.status(400).json({ error: "Missing 'message' field" });
    return;
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "'message' must be a non-empty string" });
    return;
  }
  if (history !== undefined && !Array.isArray(history)) {
    res.status(400).json({ error: "'history' must be an array" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const copilot = await getClient();
    const options = await getSessionOptions({ streaming: true });
    const session = await copilot.createSession(options);

    const prompt = Array.isArray(history) && history.length > 0
      ? [...history.map((h: { role: string; content: string }) => `${h.role}: ${h.content}`), `user: ${message}`].join("\n")
      : message;

    // Stream incremental deltas to the client via SSE
    const unsubscribe = session.on("assistant.message_delta", (event) => {
      const delta = event.data?.deltaContent ?? "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    });

    // send() returns when the message is queued; wait for session.idle via sendAndWait
    // but with streaming events dispatched above
    await session.sendAndWait({ prompt });

    unsubscribe();
    res.write(`data: [DONE]\n\n`);
    res.end();
    await session.destroy();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Internal server error";
    res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
  }
});

export default router;
