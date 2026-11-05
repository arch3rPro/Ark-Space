import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

it.each([4, 5])("connection %s key rows expose real edit/remove actions without pool/toggle fiction", async context => {
  const s = await state(context);
  if (context === 4) s.weknora = { baseUrl: "https://kb.example/api/v1", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", allowRanges: [], source: "managed", available: true, hasLocal: true, status: "configured (not tested)", sharedProviders: [], warnings: [] };
  const defs = actionDefs(s);
  expect(defs.map(d => d.key)).toEqual(["e", "d"]);
  expect(reduce(s, { type: "keyRemoveStart" }).state.modal?.cursor).toBe(0);
  expect(reduce(s, { type: "keyEdit" }).state.form?.field).toBe("secret");
  const adding = reduce(s, { type: "keyAdd" });
  expect(adding.state.mode).toBe("browse"); // a singleton cannot append another key
  expect(adding.effects).toEqual([]);
});

it("UseGPT environment and invalid overrides open the key read-only and cannot be removed", async () => {
  const s = await state();
  for (const keySource of ["environment", "invalid"] as const) {
    const external = { ...s, usegpt: { ...s.usegpt!, keySource } };
    const opened = reduce(external, { type: "keyEdit" });
    expect(opened.state.form?.readonly).toBeTruthy();
    expect(opened.effects).toEqual([{ type: "formCurrent", provider: "usegpt", reference: "env:CONTROL_PLANE_API_KEY" }]);
    expect(reduce(opened.state, { type: "formSave" }).effects).toEqual([]);
    expect(reduce(opened.state, { type: "formType", text: "x" }).state.form?.draft).toBe("");
    expect(reduce(external, { type: "keyRemoveStart" }).state.modal).toBeNull();
    expect(actionDefs(external).map(d => d.key)).toEqual(["e"]);
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

it("connection field rows follow the a/e contract: a adds an empty field, e edits a set one, action rows keep Enter", async () => {
  const { initialState, reduce, connectionRow } = await import("../src/tui/controller.js");
  const base = { ...initialState("en", "", 7), snapshot: { providers: [], providerOrder: [] }, loading: false };
  const nitter = (baseUrl: string, hasLocal: boolean) => ({ baseUrl, source: "managed", available: hasLocal, hasLocal, status: "configured (not tested)", sharedProviders: [], warnings: [] }) as never;
  const empty = { ...base, region: "content" as const };
  expect(connectionRow(empty)).toEqual({ kind: "edit", filled: false });
  expect(reduce(empty, { type: "keyAdd" }).state.form?.intent).toBe("nitterUrl");
  const set = { ...empty, nitter: nitter("http://n.example", true) };
  expect(connectionRow(set)).toEqual({ kind: "edit", filled: true });
  expect(reduce(set, { type: "keyAdd" }).state.form).toBeNull();
  expect(reduce(set, { type: "keyEdit" }).state.form?.intent).toBe("nitterUrl");
  const verify = { ...set, row: 2 };
  expect(connectionRow(verify)).toEqual({ kind: "action" });
  expect(reduce(verify, { type: "keyAdd" }).state.form).toBeNull();
});

it("saving an address or a key alone never chains into the other field and writes immediately", async () => {
  const { initialState, reduce } = await import("../src/tui/controller.js");
  const form = (intent: "nitterUrl" | "nitterKey" | "wekUrl" | "wekKey", draft: string, provider: "nitter" | "weknora") =>
    ({ ...initialState("en", "", provider === "nitter" ? 7 : 4), snapshot: { providers: [], providerOrder: [] }, loading: false, mode: "form" as const,
      form: { provider, reference: null, draft, typing: false, intent, field: intent.endsWith("Key") ? "secret" as const : "url" as const } });
  for (const [urlIntent, keyIntent, provider, kind, url] of [
    ["nitterUrl", "nitterKey", "nitter", "nitterSave", "http://n.example"],
    ["wekUrl", "wekKey", "weknora", "wekSave", "https://kb.example/api/v1"],
  ] as const) {
    const saveUrl = reduce(form(urlIntent, url, provider), { type: "formSave" });
    expect(saveUrl.state.form).toBeNull();
    expect(saveUrl.effects).toEqual([{ type: "op", op: { kind, field: "url", value: url, reuseSavedKey: false } }]);
    const saveKey = reduce(form(keyIntent, "secret-value", provider), { type: "formSave" });
    expect(saveKey.state.form).toBeNull();
    expect(saveKey.effects).toEqual([{ type: "op", op: { kind, field: "key", value: "secret-value", reuseSavedKey: false } }]);
  }
});

it("Esc closes an unchanged edit form at once and only asks before discarding real changes", async () => {
  const { initialState, reduce } = await import("../src/tui/controller.js");
  const nitter = { baseUrl: "http://n.example", hasLocal: true, available: true, sharedProviders: [], warnings: [], source: "managed", status: "ok" };
  const open = { ...initialState("en", "", 7), snapshot: { providers: [], providerOrder: [] }, loading: false, region: "content" as const, nitter } as never;
  const edit = reduce(open, { type: "keyEdit" }).state;
  expect(edit.mode).toBe("form");
  // the address form opens empty and already typing; the old address is context, not a prefilled draft
  expect(edit.form).toMatchObject({ draft: "", typing: true, previous: "http://n.example" });
  expect(reduce(edit, { type: "escape" }).state.mode).toBe("browse");
  const typed = reduce(edit, { type: "formType", text: "x" }).state;
  expect(reduce(typed, { type: "escape" }).state.modal?.tag).toBe("form-discard");
  // typing then deleting back to empty is untouched again
  expect(reduce(reduce(typed, { type: "formBackspace" }).state, { type: "escape" }).state.mode).toBe("browse");
});

describe("connection address and text forms", () => {
  const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
  const wek = { baseUrl: "https://kb.example/api/v1", apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", allowRanges: [], source: "managed", available: true, hasLocal: true, status: "ok", sharedProviders: [], warnings: [], defaultKnowledgeBaseId: "kb1" };
  const usegpt = { configured: true, daemonRunning: false, tunnelRunning: false, tunnelId: "tunnel_abcdefgh", dataDir: "/data", savedKey: true, keySource: "file", sharedProviders: [] };
  const base = async (context: number, row: number, extra: object) => {
    const { initialState } = await import("../src/tui/controller.js");
    return { ...initialState("en", "", context), snapshot: { providers: [], providerOrder: [] }, loading: false, region: "content" as const, row, ...extra } as never;
  };

  it("opens typing with an empty draft and shows the old value above the new one, aligned", async () => {
    const { reduce } = await import("../src/tui/controller.js");
    const { pageLines } = await import("../src/tui/view.js");
    const cases: [number, number, object, string, string][] = [
      [4, 0, { weknora: wek }, "https://kb.example/api/v1", "new endpoint"], [4, 2, { weknora: wek }, "kb1", "new value"],
      [5, 3, { usegpt }, "tunnel_abcdefgh", "new value"], [5, 4, { usegpt }, "/data", "new value"],
    ];
    for (const [context, row, extra, old, label] of cases) {
      const form = reduce(await base(context, row, extra), { type: "keyEdit" }).state;
      expect(form.form).toMatchObject({ draft: "", typing: true, previous: old });
      const lines = pageLines(form, 100).map(strip);
      const cur = lines.find(l => l.includes(old))!, next = lines.find(l => l.includes(label))!;
      expect(cur.indexOf(old)).toBe(next.indexOf("|"));
      expect(lines.join("\n")).not.toMatch(/\d+ characters/); // no length line for plain values
    }
  });

  it("an empty save is refused for addresses and tunnel/dir; the default knowledge base keeps its documented 'empty clears'", async () => {
    const { reduce } = await import("../src/tui/controller.js");
    const wekUrl = reduce(await base(4, 0, { weknora: wek }), { type: "keyEdit" }).state;
    expect(reduce(wekUrl, { type: "formSave" }).effects).toEqual([]);
    const kb = reduce(await base(4, 2, { weknora: wek }), { type: "keyEdit" }).state;
    expect(reduce(kb, { type: "formSave" }).effects[0]).toMatchObject({ op: { kind: "wekSave", field: "kb", value: "" } });
  });

  it("uses one name per concept: endpoint and token labels match their rows", async () => {
    const { reduce } = await import("../src/tui/controller.js");
    const { pageLines } = await import("../src/tui/view.js");
    const nitter = { ...wek, defaultKnowledgeBaseId: undefined };
    const token = reduce(await base(7, 1, { nitter }), { type: "keyEdit" }).state;
    expect(pageLines(token, 100).map(strip).join("\n")).toContain("new token");
    const empty = reduce(await base(7, 1, { nitter: { ...nitter, hasLocal: false } }), { type: "keyEdit" }).state;
    expect(pageLines(empty, 100).map(strip).join("\n")).toContain("API token");
    const add = reduce(await base(7, 0, { nitter: null }), { type: "keyEdit" }).state;
    expect(pageLines(add, 100).map(strip).join("\n")).toContain("API endpoint");
  });

  it("an environment-managed connection advertises no dead e/Enter on its non-key rows", async () => {
    const { actionDefs } = await import("../src/tui/view.js");
    const external = { ...wek, source: "environment", hasLocal: false };
    for (const row of [0, 2, 3, 4]) expect(actionDefs(await base(4, row, { weknora: external }))).toEqual([]);
    expect(actionDefs(await base(4, 1, { weknora: external })).map(d => d.key)).toEqual(["e"]); // the key row still opens read-only
    expect(actionDefs(await base(4, 0, { weknora: wek })).map(d => d.key)).toEqual(["e"]);
  });
});
