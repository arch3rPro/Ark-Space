import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import type { FetchSuccessEnvelope, FailureEnvelope, ProviderId, WebFetchInput } from "../protocol/types.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import type { FetchProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

export interface WebFetchContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: FetchProviderRegistry;
  environment?: NodeJS.ProcessEnv;
}

export async function executeWebFetch(
  input: WebFetchInput,
  context: WebFetchContext,
): Promise<FetchSuccessEnvelope | FailureEnvelope<"web.fetch">> {
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
      data: result.data,
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
