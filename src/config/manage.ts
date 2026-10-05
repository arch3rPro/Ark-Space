import { ProviderError } from "../errors/provider-error.js";
import { readJsonFile, withFileLock, writeJsonAtomic } from "../io/json-store.js";
import { keyIdFor, loadState } from "../key-pool/key-pool.js";
import { FAILURE_KINDS, PROVIDER_IDS, type FailureKind, type ProviderId } from "../protocol/types.js";
import { searxngInstanceIdFor } from "../providers/searxng-pool.js";
import type { ArkSpaceState } from "../state/schema.js";
import { loadCredentialStore as readCredentialStore, validateCredentialValue } from "./credentials.js";
import type { ArkSpacePaths } from "./paths.js";
import { ArkSpaceConfigSchema, SearxngInstanceSchema, defaultConfig, getSearxngConfig, type ArkSpaceConfig, type SetupLanguage } from "./schema.js";

const managedProviders = ["exa", "tavily", "firecrawl", "searxng"] as const;
export type SetupProviderId = typeof managedProviders[number];
type KeyedProvider = Exclude<SetupProviderId, "searxng">;
const defaultVariables = { exa: "EXA_API_KEY", tavily: "TAVILY_API_KEY", firecrawl: "FIRECRAWL_API_KEY" };
export interface SetupKeySnapshot {
  reference: string; keyId: string; source: "local" | "environment" | "missing";
  hasLocal: boolean; available: boolean; status: string; ownedResources: number;
  manualDisabled?: boolean; healthReason?: FailureKind | "operator-disabled"; cooldownRemainingMs?: number;
  sharedProviders?: ProviderId[];
  ownedResourceTypes?: { browserSessions: number; monitors: number; siteMonitors: number };
}
export interface SetupInstanceSnapshot {
  baseUrl: string; allowRanges: string[]; status: string; source?: "local" | "environment";
}
export interface SetupProviderSnapshot {
  id: SetupProviderId; enabled: boolean; automaticPosition?: number; external?: boolean;
  keys: SetupKeySnapshot[]; instances: SetupInstanceSnapshot[];
}
export interface SetupSnapshot { providers: SetupProviderSnapshot[]; providerOrder: ProviderId[]; setupLanguage?: SetupLanguage }

// Only known, reference-only diagnostics cross this UI boundary; parser/IO details may contain secrets.
async function safe<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof ProviderError && error.message.startsWith("Setup:")) throw error;
    throw new ProviderError("Setup: Unable to read or update local setup files safely; inspect their permissions and format.", { kind: "config" });
  }
}
function fail(message: string): never { throw new ProviderError(`Setup: ${message}`, { kind: "invalid-request" }); }
async function loadCredentialStore(path: string) {
  try { return await readCredentialStore(path); }
  catch { fail("Unable to read the credential store safely; inspect its permissions and format."); }
}
function assertProvider(provider: ProviderId): asserts provider is SetupProviderId {
  if (!managedProviders.includes(provider as SetupProviderId)) fail("Only Exa, Tavily, Firecrawl, and SearXNG are managed here.");
}
function assertKeyed(provider: ProviderId): asserts provider is KeyedProvider {
  assertProvider(provider); if (provider === "searxng") fail("SearXNG is keyless.");
}
async function configFor(paths: ArkSpacePaths): Promise<ArkSpaceConfig> {
  const raw = await readJsonFile(paths.config);
  return raw === undefined ? defaultConfig() : ArkSpaceConfigSchema.parse(raw);
}
function owners(state: ArkSpaceState, provider: ProviderId, keyId?: string): number {
  return Object.values(state.resources).flatMap(group => Object.values(group)).filter(owner =>
    owner.provider === provider && (keyId === undefined || owner.keyId === keyId)).length;
}
function guardOwners(state: ArkSpaceState, provider: ProviderId, reference?: string): void {
  if (owners(state, provider, reference === undefined ? undefined : keyIdFor(provider, reference))) {
    fail("Tracked owned resources require this credential and enabled provider for cleanup; clean them up first.");
  }
}
function target(config: ArkSpaceConfig, provider: KeyedProvider, reference: string) {
  const entry = config.providers[provider];
  if (!entry?.keyRefs.includes(reference)) fail("The selected key reference is no longer configured; refresh setup.");
  return entry;
}
function references(config: ArkSpaceConfig, reference: string): number {
  return Object.values(config.providers).reduce((count, entry) => count + (entry?.keyRefs.filter(ref => ref === reference).length ?? 0), 0);
}
function secretValue(secret: string): string {
  const value = validateCredentialValue(secret);
  if (!value) fail("Credential values must be non-empty and must not contain controls or placeholders.");
  return value;
}
// Consistent lock order: config -> state -> credentials. No prompts or network inside these locks.
function locked<T>(paths: ArkSpacePaths, action: () => Promise<T>): Promise<T> {
  return safe(() => withFileLock(paths.config, () => withFileLock(paths.state, () => withFileLock(paths.credentials, action))));
}

export async function getSetupSnapshot(paths: ArkSpacePaths, environment: NodeJS.ProcessEnv = process.env): Promise<SetupSnapshot> {
  return locked(paths, async () => {
    const config = await configFor(paths); const state = await loadState(paths.state);
    const store = await loadCredentialStore(paths.credentials);
    return { ...(config.setupLanguage ? { setupLanguage: config.setupLanguage } : {}), providerOrder: [...config.providerOrder], providers: managedProviders.map(id => {
      const searxng = id === "searxng" ? getSearxngConfig(config, environment) : undefined;
      const entry = id === "searxng" ? searxng : config.providers[id];
      const index = config.providerOrder.indexOf(id);
      return {
        id, enabled: entry?.enabled ?? false, ...(index < 0 ? {} : { automaticPosition: index + 1 }),
        ...(id === "searxng" && entry && !config.providers.searxng ? { external: true } : {}),
        keys: id === "searxng" ? [] : (entry?.keyRefs ?? []).map(reference => {
          const variable = reference.slice(4); const keyId = keyIdFor(id, reference);
          const hasLocal = Object.hasOwn(store.values, variable);
          const value = environment[variable] !== undefined ? environment[variable] : store.values[variable];
          const metadata = state.providers[id]?.keys[keyId];
          const expired = (metadata?.status === "cooldown" || metadata?.status === "exhausted") &&
            (metadata.cooldownUntil ?? 0) <= Date.now();
          return { reference, keyId, hasLocal, available: value !== undefined && validateCredentialValue(value) !== undefined,
            source: environment[variable] !== undefined ? "environment" as const : hasLocal ? "local" as const : "missing" as const,
            status: expired ? "enabled" : metadata?.status ?? "enabled", ownedResources: owners(state, id, keyId),
            manualDisabled: metadata?.status === "disabled" && metadata.lastFailure === "operator-disabled",
            ...(metadata?.lastFailure && !expired ? { healthReason: metadata.lastFailure === "operator-disabled" ? "operator-disabled" as const : FAILURE_KINDS.includes(metadata.lastFailure as FailureKind) ? metadata.lastFailure as FailureKind : "unknown" as const } : {}),
            ...(!expired && (metadata?.status === "cooldown" || metadata?.status === "exhausted") ? { cooldownRemainingMs: Math.max(0, (metadata.cooldownUntil ?? 0) - Date.now()) } : {}),
            sharedProviders: PROVIDER_IDS.filter(other => other !== id && config.providers[other]?.keyRefs.some(ref => ref === reference)),
            ownedResourceTypes: {
              browserSessions: Object.values(state.resources.browserSessions).filter(owner => owner.provider === id && owner.keyId === keyId).length,
              monitors: Object.values(state.resources.monitors).filter(owner => owner.provider === id && owner.keyId === keyId).length,
              siteMonitors: Object.values(state.resources.siteMonitors).filter(owner => owner.provider === id && owner.keyId === keyId).length,
            } };
        }),
        instances: id === "searxng" ? (searxng?.instances ?? []).map(instance => ({
          ...instance, allowRanges: [...instance.allowRanges], status: !entry?.enabled ? "disabled" :
            (searxng?.instances.length ?? 0) > 1 && (state.searxng?.instances[searxngInstanceIdFor(instance.baseUrl)]?.cooldownUntil ?? 0) > Date.now() ? "cooldown" : "configured (not probed)",
          source: config.providers.searxng ? "local" as const : "environment" as const,
        })) : [],
      };
    }) };
  });
}

export async function addSetupKey(paths: ArkSpacePaths, provider: ProviderId, secret: string, environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  assertKeyed(provider); const value = secretValue(secret);
  return locked(paths, async () => {
    const config = await configFor(paths); await loadState(paths.state);
    const store = await loadCredentialStore(paths.credentials);
    const entry = config.providers[provider] ?? defaultConfig().providers[provider]!;
    const base = defaultVariables[provider]; let variable = base;
    const occupied = (name: string) => Object.hasOwn(store.values, name) || Object.hasOwn(environment, name) ||
      Object.entries(config.providers).some(([id, item]) => item?.keyRefs.some(ref => ref === `env:${name}`) && (id !== provider || name !== base));
    for (let index = 1; occupied(variable); index++) variable = `${base}_${index}`;
    const reference = `env:${variable}`;
    store.values[variable] = value;
    await writeJsonAtomic(paths.credentials, store);
    if (!entry.keyRefs.includes(reference)) entry.keyRefs.push(reference);
    config.providers[provider] = entry;
    try { await writeJsonAtomic(paths.config, ArkSpaceConfigSchema.parse(config)); }
    catch { fail(`Local credential remains stored as ${reference}, but registration failed; recover with arks key add ${provider} --env ${variable}.`); }
    return reference;
  });
}

export async function replaceSetupKey(paths: ArkSpacePaths, provider: ProviderId, reference: string, secret: string, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertKeyed(provider); const value = secretValue(secret);
  await locked(paths, async () => {
    const config = await configFor(paths); target(config, provider, reference);
    const state = await loadState(paths.state); guardOwners(state, provider, reference);
    const store = await loadCredentialStore(paths.credentials); const variable = reference.slice(4);
    if (Object.hasOwn(environment, variable)) fail("The selected reference is environment-managed; change it externally or add a new local key.");
    if (references(config, reference) !== 1) fail("The selected reference is shared; unlink it or add a new local key instead.");
    if (!Object.hasOwn(store.values, variable)) fail("The selected key has no local credential to replace.");
    store.values[variable] = value; await writeJsonAtomic(paths.credentials, store);
    const keys = state.providers[provider]?.keys;
    if (keys?.[keyIdFor(provider, reference)]?.lastFailure !== "operator-disabled") {
      if (keys) delete keys[keyIdFor(provider, reference)];
      try { await writeJsonAtomic(paths.state, state); }
      catch { fail("Local credential was replaced, but key health reset failed; inspect state before retrying."); }
    }
  });
}

export async function removeSetupKey(paths: ArkSpacePaths, provider: ProviderId, reference: string): Promise<void> {
  assertKeyed(provider);
  await locked(paths, async () => {
    const config = await configFor(paths); const entry = target(config, provider, reference);
    const state = await loadState(paths.state); guardOwners(state, provider, reference);
    const store = await loadCredentialStore(paths.credentials);
    entry.keyRefs = entry.keyRefs.filter(ref => ref !== reference);
    await writeJsonAtomic(paths.config, config);
    if (references(config, reference) === 0 && Object.hasOwn(store.values, reference.slice(4))) {
      delete store.values[reference.slice(4)];
      try { await writeJsonAtomic(paths.credentials, store); }
      catch { fail("Reference was unlinked, but its local credential remains stored; remove the orphaned credential after inspecting the store."); }
    }
  });
}

export async function setSetupKeyEnabled(paths: ArkSpacePaths, provider: ProviderId, reference: string, enabled: boolean): Promise<void> {
  assertKeyed(provider);
  await locked(paths, async () => {
    target(await configFor(paths), provider, reference); await loadCredentialStore(paths.credentials);
    const state = await loadState(paths.state); const pool = (state.providers[provider] ??= { cursor: 0, keys: {} });
    pool.keys[keyIdFor(provider, reference)] = enabled ? { status: "enabled", consecutiveFailures: 0 } :
      { status: "disabled", consecutiveFailures: 0, lastFailure: "operator-disabled" };
    await writeJsonAtomic(paths.state, state);
  });
}

export async function setSetupProviderEnabled(paths: ArkSpacePaths, provider: ProviderId, enabled: boolean): Promise<void> {
  assertProvider(provider);
  await locked(paths, async () => {
    const config = await configFor(paths); const state = await loadState(paths.state); await loadCredentialStore(paths.credentials);
    if (!enabled) guardOwners(state, provider);
    const entry = config.providers[provider];
    if (!entry) fail(provider === "searxng" ? "SearXNG has no local entry; environment endpoints are external. Add a local instance explicitly first." : "Provider has no local configuration; add a key explicitly first.");
    entry.enabled = enabled; await writeJsonAtomic(paths.config, config);
  });
}
export async function setSetupProviderOrder(paths: ArkSpacePaths, order: ProviderId[]): Promise<void> {
  if (!order.length || new Set(order).size !== order.length) fail("Automatic provider order must be nonempty and contain no duplicates.");
  if (order.some(id => !PROVIDER_IDS.includes(id))) fail("Unknown provider in automatic order.");
  await safe(() => withFileLock(paths.config, async () => {
    const config = await configFor(paths); config.providerOrder = [...order];
    await writeJsonAtomic(paths.config, ArkSpaceConfigSchema.parse(config));
  }));
}
export async function setSetupLanguage(paths: ArkSpacePaths, language: SetupLanguage): Promise<void> {
  if (language !== "en" && language !== "zh") fail("Setup language must be en or zh.");
  await safe(() => withFileLock(paths.config, async () => {
    const config = await configFor(paths);
    config.setupLanguage = language;
    await writeJsonAtomic(paths.config, ArkSpaceConfigSchema.parse(config));
  }));
}

function localInstances(config: ArkSpaceConfig) {
  const entry = config.providers.searxng;
  if (!entry) fail("SearXNG has no local entry; environment endpoints are external. Add a local instance explicitly first.");
  return entry;
}
function instanceIndex(config: ArkSpaceConfig, baseUrl: string): number {
  const identity = SearxngInstanceSchema.safeParse({ baseUrl });
  if (!identity.success) fail("Invalid SearXNG instance identity.");
  const index = localInstances(config).instances.findIndex(instance => instance.baseUrl === identity.data.baseUrl);
  if (index < 0) fail("The selected instance is no longer configured; refresh setup.");
  return index;
}
export async function updateSetupInstance(paths: ArkSpacePaths, oldBaseUrl: string, newBaseUrl: string, allowRanges: string[]): Promise<void> {
  const parsed = SearxngInstanceSchema.safeParse({ baseUrl: newBaseUrl, allowRanges });
  if (!parsed.success) fail("Invalid SearXNG endpoint or per-instance CIDR configuration.");
  await safe(() => withFileLock(paths.config, async () => {
    const config = await configFor(paths); const index = instanceIndex(config, oldBaseUrl); const entry = localInstances(config);
    if (entry.instances.some((instance, other) => other !== index && instance.baseUrl === parsed.data.baseUrl)) fail("SearXNG instance is already configured; permissions were not changed.");
    entry.instances[index] = parsed.data; await writeJsonAtomic(paths.config, ArkSpaceConfigSchema.parse(config));
  }));
}
export async function removeSetupInstance(paths: ArkSpacePaths, baseUrl: string): Promise<void> {
  await safe(() => withFileLock(paths.config, async () => {
    const config = await configFor(paths); const index = instanceIndex(config, baseUrl); const entry = localInstances(config);
    if (entry.instances.length === 1) {
      const order = config.providerOrder.filter(id => id !== "searxng");
      if (!order.length) fail("Change automatic provider order before removing the last SearXNG instance.");
      config.providerOrder = order; delete config.providers.searxng;
    } else entry.instances.splice(index, 1);
    await writeJsonAtomic(paths.config, ArkSpaceConfigSchema.parse(config));
  }));
}
