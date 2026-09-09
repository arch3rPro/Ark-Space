import { Ajv, type ValidateFunction } from "ajv";
import { z } from "zod";

import { ProviderError } from "../errors/provider-error.js";
import type {
  CrawlJobId,
  ExtractJobId,
  JsonValue,
  WebCrawlData,
  WebCrawlPage,
  WebExtractData,
  WebFetchData,
  WebFetchResult,
  WebMapData,
  WebSearchData,
} from "../protocol/types.js";
import type {
  ProviderCrawlRequest,
  ProviderExtractRequest,
  ProviderFetchRequest,
  ProviderMapRequest,
  ProviderSearchRequest,
  WebCrawlProvider,
  WebExtractProvider,
  WebFetchProvider,
  WebMapProvider,
  WebSearchProvider,
} from "./contracts.js";
import { postJson, requestJson, type FetchLike } from "./http.js";

const MAX_EXTRACT_OUTPUT_BYTES = 2_000_000;

const MetadataSchema = z
  .object({
    title: z.string().nullish(),
    sourceURL: z.string().nullish(),
    url: z.string().nullish(),
    error: z.string().nullish(),
  })
  .loose();

const FirecrawlSearchResponseSchema = z
  .object({
    success: z.literal(true),
    id: z.string().optional(),
    data: z.object({
      web: z
        .array(
          z
            .object({
              title: z.string().nullish(),
              description: z.string().nullish(),
              url: z.string(),
              markdown: z.string().nullish(),
              metadata: MetadataSchema.optional(),
            })
            .loose(),
        )
        .default([]),
    }),
  })
  .loose();

const FirecrawlScrapeResponseSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        markdown: z.string().nullish(),
        metadata: MetadataSchema.optional(),
      })
      .loose(),
  })
  .loose();

const FirecrawlExtractStartResponseSchema = z
  .object({
    success: z.literal(true),
    id: z.string().min(1),
    invalidURLs: z.array(z.string()).nullish(),
  })
  .loose();

const FirecrawlExtractStatusResponseSchema = z
  .object({
    success: z.boolean(),
    status: z.enum(["processing", "completed", "failed", "cancelled"]),
    data: z.json().optional(),
  })
  .loose();

const FirecrawlCrawlStartResponseSchema = z
  .object({
    success: z.literal(true),
    id: z.string().min(1),
    url: z.string().url(),
  })
  .loose();

const FirecrawlCrawlStatusResponseSchema = z
  .object({
    status: z.enum(["scraping", "completed", "failed", "cancelled"]),
    data: z
      .array(
        z
          .object({
            markdown: z.string().nullish(),
            metadata: MetadataSchema.optional(),
          })
          .loose(),
      )
      .default([]),
    next: z.string().url().nullish(),
  })
  .loose();

const FirecrawlCancelResponseSchema = z
  .object({
    status: z.literal("cancelled"),
  })
  .loose();

const FirecrawlMapResponseSchema = z
  .object({
    success: z.literal(true),
    links: z.array(
      z
        .object({
          url: z.string(),
          title: z.string().nullish(),
          description: z.string().nullish(),
        })
        .loose(),
    ),
  })
  .loose();

export class FirecrawlProvider
  implements WebSearchProvider, WebFetchProvider, WebMapProvider, WebCrawlProvider, WebExtractProvider
{
  readonly id = "firecrawl" as const;

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async search(request: ProviderSearchRequest): Promise<WebSearchData> {
    const payload: Record<string, unknown> = {
      query: request.input.query,
      limit: request.input.maxResults,
      sources: ["web"],
    };
    if (request.input.includeDomains.length > 0) payload.includeDomains = request.input.includeDomains;
    if (request.input.excludeDomains.length > 0) payload.excludeDomains = request.input.excludeDomains;

    const parsed = FirecrawlSearchResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Firecrawl",
        `${request.baseUrl.replace(/\/$/, "")}/v2/search`,
        { Authorization: `Bearer ${request.apiKey}` },
        payload,
        request.signal,
      ),
    );
    if (!parsed.success) throw invalidResponse("web.search");

    const data: WebSearchData = {
      query: request.input.query,
      results: parsed.data.data.web.map((item) => ({
        title: item.title ?? item.metadata?.title ?? "",
        url: item.url,
        snippet: item.description ?? item.markdown ?? "",
      })),
    };
    if (parsed.data.id) data.requestId = parsed.data.id;
    return data;
  }

  async fetch(request: ProviderFetchRequest): Promise<WebFetchData> {
    const results: WebFetchResult[] = [];
    for (const url of request.input.urls) {
      const parsed = FirecrawlScrapeResponseSchema.safeParse(
        await postJson(
          this.fetcher,
          "Firecrawl",
          `${request.baseUrl.replace(/\/$/, "")}/v2/scrape`,
          { Authorization: `Bearer ${request.apiKey}` },
          {
            url,
            formats: ["markdown"],
            onlyMainContent: request.input.onlyMainContent,
            timeout: request.input.timeoutMs,
          },
          request.signal,
        ),
      );
      if (!parsed.success) throw invalidResponse("web.fetch");
      results.push({
        url: parsed.data.data.metadata?.sourceURL ?? parsed.data.data.metadata?.url ?? url,
        content: (parsed.data.data.markdown ?? "").slice(0, request.input.maxCharacters),
        ...(parsed.data.data.metadata?.title ? { title: parsed.data.data.metadata.title } : {}),
      });
    }
    return { results, failedUrls: [] };
  }

  async extract(request: ProviderExtractRequest): Promise<WebExtractData> {
    const validate = compileExtractionSchema(request.input.schema);
    const started = FirecrawlExtractStartResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Firecrawl",
        `${request.baseUrl.replace(/\/$/, "")}/v2/extract`,
        { Authorization: `Bearer ${request.apiKey}` },
        {
          urls: request.input.urls,
          prompt: request.input.prompt,
          schema: request.input.schema,
          enableWebSearch: false,
          includeSubdomains: false,
          showSources: false,
          ignoreInvalidURLs: true,
          scrapeOptions: { onlyMainContent: request.input.onlyMainContent },
        },
        request.signal,
      ),
    );
    if (!started.success) throw invalidResponse("web.extract");

    const jobId = started.data.id as ExtractJobId;
    let terminal = false;
    try {
      while (true) {
        const status = FirecrawlExtractStatusResponseSchema.safeParse(
          await requestJson(this.fetcher, "Firecrawl", extractStatusUrl(request.baseUrl, jobId), {
            method: "GET",
            headers: { Authorization: `Bearer ${request.apiKey}` },
            ...(request.signal ? { signal: request.signal } : {}),
          }),
        );
        if (!status.success) throw invalidResponse("web.extract");
        switch (status.data.status) {
          case "processing":
            await waitForPoll(request.pollIntervalMs, request.signal);
            break;
          case "failed":
          case "cancelled":
            terminal = true;
            throw new ProviderError(`Firecrawl extract ended with status ${status.data.status}.`, { kind: "transient" });
          case "completed": {
            terminal = true;
            if (status.data.data === undefined) throw invalidResponse("web.extract");
            if (new TextEncoder().encode(JSON.stringify(status.data.data)).byteLength > MAX_EXTRACT_OUTPUT_BYTES) {
              throw new ProviderError("Firecrawl extract data exceeds the local output limit.", {
                kind: "invalid-response",
              });
            }
            if (!validate(status.data.data)) {
              throw new ProviderError("Firecrawl extract data does not match the requested JSON Schema.", {
                kind: "invalid-response",
              });
            }
            const invalidUrls = started.data.invalidURLs ?? [];
            return {
              data: status.data.data as JsonValue,
              sources: request.input.urls.filter((url) => !invalidUrls.includes(url)),
              invalidUrls,
              jobId,
            };
          }
        }
      }
    } catch (error) {
      if (terminal) throw error;
      throw withRemoteExtractJob(error, jobId);
    }
  }

  async crawl(request: ProviderCrawlRequest): Promise<WebCrawlData> {
    const payload: Record<string, unknown> = {
      url: request.input.url,
      limit: request.input.maxPages,
      maxDiscoveryDepth: request.input.maxDepth,
      allowExternalLinks: false,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: request.input.onlyMainContent,
        timeout: Math.min(request.input.timeoutMs, 120_000),
      },
    };
    if (request.input.query) payload.prompt = request.input.query;
    if (request.input.includePaths.length > 0) payload.includePaths = request.input.includePaths;
    if (request.input.excludePaths.length > 0) payload.excludePaths = request.input.excludePaths;

    const started = FirecrawlCrawlStartResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Firecrawl",
        `${request.baseUrl.replace(/\/$/, "")}/v2/crawl`,
        { Authorization: `Bearer ${request.apiKey}` },
        payload,
        request.signal,
      ),
    );
    if (!started.success) throw invalidResponse("web.crawl");

    const jobId = started.data.id as CrawlJobId;
    let terminal = false;
    try {
      while (true) {
        const status = await this.readCrawlStatus(request, crawlStatusUrl(request.baseUrl, jobId));
        switch (status.status) {
          case "scraping":
            await waitForPoll(request.pollIntervalMs, request.signal);
            break;
          case "failed":
          case "cancelled":
            terminal = true;
            throw new ProviderError(`Firecrawl crawl ended with status ${status.status}.`, { kind: "transient" });
          case "completed": {
            terminal = true;
            const pages: WebCrawlPage[] = [];
            const failedUrls: string[] = [];
            appendCrawlItems(status.data, request, pages, failedUrls);
            let next = status.next ?? undefined;
            while (next) {
              const page = await this.readCrawlStatus(request, safePaginationUrl(next, request.baseUrl, jobId));
              if (page.status !== "completed") throw invalidResponse("web.crawl");
              appendCrawlItems(page.data, request, pages, failedUrls);
              next = page.next ?? undefined;
            }
            if (pages.length === 0 && failedUrls.length > 0) {
              throw new ProviderError("Firecrawl could not crawl any requested page.", { kind: "transient" });
            }
            return { baseUrl: request.input.url, pages, failedUrls, jobId };
          }
        }
      }
    } catch (error) {
      if (terminal) throw error;
      const cleanupOk = await this.cancelCrawl(request, jobId);
      throw withCrawlCleanup(error, cleanupOk);
    }
  }

  async map(request: ProviderMapRequest): Promise<WebMapData> {
    const payload: Record<string, unknown> = {
      url: request.input.url,
      limit: request.input.maxResults,
      timeout: request.input.timeoutMs,
    };
    if (request.input.query) payload.search = request.input.query;

    const parsed = FirecrawlMapResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Firecrawl",
        `${request.baseUrl.replace(/\/$/, "")}/v2/map`,
        { Authorization: `Bearer ${request.apiKey}` },
        payload,
        request.signal,
      ),
    );
    if (!parsed.success) throw invalidResponse("web.map");

    return {
      baseUrl: request.input.url,
      links: parsed.data.links.map((link) => ({
        url: link.url,
        ...(link.title ? { title: link.title } : {}),
        ...(link.description ? { description: link.description } : {}),
      })),
    };
  }

  private async readCrawlStatus(
    request: ProviderCrawlRequest,
    url: string,
  ): Promise<z.infer<typeof FirecrawlCrawlStatusResponseSchema>> {
    const parsed = FirecrawlCrawlStatusResponseSchema.safeParse(
      await requestJson(this.fetcher, "Firecrawl", url, {
        method: "GET",
        headers: { Authorization: `Bearer ${request.apiKey}` },
        ...(request.signal ? { signal: request.signal } : {}),
      }),
    );
    if (!parsed.success) throw invalidResponse("web.crawl");
    return parsed.data;
  }

  private async cancelCrawl(request: ProviderCrawlRequest, jobId: CrawlJobId): Promise<boolean> {
    try {
      const parsed = FirecrawlCancelResponseSchema.safeParse(
        await requestJson(this.fetcher, "Firecrawl", crawlStatusUrl(request.baseUrl, jobId), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${request.apiKey}` },
          signal: AbortSignal.timeout(request.cleanupTimeoutMs),
        }),
      );
      return parsed.success;
    } catch {
      // Cancellation failure is returned as cleanup evidence by the primary operation.
      return false;
    }
  }
}

function compileExtractionSchema(schema: Record<string, JsonValue>): ValidateFunction {
  try {
    return new Ajv({ allErrors: true, strict: false }).compile(schema);
  } catch (error) {
    throw new ProviderError("Extraction schema could not be compiled.", { kind: "invalid-request", cause: error });
  }
}

function extractStatusUrl(baseUrl: string, jobId: ExtractJobId): string {
  return `${baseUrl.replace(/\/$/, "")}/v2/extract/${encodeURIComponent(jobId)}`;
}

function withRemoteExtractJob(error: unknown, jobId: ExtractJobId): ProviderError {
  const primary =
    error instanceof ProviderError
      ? error
      : new ProviderError("Unexpected Firecrawl extract failure.", { kind: "unknown", cause: error });
  return new ProviderError(primary.message, {
    kind: primary.kind,
    ...(primary.status === undefined ? {} : { status: primary.status }),
    ...(primary.retryAfterMs === undefined ? {} : { retryAfterMs: primary.retryAfterMs }),
    safeToRetry: false,
    remoteJob: { resource: "extract-job", jobId, state: "possibly-running" },
    cause: primary,
  });
}

function appendCrawlItems(
  items: z.infer<typeof FirecrawlCrawlStatusResponseSchema>["data"],
  request: ProviderCrawlRequest,
  pages: WebCrawlPage[],
  failedUrls: string[],
): void {
  for (const item of items) {
    const url = item.metadata?.sourceURL ?? item.metadata?.url;
    if (!url) throw invalidResponse("web.crawl");
    if (item.metadata?.error) {
      failedUrls.push(url);
      continue;
    }
    pages.push({
      url,
      content: (item.markdown ?? "").slice(0, request.input.maxCharacters),
      ...(item.metadata?.title ? { title: item.metadata.title } : {}),
    });
  }
}

function crawlStatusUrl(baseUrl: string, jobId: CrawlJobId): string {
  return `${baseUrl.replace(/\/$/, "")}/v2/crawl/${encodeURIComponent(jobId)}`;
}

function safePaginationUrl(next: string, baseUrl: string, jobId: CrawlJobId): string {
  const candidate = new URL(next);
  const expected = new URL(crawlStatusUrl(baseUrl, jobId));
  if (candidate.origin !== expected.origin || candidate.pathname !== expected.pathname) {
    throw invalidResponse("web.crawl");
  }
  return candidate.toString();
}

function waitForPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(crawlAborted(signal.reason));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(crawlAborted(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function crawlAborted(cause: unknown): ProviderError {
  return new ProviderError("Firecrawl crawl stopped before completion.", { kind: "network", cause });
}

function withCrawlCleanup(error: unknown, cleanupOk: boolean): ProviderError {
  const primary =
    error instanceof ProviderError
      ? error
      : new ProviderError("Unexpected Firecrawl crawl failure.", { kind: "unknown", cause: error });
  return new ProviderError(primary.message, {
    kind: primary.kind,
    ...(primary.status === undefined ? {} : { status: primary.status }),
    ...(primary.retryAfterMs === undefined ? {} : { retryAfterMs: primary.retryAfterMs }),
    safeToRetry: cleanupOk,
    cleanup: { resource: "crawl-job", attempted: true, ok: cleanupOk },
    cause: primary,
  });
}

function invalidResponse(
  capability: "web.search" | "web.fetch" | "web.map" | "web.crawl" | "web.extract",
): ProviderError {
  return new ProviderError(`Firecrawl returned a response that does not match the ${capability} contract.`, {
    kind: "invalid-response",
  });
}
