import { z } from "zod";

import {
  EXA_PROVIDER_IDS,
  FAILURE_KINDS,
  FIRECRAWL_PROVIDER_IDS,
  PROTOCOL_VERSION,
  PROVIDER_IDS,
  RESEARCH_PROVIDER_IDS,
  WEB_CRAWL_PROVIDER_IDS,
  WEB_MAP_PROVIDER_IDS,
} from "./types.js";

const ResultSchema = z
  .object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    score: z.number().optional(),
    published: z.string().optional(),
  })
  .strict();

const AttemptSchema = z
  .object({
    provider: z.enum(PROVIDER_IDS),
    keyId: z.string().regex(/^[a-f0-9]{16}$/).optional(),
    ok: z.boolean(),
    errorKind: z.enum(FAILURE_KINDS).optional(),
    status: z.number().int().optional(),
    retryable: z.boolean().optional(),
    safeToRetry: z.boolean().optional(),
    cleanup: z
      .discriminatedUnion("resource", [
        z.object({ resource: z.literal("crawl-job"), attempted: z.literal(true), ok: z.boolean() }).strict(),
        z
          .object({
            resource: z.literal("research-job"),
            jobId: z.string(),
            attempted: z.literal(true),
            ok: z.boolean(),
          })
          .strict(),
        z
          .object({
            resource: z.literal("browser-session"),
            sessionId: z.string(),
            attempted: z.literal(true),
            ok: z.boolean(),
          })
          .strict(),
        z
          .object({
            resource: z.literal("monitor"),
            monitorId: z.string(),
            attempted: z.literal(true),
            ok: z.boolean(),
          })
          .strict(),
        z
          .object({
            resource: z.literal("site-monitor"),
            monitorId: z.string(),
            attempted: z.literal(true),
            ok: z.boolean(),
          })
          .strict(),
      ])
      .optional(),
    submission: z
      .discriminatedUnion("resource", [
        z.object({ resource: z.literal("research-job"), state: z.literal("acceptance-unknown") }).strict(),
        z.object({ resource: z.literal("browser-session"), state: z.literal("acceptance-unknown") }).strict(),
        z.object({ resource: z.literal("monitor"), state: z.literal("acceptance-unknown") }).strict(),
        z.object({ resource: z.literal("site-monitor"), state: z.literal("acceptance-unknown") }).strict(),
      ])
      .optional(),
    remoteJob: z
      .discriminatedUnion("resource", [
        z
          .object({
            resource: z.literal("extract-job"),
            jobId: z.string(),
            state: z.literal("possibly-running"),
          })
          .strict(),
        z
          .object({
            resource: z.literal("research-job"),
            jobId: z.string(),
            state: z.enum(["possibly-running", "completed", "failed", "cancelled"]),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

const CommonEnvelopeShape = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  attempts: z.array(AttemptSchema),
  warnings: z.array(z.string()),
};

const FailureShape = {
  ...CommonEnvelopeShape,
  ok: z.literal(false),
  error: z
    .object({
      kind: z.enum(FAILURE_KINDS),
      message: z.string(),
      retryable: z.boolean(),
      correction: z.string().optional(),
    })
    .strict(),
};

export const WebSearchSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("web.search"),
    ok: z.literal(true),
    provider: z.enum(PROVIDER_IDS),
    data: z
      .object({
        query: z.string(),
        results: z.array(ResultSchema),
        answer: z.string().optional(),
        requestId: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const WebSearchFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("web.search"),
  })
  .strict();

export const WebSearchEnvelopeSchema = z.discriminatedUnion("ok", [
  WebSearchSuccessEnvelopeSchema,
  WebSearchFailureEnvelopeSchema,
]);

const FetchResultSchema = z
  .object({
    url: z.string(),
    content: z.string(),
    responseId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
    title: z.string().optional(),
    published: z.string().optional(),
    images: z.array(z.string()).optional(),
  })
  .strict();

export const WebFetchSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("web.fetch"),
    ok: z.literal(true),
    provider: z.enum(PROVIDER_IDS),
    data: z
      .object({
        results: z.array(FetchResultSchema),
        failedUrls: z.array(z.string()),
        requestId: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const WebFetchFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("web.fetch"),
  })
  .strict();

export const WebFetchEnvelopeSchema = z.discriminatedUnion("ok", [
  WebFetchSuccessEnvelopeSchema,
  WebFetchFailureEnvelopeSchema,
]);

export const WebContentGetEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ...CommonEnvelopeShape, capability: z.literal("web.content.get"), ok: z.literal(true), provider: z.literal("local"), data: z.object({ responseId: z.string().regex(/^[a-f0-9]{32}$/), content: z.string(), offset: z.number().int().nonnegative(), limit: z.number().int().positive(), totalLength: z.number().int().nonnegative(), matchIndex: z.number().int().nonnegative().optional() }).strict() }).strict(),
  z.object({ ...FailureShape, capability: z.literal("web.content.get") }).strict(),
]);

const MapLinkSchema = z
  .object({
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export const WebMapSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("web.map"),
    ok: z.literal(true),
    provider: z.enum(WEB_MAP_PROVIDER_IDS),
    data: z
      .object({
        baseUrl: z.string(),
        links: z.array(MapLinkSchema),
        requestId: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const WebMapFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("web.map"),
  })
  .strict();

export const WebMapEnvelopeSchema = z.discriminatedUnion("ok", [
  WebMapSuccessEnvelopeSchema,
  WebMapFailureEnvelopeSchema,
]);

const CrawlPageSchema = z
  .object({
    url: z.string(),
    content: z.string(),
    title: z.string().optional(),
  })
  .strict();

export const WebCrawlSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("web.crawl"),
    ok: z.literal(true),
    provider: z.enum(WEB_CRAWL_PROVIDER_IDS),
    data: z
      .object({
        baseUrl: z.string(),
        pages: z.array(CrawlPageSchema),
        failedUrls: z.array(z.string()),
        requestId: z.string().optional(),
        jobId: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const WebCrawlFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("web.crawl"),
  })
  .strict();

export const WebCrawlEnvelopeSchema = z.discriminatedUnion("ok", [
  WebCrawlSuccessEnvelopeSchema,
  WebCrawlFailureEnvelopeSchema,
]);

export const WebRelatedSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("web.related"),
    ok: z.literal(true),
    provider: z.enum(EXA_PROVIDER_IDS),
    data: z
      .object({
        url: z.string(),
        results: z.array(ResultSchema),
        requestId: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const WebRelatedFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("web.related"),
  })
  .strict();

export const WebRelatedEnvelopeSchema = z.discriminatedUnion("ok", [
  WebRelatedSuccessEnvelopeSchema,
  WebRelatedFailureEnvelopeSchema,
]);

export const CodeContextSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("code.context"),
    ok: z.literal(true),
    provider: z.enum(EXA_PROVIDER_IDS),
    data: z
      .object({
        query: z.string(),
        response: z.string(),
        resultsCount: z.number().int().optional(),
        outputTokens: z.number().int().optional(),
        requestId: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const CodeContextFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("code.context"),
  })
  .strict();

export const CodeContextEnvelopeSchema = z.discriminatedUnion("ok", [
  CodeContextSuccessEnvelopeSchema,
  CodeContextFailureEnvelopeSchema,
]);

export const WebExtractSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("web.extract"),
    ok: z.literal(true),
    provider: z.enum(FIRECRAWL_PROVIDER_IDS),
    data: z
      .object({
        data: z.json(),
        sources: z.array(z.string()),
        invalidUrls: z.array(z.string()),
        jobId: z.string(),
      })
      .strict(),
  })
  .strict();

export const WebExtractFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("web.extract"),
  })
  .strict();

export const WebExtractEnvelopeSchema = z.discriminatedUnion("ok", [
  WebExtractSuccessEnvelopeSchema,
  WebExtractFailureEnvelopeSchema,
]);

const ResearchSourceSchema = z
  .object({
    url: z.string().url(),
    title: z.string().optional(),
  })
  .strict();

const ResearchEvidenceArtifactSchema = z.object({
  status: z.literal("source-level-only"),
  passageEvidenceAvailable: z.literal(false),
  sources: z.array(z.object({
    id: z.string().regex(/^src_[a-f0-9]{32}$/),
    url: z.string().url(),
    title: z.string().optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict()),
}).strict();

export const ResearchSuccessEnvelopeSchema = z
  .object({
    ...CommonEnvelopeShape,
    capability: z.literal("research.run"),
    ok: z.literal(true),
    provider: z.enum(RESEARCH_PROVIDER_IDS),
    data: z
      .object({
        prompt: z.string(),
        report: z.string(),
        sources: z.array(ResearchSourceSchema),
        evidenceArtifact: ResearchEvidenceArtifactSchema.optional(),
        status: z.literal("completed"),
        jobId: z.string(),
        grounding: z
          .array(
            z
              .object({
                field: z.string(),
                sourceUrls: z.array(z.string().url()),
                confidence: z.enum(["low", "medium", "high"]).optional(),
              })
              .strict(),
          )
          .optional(),
        stopReason: z.string().optional(),
        usage: z
          .object({
            credits: z.number().nonnegative().optional(),
            searches: z.number().int().nonnegative().optional(),
            agentComputeUnits: z.number().nonnegative().optional(),
            costDollars: z.number().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export const ResearchFailureEnvelopeSchema = z
  .object({
    ...FailureShape,
    capability: z.literal("research.run"),
  })
  .strict();

export const ResearchEnvelopeSchema = z.discriminatedUnion("ok", [
  ResearchSuccessEnvelopeSchema,
  ResearchFailureEnvelopeSchema,
]);

const BrowserSessionDataSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["active", "closed", "expired", "unknown"]),
  createdAt: z.string().optional(),
  expiresAt: z.string().optional(),
  lastActivityAt: z.string().optional(),
}).strict();
const BrowserSnapshotDataSchema = BrowserSessionDataSchema.extend({ snapshot: z.string(), truncated: z.boolean() }).strict();
const BrowserInteractDataSchema = BrowserSessionDataSchema.extend({ output: z.string(), exitCode: z.number().int(), killed: z.boolean(), truncated: z.boolean() }).strict();
const MonitorDataSchema = z.object({
  monitorId: z.string(),
  name: z.string().optional(),
  status: z.enum(["active", "paused", "disabled", "unknown"]),
  query: z.string().optional(),
  numResults: z.number().int().optional(),
  period: z.string().optional(),
  nextRunAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  webhookSecretStored: z.boolean().optional(),
  triggered: z.boolean().optional(),
}).strict();
const MonitorRunDataSchema = z.object({
  runId: z.string(),
  monitorId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "unknown"]),
  results: z.array(ResultSchema),
  summary: z.string().optional(),
  failReason: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().int().optional(),
}).strict();

function resourceEnvelope<C extends string>(capability: C, provider: "exa" | "firecrawl", data: z.ZodType) {
  return z.discriminatedUnion("ok", [
    z.object({ ...CommonEnvelopeShape, capability: z.literal(capability), ok: z.literal(true), provider: z.literal(provider), data }).strict(),
    z.object({ ...FailureShape, capability: z.literal(capability) }).strict(),
  ]);
}

const SiteMonitorSummarySchema = z.object({ totalPages: z.number().int(), same: z.number().int(), changed: z.number().int(), new: z.number().int(), removed: z.number().int(), error: z.number().int() }).strict();
const SiteMonitorDataSchema = z.object({
  monitorId: z.string(), name: z.string().optional(), status: z.enum(["active", "paused", "deleted", "unknown"]),
  schedule: z.object({ cron: z.string(), timezone: z.string() }).strict().optional(),
  targetTypes: z.array(z.enum(["scrape", "crawl", "search"])), retentionDays: z.number().int().optional(), goal: z.string().optional(), judgeEnabled: z.boolean().optional(), nextRunAt: z.string().optional(), lastRunAt: z.string().optional(), currentCheckId: z.string().optional(), estimatedCreditsPerMonth: z.number().int().optional(), lastCheckSummary: SiteMonitorSummarySchema.optional(), createdAt: z.string().optional(), updatedAt: z.string().optional(),
}).strict();
const SiteMonitorCheckDataSchema = z.object({
  checkId: z.string(), monitorId: z.string(), status: z.enum(["queued", "running", "completed", "failed", "partial", "skipped_overlap", "skipped_no_credits", "unknown"]), trigger: z.enum(["scheduled", "manual"]).optional(), estimatedCredits: z.number().int().optional(), actualCredits: z.number().int().optional(), billingStatus: z.string().optional(), summary: SiteMonitorSummarySchema.optional(), error: z.string().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional(), pages: z.array(z.object({ url: z.string(), status: z.enum(["same", "new", "changed", "removed", "error", "unknown"]), statusCode: z.number().int().optional(), error: z.string().optional(), diffText: z.string().optional() }).strict()),
}).strict();

export const ResourceEnvelopeSchemas = {
  "browser.open": resourceEnvelope("browser.open", "firecrawl", BrowserSessionDataSchema),
  "browser.snapshot": resourceEnvelope("browser.snapshot", "firecrawl", BrowserSnapshotDataSchema),
  "browser.interact": resourceEnvelope("browser.interact", "firecrawl", BrowserInteractDataSchema),
  "browser.status": resourceEnvelope("browser.status", "firecrawl", BrowserSessionDataSchema),
  "browser.close": resourceEnvelope("browser.close", "firecrawl", BrowserSessionDataSchema),
  "monitor.create": resourceEnvelope("monitor.create", "exa", MonitorDataSchema),
  "monitor.list": resourceEnvelope("monitor.list", "exa", z.object({ monitors: z.array(MonitorDataSchema) }).strict()),
  "monitor.status": resourceEnvelope("monitor.status", "exa", MonitorDataSchema),
  "monitor.update": resourceEnvelope("monitor.update", "exa", MonitorDataSchema),
  "monitor.pause": resourceEnvelope("monitor.pause", "exa", MonitorDataSchema),
  "monitor.resume": resourceEnvelope("monitor.resume", "exa", MonitorDataSchema),
  "monitor.trigger": resourceEnvelope("monitor.trigger", "exa", MonitorDataSchema),
  "monitor.delete": resourceEnvelope("monitor.delete", "exa", MonitorDataSchema),
  "monitor.runs": resourceEnvelope("monitor.runs", "exa", z.object({ monitorId: z.string(), runs: z.array(MonitorRunDataSchema) }).strict()),
  "monitor.run.get": resourceEnvelope("monitor.run.get", "exa", MonitorRunDataSchema),
  "monitor.site.create": resourceEnvelope("monitor.site.create", "firecrawl", SiteMonitorDataSchema),
  "monitor.site.list": resourceEnvelope("monitor.site.list", "firecrawl", z.object({ monitors: z.array(SiteMonitorDataSchema) }).strict()),
  "monitor.site.status": resourceEnvelope("monitor.site.status", "firecrawl", SiteMonitorDataSchema),
  "monitor.site.update": resourceEnvelope("monitor.site.update", "firecrawl", SiteMonitorDataSchema),
  "monitor.site.pause": resourceEnvelope("monitor.site.pause", "firecrawl", SiteMonitorDataSchema),
  "monitor.site.resume": resourceEnvelope("monitor.site.resume", "firecrawl", SiteMonitorDataSchema),
  "monitor.site.trigger": resourceEnvelope("monitor.site.trigger", "firecrawl", SiteMonitorCheckDataSchema),
  "monitor.site.delete": resourceEnvelope("monitor.site.delete", "firecrawl", SiteMonitorDataSchema),
  "monitor.site.checks": resourceEnvelope("monitor.site.checks", "firecrawl", z.object({ monitorId: z.string(), checks: z.array(SiteMonitorCheckDataSchema) }).strict()),
  "monitor.site.check.get": resourceEnvelope("monitor.site.check.get", "firecrawl", SiteMonitorCheckDataSchema),
} as const;
