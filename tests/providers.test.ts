import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ExaProvider } from "../src/providers/exa.js";
import type { FetchLike } from "../src/providers/http.js";
import { TavilyProvider } from "../src/providers/tavily.js";
import {
  resolveCodeContextInput,
  resolveWebCrawlInput,
  resolveWebFetchInput,
  resolveWebMapInput,
  resolveWebRelatedInput,
  resolveWebSearchInput,
} from "../src/protocol/schema.js";

const input = resolveWebSearchInput({
  query: "agent skills",
  maxResults: 3,
  includeDomains: ["example.com"],
  excludeDomains: ["spam.example"],
});
const fetchInput = resolveWebFetchInput({
  urls: ["https://example.com/docs", "https://example.com/missing"],
  maxCharacters: 20_000,
});

describe("Exa web.search adapter", () => {
  it("uses the documented request and normalizes the provider response", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("exa-search-response.json"));
    };

    const result = await new ExaProvider(fetcher).search({
      input,
      apiKey: "exa-secret",
      baseUrl: "https://api.exa.ai/",
    });

    expect(captured?.url).toBe("https://api.exa.ai/search");
    expect(new Headers(captured?.init?.headers).get("x-api-key")).toBe("exa-secret");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      query: "agent skills",
      numResults: 3,
      includeDomains: ["example.com"],
      excludeDomains: ["spam.example"],
    });
    expect(result).toEqual({
      query: "agent skills",
      requestId: "exa-fixture-request",
      results: [
        {
          title: "ArkSpace",
          url: "https://example.com/arkspace",
          snippet: "A reusable agent skills workspace.",
          score: 0.91,
          published: "2026-01-01",
        },
      ],
    });
  });

  it("finds pages related to a known URL", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("exa-search-response.json"));
    };

    const result = await new ExaProvider(fetcher).related({
      input: resolveWebRelatedInput({ url: "https://example.com/reference", maxResults: 4 }),
      apiKey: "exa-secret",
      baseUrl: "https://api.exa.ai",
    });

    expect(captured?.url).toBe("https://api.exa.ai/findSimilar");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      url: "https://example.com/reference",
      numResults: 4,
    });
    expect(result).toMatchObject({
      url: "https://example.com/reference",
      requestId: "exa-fixture-request",
      results: [{ url: "https://example.com/arkspace" }],
    });
  });

  it("retrieves bounded implementation context with Bearer authentication", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("exa-context-response.json"));
    };

    const result = await new ExaProvider(fetcher).context({
      input: resolveCodeContextInput({ query: "current TypeScript SDK usage", tokens: 5_000 }),
      apiKey: "exa-secret",
      baseUrl: "https://api.exa.ai/",
    });

    expect(captured?.url).toBe("https://api.exa.ai/context");
    expect(new Headers(captured?.init?.headers).get("authorization")).toBe("Bearer exa-secret");
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      query: "current TypeScript SDK usage",
      tokensNum: 5_000,
    });
    expect(result).toMatchObject({
      requestId: "exa-context-fixture",
      resultsCount: 4,
      outputTokens: 1_200,
    });
  });

  it("fetches URL contents and preserves partial-failure evidence", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("exa-contents-response.json"));
    };

    const result = await new ExaProvider(fetcher).fetch({
      input: fetchInput,
      apiKey: "exa-secret",
      baseUrl: "https://api.exa.ai",
    });

    expect(captured?.url).toBe("https://api.exa.ai/contents");
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      urls: fetchInput.urls,
      text: { maxCharacters: 20_000 },
    });
    expect(result).toMatchObject({
      requestId: "exa-contents-fixture",
      results: [{ url: "https://example.com/docs", title: "ArkSpace Docs" }],
      failedUrls: ["https://example.com/missing"],
    });
  });
});

describe("Tavily web.search adapter", () => {
  it("uses bearer authentication and normalizes content as snippets", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("tavily-search-response.json"));
    };

    const result = await new TavilyProvider(fetcher).search({
      input,
      apiKey: "tavily-secret",
      baseUrl: "https://api.tavily.com",
    });

    expect(captured?.url).toBe("https://api.tavily.com/search");
    expect(new Headers(captured?.init?.headers).get("authorization")).toBe("Bearer tavily-secret");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      query: "agent skills",
      max_results: 3,
      search_depth: "basic",
      include_domains: ["example.com"],
      exclude_domains: ["spam.example"],
    });
    expect(result.results[0]?.snippet).toBe("A reusable agent skills workspace.");
  });

  it("extracts markdown and records failed URLs", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("tavily-extract-response.json"));
    };

    const result = await new TavilyProvider(fetcher).fetch({
      input: fetchInput,
      apiKey: "tavily-secret",
      baseUrl: "https://api.tavily.com",
    });

    expect(captured?.url).toBe("https://api.tavily.com/extract");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      urls: fetchInput.urls,
      extract_depth: "basic",
      format: "markdown",
    });
    expect(result).toMatchObject({
      requestId: "tavily-extract-fixture",
      results: [{ url: "https://example.com/docs", images: ["https://example.com/hero.png"] }],
      failedUrls: ["https://example.com/missing"],
    });
  });

  it("crawls site content with bounded provider-neutral controls", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("tavily-crawl-response.json"));
    };

    const result = await new TavilyProvider(fetcher).crawl({
      input: resolveWebCrawlInput({
        url: "https://docs.example.com",
        query: "API reference",
        maxPages: 10,
        maxDepth: 3,
        includePaths: ["/docs/.*"],
        excludePaths: ["/archive/.*"],
      }),
      apiKey: "tavily-secret",
      baseUrl: "https://api.tavily.com",
      pollIntervalMs: 1_000,
      cleanupTimeoutMs: 5_000,
    });

    expect(captured?.url).toBe("https://api.tavily.com/crawl");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      url: "https://docs.example.com",
      instructions: "API reference",
      max_depth: 3,
      limit: 10,
      select_paths: ["/docs/.*"],
      exclude_paths: ["/archive/.*"],
      format: "markdown",
    });
    expect(result).toMatchObject({
      baseUrl: "https://docs.example.com",
      requestId: "tavily-crawl-fixture",
      pages: [{ url: "https://docs.example.com/start" }, { url: "https://docs.example.com/api" }],
      failedUrls: [],
    });
  });

  it("maps site URLs and converts a provider-neutral query to instructions", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher: FetchLike = async (url, init) => {
      captured = { url: String(url), ...(init ? { init } : {}) };
      return Response.json(await fixture("tavily-map-response.json"));
    };

    const result = await new TavilyProvider(fetcher).map({
      input: resolveWebMapInput({
        url: "https://docs.example.com",
        query: "API reference",
        maxResults: 50,
        timeoutMs: 60_000,
      }),
      apiKey: "tavily-secret",
      baseUrl: "https://api.tavily.com",
    });

    expect(captured?.url).toBe("https://api.tavily.com/map");
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      url: "https://docs.example.com",
      instructions: "API reference",
      limit: 50,
      timeout: 60,
    });
    expect(result).toEqual({
      baseUrl: "https://docs.example.com",
      requestId: "tavily-map-fixture",
      links: [
        { url: "https://docs.example.com/welcome" },
        { url: "https://docs.example.com/api" },
      ],
    });
  });

  it("classifies quota responses without exposing their body", async () => {
    const fetcher: FetchLike = async () =>
      new Response('{"detail":{"error":"usage limit exceeded for secret abc"}}', { status: 429 });

    await expect(
      new TavilyProvider(fetcher).search({
        input,
        apiKey: "abc",
        baseUrl: "https://api.tavily.com",
      }),
    ).rejects.toMatchObject({ kind: "quota", message: "Tavily request failed with HTTP 429." });
  });
});

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve("tests/fixtures", name), "utf8")) as unknown;
}
