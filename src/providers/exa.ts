import { z } from "zod";

import { ProviderError } from "../errors/provider-error.js";
import type {
  CodeContextData,
  ResearchData,
  ResearchGrounding,
  ResearchJobId,
  ResearchSource,
  WebFetchData,
  WebRelatedData,
  WebSearchData,
  WebSearchResult,
} from "../protocol/types.js";
import type {
  CodeContextProvider,
  ProviderCodeContextRequest,
  ProviderFetchRequest,
  ProviderRelatedRequest,
  ProviderResearchRequest,
  ProviderSearchRequest,
  ResearchProvider,
  WebFetchProvider,
  WebRelatedProvider,
  WebSearchProvider,
} from "./contracts.js";
import { postJson, requestJson, type FetchLike } from "./http.js";

const ExaResultSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().nullish(),
    url: z.string(),
    text: z.string().nullish(),
    summary: z.string().nullish(),
    score: z.number().nullish(),
    publishedDate: z.string().nullish(),
  })
  .loose();

const ExaSearchResponseSchema = z
  .object({
    requestId: z.string().optional(),
    results: z.array(ExaResultSchema),
  })
  .loose();

const ExaContextResponseSchema = z
  .object({
    requestId: z.string().optional(),
    query: z.string().optional(),
    response: z.string(),
    resultsCount: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .loose();

const ExaContentsResponseSchema = z
  .object({
    requestId: z.string().optional(),
    results: z.array(ExaResultSchema),
    statuses: z
      .array(
        z
          .object({
            id: z.string(),
            status: z.string(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

const ExaAgentCitationSchema = z
  .object({
    url: z.string().url().refine(isCredentialFreeHttpUrl),
    title: z.string().nullish(),
  })
  .strict();

const ExaAgentGroundingSchema = z
  .object({
    field: z.string(),
    citations: z.array(ExaAgentCitationSchema),
    confidence: z.enum(["low", "medium", "high"]).nullish(),
  })
  .strict();

const ExaAgentRunSchema = z
  .object({
    id: z.string().min(1).max(200),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    stopReason: z.string().nullish(),
    output: z
      .object({
        text: z.string().max(2_000_000).default(""),
        grounding: z.array(ExaAgentGroundingSchema).default([]),
      })
      .loose()
      .optional(),
    usage: z
      .object({
        agentComputeUnits: z.number().nonnegative().optional(),
        searches: z.number().int().nonnegative().optional(),
      })
      .loose()
      .optional(),
    costDollars: z
      .object({
        total: z.number().nonnegative().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export class ExaProvider
  implements WebSearchProvider, WebFetchProvider, WebRelatedProvider, CodeContextProvider, ResearchProvider
{
  readonly id = "exa" as const;

  constructor(private readonly fetcher: FetchLike = fetch) {}

  async search(request: ProviderSearchRequest): Promise<WebSearchData> {
    const payload: Record<string, unknown> = {
      query: request.input.query,
      numResults: request.input.maxResults,
      contents: { text: { maxCharacters: 2_000 } },
    };
    if (request.input.includeDomains.length > 0) payload.includeDomains = request.input.includeDomains;
    if (request.input.excludeDomains.length > 0) payload.excludeDomains = request.input.excludeDomains;

    const value = await postJson(
      this.fetcher,
      "Exa",
      `${request.baseUrl.replace(/\/$/, "")}/search`,
      { "x-api-key": request.apiKey },
      payload,
      request.signal,
    );
    const parsed = ExaSearchResponseSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("web.search");

    const data: WebSearchData = {
      query: request.input.query,
      results: parsed.data.results.map(normalizeSearchResult),
    };
    if (parsed.data.requestId) data.requestId = parsed.data.requestId;
    return data;
  }

  async context(request: ProviderCodeContextRequest): Promise<CodeContextData> {
    const parsed = ExaContextResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Exa",
        `${request.baseUrl.replace(/\/$/, "")}/context`,
        { Authorization: `Bearer ${request.apiKey}` },
        { query: request.input.query, tokensNum: request.input.tokens },
        request.signal,
      ),
    );
    if (!parsed.success) throw invalidResponse("code.context");

    const data: CodeContextData = {
      query: parsed.data.query ?? request.input.query,
      response: parsed.data.response,
    };
    if (parsed.data.resultsCount !== undefined) data.resultsCount = parsed.data.resultsCount;
    if (parsed.data.outputTokens !== undefined) data.outputTokens = parsed.data.outputTokens;
    if (parsed.data.requestId) data.requestId = parsed.data.requestId;
    return data;
  }

  async related(request: ProviderRelatedRequest): Promise<WebRelatedData> {
    const payload: Record<string, unknown> = {
      url: request.input.url,
      numResults: request.input.maxResults,
      contents: { text: { maxCharacters: 2_000 } },
    };
    if (request.input.includeDomains.length > 0) payload.includeDomains = request.input.includeDomains;
    if (request.input.excludeDomains.length > 0) payload.excludeDomains = request.input.excludeDomains;

    const parsed = ExaSearchResponseSchema.safeParse(
      await postJson(
        this.fetcher,
        "Exa",
        `${request.baseUrl.replace(/\/$/, "")}/findSimilar`,
        { "x-api-key": request.apiKey },
        payload,
        request.signal,
      ),
    );
    if (!parsed.success) throw invalidResponse("web.related");

    const data: WebRelatedData = {
      url: request.input.url,
      results: parsed.data.results.map(normalizeSearchResult),
    };
    if (parsed.data.requestId) data.requestId = parsed.data.requestId;
    return data;
  }

  async research(request: ProviderResearchRequest): Promise<ResearchData> {
    let run: z.infer<typeof ExaAgentRunSchema>;
    try {
      const parsed = ExaAgentRunSchema.safeParse(
        await postJson(
          this.fetcher,
          "Exa",
          `${request.baseUrl.replace(/\/$/, "")}/agent/runs`,
          { "x-api-key": request.apiKey },
          {
            query: request.input.prompt,
            systemPrompt: "Prefer authoritative primary sources. Cite every material factual claim.",
            effort: exaEffort(request.input.depth),
          },
          request.signal,
        ),
      );
      if (!parsed.success) throw invalidResponse("research.run");
      run = parsed.data;
    } catch (error) {
      throw withUncertainResearchSubmission(error);
    }

    const jobId = run.id as ResearchJobId;
    const initial = settleExaResearch(request.input.prompt, run, jobId);
    if (initial) return initial;

    try {
      while (true) {
        await waitForPoll(request.pollIntervalMs, request.signal);
        const status = ExaAgentRunSchema.safeParse(
          await requestJson(
            this.fetcher,
            "Exa",
            `${request.baseUrl.replace(/\/$/, "")}/agent/runs/${encodeURIComponent(jobId)}`,
            {
              method: "GET",
              headers: { "x-api-key": request.apiKey },
              ...(request.signal ? { signal: request.signal } : {}),
            },
          ),
        );
        if (!status.success) throw invalidResponse("research.run");
        const result = settleExaResearch(request.input.prompt, status.data, jobId);
        if (result) return result;
      }
    } catch (error) {
      if (hasTerminalResearchEvidence(error)) throw error;
      const settlement = await this.cancelResearch(request, jobId);
      if (settlement?.status === "completed") {
        return normalizeExaResearch(request.input.prompt, settlement, jobId);
      }
      throw withResearchCleanup(error, jobId, settlement?.status);
    }
  }

  async fetch(request: ProviderFetchRequest): Promise<WebFetchData> {
    const value = await postJson(
      this.fetcher,
      "Exa",
      `${request.baseUrl.replace(/\/$/, "")}/contents`,
      { "x-api-key": request.apiKey },
      {
        urls: request.input.urls,
        text: { maxCharacters: request.input.maxCharacters },
      },
      request.signal,
    );
    const parsed = ExaContentsResponseSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("web.fetch");

    const failedUrls = parsed.data.statuses
      .filter((status) => status.status !== "success")
      .map((status) => status.id);
    if (parsed.data.results.length === 0 && failedUrls.length > 0) {
      throw new ProviderError("Exa could not fetch any requested URL.", { kind: "transient" });
    }
    const data: WebFetchData = {
      results: parsed.data.results.map((item) => ({
        url: item.url,
        content: item.text ?? item.summary ?? "",
        ...(item.title ? { title: item.title } : {}),
        ...(item.publishedDate ? { published: item.publishedDate } : {}),
      })),
      failedUrls,
    };
    if (parsed.data.requestId) data.requestId = parsed.data.requestId;
    return data;
  }

  private async cancelResearch(
    request: ProviderResearchRequest,
    jobId: ResearchJobId,
  ): Promise<z.infer<typeof ExaAgentRunSchema> | undefined> {
    try {
      const parsed = ExaAgentRunSchema.safeParse(
        await requestJson(
          this.fetcher,
          "Exa",
          `${request.baseUrl.replace(/\/$/, "")}/agent/runs/${encodeURIComponent(jobId)}/cancel`,
          {
            method: "POST",
            headers: { "x-api-key": request.apiKey },
            signal: AbortSignal.timeout(request.cleanupTimeoutMs),
          },
        ),
      );
      if (!parsed.success || !["completed", "failed", "cancelled"].includes(parsed.data.status)) return undefined;
      return parsed.data;
    } catch {
      return undefined;
    }
  }
}

function normalizeSearchResult(item: z.infer<typeof ExaResultSchema>): WebSearchResult {
  return {
    title: item.title ?? "",
    url: item.url,
    snippet: item.text ?? item.summary ?? "",
    ...(item.score == null ? {} : { score: item.score }),
    ...(item.publishedDate == null ? {} : { published: item.publishedDate }),
  };
}

function settleExaResearch(
  prompt: string,
  run: z.infer<typeof ExaAgentRunSchema>,
  jobId: ResearchJobId,
): ResearchData | undefined {
  switch (run.status) {
    case "queued":
    case "running":
      return undefined;
    case "completed":
      return normalizeExaResearch(prompt, run, jobId);
    case "failed":
    case "cancelled":
      throw researchTerminalError(
        `Exa Research ended with status ${run.status}.`,
        "transient",
        jobId,
        run.status,
      );
  }
}

function normalizeExaResearch(
  prompt: string,
  run: z.infer<typeof ExaAgentRunSchema>,
  jobId: ResearchJobId,
): ResearchData {
  const report = run.output?.text.trim() ?? "";
  if (!report) {
    throw researchTerminalError(
      "Exa completed Research without a report.",
      "invalid-response",
      jobId,
      "completed",
    );
  }

  const sourcesByUrl = new Map<string, ResearchSource>();
  const grounding: ResearchGrounding[] = [];
  for (const item of run.output?.grounding ?? []) {
    const sourceUrls: string[] = [];
    for (const citation of item.citations) {
      const source: ResearchSource = {
        url: citation.url,
        ...(citation.title ? { title: citation.title } : {}),
      };
      if (!sourcesByUrl.has(citation.url)) sourcesByUrl.set(citation.url, source);
      if (!sourceUrls.includes(citation.url)) sourceUrls.push(citation.url);
    }
    grounding.push({
      field: item.field,
      sourceUrls,
      ...(item.confidence ? { confidence: item.confidence } : {}),
    });
  }

  const usage = {
    ...(run.usage?.searches === undefined ? {} : { searches: run.usage.searches }),
    ...(run.usage?.agentComputeUnits === undefined ? {} : { agentComputeUnits: run.usage.agentComputeUnits }),
    ...(run.costDollars?.total === undefined ? {} : { costDollars: run.costDollars.total }),
  };
  return {
    prompt,
    report,
    sources: [...sourcesByUrl.values()],
    status: "completed",
    jobId,
    ...(grounding.length > 0 ? { grounding } : {}),
    ...(run.stopReason ? { stopReason: run.stopReason } : {}),
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
  };
}

function exaEffort(depth: ProviderResearchRequest["input"]["depth"]): "low" | "medium" | "high" {
  switch (depth) {
    case "concise":
      return "low";
    case "standard":
      return "medium";
    case "deep":
      return "high";
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
      : new ProviderError("Unexpected Exa Research submission failure.", { kind: "unknown", cause: error });
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

function withResearchCleanup(
  error: unknown,
  jobId: ResearchJobId,
  settlement: "queued" | "running" | "completed" | "failed" | "cancelled" | undefined,
): ProviderError {
  const primary =
    error instanceof ProviderError
      ? error
      : new ProviderError("Unexpected Exa Research failure.", { kind: "unknown", cause: error });
  const terminalState = settlement === "failed" || settlement === "cancelled" ? settlement : undefined;
  const cleanupOk = terminalState !== undefined;
  return new ProviderError(primary.message, {
    kind: primary.kind,
    ...(primary.status === undefined ? {} : { status: primary.status }),
    ...(primary.retryAfterMs === undefined ? {} : { retryAfterMs: primary.retryAfterMs }),
    safeToRetry: cleanupOk,
    cleanup: { resource: "research-job", jobId, attempted: true, ok: cleanupOk },
    remoteJob: {
      resource: "research-job",
      jobId,
      state: terminalState ?? "possibly-running",
    },
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
  capability: "web.search" | "web.fetch" | "web.related" | "code.context" | "research.run",
): ProviderError {
  return new ProviderError(`Exa returned a response that does not match the ${capability} contract.`, {
    kind: "invalid-response",
  });
}
