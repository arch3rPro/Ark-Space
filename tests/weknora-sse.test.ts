import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("skills/weknora/scripts/consume-sse.mjs");
const secret = "weknora-local-test-secret";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((closed) => server.close(() => closed()))));
});

function frame(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

interface Received {
  key: string | undefined;
  body: string;
  url: string;
}

async function startInstance(
  respond: (received: Received) => string | { status: number; body: string },
): Promise<string> {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      const outcome = respond({
        key: request.headers["x-api-key"] as string | undefined,
        body,
        url: request.url ?? "",
      });
      if (typeof outcome !== "string") {
        response.writeHead(outcome.status, { "content-type": "application/json" });
        response.end(outcome.body);
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      // Write one byte at a time so the consumer must reassemble frames across reads.
      let index = 0;
      const timer = setInterval(() => {
        if (index >= outcome.length) {
          clearInterval(timer);
          response.end();
          return;
        }
        response.write(outcome[index]);
        index += 1;
      }, 0);
      response.once("close", () => clearInterval(timer));
    });
  });
  servers.push(server);
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");
  return `http://127.0.0.1:${address.port}/api/v1`;
}

function runScript(
  arguments_: string[],
  environment: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolved, rejected) => {
    const child = spawn(process.execPath, [script, ...arguments_], {
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
    child.once("error", rejected);
    child.once("close", (code) => resolved({ code, stdout, stderr }));
  });
}

function envelope(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n");
  expect(lines, "stdout must carry exactly one machine-readable line").toHaveLength(1);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

describe("weknora Skill streamed chat entry point", () => {
  it("passes its own self-test through the documented entry path", async () => {
    const result = await runScript(["--self-test"], {});

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("all self-tests passed");
  });

  it("assembles a streamed answer and stops at the terminal event", async () => {
    const received: Received[] = [];
    const base = await startInstance((request) => {
      received.push(request);
      return [
        frame({ response_type: "thinking", content: "considering" }),
        frame({ response_type: "answer", content: "Refunds are " }),
        frame({ response_type: "answer", content: "issued within 30 days." }),
        frame({ response_type: "references", knowledge_references: [{ title: "Refund policy" }] }),
        frame({ response_type: "usage", usage: { total_tokens: 42 } }),
        frame({ response_type: "complete", done: true }),
        // A title frame can follow the terminal event; it must not be read.
        frame({ response_type: "session_title", content: "Refund window" }),
      ].join("");
    });

    const result = await runScript(["--session", "s-1", "--query", "How long do refunds take?"], {
      WEKNORA_BASE_URL: base,
      WEKNORA_API_KEY: secret,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain(secret);
    expect(envelope(result.stdout)).toEqual({
      ok: true,
      answer: "Refunds are issued within 30 days.",
      references: [{ title: "Refund policy" }],
      usage: { total_tokens: 42 },
      // Null proves the reader cancelled at `complete` instead of draining the stream.
      session_title: null,
      terminated_by: "complete",
    });
    expect(received).toEqual([
      { key: secret, body: JSON.stringify({ query: "How long do refunds take?" }), url: "/api/v1/knowledge-chat/s-1" },
    ]);
  });

  it("surfaces a middleware 403 as one failure envelope", async () => {
    const base = await startInstance(() => ({
      status: 403,
      body: JSON.stringify({ error: "Forbidden: API key scope does not allow this operation" }),
    }));

    const result = await runScript(["--session", "s-1", "--query", "q"], {
      WEKNORA_BASE_URL: base,
      WEKNORA_API_KEY: secret,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain(secret);
    expect(envelope(result.stdout)).toMatchObject({ ok: false, terminated_by: "error" });
    expect(String((envelope(result.stdout) as { error: string }).error)).toContain("403");
    expect(String((envelope(result.stdout) as { error: string }).error)).toContain("API key scope");
  });

  it("reports a stream that ends without a terminal event as incomplete", async () => {
    const base = await startInstance(() => frame({ response_type: "answer", content: "Partial" }));

    const result = await runScript(["--session", "s-1", "--query", "q"], {
      WEKNORA_BASE_URL: base,
      WEKNORA_API_KEY: secret,
    });

    expect(result.code).toBe(1);
    expect(envelope(result.stdout)).toMatchObject({
      ok: false,
      answer: "Partial",
      terminated_by: "incomplete",
    });
  });

  it("targets the agent route and forwards a supported resource URL mode", async () => {
    const urls: string[] = [];
    const base = await startInstance((request) => {
      urls.push(request.url);
      return frame({ response_type: "complete", done: true });
    });

    const result = await runScript(
      ["--session", "s-9", "--query", "q", "--mode", "agent", "--resource-urls", "public"],
      { WEKNORA_BASE_URL: base, WEKNORA_API_KEY: secret },
    );

    expect(result.code).toBe(0);
    expect(urls).toEqual(["/api/v1/agent-chat/s-9?resource_urls=public"]);
  });

  it("rejects an unsupported resource URL mode without contacting the instance", async () => {
    let contacted = false;
    const base = await startInstance(() => {
      contacted = true;
      return frame({ response_type: "complete", done: true });
    });

    const result = await runScript(["--session", "s-1", "--query", "q", "--resource-urls", "secret"], {
      WEKNORA_BASE_URL: base,
      WEKNORA_API_KEY: secret,
    });

    expect(result.code).toBe(1);
    expect(String((envelope(result.stdout) as { error: string }).error)).toContain("handle or public");
    expect(contacted).toBe(false);
  });

  it("fails closed when credentials are absent", async () => {
    const result = await runScript(["--session", "s-1", "--query", "q"], {
      WEKNORA_BASE_URL: "",
      WEKNORA_API_KEY: "",
    });

    expect(result.code).toBe(1);
    expect(envelope(result.stdout)).toMatchObject({ ok: false, terminated_by: "error" });
    expect(result.stderr).toContain("WEKNORA_BASE_URL is not set");
  });
});
