import { createHash } from "node:crypto";
import type { SearxngConfig, SearxngInstance } from "../config/schema.js";
import { ProviderError } from "../errors/provider-error.js";
import { withFileLock, writeJsonAtomic } from "../io/json-store.js";
import { loadState } from "../key-pool/key-pool.js";
import type { FailureKind } from "../protocol/types.js";

type InstanceCandidate = SearxngInstance & { instanceId: string };
export type InstanceLease = InstanceCandidate & { eligibleCount: number };
export function searxngInstanceIdFor(baseUrl: string): string {
  return createHash("sha256").update(`searxng\0${baseUrl}`).digest("hex").slice(0, 16);
}
function instances(config: SearxngConfig): InstanceCandidate[] {
  return config.instances.map(instance => ({ ...instance, instanceId: searxngInstanceIdFor(instance.baseUrl) }));
}

/** Selection is atomic across CLI processes; exclusions belong to one invocation. */
export async function selectSearxngInstance(
  statePath: string, config: SearxngConfig, excluded: ReadonlySet<string>, now = Date.now(), signal?: AbortSignal,
): Promise<InstanceLease | undefined> {
  checkCancellation(signal);
  const candidates = instances(config);
  if (candidates.length === 1) return excluded.has(candidates[0]!.instanceId) ? undefined : { ...candidates[0]!, eligibleCount: 1 };
  return withFileLock(statePath, async () => {
    checkCancellation(signal);
    const state = await loadState(statePath);
    checkCancellation(signal);
    const pool = (state.searxng ??= { cursor: 0, instances: {} });
    // ponytail: retain anonymous metadata across config churn; explicit compaction only if growth matters.
    // An older invocation's config snapshot cannot safely prune newer instance cooldowns.
    const eligible = new Set(candidates.filter(candidate => !excluded.has(candidate.instanceId) &&
      (pool.instances[candidate.instanceId]?.cooldownUntil ?? 0) <= now).map(candidate => candidate.instanceId));
    for (let offset = 0; offset < candidates.length; offset++) {
      const index = (pool.cursor + offset) % candidates.length;
      const candidate = candidates[index]!;
      if (!eligible.has(candidate.instanceId)) continue;
      pool.instances[candidate.instanceId] = {};
      pool.cursor = (index + 1) % candidates.length;
      await writeJsonAtomic(statePath, state);
      return { ...candidate, eligibleCount: eligible.size };
    }
    return undefined;
  }, signal ? { signal } : {});
}

export async function recordInstanceResult(
  statePath: string, config: SearxngConfig, instanceId: string,
  result: { ok: boolean; kind?: FailureKind }, now = Date.now(), signal?: AbortSignal,
): Promise<void> {
  checkCancellation(signal);
  // A singleton needs neither balancing nor persistent health writes.
  if (config.instances.length === 1) return;
  if (!result.ok && !["rate-limit", "network", "transient"].includes(result.kind ?? "")) return;
  await withFileLock(statePath, async () => {
    checkCancellation(signal);
    const state = await loadState(statePath);
    checkCancellation(signal);
    const pool = (state.searxng ??= { cursor: 0, instances: {} });
    // A late success must not erase a newer concurrent failure's active cooldown.
    if (result.ok && (pool.instances[instanceId]?.cooldownUntil ?? 0) > now) return;
    pool.instances[instanceId] = result.ok ? {} : {
      cooldownUntil: now + config.cooldownSeconds * 1000,
      lastFailure: result.kind as "rate-limit" | "network" | "transient",
    };
    await writeJsonAtomic(statePath, state);
  }, signal ? { signal } : {});
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ProviderError("SearXNG state operation was cancelled.", { kind: "transient", safeToRetry: false });
}
