import { z } from "zod";
import { WEKNORA_VERIFY_FAILURE_KINDS } from "./weknora-schema.js";

export const WEKNORA_RETRIEVAL_CAPABILITIES = ["weknora.knowledge-bases.list", "weknora.knowledge-bases.get", "weknora.search"] as const;
export type WeknoraRetrievalCapability = (typeof WEKNORA_RETRIEVAL_CAPABILITIES)[number];
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const consent = { confirmed: z.literal(true), allowHttp: z.boolean().default(false).describe("Ignored compatibility field; not required for HTTP. Network access still requires confirmed=true."), timeoutMs: z.number().int().min(1).max(30_000).default(5_000) };
export const WeknoraListRequestSchema = z.object({ protocolVersion: z.literal(1), capability: z.literal("weknora.knowledge-bases.list"), input: z.object({ ...consent, page: z.number().int().min(1).max(10_000).default(1), pageSize: z.number().int().min(1).max(100).default(20) }).strict() }).strict();
export const WeknoraGetRequestSchema = z.object({ protocolVersion: z.literal(1), capability: z.literal("weknora.knowledge-bases.get"), input: z.object({ ...consent, knowledgeBaseId: id.optional() }).strict() }).strict();
export const WeknoraSearchRequestSchema = z.object({ protocolVersion: z.literal(1), capability: z.literal("weknora.search"), input: z.object({ ...consent, knowledgeBaseId: id.optional(), query: z.string().min(1).max(4_000).refine(value => value.trim().length > 0), limit: z.number().int().min(1).max(100).default(5) }).strict() }).strict();
export const WeknoraRetrievalRequestSchemas = { "weknora.knowledge-bases.list": WeknoraListRequestSchema, "weknora.knowledge-bases.get": WeknoraGetRequestSchema, "weknora.search": WeknoraSearchRequestSchema } as const;
export const WeknoraRetrievalRequestSchema = z.discriminatedUnion("capability", [WeknoraListRequestSchema, WeknoraGetRequestSchema, WeknoraSearchRequestSchema]);
const bounded = (max: number) => z.string().max(max);
export const WeknoraKnowledgeBaseSchema = z.object({
  id, name: bounded(1_000), description: bounded(16_000).optional(), type: bounded(128).optional(),
  capabilities: z.object({ vector: z.boolean(), keyword: z.boolean(), wiki: z.boolean(), graph: z.boolean(), faq: z.boolean() }).strict(),
}).strict();
// Explicit projection of pinned types.SearchResult; coordinates omitted because context
// enrichment may rewrite the body and its internal trust flags are not serialized.
export const WeknoraSearchResultSchema = z.object({
  id, knowledge_id: id, knowledge_title: bounded(2_000), content: bounded(100_000), score: z.number().finite().optional(),
  knowledge_base_id: id.optional(), chunk_index: z.number().int().min(0).max(1_000_000).optional(), match_type: z.number().int().min(0).max(9).optional(),
  metadata: z.record(bounded(256), bounded(4_000)).refine(value => Object.keys(value).length <= 50).nullable().optional(),
  knowledge_filename: bounded(2_000).optional(), knowledge_source: bounded(4_000).optional(),
  knowledge_description: bounded(16_000).optional(), knowledge_custom_metadata: bounded(16_000).optional(),
}).strict();
export const WEKNORA_RETRIEVAL_FAILURE_KINDS = [...WEKNORA_VERIFY_FAILURE_KINDS, "no-index", "knowledge-base-required"] as const;
export type WeknoraRetrievalFailureKind = (typeof WEKNORA_RETRIEVAL_FAILURE_KINDS)[number];
const common = { protocolVersion: z.literal(1), connection: z.literal("weknora"), warnings: z.array(bounded(1_000)).max(10) };
const failure = (capability: WeknoraRetrievalCapability) => z.object({ ...common, capability: z.literal(capability), ok: z.literal(false), source: z.enum(["managed", "environment"]).optional(), error: z.object({ kind: z.enum(WEKNORA_RETRIEVAL_FAILURE_KINDS), message: bounded(2_000), retryable: z.literal(false), status: z.number().int().min(100).max(599).optional() }).strict() }).strict();
const success = <T extends z.ZodType>(capability: WeknoraRetrievalCapability, data: T) => z.object({ ...common, capability: z.literal(capability), ok: z.literal(true), source: z.enum(["managed", "environment"]), data }).strict();
export const WeknoraListDataSchema = z.object({ knowledgeBases: z.array(WeknoraKnowledgeBaseSchema).max(100), total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), page: z.number().int().min(1).max(10_000).optional(), pageSize: z.number().int().min(1).max(100).optional() }).strict();
export const WeknoraGetDataSchema = z.object({ knowledgeBase: WeknoraKnowledgeBaseSchema }).strict();
export const WeknoraSearchDataSchema = z.object({ knowledgeBaseId: id, query: bounded(4_000), results: z.array(WeknoraSearchResultSchema).max(100) }).strict();
export const WeknoraRetrievalEnvelopeSchemas = {
  "weknora.knowledge-bases.list": z.discriminatedUnion("ok", [success("weknora.knowledge-bases.list", WeknoraListDataSchema), failure("weknora.knowledge-bases.list")]),
  "weknora.knowledge-bases.get": z.discriminatedUnion("ok", [success("weknora.knowledge-bases.get", WeknoraGetDataSchema), failure("weknora.knowledge-bases.get")]),
  "weknora.search": z.discriminatedUnion("ok", [success("weknora.search", WeknoraSearchDataSchema), failure("weknora.search")]),
} as const;
export type WeknoraRetrievalEnvelope = z.infer<(typeof WeknoraRetrievalEnvelopeSchemas)[WeknoraRetrievalCapability]>;
