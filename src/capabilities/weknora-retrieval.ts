import { z } from "zod";
import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { isToolEnabled } from "../config/schema.js";
import { resolveWeknoraConnection } from "../config/weknora.js";
import { LocalHttpError, localHttpWeknoraRetrieve } from "../providers/local-http.js";
import { WeknoraGetDataSchema, WeknoraKnowledgeBaseSchema, WeknoraListDataSchema, WeknoraRetrievalEnvelopeSchemas, WeknoraRetrievalRequestSchema, WeknoraSearchDataSchema, WeknoraSearchResultSchema, type WeknoraRetrievalCapability, type WeknoraRetrievalEnvelope, type WeknoraRetrievalFailureKind } from "../protocol/weknora-retrieval-schema.js";

const upstreamKb = WeknoraKnowledgeBaseSchema.strip();
const upstreamResult = WeknoraSearchResultSchema.strip();
const envelope = z.object({ success: z.boolean(), data: z.unknown(), total: z.unknown().optional(), page: z.unknown().optional(), page_size: z.unknown().optional() });

/** Read-only list/detail and single-KB search. One operation budget, no retry,
 * key rotation, fallback, durable state or implicit document verification. */
export async function executeWeknoraRetrieval(capability: WeknoraRetrievalCapability, request: unknown, paths: ArkSpacePaths, originalEnvironment: NodeJS.ProcessEnv | undefined, signal?: AbortSignal): Promise<WeknoraRetrievalEnvelope> {
  let source: "managed" | "environment" | undefined;
  let warnings: string[] = [];
  const fail = (kind: WeknoraRetrievalFailureKind, status?: number): WeknoraRetrievalEnvelope => WeknoraRetrievalEnvelopeSchemas[capability].parse({
    protocolVersion: 1, capability, connection: "weknora", ok: false, ...(source ? { source } : {}), warnings,
    error: { kind, message: `WeKnora retrieval failed (${kind}).${kind === "permission" ? " Check key capabilities and KB scope; 403 is not proof of an invalid key. No fallback was attempted." : kind === "no-index" ? " This KB has neither vector nor keyword retrieval enabled." : kind === "knowledge-base-required" ? " Supply knowledgeBaseId or configure a managed default." : ""}`, retryable: false, ...(status !== undefined ? { status } : {}) },
  });
  const parsed = WeknoraRetrievalRequestSchema.safeParse(request);
  if (!parsed.success || parsed.data.capability !== capability) return fail("invalid-request");
  if (!originalEnvironment) return fail("config");
  const controller = new AbortController();
  const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const deadline = Date.now() + parsed.data.input.timeoutMs;
  const timer = setTimeout(() => controller.abort(), parsed.data.input.timeoutMs);
  const interrupted = () => fail(signal?.aborted ? "cancelled" : "timeout");
  let abort: (() => void) | undefined;
  try {
    const operation = async (): Promise<WeknoraRetrievalEnvelope> => {
      let connection;
      try {
        const config = await loadConfig(paths.config);
        if (!isToolEnabled(config, capability)) return fail("invalid-request");
        connection = await resolveWeknoraConnection(config, paths.credentials, originalEnvironment);
      } catch { return fail("config"); }
      if (active.aborted) return interrupted();
      if (!connection) return fail("config");
      source = connection.source; warnings = connection.warnings;
      const fetch = async (target: Parameters<typeof localHttpWeknoraRetrieve>[2]) => {
        if (active.aborted || Date.now() >= deadline) throw new LocalHttpError("timeout");
        const response = await localHttpWeknoraRetrieve(connection.baseUrl, connection.apiKey, target, { allowRanges: connection.allowRanges, timeoutMs: deadline - Date.now(), signal: active });
        if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i.test(response.contentType)) throw new LocalHttpError("content-type");
        const body = envelope.parse(JSON.parse(response.text));
        if (!body.success) return { failure: fail("business-failure", response.status) } as const;
        // Reject an echoed credential rather than returning raw text or logging it.
        if (JSON.stringify(body).includes(connection.apiKey)) return { failure: fail("invalid-response") } as const;
        return { body } as const;
      };
      const success = (data: unknown): WeknoraRetrievalEnvelope => WeknoraRetrievalEnvelopeSchemas[capability].parse({ protocolVersion: 1, capability, connection: "weknora", ok: true, source, warnings, data });
      try {
        if (parsed.data.capability === "weknora.knowledge-bases.list") {
          const input = parsed.data.input;
          const response = await fetch({ kind: "list", page: input.page, pageSize: input.pageSize });
          if (response.failure) return response.failure;
          const rows = z.array(upstreamKb).max(input.pageSize).nullable().parse(response.body.data) ?? [];
          return success(WeknoraListDataSchema.parse({ knowledgeBases: rows, ...(response.body.total !== undefined ? { total: response.body.total } : {}), ...(response.body.page !== undefined ? { page: response.body.page } : {}), ...(response.body.page_size !== undefined ? { pageSize: response.body.page_size } : {}) }));
        }
        const knowledgeBaseId = parsed.data.input.knowledgeBaseId ?? connection.defaultKnowledgeBaseId;
        if (!knowledgeBaseId) return fail("knowledge-base-required");
        const detail = await fetch({ kind: "get", knowledgeBaseId });
        if (detail.failure) return detail.failure;
        const kb = upstreamKb.parse(detail.body.data);
        if (kb.id !== knowledgeBaseId) return fail("invalid-response");
        if (parsed.data.capability === "weknora.knowledge-bases.get") return success(WeknoraGetDataSchema.parse({ knowledgeBase: kb }));
        if (!kb.capabilities.vector && !kb.capabilities.keyword) return fail("no-index");
        const { query, limit } = parsed.data.input;
        const response = await fetch({ kind: "search", knowledgeBaseId, query, limit });
        if (response.failure) return response.failure;
        const results = z.array(upstreamResult).max(limit).nullable().parse(response.body.data) ?? [];
        if (results.some(result => result.knowledge_base_id && result.knowledge_base_id !== knowledgeBaseId)) return fail("invalid-response");
        return success(WeknoraSearchDataSchema.parse({ knowledgeBaseId, query, results }));
      } catch (error) {
        if (active.aborted) return interrupted();
        if (error instanceof LocalHttpError) {
          const kind = error.kind === "http-status" ? error.status === 401 ? "auth" : error.status === 403 ? "permission" : error.status === 429 ? "rate-limit" : "http-status" : error.kind;
          return fail(kind, error.status);
        }
        return fail("invalid-response");
      }
    };
    return await Promise.race([operation(), new Promise<WeknoraRetrievalEnvelope>(resolve => { abort = () => resolve(interrupted()); active.addEventListener("abort", abort, { once: true }); if (active.aborted) abort(); })]);
  } finally { clearTimeout(timer); if (abort) active.removeEventListener("abort", abort); }
}
