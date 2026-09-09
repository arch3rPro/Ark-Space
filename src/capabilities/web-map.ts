import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import type { FailureEnvelope, MapSuccessEnvelope, ProviderId, WebMapInput, WebMapProviderId } from "../protocol/types.js";
import { PROTOCOL_VERSION, WEB_MAP_PROVIDER_IDS } from "../protocol/types.js";
import type { MapProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

const WEB_MAP_PROVIDERS = new Set<ProviderId>(WEB_MAP_PROVIDER_IDS);

export interface WebMapContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: MapProviderRegistry;
  environment?: NodeJS.ProcessEnv;
}

export async function executeWebMap(
  input: WebMapInput,
  context: WebMapContext,
): Promise<MapSuccessEnvelope | FailureEnvelope<"web.map">> {
  const providerIds: WebMapProviderId[] = input.provider
    ? [input.provider]
    : context.config.providerOrder.filter(isWebMapProvider);
  const result = await executeWithProviders({
    providerIds,
    timeoutMs: input.timeoutMs,
    context,
    invoke: (providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get(providerId);
      return provider?.map({ input, apiKey, baseUrl, signal });
    },
  });

  if (result.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "web.map",
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
    capability: "web.map",
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

function isWebMapProvider(provider: ProviderId): provider is WebMapProviderId {
  return WEB_MAP_PROVIDERS.has(provider);
}
