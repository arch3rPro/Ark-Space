import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import type { CodeContextInput, CodeContextSuccessEnvelope, FailureEnvelope } from "../protocol/types.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import type { CodeContextProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

export interface CodeContextExecutionContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: CodeContextProviderRegistry;
  environment?: NodeJS.ProcessEnv;
}

export async function executeCodeContext(
  input: CodeContextInput,
  context: CodeContextExecutionContext,
): Promise<CodeContextSuccessEnvelope | FailureEnvelope<"code.context">> {
  const result = await executeWithProviders({
    providerIds: ["exa"],
    timeoutMs: input.timeoutMs,
    context,
    invoke: (_providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get("exa");
      return provider?.context({ input, apiKey, baseUrl, signal });
    },
  });

  if (result.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "code.context",
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
    capability: "code.context",
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
