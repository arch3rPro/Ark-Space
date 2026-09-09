import type { ArkSpaceConfig } from "../config/schema.js";
import { getProviderConfig } from "../config/schema.js";
import { ProviderError } from "../errors/provider-error.js";
import { recordKeyResult, selectCredential } from "../key-pool/key-pool.js";
import type { AttemptEvidence, FailureKind, ProviderId } from "../protocol/types.js";

export interface ProviderExecutionContext {
  config: ArkSpaceConfig;
  statePath: string;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export type ProviderExecutionResult<Data, Provider extends ProviderId = ProviderId> =
  | { ok: true; provider: Provider; data: Data; attempts: AttemptEvidence[] }
  | { ok: false; error: ProviderError; attempts: AttemptEvidence[] };

export async function executeWithProviders<Data, Provider extends ProviderId>(options: {
  providerIds: Provider[];
  timeoutMs: number;
  context: ProviderExecutionContext;
  invoke: (provider: Provider, apiKey: string, baseUrl: string, signal: AbortSignal) => Promise<Data> | undefined;
}): Promise<ProviderExecutionResult<Data, Provider>> {
  const attempts: AttemptEvidence[] = [];
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const operationSignal = options.context.signal
    ? AbortSignal.any([timeoutSignal, options.context.signal])
    : timeoutSignal;
  let lastError = new ProviderError("No configured provider can execute this capability.", { kind: "config" });

  for (const providerId of options.providerIds) {
    const providerConfig = getProviderConfig(options.context.config, providerId);
    if (!providerConfig?.enabled) continue;

    const maximumKeyAttempts = Math.max(1, providerConfig.keyRefs.length);
    for (let keyAttempt = 0; keyAttempt < maximumKeyAttempts; keyAttempt += 1) {
      let credential;
      try {
        credential = await selectCredential(
          options.context.statePath,
          providerId,
          providerConfig,
          options.context.environment ?? process.env,
        );
      } catch (error) {
        lastError = normalizeProviderError(error);
        break;
      }

      try {
        const operation = options.invoke(
          providerId,
          credential.value,
          providerConfig.baseUrl,
          operationSignal,
        );
        if (!operation) {
          lastError = new ProviderError(`Provider ${providerId} does not implement this capability.`, { kind: "config" });
          break;
        }
        const data = await operation;
        await recordKeyResult(options.context.statePath, providerId, credential.keyId, providerConfig, { ok: true });
        attempts.push({ provider: providerId, keyId: credential.keyId, ok: true });
        return { ok: true, provider: providerId, data, attempts };
      } catch (error) {
        const providerError = normalizeProviderError(error);
        lastError = providerError;
        await recordKeyResult(options.context.statePath, providerId, credential.keyId, providerConfig, {
          ok: false,
          kind: providerError.kind,
          ...(providerError.retryAfterMs === undefined ? {} : { retryAfterMs: providerError.retryAfterMs }),
        });
        attempts.push({
          provider: providerId,
          keyId: credential.keyId,
          ok: false,
          errorKind: providerError.kind,
          retryable: providerError.retryable,
          ...(providerError.safeToRetry ? {} : { safeToRetry: false }),
          ...(providerError.status === undefined ? {} : { status: providerError.status }),
          ...(providerError.cleanup === undefined ? {} : { cleanup: providerError.cleanup }),
          ...(providerError.submission === undefined ? {} : { submission: providerError.submission }),
          ...(providerError.remoteJob === undefined ? {} : { remoteJob: providerError.remoteJob }),
        });
        if (operationSignal.aborted || !providerError.safeToRetry) {
          return { ok: false, error: providerError, attempts };
        }
        if (shouldTryAnotherKey(providerError.kind)) continue;
        break;
      }
    }

    if (options.providerIds.length === 1) break;
    if (lastError.kind === "config") continue;
    if (!providerConfig.fallbackOn.includes(lastError.kind)) break;
  }

  return { ok: false, error: lastError, attempts };
}

function shouldTryAnotherKey(kind: FailureKind): boolean {
  return kind === "auth" || kind === "rate-limit" || kind === "quota";
}

export function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError("Unexpected provider failure.", { kind: "unknown", cause: error });
}
