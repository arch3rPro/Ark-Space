import { getProviderConfig, type ArkSpaceConfig } from "../config/schema.js";
import { ProviderError } from "../errors/provider-error.js";
import { recordKeyResult, selectCredential } from "../key-pool/key-pool.js";
import { PROTOCOL_VERSION, type Capability, type ConfirmedSiteMonitorResourceInput, type FailureEnvelope, type KeyId, type ResourceSuccessEnvelope, type SiteMonitorCheckGetEnvelope, type SiteMonitorCheckGetInput, type SiteMonitorChecksEnvelope, type SiteMonitorChecksInput, type SiteMonitorCreateInput, type SiteMonitorData, type SiteMonitorEnvelope, type SiteMonitorListEnvelope, type SiteMonitorListInput, type SiteMonitorResourceInput, type SiteMonitorUpdateInput } from "../protocol/types.js";
import { FirecrawlMonitorProvider, type FirecrawlMonitorProviderContract } from "../providers/firecrawl-monitor.js";
import { getSiteMonitorOwner, listSiteMonitorOwners, putSiteMonitorOwner, removeSiteMonitorOwner } from "../state/resources.js";
import { credentialForOwner, failureAttempt, normalizeError, resourceFailure } from "./resource-common.js";

export interface SiteMonitorExecutionContext {
  config: ArkSpaceConfig;
  statePath: string;
  provider?: FirecrawlMonitorProviderContract;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeSiteMonitorCreate(input: SiteMonitorCreateInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorEnvelope<"monitor.site.create">> {
  const providerConfig = getProviderConfig(context.config, "firecrawl");
  if (!providerConfig?.enabled) return resourceFailure("monitor.site.create", new ProviderError("Provider firecrawl is not enabled.", { kind: "config" }));
  const provider = context.provider ?? new FirecrawlMonitorProvider(fetch, providerConfig.baseUrl);
  let keyId: KeyId | undefined;
  let monitor: SiteMonitorData | undefined;
  try {
    const lease = await selectCredential(context.statePath, "firecrawl", providerConfig, context.environment);
    keyId = lease.keyId;
    try {
      monitor = await provider.create(lease.value, input, context.signal);
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.kind !== "network" && normalized.kind !== "transient") throw normalized;
      throw new ProviderError(normalized.message, { kind: normalized.kind, ...(normalized.status === undefined ? {} : { status: normalized.status }), safeToRetry: false, submission: { resource: "site-monitor", state: "acceptance-unknown" }, cause: normalized });
    }
    await putSiteMonitorOwner(context.statePath, monitor.monitorId, { provider: "firecrawl", keyId: lease.keyId, createdAt: new Date().toISOString() });
    await recordKeyResult(context.statePath, "firecrawl", lease.keyId, providerConfig, { ok: true });
    return success("monitor.site.create", monitor, lease.keyId, [creditWarning(monitor), "The site monitor persists until paused or deleted."]);
  } catch (error) {
    const normalized = normalizeError(error);
    if (keyId) try { await recordKeyResult(context.statePath, "firecrawl", keyId, providerConfig, failedKeyResult(normalized)); } catch { /* Preserve lifecycle evidence. */ }
    if (monitor && keyId) {
      let cleanupOk = false;
      try {
        const key = credentialForOwner(context.config, "firecrawl", keyId, context.environment);
        await provider.delete(key, monitor.monitorId, context.config.execution.cleanupTimeoutMs);
        cleanupOk = true;
      } catch {
        try { await putSiteMonitorOwner(context.statePath, monitor.monitorId, { provider: "firecrawl", keyId, createdAt: new Date().toISOString() }); } catch { /* The returned ID remains the recovery handle. */ }
      }
      if (cleanupOk) try { await removeSiteMonitorOwner(context.statePath, monitor.monitorId); } catch { /* Remote deletion is confirmed. */ }
      const wrapped = new ProviderError(normalized.message, { kind: normalized.kind, safeToRetry: cleanupOk, cleanup: { resource: "site-monitor", monitorId: monitor.monitorId, attempted: true, ok: cleanupOk }, cause: normalized });
      return resourceFailure("monitor.site.create", wrapped, [failureAttempt("firecrawl", keyId, wrapped)], cleanupOk ? [] : [`Site monitor ${monitor.monitorId} may still be active and billable.`]);
    }
    return resourceFailure("monitor.site.create", normalized, keyId ? [failureAttempt("firecrawl", keyId, normalized)] : [], normalized.submission ? ["Site monitor creation may have been accepted; check the Firecrawl dashboard before retrying."] : []);
  }
}

export async function executeSiteMonitorList(input: SiteMonitorListInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorListEnvelope> {
  try {
    const monitors = (await listSiteMonitorOwners(context.statePath)).slice(0, input.limit).map((owner) => ({ monitorId: owner.monitorId as SiteMonitorData["monitorId"], status: "unknown" as const, targetTypes: [], createdAt: owner.createdAt }));
    return { protocolVersion: PROTOCOL_VERSION, ok: true, capability: "monitor.site.list", provider: "firecrawl", data: { monitors }, attempts: [], warnings: ["List reports locally owned site monitors. Use monitor.site.status to refresh Provider state."] };
  } catch (error) { return resourceFailure("monitor.site.list", error); }
}

export async function executeSiteMonitorStatus(input: SiteMonitorResourceInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorEnvelope<"monitor.site.status">> {
  return owned("monitor.site.status", input, context, (provider, key) => provider.get(key, input.monitorId, input.timeoutMs, context.signal));
}
export async function executeSiteMonitorUpdate(input: SiteMonitorUpdateInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorEnvelope<"monitor.site.update">> {
  return owned("monitor.site.update", input, context, (provider, key) => provider.update(key, input, context.signal), ["The confirmed update changes persistent targets, schedule, retention, judging, or notifications."], true);
}
export async function executeSiteMonitorPause(input: ConfirmedSiteMonitorResourceInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorEnvelope<"monitor.site.pause">> {
  return owned("monitor.site.pause", input, context, (provider, key) => provider.update(key, { ...input, status: "paused" }, context.signal), ["Pausing retains configuration and check history."], true);
}
export async function executeSiteMonitorResume(input: ConfirmedSiteMonitorResourceInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorEnvelope<"monitor.site.resume">> {
  return owned("monitor.site.resume", input, context, (provider, key) => provider.update(key, { ...input, status: "active" }, context.signal), ["The resumed site monitor can incur credits on every scheduled check."], true);
}
export async function executeSiteMonitorTrigger(input: ConfirmedSiteMonitorResourceInput, context: SiteMonitorExecutionContext): Promise<ResourceSuccessEnvelope<"monitor.site.trigger", "firecrawl", import("../protocol/types.js").SiteMonitorCheckData> | FailureEnvelope<"monitor.site.trigger">> {
  return owned("monitor.site.trigger", input, context, (provider, key) => provider.trigger(key, input.monitorId, input.timeoutMs, context.signal), ["A manual check was queued and can incur Firecrawl credits."], true);
}
export async function executeSiteMonitorDelete(input: ConfirmedSiteMonitorResourceInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorEnvelope<"monitor.site.delete">> {
  return owned("monitor.site.delete", input, context, async (provider, key) => { await provider.delete(key, input.monitorId, input.timeoutMs, context.signal); await removeSiteMonitorOwner(context.statePath, input.monitorId); return { monitorId: input.monitorId, status: "deleted", targetTypes: [] }; }, ["Deletion confirms removal of the API resource, not physical erasure of retained artifacts or backups."], true);
}
export async function executeSiteMonitorChecks(input: SiteMonitorChecksInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorChecksEnvelope> {
  return owned("monitor.site.checks", input, context, async (provider, key) => ({ monitorId: input.monitorId, checks: await provider.checks(key, input, context.signal) }));
}
export async function executeSiteMonitorCheckGet(input: SiteMonitorCheckGetInput, context: SiteMonitorExecutionContext): Promise<SiteMonitorCheckGetEnvelope> {
  return owned("monitor.site.check.get", input, context, (provider, key) => provider.check(key, input, context.signal));
}

async function owned<C extends Capability, D>(capability: C, input: SiteMonitorResourceInput, context: SiteMonitorExecutionContext, operation: (provider: FirecrawlMonitorProviderContract, key: string) => Promise<D>, warnings: string[] = [], mutating = false): Promise<ResourceSuccessEnvelope<C, "firecrawl", D> | FailureEnvelope<C>> {
  let keyId: KeyId | undefined;
  try {
    const owner = await getSiteMonitorOwner(context.statePath, input.monitorId); keyId = owner.keyId as KeyId;
    const providerConfig = getProviderConfig(context.config, "firecrawl"); if (!providerConfig) throw new ProviderError("Provider firecrawl is not configured.", { kind: "config" });
    const key = credentialForOwner(context.config, "firecrawl", keyId, context.environment); const provider = context.provider ?? new FirecrawlMonitorProvider(fetch, providerConfig.baseUrl);
    let data: D;
    try { data = await operation(provider, key); } catch (error) { const normalized = normalizeError(error); if (!mutating) throw normalized; throw new ProviderError(normalized.message, { kind: normalized.kind, ...(normalized.status === undefined ? {} : { status: normalized.status }), safeToRetry: false, cause: normalized }); }
    await recordKeyResult(context.statePath, "firecrawl", keyId, providerConfig, { ok: true });
    return { protocolVersion: PROTOCOL_VERSION, ok: true, capability, provider: "firecrawl", data, attempts: [{ provider: "firecrawl", keyId, ok: true }], warnings };
  } catch (error) {
    const normalized = normalizeError(error); const providerConfig = getProviderConfig(context.config, "firecrawl");
    if (keyId && providerConfig) try { await recordKeyResult(context.statePath, "firecrawl", keyId, providerConfig, failedKeyResult(normalized)); } catch { /* Preserve operation evidence. */ }
    return resourceFailure(capability, normalized, keyId ? [failureAttempt("firecrawl", keyId, normalized)] : [], warnings);
  }
}
function success<C extends Capability>(capability: C, data: SiteMonitorData, keyId: KeyId, warnings: string[]): ResourceSuccessEnvelope<C, "firecrawl", SiteMonitorData> { return { protocolVersion: PROTOCOL_VERSION, ok: true, capability, provider: "firecrawl", data, attempts: [{ provider: "firecrawl", keyId, ok: true }], warnings }; }
function failedKeyResult(error: ProviderError): { ok: false; kind: ProviderError["kind"]; retryAfterMs?: number } { return { ok: false, kind: error.kind, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) }; }
function creditWarning(monitor: SiteMonitorData): string { return monitor.estimatedCreditsPerMonth === undefined ? "Each scheduled check bills its underlying scrape, crawl, search, and optional judging work." : `Firecrawl estimates an upper bound of ${monitor.estimatedCreditsPerMonth} credits per month.`; }
