import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config/schema.js";

const directories: string[] = [];
const servers: Server[] = [];

const completedRun = {
  id: "agent_run_cli",
  object: "agent_run",
  status: "completed",
  stopReason: "schema_satisfied",
  createdAt: "2026-09-09T00:00:00Z",
  completedAt: "2026-09-09T00:00:02Z",
  output: {
    text: "Official documentation defines the lifecycle [1].",
    structured: null,
    grounding: [
      {
        field: "output.text",
        citations: [{ url: "https://docs.example.com/research", title: "Research API" }],
        confidence: "high",
      },
    ],
  },
  usage: { agentComputeUnits: 1, searches: 2, emails: 0, phoneNumbers: 0 },
  costDollars: { total: 0.05 },
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("built Research entry points", () => {
  it("runs a human-readable cited report", async () => {
    const harness = await createHarness();
    const result = await runCli(
      ["research", "run", "Compare API lifecycles", "--provider", "exa", "--depth", "concise", "--timeout-ms", "10000"],
      { ARKSPACE_HOME: harness.home, EXA_API_KEY: "research-entry-secret" },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Provider: exa");
    expect(result.stdout).toContain("Official documentation defines the lifecycle");
    expect(result.stdout).toContain("Research API: https://docs.example.com/research");
    expect(result.stdout).not.toContain("research-entry-secret");
  });

  it.skipIf(process.platform === "win32")("awaits Exa cancellation after an interrupt", async () => {
    const harness = await createInterruptHarness();
    const child = spawn(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "research",
        "run",
        "Compare API lifecycles",
        "--provider",
        "exa",
        "--timeout-ms",
        "10000",
        "--json",
      ],
      {
        env: { ...process.env, ARKSPACE_HOME: harness.home, EXA_API_KEY: "interrupt-secret" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    await harness.submitted;
    await new Promise((done) => setTimeout(done, 20));
    child.kill("SIGINT");
    const code = await new Promise<number | null>((done, reject) => {
      child.once("error", reject);
      child.once("close", done);
    });

    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      capability: "research.run",
      attempts: [
        {
          cleanup: { resource: "research-job", jobId: "agent_run_interrupt", ok: true },
          remoteJob: { state: "cancelled" },
        },
      ],
    });
    expect(stdout + stderr).not.toContain("interrupt-secret");
  });

  it("invokes research.run through a versioned request", async () => {
    const harness = await createHarness();
    const requestPath = join(harness.home, "research.json");
    await writeFile(
      requestPath,
      JSON.stringify({
        protocolVersion: 1,
        capability: "research.run",
        input: { prompt: "Compare API lifecycles", depth: "standard", timeoutMs: 10_000 },
      }),
    );

    const result = await runCli(["invoke", "research.run", "--input", requestPath], {
      ARKSPACE_HOME: harness.home,
      EXA_API_KEY: "research-invoke-secret",
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      protocolVersion: 1,
      ok: true,
      capability: "research.run",
      provider: "exa",
      data: {
        jobId: "agent_run_cli",
        status: "completed",
        sources: [{ url: "https://docs.example.com/research" }],
      },
    });
    expect(result.stdout).not.toContain("research-invoke-secret");
  });
});

async function createHarness(): Promise<{ home: string }> {
  const home = await mkdtemp(join(tmpdir(), "arkspace-research-entry-"));
  directories.push(home);
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(completedRun));
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");

  const config = defaultConfig();
  config.providerOrder = ["exa"];
  config.providers.exa!.baseUrl = `http://127.0.0.1:${address.port}`;
  await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
  return { home };
}

async function createInterruptHarness(): Promise<{ home: string; submitted: Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "arkspace-research-interrupt-"));
  directories.push(home);
  let markSubmitted: (() => void) | undefined;
  const submitted = new Promise<void>((done) => {
    markSubmitted = done;
  });
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.url?.endsWith("/cancel")) {
        response.end(
          JSON.stringify({
            ...completedRun,
            id: "agent_run_interrupt",
            status: "cancelled",
            stopReason: "cancelled",
            output: { text: "", structured: null, grounding: [] },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          ...completedRun,
          id: "agent_run_interrupt",
          status: "running",
          stopReason: null,
          completedAt: null,
          output: { text: "", structured: null, grounding: [] },
        }),
        () => markSubmitted?.(),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");
  const config = defaultConfig();
  config.providerOrder = ["exa"];
  config.providers.exa!.baseUrl = `http://127.0.0.1:${address.port}`;
  await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
  return { home, submitted };
}

function runCli(arguments_: string[], environment: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [resolve("dist/cli/main.js"), ...arguments_], {
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}
