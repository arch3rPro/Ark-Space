import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as jsonStore from "../src/io/json-store.js";
import { getWeknoraConnectionSnapshot, saveWeknoraConnection, removeWeknoraConnection, replaceSetupKey, removeSetupKey, getSetupSnapshot } from "../src/config/manage.js";
import { addEnvironmentKey, loadConfig } from "../src/config/store.js";
import { ArkSpaceConfigSchema, defaultConfig } from "../src/config/schema.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { storeCredential, loadCredentialEnvironment } from "../src/config/credentials.js";
import { resolveWeknoraConnection } from "../src/config/weknora.js";

const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-weknora-")); homes.push(home);
  return resolveArkSpacePaths({ ARKSPACE_HOME: home });
}
const managed = () => ArkSpaceConfigSchema.parse({ ...defaultConfig(), connections: { weknora: {
  baseUrl: "https://managed.example/api/v1", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", defaultKnowledgeBaseId: "kb-default",
} } });

it("accepts an optional reference-only WeKnora connection without changing old defaults or provider order", () => {
  const old = defaultConfig();
  expect(ArkSpaceConfigSchema.parse(old).connections).toBeUndefined();
  const config = ArkSpaceConfigSchema.parse({ ...old, connections: { weknora: {
    baseUrl: "https://kb.example/deployment/api/v1", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY",
  } } });
  expect(config.connections?.weknora).toEqual({ baseUrl: "https://kb.example/deployment/api/v1", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", allowRanges: [] });
  expect(config.providerOrder).toEqual(old.providerOrder);
});

it("resolves neither supplied variable as managed, using original rather than hydrated provenance", async () => {
  const paths = await fixture();
  expect(await resolveWeknoraConnection(defaultConfig(), paths.credentials, {})).toBeUndefined();
  await storeCredential(paths.credentials, "ARKSPACE_WEKNORA_API_KEY", "fixture-managed-secret");
  await storeCredential(paths.credentials, "WEKNORA_API_KEY", "fixture-unrelated-secret");
  const hydrated = await loadCredentialEnvironment(paths.credentials, {});
  expect(hydrated.WEKNORA_API_KEY).toBeDefined();
  expect(await resolveWeknoraConnection(managed(), paths.credentials, {})).toMatchObject({ source: "managed", baseUrl: "https://managed.example/api/v1", apiKey: "fixture-managed-secret", defaultKnowledgeBaseId: "kb-default" });
});
it("selects a full external pair without reading a broken store or inheriting managed preferences", async () => {
  const paths = await fixture(); await writeFile(paths.credentials, "invalid fixture-secret");
  expect(await resolveWeknoraConnection(managed(), paths.credentials, { WEKNORA_BASE_URL: "http://127.0.0.1:8080/prefix/api/v1", WEKNORA_API_KEY: "fixture-external-secret" })).toEqual({ source: "environment", baseUrl: "http://127.0.0.1:8080/prefix/api/v1", apiKey: "fixture-external-secret", allowRanges: [], warnings: ["HTTP transport is plaintext."] });
});
it.each([
  { WEKNORA_BASE_URL: "https://external.example/api/v1" }, { WEKNORA_API_KEY: "fixture-external-secret" },
  { WEKNORA_BASE_URL: "" }, { WEKNORA_API_KEY: "" },
  { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "" },
  { WEKNORA_BASE_URL: "", WEKNORA_API_KEY: "fixture-external-secret" },
  { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "placeholder" },
  { WEKNORA_BASE_URL: "https://user:fixture-secret@external.example/api/v1", WEKNORA_API_KEY: "fixture-external-secret" },
])("rejects incomplete, empty or invalid external pair without mixing or fallback: %j", async environment => {
  const paths = await fixture(); await storeCredential(paths.credentials, "ARKSPACE_WEKNORA_API_KEY", "fixture-managed-secret");
  await expect(resolveWeknoraConnection(managed(), paths.credentials, environment)).rejects.toMatchObject({ kind: "config" });
});
it.each(["fixture-override-secret", ""])("rejects managed reference externally overridden as %j", async value => {
  const paths = await fixture(); await storeCredential(paths.credentials, "ARKSPACE_WEKNORA_API_KEY", "fixture-managed-secret");
  await expect(resolveWeknoraConnection(managed(), paths.credentials, { ARKSPACE_WEKNORA_API_KEY: value })).rejects.toThrow(/overridden/);
});
it("does not fall back from a missing managed credential and redacts malformed stores", async () => {
  const paths = await fixture();
  await expect(resolveWeknoraConnection(managed(), paths.credentials, {})).rejects.toThrow(/missing/);
  await writeFile(paths.credentials, "invalid fixture-sensitive-secret");
  await expect(resolveWeknoraConnection(managed(), paths.credentials, {})).rejects.toThrow(/credential store safely/);
});
it.each([
  "https://kb.example", "https://kb.example/api/v1/", "ftp://kb.example/api/v1", "https://u:pass@kb.example/api/v1",
  "https://kb.example/api/v1?", "https://kb.example/api/v1#", "https://kb.example/api/v1?secret=value",
  "https:kb.example/api/v1", "https:///kb.example/api/v1", "https://@kb.example/api/v1", "https://kb.example:/api/v1", "https://bad_host/api/v1", "https://kb.example./api/v1", "https://kb.example\\\\api/v1", " https://kb.example/api/v1",
])("rejects unsafe or implicit API root %j", baseUrl => {
  expect(ArkSpaceConfigSchema.safeParse({ ...defaultConfig(), connections: { weknora: { baseUrl, apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY" } } }).success).toBe(false);
});
it("warns for plaintext transport regardless of URL scheme case", async () => {
  const paths = await fixture();
  expect((await resolveWeknoraConnection(defaultConfig(), paths.credentials, { WEKNORA_BASE_URL: "HTTP://kb.example/api/v1", WEKNORA_API_KEY: "fixture-secret" }))?.warnings).toHaveLength(1);
});
it("validates reference-only fields and preserves valid legacy narrow ranges on load", () => {
  const connection = { baseUrl: "http://[::1]:8080/api/v1", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", allowRanges: ["::1/128", "127.0.0.1/32", "192.168.1.0/24"] };
  const parse = (change: object) => ArkSpaceConfigSchema.safeParse({ ...defaultConfig(), connections: { weknora: { ...connection, ...change } } }).success;
  expect(parse({})).toBe(true);
  expect(ArkSpaceConfigSchema.parse({ ...defaultConfig(), connections: { weknora: connection } }).connections?.weknora?.allowRanges).toEqual(connection.allowRanges);
  for (const allowRanges of [["0.0.0.0/0"], ["10.0.0.0/8"], ["::/0"], ["::ffff:127.0.0.1/128"], ["127.0.0.1/33"], ["invalid"]]) expect(parse({ allowRanges })).toBe(false);
  expect(parse({ apiKeyRef: "env:WEKNORA_API_KEY" })).toBe(false);
  expect(parse({ apiKey: "fixture-secret" })).toBe(false);
  for (const defaultKnowledgeBaseId of ["", "../another", "kb/id", "x".repeat(129)]) expect(parse({ defaultKnowledgeBaseId })).toBe(false);
});

it("saves offline with nonsecret snapshots, leaving routing and state unchanged", async () => {
  const paths = await fixture();
  expect(await getWeknoraConnectionSnapshot(paths, {})).toBeUndefined();
  await saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1", defaultKnowledgeBaseId: "kb-1" }, "fixture-saved-secret", {}, {});
  const snapshot = await getWeknoraConnectionSnapshot(paths, {});
  expect(snapshot).toMatchObject({ source: "managed", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", available: true, hasLocal: true, status: "configured (not tested)", defaultKnowledgeBaseId: "kb-1" });
  expect(JSON.stringify(snapshot)).not.toContain("fixture-");
  const config = await loadConfig(paths.config);
  expect(config.providerOrder).toEqual(["exa", "tavily", "firecrawl"]);
  expect(await readFile(paths.config, "utf8")).not.toContain("fixture-");
  await expect(readFile(paths.state)).rejects.toMatchObject({ code: "ENOENT" });
  const before = await readFile(paths.config, "utf8");
  expect(await getWeknoraConnectionSnapshot(paths, { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "fixture-external-secret" })).toMatchObject({ source: "environment", available: true, baseUrl: "https://external.example/api/v1" });
  expect(await readFile(paths.config, "utf8")).toBe(before);
  expect(await getWeknoraConnectionSnapshot(paths, { ARKSPACE_WEKNORA_API_KEY: "" })).toMatchObject({ source: "environment-override", available: false, status: "conflict" });
});
it("requires endpoint reuse consent but ignores legacy range authorization and resets ranges on save", async () => {
  const paths = await fixture(); const local = { baseUrl: "http://127.0.0.1:8080/api/v1", allowRanges: ["127.0.0.1/32"] };
  await saveWeknoraConnection(paths, local, "fixture-secret", {}, {});
  expect((await loadConfig(paths.config)).connections?.weknora?.allowRanges).toEqual([]);
  const before = await readFile(paths.config, "utf8");
  await expect(saveWeknoraConnection(paths, { baseUrl: "https://other.example/api/v1" }, undefined, {}, {})).rejects.toThrow(/reuse/);
  expect(await readFile(paths.config, "utf8")).toBe(before);
  await expect(saveWeknoraConnection(paths, { baseUrl: "https://other.example/api/v1" }, "fixture-secret", {}, {})).rejects.toThrow(/reuse/);
  expect(await readFile(paths.config, "utf8")).toBe(before);
  await saveWeknoraConnection(paths, { baseUrl: "https://other.example/api/v1" }, undefined, { reuseSavedKey: true }, {});
  expect((await loadConfig(paths.config)).connections?.weknora?.allowRanges).toEqual([]);
  expect((await resolveWeknoraConnection(await loadConfig(paths.config), paths.credentials, {}))?.apiKey).toBe("fixture-secret");
});
it("rejects unsafe writes and original-environment conflicts before changing either file", async () => {
  const paths = await fixture();
  await saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-secret", {}, {});
  const before = await readFile(paths.config, "utf8"); const secrets = await readFile(paths.credentials, "utf8");
  for (const environment of [{ ARKSPACE_WEKNORA_API_KEY: "" }, { WEKNORA_BASE_URL: "" }, { WEKNORA_API_KEY: "fixture-external" }, { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "fixture-external" }]) {
    await expect(saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-new-secret", {}, environment)).rejects.toThrow(/environment/);
  }
  await expect(saveWeknoraConnection(paths, { baseUrl: "https://user:fixture-secret@kb.example/api/v1" }, "fixture-new-secret", {}, {})).rejects.toThrow(/Invalid WeKnora/);
  await expect(saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "placeholder", {}, {})).rejects.toThrow(/Credential values/);
  expect(await readFile(paths.config, "utf8")).toBe(before); expect(await readFile(paths.credentials, "utf8")).toBe(secrets);
});
it("protects shared references in both directions and preserves credentials on unlink", async () => {
  const paths = await fixture();
  await saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-shared-secret", {}, {});
  await addEnvironmentKey(paths.config, "exa", "ARKSPACE_WEKNORA_API_KEY");
  await expect(replaceSetupKey(paths, "exa", "env:ARKSPACE_WEKNORA_API_KEY", "fixture-new-secret", {})).rejects.toThrow(/shared/);
  await expect(saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-new-secret", {}, {})).rejects.toThrow(/shared/);
  expect((await getSetupSnapshot(paths, {})).providers[0]!.keys.find(key => key.reference === "env:ARKSPACE_WEKNORA_API_KEY")?.sharedConnections).toEqual(["weknora"]);
  expect((await getWeknoraConnectionSnapshot(paths, {}))?.sharedProviders).toEqual(["exa"]);
  await removeSetupKey(paths, "exa", "env:ARKSPACE_WEKNORA_API_KEY");
  expect((await resolveWeknoraConnection(await loadConfig(paths.config), paths.credentials, {}))?.apiKey).toBe("fixture-shared-secret");
  await addEnvironmentKey(paths.config, "exa", "ARKSPACE_WEKNORA_API_KEY");
  await removeWeknoraConnection(paths);
  expect((await loadCredentialEnvironment(paths.credentials, {})).ARKSPACE_WEKNORA_API_KEY).toBe("fixture-shared-secret");
  await removeSetupKey(paths, "exa", "env:ARKSPACE_WEKNORA_API_KEY");
  expect((await loadCredentialEnvironment(paths.credentials, {})).ARKSPACE_WEKNORA_API_KEY).toBeUndefined();
});
it("serializes concurrent saves and provider registration without dropping references", async () => {
  const paths = await fixture();
  const saves = await Promise.all([
    saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-first-secret", {}, {}),
    saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-second-secret", {}, {}),
  ].map(action => action.then(() => "saved", () => "collision")));
  expect(saves.sort()).toEqual(["collision", "saved"]);
  await Promise.all([
    addEnvironmentKey(paths.config, "exa", "ARKSPACE_WEKNORA_API_KEY"),
    saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1", defaultKnowledgeBaseId: "kb-concurrent" }, undefined, {}, {}),
  ]);
  const config = await loadConfig(paths.config);
  expect(config.providers.exa!.keyRefs).toContain("env:ARKSPACE_WEKNORA_API_KEY");
  expect(config.connections?.weknora?.defaultKnowledgeBaseId).toBe("kb-concurrent");
  expect(["fixture-first-secret", "fixture-second-secret"]).toContain((await resolveWeknoraConnection(config, paths.credentials, {}))?.apiKey);
});
it("requires consent before replacing an existing or orphaned local key", async () => {
  const paths = await fixture(); const settings = { baseUrl: "https://managed.example/api/v1" };
  await storeCredential(paths.credentials, "ARKSPACE_WEKNORA_API_KEY", "fixture-orphan-secret");
  await expect(saveWeknoraConnection(paths, settings, "fixture-new-secret", {}, {})).rejects.toThrow(/replacement consent/);
  await expect(readFile(paths.config)).rejects.toMatchObject({ code: "ENOENT" });
  await saveWeknoraConnection(paths, settings, "fixture-new-secret", { replaceSavedKey: true }, {});
  await expect(saveWeknoraConnection(paths, settings, "fixture-other-secret", {}, {})).rejects.toThrow(/replacement consent/);
  expect((await resolveWeknoraConnection(await loadConfig(paths.config), paths.credentials, {}))?.apiKey).toBe("fixture-new-secret");
  await saveWeknoraConnection(paths, settings, "fixture-other-secret", { replaceSavedKey: true }, {});
  expect((await resolveWeknoraConnection(await loadConfig(paths.config), paths.credentials, {}))?.apiKey).toBe("fixture-other-secret");
});
it("reports credential/config partial save failure without claiming rollback or leaking IO details", async () => {
  const paths = await fixture(); const write = jsonStore.writeJsonAtomic;
  vi.spyOn(jsonStore, "writeJsonAtomic").mockImplementation(async (path, value) => {
    if (path === paths.config) throw new Error("fixture-sensitive-IO-detail");
    return write(path, value);
  });
  await expect(saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-partial-secret", {}, {})).rejects.toThrow(/credential remains stored as env:ARKSPACE_WEKNORA_API_KEY, but connection save failed/);
  expect((await loadCredentialEnvironment(paths.credentials, {})).ARKSPACE_WEKNORA_API_KEY).toBe("fixture-partial-secret");
  await expect(readFile(paths.config)).rejects.toMatchObject({ code: "ENOENT" });
});
it("leaves config untouched on credential-write failure and reports unlink/delete partial failure", async () => {
  const paths = await fixture(); const write = jsonStore.writeJsonAtomic;
  await saveWeknoraConnection(paths, { baseUrl: "https://managed.example/api/v1" }, "fixture-first-secret", {}, {});
  const before = await readFile(paths.config, "utf8");
  vi.spyOn(jsonStore, "writeJsonAtomic").mockImplementation(async (path, value) => {
    if (path === paths.credentials) throw new Error("fixture-sensitive-IO-detail");
    return write(path, value);
  });
  await expect(saveWeknoraConnection(paths, { baseUrl: "https://other.example/api/v1" }, "fixture-new-secret", { replaceSavedKey: true }, {})).rejects.toThrow(/Unable to read or update/);
  expect(await readFile(paths.config, "utf8")).toBe(before);
  await expect(removeWeknoraConnection(paths)).rejects.toThrow(/unlinked, but its local credential remains/);
  expect((await loadConfig(paths.config)).connections?.weknora).toBeUndefined();
  expect((await loadCredentialEnvironment(paths.credentials, {})).ARKSPACE_WEKNORA_API_KEY).toBe("fixture-first-secret");
});
