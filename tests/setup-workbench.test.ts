import { PassThrough } from "node:stream";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runSetupWorkbench } from "../src/cli/setup-workbench.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { initializeConfig, loadConfig, addSearxngInstance } from "../src/config/store.js";
import { addSetupKey, type SetupSnapshot } from "../src/config/manage.js";
import * as management from "../src/config/manage.js";
import * as keyTests from "../src/cli/setup-key-tests.js";
import { loadCredentialEnvironment } from "../src/config/credentials.js";
import { SetupTerminal, clipCells, cellWidth, type WorkbenchView } from "../src/cli/setup-terminal.js";
function fixture(rows = 24, columns = 80) {
  const input = new PassThrough() as unknown as typeof process.stdin;
  const output = new PassThrough() as unknown as typeof process.stdout;
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn((raw: boolean) => { Object.assign(input, { isRaw: raw }); return input; }) });
  Object.assign(output, { isTTY: true, rows, columns });
  const write = vi.spyOn(output, "write").mockReturnValue(true);
  const terminal = new SetupTerminal(input, output);
  const key = (name: string, extra = {}) => input.emit("keypress", "", { name, ...extra });
  terminal.open();
  return { input, output, terminal, write, key };
}
const view: WorkbenchView = { providers: ["Exa", "Tavily", "Firecrawl", "SearXNG"], providerIndex: 0,
  menu: ["Providers", "Configuration", "Settings", "Exit"], menuCursor: 0, openedMenu: 0, route: "providers", language: "en", focus: "content",
  title: "Exa", summary: "Provider On", columns: ["Reference", "Source", "Status"], cells: [["EXA_API_KEY", "local", "enabled"]], selected: 0,
  hints: [{ key: "a", label: "Add" }], status: "Ready", footer: "Tab panes · Esc back" };
it.each([
  [24, 80, "en", true], [24, 80, "en", false], [24, 80, "zh", true], [24, 80, "zh", false],
  [16, 60, "en", true], [16, 60, "en", false], [16, 60, "zh", true], [16, 60, "zh", false],
] as const)("keeps provider label columns fixed across active contexts at %sx%s (%s, color=%s)", (rows, columns, language, color) => {
  vi.stubEnv("NO_COLOR", color ? "" : "1"); vi.stubEnv("TERM", "xterm");
  const f = fixture(rows, columns);
  try {
    const positions: number[][] = [];
    for (const focus of ["top", "menu", "content"] as const) for (let providerIndex = 0; providerIndex < 4; providerIndex++) {
      f.terminal.render({ ...view, focus, providerIndex, language,
        summary: language === "zh" ? providerIndex === 3 ? "供应商 关 · 仅显式" : `供应商 开 · 自动 #${providerIndex + 1}`
          : providerIndex === 3 ? "Provider Off · explicit only" : `Provider On · auto #${providerIndex + 1}` });
      const raw = String(f.write.mock.calls.at(-1)![0]);
      const lines = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").split("\n");
      positions.push(view.providers.map(name => lines[0]!.indexOf(name)));
      expect(lines[0]!.trimStart()).toMatch(/^ArkSpace /);
      // Original centering formula, with three spaces between provider labels.
      const expected = columns === 80 && language === "en"
        ? color ? [22, 30, 41, 55] : [22, 31, 43, 58]
        : color ? [12, 20, 31, 45] : [12, 21, 33, 48];
      expect(positions.at(-1)).toEqual(expected);
      expect(lines[0]).not.toMatch(/[><]/);
      for (const name of view.providers) expect(lines[0]).toContain(`[${name}]`);
      if (columns === 60 || language === "en") { expect(lines[0]).not.toContain("Provider"); expect(lines[0]).not.toContain("供应商"); }
      else expect(lines[0]).toContain("供应商");
      if (color) expect(lines[0]).not.toContain("*");
      else { expect(lines[0]).toContain(`*[${view.providers[providerIndex]}]`); expect(lines[0]!.match(/\*/g)).toHaveLength(1); }
      expect((columns === 60 ? lines.slice(1) : lines).join("\n")).toContain(language === "zh" ? providerIndex === 3 ? "供应商 关 · 仅显式" : `供应商 开 · 自动 #${providerIndex + 1}`
        : providerIndex === 3 ? "Provider Off · explicit only" : `Provider On · auto #${providerIndex + 1}`);
      expect(lines).toHaveLength(rows); expect(lines.every(line => cellWidth(line) === columns - 1)).toBe(true);
      if (!color) expect(raw).not.toMatch(/\x1b\[[\d;]*m/);
    }
    expect(positions, "label starts for all four active indices and all three focus regions").toEqual(Array.from({ length: 12 }, () => positions[0]));
  } finally { f.terminal.close(); vi.unstubAllEnvs(); }
});
it("uses independent Top provider accents without changing semantic tones", () => {
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const f = fixture();
  try {
    for (const focus of ["top", "menu", "content"] as const) for (let providerIndex = 0; providerIndex < 4; providerIndex++) {
      f.terminal.render({ ...view, focus, providerIndex,
        cells: [["key-1", "local", "disabled"], ["key-2", "local", "cooldown"], ["key-3", "local", "enabled"]],
        rowTones: ["danger", "warning", "success"], status: "Failed", statusTone: "danger" });
      const raw = String(f.write.mock.calls.at(-1)![0]); const header = raw.split("\n")[0]!;
      for (const [index, name, foreground, background, text] of [
        [0, "Exa", 34, 44, 37], [1, "Tavily", 35, 45, 30], [2, "Firecrawl", 33, 43, 30], [3, "SearXNG", 32, 42, 30],
      ] as const) expect(header).toContain(index === providerIndex
        ? `\x1b[${text};${background};1${focus === "top" ? ";4" : ""}m[${name}]\x1b[0m` : `\x1b[${foreground}m[${name}]\x1b[0m`);
      for (const [code, text] of [[31, "disabled"], [33, "cooldown"], [32, "enabled"], [31, "Failed"]] as const)
        expect(raw).toContain(`\x1b[${code}m${text}`);
    }
  } finally { f.terminal.close(); vi.unstubAllEnvs(); }
});
it("renders a bounded fixed workbench and blocks activation at undersize", async () => {
  const f = fixture();
  const pending = f.terminal.workbench(() => view);
  expect(String(f.write.mock.calls.at(-1)![0])).toContain("Configuration");
  Object.assign(f.output, { rows: 8, columns: 24 }); f.output.emit("resize");
  f.key("return");
  expect(String(f.write.mock.calls.at(-1)![0])).toContain("too small");
  f.key("escape"); expect((await pending).name).toBe("escape"); f.terminal.close();
  expect(f.input.isRaw).toBe(false); expect(f.output.listenerCount("resize")).toBe(0);
});
it("decodes standalone Escape promptly before the next navigation key", async () => {
  const f = fixture(); let received = "";
  const pending = f.terminal.workbench(() => view).then(key => { received = key.name ?? ""; });
  try {
    f.input.write("\x1b");
    // Node's readline decoder uses its own real timers, not Vitest's global fake timers.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(received).toBe("escape");
  } finally {
    if (!received) f.input.emit("end");
    await pending.catch(() => {}); f.terminal.close();
  }
});
it("modal defaults to Cancel, ignores y/n, uses focused action buttons and restores ownership", async () => {
  const f = fixture(); const p = f.terminal.confirm(() => view, "Remove", "Remove EXA_API_KEY?", "Delete");
  f.key("y"); f.key("return"); expect(await p).toBe(false);
  const q = f.terminal.confirm(() => view, "Remove", "Remove EXA_API_KEY?", "Delete");
  f.key("n"); f.key("right"); f.key("return"); expect(await q).toBe(true);
  f.terminal.close(); expect(f.input.isRaw).toBe(false);
});
it("keeps hidden form input secret, rejects multiline paste and preserves draft over resize", async () => {
  const f = fixture(); const p = f.terminal.form(() => view, { title: "Add", fields: [{ label: "API key", secret: true }], notes: "Plaintext warning", save: "Save", cancel: "Cancel", rejected: "Rejected paste" });
  f.input.write("synthetic-private"); Object.assign(f.output, { columns: 60, rows: 16 }); f.output.emit("resize");
  f.input.write("\t"); f.input.write("\t"); f.input.write("\r"); const result = await p; expect(result).toEqual(["synthetic-private"]);
  expect(f.write.mock.calls.map(c => c[0]).join("")).not.toContain("synthetic-private");
  const q = f.terminal.form(() => view, { title: "Add", fields: [{ label: "API key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected paste" });
  f.input.write("bad\nsecret\r"); await new Promise(r => setTimeout(r, 180));
  expect(f.write.mock.calls.map(c => c[0]).join("")).toContain("Rejected paste");
  f.input.write("\x1b"); expect(await q).toBeUndefined(); f.terminal.close();
});
const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
async function realWorkbench(provider = "exa", environment: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), "arks-workbench-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home }); await initializeConfig(paths.config);
  const f = fixture(); const controller = new AbortController();
  const confirm = f.terminal.confirm.bind(f.terminal);
  vi.spyOn(f.terminal, "confirm").mockImplementation((...args) => args[1] === "Exit setup" || args[1] === "退出设置" ? Promise.resolve(true) : confirm(...args));
  let finished = false;
  const start = (language: "en" | "zh" = "en") => runSetupWorkbench(paths, f.terminal, language, { provider, environment, signal: controller.signal }).finally(() => { finished = true; });
  const ready = () => vi.waitFor(() => expect(finished || f.input.listenerCount("end") > 0).toBe(true), { timeout: 2_000, interval: 5 });
  const send = async (name: string, extra = {}) => { await ready(); f.key(name, extra); await pause(); await ready(); };
  // Production decoder seam: write bytes instead of fabricating keypress metadata.
  const bytes = async (chunk: string, wait = 30) => { await ready(); f.input.write(chunk); await pause(wait); await ready(); };
  const text = () => f.write.mock.calls.map(c => String(c[0])).join("").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  return { ...f, paths, start, send, bytes, text, controller };
}
it.each([
  [16, 60, "en"], [24, 80, "en"], [16, 60, "zh"], [24, 80, "zh"],
] as const)("localizes the provider badge and complete focus guidance at %sx%s (%s)", async (rows, columns, language) => {
  const f = await realWorkbench("firecrawl"); Object.assign(f.output, { rows, columns });
  const running = f.start(language); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  const frame = () => String(f.write.mock.calls.at(-1)![0]).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").split("\n");
  const check = (focus: "top" | "menu" | "content", badge: string) => {
    const lines = frame(); const instructions = language === "zh" ? {
      top: "顶部 · ←→ 切换供应商 · ↓ 内容 · Tab 菜单 · ?",
      menu: "菜单 · ↑↓ 选择 · Enter 打开 · → 内容 · Shift-Tab 顶部 · ?",
      content: "内容 · ↑↓ 选行 · ← 菜单 · Tab 顶部 · Esc · ?",
    } : {
      top: "Top · ←→ switch provider · ↓ Content · Tab Menu · ?",
      menu: "Menu · ↑↓ move · Enter open · → Content · Shift-Tab Top · ?",
      content: "Content · ↑↓ rows · ← Menu · Tab Top · Esc · ?",
    };
    expect(lines.join("\n")).toContain(badge);
    expect(lines.at(-1)!.trimEnd()).toBe(instructions[focus]);
    if (language === "zh") { expect(lines.join("\n")).not.toContain("Provider On"); expect(lines.join("\n")).not.toContain("Provider Off"); expect(lines.join("\n")).not.toContain("auto #"); }
    expect(lines).toHaveLength(rows); expect(lines.every(line => cellWidth(line) === columns - 1)).toBe(true);
    for (const name of ["Exa", "Tavily", "Firecrawl", "SearXNG"]) expect(lines[0]).toContain(name);
  };
  try {
    await vi.waitFor(() => expect(f.input.listenerCount("keypress")).toBe(1), { timeout: 2_000 });
    const on = language === "zh" ? "供应商 开 · 自动 #3" : "Provider On · auto #3";
    check("menu", on); await f.bytes("\x1b[Z"); check("top", on);
    await f.bytes("\x1b[B"); check("content", on);
    await f.bytes("V"); check("content", language === "zh" ? "供应商 关 · 自动 #3" : "Provider Off · auto #3");
    await f.bytes("\t"); await f.bytes("\x1b[C");
    expect(frame().join("\n")).toContain(language === "zh" ? "仅显式" : "explicit only");
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it("saving an unchanged preloaded key neither writes nor asks to replace it", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-unchanged-key", {});
  const before = await readFile(f.paths.credentials, "utf8");
  const commands = ["right", "e", "escape", "escape"];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  const form = vi.spyOn(f.terminal, "form").mockResolvedValue(["fixture-unchanged-key"]);
  const confirm = vi.spyOn(f.terminal, "confirm"); const replace = vi.spyOn(management, "replaceSetupKey");
  await f.start(); f.terminal.close();
  expect(form.mock.calls[0]![1]).toMatchObject({ dirty: false, title: "Edit Exa", fields: [{ secret: true, value: "fixture-unchanged-key" }] });
  expect(confirm.mock.calls.filter(call => call[1] !== "Exit setup")).toHaveLength(0); expect(replace).not.toHaveBeenCalled();
  expect(await readFile(f.paths.credentials, "utf8")).toBe(before);
});
it("selected key details distinguish source override, manual health and provider configuration safely", async () => {
  const f = await realWorkbench("exa", { EXA_API_KEY: "fixture-details-environment" });
  await addSetupKey(f.paths, "exa", "fixture-details-stored", {});
  await management.setSetupKeyEnabled(f.paths, "exa", "env:EXA_API_KEY", false);
  const commands = ["right", "i", "escape", "escape"];
  const notice = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  await f.start(); f.terminal.close();
  const details = notice.mock.calls[0]![2];
  expect(details).toContain("env:EXA_API_KEY"); expect(details).toContain("Provider configuration: enabled");
  expect(details).toContain("environment overrides local"); expect(details).toContain("manually disabled");
  expect(details).toContain("Shared providers: none"); expect(details).toContain("Last diagnostic: not tested");
  expect(details).toContain("arks doctor"); expect(details).not.toContain("fixture-details-");
});
it("native all-key consent starts on Cancel and reports every disabled key separately", async () => {
  const f = await realWorkbench();
  const a = await addSetupKey(f.paths, "exa", "fixture-all-first", {}); const b = await addSetupKey(f.paths, "exa", "fixture-all-second", {});
  await management.setSetupKeyEnabled(f.paths, "exa", a, false); await management.setSetupKeyEnabled(f.paths, "exa", b, false);
  const before = await readFile(f.paths.state, "utf8");
  const diagnostic = vi.spyOn(keyTests, "testSetupKeys").mockImplementation(async options => {
    const results: keyTests.SetupKeyTestResult[] = [{ reference: a, status: "success", attemptCount: 1, completedAt: 1_700_000_000_000, durationMs: 25 }, { reference: b, status: "failure", errorKind: "auth", attemptCount: 1, completedAt: 1_700_000_000_025, durationMs: 25 }];
    results.forEach((row, n) => { options.onStart?.(row.reference, n + 1, results.length); options.onResult?.(row, n + 1, results.length); });
    return { results, cancelled: false };
  });
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[C"); await f.bytes("t");
    expect(f.text()).toContain("Test all 2 keys individually"); expect(f.text()).toContain("fees/logging");
    await f.bytes("\r"); expect(diagnostic).not.toHaveBeenCalled();
    await f.bytes("t"); await f.bytes("\x1b[B"); await f.bytes("\x1b[C"); await f.bytes("\r");
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalledOnce());
    expect(diagnostic.mock.calls[0]![0].config.providers.exa!.keyRefs).toEqual([a, b]);
    expect(f.text()).toContain("Key results: 1/2 passed"); expect(f.text()).toContain(`${a.slice(4)} · passed`); expect(f.text()).toContain(`${b.slice(4)} · failed`);
    expect(f.text()).not.toContain("fixture-all-"); expect(await readFile(f.paths.state, "utf8")).toBe(before);
    expect(f.text()).toContain(`Testing ${a} · completed 0/2`); expect(f.text()).toContain(`Testing ${b} · completed 1/2`);
    await f.bytes("\r");
    const details = vi.spyOn(f.terminal, "notice").mockResolvedValue();
    await f.bytes("i"); expect(details.mock.calls.at(-1)![2]).toContain("Last diagnostic: passed");
    expect(details.mock.calls.at(-1)![2]).toContain("25 ms");
    expect(details.mock.calls.at(-1)![2]).toContain("manually disabled");
    await f.bytes("]"); await f.bytes("["); await f.bytes("i");
    expect(details.mock.calls.at(-1)![2]).toContain("Last diagnostic: passed");
    await f.bytes("v"); await f.bytes("i"); expect(details.mock.calls.at(-1)![2]).toContain("Last diagnostic: not tested");
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it("refreshes normal key health when opening details rather than reporting an expired cooldown", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-fresh-health", {});
  const initial = await management.getSetupSnapshot(f.paths, {}); let expired = false;
  vi.spyOn(management, "getSetupSnapshot").mockImplementation(async () => {
    const snapshot = structuredClone(initial); const key = snapshot.providers.find(p => p.id === "exa")!.keys[0]!;
    key.status = expired ? "enabled" : "cooldown";
    if (!expired) { key.cooldownRemainingMs = 60_000; key.healthReason = "rate-limit"; }
    return snapshot;
  });
  const commands = ["right", "i", "escape", "escape"];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => { const name = commands.shift()!; if (name === "i") expired = true; return { name }; });
  vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  const notice = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  try { await f.start(); expect(notice.mock.calls[0]![2]).toContain("Key health: enabled"); expect(notice.mock.calls[0]![2]).not.toContain("Cooldown remaining"); }
  finally { f.terminal.close(); }
});
it.each(["edit", "remove", "environment-refresh"] as const)("handles session diagnostic history after %s without retaining secret fingerprints", async change => {
  const environment = { EXA_API_KEY: "fixture-cache-environment" };
  const f = await realWorkbench("exa", change === "environment-refresh" ? environment : {});
  const reference = await addSetupKey(f.paths, "exa", "fixture-cache-local", {});
  const commands = ["right", "t", "i", change === "edit" ? "e" : change === "remove" ? "d" : "]", ...(change === "environment-refresh" ? ["["] : []), "i", "escape", "escape"];
  vi.spyOn(f.terminal, "choose").mockResolvedValue(1); vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  vi.spyOn(f.terminal, "form").mockResolvedValue(["fixture-cache-replaced"]);
  const notice = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  vi.spyOn(keyTests, "testSetupKeys").mockResolvedValue({ cancelled: false, results: [{ reference, status: "failure", attemptCount: 1, errorKind: "auth", durationMs: NaN, completedAt: Infinity, rawBody: "fixture-cache-raw", secret: "fixture-cache-secret" } as keyTests.SetupKeyTestResult] });
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => {
    const name = commands.shift() ?? "escape";
    if (change === "environment-refresh" && name === "]") environment.EXA_API_KEY = "fixture-cache-new-environment";
    return { name, sequence: name };
  });
  await f.start(); f.terminal.close();
  const bodies = notice.mock.calls.map(call => call[2]);
  expect(bodies[1]).toContain("Last diagnostic: failed"); expect(bodies[1]).not.toMatch(/Duration:|Completed:/);
  if (change === "environment-refresh") {
    expect(bodies.at(-1)).toContain("Last diagnostic: failed");
    expect(bodies.at(-1)).toContain("not current credential validation");
  } else if (change === "edit") expect(bodies.at(-1)).toContain("Last diagnostic: not tested");
  else expect((await loadConfig(f.paths.config)).providers.exa!.keyRefs).not.toContain(reference);
  expect(bodies.join("\n")).not.toMatch(/fixture-cache|NaN|Infinity/);
});
it.each(["en", "zh"] as const)("curates malformed health metadata and current target progress in %s", async language => {
  const f = await realWorkbench(); const reference = await addSetupKey(f.paths, "exa", "fixture-curated-value", {});
  const snapshot = await management.getSetupSnapshot(f.paths, {}); const key = snapshot.providers[0]!.keys[0]!;
  Object.assign(key, { healthReason: "fixture-curated-secret", cooldownRemainingMs: -1, ownedResourceTypes: { browserSessions: NaN, monitors: -1, siteMonitors: Infinity }, sharedProviders: ["fixture-curated-secret"] });
  vi.spyOn(management, "getSetupSnapshot").mockResolvedValue(snapshot);
  const commands = ["right", "i", "t", "i", "escape", "escape"];
  const notice = vi.spyOn(f.terminal, "notice").mockResolvedValue(); vi.spyOn(f.terminal, "choose").mockResolvedValue(1);
  vi.spyOn(keyTests, "testSetupKeys").mockImplementation(async options => {
    options.onStart?.(reference, 1, 1);
    const row = { reference, status: "success", attemptCount: 1, completedAt: -2, durationMs: "fixture-curated-secret", errorKind: "fixture-curated-secret" } as unknown as keyTests.SetupKeyTestResult;
    options.onResult?.(row, 1, 1); return { results: [row], cancelled: false };
  });
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  await f.start(language); f.terminal.close();
  const bodies = notice.mock.calls.map(call => call[2]).join("\n");
  expect(bodies).not.toMatch(/fixture-curated|NaN|Infinity/);
  expect(bodies).toContain(language === "en" ? "Last diagnostic: passed" : "最近诊断: 通过");
  expect(f.text()).toContain(language === "en" ? `Testing ${reference} · completed 0/1` : `正在测试 ${reference} · 已完成 0/1`);
});
it.each(["removed", "disabled"])("refuses stale all-key consent after the provider is %s", async change => {
  const f = await realWorkbench("exa", { EXA_API_KEY: "fixture-stale-external" });
  await addSetupKey(f.paths, "exa", "fixture-stale-local", { EXA_API_KEY: "fixture-stale-external" });
  const diagnostic = vi.spyOn(keyTests, "testSetupKeys").mockResolvedValue({ results: [], cancelled: false });
  const notice = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[C"); await f.bytes("t");
    expect(f.text()).toContain("Test all 2 keys individually");
    if (change === "removed") await management.removeSetupKey(f.paths, "exa", "env:EXA_API_KEY");
    else await management.setSetupProviderEnabled(f.paths, "exa", false);
    await f.bytes("\x1b[B"); await f.bytes("\x1b[C"); await f.bytes("\r");
    expect(diagnostic).not.toHaveBeenCalled();
    expect(notice.mock.calls.at(-1)![2]).toContain("Configuration changed; reopen the test dialog.");
    expect(f.text()).not.toContain("fixture-stale-");
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it("Escape stops an all-key diagnostic and shows partial results without exiting Setup", async () => {
  const f = await realWorkbench();
  const a = await addSetupKey(f.paths, "exa", "fixture-stop-first", {}); const b = await addSetupKey(f.paths, "exa", "fixture-stop-second", {});
  const diagnostic = vi.spyOn(keyTests, "testSetupKeys").mockImplementation(async options => {
    const first: keyTests.SetupKeyTestResult = { reference: a, status: "success", attemptCount: 1 };
    options.onResult?.(first, 1, 2);
    await new Promise<void>(resolve => { if (options.signal!.aborted) resolve(); else options.signal!.addEventListener("abort", () => resolve(), { once: true }); });
    return { cancelled: true, results: [first, { reference: b, status: "cancelled", attemptCount: 1 }] };
  });
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[C"); await f.bytes("t"); await f.bytes("\x1b[B"); await f.bytes("\x1b[C"); await f.bytes("\r");
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalledOnce());
    await f.bytes("\x1b", 100);
    await vi.waitFor(() => expect(f.text()).toContain("Key results: 1/2 passed · stopped"));
    expect(f.text()).toContain(`${b.slice(4)} · cancelled`); expect(f.text()).not.toContain("fixture-stop-");
    await f.bytes("\r"); expect(f.input.listenerCount("keypress")).toBe(1); expect(f.controller.signal.aborted).toBe(false);
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it.each(["\r", "\n"])("production bytes %j open the selected row draft without saving or revealing its old key", async enter => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-enter-old", {});
  const form = vi.spyOn(f.terminal, "form"); const confirmation = vi.spyOn(f.terminal, "confirm");
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[C"); await f.bytes(enter);
    await vi.waitFor(() => expect(form).toHaveBeenCalledOnce(), { timeout: 500 });
    expect(form.mock.calls[0]![1]).toMatchObject({ presentation: "page", dirty: false, title: "Edit Exa", fields: [{ secret: true, value: "fixture-enter-old" }] });
    expect(f.text()).toContain("17 characters");
    await f.bytes(enter); await f.bytes("\x7f"); await f.bytes("D"); await f.bytes(enter);
    expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "fixture-enter-old" });
    await f.bytes("\x13", 220);
    expect(confirmation.mock.calls.at(-1)![1]).toBe("Replace key");
    await f.bytes(enter); // actual CR/LF activates default Cancel, not replacement
    expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "fixture-enter-old" });
    expect(form).toHaveBeenCalledTimes(2); expect(form.mock.calls[1]![1].fields[0]!.value).toBe("fixture-enter-olD");
    expect(f.text()).not.toContain("fixture-enter-");
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
  expect(f.input.isRaw).toBe(false); expect(f.input.listenerCount("keypress")).toBe(0); expect(f.input.listenerCount("end")).toBe(0); expect(f.output.listenerCount("resize")).toBe(0);
});
it.each(["\r", "\n"])("production bytes %j apply the selected global language option", async enter => {
  const f = await realWorkbench("tavily");
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[B"); await f.bytes("\x1b[B"); await f.bytes(enter);
    await f.bytes("\x1b[B"); await f.bytes(enter);
    await vi.waitFor(async () => expect((await loadConfig(f.paths.config)).setupLanguage).toBe("zh"), { timeout: 500 });
    expect(f.text()).toContain("已保存"); expect(f.text()).toContain("当前");
    await f.bytes("\x1b[D"); await f.bytes("\x1b[H"); await f.bytes(enter);
    const screen = String(f.write.mock.calls.at(-1)![0]).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    expect(screen).toContain("供应商 开 · 自动 #2");
    expect(screen.split("\n").at(-1)!.trimEnd()).toBe("内容 · ↑↓ 选行 · ← 菜单 · Tab 顶部 · Esc · ?");
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it.each([
  ["menu", "", "V"], ["menu", "", "v"],
  ["top", "\x1b[Z", "V"], ["top", "\x1b[Z", "v"],
  ["content", "\t", "V"], ["content", "\t", "v"],
])("provider V/v toggles from %s focus via %j using %j", async (_focus, navigation, toggle) => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-provider-toggle", {});
  const before = await loadConfig(f.paths.config); const credentials = await readFile(f.paths.credentials, "utf8");
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    if (navigation) await f.bytes(navigation);
    await f.bytes(toggle);
    await vi.waitFor(async () => expect((await loadConfig(f.paths.config)).providers.exa!.enabled).toBe(false));
    expect((await loadConfig(f.paths.config)).providerOrder).toEqual(before.providerOrder);
    expect((await management.getSetupSnapshot(f.paths, {})).providers[0]!.keys[0]!.status).toBe("enabled");
    expect(await readFile(f.paths.credentials, "utf8")).toBe(credentials);
    await f.bytes(toggle);
    await vi.waitFor(async () => expect((await loadConfig(f.paths.config)).providers.exa!.enabled).toBe(true));
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it("provider V/v remains literal in a field and cannot operate behind confirmation", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-provider-isolation", {});
  const credentials = await readFile(f.paths.credentials, "utf8");
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[C"); await f.bytes("a"); await f.bytes("\r"); await f.bytes("vV");
    expect(f.text()).toContain("2 characters");
    expect((await loadConfig(f.paths.config)).providers.exa!.enabled).toBe(true);
    await f.bytes("\x1b", 80); await f.bytes("\x1b", 80);
    await f.bytes("d"); await f.bytes("vV"); await f.bytes("\r");
    expect((await loadConfig(f.paths.config)).providers.exa!.enabled).toBe(true);
    expect(await readFile(f.paths.credentials, "utf8")).toBe(credentials);
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it("production ASCII Space toggles only the selected key and V/v separately toggles its provider", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-space-first", {}); await addSetupKey(f.paths, "exa", "fixture-space-second", {});
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[C"); await f.bytes("\x1b[B"); await f.bytes(" ");
    let provider = (await management.getSetupSnapshot(f.paths, {})).providers[0]!;
    expect(provider.enabled).toBe(true); expect(provider.keys.map(key => key.status)).toEqual(["enabled", "disabled"]);
    await f.bytes("v"); expect((await loadConfig(f.paths.config)).providers.exa!.enabled).toBe(false);
    await f.bytes("V"); expect((await loadConfig(f.paths.config)).providers.exa!.enabled).toBe(true);
    await f.bytes(" "); provider = (await management.getSetupSnapshot(f.paths, {})).providers[0]!;
    expect(provider.enabled).toBe(true); expect(provider.keys.map(key => key.status)).toEqual(["enabled", "enabled"]);
    await f.bytes("V"); expect((await loadConfig(f.paths.config)).providers.exa!.enabled).toBe(false);
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it("production ANSI Delete and uppercase I edit only the order draft until real Ctrl-S and save consent", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-include-key", {});
  const before = await readFile(f.paths.config, "utf8");
  const running = f.start(); const cancelled = expect(running).rejects.toThrow("Setup cancelled.");
  try {
    await f.bytes("\x1b[B"); await f.bytes("\r"); await f.bytes("\x1b[3~");
    await f.bytes("I"); await f.bytes("\r"); // chooser defaults to Cancel
    expect(await readFile(f.paths.config, "utf8")).toBe(before);
    await f.bytes("I"); await f.bytes("\x1b[C"); await f.bytes("\r");
    await f.bytes("\x13"); await f.bytes("\r"); // save defaults to Cancel
    expect(await readFile(f.paths.config, "utf8")).toBe(before);
    await f.bytes("\x13"); await f.bytes("\x1b[C"); await f.bytes("\r");
    expect((await loadConfig(f.paths.config)).providerOrder).toEqual(["tavily", "firecrawl", "exa"]);
  } finally { f.controller.abort(); await cancelled; f.terminal.close(); }
});
it("cycles only Top/Menu/Content and switches provider with focused top arrows", async () => {
  const f = await realWorkbench();
  const commands = ["tab", "tab", "right", "left", "down", "left", "right", "tab", "tab", "escape", "escape"];
  const screens: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screens.push(get()); return { name: commands.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(screens.slice(0, 3).map(v => v.focus)).toEqual(["menu", "content", "top"]);
  expect(screens[3]!.providerIndex).toBe(1); expect(screens[4]!.providerIndex).toBe(0);
  expect(screens.slice(5, 10).map(v => v.focus)).toEqual(["content", "menu", "content", "top", "menu"]);
  for (const screen of screens) for (const legacy of ["actions", "controls", "action", "control", "actionReasons", "controlReasons"]) expect(screen).not.toHaveProperty(legacy);
});
it("selects navigation without opening it until Enter and resets it on Esc", async () => {
  const f = await realWorkbench(); const screens: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  const commands = ["down", "down", "return", "escape", "up", "escape"];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screens.push(get()); return { name: commands.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(screens.slice(0, 3).map(v => v.route)).toEqual(["providers", "providers", "providers"]);
  expect(screens.slice(0, 3).map(v => v.menuCursor)).toEqual([0, 1, 2]);
  expect(screens[3]!.route).toBe("language"); expect(screens[3]!.focus).toBe("content");
  expect(screens[4]!.menuCursor).toBe(2); expect(screens[5]!.route).toBe("language"); expect(screens[5]!.menuCursor).toBe(1);
});
it("moves vertically within Menu/Content, clamps lists and never activates hints via Tab", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-axis-key", {});
  const commands = ["right", "down", "pagedown", "end", "home", "tab", "down", "left", "end", "home", "escape"];
  const views: WorkbenchView[] = [];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { views.push(get()); return { name: commands.shift() ?? "escape" }; });
  const form = vi.spyOn(f.terminal, "form").mockResolvedValue(undefined);
  await f.start(); f.terminal.close();
  expect(views.filter(v => v.focus === "content").every(v => v.selected === 0)).toBe(true);
  expect(views.map(v => v.focus)).toEqual(["menu", "content", "content", "content", "content", "content", "top", "content", "menu", "menu", "menu"]);
  expect(views[9]!.menuCursor).toBe(3); expect(views[10]!.menuCursor).toBe(0);
  expect(form).not.toHaveBeenCalled();
});
it("runs real backend add once, selects the new reference, keeps sidebar and no ghost key or secret", async () => {
  const f = await realWorkbench(); const running = f.start(); await pause();
  expect(f.text()).not.toContain("EXA_API_KEY");
  await f.send("right"); await f.send("a");
  f.input.write("\r"); f.input.write("synthetic-key"); f.input.write("\r"); f.input.write("\x13"); await pause(220);
  expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "synthetic-key" });
  await vi.waitFor(() => expect(f.text()).toContain("> EXA_API_KEY")); expect(f.text()).not.toContain("synthetic-key");
  expect(f.text()).not.toContain("[y/N]");
  await f.send("escape"); await f.send("escape"); await running; f.terminal.close();
});
it.each(["local", "override", "environment", "owned-shared", "invalid", "missing", "changed", "corrupt"]) ("previews %s sources read-only with curated failures and refreshed references", async scenario => {
  const environment: NodeJS.ProcessEnv = scenario === "override" || scenario === "environment" ? { EXA_API_KEY: "fixture-environment-key" } : scenario === "invalid" ? { EXA_API_KEY: "fixture-bad\nvalue" } : {};
  const f = await realWorkbench("exa", environment);
  if (scenario !== "environment" && scenario !== "missing") await addSetupKey(f.paths, "exa", "fixture-local-key", {});
  const beforeConfig = await readFile(f.paths.config, "utf8");
  const beforeCredentials = await readFile(f.paths.credentials, "utf8").catch(() => "");
  const read = vi.spyOn(f.terminal, "previewSecret").mockResolvedValue();
  const notice = vi.spyOn(f.terminal, "notice").mockRejectedValue(new Error("Must not notify"));
  const snapshot = await management.getSetupSnapshot(f.paths, environment);
  if (scenario === "owned-shared") {
    snapshot.providers[0]!.keys[0]!.ownedResources = 1;
    snapshot.providers[1]!.keys = [...snapshot.providers[0]!.keys];
  }
  if (scenario === "missing") snapshot.providers[0]!.keys = [{ reference: "env:EXA_API_KEY_1", keyId: "fixture", source: "missing", available: false, hasLocal: false, status: "enabled", ownedResources: 0 }];
  const get = vi.spyOn(management, "getSetupSnapshot").mockResolvedValue(snapshot);
  if (scenario === "changed") get.mockResolvedValueOnce(snapshot).mockResolvedValue({ ...snapshot, providers: snapshot.providers.map(p => ({ ...p, keys: [] })) });
  if (scenario === "corrupt") {
    const credentials = await import("../src/config/credentials.js");
    vi.spyOn(credentials, "loadCredentialStore").mockRejectedValue(new Error("fixture-raw-error-value"));
  }
  const names = ["right", "p", "escape", "escape"];
  const screens: typeof view[] = [];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async getView => { screens.push(getView()); return { name: names.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(notice).not.toHaveBeenCalled(); expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
  if (["invalid", "missing", "changed", "corrupt"].includes(scenario)) {
    expect(read).not.toHaveBeenCalled(); expect(screens.some(screen => screen.status.includes("Preview unavailable"))).toBe(true);
  } else {
    expect(read).toHaveBeenCalledOnce();
    const sources = read.mock.calls[0]![1].sources;
    expect(sources).toEqual(scenario === "override" ? [{ label: "Local stored", value: "fixture-local-key" }, { label: "Effective environment (overrides local)", value: "fixture-environment-key" }] : scenario === "environment" ? [{ label: "Effective environment", value: "fixture-environment-key" }] : [{ label: "Local stored", value: "fixture-local-key" }]);
    expect(screens[2]!.focus).toBe("content"); expect(screens[2]!.selected).toBe(0);
  }
  expect(JSON.stringify(screens)).not.toMatch(/fixture-(?:local|environment|bad|raw)/);
  expect(await readFile(f.paths.config, "utf8")).toBe(beforeConfig);
  expect(await readFile(f.paths.credentials, "utf8").catch(() => "")).toBe(beforeCredentials);
});
it("rejects a non-string environment preview without echo or terminal diagnostics", async () => {
  const f = await realWorkbench("exa", { EXA_API_KEY: 42 } as unknown as NodeJS.ProcessEnv);
  await addSetupKey(f.paths, "exa", "fixture-local-nonstring", {});
  const read = vi.spyOn(f.terminal, "previewSecret").mockResolvedValue();
  const notice = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  const names = ["right", "p", "escape", "escape"]; const statuses: string[] = [];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { statuses.push(get().status); return { name: names.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(read).not.toHaveBeenCalled(); expect(notice).not.toHaveBeenCalled();
  expect(statuses).toContain("Preview unavailable: invalid environment credential.");
  expect(statuses.join(" ")).not.toContain("fixture-local-nonstring");
});
it("binds deletion to the selected twelfth object, supports page/home/end, ignores digits, and cancels safely", async () => {
  const f = await realWorkbench(); for (let n = 0; n < 12; n++) await addSetupKey(f.paths, "exa", `synthetic-${n}`, {});
  const running = f.start(); await pause(); await f.send("right"); await f.send("end");
  expect(f.text()).toContain("> EXA_API_KEY_11");
  await f.send("1", { sequence: "1" }); await f.send("0", { sequence: "0" }); await f.send("d");
  await f.send("y"); await f.send("return"); expect((await loadConfig(f.paths.config)).providers.exa!.keyRefs).toHaveLength(12);
  await f.send("d"); await f.send("right"); await f.send("return");
  expect((await loadConfig(f.paths.config)).providers.exa!.keyRefs).not.toContain("env:EXA_API_KEY_11");
  await f.send("home"); await f.send("pagedown"); await f.send("pageup");
  await f.send("escape"); await f.send("escape"); await running; f.terminal.close();
});
it("keeps order as a draft across global navigation and writes only on Ctrl-S plus consent", async () => {
  const f = await realWorkbench(); const before = await readFile(f.paths.config, "utf8");
  const running = f.start(); await pause();
  await f.send("down");
  await f.send("return");
  await f.send("d");
  expect(await readFile(f.paths.config, "utf8")).toBe(before);
  await f.send("left"); await f.send("down"); await f.send("return"); await f.send("left"); await f.send("up"); await f.send("return");
  await f.send("s", { ctrl: true }); await f.send("right"); await f.send("return");
  expect((await loadConfig(f.paths.config)).providerOrder.slice(0, 2)).toEqual(["tavily", "exa"]);
  await f.send("escape"); await f.send("escape"); await running; f.terminal.close();
});
it("direct language navigation reaches the same sidebar and persists a global preference only", async () => {
  const f = await realWorkbench("tavily"); const running = f.start(); await pause();
  await f.send("down"); await f.send("down"); await f.send("return"); await f.send("down"); await f.send("return");
  expect((await loadConfig(f.paths.config)).setupLanguage).toBe("zh");
  expect(f.text()).toContain("已保存");
  await f.send("escape"); expect(f.text()).toContain("Menu");
  await f.send("escape"); await running; f.terminal.close();
});
it.each(["EOF", "abort", "IO", "render"])("restores native raw ownership and redacts errors on %s", async mode => {
  const f = fixture(); const controller = new AbortController(); const pending = f.terminal.workbench(() => view, controller.signal);
  if (mode === "EOF") f.input.emit("end");
  else if (mode === "abort") controller.abort();
  else if (mode === "IO") f.input.emit("error", new Error("synthetic-private-error"));
  else { f.write.mockImplementationOnce(() => { throw new Error("synthetic-private-error"); }); f.output.emit("resize"); }
  await expect(pending).rejects.not.toThrow("synthetic-private-error");
  f.terminal.close(); expect(f.input.isRaw).toBe(false); expect(f.input.listenerCount("keypress")).toBe(0); expect(f.output.listenerCount("resize")).toBe(0);
});
it("cancels pending Save with Esc and blocks its timer after shrinking, retaining the draft", async () => {
  const f = fixture();
  const form = { title: "Add", fields: [{ label: "API key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" };
  const first = f.terminal.form(() => view, form); f.input.write("synthetic-draft"); f.input.write("\t"); f.input.write("\t"); f.input.write("\r"); f.input.write("\x1b");
  expect(await first).toBeUndefined();
  const second = f.terminal.form(() => view, form); f.input.write("synthetic-draft"); f.input.write("\t"); f.input.write("\t"); f.input.write("\r");
  Object.assign(f.output, { rows: 8, columns: 24 }); f.output.emit("resize"); await pause(180);
  expect(f.input.isRaw).toBe(true);
  Object.assign(f.output, { rows: 24, columns: 80 }); f.output.emit("resize"); f.input.write("\r");
  expect(await second).toEqual(["synthetic-draft"]); f.terminal.close();
});
it("decodes split UTF-8 in raw forms and keeps cursor within a compact modal", async () => {
  const f = fixture(16, 60); const pending = f.terminal.form(() => view, { title: "URL", fields: [{ label: "URL" }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  const value = "https://例子.example/中e\u0301👩‍💻";
  for (const byte of Buffer.from(value)) f.input.write(Buffer.from([byte]));
  const cursor = /\x1b\[(\d+);(\d+)H/.exec(String(f.write.mock.calls.at(-1)![0]))!;
  expect(Number(cursor[1])).toBeLessThan(16); expect(Number(cursor[2])).toBeLessThan(60);
  f.input.write("\t"); f.input.write("\t"); f.input.write("\r"); expect(await pending).toEqual([value]); f.terminal.close();
});
it("aborts in-flight operations on Ctrl-C and waits for their settlement before cleanup", async () => {
  const f = fixture(); let aborted = false;
  const pending = f.terminal.busy(() => view, signal => new Promise(resolve => signal.addEventListener("abort", () => { aborted = true; resolve("settled"); }, { once: true })));
  f.key("c", { ctrl: true }); await expect(pending).rejects.toThrow("Setup cancelled.");
  expect(aborted).toBe(true); expect(f.input.isRaw).toBe(false); f.terminal.close();
});
it("adds SearXNG without network, preserves disabled provider on append, and cancels URL drafts", async () => {
  const f = await realWorkbench("searxng"); const running = f.start(); await pause();
  await f.send("right"); await f.send("a"); f.input.write("\r"); f.input.write("https://first.example/"); f.input.write("\r"); f.input.write("\x13"); await pause(220);
  const saved = await loadConfig(f.paths.config); expect(saved.providers.searxng!.enabled).toBe(true); expect(saved.providerOrder).not.toContain("searxng");
  await f.send("v", { shift: true, sequence: "V" }); expect((await loadConfig(f.paths.config)).providers.searxng!.enabled).toBe(false);
  await f.send("a"); f.input.write("\r"); f.input.write("https://second.example/"); f.input.write("\r"); f.input.write("\x13"); await pause(220);
  expect((await loadConfig(f.paths.config)).providers.searxng!.enabled).toBe(false);
  expect((await loadConfig(f.paths.config)).providers.searxng!.instances).toHaveLength(2);
  await f.send("e"); f.input.write("\x1b"); await pause(80);
  await f.send("escape"); await f.send("escape"); await running; f.terminal.close();
});
it("marks order dirty, keeps it after Cancel and discards only through explicit consent", async () => {
  const f = await realWorkbench(); const before = await readFile(f.paths.config, "utf8"); const views: WorkbenchView[] = [];
  const commands = ["down", "return", "d", "escape", "escape", "escape", "escape"];
  const confirmation = vi.spyOn(f.terminal, "confirm").mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValue(true);
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { views.push(get()); return { name: commands.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(views[3]!.title).toContain("unsaved"); expect(views[3]!.summary).toContain("exa → tavily → firecrawl");
  expect(views[4]!.cells).toEqual(views[3]!.cells); expect(views[4]!.focus).toBe("content");
  expect(views[5]!.title).toContain("unchanged"); expect(views[5]!.focus).toBe("content");
  expect(confirmation.mock.calls.slice(0, 2).map(call => [call[1], call[3], call[4]])).toEqual([["Discard order draft", "Discard", "Cancel"], ["Discard order draft", "Discard", "Cancel"]]);
  expect(await readFile(f.paths.config, "utf8")).toBe(before);
});
it.each(["empty", "owned", "shared", "environment", "sx-empty", "sx-environment", "cooldown", "exhausted"])("marks unavailable %s actions and blocks activation before prompts/backend", async scenario => {
  const f = await realWorkbench(scenario.startsWith("sx") ? "searxng" : "exa");
  const snapshot: SetupSnapshot = { providerOrder: ["exa"], providers: ["exa", "tavily", "firecrawl", "searxng"].map(id => ({ id: id as "exa", enabled: true, keys: [], instances: [] })) };
  if (!scenario.startsWith("sx") && scenario !== "empty") snapshot.providers[0]!.keys = [{ reference: "env:EXA_API_KEY", keyId: "synthetic", source: scenario === "environment" ? "environment" : "local", available: true, hasLocal: true, status: ["cooldown", "exhausted"].includes(scenario) ? scenario : "enabled", ownedResources: scenario === "owned" ? 1 : 0 }];
  if (scenario === "shared") snapshot.providers[1]!.keys = [...snapshot.providers[0]!.keys];
  if (scenario === "sx-environment") { snapshot.providers[3]!.external = true; snapshot.providers[3]!.instances = [{ baseUrl: "https://external.example", allowRanges: [], status: "configured (not probed)", source: "environment" }]; }
  vi.spyOn(management, "getSetupSnapshot").mockResolvedValue(snapshot);
  const toggle = vi.spyOn(management, "setSetupProviderEnabled").mockResolvedValue();
  const form = vi.spyOn(f.terminal, "form").mockRejectedValue(new Error("Unexpected form"));
  const confirmation = vi.spyOn(f.terminal, "confirm").mockImplementation(async (_get, title) => { if (title === "Exit setup") return true; throw new Error("Unexpected confirmation"); });
  const liveBlocked = ["empty", "sx-empty"].includes(scenario);
  const keys = ["right", ...(["cooldown", "exhausted"].includes(scenario) ? [] : ["e"]), ...(["owned", "sx-empty", "sx-environment"].includes(scenario) ? ["V"] : []), ...(liveBlocked ? ["t"] : []), "escape", "escape"];
  const views: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async view => { views.push(view()); return { name: keys.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(form).not.toHaveBeenCalled(); expect(confirmation.mock.calls.every(call => call[1] === "Exit setup")).toBe(true);
  if (["owned", "sx-empty", "sx-environment"].includes(scenario)) expect(toggle).not.toHaveBeenCalled();
  const blocked = views.find(v => v.focus === "content")!;
  const hint = (key: string) => blocked.hints.find(hint => hint.key === key)!;
  if (!["cooldown", "exhausted"].includes(scenario)) { expect(hint("Enter/e").reason).toBeTruthy(); expect(views.some(v => v.status.includes(hint("Enter/e").reason!))).toBe(true); }
  if (liveBlocked) expect(hint("t").reason).toBeTruthy();
  expect(hint("a").reason).toBeUndefined();
  if (["owned", "sx-empty", "sx-environment"].includes(scenario)) {
    expect(hint("v").reason).toBeTruthy(); expect(views.some(v => v.status.includes(hint("v").reason!))).toBe(true);
    expect(hint("v").label).toBe("Provider on/off");
  }
  if (scenario === "owned") expect(hint("Space").reason).toBe("");
  if (["environment", "shared"].includes(scenario)) expect(hint("d").reason).toBe("");
});
it("Include defaults to Cancel even after list selection; explicit Include alone accepts", async () => {
  const f = fixture();
  const first = f.terminal.choose(() => view, "Include", ["Exa", "SearXNG"], "Include", "Cancel");
  f.key("down"); f.key("return"); expect(await first).toBeUndefined();
  const second = f.terminal.choose(() => view, "Include", ["Exa", "SearXNG"], "Include", "Cancel");
  f.key("down"); f.key("tab"); f.key("return"); expect(await second).toBe(1); f.terminal.close();
});
it("confirmation arrows select bounded buttons rather than toggling", async () => {
  const f = fixture(); const first = f.terminal.confirm(() => view, "Remove", "Remove?", "Delete");
  f.key("left"); f.key("return"); expect(await first).toBe(false);
  const second = f.terminal.confirm(() => view, "Remove", "Remove?", "Delete");
  f.key("right"); f.key("right"); f.key("return"); expect(await second).toBe(true); f.terminal.close();
});
it("does not inherit instance CIDRs through an invalid URL retry", async () => {
  const f = await realWorkbench("searxng");
  await addSearxngInstance(f.paths.config, "https://old.example", ["10.1.2.3/32"]);
  const keys = ["right", "e", "escape", "escape"];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: keys.shift() ?? "escape" }));
  vi.spyOn(f.terminal, "form").mockResolvedValueOnce(["invalid-url", "10.1.2.3/32"]).mockResolvedValueOnce(["https://new.example", "10.1.2.3/32"]);
  vi.spyOn(f.terminal, "notice").mockResolvedValue();
  const consent = vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  await f.start(); f.terminal.close();
  expect((await loadConfig(f.paths.config)).providers.searxng!.instances[0]).toEqual({ baseUrl: "https://new.example", allowRanges: [] });
  expect(consent.mock.calls.every(call => call[1] === "Exit setup")).toBe(true);
});
it("bounds accumulated form input when a printable chunk includes its trailing CR", async () => {
  const f = fixture(); const pending = f.terminal.form(() => view, { title: "Add", fields: [{ label: "API key", secret: true, value: "seed" }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected oversized input" });
  f.input.write("x".repeat(8189) + "\r");
  expect(f.write.mock.calls.map(c => c[0]).join("")).toContain("Rejected oversized input");
  await pause(180); f.input.write("\x1b"); expect(await pending).toBeUndefined(); f.terminal.close();
});
it.each(["render failure", "synchronous abort"])("never starts a busy operation after initial %s", async mode => {
  const f = fixture(); const controller = new AbortController(); const action = vi.fn(async () => "unexpected");
  if (mode === "render failure") f.write.mockImplementationOnce(() => { throw new Error("Synthetic render failure"); });
  const pending = f.terminal.busy(() => { if (mode === "synchronous abort") controller.abort(); return view; }, action, controller.signal);
  await expect(pending).rejects.toThrow(mode === "render failure" ? "Setup terminal I/O failed." : "Setup cancelled.");
  expect(action).not.toHaveBeenCalled(); expect(f.input.isRaw).toBe(false); expect(f.input.listenerCount("keypress")).toBe(0); f.terminal.close();
});
it.each(["en", "zh"] as const)("keeps Firecrawl separators stable after form Esc then sidebar Esc (%s)", async language => {
  const f = await realWorkbench("firecrawl");
  // Independent text-presentation width for the structural ASCII/CJK fixture, not cellWidth.
  const width = (text: string) => [...text].reduce((n, c) => n + (/\p{Script=Han}/u.test(c) ? 2 : 1), 0);
  for (const [columns, rows] of [[80, 24], [60, 16]] as const) for (const color of [true, false]) {
    vi.stubEnv("NO_COLOR", color ? "" : "1"); vi.stubEnv("TERM", "xterm"); Object.assign(f.output, { columns, rows });
    const commands = ["return", "a", "escape", "escape"];
    const screens: string[] = [];
    vi.spyOn(f.terminal, "form").mockImplementation(async get => {
      const pending = SetupTerminal.prototype.form.call(f.terminal, get, { title: "Add Firecrawl", fields: [{ label: "API key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
      f.input.write("\x1b"); return pending;
    });
    vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { f.terminal.render(get()); screens.push(String(f.write.mock.calls.at(-1)![0]).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")); return { name: commands.shift() ?? "escape" }; });
    await runSetupWorkbench(f.paths, f.terminal, language, { provider: "firecrawl", environment: {} });
    expect(screens[0]).toContain("Firecrawl"); expect(screens[2]).toContain("Firecrawl");
    for (const screen of screens) {
      const paneWidth = 19;
      const paneRows = screen.split("\n").slice(2, rows - 3);
      for (const line of paneRows) {
        // Independent cell accounting: nav starts at 0, closes at width-1, page opens at width+1.
        expect(width(line.slice(0, line.indexOf("│", 1) + 1))).toBe(paneWidth);
        expect(line.slice(line.indexOf("│", 1) + 1)).toMatch(/^ │/);
      }
    }
    for (const screen of screens) expect(screen.split("\n").every(line => width(line) <= columns - 1)).toBe(true);
    vi.mocked(f.terminal.form).mockRestore(); vi.mocked(f.terminal.workbench).mockRestore();
  }
  vi.unstubAllEnvs(); f.terminal.close();
});
it.each(["en", "zh"] as const)("displays current provider state and updates it through the existing toggle (%s)", async language => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-state", {});
  const commands = ["right", "V", "V", "escape", "escape"];
  const screens: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  const toggle = vi.spyOn(management, "setSetupProviderEnabled");
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screens.push(get()); return { name: commands.shift() ?? "escape" }; });
  await runSetupWorkbench(f.paths, f.terminal, language, { environment: {} }); f.terminal.close();
  expect(screens[0]!.summary).toContain(language === "zh" ? "供应商 开" : "Provider On");
  expect(screens[2]!.summary).toContain(language === "zh" ? "供应商 关" : "Provider Off");
  expect(screens[2]!.summaryTone).toBe("danger"); expect(screens[3]!.summaryTone).toBe("success");
  expect(toggle.mock.calls.map(call => call[2])).toEqual([false, true]);
});
it("maps concrete key lifecycle states to tones without parsing localized labels", async () => {
  const f = await realWorkbench(); const snapshot = await management.getSetupSnapshot(f.paths, {});
  snapshot.providers[0]!.keys = ["enabled", "disabled", "cooldown", "exhausted", "enabled"].map((status, n) => ({ reference: `env:FIXTURE_${n}`, keyId: String(n), source: n === 4 ? "missing" : "local", available: n !== 4, hasLocal: n !== 4, status, ownedResources: 0 }));
  vi.spyOn(management, "getSetupSnapshot").mockResolvedValue(snapshot);
  let screen: ReturnType<Parameters<SetupTerminal["workbench"]>[0]> | undefined;
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screen = get(); return { name: "escape" }; });
  await f.start(); f.terminal.close();
  expect(screen!.rowTones).toEqual(["success", "danger", "warning", "warning", "muted"]);
  expect(screen!.hints.find(hint => hint.key === "a")!.tone).toBe("success");
  expect(screen!.hints.find(hint => hint.key === "d")!.tone).toBe("danger");
});
it("keeps order draft and focus through contextual help, with concrete table data", async () => {
  const f = await realWorkbench(); const before = await readFile(f.paths.config, "utf8");
  const screens: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  const commands = ["down", "return", "d", "?", "left", "down", "return", "?", "left", "up", "return", "escape", "escape", "escape"];
  const help = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screens.push(get()); return { name: commands.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  const firstHelp = screens.findIndex(v => v.route === "order" && v.title.includes("unsaved"));
  expect(screens[firstHelp]!.cells?.[0]).toEqual(["tavily", "1", "enabled"]);
  expect(screens[firstHelp + 1]!.cells).toEqual(screens[firstHelp]!.cells);
  expect(screens[firstHelp + 1]!.selected).toBe(screens[firstHelp]!.selected);
  expect(help.mock.calls.map(call => call[2])).toEqual(expect.arrayContaining([expect.stringContaining("Order draft"), expect.stringContaining("Language")]));
  expect(screens.find(v => v.route === "language")!.columns).toEqual(["Language", "Status"]);
  expect(await readFile(f.paths.config, "utf8")).toBe(before);
});
it.each(["en", "zh"] as const)("provides reference/source/state cells directly from lifecycle metadata (%s)", async language => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-table-private", {});
  const screens: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screens.push(get()); return { name: "escape" }; });
  await runSetupWorkbench(f.paths, f.terminal, language, { environment: {} }); f.terminal.close();
  expect(screens[0]!.columns).toEqual(language === "en" ? ["Reference", "Source", "Status"] : ["引用", "来源", "状态"]);
  expect(screens[0]!.cells).toEqual([["EXA_API_KEY", language === "en" ? "local" : "本地", language === "en" ? "enabled" : "已启用"]]);
  expect(JSON.stringify(screens)).not.toContain("fixture-table-private");
});
it("keeps provider context, four menu cursor and opened route independent", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-first", {}); await addSetupKey(f.paths, "exa", "fixture-second", {});
  const commands = ["right", "down", "]", "[", "left", "down", "return", "]", "escape", "escape"];
  const screens: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screens.push(get()); const name = commands.shift() ?? "escape"; return { name, sequence: name }; });
  await f.start(); f.terminal.close();
  expect(screens[0]!.menu).toEqual(["Providers", "Configuration", "Settings", "Exit"]);
  expect(screens[3]!.providerIndex).toBe(1); expect(screens[4]!.selected).toBe(1);
  expect(screens[6]!.route).toBe("providers"); expect(screens[6]!.menuCursor).toBe(1);
  expect(screens[7]!.route).toBe("order"); expect(screens[8]!.route).toBe("order"); expect(screens[8]!.providerIndex).toBe(1);
});
it("scopes row intents to Content while provider enablement follows the top context from every pane", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-first", {}); await addSetupKey(f.paths, "exa", "fixture-second", {});
  const before = (await loadConfig(f.paths.config)).providerOrder;
  const commands = ["space", "V", "e", "tab", "tab", "space", "V", "e", "down", "down", "space", "V", "V", "space", "i", "e", "escape", "escape"];
  const views: WorkbenchView[] = [];
  const form = vi.spyOn(f.terminal, "form").mockResolvedValue(undefined);
  const details = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  const toggles = vi.spyOn(management, "setSetupKeyEnabled"); const providerToggle = vi.spyOn(management, "setSetupProviderEnabled");
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { views.push(get()); return { name: commands.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(toggles.mock.calls.map(call => [call[2], call[3]])).toEqual([["env:EXA_API_KEY_1", false], ["env:EXA_API_KEY_1", true]]);
  expect(providerToggle.mock.calls.map(call => call[2])).toEqual([false, true, false, true]);
  expect(form).toHaveBeenCalledOnce(); expect(form.mock.calls[0]![1].fields).toEqual([{ label: "API key", secret: true, value: (await loadCredentialEnvironment(f.paths.credentials, {})).EXA_API_KEY_1 }]);
  expect(details.mock.calls[0]![2]).toContain("env:EXA_API_KEY_1");
  expect(views.slice(0, 9).map(view => view.focus)).toEqual(["menu", "menu", "menu", "menu", "content", "top", "top", "top", "top"]);
  expect((await loadConfig(f.paths.config)).providerOrder).toEqual(before);
  expect(JSON.stringify(views)).not.toContain("fixture-");
});
it("retains selected resource per top context and global order/language during focused Top switching", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-first", {}); await addSetupKey(f.paths, "exa", "fixture-second", {});
  const commands = ["right", "down", "tab", "right", "left", "down", "left", "down", "return", "d", "tab", "right", "left", "down", "left", "down", "return", "down", "return", "tab", "right", "down", "left", "up", "return", "left", "end", "return"];
  const views: WorkbenchView[] = [];
  vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { views.push(get()); return { name: commands.shift() ?? "escape" }; });
  await f.start(); f.terminal.close();
  expect(views[6]!.selected).toBe(1); expect(views[6]!.providerIndex).toBe(0);
  expect(views[10]!.cells[0]![0]).toBe("tavily"); expect(views[12]!.cells).toEqual(views[10]!.cells);
  expect(views[19]!.language).toBe("zh"); expect(views[21]!.route).toBe("language"); expect(views[21]!.language).toBe("zh");
  expect(views[25]!.route).toBe("order"); expect(views[25]!.title).toContain("未保存"); expect(views[25]!.cells[0]![0]).toBe("tavily");
  expect((await loadConfig(f.paths.config)).providerOrder.slice(0, 2)).toEqual(["exa", "tavily"]);
});
it("advertises and guards page intents at 80×24 and 60×16 without browse buttons", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-hints", {});
  const screens: WorkbenchView[] = [];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { screens.push(get()); return { name: "escape" }; });
  await f.start();
  for (const [rows, columns] of [[24, 80], [16, 60]] as const) {
    Object.assign(f.output, { rows, columns }); f.terminal.render(screens[0]!);
    const screen = String(f.write.mock.calls.at(-1)![0]).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
    for (const hint of ["Enter/e Edit", "a Add", "i Details", "p Preview", "d Remove", "Space Key on/off", "v Provider on/off", "t Test provider"]) expect(screen).toContain(hint);
    expect(screen.split("\n")[2]).toContain("Reference"); expect(screen).not.toContain("[Add]"); expect(screen).not.toContain("[On]");
    expect(screen.split("\n").every(line => cellWidth(line) === columns - 1)).toBe(true);
  }
  f.terminal.close();
});
it("keeps order nonempty, includes via a Cancel-first chooser and confirms routing once per save", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-order-key", {});
  await addSearxngInstance(f.paths.config, "https://search.example", []); await management.setSetupProviderOrder(f.paths, ["searxng"]);
  const before = await readFile(f.paths.config, "utf8"); const views: WorkbenchView[] = [];
  const commands = ["down", "return", "delete", "I", "ctrl-s", "]", "ctrl-s", "u", "d", "delete", "ctrl-s", "escape", "escape"];
  const choose = vi.spyOn(f.terminal, "choose").mockResolvedValue(0);
  const saves = vi.spyOn(management, "setSetupProviderOrder");
  let declined = false;
  const consent = vi.spyOn(f.terminal, "confirm").mockImplementation(async (_get, title) => { if (title === "Save order" && !declined) { declined = true; expect(await readFile(f.paths.config, "utf8")).toBe(before); return false; } return true; });
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => {
    views.push(get()); const name = commands.shift() ?? "escape";
    return name === "ctrl-s" ? { name: "s", ctrl: true } : { name, sequence: name };
  });
  await f.start(); f.terminal.close();
  expect(views[3]!.cells).toEqual([["searxng", "1", "enabled"]]); expect(views[3]!.status).toContain("Keep at least one provider");
  expect(choose.mock.calls[0]!.slice(1, 5)).toEqual(["Include provider", ["exa"], "Include", "Cancel"]);
  expect(views[5]!.cells).toEqual(views[4]!.cells); expect(views[6]!.cells).toEqual(views[4]!.cells);
  expect(saves.mock.calls.map(call => call[1])).toEqual([["searxng", "exa"], ["searxng"]]);
  const confirmations = consent.mock.calls.filter(call => call[1] === "Save order");
  expect(confirmations).toHaveLength(3); expect(confirmations.every(call => /hosted|SearXNG/.test(call[2]))).toBe(true);
  expect((await loadConfig(f.paths.config)).providerOrder).toEqual(["searxng"]);
});
it("requires provider-scoped test consent after replacement and excludes response bodies", async () => {
  const f = await realWorkbench("tavily"); await addSetupKey(f.paths, "tavily", "fixture-test-old", {});
  const commands = ["right", "e", "t", "t", "escape", "escape"];
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ results: [], secret: "fixture-hostile-body" }), { status: 200 }));
  vi.spyOn(f.terminal, "form").mockResolvedValue(["fixture-test-new"]);
  vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  const choices = vi.spyOn(f.terminal, "choose").mockResolvedValueOnce(undefined).mockResolvedValue(0);
  const notice = vi.spyOn(f.terminal, "notice").mockResolvedValue();
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  await f.start(); f.terminal.close();
  expect(fetch).toHaveBeenCalledOnce(); const [url, init] = fetch.mock.calls[0]!;
  expect(String(url)).toBe("https://api.tavily.com/search"); expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-test-new");
  expect(choices).toHaveBeenCalledTimes(2);
  expect(choices.mock.calls.every(call => call[1] === "Test connection" && call[6]!.includes("tavily") && call[6]!.includes("fees"))).toBe(true);
  expect(JSON.stringify(notice.mock.calls.map(call => call[2]))).not.toContain("fixture-");
});
it("empty row Enter never adds, while selected row Enter opens a masked page draft", async () => {
  const f = await realWorkbench(); const commands = ["right", "return", "escape", "escape"];
  const form = vi.spyOn(f.terminal, "form").mockResolvedValue(undefined);
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  await f.start(); expect(form).not.toHaveBeenCalled();
  await addSetupKey(f.paths, "exa", "fixture-existing-key", {});
  commands.push("right", "return", "escape", "escape"); await f.start();
  expect(form).toHaveBeenCalledOnce(); expect(form.mock.calls[0]![1]).toMatchObject({ presentation: "page", dirty: false, title: "Edit Exa", fields: [{ secret: true, value: "fixture-existing-key" }] });
  expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "fixture-existing-key" }); f.terminal.close();
});
it("retains validation errors and valid replacement draft after default-Cancel confirmation", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-old-key", {});
  const commands = ["right", "return", "escape", "escape"];
  const forms: Parameters<SetupTerminal["form"]>[1][] = [];
  const form = vi.spyOn(f.terminal, "form").mockImplementation(async (_get, draft) => { forms.push(draft); return forms.length === 1 ? ["placeholder"] : forms.length === 2 ? ["fixture-new-key"] : undefined; });
  const confirm = vi.spyOn(f.terminal, "confirm").mockImplementation(async (_get, title) => title === "Exit setup");
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  await f.start(); f.terminal.close();
  expect(form).toHaveBeenCalledTimes(3); expect(forms[1]!.fields[0]!.value).toBe("placeholder"); expect(forms[1]!.error).toBeTruthy();
  expect(forms[2]!.fields[0]!.value).toBe("fixture-new-key"); expect(forms[2]!.dirty).toBe(true);
  expect(confirm.mock.calls.filter(call => call[1] === "Replace key")).toHaveLength(1);
  expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "fixture-old-key" });
});
it("retains changed endpoint/CIDR draft after declined scope consent and focuses invalid CIDRs", async () => {
  const f = await realWorkbench("searxng"); await addSearxngInstance(f.paths.config, "https://old.example", ["10.1.2.3/32"]);
  const commands = ["right", "return", "escape", "escape"]; const forms: Parameters<SetupTerminal["form"]>[1][] = [];
  vi.spyOn(f.terminal, "form").mockImplementation(async (_get, draft) => { forms.push(draft); return forms.length === 1 ? ["https://new.example", "bad"] : forms.length === 2 ? ["https://new.example", "10.9.8.7/32"] : undefined; });
  vi.spyOn(f.terminal, "confirm").mockImplementation(async (_get, title) => title === "Exit setup");
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  await f.start(); f.terminal.close();
  expect(forms[1]).toMatchObject({ initialField: 1, fields: [{ value: "https://new.example" }, { value: "bad" }] });
  expect(forms[1]!.error).toBeTruthy(); expect(forms[2]).toMatchObject({ dirty: true, fields: [{ value: "https://new.example" }, { value: "10.9.8.7/32" }] });
  expect((await loadConfig(f.paths.config)).providers.searxng!.instances[0]).toEqual({ baseUrl: "https://old.example", allowRanges: ["10.1.2.3/32"] });
});
it("Exit and root Esc ask before leaving, and dirty global order survives Cancel/context changes", async () => {
  const f = await realWorkbench(); const before = await readFile(f.paths.config, "utf8");
  const commands = ["down", "return", "d", "]", "left", "end", "return", "return"];
  const views: ReturnType<Parameters<SetupTerminal["workbench"]>[0]>[] = [];
  const confirm = vi.spyOn(f.terminal, "confirm").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { views.push(get()); const name = commands.shift() ?? "escape"; return { name, sequence: name }; });
  await f.start(); f.terminal.close();
  expect(confirm.mock.calls.map(call => [call[1], call[2], call[3], call[4]])).toEqual([
    ["Exit setup", "Discard the order draft and exit?", "Discard", "Cancel"], ["Exit setup", "Discard the order draft and exit?", "Discard", "Cancel"]]);
  expect(views[4]!.cells).toEqual(views[3]!.cells); expect(views[4]!.providerIndex).toBe(1);
  expect(views.at(-1)!.route).toBe("order"); expect(views.at(-1)!.title).toContain("unsaved"); expect(await readFile(f.paths.config, "utf8")).toBe(before);
});
it("runs real replacement: field Enter does not write, confirmation Cancel returns draft, Ctrl-S still requires consent", async () => {
  const f = await realWorkbench(); await addSetupKey(f.paths, "exa", "fixture-before-replace", {});
  const running = f.start(); await pause(); await f.send("right"); await f.send("return");
  f.input.write("\r"); f.input.write("\x1b[H");
  for (const _ of "fixture-before-replace") f.input.write("\x1b[3~");
  f.input.write("fixture-after-replace"); f.input.write("\r"); await pause();
  expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "fixture-before-replace" });
  f.input.write("\x13"); await pause(220); await f.send("return");
  expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "fixture-before-replace" });
  expect(f.text()).toContain("21 characters");
  f.input.write("\x1b"); await pause(80); f.input.write("\r"); // default Cancel of dirty-form discard
  f.input.write("\x13"); await pause(220); await f.send("right"); await f.send("return");
  expect(await loadCredentialEnvironment(f.paths.credentials, {})).toEqual({ EXA_API_KEY: "fixture-after-replace" });
  expect(f.text()).not.toContain("fixture-before-replace"); expect(f.text()).not.toContain("fixture-after-replace");
  await f.send("escape"); await f.send("escape"); await running; f.terminal.close();
});
it("keeps newly drafted CIDRs through an invalid endpoint retry without inheriting old scope", async () => {
  const f = await realWorkbench("searxng"); await addSearxngInstance(f.paths.config, "https://old.example", ["10.1.2.3/32"]);
  const commands = ["right", "return", "escape", "escape"];
  vi.spyOn(f.terminal, "form").mockResolvedValueOnce(["invalid-url", "10.9.8.7/32"]).mockResolvedValueOnce(["https://new.example", "10.9.8.7/32"]);
  const consent = vi.spyOn(f.terminal, "confirm").mockResolvedValue(true);
  vi.spyOn(f.terminal, "workbench").mockImplementation(async () => ({ name: commands.shift() ?? "escape" }));
  await f.start(); f.terminal.close();
  expect(consent.mock.calls.filter(call => call[1] === "Network permission")).toHaveLength(1);
  expect((await loadConfig(f.paths.config)).providers.searxng!.instances[0]).toEqual({ baseUrl: "https://new.example", allowRanges: ["10.9.8.7/32"] });
});
it.each(["inherited", "edited"])("runs production page CIDR/endpoint validation retries with %s ranges", async kind => {
  const f = await realWorkbench("searxng"); await addSearxngInstance(f.paths.config, "https://old.example", ["10.1.2.3/32"]);
  const before = await readFile(f.paths.config, "utf8"); const form = vi.spyOn(f.terminal, "form");
  const running = f.start(); await pause(); await f.send("right"); await f.send("return");
  const replaceField = (old: string, next: string) => {
    f.input.write("\r"); f.input.write("\x1b[H"); for (const _ of old) f.input.write("\x1b[3~"); f.input.write(next); f.input.write("\r");
  };
  replaceField(form.mock.calls[0]![1].fields[0]!.value!, "invalid-url");
  if (kind === "edited") { f.input.write("\x1b[B"); replaceField("10.1.2.3/32", "10.9.8.7/32"); }
  expect(await readFile(f.paths.config, "utf8")).toBe(before);
  f.input.write("\x13"); await pause(220);
  expect(form.mock.calls.at(-1)![1]).toMatchObject({ presentation: "page", initialField: 0, fields: [{ value: "invalid-url" }, { value: kind === "edited" ? "10.9.8.7/32" : "10.1.2.3/32" }] });
  expect(form.mock.calls.at(-1)![1].error).toBeTruthy();
  replaceField("invalid-url", "https://new.example"); f.input.write("\x13"); await pause(220);
  if (kind === "edited") {
    await f.send("return"); // default-Cancel permission confirmation returns to draft
    expect(await readFile(f.paths.config, "utf8")).toBe(before);
    expect(form.mock.calls.at(-1)![1].fields.map(field => field.value)).toEqual(["https://new.example", "10.9.8.7/32"]);
    f.input.write("\x13"); await pause(220); await f.send("right"); await f.send("return");
  }
  expect((await loadConfig(f.paths.config)).providers.searxng!.instances[0]).toEqual({ baseUrl: "https://new.example", allowRanges: kind === "edited" ? ["10.9.8.7/32"] : [] });
  await f.send("escape"); await f.send("escape"); await running; f.terminal.close();
});
it("clips Chinese, combining and joined emoji by grapheme/cells", () => {
  expect(cellWidth("中e\u0301👩‍💻")).toBe(5);
  expect(clipCells("中e\u0301👩‍💻x", 5)).toBe("中e\u0301…");
});
