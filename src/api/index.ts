import express from "express";
import healthRoutes from "./routes/health.js";
import summarizeRoutes from "./routes/summarize.js";

const app = express();

app.use(express.json());
app.use(healthRoutes);
app.use(summarizeRoutes);

if (!process.env.GITHUB_TOKEN) {
  console.warn("⚠ GITHUB_TOKEN is not set. AI endpoints will not work.");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Copilot SDK service listening on port ${PORT}`);
});
