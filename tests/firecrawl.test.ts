import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveWebCrawlInput,
  resolveWebExtractInput,
  resolveWebFetchInput,
  resolveWebSearchInput,
} from "../src/protocol/schema.js";
import { FirecrawlProvider } from "../src/providers/firecrawl.js";
import type { FetchLike } from "../src/providers/http.js";

describe("Firecrawl provider", () => {
  it("searches through the v2 REST API and normalizes web results", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("firecrawl-search-response.json"));
    };

    const result = await new FirecrawlProvider(fetcher).search({
      input: resolveWebSearchInput({ query: "agent skills", maxResults: 4 }),
      apiKey: "firecrawl-secret",
      baseUrl: "https://api.firecrawl.dev",
    });

    expect(captured?.url).toBe("https://api.firecrawl.dev/v2/search");
    expect(new Headers(captured?.init?.headers).get("authorization")).toBe("Bearer firecrawl-secret");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      query: "agent skills",
      limit: 4,
      sources: ["web"],
    });
    expect(result).toEqual({
      query: "agent skills",
      requestId: "firecrawl-search-fixture",
      results: [
        {
          title: "ArkSpace",
          url: "https://example.com/arkspace",
          snippet: "Provider-aware agent skills.",
        },
      ],
    });
  });

  it("scrapes each requested URL through the v2 REST API", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher: FetchLike = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Response.json(await fixture("firecrawl-scrape-response.json"));
    };

    const result = await new FirecrawlProvider(fetcher).fetch({
      input: resolveWebFetchInput({ urls: ["https://example.com/docs"], onlyMainContent: true }),
      apiKey: "firecrawl-secret",
      baseUrl: "https://api.firecrawl.dev/",
    });

    expect(requests).toEqual([
      {
        url: "https://api.firecrawl.dev/v2/scrape",
        body: {
          url: "https://example.com/docs",
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: 30_000,
        },
      },
    ]);
    expect(result).toEqual({
      results: [
        {
          url: "https://example.com/docs",
          title: "ArkSpace Docs",
          content: "# ArkSpace\n\nProvider-aware agent skills.",
        },
      ],
      failedUrls: [],
    });
  });

  it("polls structured extraction and validates completed data", async () => {
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    let statusReads = 0;
    const fetcher: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url: String(url),
        ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
      });
      if (method === "POST") return Response.json(await fixture("firecrawl-extract-start-response.json"));
      statusReads += 1;
      if (statusReads === 1) return Response.json({ success: true, status: "processing" });
      return Response.json(await fixture("firecrawl-extract-completed-response.json"));
    };
    const schema = {
      type: "object",
      properties: {
        plans: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, monthlyPrice: { type: ["number", "null"] } },
            required: ["name", "monthlyPrice"],
          },
        },
      },
      required: ["plans"],
    };

    const result = await new FirecrawlProvider(fetcher).extract({
      input: resolveWebExtractInput({
        urls: ["https://example.com/pricing"],
        prompt: "Extract plans",
        schema,
      }),
      apiKey: "firecrawl-secret",
      baseUrl: "https://api.firecrawl.dev",
      pollIntervalMs: 1,
    });

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.firecrawl.dev/v2/extract",
      body: {
        urls: ["https://example.com/pricing"],
        prompt: "Extract plans",
        schema,
        enableWebSearch: false,
        includeSubdomains: false,
        showSources: false,
      },
    });
    expect(result).toMatchObject({
      jobId: "extract-fixture-job",
      data: {
        plans: [
          { name: "Starter", monthlyPrice: 19 },
          { name: "Enterprise", monthlyPrice: null },
        ],
      },
      sources: ["https://example.com/pricing"],
      invalidUrls: [],
    });
  });

  it("marks post-receipt extract polling failures unsafe to retry", async () => {
    const fetcher: FetchLike = async (_url, init) =>
      init?.method === "POST"
        ? Response.json(await fixture("firecrawl-extract-start-response.json"))
        : new Response('{"error":"status unavailable"}', { status: 500 });

    await expect(
      new FirecrawlProvider(fetcher).extract({
        input: resolveWebExtractInput({
          urls: ["https://example.com/pricing"],
          prompt: "Extract plans",
          schema: { type: "object" },
        }),
        apiKey: "firecrawl-secret",
        baseUrl: "https://api.firecrawl.dev",
        pollIntervalMs: 1,
      }),
    ).rejects.toMatchObject({
      kind: "transient",
      safeToRetry: false,
      remoteJob: {
        resource: "extract-job",
        jobId: "extract-fixture-job",
        state: "possibly-running",
      },
    });
  });

  it("rejects completed extract data that violates the requested schema", async () => {
    const fetcher: FetchLike = async (_url, init) =>
      init?.method === "POST"
        ? Response.json(await fixture("firecrawl-extract-start-response.json"))
        : Response.json({ success: true, status: "completed", data: { plans: "not-an-array" } });

    await expect(
      new FirecrawlProvider(fetcher).extract({
        input: resolveWebExtractInput({
          urls: ["https://example.com/pricing"],
          prompt: "Extract plans",
          schema: {
            type: "object",
            properties: { plans: { type: "array" } },
            required: ["plans"],
          },
        }),
        apiKey: "firecrawl-secret",
        baseUrl: "https://api.firecrawl.dev",
        pollIntervalMs: 1,
      }),
    ).rejects.toMatchObject({ kind: "invalid-response", remoteJob: undefined });
  });

  it("starts, polls, and normalizes an asynchronous crawl", async () => {
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    let statusReads = 0;
    const fetcher: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        url: String(url),
        ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
      });
      if (method === "POST") return Response.json(await fixture("firecrawl-crawl-start-response.json"));
      statusReads += 1;
      if (statusReads === 1) return Response.json({ status: "scraping", data: [], next: null });
      return Response.json(await fixture("firecrawl-crawl-completed-response.json"));
    };

    const result = await new FirecrawlProvider(fetcher).crawl({
      input: resolveWebCrawlInput({
        url: "https://docs.example.com",
        query: "API reference",
        maxPages: 10,
        maxDepth: 3,
        includePaths: ["/docs/.*"],
      }),
      apiKey: "firecrawl-secret",
      baseUrl: "https://api.firecrawl.dev",
      pollIntervalMs: 1,
      cleanupTimeoutMs: 1_000,
    });

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.firecrawl.dev/v2/crawl",
      body: {
        url: "https://docs.example.com",
        prompt: "API reference",
        includePaths: ["/docs/.*"],
        maxDiscoveryDepth: 3,
        limit: 10,
        allowExternalLinks: false,
      },
    });
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(2);
    expect(result).toMatchObject({
      baseUrl: "https://docs.example.com",
      jobId: "crawl-fixture-job",
      pages: [{ url: "https://docs.example.com/start", title: "Start" }],
      failedUrls: ["https://docs.example.com/broken"],
    });
  });

  it("awaits remote cancellation after a non-terminal crawl failure", async () => {
    const methods: string[] = [];
    const fetcher: FetchLike = async (_url, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "POST") return Response.json(await fixture("firecrawl-crawl-start-response.json"));
      if (method === "DELETE") return Response.json({ status: "cancelled" });
      return new Response('{"error":"temporary status failure"}', { status: 500 });
    };

    await expect(
      new FirecrawlProvider(fetcher).crawl({
        input: resolveWebCrawlInput({ url: "https://docs.example.com" }),
        apiKey: "firecrawl-secret",
        baseUrl: "https://api.firecrawl.dev",
        pollIntervalMs: 1,
        cleanupTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      kind: "transient",
      cleanup: { resource: "crawl-job", attempted: true, ok: true },
    });
    expect(methods).toEqual(["POST", "GET", "DELETE"]);
  });

  it("cancels the remote job when the local crawl deadline aborts polling", async () => {
    const methods: string[] = [];
    const fetcher: FetchLike = async (_url, init) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "POST") return Response.json(await fixture("firecrawl-crawl-start-response.json"));
      if (method === "DELETE") return Response.json({ status: "cancelled" });
      return Response.json({ status: "scraping", data: [], next: null });
    };

    await expect(
      new FirecrawlProvider(fetcher).crawl({
        input: resolveWebCrawlInput({ url: "https://docs.example.com" }),
        apiKey: "firecrawl-secret",
        baseUrl: "https://api.firecrawl.dev",
        pollIntervalMs: 100,
        cleanupTimeoutMs: 1_000,
        signal: AbortSignal.timeout(5),
      }),
    ).rejects.toMatchObject({
      kind: "network",
      cleanup: { resource: "crawl-job", attempted: true, ok: true },
    });
    expect(methods).toEqual(["POST", "GET", "DELETE"]);
  });

  it("refuses pagination URLs that could receive the Provider credential", async () => {
    const urls: string[] = [];
    const fetcher: FetchLike = async (url, init) => {
      urls.push(String(url));
      if (init?.method === "POST") return Response.json(await fixture("firecrawl-crawl-start-response.json"));
      return Response.json({
        status: "completed",
        data: [],
        next: "https://attacker.example/capture-token",
      });
    };

    await expect(
      new FirecrawlProvider(fetcher).crawl({
        input: resolveWebCrawlInput({ url: "https://docs.example.com" }),
        apiKey: "firecrawl-secret",
        baseUrl: "https://api.firecrawl.dev",
        pollIntervalMs: 1,
        cleanupTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    expect(urls).toEqual([
      "https://api.firecrawl.dev/v2/crawl",
      "https://api.firecrawl.dev/v2/crawl/crawl-fixture-job",
    ]);
  });

  it("maps a site through the v2 REST API", async () => {
    let captured: { url: string; body: Record<string, unknown> } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      return Response.json(await fixture("firecrawl-map-response.json"));
    };

    const result = await new FirecrawlProvider(fetcher).map({
      input: {
        url: "https://docs.example.com",
        query: "API reference",
        maxResults: 50,
        timeoutMs: 60_000,
        provider: "firecrawl",
      },
      apiKey: "firecrawl-secret",
      baseUrl: "https://api.firecrawl.dev",
    });

    expect(captured).toEqual({
      url: "https://api.firecrawl.dev/v2/map",
      body: {
        url: "https://docs.example.com",
        search: "API reference",
        limit: 50,
        timeout: 60_000,
      },
    });
    expect(result).toEqual({
      baseUrl: "https://docs.example.com",
      links: [
        {
          url: "https://docs.example.com/welcome",
          title: "Welcome",
          description: "Start using the documentation.",
        },
        { url: "https://docs.example.com/api" },
      ],
    });
  });

  it("rejects a successful HTTP response with a failed Firecrawl envelope", async () => {
    const fetcher: FetchLike = async () => Response.json({ success: false, error: "scrape failed" });

    await expect(
      new FirecrawlProvider(fetcher).fetch({
        input: resolveWebFetchInput({ urls: ["https://example.com"] }),
        apiKey: "firecrawl-secret",
        baseUrl: "https://api.firecrawl.dev",
      }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });
});

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve("tests/fixtures", name), "utf8")) as unknown;
}
