import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import type { AttemptEvidence, ExtractSuccessEnvelope, FailureEnvelope, WebExtractInput } from "../protocol/types.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import type { ExtractProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

export interface WebExtractContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: ExtractProviderRegistry;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeWebExtract(
  input: WebExtractInput,
  context: WebExtractContext,
): Promise<ExtractSuccessEnvelope | FailureEnvelope<"web.extract">> {
  const result = await executeWithProviders({
    providerIds: ["firecrawl"],
    timeoutMs: input.timeoutMs,
    context,
    invoke: (_providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get("firecrawl");
      return provider?.extract({
        input,
        apiKey,
        baseUrl,
        signal,
        pollIntervalMs: context.config.execution.extractPollIntervalMs,
      });
    },
  });

  if (result.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "web.extract",
      provider: result.provider,
      data: result.data,
      attempts: result.attempts,
      warnings: result.data.invalidUrls.map((url) => `Provider rejected ${url}`),
    };
  }

  const hasRemoteJob = result.attempts.some((attempt) => attempt.remoteJob !== undefined);
  const correction = hasRemoteJob
    ? "Use the reported remote Job ID to inspect Provider activity; do not submit a duplicate extraction."
    : correctionFor(result.error.kind);
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    capability: "web.extract",
    error: {
      kind: result.error.kind,
      message: result.error.message,
      retryable: result.error.retryable,
      ...(correction ? { correction } : {}),
    },
    attempts: result.attempts,
    warnings: remoteJobWarnings(result.attempts),
  };
}

function remoteJobWarnings(attempts: AttemptEvidence[]): string[] {
  return attempts.flatMap((attempt) =>
    attempt.remoteJob
      ? [`Remote extract job ${attempt.remoteJob.jobId} may still be running; do not submit a duplicate request.`]
      : [],
  );
}
