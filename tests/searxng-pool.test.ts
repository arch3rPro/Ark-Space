import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArkSpaceConfigSchema, defaultConfig, getProviderConfig } from "../src/config/schema.js";
import { addSearxngInstance, configureSearxng, loadConfig } from "../src/config/store.js";
import { withFileLock } from "../src/io/json-store.js";
import { awaitWithAbort } from "../src/capabilities/abortable.js";
import { recordInstanceResult, selectSearxngInstance } from "../src/providers/searxng-pool.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(h => rm(h, { recursive: true, force: true }))); });
async function home() { const h = await mkdtemp(join(tmpdir(), "arks-instance-pool-")); homes.push(h); return h; }
async function config(path: string) {
  await addSearxngInstance(path, "https://one.test/prefix///", ["127.0.0.1/32"]);
  return (await addSearxngInstance(path, "https://two.test", [])).providers.searxng!;
}
it("appends from fresh or legacy config, normalizes URLs, and rejects duplicates without permission broadening", async () => {
  const h = await home(); const path = join(h, "config.json");
  await configureSearxng(path, "https://ONE.test:443/prefix/", ["127.0.0.1/32"]);
  const appended = await addSearxngInstance(path, "https://two.test", []);
  expect(appended.providers.searxng!.instances).toEqual([
    { baseUrl: "https://one.test/prefix", allowRanges: ["127.0.0.1/32"] },
    { baseUrl: "https://two.test", allowRanges: [] },
  ]);
  await expect(addSearxngInstance(path, "https://one.test/prefix///", ["10.0.0.0/8"])).rejects.toThrow("already configured");
  expect(await loadConfig(path)).toEqual(appended);
  const fresh = await addSearxngInstance(join(h, "fresh.json"), "https://fresh.test", []);
  expect(fresh.providers.searxng!.instances).toHaveLength(1);
  expect(fresh.providerOrder).toEqual(defaultConfig().providerOrder);
  expect(JSON.parse(await readFile(path, "utf8")).providers.searxng.baseUrl).toBeUndefined();
});
it("accepts legacy/env singleton and rejects malformed or ambiguous instance configuration", () => {
  const raw = defaultConfig();
  const legacy = ArkSpaceConfigSchema.parse({ ...raw, providers: { ...raw.providers, searxng: { baseUrl: "https://one.test/", allowRanges: ["127.0.0.1/32"], enabled: false } } });
  expect(legacy.providers.searxng!.instances).toHaveLength(1);
  expect(getProviderConfig(legacy, "searxng", { SEARXNG_URL: "https://two.test" })).toMatchObject({ enabled: false, baseUrl: "https://one.test" });
  for (const entry of [
    { instances: [] }, { instances: [{ baseUrl: "https://one.test", allowRanges: ["oops"] }] },
    { instances: [{ baseUrl: "https://one.test" }, { baseUrl: "https://one.test/" }] },
    { baseUrl: "https://one.test", instances: [{ baseUrl: "https://two.test" }] },
  ]) expect(ArkSpaceConfigSchema.safeParse({ ...raw, providers: { ...raw.providers, searxng: entry } }).success).toBe(false);
});
it("selects sequentially and concurrently with a persistent cursor and anonymous state", async () => {
  const h = await home(); const entry = await config(join(h, "config.json")); const path = join(h, "state.json");
  const first = await selectSearxngInstance(path, entry, new Set());
  const second = await selectSearxngInstance(path, entry, new Set());
  expect(first!.baseUrl).toBe("https://one.test/prefix"); expect(second!.baseUrl).toBe("https://two.test");
  const selected = await Promise.all(Array.from({ length: 8 }, () => selectSearxngInstance(path, entry, new Set())));
  expect(selected.filter(x => x!.instanceId === first!.instanceId)).toHaveLength(4);
  const state = await readFile(path, "utf8");
  expect(state).not.toContain("https:"); expect(JSON.parse(state).providers).toEqual({}); expect(state).not.toContain('"keys"');
});
it("preserves newly appended instance health when an older config snapshot selects", async () => {
  const h = await home(); const path = join(h, "state.json"); const configPath = join(h, "config.json");
  const oldConfig = await config(configPath);
  const newConfig = (await addSearxngInstance(configPath, "https://three.test", [])).providers.searxng!;
  const a = (await selectSearxngInstance(path, newConfig, new Set(), 1000))!;
  const b = (await selectSearxngInstance(path, newConfig, new Set([a.instanceId]), 1000))!;
  const c = (await selectSearxngInstance(path, newConfig, new Set([a.instanceId, b.instanceId]), 1000))!;
  await recordInstanceResult(path, newConfig, c.instanceId, { ok: false, kind: "network" }, 1000);
  await selectSearxngInstance(path, oldConfig, new Set(), 1001);
  expect(await selectSearxngInstance(path, newConfig, new Set([a.instanceId, b.instanceId]), 1002)).toBeUndefined();
});
it("does not let an older successful request clear a newer unexpired cooldown", async () => {
  const h = await home(); const path = join(h, "state.json"); const entry = await config(join(h, "config.json"));
  const a = (await selectSearxngInstance(path, entry, new Set(), 1000))!;
  await recordInstanceResult(path, entry, a.instanceId, { ok: false, kind: "rate-limit" }, 1001);
  await recordInstanceResult(path, entry, a.instanceId, { ok: true }, 1002);
  const state = JSON.parse(await readFile(path, "utf8"));
  expect(state.searxng.instances[a.instanceId]).toMatchObject({ cooldownUntil: 301001, lastFailure: "rate-limit" });
});
it.each(["selection", "recording"])("does not mutate after cancellation queued behind a %s lock", async operation => {
  const h = await home(); const path = join(h, "state.json"); const entry = await config(join(h, "config.json"));
  const a = (await selectSearxngInstance(path, entry, new Set()))!;
  const before = await readFile(path, "utf8");
  let release!: () => void; let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const held = withFileLock(path, async () => { acquired(); await new Promise<void>(resolve => { release = resolve; }); });
  await ready;
  const controller = new AbortController();
  const pending = operation === "selection"
    ? selectSearxngInstance(path, entry, new Set(), Date.now(), controller.signal)
    : recordInstanceResult(path, entry, a.instanceId, { ok: false, kind: "network" }, Date.now(), controller.signal);
  const observed = awaitWithAbort<unknown>(pending, controller.signal);
  const started = Date.now();
  controller.abort(); await expect(observed).rejects.toThrow();
  try { await expect(pending).rejects.toThrow(); expect(Date.now() - started).toBeLessThan(200); }
  finally { release(); await held; }
  expect(await readFile(path, "utf8")).toBe(before);
});
it.each(["rate-limit", "network", "transient"] as const)("skips %s cooldowns and excluded instances and revives after expiry", async kind => {
  const h = await home(); const path = join(h, "state.json"); const entry = await config(join(h, "config.json"));
  const a = (await selectSearxngInstance(path, entry, new Set(), 1000))!;
  await recordInstanceResult(path, entry, a.instanceId, { ok: false, kind }, 1000);
  const b = (await selectSearxngInstance(path, entry, new Set(), 1001))!;
  expect(b.instanceId).not.toBe(a.instanceId);
  expect(await selectSearxngInstance(path, entry, new Set([b.instanceId]), 1002)).toBeUndefined();
  expect((await selectSearxngInstance(path, entry, new Set([b.instanceId]), 301001))!.instanceId).toBe(a.instanceId);
  // Unrelated concurrent selections must not cause this invocation to repeat an instance.
  await selectSearxngInstance(path, entry, new Set(), 301002);
  expect((await selectSearxngInstance(path, entry, new Set([a.instanceId]), 301003))!.instanceId).toBe(b.instanceId);
  expect(await selectSearxngInstance(path, entry, new Set([a.instanceId, b.instanceId]), 301004)).toBeUndefined();
});
