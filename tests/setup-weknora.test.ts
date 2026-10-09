import { mkdtemp, rm, readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { runSetup } from "../src/cli/setup.js";
import * as management from "../src/config/manage.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runSetupWorkbench } from "../src/cli/setup-workbench.js";
import { SetupWeknora } from "../src/cli/setup-weknora.js";
import { SetupTerminal, type WorkbenchView } from "../src/cli/setup-terminal.js";
import { initializeConfig, loadConfig } from "../src/config/store.js";
import { saveWeknoraConnection } from "../src/config/manage.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import * as verification from "../src/capabilities/weknora-verify.js";
const homes: string[] = [];

it.each([0, 1, 2])("empty setup edits only row %s and retains valid temporary values without files", async row => {
  const f = await fixture(); const before = await readFile(f.paths.config, "utf8");
  f.commands.splice(0, f.commands.length, "right", ...Array.from({ length: row }, () => "down"), "e", "]", "[", "e", "t", "escape", "escape");
  const value = ["https://kb.example/prefix/api/v1", "fixture-session-secret", "kb-temporary"][row]!;
  f.form.mockResolvedValueOnce([value]).mockResolvedValueOnce(undefined);
  const probe = vi.spyOn(verification, "executeWeknoraVerify"); await f.run();
  expect(f.form.mock.calls.map(call => call[1].fields.length)).toEqual([1, 1]);
  expect(f.form.mock.calls[1]![1].fields[0]!.value).toBe(value);
  expect(f.views.some(view => view.summary.includes("Draft") && view.summary.includes("add"))).toBe(true);
  expect(JSON.stringify(f.views)).not.toContain("fixture-session-secret"); expect(probe).not.toHaveBeenCalled();
  expect(await readFile(f.paths.config, "utf8")).toBe(before); await expect(readFile(f.paths.credentials)).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.confirm.mock.calls.at(-1)!.slice(2, 5)).toEqual(["Discard unsaved drafts and exit?", "Discard", "Cancel"]);
});
it("declined exit preserves temporary key and completing from the default row saves all values", async () => {
  const f = await fixture();
  f.commands.splice(0, f.commands.length, "right", "down", "e", "escape", "escape", "right", "up", "e", "down", "down", "e", "escape", "escape");
  f.form.mockResolvedValueOnce(["fixture-draft-key"]).mockResolvedValueOnce(["https://kb.example/api/v1"]).mockResolvedValueOnce(["kb-final"]);
  f.confirm.mockResolvedValueOnce(false).mockResolvedValue(true); await f.run();
  expect((await loadConfig(f.paths.config)).connections?.weknora).toMatchObject({ baseUrl: "https://kb.example/api/v1", defaultKnowledgeBaseId: "kb-final" });
  expect(JSON.stringify(f.views)).not.toContain("fixture-draft-key");
  expect(f.form.mock.calls.map(call => call[1].fields.length)).toEqual([1, 1, 1]);
  expect(f.form.mock.calls.map(call => call[1].save)).toEqual(["Keep temporarily", "Save", "Save"]);
});
it("leaving an empty optional field unchanged does not create a draft", async () => {
  const f = await fixture();
  f.commands.splice(0, f.commands.length, "right", "down", "down", "e", "escape", "escape");
  f.form.mockResolvedValueOnce([""]); await f.run();
  expect(f.confirm.mock.calls.at(-1)![2]).toBe("Exit setup?");
  expect((await loadConfig(f.paths.config)).connections?.weknora).toBeUndefined();
});
it("missing saved key keeps the saved address and saves the newly entered key", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1", defaultKnowledgeBaseId: "kb-saved" }, "fixture-lost", {}, {});
  await rm(f.paths.credentials); f.commands.splice(0, f.commands.length, "right", "down", "e", "escape", "escape"); f.form.mockResolvedValueOnce(["fixture-restored"]); await f.run();
  expect((await loadConfig(f.paths.config)).connections?.weknora).toMatchObject({ baseUrl: "https://kb.example/api/v1", defaultKnowledgeBaseId: "kb-saved" });
});
it.each(["temporary", "local", "environment", "override", "orphan", "malformed"])("preview reuses terminal disclosure with honest %s source and selected-row guard", async source => {
  const environment: NodeJS.ProcessEnv = source === "environment" ? { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "fixture-env" } : source === "override" ? { ARKSPACE_WEKNORA_API_KEY: "fixture-override" } : source === "malformed" ? { WEKNORA_API_KEY: "fixture-unpaired" } : {};
  const f = await fixture(environment); const { writeJsonAtomic } = await import("../src/io/json-store.js");
  if (source === "local" || source === "override") await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-local", {}, {});
  if (source === "orphan") await writeJsonAtomic(f.paths.credentials, { version: 1, values: { ARKSPACE_WEKNORA_API_KEY: "fixture-orphan" } });
  const preview = vi.spyOn(f.terminal, "previewSecret").mockResolvedValue();
  const page = new SetupWeknora(f.paths, f.terminal, environment, () => "en"); await page.refresh();
  if (source === "temporary") { f.form.mockResolvedValueOnce(["fixture-temporary"]); await page.act("edit", () => f.views[0]!, 1); }
  const save = vi.spyOn(management, "saveWeknoraConnection"); const probe = vi.spyOn(verification, "executeWeknoraVerify");
  await page.act("preview", () => f.views[0]!, 0); expect(preview).not.toHaveBeenCalled();
  expect(page.hints(0).some(h => h.key === "p")).toBe(false); expect(page.hints(1).some(h => h.key === "p")).toBe(true);
  await page.act("preview", () => f.views[0]!, 1);
  if (source === "orphan" || source === "malformed") expect(preview).not.toHaveBeenCalled();
  else {
    const sources = preview.mock.calls[0]![1].sources;
    expect(sources.map(s => s.value)).toEqual(source === "override" ? ["fixture-local", "fixture-override"] : [`fixture-${source === "environment" ? "env" : source}`]);
    expect(sources[0]!.label).toContain(source === "temporary" ? "not saved" : source === "environment" ? "Environment" : "Local");
  }
  expect(save).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
});
it("preview refreshes the original environment and never borrows a local orphan", async () => {
  const environment = { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "fixture-before" };
  const f = await fixture(environment); const { writeJsonAtomic } = await import("../src/io/json-store.js");
  await writeJsonAtomic(f.paths.credentials, { version: 1, values: { ARKSPACE_WEKNORA_API_KEY: "fixture-orphan" } });
  const preview = vi.spyOn(f.terminal, "previewSecret").mockResolvedValue(); const page = new SetupWeknora(f.paths, f.terminal, environment, () => "en");
  await page.refresh(); environment.WEKNORA_API_KEY = "fixture-after"; await page.act("preview", () => f.views[0]!, 1);
  expect(preview.mock.calls[0]![1].sources).toEqual([{ label: "Environment · WEKNORA_API_KEY", value: "fixture-after" }]);
  environment.WEKNORA_API_KEY = ""; await page.act("preview", () => f.views[0]!, 1); expect(preview).toHaveBeenCalledOnce();
});
it("temporary edits validate selected values before retaining them, and Ctrl-C exit never persists them", async () => {
  const f = await fixture(); const controller = new AbortController();
  f.commands.splice(0, f.commands.length, "right", "e", "down", "e");
  f.form.mockResolvedValueOnce(["https://kb.example"]).mockResolvedValueOnce(["https://kb.example/api/v1"]).mockImplementationOnce(async () => { controller.abort(); return undefined; });
  await expect(runSetupWorkbench(f.paths, f.terminal, "en", { provider: "weknora", environment: {}, signal: controller.signal })).rejects.toThrow("Setup cancelled.");
  expect(f.form.mock.calls[1]![1].error).toContain("Invalid");
  expect((await loadConfig(f.paths.config)).connections?.weknora).toBeUndefined(); await expect(readFile(f.paths.credentials)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["managed", "environment"])("legacy blocked-address outcome uses curated fallback without error bodies (%s)", async source => {
  const f = await fixture(source === "environment" ? { WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "fixture-env" } : {});
  if (source === "managed") await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-local", {}, {});
  f.commands.splice(0, f.commands.length, "right", "t", "escape", "escape");
  vi.spyOn(verification, "executeWeknoraVerify").mockResolvedValue({ protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: false, warnings: [], error: { kind: "blocked-address", message: "fixture-secret-error", retryable: false } });
  vi.spyOn(f.terminal, "busy").mockImplementation(async (_get, action) => action(new AbortController().signal)); await f.run();
  const body = f.notice.mock.calls.at(-1)![2];
  expect(body).toBe("Connection could not be verified; check the server configuration.");
  expect(body).not.toContain("fixture");
  expect(f.views.some(view => view.summary === "Connection test failed")).toBe(true);
});
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture(environment: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), "arks-setup-weknora-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home }); await initializeConfig(paths.config);
  const terminal = new SetupTerminal(); const views: WorkbenchView[] = [];
  const commands = ["right", "e", "escape", "escape"];
  vi.spyOn(terminal, "workbench").mockImplementation(async get => { views.push(get()); return { name: commands.shift() ?? "escape" }; });
  const form = vi.spyOn(terminal, "form").mockResolvedValue(undefined);
  const confirm = vi.spyOn(terminal, "confirm").mockResolvedValue(true);
  const notice = vi.spyOn(terminal, "notice").mockResolvedValue();
  const run = () => runSetupWorkbench(paths, terminal, "en", { provider: "weknora", environment });
  return { paths, terminal, views, commands, form, confirm, notice, run };
}
it("discovers the connection from Web and preserves global configuration routes", async () => {
  const f = await fixture(); const views: WorkbenchView[] = [];
  const commands = ["right", "w", "left", "down", "return", "]", "escape", "escape"];
  vi.spyOn(f.terminal, "workbench").mockImplementation(async get => { views.push(get()); const name = commands.shift() ?? "escape"; return { name, sequence: name }; });
  await runSetupWorkbench(f.paths, f.terminal, "en", { provider: "exa", environment: {} });
  expect(views[0]!.hints.some(h => h.key === "w" && h.label === "WeKnora")).toBe(true);
  expect(views[0]!.providers).toEqual(["Exa", "Tavily", "Firecrawl", "SearXNG", "WeKnora"]);
  expect(views[2]!.providerIndex).toBe(4);
  expect(views[2]!.title).toContain("WeKnora"); expect(views[5]!.route).toBe("order"); expect(views[6]!.route).toBe("order");
});
it("stages single fields and saves the complete pair without Web routing", async () => {
  const f = await fixture(); f.commands.splice(0, f.commands.length, "right", "e", "down", "down", "e", "up", "e", "escape", "escape");
  f.form.mockResolvedValueOnce(["https://kb.example/prefix/api/v1"]).mockResolvedValueOnce(["kb-offline"]).mockResolvedValueOnce(["fixture-private"]);
  const probe = vi.spyOn(verification, "executeWeknoraVerify"); await f.run();
  expect(f.views[0]!.title).toContain("WeKnora"); expect(f.views[0]!.hints.map(h => h.key)).not.toContain("v");
  expect(f.form.mock.calls.every(call => call[1].fields.length === 1)).toBe(true);
  expect(f.form.mock.calls[2]![1].fields[0]).toMatchObject({ secret: true, value: "" });
  expect((await loadConfig(f.paths.config)).connections?.weknora).toMatchObject({ baseUrl: "https://kb.example/prefix/api/v1", defaultKnowledgeBaseId: "kb-offline", allowRanges: [] });
  expect((await loadConfig(f.paths.config)).providerOrder).toEqual(["exa", "tavily", "firecrawl"]);
  expect(JSON.stringify(f.views)).not.toContain("fixture-private"); expect(probe).not.toHaveBeenCalled();
});
it("unchanged saves do not write or prompt, endpoint reuse asks separately", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://old.example/api/v1" }, "fixture-old", {}, {});
  const before = await readFile(f.paths.credentials, "utf8");
  const save = vi.spyOn(management, "saveWeknoraConnection");
  f.form.mockResolvedValueOnce(["https://old.example/api/v1"]); await f.run();
  expect(save).not.toHaveBeenCalled();
  expect(f.confirm.mock.calls.filter(call => call[1] !== "Exit setup")).toHaveLength(0);
  expect(await readFile(f.paths.credentials, "utf8")).toBe(before);
  f.commands.push("right", "e", "escape", "escape");
  f.form.mockResolvedValueOnce(["https://new.example/api/v1"]); await f.run();
  expect(f.confirm.mock.calls.some(call => call[1] === "Reuse saved key")).toBe(true);
  expect((await loadConfig(f.paths.config)).connections?.weknora?.allowRanges).toEqual([]);
});
it.each([{ WEKNORA_BASE_URL: "https://external.example/api/v1", WEKNORA_API_KEY: "fixture-external" }, { WEKNORA_BASE_URL: "" }, { ARKSPACE_WEKNORA_API_KEY: "fixture-conflict" }])("external sources and malformed pairs remain read-only without raw values: %j", async environment => {
  const f = await fixture(environment); await saveWeknoraConnection(f.paths, { baseUrl: "https://saved.example/api/v1" }, "fixture-local", {}, {});
  await f.run(); expect(f.form).not.toHaveBeenCalled(); expect(JSON.stringify(f.views)).not.toMatch(/fixture-(external|conflict|local)/);
  f.commands.push("right", "i", "escape", "escape"); await f.run();
  expect(f.notice.mock.calls.at(-1)![2].split("\n").length).toBeLessThanOrEqual(5);
  expect(f.notice.mock.calls.at(-1)![2]).toContain("read-only");
  f.commands.push("right", "n", "d", "escape", "escape"); await f.run();
  expect(f.form).not.toHaveBeenCalled(); expect((await loadConfig(f.paths.config)).connections?.weknora).toBeUndefined();
});
it("requires replacement consent and removes local only", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://old.example/api/v1" }, "fixture-old", {}, {});
  f.form.mockResolvedValueOnce(["fixture-new"]);
  f.commands.splice(0, f.commands.length, "right", "down", "e", "d", "escape", "escape"); await f.run();
  expect(f.confirm.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining(["Replace key", "Remove local connection"]));
  expect((await loadConfig(f.paths.config)).connections?.weknora).toBeUndefined();
});
it("declining network consent sends no request", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "http://kb.example/api/v1" }, "fixture-old", {}, {});
  f.commands.splice(0, f.commands.length, "right", "t", "escape", "escape");
  f.confirm.mockImplementation(async (_get, title) => title !== "Test connection");
  const probe = vi.spyOn(verification, "executeWeknoraVerify"); await f.run(); expect(probe).not.toHaveBeenCalled();
});
it("validation, declined reuse and partial errors retain a masked draft", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://old.example/api/v1" }, "fixture-old", {}, {});
  f.form.mockResolvedValueOnce(["bad"]).mockResolvedValueOnce(["https://new.example/api/v1"]).mockResolvedValueOnce(["https://new.example/api/v1"]).mockResolvedValueOnce(undefined);
  f.confirm.mockResolvedValueOnce(false).mockResolvedValue(true);
  vi.spyOn(management, "saveWeknoraConnection").mockRejectedValue(new ProviderError("Setup: Local credential remains stored as env:ARKSPACE_WEKNORA_API_KEY, but connection save failed; inspect local configuration before retrying.", { kind: "config" }));
  await f.run(); expect(f.form.mock.calls[1]![1].error).toContain("Invalid");
  expect(f.form.mock.calls[2]![1].fields[0]!.value).toBe("https://new.example/api/v1");
  expect(f.form.mock.calls[3]![1].error).toContain("credential remains stored as env:ARKSPACE_WEKNORA_API_KEY");
  expect(JSON.stringify(f.views)).not.toContain("fixture-old");
});
it.each([0, 1, 2])("edits selected row %s alone and preserves other fields", async row => {
  const f = await fixture();
  await saveWeknoraConnection(f.paths, { baseUrl: "https://old.example/api/v1", defaultKnowledgeBaseId: "kb-old" }, "fixture-old", {}, {});
  const save = vi.spyOn(management, "saveWeknoraConnection");
  f.commands.splice(0, f.commands.length, "right", ...Array.from({ length: row }, () => "down"), "return", "escape", "escape");
  f.form.mockResolvedValueOnce([["https://new.example/api/v1", "fixture-new", "kb-new"][row]!]);
  await f.run();
  expect(f.views[0]!.title).toBe("WeKnora configuration");
  expect(f.views[0]!.cells.map(cell => cell[0])).toEqual(["Required · API address", "Required · API key", "Optional · Default KB ID"]);
  expect(f.views[0]!.cells).toHaveLength(3);
  const fields = f.form.mock.calls[0]![1].fields;
  expect(fields).toHaveLength(1); expect(fields[0]!.value).toBe(["https://old.example/api/v1", "fixture-old", "kb-old"][row]);
  expect(fields[0]!.secret).toBe(row === 1 ? true : undefined);
  expect((await loadConfig(f.paths.config)).connections?.weknora).toMatchObject({ baseUrl: row === 0 ? "https://new.example/api/v1" : "https://old.example/api/v1", defaultKnowledgeBaseId: row === 2 ? "kb-new" : "kb-old" });
  expect(save.mock.calls[0]![2]).toBe(row === 1 ? "fixture-new" : undefined);
});
it.each([60, 80])("renders required/optional prefixes in real table cells at %s columns", async columns => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-old", {}, {}); await f.run();
  const output = new PassThrough() as unknown as typeof process.stdout; Object.assign(output, { rows: 24, columns, isTTY: true });
  const write = vi.spyOn(output, "write").mockReturnValue(true); const terminal = new SetupTerminal(new PassThrough() as unknown as typeof process.stdin, output);
  for (const language of ["en", "zh"] as const) {
    const connection = new SetupWeknora(f.paths, terminal, {}, () => language); await connection.refresh();
    terminal.render({ ...f.views[0]!, ...connection.page(), language });
    const screen = String(write.mock.calls.at(-1)![0]).replace(/\x1b\[[\d;?]*[A-Za-z]/g, "");
    expect(screen.match(new RegExp(language === "en" ? "Required ·" : "必填 ·", "g"))).toHaveLength(2);
    expect(screen.match(new RegExp(language === "en" ? "Optional ·" : "选填 ·", "g"))).toHaveLength(1);
    expect(screen).toContain(language === "en" ? "********" : "API密钥");
  }
});
it.each([60, 80])("renders distinct short form labels and required markers at %s columns", async columns => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-old", {}, {});
  const input = new PassThrough() as unknown as typeof process.stdin; const output = new PassThrough() as unknown as typeof process.stdout;
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: (raw: boolean) => { Object.assign(input, { isRaw: raw }); return input; } });
  Object.assign(output, { isTTY: true, rows: 24, columns }); const write = vi.spyOn(output, "write").mockReturnValue(true); const terminal = new SetupTerminal(input, output);
  for (const language of ["en", "zh"] as const) {
    f.form.mockClear(); f.commands.splice(0, f.commands.length, "right", "e", "down", "e", "escape", "escape");
    await runSetupWorkbench(f.paths, f.terminal, language, { provider: "weknora", environment: {} });
    const labels = language === "en" ? ["*API URL", "*API key", "KB ID"] : ["*API地址", "*API密钥", "默认库ID"];
    const full = f.form.mock.calls[0]![1]; expect(full.fields.map(field => field.label)).toEqual([labels[0]]);
    expect(full.notes).toContain("https://kb.example/api/v1");
    for (const spec of [full, f.form.mock.calls[1]![1]]) {
      const pending = terminal.form(() => ({ ...f.views[0]!, language }), spec);
      try {
        const screen = String(write.mock.calls.at(-1)![0]).replace(/\x1b\[[\d;?]*[A-Za-z]/g, "");
        for (const label of spec.fields.map(field => field.label)) expect(screen).toContain(label);
        expect(screen).not.toContain("fixture-old");
      } finally { input.write("\x1b"); await pending; terminal.close(); }
    }
  }
});
it.each(["en", "zh"] as const)("single-field titles and notes identify only the edited field (%s)", async language => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-old", {}, {});
  f.commands.splice(0, f.commands.length, "right", "e", "down", "e", "down", "e", "escape", "escape");
  await runSetupWorkbench(f.paths, f.terminal, language, { provider: "weknora", environment: {} });
  const [address, key, kb] = f.form.mock.calls.map(call => call[1]);
  const title = language === "en" ? "WeKnora configuration" : "WeKnora配置";
  expect(address!.title).toBe(`${title} · ${language === "en" ? "API address" : "API地址"}`);
  expect(key!.title).toBe(`${title} · ${language === "en" ? "API key" : "API密钥"}`);
  expect(kb!.title).toBe(`${title} · ${language === "en" ? "Default KB ID" : "默认知识库ID"}`);
  expect(address!.notes).toContain("/api/v1"); expect(address!.notes).not.toContain("HTTP");
  expect(key!.notes).toContain(f.paths.credentials); expect(key!.notes).toContain(language === "en" ? "press p" : "返回列表后按 p 预览");
  expect(kb!.notes).toContain(language === "en" ? "blank clears" : "留空清除");
  expect(address!.notes).not.toContain(f.paths.credentials); expect(address!.notes).not.toContain(language === "en" ? "knowledge base" : "知识库");
  expect(key!.notes).not.toContain("/api/v1"); expect(key!.notes).not.toContain(language === "en" ? "knowledge base" : "知识库");
  expect(kb!.notes).not.toContain("/api/v1"); expect(kb!.notes).not.toContain(f.paths.credentials);
});
it("opens only the selected required field for incomplete setup",  async () => {
  const f = await fixture(); f.commands.splice(0, f.commands.length, "right", "down", "e", "escape", "escape"); await f.run();
  const spec = f.form.mock.calls[0]![1]; expect(spec.fields).toHaveLength(1); expect(spec.initialField).toBe(0);
  expect(spec.fields.map(field => field.label)).toEqual(["*API key"]);
  expect(spec.save).toBe("Keep temporarily"); expect(f.views[0]!.cells[2]![1]).toContain("none");
});
it("n is unadvertised and inert, and private API edits need only saved-key reuse consent", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "http://127.0.0.1:8080/api/v1", defaultKnowledgeBaseId: "kb-old" }, "fixture-old", {}, {});
  const before = await readFile(f.paths.config, "utf8");
  const save = vi.spyOn(management, "saveWeknoraConnection"); const probe = vi.spyOn(verification, "executeWeknoraVerify");
  f.commands.splice(0, f.commands.length, "right", "n", "i", "escape", "escape"); await f.run();
  expect(f.views.every(view => !view.hints.some(h => h.key === "n"))).toBe(true);
  expect(f.form).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
  expect(await readFile(f.paths.config, "utf8")).toBe(before);
  const details = f.notice.mock.calls.at(-1)![2]; expect(details.split("\n").length).toBeLessThanOrEqual(5); expect(details).toContain("API address:"); expect(details).toContain(f.paths.credentials);
  f.confirm.mockClear();
  f.commands.push("right", "e", "escape", "escape"); f.form.mockResolvedValueOnce(["http://192.168.1.10:8080/api/v1"]); await f.run();
  expect(f.form).toHaveBeenCalledOnce(); expect(f.form.mock.calls[0]![1].fields).toHaveLength(1);
  expect(f.confirm.mock.calls.filter(call => call[1] !== "Exit setup").map(call => call[1])).toEqual(["Reuse saved key"]);
  expect(save).toHaveBeenCalledOnce(); expect(save.mock.calls[0]![3]).toEqual({ reuseSavedKey: true, replaceSavedKey: false });
  expect((await loadConfig(f.paths.config)).connections?.weknora).toMatchObject({ baseUrl: "http://192.168.1.10:8080/api/v1", defaultKnowledgeBaseId: "kb-old", allowRanges: [] });
  expect(probe).not.toHaveBeenCalled();
});
it("missing saved key edits only the key",  async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-old", {}, {});
  await rm(f.paths.credentials); f.commands.splice(0, f.commands.length, "right", "n", "down", "e", "escape", "escape"); await f.run();
  expect(f.form).toHaveBeenCalledOnce(); expect(f.form.mock.calls[0]![1]).toMatchObject({ initialField: 0 }); expect(f.form.mock.calls[0]![1].fields).toHaveLength(1);
});
it("Enter edits default alone without extra consent",  async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-old", {}, {});
  f.commands.splice(0, f.commands.length, "right", "down", "down", "e", "escape", "escape"); f.form.mockResolvedValueOnce(["kb-new"]); await f.run();
  expect(f.form.mock.calls[0]![1].fields).toEqual([{ label: "KB ID", value: "" }]);
  expect((await loadConfig(f.paths.config)).connections?.weknora).toMatchObject({ defaultKnowledgeBaseId: "kb-new", allowRanges: [] });
  expect(f.confirm.mock.calls.filter(call => call[1] !== "Exit setup")).toHaveLength(0);
});
it("Chinese configuration labels and brief details are human-readable", async () => {
  const f = await fixture(); f.commands.splice(0, f.commands.length, "right", "i", "escape", "escape");
  await runSetupWorkbench(f.paths, f.terminal, "zh", { provider: "weknora", environment: {} });
  expect(f.views[0]!.title).toBe("WeKnora配置");
  expect(f.views[0]!.cells.map(cell => cell[0])).toEqual(["必填 · API地址", "必填 · API密钥", "选填 · 默认知识库ID"]);
  expect(f.notice.mock.calls[0]![2].split("\n").length).toBeLessThanOrEqual(5);
  expect(f.views[0]!.hints.some(h => h.key === "n")).toBe(false);
});
it("unchanged shared keys support single-field KB edits without rewriting credentials", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-shared", {}, {});
  await management.addSetupKey(f.paths, "exa", "fixture-other", {});
  const { writeJsonAtomic } = await import("../src/io/json-store.js");
  const config = await loadConfig(f.paths.config); config.providers.exa!.keyRefs.push("env:ARKSPACE_WEKNORA_API_KEY"); await writeJsonAtomic(f.paths.config, config);
  const before = await readFile(f.paths.credentials, "utf8");
  f.commands.splice(0, f.commands.length, "right", "down", "down", "e", "escape", "escape"); f.form.mockResolvedValueOnce(["kb-shared"]); await f.run();
  expect(await readFile(f.paths.credentials, "utf8")).toBe(before); expect((await loadConfig(f.paths.config)).connections?.weknora?.defaultKnowledgeBaseId).toBe("kb-shared");
  f.commands.push("right", "down", "e", "d", "escape", "escape"); f.form.mockResolvedValueOnce(["fixture-replacement"]).mockResolvedValueOnce(undefined); await f.run();
  expect(f.notice.mock.calls.at(-1)![2]).toContain("shared"); expect(await readFile(f.paths.credentials, "utf8")).toBe(before);
  expect((await loadConfig(f.paths.config)).connections?.weknora).toBeUndefined();
});
it("non-TTY WeKnora setup accepts the service without requesting secrets", async () => {
  const f = await fixture(); const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    await runSetup(f.paths, undefined, { provider: "weknora", environment: {} });
    expect(output.mock.calls.map(call => String(call[0])).join("")).toContain("not an interactive terminal");
    expect((await loadConfig(f.paths.config)).connections).toBeUndefined();
  } finally { if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor); else Reflect.deleteProperty(process.stdin, "isTTY"); }
});
it.each(["save", "cancel-form", "cancel-probe"])("native WeKnora %s keeps secrets masked and restores terminal ownership", async mode => {
  const f = await fixture();
  const input = new PassThrough() as unknown as typeof process.stdin; const output = new PassThrough() as unknown as typeof process.stdout;
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: (raw: boolean) => { Object.assign(input, { isRaw: raw }); return input; } });
  Object.assign(output, { isTTY: true, rows: 24, columns: 80 });
  const writes = vi.spyOn(output, "write").mockReturnValue(true); const terminal = new SetupTerminal(input, output); terminal.open();
  const commands = ["right", mode === "cancel-probe" ? "t" : "e", "escape", "escape"];
  vi.spyOn(terminal, "workbench").mockImplementation(async get => { terminal.render(get()); return { name: commands.shift() ?? "escape" }; });
  vi.spyOn(terminal, "confirm").mockResolvedValue(true); vi.spyOn(terminal, "notice").mockResolvedValue();
  const form = vi.spyOn(terminal, "form"); const controller = new AbortController();
  let activeProbe = false;
  if (mode !== "cancel-probe") await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-native-secret", {}, {});
  if (mode === "cancel-probe") {
    await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-native-secret", {}, {});
    vi.spyOn(verification, "executeWeknoraVerify").mockImplementation(async (_request, _paths, _env, signal) => {
      activeProbe = true; await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
      return { protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: false, warnings: [], error: { kind: "cancelled", message: "Cancelled", retryable: false } };
    });
  }
  const running = runSetupWorkbench(f.paths, terminal, "en", { provider: "weknora", environment: {}, signal: controller.signal });
  try {
    if (mode === "cancel-probe") { await vi.waitFor(() => expect(activeProbe).toBe(true)); input.emit("keypress", "", { name: "escape" }); }
    else {
      await vi.waitFor(() => expect(form).toHaveBeenCalledOnce());
      input.write("\r"); for (const _ of "https://kb.example/api/v1") input.write("\x7f"); input.write("https://new.example/api/v1"); input.write("\r");
      if (mode === "save") input.write("\x13");
      else { input.write("\x1b"); await new Promise(resolve => setTimeout(resolve, 80)); input.write("\x1b[C"); input.write("\r"); }
    }
    await running;
    expect(writes.mock.calls.map(call => String(call[0])).join("")).not.toContain("fixture-native-secret");
    expect((await loadConfig(f.paths.config)).connections?.weknora?.baseUrl).toBe(mode === "save" ? "https://new.example/api/v1" : "https://kb.example/api/v1");
    expect(input.isRaw).toBe(false); if (mode !== "cancel-probe") expect(input.listenerCount("data")).toBe(0); expect(input.listenerCount("keypress")).toBe(0); expect(output.listenerCount("resize")).toBe(0);
  } finally { controller.abort(); await running.catch(() => {}); terminal.close(); }
});
it("WeKnora preview defaults masked, reveals and hides explicitly, and closes without retaining display", async () => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-preview-secret", {}, {}); await f.run();
  const input = new PassThrough() as unknown as typeof process.stdin; const output = new PassThrough() as unknown as typeof process.stdout;
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: (raw: boolean) => { Object.assign(input, { isRaw: raw }); return input; } }); Object.assign(output, { isTTY: true, rows: 24, columns: 80 });
  const writes = vi.spyOn(output, "write").mockReturnValue(true); const terminal = new SetupTerminal(input, output); terminal.open();
  const page = new SetupWeknora(f.paths, terminal, {}, () => "en");
  const screen = () => String(writes.mock.calls.at(-1)![0]);
  try {
    for (let round = 0; round < 2; round++) {
      const preview = page.act("preview", () => f.views[0]!, 1);
      await vi.waitFor(() => expect(input.listenerCount("keypress")).toBe(1));
      expect(screen()).not.toContain("fixture-preview-secret");
      input.emit("keypress", "", { name: "home" }); input.emit("keypress", "", { name: "return" }); expect(screen()).toContain("fixture-preview-secret");
      input.emit("keypress", "", { name: "right" }); input.emit("keypress", "", { name: "return" }); expect(screen()).not.toContain("fixture-preview-secret");
      input.emit("keypress", "", { name: "escape" }); await preview; expect(screen()).not.toContain("fixture-preview-secret");
    }
    expect(JSON.stringify(f.views)).not.toContain("fixture-preview-secret"); expect(input.listenerCount("keypress")).toBe(0);
  } finally { terminal.close(); }
});
it.each(["en", "zh"] as const)("test outcomes distinguish authentication from permission and do not imply retrieval rights (%s)", async language => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "https://kb.example/api/v1" }, "fixture-local", {}, {});
  f.commands.splice(0, f.commands.length, "right", "t", "t", "t", "escape", "escape");
  vi.spyOn(verification, "executeWeknoraVerify")
    .mockResolvedValueOnce({ protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: false, warnings: [], error: { kind: "auth", status: 401, message: "fixture-body", retryable: false } })
    .mockResolvedValueOnce({ protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: false, warnings: [], error: { kind: "permission", status: 403, message: "fixture-body", retryable: false } })
    .mockResolvedValueOnce({ protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: true, source: "managed", warnings: [], data: { outcome: "accepted", status: 200 } });
  vi.spyOn(f.terminal, "busy").mockImplementation(async (_get, action) => action(new AbortController().signal));
  await runSetupWorkbench(f.paths, f.terminal, language, { provider: "weknora", environment: {} });
  expect(f.notice.mock.calls.map(call => call[2])).toEqual(language === "en" ? ["Authentication failed; check the API key.", "Server denied access; check account permissions.", "Connection verified"] : ["身份验证失败，请检查API密钥。", "服务器拒绝访问，请检查账号权限。", "连接验证通过"]);
  expect(JSON.stringify(f.notice.mock.calls)).not.toContain("fixture-body");
});
it.each(["en", "zh"] as const)("HTTP probe needs only network consent, has no fee warning and reports classified evidence (%s)", async language => {
  const f = await fixture(); await saveWeknoraConnection(f.paths, { baseUrl: "http://127.0.0.1:8080/api/v1" }, "fixture-old", {}, {});
  f.commands.splice(0, f.commands.length, "right", "t", "escape", "escape");
  const probe = vi.spyOn(verification, "executeWeknoraVerify").mockResolvedValue({ protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: false, warnings: [], error: { kind: "permission", message: "fixture-remote-body", retryable: false, status: 403 } });
  vi.spyOn(f.terminal, "busy").mockImplementation(async (_get, action) => action(new AbortController().signal));
  await runSetupWorkbench(f.paths, f.terminal, language, { provider: "weknora", environment: {} });
  expect(f.confirm.mock.calls.filter(call => call[1] !== (language === "en" ? "Exit setup" : "退出设置")).map(call => call[1])).toEqual([language === "en" ? "Test connection" : "测试连接"]);
  expect(JSON.stringify(f.confirm.mock.calls)).not.toMatch(/fees|billing|费用|收费|Plaintext HTTP|明文 HTTP/);
  expect(probe.mock.calls[0]![0]).toEqual({ protocolVersion: 1, capability: "weknora.connection.verify", input: { confirmed: true, timeoutMs: 5000 } });
  expect(f.notice.mock.calls.at(-1)![2]).toContain(language === "en" ? "permissions" : "权限"); expect(JSON.stringify(f.notice.mock.calls)).not.toContain("fixture-");
});
