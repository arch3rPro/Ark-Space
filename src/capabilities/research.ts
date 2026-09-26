import { createHash } from "node:crypto";
import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import { PROTOCOL_VERSION, type AttemptEvidence, type FailureEnvelope, type ResearchInput, type ResearchProviderId, type ResearchSuccessEnvelope, type ResearchData, type ResearchEvidenceArtifact } from "../protocol/types.js";
import type { ResearchProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

interface ResearchContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: ResearchProviderRegistry;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeResearch(
  input: ResearchInput,
  context: ResearchContext,
): Promise<ResearchSuccessEnvelope | FailureEnvelope<"research.run">> {
  const result = await executeWithProviders({
    providerIds: researchProviderIds(input, context.config),
    timeoutMs: input.timeoutMs,
    context,
    invoke: (providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get(providerId);
      return provider?.research({
        input,
        apiKey,
        baseUrl,
        signal,
        pollIntervalMs: context.config.execution.researchPollIntervalMs,
        cleanupTimeoutMs: context.config.execution.cleanupTimeoutMs,
      });
    },
  });

  const lifecycleWarnings = researchLifecycleWarnings(result.attempts);
  if (result.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "research.run",
      provider: result.provider,
      data: {
        ...result.data,
        evidenceArtifact: createSourceEvidenceArtifact(result.data.sources),
      },
      attempts: result.attempts,
      warnings: [
        ...(result.data.sources.length === 0 ? ["Provider completed Research without source evidence."] : []),
        ...(result.data.stopReason === "budget_reached"
          ? ["Provider stopped Research after reaching its budget; the report may be incomplete."]
          : []),
        ...lifecycleWarnings,
      ],
    };
  }

  const hasPossiblyRunningJob = result.attempts.some(
    (attempt) => attempt.remoteJob?.resource === "research-job" && attempt.remoteJob.state === "possibly-running",
  );
  const hasUncertainSubmission = result.attempts.some((attempt) => attempt.submission !== undefined);
  const correction = hasPossiblyRunningJob
    ? "Inspect the reported remote Research Job ID; do not submit a duplicate run."
    : hasUncertainSubmission
      ? "Check the Provider dashboard for a newly accepted Research job before submitting again."
      : correctionFor(result.error.kind);
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    capability: "research.run",
    error: {
      kind: result.error.kind,
      message: result.error.message,
      retryable: result.error.retryable,
      ...(correction ? { correction } : {}),
    },
    attempts: result.attempts,
    warnings: lifecycleWarnings,
  };
}

export function createSourceEvidenceArtifact(sources: ResearchData["sources"]): ResearchEvidenceArtifact {
  return {
    status: "source-level-only",
    passageEvidenceAvailable: false,
    sources: sources.map((source) => ({
      id: createSourceId(source.url, source.title),
      url: source.url,
      ...(source.title ? { title: source.title } : {}),
    })),
  };
}

function createSourceId(url: string, title?: string): string {
  // This identifies source metadata only; it is intentionally not a content hash.
  return `src_${createHash("sha256").update(`url\0${url}\0${title ?? ""}`, "utf8").digest("hex").slice(0, 32)}`;
}

function researchProviderIds(input: ResearchInput, config: ArkSpaceConfig): ResearchProviderId[] {
  if (input.provider) return [input.provider];
  return config.providerOrder.filter((provider): provider is ResearchProviderId => provider === "exa" || provider === "tavily");
}

function researchLifecycleWarnings(attempts: AttemptEvidence[]): string[] {
  const warnings: string[] = [];
  for (const attempt of attempts) {
    if (attempt.submission?.resource === "research-job") {
      warnings.push("Provider acceptance of the Research submission is unknown; retrying may create duplicate work.");
    } else if (attempt.cleanup?.resource === "research-job") {
      warnings.push(
        attempt.cleanup.ok
          ? `Remote Research job ${attempt.cleanup.jobId} reached a confirmed terminal state before fallback.`
          : `Remote Research job ${attempt.cleanup.jobId} cancellation could not be confirmed.`,
      );
    } else if (
      attempt.remoteJob?.resource === "research-job" &&
      attempt.remoteJob.state === "possibly-running"
    ) {
      warnings.push(`Remote Research job ${attempt.remoteJob.jobId} may still be running.`);
    }
  }
  return warnings;
}
