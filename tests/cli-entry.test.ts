import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config/schema.js";

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolveClose) => server.close(() => resolveClose()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("built arks entry point", () => {
  it("initializes configuration without requesting secrets from non-interactive input", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-setup-cli-"));
    directories.push(home);

    const result = await runCli(["setup"], { ARKSPACE_HOME: home });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("API keys were not requested");
    expect(JSON.parse(await readFile(join(home, "config.json"), "utf8"))).toMatchObject({ version: 1 });
    await expect(readFile(join(home, "credentials.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("loads setup credentials without exposing them in doctor output", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-doctor-cli-"));
    directories.push(home);
    await writeFile(join(home, "config.json"), `${JSON.stringify(defaultConfig())}\n`, { mode: 0o600 });
    await writeFile(
      join(home, "credentials.json"),
      `${JSON.stringify({ version: 1, values: { TAVILY_API_KEY: "stored-doctor-secret" } })}\n`,
      { mode: 0o600 },
    );

    const result = await runCli(["doctor", "--json"], { ARKSPACE_HOME: home });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "provider:tavily", ok: true }),
      ]),
    });
    expect(result.stdout).not.toContain("stored-doctor-secret");
    expect(result.stderr).toBe("");
  });

  it("invokes web.search through the built binary and versioned JSON file", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-cli-"));
    directories.push(home);
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const payload = JSON.parse(body) as { query: string };
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            request_id: "local-request",
            results: [{ title: payload.query, url: "https://example.com", content: "from local provider" }],
          }),
        );
      });
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP server address");

    const config = defaultConfig();
    config.providerOrder = ["tavily"];
    config.providers.tavily!.baseUrl = `http://127.0.0.1:${address.port}`;
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
    const inputPath = join(home, "request.json");
    await writeFile(
      inputPath,
      JSON.stringify({ protocolVersion: 1, capability: "web.search", input: { query: "real entry path" } }),
    );

    const result = await runCli(["invoke", "web.search", "--input", inputPath], {
      ARKSPACE_HOME: home,
      TAVILY_API_KEY: "local-test-secret",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      protocolVersion: 1,
      ok: true,
      capability: "web.search",
      provider: "tavily",
      data: {
        requestId: "local-request",
        results: [{ title: "real entry path", url: "https://example.com", snippet: "from local provider" }],
      },
    });
    expect(result.stdout).not.toContain("local-test-secret");
  });

  it("invokes web.fetch through the built binary", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-fetch-cli-"));
    directories.push(home);
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          results: [{ url: "https://example.com/docs", raw_content: "# Fetched through the real entry" }],
          failed_results: [],
          request_id: "local-fetch-request",
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP server address");

    const config = defaultConfig();
    config.providerOrder = ["tavily"];
    config.providers.tavily!.baseUrl = `http://127.0.0.1:${address.port}`;
    await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
    const inputPath = join(home, "fetch-request.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        protocolVersion: 1,
        capability: "web.fetch",
        input: { urls: ["https://example.com/docs"] },
      }),
    );

    const result = await runCli(["invoke", "web.fetch", "--input", inputPath], {
      ARKSPACE_HOME: home,
      TAVILY_API_KEY: "local-fetch-secret",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      protocolVersion: 1,
      ok: true,
      capability: "web.fetch",
      provider: "tavily",
      data: {
        requestId: "local-fetch-request",
        results: [{ url: "https://example.com/docs", content: "# Fetched through the real entry" }],
      },
    });
    expect(result.stdout).not.toContain("local-fetch-secret");
  });

  it("invokes web.map through the built binary", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-map-cli-"));
    directories.push(home);
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          base_url: "https://docs.example.com",
          results: ["https://docs.example.com/start", "https://docs.example.com/api"],
          request_id: "local-map-request",
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP server address");

    const config = defaultConfig();
    config.providerOrder = ["tavily"];
    config.providers.tavily!.baseUrl = `http://127.0.0.1:${address.port}`;
    await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
    const inputPath = join(home, "map-request.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        protocolVersion: 1,
        capability: "web.map",
        input: { url: "https://docs.example.com" },
      }),
    );

    const result = await runCli(["invoke", "web.map", "--input", inputPath], {
      ARKSPACE_HOME: home,
      TAVILY_API_KEY: "local-map-secret",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      protocolVersion: 1,
      ok: true,
      capability: "web.map",
      provider: "tavily",
      data: {
        requestId: "local-map-request",
        links: [{ url: "https://docs.example.com/start" }, { url: "https://docs.example.com/api" }],
      },
    });
    expect(result.stdout).not.toContain("local-map-secret");
  });

  it("invokes web.crawl through the built binary", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-crawl-cli-"));
    directories.push(home);
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          base_url: "https://docs.example.com",
          results: [{ url: "https://docs.example.com/start", raw_content: "# Crawled through the real entry" }],
          request_id: "local-crawl-request",
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP server address");

    const config = defaultConfig();
    config.providerOrder = ["tavily"];
    config.providers.tavily!.baseUrl = `http://127.0.0.1:${address.port}`;
    await writeFile(join(home, "config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
    const inputPath = join(home, "crawl-request.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        protocolVersion: 1,
        capability: "web.crawl",
        input: { url: "https://docs.example.com", maxPages: 5 },
      }),
    );

    const result = await runCli(["invoke", "web.crawl", "--input", inputPath], {
      ARKSPACE_HOME: home,
      TAVILY_API_KEY: "local-crawl-secret",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      protocolVersion: 1,
      ok: true,
      capability: "web.crawl",
      provider: "tavily",
      data: {
        requestId: "local-crawl-request",
        pages: [{ url: "https://docs.example.com/start", content: "# Crawled through the real entry" }],
      },
    });
    expect(result.stdout).not.toContain("local-crawl-secret");
  });
});

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
