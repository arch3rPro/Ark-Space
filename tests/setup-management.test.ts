import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as jsonStore from "../src/io/json-store.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { loadCredentialEnvironment, storeCredential } from "../src/config/credentials.js";
import { addEnvironmentKey, addSearxngInstance, initializeConfig, loadConfig } from "../src/config/store.js";
import { addSetupKey, getSetupSnapshot, removeSetupKey, replaceSetupKey, setSetupKeyEnabled, setSetupProviderEnabled, setSetupProviderOrder, setSetupLanguage, updateSetupInstance, removeSetupInstance } from "../src/config/manage.js";
import { keyIdFor, loadState, recordKeyResult, resolveOwnedCredential, selectCredential } from "../src/key-pool/key-pool.js";
import { emptyState } from "../src/state/schema.js";
import { recordInstanceResult, selectSearxngInstance } from "../src/providers/searxng-pool.js";

const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-management-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home });
  await initializeConfig(paths.config);
  return paths;
}
it("keeps existing initialization read-only and never reconciles automatic order", async () => {
  const paths = await fixture(); const config = await loadConfig(paths.config);
  config.providerOrder = ["tavily"]; delete config.providers.exa;
  await writeFile(paths.config, JSON.stringify(config)); const before = await readFile(paths.config, "utf8");
  await initializeConfig(paths.config); expect(await readFile(paths.config, "utf8")).toBe(before);
  await addEnvironmentKey(paths.config, "exa", "MY_KEY");
  expect((await loadConfig(paths.config)).providerOrder).toEqual(["tavily"]);
  expect((await loadConfig(paths.config)).providers.exa!.keyRefs).toContain("env:MY_KEY");
});
it("allocates concurrent keys without collisions across configured, stored, and original environment references", async () => {
  const paths = await fixture(); await addEnvironmentKey(paths.config, "tavily", "EXA_API_KEY");
  await storeCredential(paths.credentials, "EXA_API_KEY_1", "fixture-stored-secret");
  const refs = await Promise.all([addSetupKey(paths, "exa", "fixture-first-secret", { EXA_API_KEY_2: "fixture-env-secret" }), addSetupKey(paths, "exa", "fixture-second-secret", { EXA_API_KEY_2: "fixture-env-secret" })]);
  expect(new Set(refs)).toEqual(new Set(["env:EXA_API_KEY_3", "env:EXA_API_KEY_4"]));
  // Lock acquisition order need not match Promise.all submission order.
  expect((await loadConfig(paths.config)).providers.exa!.keyRefs).toEqual(["env:EXA_API_KEY", "env:EXA_API_KEY_3", "env:EXA_API_KEY_4"]);
  const snapshot = await getSetupSnapshot(paths, { EXA_API_KEY_2: "fixture-env-secret" });
  expect(JSON.stringify(snapshot)).not.toContain("fixture-");
  expect(snapshot.providers.find(p => p.id === "exa")!.keys.find(k => k.reference === refs[0])).toMatchObject({ source: "local", hasLocal: true, status: "enabled", ownedResources: 0 });
});
it.each(["browserSessions", "monitors", "siteMonitors"] as const)("guards recorded %s ownership and allows disabling for cleanup", async kind => {
  const paths = await fixture(); const provider = kind === "monitors" ? "exa" : "firecrawl";
  const reference = await addSetupKey(paths, provider, "fixture-owned-secret", {});
  const state = emptyState(); const owner = { provider, keyId: keyIdFor(provider, reference), createdAt: new Date().toISOString(), ...(kind === "monitors" ? { secretPath: "/fixture/webhook" } : {}) };
  Object.assign(state.resources[kind], { resource: owner }); await writeFile(paths.state, JSON.stringify(state));
  await expect(replaceSetupKey(paths, provider, reference, "fixture-replacement-secret", {})).rejects.toThrow(/owned resources/);
  await expect(removeSetupKey(paths, provider, reference)).rejects.toThrow(/owned resources/);
  await expect(setSetupProviderEnabled(paths, provider, false)).rejects.toThrow(/owned resources/);
  await setSetupKeyEnabled(paths, provider, reference, false);
  const config = await loadConfig(paths.config);
  await recordKeyResult(paths.state, provider, keyIdFor(provider, reference), config.providers[provider]!, { ok: true });
  expect((await loadState(paths.state)).providers[provider]!.keys[keyIdFor(provider, reference)]!.status).toBe("disabled");
  const environment = await loadCredentialEnvironment(paths.credentials, {});
  await expect(selectCredential(paths.state, provider, config.providers[provider]!, environment)).rejects.toThrow(/unavailable/);
  expect(resolveOwnedCredential(provider, keyIdFor(provider, reference), config.providers[provider]!, environment).value).toBe("fixture-owned-secret");
  await recordKeyResult(paths.state, provider, keyIdFor(provider, reference), config.providers[provider]!, { ok: false, kind: "rate-limit" });
  expect((await loadState(paths.state)).providers[provider]!.keys[keyIdFor(provider, reference)]!.status).toBe("disabled");
  expect((await getSetupSnapshot(paths, {})).providers.find(p => p.id === provider)!.keys[0]!.ownedResources).toBe(1);
  await setSetupKeyEnabled(paths, provider, reference, true);
  expect((await loadState(paths.state)).providers[provider]!.keys[keyIdFor(provider, reference)]!.status).toBe("enabled");
  expect((await loadState(paths.state)).resources).toEqual(state.resources);
});
it("excludes a manually disabled invalid override without weakening validation of active or owned references", async () => {
  const paths = await fixture();
  await addSetupKey(paths, "exa", "fixture-good-secret", { EXA_API_KEY: "" });
  const config = (await loadConfig(paths.config)).providers.exa!;
  const environment = await loadCredentialEnvironment(paths.credentials, { EXA_API_KEY: "" });
  await expect(selectCredential(paths.state, "exa", config, environment)).rejects.toMatchObject({ kind: "config" });
  await setSetupKeyEnabled(paths, "exa", "env:EXA_API_KEY", false);
  expect((await selectCredential(paths.state, "exa", config, environment)).keyId).toBe(keyIdFor("exa", "env:EXA_API_KEY_1"));
  expect(() => resolveOwnedCredential("exa", keyIdFor("exa", "env:EXA_API_KEY"), config, environment)).toThrow(/Invalid credential value/);
  await setSetupKeyEnabled(paths, "exa", "env:EXA_API_KEY", true);
  await expect(selectCredential(paths.state, "exa", config, environment)).rejects.toMatchObject({ kind: "config" });
});
it("refuses environment and shared replacement while unlinking only the selected reference", async () => {
  const paths = await fixture(); const ref = await addSetupKey(paths, "exa", "fixture-local-secret", {});
  await expect(replaceSetupKey(paths, "exa", ref, "fixture-new-secret", { EXA_API_KEY: "fixture-environment-secret" })).rejects.toThrow(/environment/);
  await addEnvironmentKey(paths.config, "tavily", ref.slice(4));
  await expect(replaceSetupKey(paths, "exa", ref, "fixture-new-secret", {})).rejects.toThrow(/shared/);
  await removeSetupKey(paths, "exa", ref);
  expect((await loadConfig(paths.config)).providers.tavily!.keyRefs).toContain(ref);
  expect((await loadCredentialEnvironment(paths.credentials, {})).EXA_API_KEY).toBe("fixture-local-secret");
  await expect(removeSetupKey(paths, "exa", ref)).rejects.toThrow(/no longer configured/);
  await removeSetupKey(paths, "tavily", ref);
  expect((await loadCredentialEnvironment(paths.credentials, {})).EXA_API_KEY).toBeUndefined();
});
it("preserves disabled providers and explicit order when adding keys; validates before mutation", async () => {
  const paths = await fixture(); await setSetupProviderOrder(paths, ["tavily"]); await setSetupProviderEnabled(paths, "exa", false);
  await addSetupKey(paths, "exa", "fixture-added-secret", {});
  expect((await loadConfig(paths.config)).providers.exa!.enabled).toBe(false);
  expect((await loadConfig(paths.config)).providerOrder).toEqual(["tavily"]);
  const before = await readFile(paths.config, "utf8");
  await expect(setSetupProviderOrder(paths, [])).rejects.toThrow();
  await expect(setSetupProviderOrder(paths, ["exa", "exa"])).rejects.toThrow();
  await expect(addSetupKey(paths, "exa", "placeholder", {})).rejects.toThrow();
  expect(await readFile(paths.config, "utf8")).toBe(before);
  await writeFile(paths.credentials, "{}");
  await expect(addSetupKey(paths, "exa", "fixture-valid-secret", {})).rejects.toThrow(/credential store/);
  expect(await readFile(paths.config, "utf8")).toBe(before);
});
it("keeps a disabled SearXNG provider disabled when appending an instance", async () => {
  const paths = await fixture();
  await addSearxngInstance(paths.config, "https://first.example", []);
  await setSetupProviderOrder(paths, ["searxng", "tavily"]);
  await setSetupProviderEnabled(paths, "searxng", false);
  await addSearxngInstance(paths.config, "https://second.example", []);
  const config = await loadConfig(paths.config);
  expect(config.providers.searxng!.enabled).toBe(false);
  expect(config.providers.searxng!.instances).toHaveLength(2);
  expect(config.providerOrder).toEqual(["searxng", "tavily"]);
});
it("edits per-instance ranges, rejects duplicates and stale targets, and removes last entry without refilling order", async () => {
  const paths = await fixture(); await addSearxngInstance(paths.config, "http://127.0.0.1:8080", ["127.0.0.1/32"]); await addSearxngInstance(paths.config, "https://search.example", []);
  const before = await readFile(paths.config, "utf8");
  await expect(updateSetupInstance(paths, "https://search.example", "http://127.0.0.1:8080/", ["127.0.0.0/8"])).rejects.toThrow(/already configured/);
  await expect(updateSetupInstance(paths, "https://search.example", "https://new.example", ["127.0.0.1/33"])).rejects.toThrow();
  expect(await readFile(paths.config, "utf8")).toBe(before);
  await updateSetupInstance(paths, "https://search.example", "http://[::1]:8080", ["::1/128"]);
  await expect(removeSetupInstance(paths, "https://search.example")).rejects.toThrow(/no longer configured/);
  await removeSetupInstance(paths, "http://127.0.0.1:8080"); await setSetupProviderOrder(paths, ["searxng"]);
  await expect(removeSetupInstance(paths, "http://[::1]:8080")).rejects.toThrow(/order/);
  await setSetupProviderOrder(paths, ["searxng", "tavily"]); await removeSetupInstance(paths, "http://[::1]:8080");
  expect((await loadConfig(paths.config)).providers.searxng).toBeUndefined(); expect((await loadConfig(paths.config)).providerOrder).toEqual(["tavily"]);
});
it("shows environment-only instances without persisting or mutating them", async () => {
  const paths = await fixture(); const before = await readFile(paths.config, "utf8");
  const provider = (await getSetupSnapshot(paths, { SEARXNG_URL: "https://external.example" })).providers.find(p => p.id === "searxng")!;
  expect(provider).toMatchObject({ enabled: true, external: true });
  expect(provider.instances[0]).toMatchObject({ source: "environment" });
  await expect(setSetupProviderEnabled(paths, "searxng", false)).rejects.toThrow(/external/);
  await expect(removeSetupInstance(paths, "https://external.example")).rejects.toThrow(/external/);
  expect(await readFile(paths.config, "utf8")).toBe(before);
});
it("never exposes source bytes from malformed private files", async () => {
  const paths = await fixture(); const before = await readFile(paths.config, "utf8");
  await writeFile(paths.credentials, '{"version":1,"values":{"EXA_API_KEY":"fixture-sensitive-secret"}, invalid');
  for (const action of [() => getSetupSnapshot(paths, {}), () => addSetupKey(paths, "exa", "fixture-safe-secret", {}), () => replaceSetupKey(paths, "exa", "env:EXA_API_KEY", "fixture-safe-secret", {})]) {
    try { await action(); throw new Error("Expected rejection"); }
    catch (error) { expect(String(error)).toContain("credential store"); expect(String(error)).not.toContain("fixture-"); }
  }
  expect(await readFile(paths.config, "utf8")).toBe(before);
});
it("replaces a selected local reference without changing enabled state, order, or unrelated data", async () => {
  const paths = await fixture(); const ref = await addSetupKey(paths, "exa", "fixture-initial-secret", {});
  await addSetupKey(paths, "exa", "fixture-other-secret", {}); await setSetupKeyEnabled(paths, "exa", ref, false);
  const before = await readFile(paths.config, "utf8");
  await replaceSetupKey(paths, "exa", ref, "fixture-replacement-secret", {});
  expect((await loadCredentialEnvironment(paths.credentials, {}))).toEqual({ EXA_API_KEY: "fixture-replacement-secret", EXA_API_KEY_1: "fixture-other-secret" });
  expect(await readFile(paths.config, "utf8")).toBe(before);
  expect((await loadState(paths.state)).providers.exa!.keys[keyIdFor("exa", ref)]!.status).toBe("disabled");
});
it("unlinks environment-managed references without touching the original environment", async () => {
  const paths = await fixture(); const environment = { EXA_API_KEY: "fixture-external-secret" };
  expect((await getSetupSnapshot(paths, environment)).providers[0]!.keys[0]).toMatchObject({ source: "environment", hasLocal: false });
  await removeSetupKey(paths, "exa", "env:EXA_API_KEY");
  expect(environment.EXA_API_KEY).toBe("fixture-external-secret");
  expect((await loadConfig(paths.config)).providers.exa!.keyRefs).toEqual([]);
});
it("reports a persisted credential honestly when config registration fails", async () => {
  const paths = await fixture(); await storeCredential(paths.credentials, "EXA_API_KEY", "fixture-first-secret");
  const write = jsonStore.writeJsonAtomic;
  vi.spyOn(jsonStore, "writeJsonAtomic").mockImplementation(async (path, value) => {
    if (path === paths.config) throw new Error("fixture-sensitive-IO-detail");
    return write(path, value);
  });
  await expect(addSetupKey(paths, "exa", "fixture-partial-secret", {})).rejects.toThrow(/Local credential remains stored as env:EXA_API_KEY_1, but registration failed/);
  expect((await loadCredentialEnvironment(paths.credentials, {})).EXA_API_KEY_1).toBe("fixture-partial-secret");
  expect((await loadConfig(paths.config)).providers.exa!.keyRefs).toEqual(["env:EXA_API_KEY"]);
});
it("preserves valid local order entries without exposing local key management", async () => {
  const paths = await fixture(); await setSetupProviderOrder(paths, ["local", "tavily"]);
  expect((await loadConfig(paths.config)).providerOrder).toEqual(["local", "tavily"]);
  await expect(addSetupKey(paths, "local", "fixture-local-secret", {})).rejects.toThrow(/Only Exa/);
});
it.each(["", "placeholder", "fixture-control\nsecret"])("reports unavailable overridden keys without exposing invalid environment bytes", async value => {
  const paths = await fixture(); await addSetupKey(paths, "exa", "fixture-stored-secret", {});
  const snapshot = await getSetupSnapshot(paths, { EXA_API_KEY: value });
  expect(snapshot.providers[0]!.keys[0]).toMatchObject({ source: "environment", hasLocal: true, available: false });
  expect(JSON.stringify(snapshot)).not.toContain("fixture-");
});
it("shows cached instance cooldown and treats expiration as eligible without persisting snapshot state", async () => {
  const paths = await fixture(); await addSearxngInstance(paths.config, "https://first.example", []);
  await addSearxngInstance(paths.config, "https://second.example", []);
  const config = (await loadConfig(paths.config)).providers.searxng!;
  const now = Date.now(); const lease = (await selectSearxngInstance(paths.state, config, new Set(), now))!;
  await recordInstanceResult(paths.state, config, lease.instanceId, { ok: false, kind: "rate-limit" }, now);
  const before = await readFile(paths.state, "utf8");
  expect((await getSetupSnapshot(paths, {})).providers.find(p => p.id === "searxng")!.instances[0]!.status).toBe("cooldown");
  vi.spyOn(Date, "now").mockReturnValue(now + config.cooldownSeconds * 1000 + 1);
  expect((await getSetupSnapshot(paths, {})).providers.find(p => p.id === "searxng")!.instances[0]!.status).toBe("configured (not probed)");
  expect(await readFile(paths.state, "utf8")).toBe(before);
});
it("does not count ignored multi-instance cooldown as active after reducing SearXNG to a singleton", async () => {
  const paths = await fixture();
  await addSearxngInstance(paths.config, "https://first.example", []);
  await addSearxngInstance(paths.config, "https://second.example", []);
  const config = (await loadConfig(paths.config)).providers.searxng!;
  const lease = (await selectSearxngInstance(paths.state, config, new Set()))!;
  await recordInstanceResult(paths.state, config, lease.instanceId, { ok: false, kind: "rate-limit" });
  await removeSetupInstance(paths, "https://second.example");
  const before = await readFile(paths.state, "utf8");
  const instances = (await getSetupSnapshot(paths, {})).providers.find(p => p.id === "searxng")!.instances;
  expect(instances).toHaveLength(1);
  expect(instances[0]!.status).toBe("configured (not probed)");
  expect(await readFile(paths.state, "utf8")).toBe(before);
});
it("persists only explicitly selected supported setup languages without touching credentials, state, or routing", async () => {
  const paths = await fixture();
  expect((await loadConfig(paths.config)).setupLanguage).toBeUndefined();
  await addSetupKey(paths, "exa", "fixture-language-secret", {});
  await setSetupKeyEnabled(paths, "exa", "env:EXA_API_KEY", false);
  await setSetupProviderOrder(paths, ["tavily"]);
  const config = await loadConfig(paths.config);
  const credentials = await readFile(paths.credentials, "utf8");
  const state = await readFile(paths.state, "utf8");
  for (const language of ["zh", "en"] as const) {
    await setSetupLanguage(paths, language);
    expect(await loadConfig(paths.config)).toEqual({ ...config, setupLanguage: language });
    expect((await getSetupSnapshot(paths, {})).setupLanguage).toBe(language);
  }
  const before = await readFile(paths.config, "utf8");
  await expect(setSetupLanguage(paths, "fr" as "en")).rejects.toThrow(/en or zh/);
  expect(await readFile(paths.config, "utf8")).toBe(before);
  expect(await readFile(paths.credentials, "utf8")).toBe(credentials);
  expect(await readFile(paths.state, "utf8")).toBe(state);
});
it.each(["cooldown", "exhausted"] as const)("reports expired %s keys as eligible without mutating health state", async status => {
  const paths = await fixture();
  const reference = await addSetupKey(paths, "exa", "fixture-expired-secret", {});
  const state = emptyState();
  state.providers.exa = { cursor: 0, keys: { [keyIdFor("exa", reference)]: { status, cooldownUntil: Date.now() - 1, consecutiveFailures: 1 } } };
  await writeFile(paths.state, JSON.stringify(state));
  const before = await readFile(paths.state, "utf8");
  expect((await getSetupSnapshot(paths, {})).providers[0]!.keys[0]!.status).toBe("enabled");
  expect(await readFile(paths.state, "utf8")).toBe(before);
});
it("curates read-only key source, health, sharing and ownership details without secret-bearing metadata", async () => {
  const paths = await fixture();
  const ref = await addSetupKey(paths, "firecrawl", "fixture-details-local", {});
  await addEnvironmentKey(paths.config, "exa", ref.slice(4));
  const state = emptyState(); const keyId = keyIdFor("firecrawl", ref);
  state.providers.firecrawl = { cursor: 0, keys: { [keyId]: { status: "cooldown", cooldownUntil: Date.now() + 60_000, lastFailure: "rate-limit", consecutiveFailures: 2 } } };
  state.resources.browserSessions["fixture-authority-url"] = { provider: "firecrawl", keyId, createdAt: new Date().toISOString() };
  state.resources.siteMonitors["fixture-live-url"] = { provider: "firecrawl", keyId, createdAt: new Date().toISOString() };
  await writeFile(paths.state, JSON.stringify(state)); const before = await readFile(paths.state, "utf8");
  const snapshot = await getSetupSnapshot(paths, { FIRECRAWL_API_KEY: "fixture-details-env" });
  expect(snapshot.providers[2]!.keys[0]).toMatchObject({ source: "environment", hasLocal: true, manualDisabled: false, healthReason: "rate-limit", sharedProviders: ["exa"], ownedResourceTypes: { browserSessions: 1, monitors: 0, siteMonitors: 1 } });
  expect(snapshot.providers[2]!.keys[0]!.cooldownRemainingMs).toBeGreaterThan(0);
  expect(JSON.stringify(snapshot)).not.toContain("fixture-"); expect(await readFile(paths.state, "utf8")).toBe(before);
  state.providers.firecrawl!.keys[keyId]!.lastFailure = "fixture-sensitive-metadata";
  await writeFile(paths.state, JSON.stringify(state));
  expect((await getSetupSnapshot(paths, {})).providers[2]!.keys[0]!.healthReason).toBe("unknown");
  await setSetupKeyEnabled(paths, "firecrawl", ref, false);
  expect((await getSetupSnapshot(paths, {})).providers[2]!.keys[0]).toMatchObject({ manualDisabled: true, healthReason: "operator-disabled" });
});
it("rechecks ownership under the state lock instead of trusting the menu snapshot", async () => {
  const paths = await fixture(); const ref = await addSetupKey(paths, "firecrawl", "fixture-owned-secret", {});
  expect((await getSetupSnapshot(paths, {})).providers.find(p => p.id === "firecrawl")!.keys[0]!.ownedResources).toBe(0);
  let release!: () => void; let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ownerWrite = jsonStore.withFileLock(paths.state, async () => {
    acquired(); await gate; const state = await loadState(paths.state);
    state.resources.browserSessions.resource = { provider: "firecrawl", keyId: keyIdFor("firecrawl", ref), createdAt: new Date().toISOString() };
    await jsonStore.writeJsonAtomic(paths.state, state);
  });
  await ready;
  const removal = removeSetupKey(paths, "firecrawl", ref);
  release(); await ownerWrite;
  await expect(removal).rejects.toThrow(/owned resources/);
  expect((await loadCredentialEnvironment(paths.credentials, {})).FIRECRAWL_API_KEY).toBe("fixture-owned-secret");
});
