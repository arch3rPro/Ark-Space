import { rm } from "node:fs/promises";

import { getProviderConfig, type ArkSpaceConfig } from "../config/schema.js";
import { ProviderError } from "../errors/provider-error.js";
import { withPrivateFileReservation } from "../io/json-store.js";
import { recordKeyResult, selectCredential } from "../key-pool/key-pool.js";
import {
  PROTOCOL_VERSION,
  type Capability,
  type ConfirmedMonitorResourceInput,
  type FailureEnvelope,
  type KeyId,
  type MonitorCreateInput,
  type MonitorData,
  type MonitorEnvelope,
  type MonitorListEnvelope,
  type MonitorListInput,
  type MonitorResourceInput,
  type MonitorRunGetEnvelope,
  type MonitorRunGetInput,
  type MonitorRunsEnvelope,
  type MonitorRunsInput,
  type MonitorUpdateInput,
  type ResourceSuccessEnvelope,
} from "../protocol/types.js";
import { ExaMonitorProvider, type MonitorProvider } from "../providers/exa-monitor.js";
import { getMonitorOwner, listMonitorOwners, putMonitorOwner, removeMonitorOwner } from "../state/resources.js";
import { credentialForOwner, failureAttempt, normalizeError, resourceFailure } from "./resource-common.js";

export interface MonitorExecutionContext {
  config: ArkSpaceConfig;
  statePath: string;
  provider?: MonitorProvider;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeMonitorCreate(input: MonitorCreateInput, context: MonitorExecutionContext): Promise<MonitorEnvelope<"monitor.create">> {
  const providerConfig = getProviderConfig(context.config, "exa");
  if (!providerConfig?.enabled) return resourceFailure("monitor.create", new ProviderError("Provider exa is not enabled.", { kind: "config" }));
  let keyId: KeyId | undefined;
  let monitor: MonitorData | undefined;
  const provider = context.provider ?? new ExaMonitorProvider(fetch, providerConfig.baseUrl);
  try {
    const lease = await selectCredential(context.statePath, "exa", providerConfig, context.environment);
    keyId = lease.keyId;
    monitor = await withPrivateFileReservation(input.webhookSecretPath, async (write) => {
      let created;
      try {
        created = await provider.create(lease.value, input, context.signal);
      } catch (error) {
        const normalized = normalizeError(error);
        const uncertain = normalized.kind === "network" || normalized.kind === "transient";
        if (!uncertain) throw normalized;
        throw new ProviderError(normalized.message, { kind: normalized.kind, ...(normalized.status === undefined ? {} : { status: normalized.status }), safeToRetry: false, submission: { resource: "monitor", state: "acceptance-unknown" }, cause: normalized });
      }
      monitor = created.monitor;
      await write(`${created.webhookSecret}\n`);
      return created.monitor;
    });
    await putMonitorOwner(context.statePath, monitor.monitorId, { provider: "exa", keyId: lease.keyId, createdAt: monitor.createdAt ?? new Date().toISOString(), secretPath: input.webhookSecretPath });
    await recordKeyResult(context.statePath, "exa", lease.keyId, providerConfig, { ok: true });
    return success("monitor.create", { ...monitor, webhookSecretStored: true }, lease.keyId, [
      "The webhook signing secret was stored in the requested private file; it is not included in protocol output.",
      "The monitor runs until paused or deleted and can incur Exa Monitor charges on every scheduled run.",
    ]);
  } catch (error) {
    const normalized = normalizeError(error);
    if (keyId) {
      try {
        await recordKeyResult(context.statePath, "exa", keyId, providerConfig, failedKeyResult(normalized));
      } catch {
        // Remote cleanup takes precedence over recording key health.
      }
    }
    if (monitor && keyId) {
      let cleanupOk = false;
      try {
        const key = credentialForOwner(context.config, "exa", keyId, context.environment);
        await provider.delete(key, monitor.monitorId, context.config.execution.cleanupTimeoutMs);
        cleanupOk = true;
      } catch {
        try {
          await putMonitorOwner(context.statePath, monitor.monitorId, { provider: "exa", keyId, createdAt: monitor.createdAt ?? new Date().toISOString(), secretPath: input.webhookSecretPath });
        } catch {
          // The returned monitor ID remains the final recovery handle.
        }
      }
      if (cleanupOk) {
        try { await removeMonitorOwner(context.statePath, monitor.monitorId); } catch { /* Remote deletion is already confirmed. */ }
        try { await rm(input.webhookSecretPath, { force: true }); } catch { /* A private stale secret is safer than losing cleanup. */ }
      }
      const wrapped = new ProviderError(normalized.message, { kind: normalized.kind, safeToRetry: cleanupOk, cleanup: { resource: "monitor", monitorId: monitor.monitorId, attempted: true, ok: cleanupOk }, cause: normalized });
      return resourceFailure("monitor.create", wrapped, [failureAttempt("exa", keyId, wrapped)], cleanupOk ? [] : [`Monitor ${monitor.monitorId} may still be active. Its webhook secret remains in the requested private file.`]);
    }
    return resourceFailure("monitor.create", normalized, keyId ? [failureAttempt("exa", keyId, normalized)] : [], normalized.submission ? ["Monitor creation may have been accepted; ArkSpace has no monitor ID and will not retry automatically."] : []);
  }
}

export async function executeMonitorList(input: MonitorListInput, context: MonitorExecutionContext): Promise<MonitorListEnvelope> {
  try {
    const owners = (await listMonitorOwners(context.statePath)).slice(0, input.limit);
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "monitor.list",
      provider: "exa",
      data: { monitors: owners.map((owner) => ({ monitorId: owner.monitorId as MonitorData["monitorId"], status: "unknown", createdAt: owner.createdAt })) },
      attempts: [],
      warnings: ["List reports ArkSpace-owned monitors from local state. Use monitor.status to refresh provider state."],
    };
  } catch (error) {
    return resourceFailure("monitor.list", error);
  }
}

export async function executeMonitorStatus(input: MonitorResourceInput, context: MonitorExecutionContext): Promise<MonitorEnvelope<"monitor.status">> {
  return ownedMonitor("monitor.status", input, context, (provider, key) => provider.get(key, input.monitorId, input.timeoutMs, context.signal));
}

export async function executeMonitorUpdate(input: MonitorUpdateInput, context: MonitorExecutionContext): Promise<MonitorEnvelope<"monitor.update">> {
  return ownedMonitor("monitor.update", input, context, (provider, key) => provider.update(key, input, context.signal), mutationWarning("update"), true);
}

export async function executeMonitorPause(input: ConfirmedMonitorResourceInput, context: MonitorExecutionContext): Promise<MonitorEnvelope<"monitor.pause">> {
  return ownedMonitor("monitor.pause", input, context, (provider, key) => provider.update(key, { ...input, status: "paused" }, context.signal), ["Pausing stops scheduled runs but preserves the monitor and permits manual triggers."], true);
}

export async function executeMonitorResume(input: ConfirmedMonitorResourceInput, context: MonitorExecutionContext): Promise<MonitorEnvelope<"monitor.resume">> {
  return ownedMonitor("monitor.resume", input, context, (provider, key) => provider.update(key, { ...input, status: "active" }, context.signal), ["The resumed monitor can incur charges on every scheduled run."], true);
}

export async function executeMonitorTrigger(input: ConfirmedMonitorResourceInput, context: MonitorExecutionContext): Promise<MonitorEnvelope<"monitor.trigger">> {
  return ownedMonitor("monitor.trigger", input, context, async (provider, key) => {
    const triggered = await provider.trigger(key, input.monitorId, input.timeoutMs, context.signal);
    return { monitorId: input.monitorId, status: "unknown", triggered };
  }, ["A manual monitor run was requested and can incur Exa Monitor charges."], true);
}

export async function executeMonitorDelete(input: ConfirmedMonitorResourceInput, context: MonitorExecutionContext): Promise<MonitorEnvelope<"monitor.delete">> {
  return ownedMonitor("monitor.delete", input, context, async (provider, key) => {
    await provider.delete(key, input.monitorId, input.timeoutMs, context.signal);
    await removeMonitorOwner(context.statePath, input.monitorId);
    return { monitorId: input.monitorId, status: "disabled" };
  }, ["Deletion is irreversible at the API resource level; ArkSpace does not claim physical erasure of provider history or backups."], true);
}

export async function executeMonitorRuns(input: MonitorRunsInput, context: MonitorExecutionContext): Promise<MonitorRunsEnvelope> {
  return ownedMonitor("monitor.runs", input, context, async (provider, key) => ({ monitorId: input.monitorId, runs: await provider.runs(key, input.monitorId, input.limit, input.timeoutMs, context.signal) }));
}

export async function executeMonitorRunGet(input: MonitorRunGetInput, context: MonitorExecutionContext): Promise<MonitorRunGetEnvelope> {
  return ownedMonitor("monitor.run.get", input, context, (provider, key) => provider.run(key, input.monitorId, input.runId, input.timeoutMs, context.signal));
}

async function ownedMonitor<C extends Exclude<Capability, "monitor.create" | "monitor.list">, D>(
  capability: C,
  input: MonitorResourceInput,
  context: MonitorExecutionContext,
  operation: (provider: MonitorProvider, key: string) => Promise<D>,
  warnings: string[] = [],
  mutating = false,
): Promise<ResourceSuccessEnvelope<C, "exa", D> | FailureEnvelope<C>> {
  let keyId: KeyId | undefined;
  try {
    const owner = await getMonitorOwner(context.statePath, input.monitorId);
    keyId = owner.keyId as KeyId;
    const providerConfig = getProviderConfig(context.config, "exa");
    if (!providerConfig) throw new ProviderError("Provider exa is not configured.", { kind: "config" });
    const key = credentialForOwner(context.config, "exa", keyId, context.environment);
    const provider = context.provider ?? new ExaMonitorProvider(fetch, providerConfig.baseUrl);
    let data: D;
    try {
      data = await operation(provider, key);
    } catch (error) {
      const normalized = normalizeError(error);
      if (!mutating) throw normalized;
      throw new ProviderError(normalized.message, { kind: normalized.kind, ...(normalized.status === undefined ? {} : { status: normalized.status }), safeToRetry: false, cause: normalized });
    }
    await recordKeyResult(context.statePath, "exa", keyId, providerConfig, { ok: true });
    return { protocolVersion: PROTOCOL_VERSION, ok: true, capability, provider: "exa", data, attempts: [{ provider: "exa", keyId, ok: true }], warnings };
  } catch (error) {
    const normalized = normalizeError(error);
    const providerConfig = getProviderConfig(context.config, "exa");
    if (keyId && providerConfig) await recordKeyResult(context.statePath, "exa", keyId, providerConfig, failedKeyResult(normalized));
    return resourceFailure(capability, normalized, keyId ? [failureAttempt("exa", keyId, normalized)] : [], warnings);
  }
}

function success<C extends Capability>(capability: C, data: MonitorData, keyId: KeyId, warnings: string[]): ResourceSuccessEnvelope<C, "exa", MonitorData> {
  return { protocolVersion: PROTOCOL_VERSION, ok: true, capability, provider: "exa", data, attempts: [{ provider: "exa", keyId, ok: true }], warnings };
}
function failedKeyResult(error: ProviderError): { ok: false; kind: ProviderError["kind"]; retryAfterMs?: number } {
  return { ok: false, kind: error.kind, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) };
}
function mutationWarning(operation: string): string[] { return [`The confirmed monitor ${operation} changes persistent provider state.`]; }
