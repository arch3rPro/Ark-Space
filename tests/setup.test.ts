import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runSetup } from "../src/cli/setup.js";
import { SetupTerminal } from "../src/cli/setup-terminal.js";
import { initialSetupLanguage, setupAffirmative, setupSafeError } from "../src/cli/setup-language.js";
import * as setupManagement from "../src/config/manage.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { loadCredentialEnvironment, storeCredential } from "../src/config/credentials.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { addEnvironmentKey, initializeConfig, loadConfig } from "../src/config/store.js";
import { keyIdFor, loadState } from "../src/key-pool/key-pool.js";

const directories: string[] = [];
const descriptors = [process.stdin, process.stdout].map(s => Object.getOwnPropertyDescriptor(s, "isTTY"));
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  [process.stdin, process.stdout].forEach((s, i) => {
    if (descriptors[i]) Object.defineProperty(s, "isTTY", descriptors[i]!);
    else Reflect.deleteProperty(s, "isTTY");
  });
  await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true })));
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-menu-")); directories.push(home);
  for (const s of [process.stdin, process.stdout]) Object.defineProperty(s, "isTTY", { configurable: true, value: true });
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  return { paths: resolveArkSpacePaths({ ARKSPACE_HOME: home }), output };
}
function prompts(text: string[], secrets: string[] = [], confirmations: boolean[] = []) {
  return {
    askText: vi.fn(async (_label: string) => { if (!text.length) throw new Error("Unexpected text prompt"); return text.shift()!; }),
    askSecret: vi.fn(async (_label: string) => { if (!secrets.length) throw new Error("Setup cancelled."); return secrets.shift()!; }),
    askYesNo: vi.fn(async (_label: string) => { if (!confirmations.length) throw new Error("Unexpected confirmation"); return confirmations.shift()!; }),
  };
}
const options = { environment: {} };
it.each(["cancel", "fatal"])("uses the selected native session language for %s exit messages", async mode => {
  const { paths, output } = await fixture(); const keys = ["down", "down", "return", "down", "return"];
  vi.spyOn(SetupTerminal.prototype, "workbench").mockImplementation(async () => {
    const name = keys.shift(); if (name) return { name };
    throw new Error(mode === "cancel" ? "Setup cancelled." : "Synthetic failure");
  });
  vi.spyOn(SetupTerminal.prototype, "notice").mockResolvedValue();
  await runSetup(paths, undefined, { ...options, language: "en" });
  expect(String(output.mock.calls.at(-1)![0])).toContain(mode === "cancel" ? "设置已取消" : "操作失败");
});
it.each(["exa", "tavily", "firecrawl", "searxng"])("opens the native %s entry with Menu focus and a three-region browse contract", async provider => {
  const { paths, output } = await fixture(); const screens: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  vi.spyOn(SetupTerminal.prototype, "workbench").mockImplementation(async get => { screens.push(get()); throw new Error("Setup cancelled."); });
  await runSetup(paths, undefined, { ...options, provider });
  expect(screens[0]).toMatchObject({ focus: "menu", route: "providers", menuCursor: 0, openedMenu: 0, providerIndex: ["exa", "tavily", "firecrawl", "searxng"].indexOf(provider) });
  expect(screens[0]!.menu).toEqual(["Providers", "Configuration", "Settings", "Exit"]);
  expect(screens[0]).not.toHaveProperty("actions"); expect(screens[0]).not.toHaveProperty("controls");
  expect(output.mock.calls.map(call => String(call[0])).join("")).toContain("\x1b[?25h\x1b[?1049l");
});
it("switches dashboard and direct-provider language, persisting only explicit menu choices", async () => {
  const { paths, output } = await fixture(); const fetch = vi.spyOn(globalThis, "fetch");
  const p = prompts(["7", "2", "6", "1", "1", "0", "0"], ["fake-key", ""]);
  await runSetup(paths, p, options);
  expect((await loadConfig(paths.config)).setupLanguage).toBe("zh");
  expect(p.askSecret.mock.calls[0]![0]).toContain("隐藏");
  let text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("7. Language / 语言"); expect(text).toContain("本地配置检查");
  expect(text).toContain("未联网验证"); expect(text).not.toContain("fake-key");
  output.mockClear();
  await runSetup(paths, prompts(["5", "1", "0"]), { ...options, provider: "exa" });
  expect((await loadConfig(paths.config)).setupLanguage).toBe("en");
  text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("5. Language / 语言"); expect(text).toContain("Add keys (continuous hidden input)");
  expect(fetch).not.toHaveBeenCalled();
});
it("uses flag over saved language over original locale without persisting detection or flag", async () => {
  const { paths, output } = await fixture();
  await runSetup(paths, prompts(["0"]), { environment: { LANG: "zh_CN.UTF-8" } });
  expect(output.mock.calls.map(c => String(c[0])).join("")).toContain("设置面板");
  expect((await loadConfig(paths.config)).setupLanguage).toBeUndefined();
  await runSetup(paths, prompts(["7", "1", "0"]), options);
  output.mockClear();
  await runSetup(paths, prompts(["0"]), { environment: { LANG: "zh_CN" } });
  expect(output.mock.calls.map(c => String(c[0])).join("")).toContain("Setup dashboard");
  output.mockClear();
  await runSetup(paths, prompts(["0"]), { ...options, language: "zh" });
  expect(output.mock.calls.map(c => String(c[0])).join("")).toContain("设置面板");
  expect((await loadConfig(paths.config)).setupLanguage).toBe("en");
});
it("validates language before initialization and renders a simple provider list", async () => {
  const { paths, output } = await fixture();
  await expect(runSetup(paths, prompts([]), { ...options, language: "fr" })).rejects.toThrow(/--lang/);
  await expect(readFile(paths.config)).rejects.toMatchObject({ code: "ENOENT" });
  await runSetup(paths, prompts(["0"]), options);
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("1. Exa — 0 configured");
  expect(text).toContain("4. SearXNG — 0 configured");
  expect(text).not.toContain("Eligible for new requests");
  expect(text).not.toContain("Health:");
  expect(text).not.toContain("Credentials:");
});
it("counts credential references, effective sources, eligibility and health separately without modifying state", async () => {
  const { paths, output } = await fixture(); await initializeConfig(paths.config);
  await storeCredential(paths.credentials, "EXA_API_KEY", "fake-local");
  await addEnvironmentKey(paths.config, "exa", "EXA_API_KEY_1");
  await addEnvironmentKey(paths.config, "exa", "EXA_API_KEY_2");
  await addEnvironmentKey(paths.config, "exa", "EXA_API_KEY_3");
  const state = await loadState(paths.state);
  state.providers.exa = { cursor: 0, keys: {
    [keyIdFor("exa", "env:EXA_API_KEY")]: { status: "cooldown", cooldownUntil: Date.now() + 60_000, consecutiveFailures: 1 },
    [keyIdFor("exa", "env:EXA_API_KEY_1")]: { status: "disabled", consecutiveFailures: 1 },
    [keyIdFor("exa", "env:EXA_API_KEY_2")]: { status: "exhausted", cooldownUntil: Date.now() + 60_000, consecutiveFailures: 1 },
  } };
  const bytes = JSON.stringify(state); await writeFile(paths.state, bytes);
  const fetch = vi.spyOn(globalThis, "fetch");
  await runSetup(paths, prompts(["0"]), { environment: { EXA_API_KEY_1: "fake-env", EXA_API_KEY_2: "fake-other-env" } });
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("1. Exa — 3 configured (unverified)");
  expect(text).not.toContain("Credentials:");
  expect(text).not.toContain("Eligible for new requests");
  expect(text).not.toContain("Health:");
  expect(text).not.toContain("fake-"); expect(await readFile(paths.state, "utf8")).toBe(bytes);
  expect(fetch).not.toHaveBeenCalled();
});
it("excludes readable keys when provider is disabled and renders external keyless health without key statistics", async () => {
  const { paths, output } = await fixture(); await initializeConfig(paths.config);
  await storeCredential(paths.credentials, "EXA_API_KEY", "fake-local");
  const config = await loadConfig(paths.config); config.providers.exa!.enabled = false;
  await writeFile(paths.config, JSON.stringify(config));
  const state = await loadState(paths.state); state.searxng = { cursor: 0, instances: {} };
  await writeFile(paths.state, JSON.stringify(state));
  const before = await readFile(paths.state, "utf8");
  await runSetup(paths, prompts(["0"]), { environment: { SEARXNG_URL: "https://external.example.org" } });
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("1. Exa — 1 configured (unverified); disabled");
  expect(text).toContain("4. SearXNG — 1 configured (unverified)");
  expect(text).not.toContain("Credentials"); expect(text).not.toContain("references");
  expect(await readFile(paths.state, "utf8")).toBe(before);
});
it("rejects unsafe Chinese secret input and reports partial persistence honestly at the UI boundary", async () => {
  const { paths, output } = await fixture();
  const original = setupManagement.addSetupKey;
  vi.spyOn(setupManagement, "addSetupKey").mockImplementation(async (paths, provider, secret, environment) => {
    if (secret === "fake-partial") {
      await storeCredential(paths.credentials, "EXA_API_KEY_1", secret);
      throw new ProviderError("Setup: Local credential remains stored as env:EXA_API_KEY_1, but registration failed; recover with arks key add exa --env EXA_API_KEY_1.", { kind: "invalid-request" });
    }
    return original(paths, provider, secret, environment);
  });
  await runSetup(paths, prompts(["1", "0"], ["bad\nprivate-secret", "fake-partial", ""]), { ...options, provider: "exa", language: "zh" });
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("凭据不能为空"); expect(text).toContain("本地凭据已保留");
  expect(text).toContain("arks key add exa --env EXA_API_KEY_1");
  expect(text).not.toContain("未保存"); expect(text).not.toContain("fake-partial"); expect(text).not.toContain("private-secret");
  expect((await loadCredentialEnvironment(paths.credentials, {})).EXA_API_KEY_1).toBe("fake-partial");
});
it("carries saves and partial-write recovery into the next hidden form with the plaintext warning", async () => {
  const { paths, output } = await fixture();
  const original = setupManagement.addSetupKey;
  vi.spyOn(setupManagement, "addSetupKey").mockImplementation(async (paths, id, secret, environment) => {
    if (secret === "fake-partial") throw new ProviderError("Setup: Local credential remains stored as env:EXA_API_KEY_1, but registration failed; recover with arks key add exa --env EXA_API_KEY_1.", { kind: "invalid-request" });
    return original(paths, id, secret, environment);
  });
  const p = prompts(["1", "0"], ["fake-first", "fake-partial", ""]);
  const screens: string[] = [];
  p.askSecret.mockImplementation(async () => {
    screens.push(String(output.mock.calls.at(-1)![0]));
    return ["fake-first", "fake-partial", ""][screens.length - 1]!;
  });
  await runSetup(paths, p, { ...options, provider: "exa" });
  expect(screens.every(s => s.includes("Keys are plaintext in"))).toBe(true);
  expect(screens[1]).toContain("Saved immediately");
  expect(screens[2]).toContain("arks key add exa --env EXA_API_KEY_1");
  expect(screens.join("")).not.toContain("fake-");
});
it("cancels advanced permissions without adding an instance", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["4", "https://private.example.org", "0", "0"]), { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).providers.searxng).toBeUndefined();
  expect(process.exitCode ?? 0).toBe(0);
});
it("does not switch languages when preference persistence fails", async () => {
  const { paths, output } = await fixture();
  vi.spyOn(setupManagement, "setSetupLanguage").mockRejectedValue(new ProviderError("Setup: Unable to read or update local setup files safely; inspect their permissions and format.", { kind: "config" }));
  await runSetup(paths, prompts(["7", "2", "0"]), options);
  expect((await loadConfig(paths.config)).setupLanguage).toBeUndefined();
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).not.toContain("设置面板"); expect(text).not.toContain("Saved immediately");
  expect(text).toContain("Unable to read or update");
});
it("offers shallow SearXNG actions and translates subsequent instance prompts after language selection", async () => {
  const { paths, output } = await fixture();
  const p = prompts(["5", "2", "4", "invalid", "https://local.example.org", "bad", "10.1.2.3/32", "", "0"]);
  await runSetup(paths, p, { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).setupLanguage).toBe("zh");
  expect((await loadConfig(paths.config)).providers.searxng!.instances[0]!.allowRanges).toEqual(["10.1.2.3/32"]);
  expect(p.askText.mock.calls.slice(3).every(([label]) => /[\u4e00-\u9fff]/.test(label))).toBe(true);
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("5. Language / 语言"); expect(text).toContain("4. 高级添加实例");
  expect(text).toContain("CIDR 无效"); expect(text).toContain("已立即保存");
});
it("translates replacement, removal, live consent and cancellation without exposing secrets", async () => {
  const { paths, output } = await fixture(); await initializeConfig(paths.config);
  await storeCredential(paths.credentials, "TAVILY_API_KEY", "fake-old");
  const p = prompts(["2", "1", "3", "0", "4", "1"], ["fake-replaced"], [true, false, false]);
  await runSetup(paths, p, { ...options, provider: "tavily", language: "zh" });
  expect(p.askYesNo.mock.calls.every(([label]) => /[\u4e00-\u9fff]/.test(label))).toBe(true);
  expect(p.askSecret.mock.calls[0]![0]).toContain("替换 API 密钥");
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("以明文存储"); expect(text).toContain("设置已取消");
  expect(text).not.toContain("fake-");
});
it("localizes only exact safe errors, preserving honest partial-write recovery", () => {
  const partial = setupSafeError("zh", "Setup: Local credential remains stored as env:EXA_API_KEY_1, but registration failed; recover with arks key add exa --env EXA_API_KEY_1.");
  expect(partial).toContain("已保留"); expect(partial).toContain("arks key add exa --env EXA_API_KEY_1");
  expect(setupSafeError("zh", "Setup: Local credential was replaced, but key health reset failed; inspect state before retrying.")).toContain("已替换");
  expect(setupSafeError("zh", "Setup: Reference was unlinked, but its local credential remains stored; remove the orphaned credential after inspecting the store.")).toContain("仍保留");
  expect(setupSafeError("zh", "Setup: Tracked owned resources require this credential and enabled provider for cleanup; clean them up first.")).toContain("请先清理");
  expect(setupSafeError("zh", "Setup: The selected reference is shared; unlink it or add a new local key instead.")).toContain("已共享");
  expect(setupSafeError("zh", "Setup: The selected reference is environment-managed; change it externally or add a new local key.")).toContain("由环境管理");
  expect(setupSafeError("zh", "SearXNG instance is already configured; permissions were not changed.")).toContain("权限未更改");
  expect(setupSafeError("zh", "Setup: fake-private-secret")).toBeUndefined();
});
it("uses original locale precedence and never treats blank Chinese consent as affirmative", () => {
  expect(initialSetupLanguage(undefined, undefined, {})).toBe("en");
  expect(initialSetupLanguage(undefined, undefined, { LC_ALL: "en_US", LC_MESSAGES: "zh_CN", LANG: "zh_CN" })).toBe("en");
  expect(initialSetupLanguage(undefined, undefined, { LC_MESSAGES: "zh_CN", LANG: "en_US" })).toBe("zh");
  expect(initialSetupLanguage("en", "zh", { LANG: "zh_CN" })).toBe("en");
  for (const answer of ["", "否", "no", "n", "不确认"]) expect(setupAffirmative(answer)).toBe(false);
  for (const answer of ["y", "YES", " 是 ", "确认"]) expect(setupAffirmative(answer)).toBe(true);
});
it("selects a provider directly, reprompts invalid choices, and appends continuous hidden keys", async () => {
  const { paths, output } = await fixture();
  const p = prompts(["bad", "1", "1", "0", "0"], ["fake-first", "fake-second", ""]);
  await runSetup(paths, p, options);
  await runSetup(paths, prompts(["1", "0"], ["fake-third", ""]), { ...options, provider: "exa" });
  expect(await loadCredentialEnvironment(paths.credentials, {})).toEqual({ EXA_API_KEY: "fake-first", EXA_API_KEY_1: "fake-second", EXA_API_KEY_2: "fake-third" });
  expect((await loadConfig(paths.config)).providers.exa!.keyRefs).toEqual(["env:EXA_API_KEY", "env:EXA_API_KEY_1", "env:EXA_API_KEY_2"]);
  expect(p.askYesNo).not.toHaveBeenCalled();
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("unverified"); expect(text).not.toContain("fake-");
  expect(await readFile(paths.config, "utf8")).not.toContain("fake-");
});
it("rejects unsupported positional provider before any mutation", async () => {
  const { paths } = await fixture();
  await expect(runSetup(paths, prompts([]), { ...options, provider: "local" })).rejects.toThrow(/unsupported/i);
  await expect(readFile(paths.config)).rejects.toMatchObject({ code: "ENOENT" });
});
it("noninteractive setup never prompts and preserves existing config bytes", async () => {
  const { paths } = await fixture(); await initializeConfig(paths.config);
  const config = await loadConfig(paths.config); config.providerOrder = ["tavily"];
  await writeFile(paths.config, JSON.stringify(config)); const before = await readFile(paths.config, "utf8");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  const p = prompts([]); await runSetup(paths, p, options);
  expect(p.askText).not.toHaveBeenCalled(); expect(p.askSecret).not.toHaveBeenCalled();
  expect(await readFile(paths.config, "utf8")).toBe(before);
});
it("retains saved keys on cancellation and discards pending input", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1"], ["fake-completed"]), { ...options, provider: "exa" });
  expect(await loadCredentialEnvironment(paths.credentials, {})).toEqual({ EXA_API_KEY: "fake-completed" });
});
it("keeps creation-only allocation safe during interleaved hidden input", async () => {
  const { paths } = await fixture(); const first = prompts(["1", "0"], [""]);
  first.askSecret.mockImplementationOnce(async () => {
    await runSetup(paths, prompts(["1", "0"], ["fake-other", ""]), { ...options, provider: "exa" });
    return "fake-first";
  });
  await runSetup(paths, first, { ...options, provider: "exa" });
  expect(await loadCredentialEnvironment(paths.credentials, {})).toEqual({ EXA_API_KEY: "fake-other", EXA_API_KEY_1: "fake-first" });
});
it("avoids stored, configured, foreign and original environment references", async () => {
  const { paths } = await fixture(); await initializeConfig(paths.config);
  await addEnvironmentKey(paths.config, "tavily", "EXA_API_KEY");
  await addEnvironmentKey(paths.config, "exa", "EXA_API_KEY_1");
  await storeCredential(paths.credentials, "EXA_API_KEY_2", "fake-unregistered");
  await runSetup(paths, prompts(["1", "0"], ["fake-new", ""]), { provider: "exa", environment: { EXA_API_KEY_3: "fake-env" } });
  expect(await loadCredentialEnvironment(paths.credentials, {})).toEqual({ EXA_API_KEY_2: "fake-unregistered", EXA_API_KEY_4: "fake-new" });
});
it("replaces a selected local key only after confirmation, not environment overrides", async () => {
  const { paths, output } = await fixture(); await initializeConfig(paths.config);
  await storeCredential(paths.credentials, "EXA_API_KEY", "fake-old");
  await runSetup(paths, prompts(["2", "1", "0", "0"], ["fake-new"], [true]), { ...options, provider: "exa" });
  expect((await loadCredentialEnvironment(paths.credentials, {})).EXA_API_KEY).toBe("fake-new");
  const p = prompts(["2", "1", "0", "0"]);
  await runSetup(paths, p, { provider: "exa", environment: { EXA_API_KEY: "fake-env" } });
  expect(p.askSecret).not.toHaveBeenCalled();
  expect(output.mock.calls.map(c => String(c[0])).join("")).toContain("environment-managed");
});
it("adds public instances without permission questions, retries invalid/duplicate URLs on page", async () => {
  const { paths } = await fixture();
  const p = prompts(["1", "not-url", "https://search.example.org", "https://search.example.org", "https://second.example.org", "", "0"]);
  await runSetup(paths, p, { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).providers.searxng!.instances).toEqual([
    { baseUrl: "https://search.example.org", allowRanges: [] }, { baseUrl: "https://second.example.org", allowRanges: [] },
  ]); expect(p.askYesNo).not.toHaveBeenCalled();
});
it("offers narrow permission only for private IP literals and preserves each instance", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1", "http://127.0.0.1:8080", "", "0"], [], [true]), { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).providers.searxng!.instances[0]).toEqual({ baseUrl: "http://127.0.0.1:8080", allowRanges: ["127.0.0.1/32"] });
});
it("requires privacy confirmation when including SearXNG and refuses an empty order", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1", "https://search.example.org", "", "0"]), { ...options, provider: "searxng" });
  const before = (await loadConfig(paths.config)).providerOrder;
  await runSetup(paths, prompts(["5", "4", "1", "0", "0"], [], [false]), options);
  expect((await loadConfig(paths.config)).providerOrder).toEqual(before);
});
it("local checks and declined live tests never issue a network request", async () => {
  const { paths } = await fixture(); const fetch = vi.spyOn(globalThis, "fetch");
  await runSetup(paths, prompts(["6", "1", "4", "0", "0"], [], [false]), options);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects controls and placeholders without persisting pending input, then retries", async () => {
  const { paths, output } = await fixture();
  await runSetup(paths, prompts(["1", "0"], ["placeholder", "bad\nsecret", "\u001b[31mhostile", "fake-valid", ""]), { ...options, provider: "exa" });
  expect(await loadCredentialEnvironment(paths.credentials, {})).toEqual({ EXA_API_KEY: "fake-valid" });
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).not.toContain("hostile"); expect(text).not.toContain("bad\nsecret");
});
it("disables/re-enables and removes selected keys independently of provider order", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1", "0"], ["fake-local", ""]), { ...options, provider: "exa" });
  const order = (await loadConfig(paths.config)).providerOrder;
  await runSetup(paths, prompts(["2", "2", "2", "3", "2", "2", "0"], [], [true]), { ...options, provider: "exa" });
  expect(await loadCredentialEnvironment(paths.credentials, {})).toEqual({});
  expect((await loadConfig(paths.config)).providers.exa).toMatchObject({ enabled: true, keyRefs: [] });
  expect((await loadConfig(paths.config)).providerOrder).toEqual(order);
});
it("keeps environment-only SearXNG endpoints external and read-only", async () => {
  const { paths, output } = await fixture();
  await runSetup(paths, prompts(["2", "0", "3", "0"]), { provider: "searxng", environment: { SEARXNG_URL: "https://external.example.org" } });
  expect((await loadConfig(paths.config)).providers.searxng).toBeUndefined();
  expect(output.mock.calls.map(c => String(c[0])).join("")).toContain("Environment-managed endpoint: read-only");
});
it("edits manual permissions only through the advanced explicit CIDR route", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1", "https://search.example.org", "", "2", "2", "", "10.2.3.4/32", "0", "0"]), { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).providers.searxng!.instances).toEqual([{ baseUrl: "https://search.example.org", allowRanges: ["10.2.3.4/32"] }]);
});
it("retries an invalid edited URL in place without reselecting the instance", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1", "https://old.example.org", "", "0"]), { ...options, provider: "searxng" });
  const p = prompts(["2", "1", "ftp://invalid.example.org", "https://new.example.org", "0", "0"]);
  await runSetup(paths, p, { ...options, provider: "searxng" });
  expect(p.askText.mock.calls[2]).toEqual(p.askText.mock.calls[3]);
  expect((await loadConfig(paths.config)).providers.searxng!.instances[0]!.baseUrl).toBe("https://new.example.org");
  expect(process.exitCode ?? 0).toBe(0);
});
it("tests only the chosen provider, uses the freshly replaced local key, and does not render remote bodies", async () => {
  const { paths, output } = await fixture();
  await initializeConfig(paths.config);
  await storeCredential(paths.credentials, "TAVILY_API_KEY", "fake-old-local");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ results: [], remote_secret: "hostile-remote-body" }), { status: 200 }));
  await runSetup(paths, prompts(["2", "1", "0", "4", "0"], ["fake-fresh-local"], [true, true]), { ...options, provider: "tavily" });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(String(url)).toBe("https://api.tavily.com/search");
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fake-fresh-local");
  expect(JSON.parse(String(init?.body))).toMatchObject({ query: "Agent Skills documentation", max_results: 1 });
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("1 actual attempt(s)"); expect(text).not.toContain("hostile-remote-body"); expect(text).not.toContain("fake-fresh-local");
});
it("unexpected filesystem/parser errors never show their message or raw credential contents", async () => {
  const { paths, output } = await fixture(); await initializeConfig(paths.config);
  await writeFile(paths.credentials, '{"values":{"KEY":"fake-leaked-secret"},broken');
  await runSetup(paths, prompts(["0"]), options);
  expect(output.mock.calls.map(c => String(c[0])).join("")).not.toContain("fake-leaked-secret");
  expect(process.exitCode).toBe(1);
});
it("keeps a nonempty order and confirms hosted fallback after SearXNG separately from enable status", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1", "https://search.example.org", "", "0"]), { ...options, provider: "searxng" });
  await storeCredential(paths.credentials, "EXA_API_KEY", "fake-configured");
  const config = await loadConfig(paths.config); config.providerOrder = ["searxng"];
  await writeFile(paths.config, JSON.stringify(config));
  await runSetup(paths, prompts(["5", "3", "1", "4", "1", "0", "0"], [], [false]), options);
  expect((await loadConfig(paths.config)).providerOrder).toEqual(["searxng"]);
  await runSetup(paths, prompts(["5", "4", "1", "0", "0"], [], [true]), options);
  expect((await loadConfig(paths.config)).providerOrder).toEqual(["searxng", "exa"]);
});
it("holds no config lock during URL prompts and retains both interleaved instance additions", async () => {
  const { paths } = await fixture(); const p = prompts(["", "0"]);
  p.askText.mockImplementationOnce(async () => "1").mockImplementationOnce(async () => {
    await runSetup(paths, prompts(["1", "https://second.example.org", "", "0"]), { ...options, provider: "searxng" });
    return "https://first.example.org";
  });
  await runSetup(paths, p, { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).providers.searxng!.instances.map(i => i.baseUrl)).toEqual(["https://second.example.org", "https://first.example.org"]);
});
it("discards a pending secret when a caller aborts and retains completed saves", async () => {
  const { paths } = await fixture(); const controller = new AbortController();
  const p = prompts(["1"], ["fake-first"]);
  p.askSecret.mockImplementationOnce(async () => "fake-first").mockImplementationOnce(async () => {
    controller.abort(); return "fake-pending";
  });
  await runSetup(paths, p, { ...options, provider: "exa", signal: controller.signal });
  expect(await loadCredentialEnvironment(paths.credentials, {})).toEqual({ EXA_API_KEY: "fake-first" });
});
it("sanitizes config corruption introduced during hidden input without storing the pending key", async () => {
  const { paths, output } = await fixture();
  // A malformed config introduced during input is sanitized rather than echoed.
  const p = prompts(["1", "0"], [""]);
  p.askSecret.mockImplementationOnce(async () => { await writeFile(paths.config, '{"secret":"fake-private-broken"}'); return "fake-not-saved"; });
  await runSetup(paths, p, { ...options, provider: "exa" });
  await expect(readFile(paths.credentials)).rejects.toMatchObject({ code: "ENOENT" });
  expect(output.mock.calls.map(c => String(c[0])).join("")).not.toContain("fake-private-broken");
});
it("preserves instance permissions on blank or equivalent basic URL and does not inherit them for a new endpoint", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["4", "https://private.example.org", "10.2.3.4/32", "", "0"]), { ...options, provider: "searxng" });
  await runSetup(paths, prompts(["2", "1", "", "1", "https://private.example.org/", "0", "0"]), { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).providers.searxng!.instances[0]!.allowRanges).toEqual(["10.2.3.4/32"]);
  await runSetup(paths, prompts(["2", "1", "https://different.example.org", "0", "0"]), { ...options, provider: "searxng" });
  expect((await loadConfig(paths.config)).providers.searxng!.instances[0]).toEqual({ baseUrl: "https://different.example.org", allowRanges: [] });
});
it("retries invalid advanced CIDRs at the same permissions prompt during add", async () => {
  const { paths } = await fixture();
  const p = prompts(["4", "https://private.example.org", "10.0.0.1/33", "10.0.0.1/32", "", "0"]);
  await runSetup(paths, p, { ...options, provider: "searxng" });
  expect(p.askText.mock.calls[2]).toEqual(p.askText.mock.calls[3]);
  expect((await loadConfig(paths.config)).providers.searxng!.instances[0]!.allowRanges).toEqual(["10.0.0.1/32"]);
  expect(p.askYesNo).not.toHaveBeenCalled();
});
it("shows friendly key numbering, reports unavailable override, and explicitly restores cooldown", async () => {
  const { paths, output } = await fixture(); await initializeConfig(paths.config);
  await storeCredential(paths.credentials, "EXA_API_KEY", "fake-local");
  const state = await loadState(paths.state);
  state.providers.exa = { cursor: 0, keys: { [keyIdFor("exa", "env:EXA_API_KEY")]: { status: "cooldown", cooldownUntil: Date.now() + 60_000, consecutiveFailures: 1 } } };
  await writeFile(paths.state, JSON.stringify(state));
  await runSetup(paths, prompts(["1", "2", "2", "0", "0", "0"]), { environment: { EXA_API_KEY: "" } });
  const text = output.mock.calls.map(c => String(c[0])).join("");
  expect(text).toContain("Key #1 — environment, unavailable, cooldown");
  expect(text).toContain("1. Exa — 0 configured (unverified)");
  expect(text).toContain("Restore cooled key now (clear cooldown)");
  expect((await loadState(paths.state)).providers.exa!.keys[keyIdFor("exa", "env:EXA_API_KEY")]!.status).toBe("enabled");
});
it("explains last-instance removal consequences before confirmation", async () => {
  const { paths } = await fixture();
  const p = prompts(["1", "https://local.example.org", "", "2", "3", "0", "0"], [], [false]);
  await runSetup(paths, p, { ...options, provider: "searxng" });
  expect(p.askYesNo.mock.calls[0]![0]).toMatch(/last local instance.*automatic order.*environment endpoint/);
  expect((await loadConfig(paths.config)).providers.searxng!.instances).toHaveLength(1);
});
it("confirms routing when moving hosted before SearXNG or removing SearXNG, but not purely hosted reorders", async () => {
  const { paths } = await fixture();
  await runSetup(paths, prompts(["1", "https://search.example.org", "", "0"]), { ...options, provider: "searxng" });
  const config = await loadConfig(paths.config); config.providerOrder = ["searxng", "exa"];
  await writeFile(paths.config, JSON.stringify(config));
  const p = prompts(["5", "1", "2", "3", "1", "0", "0"], [], [false, false]);
  await runSetup(paths, p, options);
  expect(p.askYesNo).toHaveBeenCalledTimes(2);
  expect(p.askYesNo.mock.calls[0]![0]).toContain("before or after SearXNG");
  expect((await loadConfig(paths.config)).providerOrder).toEqual(["searxng", "exa"]);
  config.providerOrder = ["exa", "tavily"]; await writeFile(paths.config, JSON.stringify(config));
  const hosted = prompts(["5", "2", "1", "0", "0"]);
  await runSetup(paths, hosted, options);
  expect(hosted.askYesNo).not.toHaveBeenCalled();
  expect((await loadConfig(paths.config)).providerOrder).toEqual(["tavily", "exa"]);
});
