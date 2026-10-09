import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { isToolEnabled } from "../config/schema.js";
import { resolveWeknoraConnection } from "../config/weknora.js";
import { LocalHttpError, localHttpWeknoraVerify } from "../providers/local-http.js";
import { WeknoraVerifyRequestSchema, weknoraVerifyFailure, type WeknoraVerifyEnvelope, type WeknoraVerifyFailureKind } from "../protocol/weknora-schema.js";

/** Read-only, single request, no retries, state writes, identity output or fallback. */
export async function executeWeknoraVerify(request: unknown, paths: ArkSpacePaths, originalEnvironment: NodeJS.ProcessEnv | undefined, signal?: AbortSignal): Promise<WeknoraVerifyEnvelope> {
  const parsed = WeknoraVerifyRequestSchema.safeParse(request);
  if (!parsed.success) return weknoraVerifyFailure("invalid-request");
  if (!originalEnvironment) return weknoraVerifyFailure("config");
  const controller = new AbortController();
  const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const deadline = Date.now() + parsed.data.input.timeoutMs;
  const timer = setTimeout(() => controller.abort(), parsed.data.input.timeoutMs);
  let source: "managed" | "environment" | undefined;
  let warnings: string[] = [];
  const fail = (kind: WeknoraVerifyFailureKind, status?: number): WeknoraVerifyEnvelope => {
    const result = weknoraVerifyFailure(kind);
    if (!result.ok) { if (source) result.source = source; result.warnings = warnings; if (status !== undefined) result.error.status = status; }
    return result;
  };
  const interrupted = () => fail(signal?.aborted ? "cancelled" : "timeout");
  let abort: (() => void) | undefined;
  try {
    const operation = async (): Promise<WeknoraVerifyEnvelope> => {
      let connection;
      try {
        const config = await loadConfig(paths.config);
        if (!isToolEnabled(config, "weknora.connection.verify")) return fail("invalid-request");
        connection = await resolveWeknoraConnection(config, paths.credentials, originalEnvironment);
      }
      catch { return fail("config"); }
      if (active.aborted) return interrupted();
      if (!connection) return fail("config");
      source = connection.source; warnings = connection.warnings;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return fail("timeout");
      try {
        const response = await localHttpWeknoraVerify(connection.baseUrl, connection.apiKey, { allowRanges: connection.allowRanges, timeoutMs: remaining, signal: active });
        if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i.test(response.contentType)) return fail("invalid-response");
        let body: unknown;
        try { body = JSON.parse(response.text); } catch { return fail("invalid-response"); }
        if (!body || typeof body !== "object" || !("success" in body) || typeof body.success !== "boolean") return fail("invalid-response");
        if (!body.success) return fail("business-failure", response.status);
        return { protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: true, source, data: { outcome: "accepted", status: response.status }, warnings };
      } catch (error) {
        if (active.aborted) return interrupted();
        if (!(error instanceof LocalHttpError)) return fail("network");
        const kind = error.kind === "http-status" ? error.status === 401 ? "auth" : error.status === 403 ? "permission" : error.status === 429 ? "rate-limit" : "http-status" : error.kind;
        return fail(kind, error.status);
      }
    };
    return await Promise.race([operation(), new Promise<WeknoraVerifyEnvelope>(resolve => { abort = () => resolve(interrupted()); active.addEventListener("abort", abort, { once: true }); if (active.aborted) abort(); })]);
  } finally { clearTimeout(timer); if (abort) active.removeEventListener("abort", abort); }
}
