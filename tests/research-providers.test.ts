import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveResearchInput } from "../src/protocol/schema.js";
import { ExaProvider } from "../src/providers/exa.js";
import type { FetchLike } from "../src/providers/http.js";
import { TavilyProvider } from "../src/providers/tavily.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve("tests/fixtures", name), "utf8")) as unknown;
}

const input = resolveResearchInput({
  prompt: "Compare current API lifecycle contracts",
  depth: "standard",
  timeoutMs: 60_000,
});

describe("Research provider adapters", () => {
  it("polls Exa Agent and preserves authoritative grounding", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetcher: FetchLike = async (url, init) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
      });
      return Response.json(
        requests.length === 1
          ? await fixture("exa-agent-running-response.json")
          : await fixture("exa-agent-completed-response.json"),
      );
    };

    const result = await new ExaProvider(fetcher).research({
      input,
      apiKey: "exa-secret",
      baseUrl: "https://api.exa.ai/",
      pollIntervalMs: 1,
      cleanupTimeoutMs: 1_000,
    });

    expect(requests).toMatchObject([
      {
        url: "https://api.exa.ai/agent/runs",
        method: "POST",
        body: {
          query: input.prompt,
          effort: "medium",
          systemPrompt: expect.stringContaining("authoritative primary sources"),
        },
      },
      { url: "https://api.exa.ai/agent/runs/agent_run_fixture", method: "GET" },
    ]);
    expect(result).toMatchObject({
      status: "completed",
      jobId: "agent_run_fixture",
      report: expect.stringContaining("Official documentation"),
      sources: [{ url: "https://docs.example.com/lifecycle", title: "Lifecycle reference" }],
      grounding: [
        {
          field: "output.text",
          sourceUrls: ["https://docs.example.com/lifecycle"],
          confidence: "high",
        },
      ],
      usage: { searches: 4, agentComputeUnits: 2, costDollars: 0.12 },
    });
  });

  it("confirms Exa cancellation after a polling failure", async () => {
    const fetcher: FetchLike = async (url, init) => {
      if (init?.method === "POST" && String(url).endsWith("/cancel")) {
        return Response.json(await fixture("exa-agent-cancelled-response.json"));
      }
      if (init?.method === "POST") return Response.json(await fixture("exa-agent-running-response.json"));
      return new Response('{"error":"poll failed"}', { status: 500 });
    };

    await expect(
      new ExaProvider(fetcher).research({
        input,
        apiKey: "exa-secret",
        baseUrl: "https://api.exa.ai",
        pollIntervalMs: 1,
        cleanupTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      kind: "transient",
      retryable: true,
      safeToRetry: true,
      cleanup: {
        resource: "research-job",
        jobId: "agent_run_fixture",
        attempted: true,
        ok: true,
      },
      remoteJob: { state: "cancelled" },
    });
  });

  it("suppresses retry when Exa cancellation cannot be confirmed", async () => {
    const fetcher: FetchLike = async (_url, init) => {
      if (init?.method === "POST") return Response.json(await fixture("exa-agent-running-response.json"));
      return new Response('{"error":"poll failed"}', { status: 500 });
    };

    await expect(
      new ExaProvider(fetcher).research({
        input,
        apiKey: "exa-secret",
        baseUrl: "https://api.exa.ai",
        pollIntervalMs: 1,
        cleanupTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      retryable: false,
      safeToRetry: false,
      cleanup: { resource: "research-job", ok: false },
      remoteJob: { state: "possibly-running" },
    });
  });

  it("marks a lost Exa submission response acceptance-unknown", async () => {
    let calls = 0;
    const fetcher: FetchLike = async () => {
      calls += 1;
      throw new Error("connection reset");
    };

    await expect(
      new ExaProvider(fetcher).research({
        input,
        apiKey: "exa-secret",
        baseUrl: "https://api.exa.ai",
        pollIntervalMs: 1,
        cleanupTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      kind: "network",
      safeToRetry: false,
      submission: { resource: "research-job", state: "acceptance-unknown" },
    });
    expect(calls).toBe(1);
  });

  it("polls Tavily Research with mapped depth controls and unique sources", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetcher: FetchLike = async (url, init) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
      });
      if (requests.length === 1) return Response.json(await fixture("tavily-research-pending-response.json"));
      if (requests.length === 2) {
        return Response.json({ request_id: "tavily-research-fixture", status: "in_progress" });
      }
      return Response.json(await fixture("tavily-research-completed-response.json"));
    };

    const result = await new TavilyProvider(fetcher).research({
      input,
      apiKey: "tavily-secret",
      baseUrl: "https://api.tavily.com/",
      pollIntervalMs: 1,
      cleanupTimeoutMs: 1_000,
    });

    expect(requests).toMatchObject([
      {
        url: "https://api.tavily.com/research",
        method: "POST",
        body: {
          input: input.prompt,
          model: "auto",
          output_length: "standard",
          citation_format: "numbered",
          stream: false,
        },
      },
      {
        url: "https://api.tavily.com/research/tavily-research-fixture?include_usage=true",
        method: "GET",
      },
      {
        url: "https://api.tavily.com/research/tavily-research-fixture?include_usage=true",
        method: "GET",
      },
    ]);
    expect(result).toMatchObject({
      status: "completed",
      jobId: "tavily-research-fixture",
      sources: [{ title: "Research API", url: "https://docs.example.com/research" }],
      usage: { credits: 16 },
    });
  });

  it("preserves a possibly-running Tavily Job after polling fails", async () => {
    const fetcher: FetchLike = async (_url, init) =>
      init?.method === "POST"
        ? Response.json(await fixture("tavily-research-pending-response.json"))
        : new Response('{"error":"poll failed"}', { status: 500 });

    await expect(
      new TavilyProvider(fetcher).research({
        input,
        apiKey: "tavily-secret",
        baseUrl: "https://api.tavily.com",
        pollIntervalMs: 1,
        cleanupTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      retryable: false,
      safeToRetry: false,
      remoteJob: {
        resource: "research-job",
        jobId: "tavily-research-fixture",
        state: "possibly-running",
      },
    });
  });
});
