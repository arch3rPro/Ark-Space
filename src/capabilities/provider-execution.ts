import type { ArkSpaceConfig } from "../config/schema.js";
import { getProviderConfig, getSearxngConfig } from "../config/schema.js";
import { awaitWithAbort } from "./abortable.js";
import { ProviderError } from "../errors/provider-error.js";
import { recordKeyResult, selectCredential } from "../key-pool/key-pool.js";
import { recordInstanceResult, selectSearxngInstance } from "../providers/searxng-pool.js";
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
  invokeKeyless?: (provider: "searxng", baseUrl: string, signal: AbortSignal, allowRanges: readonly string[], timeoutMs: number) => Promise<Data> | undefined;
}): Promise<ProviderExecutionResult<Data, Provider>> {
  const attempts: AttemptEvidence[] = [];
  const deadline = Date.now() + options.timeoutMs;
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const operationSignal = options.context.signal
    ? AbortSignal.any([timeoutSignal, options.context.signal])
    : timeoutSignal;
  let lastError = new ProviderError("No configured provider can execute this capability.", { kind: "config" });

  for (const providerId of options.providerIds) {
    if (operationSignal.aborted) return { ok: false, error: new ProviderError("Provider operation was cancelled or timed out.", { kind: "transient", safeToRetry: false }), attempts };
    const providerConfig = getProviderConfig(options.context.config, providerId, options.context.environment ?? process.env);
    if (!providerConfig?.enabled) continue;

    // Only this known Provider is keyless; an empty keyRefs list is not authorization.
    if (providerId === "searxng") {
      if (!options.invokeKeyless) {
        lastError = new ProviderError("SearXNG does not implement this capability.", { kind: "config" });
        if (options.providerIds.length === 1) break;
        continue;
      }
      const config = getSearxngConfig(options.context.config, options.context.environment ?? process.env)!;
      const excluded = new Set<string>();
      for (let index = 0; index < config.instances.length; index++) {
        let instance;
        try {
          instance = await awaitWithAbort(selectSearxngInstance(options.context.statePath, config, excluded, Date.now(), operationSignal), operationSignal);
        } catch {
          lastError = new ProviderError("SearXNG instance selection failed or was interrupted.", { kind: operationSignal.aborted ? "transient" : "config", safeToRetry: false });
          return { ok: false, error: lastError, attempts };
        }
        if (!instance) {
          if (!excluded.size) lastError = new ProviderError("All configured SearXNG instances are cooling down.", { kind: "rate-limit" });
          break;
        }
        excluded.add(instance.instanceId);
        const remaining = deadline - Date.now();
        if (operationSignal.aborted || remaining <= 0) return { ok: false, error: new ProviderError("SearXNG operation was cancelled or timed out.", { kind: "transient", safeToRetry: false }), attempts };
        // Reserve an equal share for each still-untried instance, including sub-second shares.
        const budget = Math.max(1, Math.floor(remaining / instance.eligibleCount));
        const attemptSignal = AbortSignal.any([operationSignal, AbortSignal.timeout(budget)]);
        try {
          const operation = options.invokeKeyless("searxng", instance.baseUrl, attemptSignal, instance.allowRanges, budget);
          if (!operation) throw new ProviderError("SearXNG does not implement this capability.", { kind: "config" });
          const data = await awaitWithAbort(operation, attemptSignal);
          if (operationSignal.aborted) throw new ProviderError("SearXNG operation was cancelled or timed out.", { kind: "transient", safeToRetry: false });
          await awaitWithAbort(recordInstanceResult(options.context.statePath, config, instance.instanceId, { ok: true }, Date.now(), operationSignal), operationSignal);
          attempts.push({ provider: providerId, instanceId: instance.instanceId, ok: true });
          return { ok: true, provider: providerId, data, attempts };
        } catch (error) {
          lastError = operationSignal.aborted
            ? new ProviderError("SearXNG operation was cancelled or timed out.", { kind: "transient", safeToRetry: false })
            : attemptSignal.aborted
              ? new ProviderError("SearXNG instance timed out.", { kind: "network" })
              : normalizeProviderError(error);
          attempts.push({ provider: providerId, instanceId: instance.instanceId, ok: false, errorKind: lastError.kind, retryable: lastError.retryable,
            ...(lastError.safeToRetry ? {} : { safeToRetry: false }),
            ...(lastError.status === undefined ? {} : { status: lastError.status }) });
          if (operationSignal.aborted) return { ok: false, error: lastError, attempts };
          try {
            await awaitWithAbort(recordInstanceResult(options.context.statePath, config, instance.instanceId, { ok: false, kind: lastError.kind }, Date.now(), operationSignal), operationSignal);
          } catch {
            return { ok: false, error: new ProviderError("SearXNG health recording failed or was interrupted.", { kind: operationSignal.aborted ? "transient" : "config", safeToRetry: false }), attempts };
          }
          // Network authority/configuration failures are never an authorization to try elsewhere.
          if (!lastError.safeToRetry || lastError.kind === "config" || !config.fallbackOn.includes(lastError.kind)) {
            return { ok: false, error: lastError, attempts };
          }
        }
      }
      if (options.providerIds.length === 1 || !config.fallbackOn.includes(lastError.kind)) return { ok: false, error: lastError, attempts };
      continue;
    }

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
        // A provider may pass the signal through to its transport without actually
        // stopping its work. Do not let such a promise hold the invocation open;
        // resource-aware providers still report their own cleanup evidence when
        // they can confirm it.
        const data = await awaitWithAbort(operation, operationSignal);
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
