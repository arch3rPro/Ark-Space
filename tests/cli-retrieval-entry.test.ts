import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config/schema.js";

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("built retrieval entry points", () => {
  it("invokes web.related through the built binary", async () => {
    const harness = await createHarness("exa", () => ({
      requestId: "related-entry",
      results: [{ title: "Related", url: "https://related.example", text: "related content" }],
    }));
    const input = await harness.writeRequest("related.json", {
      protocolVersion: 1,
      capability: "web.related",
      input: { url: "https://example.com/reference" },
    });

    const result = await runCli(["invoke", "web.related", "--input", input], {
      ARKSPACE_HOME: harness.home,
      EXA_API_KEY: "related-entry-secret",
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      capability: "web.related",
      provider: "exa",
      data: { results: [{ url: "https://related.example" }] },
    });
    expect(result.stdout).not.toContain("related-entry-secret");
  });

  it("invokes code.context through the built binary", async () => {
    const harness = await createHarness("exa", () => ({
      requestId: "context-entry",
      query: "SDK usage",
      response: "Use the current SDK. Source: https://docs.example.com/sdk",
      resultsCount: 1,
      outputTokens: 300,
    }));
    const input = await harness.writeRequest("context.json", {
      protocolVersion: 1,
      capability: "code.context",
      input: { query: "SDK usage" },
    });

    const result = await runCli(["invoke", "code.context", "--input", input], {
      ARKSPACE_HOME: harness.home,
      EXA_API_KEY: "context-entry-secret",
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      capability: "code.context",
      provider: "exa",
      data: { requestId: "context-entry", resultsCount: 1 },
    });
    expect(result.stdout).not.toContain("context-entry-secret");
  });

  it("invokes schema-validated web.extract through the built binary", async () => {
    const harness = await createHarness("firecrawl", (request) =>
      request.method === "POST"
        ? { success: true, id: "extract-entry-job", invalidURLs: [] }
        : { success: true, status: "completed", data: { plans: [{ name: "Starter" }] } },
    );
    const input = await harness.writeRequest("extract.json", {
      protocolVersion: 1,
      capability: "web.extract",
      input: {
        urls: ["https://example.com/pricing"],
        prompt: "Extract plans",
        schema: {
          type: "object",
          properties: {
            plans: {
              type: "array",
              items: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
          required: ["plans"],
        },
      },
    });

    const result = await runCli(["invoke", "web.extract", "--input", input], {
      ARKSPACE_HOME: harness.home,
      FIRECRAWL_API_KEY: "extract-entry-secret",
    });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      capability: "web.extract",
      provider: "firecrawl",
      data: { jobId: "extract-entry-job", data: { plans: [{ name: "Starter" }] } },
    });
    expect(result.stdout).not.toContain("extract-entry-secret");
  });
});

async function createHarness(
  provider: "exa" | "firecrawl",
  responseFor: (request: IncomingMessage) => unknown,
): Promise<{ home: string; writeRequest(name: string, value: unknown): Promise<string> }> {
  const home = await mkdtemp(join(tmpdir(), "arkspace-retrieval-entry-"));
  directories.push(home);
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(responseFor(request)));
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");

  const config = defaultConfig();
  config.providerOrder = [provider];
  config.providers[provider]!.baseUrl = `http://127.0.0.1:${address.port}`;
  await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
  return {
    home,
    async writeRequest(name, value) {
      const path = join(home, name);
      await writeFile(path, JSON.stringify(value));
      return path;
    },
  };
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
