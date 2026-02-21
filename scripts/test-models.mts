#!/usr/bin/env node
/**
 * Integration test script for Copilot SDK Service model configurations
 * Tests all 3 model paths (GitHub Default, GitHub Specific, Azure BYOM)
 * across both /chat and /summarize endpoints.
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const API_DIR = join(REPO_ROOT, "src", "api");

// Test configuration
const HEALTH_TIMEOUT_MS = 15000;
const API_TIMEOUT_MS = 90000;
const HEALTH_POLL_INTERVAL_MS = 500;

interface TestResult {
  chat: boolean;
  summarize: boolean;
  error?: string;
}

interface ModelConfig {
  name: string;
  port: number;
  env: Record<string, string | undefined>;
}

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(message: string, color?: keyof typeof colors): void {
  const c = color ? colors[color] : "";
  console.log(`${c}${message}${color ? colors.reset : ""}`);
}

function getCleanEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  // Start with parent env, then override model-specific vars
  const cleanEnv: Record<string, string> = {};

  // Copy all parent env vars (needed for PATH, SystemRoot, APPDATA, etc.)
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  // Clear model-specific vars to avoid inheriting from parent
  delete cleanEnv.MODEL_PROVIDER;
  delete cleanEnv.MODEL_NAME;
  delete cleanEnv.AZURE_OPENAI_ENDPOINT;

  cleanEnv.NODE_ENV = "test";

  // Apply overrides, filtering out undefined values
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  return cleanEnv;
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  const url = `http://localhost:${port}/health`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const data = (await response.json()) as { status: string };
        if (data.status === "ok") {
          return true;
        }
      }
    } catch {
      // Ignore errors and keep retrying
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

async function testChatEndpoint(port: number): Promise<boolean> {
  const url = `http://localhost:${port}/chat`;
  const body = JSON.stringify({ message: "Say hello in one word" });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      log(`  ❌ /chat returned ${response.status}`, "red");
      return false;
    }

    if (!response.body) {
      log("  ❌ /chat response has no body", "red");
      return false;
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasContent = false;
    let hasDone = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            hasDone = true;
          } else {
            try {
              const parsed = JSON.parse(data) as { content?: string };
              if (parsed.content) {
                hasContent = true;
              }
            } catch {
              // Ignore parse errors for malformed chunks
            }
          }
        }
      }
    }

    if (!hasContent) {
      log("  ❌ /chat stream had no content events", "red");
      return false;
    }
    if (!hasDone) {
      log("  ❌ /chat stream missing [DONE] event", "red");
      return false;
    }

    log("  ✅ /chat passed", "green");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`  ❌ /chat failed: ${message}`, "red");
    return false;
  }
}

async function testSummarizeEndpoint(port: number, retries = 4): Promise<boolean> {
  const url = `http://localhost:${port}/summarize`;
  const body = JSON.stringify({
    text: "The quick brown fox jumps over the lazy dog. It was a sunny day in the park. Children were playing and birds were singing.",
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      log(`  ⏳ Retrying /summarize (attempt ${attempt + 1})...`, "yellow");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as { error?: string };
        log(`  ❌ /summarize returned ${response.status}: ${errorBody.error || "unknown error"}`, "red");
        if (attempt === retries) return false;
        continue;
      }

      const data = (await response.json()) as { summary?: string };
      if (!data.summary || data.summary.trim().length === 0) {
        if (attempt === retries) {
          log("  ❌ /summarize returned empty summary", "red");
          return false;
        }
        continue;
      }

      log("  ✅ /summarize passed", "green");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === retries) {
        log(`  ❌ /summarize failed: ${message}`, "red");
        return false;
      }
    }
  }
  return false;
}

function spawnServer(config: ModelConfig): ChildProcess {
  const env = getCleanEnv({
    PORT: config.port.toString(),
    ...config.env,
  });

  const child = spawn("node", ["--import", "tsx", "index.ts"], {
    cwd: API_DIR,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

  // Always consume stdout/stderr to prevent pipe buffer pressure on Windows.
  // When the pipe buffer fills (~64KB), the child process blocks on writes.
  const debug = process.env.DEBUG === "1";
  child.stdout?.on("data", (data) => {
    if (debug) log(`[${config.name}:stdout] ${data.toString().trim()}`, "dim");
  });
  child.stderr?.on("data", (data) => {
    if (debug) log(`[${config.name}:stderr] ${data.toString().trim()}`, "dim");
  });

  return child;
}

function killServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed || child.exitCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

async function testModelConfig(config: ModelConfig): Promise<TestResult> {
  log(`\n🧪 Testing: ${config.name}`, "cyan");
  log(`   Port: ${config.port}`, "dim");

  const result: TestResult = { chat: false, summarize: false };
  let server: ChildProcess | null = null;

  try {
    // Spawn server
    server = spawnServer(config);

    // Wait for health
    log("   Waiting for server to be healthy...", "dim");
    const healthy = await waitForHealth(config.port, HEALTH_TIMEOUT_MS);
    if (!healthy) {
      result.error = "Server failed to become healthy";
      log(`  ❌ ${result.error}`, "red");
      return result;
    }
    log("   ✓ Server is healthy", "dim");

    // Test endpoints
    result.chat = await testChatEndpoint(config.port);
    // Brief pause between tests to let the copilot CLI subprocess reset
    await new Promise((resolve) => setTimeout(resolve, 1000));
    result.summarize = await testSummarizeEndpoint(config.port);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Unexpected error: ${message}`;
    log(`  ❌ ${result.error}`, "red");
  } finally {
    if (server) {
      await killServer(server);
    }
  }

  return result;
}

/** Check that a CLI tool is installed and authenticated. */
function checkCli(
  name: string,
  versionCmd: string,
  authCheckCmd: string,
  loginHint: string,
): boolean {
  // Installed?
  try {
    execSync(versionCmd, { stdio: "ignore" });
  } catch {
    log(`\n❌ ${name} is not installed.`, "red");
    log(`   Install it from: https://cli.github.com (gh), https://aka.ms/azure-cli (az), https://aka.ms/azd (azd)`, "yellow");
    return false;
  }

  // Authenticated?
  try {
    execSync(authCheckCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    log(`\n❌ ${name} is not authenticated.`, "red");
    log(`   Run: ${loginHint}`, "yellow");
    return false;
  }

  log(`  ✓ ${name}`, "green");
  return true;
}

/**
 * Resolve GITHUB_TOKEN from the environment or via `gh auth token`.
 * Mirrors the logic in scripts/get-github-token.mjs.
 */
function resolveGitHubToken(): void {
  if (process.env.GITHUB_TOKEN) return;

  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (token) {
      process.env.GITHUB_TOKEN = token;
      log("  ✓ GITHUB_TOKEN resolved from gh CLI", "green");
    }
  } catch {
    // gh not installed or not authenticated — fall through
  }
}

// ── azd environment helpers ──────────────────────────────────────────

interface AzdEnv {
  Name: string;
  IsDefault: boolean;
}

function listAzdEnvs(): AzdEnv[] {
  try {
    const raw = execSync("azd env list --output json", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(raw) as AzdEnv[];
  } catch {
    return [];
  }
}

function getAzdEnvValue(envName: string, key: string): string | undefined {
  try {
    return execSync(`azd env get-value ${key} -e "${envName}"`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Run a command interactively with full stdio inheritance. */
function runInteractive(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: true,
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** Refresh outputs from the last Azure deployment into the azd environment. */
function refreshAzdEnv(envName: string): void {
  log("  ↻ Refreshing outputs from last deployment...", "dim");
  try {
    execSync(`azd env refresh -e "${envName}" --no-prompt`, {
      stdio: "ignore",
      timeout: 30_000,
    });
  } catch { /* refresh failed or timed out — best effort */ }
}

function loadAzdEnvVars(envName: string): void {
  log(`\nLoading Azure vars from azd environment: ${envName}`, "cyan");

  let endpoint = getAzdEnvValue(envName, "AZURE_OPENAI_ENDPOINT");
  let modelName = getAzdEnvValue(envName, "AZURE_MODEL_NAME");

  // If key values are missing, refresh outputs from the last deployment and retry
  if (!endpoint || !modelName) {
    refreshAzdEnv(envName);
    endpoint = endpoint || getAzdEnvValue(envName, "AZURE_OPENAI_ENDPOINT");
    modelName = modelName || getAzdEnvValue(envName, "AZURE_MODEL_NAME");
  }

  if (endpoint) {
    process.env.AZURE_OPENAI_ENDPOINT = endpoint;
    log(`  ✓ AZURE_OPENAI_ENDPOINT = ${endpoint}`, "green");
  }

  // The model deployment name defaults to 'gpt-4o' in the Bicep parameter.
  modelName = modelName || "gpt-4o";
  process.env.AZURE_MODEL_NAME = modelName;
  log(`  ✓ AZURE_MODEL_NAME = ${modelName}`, "green");
}

async function promptChoice(question: string, choices: string[]): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    log("");
    for (let i = 0; i < choices.length; i++) {
      log(`  ${i + 1}) ${choices[i]}`);
    }
    log("");
    const answer = await rl.question(question);
    const idx = parseInt(answer.trim(), 10) - 1;
    return idx >= 0 && idx < choices.length ? idx : -1;
  } finally {
    rl.close();
  }
}

/** Let the user pick an azd environment or run azd up. */
async function resolveAzureEnv(azdOk: boolean): Promise<void> {
  if (process.env.AZURE_MODEL_NAME && process.env.AZURE_OPENAI_ENDPOINT) return;
  if (!azdOk) return;

  let envs = listAzdEnvs();

  const choices: string[] = envs.map((e) => `${e.Name}${e.IsDefault ? " (default)" : ""}`);
  choices.push("Run azd up (provision and deploy)");
  choices.push("Skip Azure BYOM tests");

  log("\n⚠️  Azure BYOM environment variables are not configured.", "yellow");
  log("Select an azd environment to load them from:", "cyan");
  const idx = await promptChoice("Choice: ", choices);

  if (idx >= 0 && idx < envs.length) {
    // User picked an existing environment
    loadAzdEnvVars(envs[idx].Name);

    // If the endpoint still wasn't found, offer to run azd up or skip
    if (!process.env.AZURE_OPENAI_ENDPOINT) {
      log("\n  ⚠️  AZURE_OPENAI_ENDPOINT not found in this environment.", "yellow");
      log("  Azure OpenAI may not have been provisioned yet.", "yellow");

      const fallbackIdx = await promptChoice("What would you like to do? ", [
        "Run azd up (provision and deploy)",
        "Skip Azure BYOM tests",
      ]);

      if (fallbackIdx === 0) {
        await runAzdUp();
      }
    }
  } else if (idx === envs.length) {
    await runAzdUp();
  }
  // else: skip
}

async function runAzdUp(): Promise<void> {
  log("\nRunning azd up...\n", "cyan");
  const ok = await runInteractive("azd", ["up"]);
  if (!ok) {
    log("\n❌ azd up failed.", "red");
    return;
  }
  // Load vars from the default environment after deployment
  const envs = listAzdEnvs();
  if (envs.length > 0) {
    const defaultEnv = envs.find((e) => e.IsDefault) || envs[0];
    loadAzdEnvVars(defaultEnv.Name);
  }
}

// ── prerequisites ────────────────────────────────────────────────────

async function checkPrerequisites(): Promise<{ canRunGitHub: boolean; canRunAzure: boolean }> {
  log("\nChecking CLI prerequisites...", "cyan");

  const ghOk = checkCli("GitHub CLI (gh)", "gh --version", "gh auth status", "gh auth login");
  const azOk = checkCli("Azure CLI (az)", "az --version", "az account show", "az login");
  const azdOk = checkCli("Azure Developer CLI (azd)", "azd version", "azd auth login --check-status", "azd auth login");

  if (!ghOk || !azOk || !azdOk) {
    log("\n❌ Fix the issues above before running tests.", "red");
  }

  // Resolve GITHUB_TOKEN from gh CLI if not already set
  if (ghOk) {
    resolveGitHubToken();
  }

  let canRunGitHub = true;
  if (!process.env.GITHUB_TOKEN?.trim()) {
    log("\n❌ GITHUB_TOKEN could not be resolved.", "red");
    log("   Ensure gh is authenticated with the copilot scope: gh auth refresh --scopes copilot", "yellow");
    canRunGitHub = false;
  }

  // Resolve Azure BYOM vars — interactive prompt if needed
  await resolveAzureEnv(azdOk);

  const canRunAzure = !!(process.env.AZURE_MODEL_NAME && process.env.AZURE_OPENAI_ENDPOINT);

  return { canRunGitHub, canRunAzure };
}

function printSummary(results: Map<string, TestResult>): boolean {
  log("\n" + "=".repeat(60), "cyan");
  log("TEST RESULTS", "cyan");
  log("=".repeat(60), "cyan");

  const maxNameLen = Math.max(...Array.from(results.keys()).map((k) => k.length));
  const nameWidth = Math.max(maxNameLen + 2, 22);

  // Header
  const sep = "─";
  const corner1 = "┌";
  const corner2 = "┐";
  const corner3 = "└";
  const corner4 = "┘";
  const tee1 = "┬";
  const tee2 = "┼";
  const tee3 = "┴";
  const teeL = "├";
  const teeR = "┤";

  const chatWidth = 12;
  const summaryWidth = 14;

  log(
    `${corner1}${sep.repeat(nameWidth)}${tee1}${sep.repeat(chatWidth)}${tee1}${sep.repeat(summaryWidth)}${corner2}`
  );
  log(
    `│ ${"Model Path".padEnd(nameWidth - 2)} │ ${"/chat".padEnd(chatWidth - 2)} │ ${"/summarize".padEnd(summaryWidth - 2)} │`
  );
  log(
    `${teeL}${sep.repeat(nameWidth)}${tee2}${sep.repeat(chatWidth)}${tee2}${sep.repeat(summaryWidth)}${teeR}`
  );

  // Rows
  let allPassed = true;
  for (const [name, result] of results.entries()) {
    const chatStatus = result.chat ? "✅ PASS" : "❌ FAIL";
    const summaryStatus = result.summarize ? "✅ PASS" : "❌ FAIL";
    const chatColor = result.chat ? "green" : "red";
    const summaryColor = result.summarize ? "green" : "red";

    if (!result.chat || !result.summarize) {
      allPassed = false;
    }

    const namePadded = ` ${name.padEnd(nameWidth - 2)}`;
    const chatPadded = ` ${chatStatus.padEnd(chatWidth - 2)}`;
    const summaryPadded = ` ${summaryStatus.padEnd(summaryWidth - 2)}`;

    // Print with colors
    process.stdout.write(`│${namePadded} │ `);
    process.stdout.write(colors[chatColor] + chatStatus + colors.reset);
    process.stdout.write(" ".repeat(chatWidth - chatStatus.length - 1) + "│ ");
    process.stdout.write(colors[summaryColor] + summaryStatus + colors.reset);
    process.stdout.write(" ".repeat(summaryWidth - summaryStatus.length - 1) + "│\n");
  }

  log(
    `${corner3}${sep.repeat(nameWidth)}${tee3}${sep.repeat(chatWidth)}${tee3}${sep.repeat(summaryWidth)}${corner4}`
  );

  if (allPassed) {
    log("\n✅ All tests passed!", "green");
  } else {
    log("\n❌ Some tests failed.", "red");
  }

  return allPassed;
}

async function testDeployed(): Promise<void> {
  log("╔════════════════════════════════════════════════════════════╗", "cyan");
  log("║   Copilot SDK Service — Deployed App Verification         ║", "cyan");
  log("╚════════════════════════════════════════════════════════════╝", "cyan");

  // Get the web URL from azd env
  const webUrl = process.env.AZURE_CONTAINER_APP_WEB_URL;
  if (!webUrl) {
    log("\n❌ AZURE_CONTAINER_APP_WEB_URL is not set.", "red");
    log("   Set it from azd: export AZURE_CONTAINER_APP_WEB_URL=$(azd env get-value AZURE_CONTAINER_APP_WEB_URL)", "yellow");
    log("   Or run: azd env get-values", "yellow");
    process.exit(1);
  }

  const baseUrl = webUrl.replace(/\/$/, "");
  log(`\n🌐 Testing deployed app at: ${baseUrl}`, "cyan");

  const results = new Map<string, TestResult>();
  const result: TestResult = { chat: false, summarize: false };

  // Test health
  log("\n🧪 Health check...", "cyan");
  try {
    const healthRes = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10000) });
    if (healthRes.ok) {
      log("  ✅ /health passed", "green");
    } else {
      log(`  ❌ /health returned ${healthRes.status}`, "red");
      results.set("Deployed App", result);
      printSummary(results);
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  ❌ /health failed: ${msg}`, "red");
    results.set("Deployed App", result);
    printSummary(results);
    process.exit(1);
  }

  // Test /summarize
  log("\n🧪 Testing /summarize...", "cyan");
  try {
    const sumRes = await fetch(`${baseUrl}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "The quick brown fox jumps over the lazy dog. It was a sunny day." }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (sumRes.ok) {
      const data = (await sumRes.json()) as { summary?: string };
      if (data.summary && data.summary.trim().length > 0) {
        log("  ✅ /summarize passed", "green");
        result.summarize = true;
      } else {
        log("  ❌ /summarize returned empty summary", "red");
      }
    } else {
      const body = (await sumRes.json()) as { error?: string };
      log(`  ❌ /summarize returned ${sumRes.status}: ${body.error || "unknown"}`, "red");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  ❌ /summarize failed: ${msg}`, "red");
  }

  // Test /chat
  log("\n🧪 Testing /chat (SSE streaming)...", "cyan");
  try {
    const chatRes = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Say hello in one word" }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (chatRes.ok && chatRes.body) {
      const reader = chatRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hasContent = false;
      let hasDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") hasDone = true;
            else {
              try {
                const parsed = JSON.parse(data) as { content?: string };
                if (parsed.content) hasContent = true;
              } catch { /* ignore */ }
            }
          }
        }
      }
      if (hasContent && hasDone) {
        log("  ✅ /chat passed", "green");
        result.chat = true;
      } else {
        if (!hasContent) log("  ❌ /chat stream had no content events", "red");
        if (!hasDone) log("  ❌ /chat stream missing [DONE] event", "red");
      }
    } else {
      log(`  ❌ /chat returned ${chatRes.status}`, "red");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  ❌ /chat failed: ${msg}`, "red");
  }

  results.set("Deployed App", result);
  const allPassed = printSummary(results);
  process.exit(allPassed ? 0 : 1);
}

async function main(): Promise<void> {
  // Check for --deployed flag
  if (process.argv.includes("--deployed")) {
    return testDeployed();
  }

  log("╔════════════════════════════════════════════════════════════╗", "cyan");
  log("║     Copilot SDK Service Model Configuration Tests         ║", "cyan");
  log("╚════════════════════════════════════════════════════════════╝", "cyan");

  // Check prerequisites
  const { canRunGitHub, canRunAzure } = await checkPrerequisites();

  if (!canRunGitHub) {
    log("\n❌ Cannot run tests without GITHUB_TOKEN", "red");
    process.exit(1);
  }

  // Define test configurations
  const configs: ModelConfig[] = [
    {
      name: "GitHub Default",
      port: 9101,
      env: {
        MODEL_PROVIDER: undefined, // Explicitly unset
        MODEL_NAME: undefined, // Explicitly unset
        AZURE_OPENAI_ENDPOINT: undefined, // Explicitly unset
      },
    },
    {
      name: "GitHub Specific",
      port: 9102,
      env: {
        MODEL_PROVIDER: undefined, // Explicitly unset
        MODEL_NAME: "gpt-4o",
        AZURE_OPENAI_ENDPOINT: undefined, // Explicitly unset
      },
    },
  ];

  // Add Azure BYOM only if configured
  if (canRunAzure) {
    configs.push({
      name: "Azure BYOM",
      port: 9103,
      env: {
        MODEL_PROVIDER: "azure",
        MODEL_NAME: process.env.AZURE_MODEL_NAME,
        AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
      },
    });
  } else {
    // Still add it, but mark as failed
    configs.push({
      name: "Azure BYOM",
      port: 9103,
      env: {}, // Empty env will cause it to fail
    });
  }

  // Run tests
  const results = new Map<string, TestResult>();

  for (const config of configs) {
    if (config.name === "Azure BYOM" && !canRunAzure) {
      // Don't spawn server, just mark as failed
      log(`\n🧪 Testing: ${config.name}`, "cyan");
      log("  ⏭️  Skipping due to missing Azure configuration", "yellow");
      results.set(config.name, { chat: false, summarize: false, error: "Azure not configured" });
      continue;
    }

    const result = await testModelConfig(config);
    results.set(config.name, result);

    // Small delay between tests to avoid port conflicts
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Print summary
  const allPassed = printSummary(results);

  // Exit with appropriate code
  process.exit(allPassed ? 0 : 1);
}

// Run the tests
main().catch((err) => {
  log(`\n❌ Fatal error: ${err instanceof Error ? err.message : String(err)}`, "red");
  process.exit(1);
});
