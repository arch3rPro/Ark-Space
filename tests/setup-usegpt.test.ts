import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { initializeConfig, loadConfig } from "../src/config/store.js";
import * as useGptConfig from "../src/config/usegpt.js";
import { loadUseGptConfig } from "../src/config/usegpt.js";
import { SetupUseGpt } from "../src/cli/setup-usegpt.js";
import { SetupTerminal, type WorkbenchView } from "../src/cli/setup-terminal.js";
import { runSetupWorkbench } from "../src/cli/setup-workbench.js";
import { runSetup } from "../src/cli/setup.js";

const { executeUseGpt } = vi.hoisted(() => ({ executeUseGpt: vi.fn() }));
vi.mock("../src/capabilities/usegpt.js", () => ({ executeUseGpt }));
const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); executeUseGpt.mockReset(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture(environment: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), "arks-setup-usegpt-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home }); await initializeConfig(paths.config);
  const terminal = new SetupTerminal(); const views: WorkbenchView[] = []; const commands = ["right", "e", "escape", "escape"];
  vi.spyOn(terminal, "workbench").mockImplementation(async get => { views.push(get()); return { name: commands.shift() ?? "escape" }; });
  const form = vi.spyOn(terminal, "form").mockResolvedValue(undefined);
  const confirm = vi.spyOn(terminal, "confirm").mockResolvedValue(true);
  const notice = vi.spyOn(terminal, "notice").mockResolvedValue();
  const busy = vi.spyOn(terminal, "busy").mockImplementation(async (_get, action) => action(new AbortController().signal));
  const run = () => runSetupWorkbench(paths, terminal, "en", { provider: "usegpt", environment });
  return { paths, terminal, views, commands, form, confirm, notice, busy, run, environment };
}
it("edits both addresses in one form and saves offline without storing a token", async () => {
  const f = await fixture({ ARKSPACE_USEGPT_TOKEN: "fixture-private-token" });
  f.form.mockResolvedValueOnce(["http://127.0.0.1:9333", "http://127.0.0.1:48888"]);
  await f.run();
  expect(f.views[0]!.title).toBe("UseGPT configuration");
  expect(f.form.mock.calls[0]![1].fields.map(field => field.value)).toEqual(["http://127.0.0.1:9222", "http://127.0.0.1:47832"]);
  expect(await loadUseGptConfig(f.paths)).toEqual({ enabled: true, cdpUrl: "http://127.0.0.1:9333", serviceUrl: "http://127.0.0.1:48888", tokenRef: "env:ARKSPACE_USEGPT_TOKEN" });
  expect(executeUseGpt).not.toHaveBeenCalled();
  await expect(readFile(f.paths.credentials)).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.stringify([f.views, f.form.mock.calls, f.notice.mock.calls, await readFile(f.paths.config, "utf8")])).not.toContain("fixture-private-token");
});
it.each([true, false])("live status requires explicit consent (%s) and never displays response bodies", async consent => {
  const f = await fixture({ ARKSPACE_USEGPT_TOKEN: "fixture-private-token" });
  f.form.mockResolvedValueOnce(["http://127.0.0.1:9222", "http://127.0.0.1:47832"]); await f.run();
  f.commands.push("right", "t", "i", "escape", "escape");
  f.confirm.mockImplementation(async (_get, title) => title !== "Check UseGPT status" || consent);
  executeUseGpt.mockResolvedValue({ protocolVersion: 1, capability: "usegpt.connection.status", connection: "usegpt", ok: true, data: { connected: true, authenticated: true, composerAvailable: true, secret: "fixture-private-token" }, warnings: ["fixture-private-token"] });
  await f.run();
  expect(f.busy).toHaveBeenCalledTimes(consent ? 1 : 0);
  if (consent) {
    expect(executeUseGpt).toHaveBeenCalledWith({ protocolVersion: 1, capability: "usegpt.connection.status", input: {} }, f.paths, f.environment, expect.any(AbortSignal));
    expect(f.confirm.mock.invocationCallOrder.at(-2)!).toBeLessThan(f.busy.mock.invocationCallOrder[0]!);
    expect(f.notice.mock.calls.map(call => call[2])).toContain("UseGPT is ready.");
  } else expect(executeUseGpt).not.toHaveBeenCalled();
  const body = f.notice.mock.calls.at(-1)![2];
  expect(body).toContain("Chrome 136"); expect(body).toContain("SSH"); expect(body).toContain("separate profile");
  expect(JSON.stringify([f.views, f.notice.mock.calls, f.form.mock.calls])).not.toContain("fixture-private-token");
});
it("unlink confirms and preserves tasks, profile, environment, and Web routing", async () => {
  const f = await fixture(); f.form.mockResolvedValueOnce(["http://127.0.0.1:9222", "http://127.0.0.1:47832"]); await f.run();
  const before = await loadConfig(f.paths.config);
  const taskFile = join(f.paths.home, "usegpt-tasks.json"); const profile = join(f.paths.home, "chrome-profile");
  await writeFile(taskFile, "fixture tasks"); await writeFile(profile, "fixture profile");
  f.commands.push("right", "d", "escape", "escape"); await f.run();
  expect((await loadConfig(f.paths.config)).connections?.usegpt).toBeUndefined();
  expect((await loadConfig(f.paths.config)).providerOrder).toEqual(before.providerOrder);
  expect(await readFile(taskFile, "utf8")).toBe("fixture tasks"); expect(await readFile(profile, "utf8")).toBe("fixture profile");
  expect(f.confirm.mock.calls.some(call => call[1] === "Unlink UseGPT configuration" && call[2].includes("Tasks and the Chrome profile"))).toBe(true);
});
it("invalid loopback addresses retry the whole form and cancellation leaves configuration untouched", async () => {
  const f = await fixture(); const before = await readFile(f.paths.config, "utf8");
  f.form.mockResolvedValueOnce(["http://192.168.1.2:9222", "http://127.0.0.1:47832"]).mockResolvedValueOnce(undefined);
  await f.run(); expect(f.form.mock.calls[1]![1].error).toContain("loopback");
  expect(await readFile(f.paths.config, "utf8")).toBe(before); expect(executeUseGpt).not.toHaveBeenCalled();
});
it.each([{}, { ARKSPACE_USEGPT_TOKEN: "fixture-private-token" }])("token row is read-only and offers no preview: %j", async environment => {
  const f = await fixture(environment); f.commands.splice(0, f.commands.length, "right", "down", "down", "e", "p", "escape", "escape");
  const preview = vi.spyOn(f.terminal, "previewSecret"); await f.run();
  expect(f.form).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  expect(f.views[0]!.cells[2]![1]).toContain(environment.ARKSPACE_USEGPT_TOKEN ? "configured" : "missing");
});
it("switches WeKnora/UseGPT contexts without replacing global routes or order drafts", async () => {
  const f = await fixture();
  f.commands.splice(0, f.commands.length, "[", "]", "down", "return", "d", "]", "[", "escape", "escape", "escape");
  await f.run();
  expect(f.views[0]!.providerIndex).toBe(5); expect(f.views[0]!.providers.at(-1)).toBe("UseGPT");
  expect(f.views[1]!.title).toContain("WeKnora"); expect(f.views[1]!.providerIndex).toBe(4);
  expect(f.views[7]!.route).toBe("order"); expect(f.views[7]!.title).toContain("unsaved");
  expect((await loadConfig(f.paths.config)).providerOrder).toEqual(["exa", "tavily", "firecrawl"]);
});
it("save failures retain a draft across contexts and confirmed discard clears it", async () => {
  const f = await fixture();
  vi.spyOn(useGptConfig, "saveUseGptConfig").mockRejectedValue(new Error("fixture-private-token"));
  f.form.mockResolvedValueOnce(["http://127.0.0.1:9333", "http://127.0.0.1:47832"]).mockResolvedValueOnce(undefined);
  f.commands.splice(0, f.commands.length, "right", "e", "[", "escape", "escape");
  await f.run();
  expect(f.confirm.mock.calls.at(-1)![2]).toBe("Discard unsaved drafts and exit?");
  expect(f.form.mock.calls[1]![1].error).toContain("Unable to save");
  expect(JSON.stringify(f.form.mock.calls)).not.toContain("fixture-private-token");
  expect((await loadConfig(f.paths.config)).connections?.usegpt).toBeUndefined();
  const page = new SetupUseGpt(f.paths, f.terminal, {}, () => "en");
  f.form.mockResolvedValueOnce(["http://127.0.0.1:9333", "http://127.0.0.1:47832"]).mockResolvedValueOnce(undefined);
  await page.act("edit", () => f.views[0]!);
  expect(page.hasDraft()).toBe(true); page.discardDraft(); expect(page.hasDraft()).toBe(false);
});
it.each([false, true])("runSetup routes UseGPT into workbench with injected=%s", async injected => {
  const f = await fixture(); const descriptors = [process.stdin, process.stdout].map(stream => Object.getOwnPropertyDescriptor(stream, "isTTY"));
  const views: WorkbenchView[] = []; const prompts = { askText: vi.fn(), askSecret: vi.fn(), askYesNo: vi.fn() };
  vi.spyOn(SetupTerminal.prototype, "open").mockImplementation(() => {}); vi.spyOn(SetupTerminal.prototype, "close").mockImplementation(() => {});
  vi.spyOn(SetupTerminal.prototype, "workbench").mockImplementation(async get => { views.push(get()); return { name: "escape" }; });
  vi.spyOn(SetupTerminal.prototype, "confirm").mockResolvedValue(true);
  try {
    for (const stream of [process.stdin, process.stdout]) Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
    await runSetup(f.paths, injected ? prompts : undefined, { provider: "usegpt", environment: {}, language: "en" });
    expect(views[0]!.title).toBe("UseGPT configuration"); expect(prompts.askText).not.toHaveBeenCalled(); expect(prompts.askSecret).not.toHaveBeenCalled();
  } finally {
    [process.stdin, process.stdout].forEach((stream, index) => { if (descriptors[index]) Object.defineProperty(stream, "isTTY", descriptors[index]!); else Reflect.deleteProperty(stream, "isTTY"); });
  }
});

