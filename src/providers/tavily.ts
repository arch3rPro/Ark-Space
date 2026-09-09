import { z } from "zod";

import { ProviderError } from "../errors/provider-error.js";
import type {
  ResearchData,
  ResearchJobId,
  ResearchSource,
  WebCrawlData,
  WebFetchData,
  WebMapData,
  WebSearchData,
} from "../protocol/types.js";
import type {
  ProviderCrawlRequest,
  ProviderFetchRequest,
  ProviderMapRequest,
  ProviderResearchRequest,
  ProviderSearchRequest,
  ResearchProvider,
  WebCrawlProvider,
  WebFetchProvider,
  WebMapProvider,
  WebSearchProvider,
} from "./contracts.js";
import { postJson, requestJson, type FetchLike } from "./http.js";

const TavilySearchResponseSchema = z
  .object({
    request_id: z.string().optional(),
    answer: z.string().nullish(),
    results: z.array(
      z
        .object({
          title: z.string().nullish(),
          url: z.string(),
          content: z.string().nullish(),
          score: z.number().nullish(),
          published_date: z.string().nullish(),
        })
        .loose(),
    ),
  })
  .loose();

const TavilyExtractResponseSchema = z
  .object({
    request_id: z.string().optional(),
    results: z.array(
      z
        .object({
          url: z.string(),
          raw_content: z.string().nullish(),
          images: z.array(z.string()).nullish(),
        })
        .loose(),
    ),
    failed_results: z
      .array(
        z
          .object({
            url: z.string(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

const TavilyCrawlResponseSchema = z
  .object({
    base_url: z.string(),
    results: z.array(
      z
        .object({
          url: z.string(),
          raw_content: z.string().nullish(),
        })
        .loose(),
    ),
    request_id: z.string().optional(),
  })
  .loose();

const TavilyMapResponseSchema = z
  .object({
    base_url: z.string(),
    results: z.array(z.string()),
    request_id: z.string().optional(),
  })
  .loose();

const TavilyResearchSourceSchema = z
  .object({
    url: z.string().url().refine(isCredentialFreeHttpUrl),
    title: z.string().nullish(),
  })
  .loose();

const TavilyResearchResponseSchema = z
  .object({
    request_id: z.string().min(1).max(500),
    status: z.enum(["pending", "in_progress", "running", "completed", "failed", "cancelled"]),
    content: z.string().max(2_000_000).nullish(),
    sources: z.array(TavilyResearchSourceSchema).max(500).default([]),
    usage: z
      .object({
        credits: z.number().nonnegative().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export class TavilyProvider
  implements WebSearchProvider, WebFetchProvider, WebMapProvider, WebCrawlProvider, ResearchProvider
{
  readonly id = "tavily" as const;

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async search(request: ProviderSearchRequest): Promise<WebSearchData> {
    const payload: Record<string, unknown> = {
      query: request.input.query,
      max_results: request.input.maxResults,
      search_depth: "basic",
      include_answer: false,
    };
    if (request.input.includeDomains.length > 0) payload.include_domains = request.input.includeDomains;
    if (request.input.excludeDomains.length > 0) payload.exclude_domains = request.input.excludeDomains;

    const value = await postJson(
      this.fetcher,
      "Tavily",
      `${request.baseUrl.replace(/\/$/, "")}/search`,
      { Authorization: `Bearer ${request.apiKey}` },
      payload,
      request.signal,
    );
    const parsed = TavilySearchResponseSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("web.search");

    const data: WebSearchData = {
      query: request.input.query,
      results: parsed.data.results.map((item) => ({
        title: item.title ?? "",
        url: item.url,
        snippet: item.content ?? "",
        ...(item.score == null ? {} : { score: item.score }),
        ...(item.published_date == null ? {} : { published: item.published_date }),
      })),
    };
    if (parsed.data.answer) data.answer = parsed.data.answer;
    if (parsed.data.request_id) data.requestId = parsed.data.request_id;
    return data;
  }

  async fetch(request: ProviderFetchRequest): Promise<WebFetchData> {
    const value = await postJson(
      this.fetcher,
      "Tavily",
      `${request.baseUrl.replace(/\/$/, "")}/extract`,
      { Authorization: `Bearer ${request.apiKey}` },
      {
        urls: request.input.urls,
        extract_depth: "basic",
        format: "markdown",
        timeout: Math.ceil(request.input.timeoutMs / 1_000),
      },
      request.signal,
    );
    const parsed = TavilyExtractResponseSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("web.fetch");

    const failedUrls = parsed.data.failed_results.map((item) => item.url);
    if (parsed.data.results.length === 0 && failedUrls.length > 0) {
      throw new ProviderError("Tavily could not fetch any requested URL.", { kind: "transient" });
    }
    const data: WebFetchData = {
      results: parsed.data.results.map((item) => ({
        url: item.url,
        content: (item.raw_content ?? "").slice(0, request.input.maxCharacters),
        ...(item.images && item.images.length > 0 ? { images: item.images } : {}),
      })),
      failedUrls,
    };
    if (parsed.data.request_id) data.requestId = parsed.data.request_id;
    return data;
  }

  async crawl(request: ProviderCrawlRequest): Promise<WebCrawlData> {
    const payload: Record<string, unknown> = {
      url: request.input.url,
      max_depth: request.input.maxDepth,
      limit: request.input.maxPages,
      extract_depth: "basic",
      format: "markdown",
      include_images: false,
      timeout: Math.ceil(request.input.timeoutMs / 1_000),
    };
    if (request.input.query) payload.instructions = request.input.query;
    if (request.input.includePaths.length > 0) payload.select_paths = request.input.includePaths;
    if (request.input.excludePaths.length > 0) payload.exclude_paths = request.input.excludePaths;

    const parsed = TavilyCrawlResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Tavily",
        `${request.baseUrl.replace(/\/$/, "")}/crawl`,
        { Authorization: `Bearer ${request.apiKey}` },
        payload,
        request.signal,
      ),
    );
    if (!parsed.success) throw invalidResponse("web.crawl");

    const data: WebCrawlData = {
      baseUrl: parsed.data.base_url,
      pages: parsed.data.results.map((item) => ({
        url: item.url,
        content: (item.raw_content ?? "").slice(0, request.input.maxCharacters),
      })),
      failedUrls: [],
    };
    if (parsed.data.request_id) data.requestId = parsed.data.request_id;
    return data;
  }

  async research(request: ProviderResearchRequest): Promise<ResearchData> {
    const controls = tavilyResearchControls(request.input.depth);
    let response: z.infer<typeof TavilyResearchResponseSchema>;
    try {
      const parsed = TavilyResearchResponseSchema.safeParse(
        await postJson(
          this.fetcher,
          "Tavily",
          `${request.baseUrl.replace(/\/$/, "")}/research`,
          { Authorization: `Bearer ${request.apiKey}` },
          {
            input: request.input.prompt,
            model: controls.model,
            output_length: controls.outputLength,
            citation_format: "numbered",
            stream: false,
          },
          request.signal,
        ),
      );
      if (!parsed.success) throw invalidResponse("research.run");
      response = parsed.data;
    } catch (error) {
      throw withUncertainResearchSubmission(error);
    }

    const jobId = response.request_id as ResearchJobId;
    const initial = settleTavilyResearch(request.input.prompt, response, jobId);
    if (initial) return initial;

    try {
      while (true) {
        await waitForPoll(request.pollIntervalMs, request.signal);
        const status = TavilyResearchResponseSchema.safeParse(
          await requestJson(
            this.fetcher,
            "Tavily",
            `${request.baseUrl.replace(/\/$/, "")}/research/${encodeURIComponent(jobId)}?include_usage=true`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${request.apiKey}` },
              ...(request.signal ? { signal: request.signal } : {}),
            },
          ),
        );
        if (!status.success) throw invalidResponse("research.run");
        const result = settleTavilyResearch(request.input.prompt, status.data, jobId);
        if (result) return result;
      }
    } catch (error) {
      if (hasTerminalResearchEvidence(error)) throw error;
      throw withPossiblyRunningResearch(error, jobId);
    }
  }

  async map(request: ProviderMapRequest): Promise<WebMapData> {
    const payload: Record<string, unknown> = {
      url: request.input.url,
      limit: request.input.maxResults,
      timeout: Math.ceil(request.input.timeoutMs / 1_000),
    };
    if (request.input.query) payload.instructions = request.input.query;

    const parsed = TavilyMapResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Tavily",
        `${request.baseUrl.replace(/\/$/, "")}/map`,
        { Authorization: `Bearer ${request.apiKey}` },
        payload,
        request.signal,
      ),
    );
    if (!parsed.success) throw invalidResponse("web.map");

    const data: WebMapData = {
      baseUrl: parsed.data.base_url,
      links: parsed.data.results.map((url) => ({ url })),
    };
    if (parsed.data.request_id) data.requestId = parsed.data.request_id;
    return data;
  }
}

function settleTavilyResearch(
  prompt: string,
  response: z.infer<typeof TavilyResearchResponseSchema>,
  jobId: ResearchJobId,
): ResearchData | undefined {
  switch (response.status) {
    case "pending":
    case "in_progress":
    case "running":
      return undefined;
    case "completed": {
      const report = response.content?.trim() ?? "";
      if (!report) {
        throw researchTerminalError(
          "Tavily completed Research without a report.",
          "invalid-response",
          jobId,
          "completed",
        );
      }
      const sourcesByUrl = new Map<string, ResearchSource>();
      for (const source of response.sources) {
        if (!sourcesByUrl.has(source.url)) {
          sourcesByUrl.set(source.url, {
            url: source.url,
            ...(source.title ? { title: source.title } : {}),
          });
        }
      }
      return {
        prompt,
        report,
        sources: [...sourcesByUrl.values()],
        status: "completed",
        jobId,
        ...(response.usage?.credits === undefined ? {} : { usage: { credits: response.usage.credits } }),
      };
    }
    case "failed":
    case "cancelled":
      throw researchTerminalError(
        `Tavily Research ended with status ${response.status}.`,
        "transient",
        jobId,
        response.status,
      );
  }
}

function tavilyResearchControls(depth: ProviderResearchRequest["input"]["depth"]): {
  model: "mini" | "auto" | "pro";
  outputLength: "short" | "standard" | "long";
} {
  switch (depth) {
    case "concise":
      return { model: "mini", outputLength: "short" };
    case "standard":
      return { model: "auto", outputLength: "standard" };
    case "deep":
      return { model: "pro", outputLength: "long" };
  }
}

function researchTerminalError(
  message: string,
  kind: "transient" | "invalid-response",
  jobId: ResearchJobId,
  state: "completed" | "failed" | "cancelled",
): ProviderError {
  return new ProviderError(message, {
    kind,
    remoteJob: { resource: "research-job", jobId, state },
  });
}

function hasTerminalResearchEvidence(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    error.remoteJob?.resource === "research-job" &&
    error.remoteJob.state !== "possibly-running"
  );
}

function withUncertainResearchSubmission(error: unknown): ProviderError {
  const primary =
    error instanceof ProviderError
      ? error
      : new ProviderError("Unexpected Tavily Research submission failure.", { kind: "unknown", cause: error });
  if (primary.kind !== "network" && primary.kind !== "transient" && primary.kind !== "invalid-response") {
    return primary;
  }
  return new ProviderError(primary.message, {
    kind: primary.kind,
    ...(primary.status === undefined ? {} : { status: primary.status }),
    ...(primary.retryAfterMs === undefined ? {} : { retryAfterMs: primary.retryAfterMs }),
    safeToRetry: false,
    submission: { resource: "research-job", state: "acceptance-unknown" },
    cause: primary,
  });
}

function withPossiblyRunningResearch(error: unknown, jobId: ResearchJobId): ProviderError {
  const primary =
    error instanceof ProviderError
      ? error
      : new ProviderError("Unexpected Tavily Research failure.", { kind: "unknown", cause: error });
  return new ProviderError(primary.message, {
    kind: primary.kind,
    ...(primary.status === undefined ? {} : { status: primary.status }),
    ...(primary.retryAfterMs === undefined ? {} : { retryAfterMs: primary.retryAfterMs }),
    safeToRetry: false,
    remoteJob: { resource: "research-job", jobId, state: "possibly-running" },
    cause: primary,
  });
}

function waitForPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveWait, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveWait();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isCredentialFreeHttpUrl(value: string): boolean {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
}

function invalidResponse(
  capability: "web.search" | "web.fetch" | "web.map" | "web.crawl" | "research.run",
): ProviderError {
  return new ProviderError(`Tavily returned a response that does not match the ${capability} contract.`, {
    kind: "invalid-response",
  });
}
