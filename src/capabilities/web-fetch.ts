import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor, ProviderError } from "../errors/provider-error.js";
import { localHttpGet, LocalHttpError } from "../providers/local-http.js";
import { LocalFetchProvider } from "../providers/local-fetch.js";
import type { FetchSuccessEnvelope, FailureEnvelope, WebFetchInput } from "../protocol/types.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import type { FetchProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";
import { cacheFetchResults } from "../state/web-response-cache.js";

export interface WebFetchContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: FetchProviderRegistry;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeWebFetch(
  input: WebFetchInput,
  context: WebFetchContext,
): Promise<FetchSuccessEnvelope | FailureEnvelope<"web.fetch">> {
  if (input.provider === "local") return executeLocalFetch(input, context);
  const providerIds = input.provider ? [input.provider] : context.config.providerOrder;
  const result = await executeWithProviders({
    providerIds,
    timeoutMs: input.timeoutMs,
    context,
    invoke: (providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get(providerId);
      return provider?.fetch({ input, apiKey, baseUrl, signal });
    },
  });

  if (result.ok) {
    const warnings = result.data.failedUrls.map((url) => `Provider could not fetch ${url}`);
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "web.fetch",
      provider: result.provider,
      data: await cacheFetchResults(result.data, context.statePath, context.config.webResponseCache),
      attempts: result.attempts,
      warnings,
    };
  }

  const correction = correctionFor(result.error.kind);
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    capability: "web.fetch",
    error: {
      kind: result.error.kind,
      message: result.error.message,
      retryable: result.error.retryable,
      ...(correction ? { correction } : {}),
    },
    attempts: result.attempts,
    warnings: [],
  };
}

async function executeLocalFetch(input: WebFetchInput, context: WebFetchContext): Promise<FetchSuccessEnvelope | FailureEnvelope<"web.fetch">> {
  const local = context.config.localFetch;
  if (!local.enabled) {
    return { protocolVersion: PROTOCOL_VERSION, ok: false, capability: "web.fetch", error: { kind: "config", message: "Local fetch is disabled.", retryable: false }, attempts: [], warnings: [] };
  }
  if (input.urls.length !== 1) {
    return { protocolVersion: PROTOCOL_VERSION, ok: false, capability: "web.fetch", error: { kind: "invalid-request", message: "Local fetch requires exactly one URL.", retryable: false }, attempts: [], warnings: [] };
  }
  const provider = new LocalFetchProvider({
    transport: async (url, init) => {
      const response = await localHttpGet(String(url), {
        allowRanges: local.allowRanges,
        trustEnvProxy: local.trustEnvProxy,
        timeoutMs: input.timeoutMs,
        ...(init?.signal ? { signal: init.signal } : {}),
      });
      return new Response(response.text, { status: response.status, headers: { "content-type": response.contentType } });
    },
  });
  try {
    const data = await provider.fetch({
      input: { url: input.urls[0]!, mode: input.mode, maxCharacters: input.maxCharacters, timeoutMs: input.timeoutMs },
      ...(context.signal ? { signal: context.signal } : {}),
    });
    return { protocolVersion: PROTOCOL_VERSION, ok: true, capability: "web.fetch", provider: "local", data: await cacheFetchResults(data, context.statePath, context.config.webResponseCache), attempts: [], warnings: [] };
  } catch (error) {
    const kind = error instanceof LocalHttpError ? (error.kind === "blocked-address" ? "permission" : error.kind === "timeout" ? "transient" : "network") : error instanceof ProviderError ? error.kind : "network";
    return { protocolVersion: PROTOCOL_VERSION, ok: false, capability: "web.fetch", error: { kind, message: error instanceof Error ? error.message : "Local fetch failed.", retryable: kind === "transient" || kind === "network" }, attempts: [], warnings: [] };
  }
}
