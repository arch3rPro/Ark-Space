import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import type { FailureEnvelope, RelatedSuccessEnvelope, WebRelatedInput } from "../protocol/types.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import type { RelatedProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

export interface WebRelatedContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: RelatedProviderRegistry;
  environment?: NodeJS.ProcessEnv;
}

export async function executeWebRelated(
  input: WebRelatedInput,
  context: WebRelatedContext,
): Promise<RelatedSuccessEnvelope | FailureEnvelope<"web.related">> {
  const result = await executeWithProviders({
    providerIds: ["exa"],
    timeoutMs: input.timeoutMs,
    context,
    invoke: (_providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get("exa");
      return provider?.related({ input, apiKey, baseUrl, signal });
    },
  });

  if (result.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "web.related",
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
    capability: "web.related",
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
