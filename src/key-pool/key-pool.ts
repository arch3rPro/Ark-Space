import { createHash } from "node:crypto";

import { validateCredentialValue } from "../config/credentials.js";
import type { ProviderConfig } from "../config/schema.js";
import { ProviderError } from "../errors/provider-error.js";
import { readJsonFile, withFileLock, writeJsonAtomic } from "../io/json-store.js";
import type { FailureKind, KeyId, ProviderId } from "../protocol/types.js";
import { ArkSpaceStateSchema, emptyState, type ArkSpaceState, type KeyState } from "../state/schema.js";

export interface CredentialLease {
  keyId: KeyId;
  value: string;
}

export interface KeyPoolResult {
  ok: boolean;
  kind?: FailureKind;
  retryAfterMs?: number;
}

export async function selectCredential(
  statePath: string,
  provider: ProviderId,
  providerConfig: ProviderConfig,
  environment: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<CredentialLease> {
  const available = providerConfig.keyRefs.flatMap((reference) => {
    const value = resolveEnvironmentReference(reference, environment);
    return value ? [{ keyId: keyIdFor(provider, reference), value }] : [];
  });
  if (available.length === 0) {
    throw new ProviderError(`Provider ${provider} has no available environment-variable API key.`, {
      kind: "config",
    });
  }

  return withFileLock(statePath, async () => {
    const state = await loadState(statePath);
    const providerState = (state.providers[provider] ??= { cursor: 0, keys: {} });
    for (let offset = 0; offset < available.length; offset += 1) {
      const index = (providerState.cursor + offset) % available.length;
      const candidate = available[index];
      if (!candidate) continue;
      const keyState = (providerState.keys[candidate.keyId] ??= enabledKeyState());
      reviveAfterCooldown(keyState, now);
      if (keyState.status !== "enabled") continue;
      providerState.cursor = (index + 1) % available.length;
      await writeJsonAtomic(statePath, state);
      return candidate;
    }
    throw new ProviderError(`Provider ${provider} has no usable API key; all configured keys are unavailable.`, {
      kind: "config",
    });
  });
}

export function resolveOwnedCredential(
  provider: ProviderId,
  keyId: KeyId,
  providerConfig: ProviderConfig,
  environment: NodeJS.ProcessEnv = process.env,
): CredentialLease {
  for (const reference of providerConfig.keyRefs) {
    if (keyIdFor(provider, reference) !== keyId) continue;
    const value = resolveEnvironmentReference(reference, environment);
    if (value) return { keyId, value };
    break;
  }
  throw new ProviderError(`The configured credential that owns this ${provider} resource is unavailable.`, {
    kind: "config",
  });
}

export async function recordKeyResult(
  statePath: string,
  provider: ProviderId,
  keyId: KeyId,
  providerConfig: ProviderConfig,
  result: KeyPoolResult,
  now = Date.now(),
): Promise<void> {
  await withFileLock(statePath, async () => {
    const state = await loadState(statePath);
    const providerState = (state.providers[provider] ??= { cursor: 0, keys: {} });
    const keyState = (providerState.keys[keyId] ??= enabledKeyState());
    if (result.ok) {
      providerState.keys[keyId] = enabledKeyState();
    } else if (result.kind) {
      applyFailure(keyState, result.kind, providerConfig, result.retryAfterMs, now);
    }
    await writeJsonAtomic(statePath, state);
  });
}

export async function readPublicState(statePath: string): Promise<ArkSpaceState> {
  return loadState(statePath);
}

function applyFailure(
  state: KeyState,
  kind: FailureKind,
  config: ProviderConfig,
  retryAfterMs: number | undefined,
  now: number,
): void {
  state.lastFailure = kind;
  state.consecutiveFailures += 1;
  switch (kind) {
    case "auth":
      state.status = "disabled";
      delete state.cooldownUntil;
      return;
    case "rate-limit":
      state.status = "cooldown";
      state.cooldownUntil = now + (retryAfterMs ?? config.cooldownSeconds * 1_000);
      return;
    case "quota":
      state.status = "exhausted";
      state.cooldownUntil = now + config.quotaCooldownSeconds * 1_000;
      return;
    case "permission":
    case "transient":
    case "network":
    case "invalid-request":
    case "invalid-response":
    case "config":
    case "unknown":
      return;
  }
}

export async function loadState(path: string): Promise<ArkSpaceState> {
  const value = await readJsonFile(path);
  if (value === undefined) return emptyState();
  const parsed = ArkSpaceStateSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderError(`Invalid ArkSpace state at ${path}: ${parsed.error.message}`, { kind: "config" });
  }
  return parsed.data;
}

function enabledKeyState(): KeyState {
  return { status: "enabled", consecutiveFailures: 0 };
}

function reviveAfterCooldown(state: KeyState, now: number): void {
  if ((state.status === "cooldown" || state.status === "exhausted") && (state.cooldownUntil ?? 0) <= now) {
    state.status = "enabled";
    state.consecutiveFailures = 0;
    delete state.cooldownUntil;
    delete state.lastFailure;
  }
}

function resolveEnvironmentReference(reference: string, environment: NodeJS.ProcessEnv): string | undefined {
  if (!/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) {
    throw new ProviderError("Invalid environment credential reference.", { kind: "config" });
  }
  const value = environment[reference.slice("env:".length)];
  if (value === undefined) return undefined;
  const validated = validateCredentialValue(value);
  if (!validated) {
    throw new ProviderError(`Invalid credential value for ${reference}.`, { kind: "config" });
  }
  return validated;
}

function keyIdFor(provider: ProviderId, reference: string): KeyId {
  return createHash("sha256").update(`${provider}\0${reference}`).digest("hex").slice(0, 16) as KeyId;
}
