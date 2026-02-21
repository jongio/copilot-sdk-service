import { Router } from "express";
import { getClient } from "../client.js";
import { getSessionOptions, enhanceModelError } from "../model-config.js";

const router = Router();

/** Wait for the session to become idle, with a configurable timeout. */
function waitForIdle(session: { on(event: string, cb: (e: unknown) => void): () => void }, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for response`));
    }, timeoutMs);

    const unsub = session.on("session.idle", () => {
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
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

  const prompt = Array.isArray(history) && history.length > 0
    ? [...history.map((h: { role: string; content: string }) => `${h.role}: ${h.content}`), `user: ${message}`].join("\n")
    : message;

  try {
    const copilot = await getClient();
    const options = await getSessionOptions({ streaming: true });
    const session = await copilot.createSession(options);

    const unsubDelta = session.on("assistant.message_delta", (event: { data?: { deltaContent?: string } }) => {
      const delta = event.data?.deltaContent ?? "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    });

    await session.send({ prompt });
    await waitForIdle(session);

    unsubDelta();
    await session.destroy();

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    const enhanced = enhanceModelError(err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: enhanced.message })}\n\n`);
    res.end();
  }
});

export default router;
