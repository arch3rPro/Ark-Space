import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import type { FailureEnvelope, ProviderId, SuccessEnvelope, WebSearchInput } from "../protocol/types.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import type { SearchProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

export interface WebSearchContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: SearchProviderRegistry;
  environment?: NodeJS.ProcessEnv;
}

export async function executeWebSearch(
  input: WebSearchInput,
  context: WebSearchContext,
): Promise<SuccessEnvelope | FailureEnvelope<"web.search">> {
  const providerIds = resolveProviderOrder(input.provider, context.config.providerOrder);
  const result = await executeWithProviders({
    providerIds,
    timeoutMs: input.timeoutMs,
    context,
    invoke: (providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get(providerId);
      return provider?.search({ input, apiKey, baseUrl, signal });
    },
  });

  if (result.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "web.search",
      provider: result.provider,
      data: result.data,
      attempts: result.attempts,
      warnings: [],
    };
  }

  const correction = correctionFor(result.error.kind);
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    capability: "web.search",
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

function resolveProviderOrder(provider: ProviderId | undefined, configuredOrder: ProviderId[]): ProviderId[] {
  return provider ? [provider] : configuredOrder;
}
