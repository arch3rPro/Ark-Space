import { z } from "zod";

import {
  EXA_PROVIDER_IDS,
  FIRECRAWL_PROVIDER_IDS,
  PROTOCOL_VERSION,
  PROVIDER_IDS,
  RESEARCH_PROVIDER_IDS,
  WEB_CRAWL_PROVIDER_IDS,
  WEB_MAP_PROVIDER_IDS,
  type CodeContextInput,
  type JsonObject,
  type ResearchInput,
  type WebCrawlInput,
  type WebExtractInput,
  type WebFetchInput,
  type WebMapInput,
  type WebRelatedInput,
  type WebSearchInput,
} from "./types.js";

const DomainSchema = z.string().trim().min(1).max(253);
const PathPatternSchema = z.string().trim().min(1).max(500);
const JsonObjectSchema = z.record(z.string(), z.json()).superRefine(validateExtractionSchema);
const HttpUrlSchema = z
  .string()
  .url()
  .max(4_096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "URLs must use HTTP(S) and must not contain credentials");

export const WebSearchRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("web.search"),
    input: z
      .object({
        query: z.string().trim().min(1).max(2_000),
        maxResults: z.number().int().min(1).max(20).default(5),
        timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
        provider: z.enum(PROVIDER_IDS).optional(),
        includeDomains: z.array(DomainSchema).max(20).default([]),
        excludeDomains: z.array(DomainSchema).max(20).default([]),
      })
      .strict(),
  })
  .strict();

export const WebFetchRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("web.fetch"),
    input: z
      .object({
        urls: z.array(HttpUrlSchema).min(1).max(20),
        timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
        provider: z.enum(PROVIDER_IDS).optional(),
        mode: z.enum(["raw", "readable"]).default("readable"),
        onlyMainContent: z.boolean().default(true),
        maxCharacters: z.number().int().min(1_000).max(100_000).default(20_000),
      })
      .strict(),
  })
  .strict();

export const WebMapRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("web.map"),
    input: z
      .object({
        url: HttpUrlSchema,
        query: z.string().trim().min(1).max(2_000).optional(),
        maxResults: z.number().int().min(1).max(500).default(100),
        timeoutMs: z.number().int().min(1_000).max(150_000).default(60_000),
        provider: z.enum(WEB_MAP_PROVIDER_IDS).optional(),
      })
      .strict(),
  })
  .strict();

export const WebCrawlRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("web.crawl"),
    input: z
      .object({
        url: HttpUrlSchema,
        query: z.string().trim().min(1).max(2_000).optional(),
        maxPages: z.number().int().min(1).max(100).default(20),
        maxDepth: z.number().int().min(1).max(5).default(2),
        timeoutMs: z.number().int().min(10_000).max(300_000).default(120_000),
        maxCharacters: z.number().int().min(1_000).max(100_000).default(20_000),
        onlyMainContent: z.boolean().default(true),
        includePaths: z.array(PathPatternSchema).max(50).default([]),
        excludePaths: z.array(PathPatternSchema).max(50).default([]),
        provider: z.enum(WEB_CRAWL_PROVIDER_IDS).optional(),
      })
      .strict(),
  })
  .strict();

export const WebRelatedRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("web.related"),
    input: z
      .object({
        url: HttpUrlSchema,
        maxResults: z.number().int().min(1).max(20).default(5),
        timeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
        includeDomains: z.array(DomainSchema).max(20).default([]),
        excludeDomains: z.array(DomainSchema).max(20).default([]),
        provider: z.enum(EXA_PROVIDER_IDS).optional(),
      })
      .strict(),
  })
  .strict();

export const CodeContextRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("code.context"),
    input: z
      .object({
        query: z.string().trim().min(1).max(2_000),
        tokens: z.union([z.literal("dynamic"), z.number().int().min(1_000).max(50_000)]).default("dynamic"),
        timeoutMs: z.number().int().min(1_000).max(120_000).default(60_000),
        provider: z.enum(EXA_PROVIDER_IDS).optional(),
      })
      .strict(),
  })
  .strict();

export const ResearchRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("research.run"),
    input: z
      .object({
        prompt: z.string().trim().min(1).max(10_000),
        depth: z.enum(["concise", "standard", "deep"]).default("standard"),
        timeoutMs: z.number().int().min(10_000).max(1_800_000).default(600_000),
        provider: z.enum(RESEARCH_PROVIDER_IDS).optional(),
      })
      .strict(),
  })
  .strict();

export const WebExtractRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capability: z.literal("web.extract"),
    input: z
      .object({
        urls: z.array(HttpUrlSchema).min(1).max(20),
        prompt: z.string().trim().min(1).max(4_000),
        schema: JsonObjectSchema,
        timeoutMs: z.number().int().min(30_000).max(600_000).default(300_000),
        onlyMainContent: z.boolean().default(true),
        provider: z.enum(FIRECRAWL_PROVIDER_IDS).optional(),
      })
      .strict(),
  })
  .strict();

export interface WebSearchRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "web.search";
  input: WebSearchInput;
}

export function parseWebSearchRequest(value: unknown): WebSearchRequest {
  const parsed = WebSearchRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeSearchInput(parsed.input),
  };
}

export interface WebFetchRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "web.fetch";
  input: WebFetchInput;
}

export function parseWebFetchRequest(value: unknown): WebFetchRequest {
  const parsed = WebFetchRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeFetchInput(parsed.input),
  };
}

export interface WebMapRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "web.map";
  input: WebMapInput;
}

export function parseWebMapRequest(value: unknown): WebMapRequest {
  const parsed = WebMapRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeMapInput(parsed.input),
  };
}

export interface WebCrawlRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "web.crawl";
  input: WebCrawlInput;
}

export function parseWebCrawlRequest(value: unknown): WebCrawlRequest {
  const parsed = WebCrawlRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeCrawlInput(parsed.input),
  };
}

export interface WebRelatedRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "web.related";
  input: WebRelatedInput;
}

export function parseWebRelatedRequest(value: unknown): WebRelatedRequest {
  const parsed = WebRelatedRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeRelatedInput(parsed.input),
  };
}

export interface CodeContextRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "code.context";
  input: CodeContextInput;
}

export function parseCodeContextRequest(value: unknown): CodeContextRequest {
  const parsed = CodeContextRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeCodeContextInput(parsed.input),
  };
}

export interface ResearchRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "research.run";
  input: ResearchInput;
}

export function parseResearchRequest(value: unknown): ResearchRequest {
  const parsed = ResearchRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeResearchInput(parsed.input),
  };
}

export interface WebExtractRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  capability: "web.extract";
  input: WebExtractInput;
}

export function parseWebExtractRequest(value: unknown): WebExtractRequest {
  const parsed = WebExtractRequestSchema.parse(value);
  return {
    protocolVersion: parsed.protocolVersion,
    capability: parsed.capability,
    input: normalizeExtractInput(parsed.input),
  };
}

export function resolveWebSearchInput(input: Partial<WebSearchInput> & Pick<WebSearchInput, "query">): WebSearchInput {
  return normalizeSearchInput(WebSearchRequestSchema.shape.input.parse(input));
}

export function resolveWebFetchInput(input: Partial<WebFetchInput> & Pick<WebFetchInput, "urls">): WebFetchInput {
  return normalizeFetchInput(WebFetchRequestSchema.shape.input.parse(input));
}

export function resolveWebMapInput(input: Partial<WebMapInput> & Pick<WebMapInput, "url">): WebMapInput {
  return normalizeMapInput(WebMapRequestSchema.shape.input.parse(input));
}

export function resolveWebCrawlInput(input: Partial<WebCrawlInput> & Pick<WebCrawlInput, "url">): WebCrawlInput {
  return normalizeCrawlInput(WebCrawlRequestSchema.shape.input.parse(input));
}

export function resolveWebRelatedInput(input: Partial<WebRelatedInput> & Pick<WebRelatedInput, "url">): WebRelatedInput {
  return normalizeRelatedInput(WebRelatedRequestSchema.shape.input.parse(input));
}

export function resolveCodeContextInput(
  input: Partial<CodeContextInput> & Pick<CodeContextInput, "query">,
): CodeContextInput {
  return normalizeCodeContextInput(CodeContextRequestSchema.shape.input.parse(input));
}

export function resolveWebExtractInput(
  input: Omit<Partial<WebExtractInput>, "schema"> & Pick<WebExtractInput, "urls" | "prompt"> & { schema: unknown },
): WebExtractInput {
  return normalizeExtractInput(WebExtractRequestSchema.shape.input.parse(input));
}

export function resolveResearchInput(
  input: Partial<ResearchInput> & Pick<ResearchInput, "prompt">,
): ResearchInput {
  return normalizeResearchInput(ResearchRequestSchema.shape.input.parse(input));
}

function normalizeSearchInput(input: z.infer<typeof WebSearchRequestSchema.shape.input>): WebSearchInput {
  return {
    query: input.query,
    maxResults: input.maxResults,
    timeoutMs: input.timeoutMs,
    includeDomains: input.includeDomains,
    excludeDomains: input.excludeDomains,
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function normalizeFetchInput(input: z.infer<typeof WebFetchRequestSchema.shape.input>): WebFetchInput {
  return {
    urls: input.urls,
    timeoutMs: input.timeoutMs,
    onlyMainContent: input.onlyMainContent,
    maxCharacters: input.maxCharacters,
    mode: input.mode,
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function normalizeMapInput(input: z.infer<typeof WebMapRequestSchema.shape.input>): WebMapInput {
  return {
    url: input.url,
    maxResults: input.maxResults,
    timeoutMs: input.timeoutMs,
    ...(input.query ? { query: input.query } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function normalizeCrawlInput(input: z.infer<typeof WebCrawlRequestSchema.shape.input>): WebCrawlInput {
  return {
    url: input.url,
    maxPages: input.maxPages,
    maxDepth: input.maxDepth,
    timeoutMs: input.timeoutMs,
    maxCharacters: input.maxCharacters,
    onlyMainContent: input.onlyMainContent,
    includePaths: input.includePaths,
    excludePaths: input.excludePaths,
    ...(input.query ? { query: input.query } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function normalizeRelatedInput(input: z.infer<typeof WebRelatedRequestSchema.shape.input>): WebRelatedInput {
  return {
    url: input.url,
    maxResults: input.maxResults,
    timeoutMs: input.timeoutMs,
    includeDomains: input.includeDomains,
    excludeDomains: input.excludeDomains,
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function normalizeCodeContextInput(input: z.infer<typeof CodeContextRequestSchema.shape.input>): CodeContextInput {
  return {
    query: input.query,
    tokens: input.tokens,
    timeoutMs: input.timeoutMs,
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function normalizeResearchInput(input: z.infer<typeof ResearchRequestSchema.shape.input>): ResearchInput {
  return {
    prompt: input.prompt,
    depth: input.depth,
    timeoutMs: input.timeoutMs,
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function normalizeExtractInput(input: z.infer<typeof WebExtractRequestSchema.shape.input>): WebExtractInput {
  return {
    urls: input.urls,
    prompt: input.prompt,
    schema: input.schema as JsonObject,
    timeoutMs: input.timeoutMs,
    onlyMainContent: input.onlyMainContent,
    ...(input.provider ? { provider: input.provider } : {}),
  };
}

function validateExtractionSchema(schema: Record<string, unknown>, context: z.RefinementCtx): void {
  const bytes = new TextEncoder().encode(JSON.stringify(schema)).byteLength;
  if (bytes > 65_536) {
    context.addIssue({ code: "custom", message: "Extraction schema must not exceed 65536 bytes." });
    return;
  }
  if (schema.type !== "object") {
    context.addIssue({ code: "custom", message: "Extraction schema must declare type: object." });
  }

  let nodes = 0;
  const pending: Array<{ value: unknown; depth: number }> = [{ value: schema, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > 500 || current.depth > 12) {
      context.addIssue({ code: "custom", message: "Extraction schema is too complex." });
      return;
    }
    if (Array.isArray(current.value)) {
      for (const value of current.value) pending.push({ value, depth: current.depth + 1 });
      continue;
    }
    if (current.value && typeof current.value === "object") {
      const record = current.value as Record<string, unknown>;
      if ("$ref" in record) {
        context.addIssue({ code: "custom", message: "Extraction schema must not contain $ref." });
        return;
      }
      if ("pattern" in record || "patternProperties" in record) {
        context.addIssue({ code: "custom", message: "Extraction schema must not contain regular expressions." });
        return;
      }
      for (const value of Object.values(record)) pending.push({ value, depth: current.depth + 1 });
    }
  }
}
