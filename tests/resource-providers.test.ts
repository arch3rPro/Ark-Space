import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { BrowserSessionId, MonitorId } from "../src/protocol/types.js";
import { ExaMonitorProvider } from "../src/providers/exa-monitor.js";
import { FirecrawlBrowserProvider } from "../src/providers/firecrawl-browser.js";
import type { FetchLike } from "../src/providers/http.js";

async function fixture(name: string): Promise<unknown> { return JSON.parse(await readFile(resolve("tests/fixtures", name), "utf8")); }

describe("Firecrawl Browser provider", () => {
  it("uses the standalone REST lifecycle and discards authority URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [await fixture("firecrawl-browser-create-response.json"), await fixture("firecrawl-browser-execute-response.json")];
    const fetcher: FetchLike = async (url, init) => {
      requests.push({ url: String(url), ...(init ? { init } : {}) });
      return Response.json(responses.shift());
    };
    const provider = new FirecrawlBrowserProvider(fetcher);
    const session = await provider.create("fc-secret", { ttlSeconds: 600, activityTtlSeconds: 300, timeoutMs: 30_000 });
    const result = await provider.execute("fc-secret", session.id, "agent-browser snapshot -i", 30_000);
    expect(requests[0]?.url).toBe("https://api.firecrawl.dev/v2/interact");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer fc-secret");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ ttl: 600, activityTtl: 300 });
    expect(requests[1]?.url).toBe("https://api.firecrawl.dev/v2/interact/browser-fixture-session/execute");
    expect(session).toEqual({ id: "browser-fixture-session", status: "active", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:10:00.000Z" });
    expect(JSON.stringify(session)).not.toContain("redacted-fixture");
    expect(result.output).toBe("Example Domain");
  });

  it("treats a missing session as closed during cleanup", async () => {
    const fetcher: FetchLike = async () => new Response('{"error":"not found"}', { status: 404 });
    await expect(new FirecrawlBrowserProvider(fetcher).close("fc-secret", "gone" as BrowserSessionId, 30_000)).resolves.toBeUndefined();
  });

  it("aborts an in-flight provider request from the caller signal", async () => {
    const controller = new AbortController();
    const fetcher: FetchLike = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const pending = new FirecrawlBrowserProvider(fetcher).status("fc-secret", "session" as BrowserSessionId, 30_000, controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toMatchObject({ kind: "network" });
  });
});

describe("Exa Monitor provider", () => {
  it("creates a recurring search and separates the one-time secret", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("exa-monitor-create-response.json"), { status: 201 });
    };
    const result = await new ExaMonitorProvider(fetcher).create("exa-secret", { name: "Agent releases", query: "new agent coding tool releases", numResults: 10, period: "1d", webhookUrl: "https://example.com/hook", webhookSecretPath: "/private/secret", confirmed: true, timeoutMs: 30_000 });
    expect(captured?.url).toBe("https://api.exa.ai/monitors");
    expect(new Headers(captured?.init?.headers).get("authorization")).toBe("Bearer exa-secret");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({ search: { query: "new agent coding tool releases", numResults: 10 }, trigger: { type: "interval", period: "1d" }, webhook: { url: "https://example.com/hook" } });
    expect(result.webhookSecret).toBe("whsec-redacted-fixture");
    expect(JSON.stringify(result.monitor)).not.toContain("whsec-redacted-fixture");
  });

  it("normalizes bounded run history", async () => {
    const fetcher: FetchLike = async () => Response.json(await fixture("exa-monitor-runs-response.json"));
    const runs = await new ExaMonitorProvider(fetcher).runs("exa-secret", "monitor-fixture" as MonitorId, 10, 30_000);
    expect(runs).toEqual([{ runId: "run-fixture", monitorId: "monitor-fixture", status: "completed", results: [{ title: "ArkSpace Browser release", url: "https://example.com/release", snippet: "Owned browser sessions are available.", published: "2026-01-01" }], summary: "One new release was found.", startedAt: "2026-01-01T00:00:01.000Z", completedAt: "2026-01-01T00:00:05.000Z", durationMs: 4000 }]);
  });
});
