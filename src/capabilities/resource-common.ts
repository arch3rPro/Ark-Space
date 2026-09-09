import { getProviderConfig, type ArkSpaceConfig } from "../config/schema.js";
import { ProviderError, correctionFor } from "../errors/provider-error.js";
import { resolveOwnedCredential } from "../key-pool/key-pool.js";
import type { AttemptEvidence, Capability, FailureEnvelope, KeyId, ProviderId } from "../protocol/types.js";

export function credentialForOwner(
  config: ArkSpaceConfig,
  provider: ProviderId,
  keyId: KeyId,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const providerConfig = getProviderConfig(config, provider);
  if (!providerConfig?.enabled) throw new ProviderError(`Provider ${provider} is not enabled.`, { kind: "config" });
  return resolveOwnedCredential(provider, keyId, providerConfig, environment).value;
}

export function resourceFailure<C extends Capability>(
  capability: C,
  error: unknown,
  attempts: AttemptEvidence[] = [],
  warnings: string[] = [],
): FailureEnvelope<C> {
  const normalized = normalizeError(error);
  const correction = correctionFor(normalized.kind);
  return {
    protocolVersion: 1,
    ok: false,
    capability,
    error: {
      kind: normalized.kind,
      message: normalized.message,
      retryable: normalized.retryable,
      ...(correction ? { correction } : {}),
    },
    attempts,
    warnings,
  };
}

export function normalizeError(error: unknown): ProviderError {
  return error instanceof ProviderError
    ? error
    : new ProviderError(error instanceof Error ? error.message : "Unknown resource operation failure.", { kind: "unknown" });
}

export function failureAttempt(provider: ProviderId, keyId: KeyId | undefined, error: ProviderError): AttemptEvidence {
  return {
    provider,
    ...(keyId ? { keyId } : {}),
    ok: false,
    errorKind: error.kind,
    ...(error.status === undefined ? {} : { status: error.status }),
    retryable: error.retryable,
    safeToRetry: error.safeToRetry,
    ...(error.cleanup ? { cleanup: error.cleanup } : {}),
    ...(error.submission ? { submission: error.submission } : {}),
    ...(error.remoteJob ? { remoteJob: error.remoteJob } : {}),
  };
}
