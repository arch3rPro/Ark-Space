import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { addEnvironmentKey, initializeConfig, loadConfig } from "../src/config/store.js";
import { loadCredentialStore, storeCredential } from "../src/config/credentials.js";
import { saveUseGptConfig } from "../src/config/usegpt.js";
import { getSetupSnapshot, saveWeknoraConnection } from "../src/config/manage.js";
import { runOp } from "../src/tui/commands.js";
import { loadPreview } from "../src/tui/data.js";
import { initialState, reduce, type State } from "../src/tui/controller.js";
import { actionDefs } from "../src/tui/view.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(h => rm(h, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-tui-connections-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home });
  await initializeConfig(paths.config);
  return paths;
}
async function usegpt() {
  const paths = await fixture();
  await saveUseGptConfig(paths, { enabled: true, tunnelId: "tunnel_fixture_12345678", dataDir: join(paths.home, "data"), apiKeyRef: "env:CONTROL_PLANE_API_KEY" });
  await storeCredential(paths.credentials, "CONTROL_PLANE_API_KEY", "fixture-local-secret");
  return paths;
}
async function state(context = 5): Promise<State> {
  const paths = await fixture();
  return { ...initialState("en", "", context), loading: false, snapshot: await getSetupSnapshot(paths, {}), row: context === 5 ? 5 : 1,
    usegpt: { configured: true, daemonRunning: false, tunnelRunning: false, issues: [], keySource: "file", savedKey: true } };
}

it("UseGPT key writes refuse external and shared secrets without changing storage", async () => {
  const paths = await usegpt(); const before = await readFile(paths.credentials, "utf8");
  for (const op of [{ kind: "usegptKey", secret: "fixture-new-secret" }, { kind: "usegptKeyRemove" }] as const) {
    expect((await runOp(paths, { CONTROL_PLANE_API_KEY: "fixture-external-secret" }, op)).ok).toBe(false);
    expect(await readFile(paths.credentials, "utf8")).toBe(before);
  }
  await addEnvironmentKey(paths.config, "exa", "CONTROL_PLANE_API_KEY");
  for (const op of [{ kind: "usegptKey", secret: "fixture-new-secret" }, { kind: "usegptKeyRemove" }] as const) {
    expect((await runOp(paths, {}, op)).ok).toBe(false);
    expect(await readFile(paths.credentials, "utf8")).toBe(before);
  }
});

it("a stale UseGPT Add never overwrites a newly saved credential without replacement consent", async () => {
  const paths = await usegpt();
  expect((await runOp(paths, {}, { kind: "usegptKey", secret: "fixture-new-secret" })).ok).toBe(false);
  expect((await loadCredentialStore(paths.credentials)).values.CONTROL_PLANE_API_KEY).toBe("fixture-local-secret");
});

it("provider removal preserves credentials still referenced by UseGPT", async () => {
  const paths = await usegpt();
  await addEnvironmentKey(paths.config, "exa", "CONTROL_PLANE_API_KEY");
  expect((await runOp(paths, {}, { kind: "removeKey", provider: "exa", reference: "env:CONTROL_PLANE_API_KEY" })).ok).toBe(true);
  expect((await loadCredentialStore(paths.credentials)).values.CONTROL_PLANE_API_KEY).toBe("fixture-local-secret");
});

it.each([4, 5])("connection %s key rows expose real edit/details/preview/remove actions without pool/toggle fiction", async context => {
  const s = await state(context);
  if (context === 4) s.weknora = { baseUrl: "https://kb.example/api/v1", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", allowRanges: [], source: "managed", available: true, hasLocal: true, status: "configured (not tested)", sharedProviders: [], warnings: [] };
  const defs = actionDefs(s);
  expect(defs.map(d => d.key)).toEqual(["e", "i", "p", "d"]);
  expect(reduce(s, { type: "keyRemoveStart" }).state.modal?.cursor).toBe(0);
  expect(reduce(s, { type: "keyEdit" }).state.form?.field).toBe("secret");
  const adding = reduce(s, { type: "keyAdd" });
  expect(adding.state.mode).toBe("browse"); // a singleton cannot append another key
  expect(adding.effects).toEqual([]);
});

it("UseGPT environment and invalid overrides cannot open key editing or removal", async () => {
  const s = await state();
  for (const keySource of ["environment", "invalid"] as const) {
    const external = { ...s, usegpt: { ...s.usegpt!, keySource } };
    expect(reduce(external, { type: "keyEdit" }).state.mode).toBe("browse");
    expect(reduce(external, { type: "keyRemoveStart" }).state.modal).toBeNull();
    expect(actionDefs(external).map(d => d.key)).toEqual(["i", "p"]);
  }
});

it("stopping either running service remains possible with incomplete configuration", async () => {
  const s = await state();
  for (const row of [0, 1]) {
    const running = { ...s, row, usegpt: { ...s.usegpt!, configured: false, daemonRunning: true, tunnelRunning: true } };
    const asked = reduce(running, { type: "enter" }).state;
    expect(asked.modal?.cursor).toBe(0);
    const yes = reduce({ ...asked, modal: { ...asked.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "service", action: row === 0 ? "usegptHubStop" : "usegptTunnelStop" }]);
  }
});

it("diagnosis has one Back item and ignores an out-of-range modal selection safely", async () => {
  const opened = reduce(await state(), { type: "usegptDiagnosis", issues: ["Hub stopped"] }).state;
  expect(opened.modal?.items).toEqual([{ value: "cancel", label: "back" }]);
  expect(() => reduce({ ...opened, modal: { ...opened.modal!, cursor: 1 } }, { type: "modalPick" })).not.toThrow();
});

it("connection previews reuse masked multi-source preview data and never write", async () => {
  const paths = await usegpt();
  await saveWeknoraConnection(paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-weknora-secret", {}, {});
  const before = await readFile(paths.credentials, "utf8");
  expect(await loadPreview(paths, "usegpt", "env:CONTROL_PLANE_API_KEY", { CONTROL_PLANE_API_KEY: "fixture-environment-secret" })).toEqual({ kind: "ok", variable: "CONTROL_PLANE_API_KEY", sources: [{ label: "local", value: "fixture-local-secret" }, { label: "env-over", value: "fixture-environment-secret" }] });
  expect(await loadPreview(paths, "weknora", "env:ARKSPACE_WEKNORA_API_KEY", {})).toMatchObject({ kind: "ok", variable: "ARKSPACE_WEKNORA_API_KEY" });
  expect(await loadPreview(paths, "weknora", "env:WEKNORA_API_KEY", { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "fixture-external-secret" })).toMatchObject({ kind: "ok", variable: "WEKNORA_API_KEY" });
  expect(await loadPreview(paths, "usegpt", "env:CONTROL_PLANE_API_KEY", { CONTROL_PLANE_API_KEY: "" })).toEqual({ kind: "invalid-env" });
  expect(await readFile(paths.credentials, "utf8")).toBe(before);
});

it("WeKnora key removal retains settings, guards sharing, and can be added again", async () => {
  const paths = await fixture();
  await saveWeknoraConnection(paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-weknora-secret", {}, {});
  const before = await readFile(paths.config, "utf8");
  expect(await runOp(paths, {}, { kind: "wekKeyRemove" })).toEqual({ ok: true });
  expect(await readFile(paths.config, "utf8")).toBe(before);
  expect((await loadCredentialStore(paths.credentials)).values.ARKSPACE_WEKNORA_API_KEY).toBeUndefined();
  expect(await runOp(paths, {}, { kind: "wekSave", field: "key", value: "fixture-new-secret", reuseSavedKey: false })).toEqual({ ok: true });
  await addEnvironmentKey(paths.config, "exa", "ARKSPACE_WEKNORA_API_KEY");
  expect((await runOp(paths, {}, { kind: "wekKeyRemove" })).ok).toBe(false);
  expect((await loadCredentialStore(paths.credentials)).values.ARKSPACE_WEKNORA_API_KEY).toBe("fixture-new-secret");
});

it("UseGPT restore clears settings but preserves credentials and existing data", async () => {
  const paths = await usegpt();
  const file = join(paths.home, "artifact.txt"); await writeFile(file, "keep artifact");
  const before = await readFile(paths.credentials, "utf8");
  expect(await runOp(paths, {}, { kind: "usegptUnlink" })).toEqual({ ok: true });
  expect((await loadConfig(paths.config)).connections?.usegpt).toBeUndefined();
  expect(await readFile(paths.credentials, "utf8")).toBe(before);
  expect(await readFile(file, "utf8")).toBe("keep artifact");
});
