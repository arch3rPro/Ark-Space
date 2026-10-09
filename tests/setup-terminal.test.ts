import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { SetupTerminal, clipCells, cellWidth, type WorkbenchView } from "../src/cli/setup-terminal.js";

function terminalFixture(rows = 24, columns = 80) {
  const input = new PassThrough() as unknown as typeof process.stdin;
  const output = new PassThrough() as unknown as typeof process.stdout;
  Object.assign(input, { isTTY: true, isRaw: false, setRawMode: vi.fn((raw: boolean) => { Object.assign(input, { isRaw: raw }); return input; }) });
  Object.assign(output, { isTTY: true, rows, columns });
  const write = vi.spyOn(output, "write").mockReturnValue(true);
  const terminal = new SetupTerminal(input, output);
  const key = (name: string, extra = {}) => input.emit("keypress", "", { name, ...extra });
  return { input, output, write, terminal, key };
}
const snapshot = (): WorkbenchView => ({ providers: ["Exa", "Tavily", "Firecrawl", "SearXNG"], providerIndex: 0,
  menu: ["Providers", "Configuration", "Settings", "Exit"], menuCursor: 0, openedMenu: 0, route: "providers", language: "en", focus: "content", title: "Exa", summary: "Provider On",
  columns: ["Reference"], cells: Array.from({ length: 25 }, (_, i) => [`Key ${i + 1}`]), selected: 20,
  hints: [{ key: "a", label: "Add", tone: "success" }, { key: "Enter/e", label: "Edit", tone: "warning" }, { key: "Space", label: "Key on/off" }, { key: "d", label: "Remove", tone: "danger" }],
  status: "Ready", footer: "Tab panes · Esc back" });
const plain = (value: unknown) => String(value).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
it("owns alternate buffer, repaints selected metadata/resize and restores cursor/raw/listeners", async () => {
  const { input, output, write, terminal, key } = terminalFixture(); terminal.open();
  const view = snapshot(); const pending = terminal.workbench(() => view);
  expect(plain(write.mock.calls.at(-1)![0])).toContain("> Key 21");
  expect(plain(write.mock.calls.at(-1)![0])).not.toContain("Key 1\n");
  Object.assign(output, { rows: 16, columns: 60 }); output.emit("resize");
  expect(plain(write.mock.calls.at(-1)![0]).split("\n")).toHaveLength(16);
  key("up"); expect((await pending).name).toBe("up");
  expect(input.isRaw).toBe(false); expect(input.listenerCount("keypress")).toBe(0);
  expect(output.listenerCount("resize")).toBe(0); expect(input.listenerCount("end")).toBe(0);
  terminal.close(); terminal.close(); const text = write.mock.calls.map(c => c[0]).join("");
  expect(text).toContain("\u001b[?1049h"); expect(text).toContain("\u001b[?25h\u001b[?1049l");
  expect(text.match(/\[\?1049l/g)).toHaveLength(1);
});
it("wraps full partial-write recovery without losing the command in a bounded scrollable notice", async () => {
  const { write, terminal, key } = terminalFixture(16, 60); terminal.open();
  const recovery = "Local credential remains stored as env:EXA_API_KEY_1, but registration failed; recover with arks key add exa --env EXA_API_KEY_1.";
  const pending = terminal.notice(snapshot, "Recovery", recovery);
  const screen = plain(write.mock.calls.at(-1)![0]);
  const modalText = screen.split("\n").map(line => /^│ (.*?) │$/.exec(line.slice(2, 57))?.[1]?.replace(/ /g, "") ?? "").join("");
  expect(modalText).toContain(recovery.replace(/ /g, ""));
  expect(screen.split("\n")).toHaveLength(16);
  key("escape"); await pending; terminal.close();
});
it.each(["ctrl-c", "abort", "EOF"])("restores terminal ownership on %s", async mode => {
  const { input, output, terminal, key } = terminalFixture(); terminal.open(); const controller = new AbortController();
  const pending = terminal.workbench(snapshot, controller.signal);
  if (mode === "abort") controller.abort(); else if (mode === "EOF") input.emit("end"); else key("c", { ctrl: true });
  await expect(pending).rejects.toThrow("Setup cancelled."); terminal.close();
  expect(input.isRaw).toBe(false); expect(input.listenerCount("keypress")).toBe(0);
  expect(input.listenerCount("end")).toBe(0); expect(output.listenerCount("resize")).toBe(0);
});
it("restores raw mode/listeners and redacts render exceptions", async () => {
  const { input, output, write, terminal } = terminalFixture(); terminal.open();
  write.mockImplementationOnce(() => true).mockImplementationOnce(() => { throw new Error("Broken terminal secret"); });
  await expect(terminal.workbench(snapshot)).rejects.toThrow("Setup terminal I/O failed.");
  expect(input.isRaw).toBe(false); expect(input.listenerCount("keypress")).toBe(0); expect(output.listenerCount("resize")).toBe(0); terminal.close();
});
it("highlights the primary row, leaves hints nonfocusable and suppresses background focus in modals", async () => {
  const { write, terminal, key } = terminalFixture();
  const view = snapshot();
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const pending = terminal.workbench(() => view);
  const screen = String(write.mock.calls.at(-1)![0]);
  expect(screen).toContain("\x1b[30;46;1m> Key 21");
  expect(screen).toContain("a Add"); expect(screen).not.toContain("[Add]");
  key("escape"); await pending;
  const modal = terminal.confirm(() => view, "Remove", "Confirm?", "Delete");
  const background = String(write.mock.calls.at(-1)![0]);
  expect(background).not.toContain("\x1b[30;46;1m> Key 21");
  expect(background).toContain("\x1b[30;46;1m[Cancel]\x1b[0m");
  key("escape"); await modal;
  expect(cellWidth("\x1b[7m[中]\x1b[0m")).toBe(4);
  expect(plain(clipCells("\x1b[7m[中]long\x1b[0m", 5))).toBe("[中]…");
  vi.stubEnv("NO_COLOR", "1");
  const noColor = terminal.workbench(() => view);
  expect(String(write.mock.calls.at(-1)![0])).toContain("> Key 21");
  key("escape"); await noColor; vi.unstubAllEnvs();
});
it.each([[24, 80], [16, 60]])("makes focused Top tabs explicit in monochrome and keeps all providers visible at %sx%s", (rows, columns) => {
  vi.stubEnv("NO_COLOR", "1");
  const { terminal, write } = terminalFixture(rows, columns);
  terminal.render({ ...snapshot(), focus: "top", providerIndex: 1 });
  const screen = plain(write.mock.calls.at(-1)![0]);
  expect(screen.split("\n")[0]).toContain("*[Tavily]");
  for (const name of ["Exa", "Tavily", "Firecrawl", "SearXNG"]) expect(screen.split("\n")[0]).toContain(name);
  expect(screen.split("\n")[2]).toContain("Reference");
  expect(screen.split("\n").every(line => cellWidth(line) === columns - 1)).toBe(true);
  vi.unstubAllEnvs();
});
it("places provider status in the roomy header and falls back below the compact table", () => {
  const { terminal, write, output } = terminalFixture(24, 100);
  terminal.render(snapshot()); let screen = plain(write.mock.calls.at(-1)![0]);
  expect(screen.split("\n")[0]).toContain("Provider On");
  Object.assign(output, { rows: 16, columns: 60 });
  terminal.render({ ...snapshot(), summary: "Provider On · auto #1" }); screen = plain(write.mock.calls.at(-1)![0]);
  expect(screen).toContain("Provider On · auto #1");
  expect(screen.split("\n")[0]).toContain("SearXNG");
  expect(screen.split("\n")[2]).toContain("Reference");
});
it.each([60, 80, 90, 100])("fits service tabs at %s columns without moving summary or body and keeps the selected tab visible", columns => {
  vi.stubEnv("NO_COLOR", "1");
  const { terminal, write } = terminalFixture(24, columns);
  terminal.render({ ...snapshot(), focus: "top" });
  const baseline = plain(write.mock.calls.at(-1)![0]).split("\n");
  for (let providerIndex = 0; providerIndex < 5; providerIndex++) {
    const providers = [...snapshot().providers, "WeKnora"];
    terminal.render({ ...snapshot(), providers, providerIndex, focus: "top" });
    const lines = plain(write.mock.calls.at(-1)![0]).split("\n");
    expect(lines[0]).toContain(`*[${providers[providerIndex]}]`);
    if (columns === 80 || columns === 100) for (const name of providers) expect(lines[0]).toContain(`[${name}]`);
    expect(lines.slice(1)).toEqual(baseline.slice(1));
    expect(lines.every(line => cellWidth(line) === columns - 1)).toBe(true);
  }
  vi.unstubAllEnvs();
});
it("highlights the fifth service in color without losing its complete label", () => {
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const { terminal, write } = terminalFixture();
  terminal.render({ ...snapshot(), providers: [...snapshot().providers, "WeKnora"], providerIndex: 4, focus: "top" });
  expect(String(write.mock.calls.at(-1)![0])).toContain("\x1b[30;46;1;4m[WeKnora]");
  vi.unstubAllEnvs();
});
it("shows live grapheme masks/count and moves the caret through an editable horizontal window", async () => {
  const { input, output, write, terminal } = terminalFixture(16, 60);
  const pending = terminal.form(snapshot, { title: "Key", fields: [{ label: "API key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  const frame = () => plain(write.mock.calls.at(-2)![0]);
  expect(frame()).toContain("[] · 0 characters");
  input.write("Ae\u0301👩‍💻"); expect(frame()).toContain("[***] · 3 characters");
  input.write("\x1b[D"); const left = String(write.mock.calls.at(-1)![0]);
  input.write("\x7f"); expect(frame()).toContain("[**] · 2 characters");
  input.write("\x1b[H"); expect(String(write.mock.calls.at(-1)![0])).not.toBe(left);
  input.write("B"); input.write("\x1b[3~"); expect(frame()).toContain("[**] · 2 characters");
  input.write("\x1b[F"); input.write("x".repeat(8000));
  expect(frame()).toContain("8002 characters");
  expect(frame().split("\n").every(line => cellWidth(line) <= 59)).toBe(true);
  Object.assign(output, { columns: 80, rows: 24 }); output.emit("resize");
  input.write("\t"); input.write("\t"); input.write("\r");
  expect((await pending)?.[0]).toBe("B👩‍💻" + "x".repeat(8000));
  expect(write.mock.calls.map(c => c[0]).join("")).not.toContain("Ae\u0301👩‍💻");
});
it("previews masked by default and reveals only through Show full, then hides and closes", async () => {
  const { write, terminal, key } = terminalFixture();
  const pending = terminal.previewSecret(snapshot, { title: "Preview", sources: [{ label: "Local stored", value: "fixture-key-long-value" }, { label: "Effective environment", value: "shortkey" }], show: "Show full", hide: "Hide", close: "Close", length: "characters" });
  const screen = () => plain(write.mock.calls.at(-1)![0]);
  expect(screen()).toContain("Local stored"); expect(screen()).toContain("Effective environment");
  expect(screen()).not.toContain("fixture-key-long-value"); expect(screen()).not.toContain("shortkey");
  key("y"); key("up"); expect(screen()).not.toContain("fixture-key-long-value");
  key("left"); key("return"); expect(screen()).not.toContain("fixture-key-long-value");
  key("left"); key("return"); expect(screen()).toContain("fixture-key-long-value"); expect(screen()).toContain("shortkey");
  key("right"); key("return"); expect(screen()).not.toContain("fixture-key-long-value");
  key("left"); key("return"); expect(screen()).toContain("fixture-key-long-value");
  key("end"); key("return"); await pending;
  expect(plain(write.mock.calls.at(-2)![0])).not.toContain("fixture-key-long-value");
  const escaped = terminal.previewSecret(snapshot, { title: "Preview", sources: [{ label: "Local stored", value: "shortkey" }], show: "Show full", hide: "Hide", close: "Close", length: "characters" });
  key("home"); key("return"); expect(screen()).toContain("shortkey");
  key("escape"); await escaped;
  expect(plain(write.mock.calls.at(-2)![0])).not.toContain("shortkey");
});
it("requires a fresh explicit Show full after shrinking and restoring the preview", async () => {
  const { output, write, terminal, key } = terminalFixture();
  const pending = terminal.previewSecret(snapshot, { title: "Preview", sources: [{ label: "Local stored", value: "fixture-resize-secret" }], show: "Show full", hide: "Hide", close: "Close", length: "characters" });
  const screen = () => plain(write.mock.calls.at(-1)![0]);
  key("home"); key("return"); expect(screen()).toContain("fixture-resize-secret");
  Object.assign(output, { rows: 8, columns: 24 }); output.emit("resize"); expect(screen()).not.toContain("fixture-resize-secret");
  Object.assign(output, { rows: 16, columns: 60 }); output.emit("resize"); expect(screen()).not.toContain("fixture-resize-secret");
  key("return"); expect(screen()).toContain("fixture-resize-secret");
  key("escape"); await pending;
});
it("strips injected ANSI and controls from path notes and other metadata without removing internal focus styles", async () => {
  const { input, write, terminal, key } = terminalFixture();
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const poisoned = "\x1b[7mFAKE\x1b[0m\x1b[8mconceal\x1b[0m\x07";
  const pending = terminal.form(() => ({ ...snapshot(), title: poisoned, summary: poisoned, cells: [[poisoned]], selected: 0, status: poisoned, footer: poisoned, menu: [poisoned] }), {
    title: poisoned, fields: [{ label: poisoned, secret: true }], notes: `Plaintext storage: /fixture/${poisoned}/credentials.json`, save: poisoned, cancel: "Cancel", rejected: poisoned,
  });
  const screen = () => String(write.mock.calls.at(-2)![0]);
  expect(screen()).not.toContain("\x1b[7m"); expect(screen()).not.toContain("\x1b[8m"); expect(screen()).not.toContain("\x07");
  expect(screen()).toContain("/fixture/FAKEconceal/credentials.json"); expect(screen()).not.toContain("[7m");
  input.write("\t"); expect(String(write.mock.calls.at(-1)![0])).toContain("\x1b[30;46;1m[Cancel]\x1b[0m");
  input.write("\x1b"); await pending;
  const background = terminal.workbench(() => ({ ...snapshot(), cells: [[poisoned]], selected: 0, hints: [{ key: "a", label: "Add" }, { key: "e", label: poisoned }] }));
  expect(String(write.mock.calls.at(-1)![0])).toContain("\x1b[30;46;1m> FAKEconceal");
  expect(String(write.mock.calls.at(-1)![0])).not.toContain("\x1b[8m");
  key("escape"); await background; vi.unstubAllEnvs();
});
it("keeps an 8192-character mask usable on a 60×16 terminal through paste, edits and resize", async () => {
  const { input, output, write, terminal } = terminalFixture(16, 60);
  const pending = terminal.form(snapshot, { title: "Key", fields: [{ label: "API key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  input.write("\x1b[200~" + "x".repeat(8192) + "\x1b[201~");
  expect(plain(write.mock.calls.at(-2)![0])).toContain("8192 characters");
  input.write("\x1b[H"); input.write("\x1b[3~"); input.write("Q"); input.write("\x1b[F");
  Object.assign(output, { columns: 80, rows: 24 }); output.emit("resize");
  Object.assign(output, { columns: 60, rows: 16 }); output.emit("resize");
  expect(plain(write.mock.calls.at(-2)![0]).split("\n").every(line => cellWidth(line) <= 59)).toBe(true);
  input.write("\t"); input.write("\t"); input.write("\r"); expect(await pending).toEqual(["Q" + "x".repeat(8191)]);
  expect(write.mock.calls.map(c => c[0]).join("")).not.toContain("x".repeat(100));
});
it("distinguishes default text and explicit emoji presentation widths", () => {
  for (const text of ["▶", "◀", "©", "❤", "☀", "▶\ufe0e", "😀\ufe0e"]) expect(cellWidth(text), text).toBe(1);
  for (const emoji of ["😀", "▶\ufe0f", "❤\ufe0f", "1\ufe0f\u20e3", "1\u20e3", "👩‍💻", "🇨🇳"]) expect(cellWidth(emoji), emoji).toBe(2);
  expect(cellWidth("e\u0301")).toBe(1); expect(cellWidth("\ufe0e")).toBe(0);
  expect(clipCells("▶中x", 4)).toBe("▶中x");
});
it("renders typed semantic tones only after stripping metadata SGR", () => {
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const { terminal, write } = terminalFixture();
  terminal.render({ ...snapshot(), cells: [["enabled"], ["disabled"], ["cooldown"], ["missing\x1b[8m"]], selected: 0,
    rowTones: ["success", "danger", "warning", "muted"],
    focus: "menu", status: "saved", statusTone: "success", summaryTone: "danger" });
  const screen = String(write.mock.calls.at(-1)![0]);
  for (const [code, text] of [[32, "enabled"], [31, "disabled"], [33, "cooldown"], [90, "missing"]] as const) expect(screen).toContain(`\x1b[${code}m${text}`);
  expect(screen).toContain("\x1b[32ma Add\x1b[0m"); expect(screen).toContain("\x1b[31md Remove\x1b[0m");
  expect(screen).toContain("\x1b[32msaved\x1b[0m"); expect(screen).not.toContain("\x1b[8m"); vi.unstubAllEnvs();
});
it("dims unavailable hints without making them button targets and preserves their reasons", () => {
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const { terminal, write } = terminalFixture();
  terminal.render({ ...snapshot(), hints: [{ key: "Enter/e", label: "Edit", reason: "Read only", tone: "warning" }, { key: "V", label: "Provider on/off", reason: "External" }], status: "Read only · ! details" });
  const screen = String(write.mock.calls.at(-1)![0]);
  expect(screen).toContain("\x1b[90mEnter/e Edit\x1b[0m"); expect(screen).toContain("\x1b[90mV Provider on/off\x1b[0m");
  expect(screen).not.toContain("[Edit]"); expect(screen).not.toContain("×"); expect(plain(screen)).toContain("Read only"); vi.unstubAllEnvs();
});
it.each(["NO_COLOR", "dumb"])("retains disabled metadata and ASCII focus without SGR under %s", mode => {
  vi.stubEnv("NO_COLOR", mode === "NO_COLOR" ? "1" : ""); vi.stubEnv("TERM", mode === "dumb" ? "dumb" : "xterm");
  const { terminal, write } = terminalFixture();
  terminal.render({ ...snapshot(), hints: [{ key: "a", label: "Add", reason: "Read only", tone: "success" }], status: "Read only", statusTone: "warning" });
  const screen = String(write.mock.calls.at(-1)![0]);
  expect(screen).toContain("a Add"); expect(screen).not.toContain("[Add]"); expect(screen).toContain("Read only"); expect(screen).not.toContain("×"); expect(screen).not.toMatch(/\x1b\[[\d;]*m/); vi.unstubAllEnvs();
});
it("colors explicit modal accept and form Save independently of translated text", async () => {
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const { terminal, write, input, key } = terminalFixture();
  const confirmation = terminal.confirm(snapshot, "Delete", "Sure?", "删除", "取消", undefined, "danger");
  expect(String(write.mock.calls.at(-1)![0])).toContain("\x1b[31m[删除]\x1b[0m");
  key("escape"); await confirmation;
  const form = terminal.form(snapshot, { title: "Add", fields: [{ label: "Key", secret: true }], notes: "Storage warning", save: "保存", cancel: "取消", rejected: "Rejected" });
  expect(String(write.mock.calls.at(-2)![0])).toContain("\x1b[32m[保存]\x1b[0m");
  expect(String(write.mock.calls.at(-2)![0])).toContain("\x1b[33mStorage warning");
  input.write("\x1b"); await form;
  for (const [tone, code] of [["success", 32], ["warning", 33], ["danger", 31]] as const) {
    const notice = terminal.notice(snapshot, "Details", "Result", "Close", undefined, tone);
    expect(String(write.mock.calls.at(-1)![0])).toContain(`\x1b[${code}mResult\x1b[0m`);
    key("escape"); await notice;
  }
  vi.unstubAllEnvs();
});
it.each([[24, 80], [16, 60]])("boxes panes around the primary list and fits page hints at %sx%s", async (rows, columns) => {
  const { terminal, write, key } = terminalFixture(rows, columns);
  const view: WorkbenchView = { ...snapshot(), route: "order", hints: [{ key: "u/d", label: "Move" }, { key: "Del", label: "Remove" }, { key: "I", label: "Include" }, { key: "Ctrl-S", label: "Save" }] };
  terminal.render(view);
  const screen = plain(write.mock.calls.at(-1)![0]);
  expect(screen.split("\n")[0]).toContain("ArkSpace");
  expect(screen.split("\n")[1]).toContain("┌");
  expect(screen.split("\n")[2]).toContain("Reference");
  expect(screen).toContain("Ctrl-S Save");
  expect(terminal.pageSize).toBe(rows - 10);
  expect(screen.split("\n").every(line => cellWidth(line) === columns - 1)).toBe(true);
  const preview = terminal.previewSecret(() => view, { title: "Preview", sources: [{ label: "Local", value: "fixture-preview" }], show: "显示完整", hide: "隐藏", close: "关闭", length: "字符" });
  key("end"); expect(plain(write.mock.calls.at(-1)![0])).toContain("[关闭]");
  key("escape"); await preview;
});
it.each(["en", "zh"] as const)("renders sanitized real table cells with selection independent of state (%s)", language => {
  vi.stubEnv("NO_COLOR", ""); vi.stubEnv("TERM", "xterm");
  const { terminal, write } = terminalFixture(16, 60);
  const poison = "\x1b[8m";
  terminal.render({ ...snapshot(), language, selected: 0,
    columns: [language === "en" ? "Reference" : "引用", "Source" + poison, "Status"],
    cells: [["EXA_API_KEY" + poison, "local" + poison, "disabled" + poison]], rowTones: ["danger"] });
  const raw = String(write.mock.calls.at(-1)![0]); const screen = plain(raw);
  expect(screen).toContain("EXA_API_KEY"); expect(screen).toContain("disabled"); expect(screen).not.toContain("not a translated table");
  expect(raw).not.toContain(poison); expect(raw).toContain("\x1b[30;46;1m> EXA_API_KEY"); expect(raw).toContain("\x1b[40m\x1b[31m");
  expect(screen.split("\n")[2]).toContain(language === "en" ? "Reference" : "引用");
  expect(screen.split("\n").every(line => cellWidth(line) === 59)).toBe(true); vi.unstubAllEnvs();
});
it("opens read-only preview and confirmation help without disclosing or accepting", async () => {
  const { terminal, write, key } = terminalFixture(16, 60);
  const text = () => plain(write.mock.calls.at(-1)![0]);
  const preview = terminal.previewSecret(snapshot, { title: "Preview", sources: [{ label: "Local", value: "fixture-help-private" }], show: "Show full", hide: "Hide", close: "Close", length: "characters" });
  key("home"); key("?", { sequence: "?" }); expect(text()).toContain("Read-only preview"); expect(text()).not.toContain("fixture-help-private");
  key("escape"); expect(text()).toContain("[Show full]"); key("return"); expect(text()).toContain("fixture-help-private");
  key("?", { sequence: "?" }); expect(text()).not.toContain("fixture-help-private"); key("escape"); key("escape"); await preview;
  const confirm = terminal.confirm(snapshot, "Delete", "Sure?", "Delete");
  key("?", { sequence: "?" }); expect(text()).toContain("defaults to Cancel"); key("return"); key("return"); expect(await confirm).toBe(false);
});
it.each(["NO_COLOR", "dumb"])("keeps compact provider and order intents discoverable without button focus (%s)", mode => {
  vi.stubEnv("NO_COLOR", mode === "NO_COLOR" ? "1" : ""); vi.stubEnv("TERM", mode === "dumb" ? "dumb" : "xterm");
  const { terminal, write } = terminalFixture(16, 60);
  terminal.render({ ...snapshot(), hints: [{ key: "V", label: "Provider on/off" }, { key: "t", label: "Test provider" }] });
  expect(plain(write.mock.calls.at(-1)![0])).toContain("t Test provider");
  terminal.render({ ...snapshot(), hints: [{ key: "u/d", label: "移动" }, { key: "Del", label: "移除" }, { key: "I", label: "加入" }, { key: "Ctrl-S", label: "保存" }] });
  const raw = String(write.mock.calls.at(-1)![0]); expect(plain(raw)).toContain("Ctrl-S 保存"); expect(raw).not.toMatch(/\x1b\[[\d;]*m/); vi.unstubAllEnvs();
});
it("stages page fields, restores field edits and submits only through Ctrl-S", async () => {
  const { input, write, terminal } = terminalFixture(16, 60);
  const pending = terminal.form(snapshot, { presentation: "page", title: "Replace", fields: [{ label: "API key", secret: true, value: "seed" }], notes: "Storage warning", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  input.write("ignored"); input.write("\r"); input.write("[?qyn]"); input.write("\x1b");
  await new Promise(resolve => setTimeout(resolve, 80));
  input.write("\r"); input.write("X"); input.write("\r");
  expect(input.isRaw).toBe(true);
  const screen = plain(write.mock.calls.at(-1)![0]);
  expect(screen).toContain("[Save]"); expect(screen).toContain("[Cancel]");
  expect(screen).toContain("5 characters"); expect(screen).not.toContain("seed");
  input.write("\x13"); expect(await pending).toEqual(["seedX"]);
});
it("asks default-Cancel before discarding a dirty page, while field Esc restores only that field", async () => {
  const { input, terminal, write } = terminalFixture();
  const pending = terminal.form(snapshot, { presentation: "page", title: "URL", fields: [{ label: "URL", value: "seed" }, { label: "CIDRs", value: "10.0.0.1/32" }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  input.write("\r"); input.write("X"); input.write("\r"); input.write("\x1b[B");
  input.write("\r"); input.write("Y"); input.write("\x1b");
  await new Promise(resolve => setTimeout(resolve, 80));
  input.write("\x1b"); await new Promise(resolve => setTimeout(resolve, 80)); expect(plain(write.mock.calls.at(-1)![0])).toContain("Discard unsaved changes?");
  input.write("y"); input.write("\r"); expect(input.isRaw).toBe(true);
  input.write("\x13"); expect(await pending).toEqual(["seedX", "10.0.0.1/32"]);
  const second = terminal.form(snapshot, { presentation: "page", title: "URL", fields: [{ label: "URL" }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  input.write("\r"); input.write("draft"); input.write("\r"); input.write("\x1b"); await new Promise(resolve => setTimeout(resolve, 80)); input.write("\x1b[C"); input.write("\r");
  expect(await second).toBeUndefined(); expect(input.isRaw).toBe(false);
});
it("uses explicit page Save controls and commits active Ctrl-S after safe bounded paste", async () => {
  const { input, write, terminal } = terminalFixture(16, 60);
  const form = { presentation: "page" as const, title: "Key", fields: [{ label: "API key", secret: true }], notes: "Storage warning", save: "Save", cancel: "Cancel", rejected: "Rejected" };
  const pending = terminal.form(snapshot, form);
  input.write("\r"); input.write("\x1b[200~" + "x".repeat(8192) + "\x1b[201~");
  input.write("too much\r"); expect(plain(write.mock.calls.at(-2)![0])).toContain("Rejected");
  expect(plain(write.mock.calls.at(-2)![0])).toContain("8192 characters");
  const cursor = /\x1b\[(\d+);(\d+)H/.exec(String(write.mock.calls.at(-1)![0]))!;
  expect(Number(cursor[1])).toBe(4); expect(Number(cursor[2])).toBeGreaterThan(19); expect(Number(cursor[2])).toBeLessThan(59);
  await new Promise(resolve => setTimeout(resolve, 180));
  input.write("\x13"); expect(await pending).toEqual(["x".repeat(8192)]);
  const second = terminal.form(snapshot, form); input.write("\r"); input.write("[?qyn]"); input.write("\r");
  input.write("\t"); input.write("\x1b[C"); input.write("\r"); expect(await second).toEqual(["[?qyn]"]);
  expect(write.mock.calls.map(c => c[0]).join("")).not.toContain("x".repeat(100));
});
it("drains multiline page paste and queued save before allowing another submission", async () => {
  const { input, terminal, write } = terminalFixture();
  const pending = terminal.form(snapshot, { presentation: "page", title: "Key", fields: [{ label: "Key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  input.write("\r"); input.write("bad\nprivate"); input.write("\x13");
  await new Promise(resolve => setTimeout(resolve, 180)); expect(input.isRaw).toBe(true);
  expect(plain(write.mock.calls.at(-2)![0])).toContain("Rejected");
  input.write("safe"); input.write("\x13"); expect(await pending).toEqual(["safe"]);
});
it.each(["en", "zh"] as const)("shows every context/menu and page Save at 60×16 (%s)", language => {
  const { terminal, write, input } = terminalFixture(16, 60);
  const get = (): WorkbenchView => ({ ...snapshot(), language, providerIndex: 2,
    menu: language === "en" ? ["Providers", "Configuration", "Settings", "Exit"] : ["供应商", "配置", "设置", "退出"], focus: "menu" });
  terminal.render(get()); const screen = plain(write.mock.calls.at(-1)![0]);
  for (const name of [...get().providers, ...get().menu]) expect(screen).toContain(name);
  vi.stubEnv("NO_COLOR", "1"); terminal.render(get());
  expect(plain(write.mock.calls.at(-1)![0])).toContain("*[Firecrawl]"); vi.unstubAllEnvs();
  const pending = terminal.form(get, { presentation: "page", title: "Edit", fields: [{ label: "URL" }, { label: "CIDRs" }], notes: "warning\n".repeat(20), save: "Save", cancel: "Cancel", rejected: "Rejected" });
  const page = plain(write.mock.calls.at(-1)![0]);
  expect(page.split("\n")[12]).toContain("[Cancel] [Save]"); expect(page.split("\n").every(line => cellWidth(line) === 59)).toBe(true);
  input.write("\x1b"); return pending.then(result => expect(result).toBeUndefined());
});
it("consumes Tab in page field editing so Esc restores, and reverses button traversal with Shift-Tab", async () => {
  const { input, terminal, write } = terminalFixture();
  const pending = terminal.form(snapshot, { presentation: "page", title: "URL", fields: [{ label: "URL", value: "seed" }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  input.write("\r"); input.write("X"); input.write("\t"); input.write("\x1b[Z"); input.write("Y");
  expect(plain(write.mock.calls.at(-2)![0])).toContain("seedXY");
  input.write("\x1b"); await new Promise(resolve => setTimeout(resolve, 80)); expect(plain(write.mock.calls.at(-1)![0])).toContain("seed");
  expect(plain(write.mock.calls.at(-1)![0])).not.toContain("seedXY");
  input.write("\x1b[Z"); expect(String(write.mock.calls.at(-1)![0])).toContain("[Save]");
  input.write("\x1b[Z"); input.write("\r"); expect(await pending).toBeUndefined();
});
it("blocks Escape/discard tails until rejected page paste has been quiet", async () => {
  const { input, terminal, write } = terminalFixture(); const controller = new AbortController();
  let settled = false;
  const pending = terminal.form(snapshot, { presentation: "page", title: "Key", fields: [{ label: "Key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" }, controller.signal).finally(() => { settled = true; });
  try {
    input.write("\r"); input.write("safe"); input.write("\r"); input.write("\r"); input.write("bad\nprivate");
    input.write("\x1b"); input.write("\x1b"); input.write("\x1b[C"); input.write("\r");
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(settled).toBe(false); expect(write.mock.calls.map(call => plain(call[0])).join("\n")).not.toContain("Discard unsaved changes?");
    input.write("\x1b"); // extends the quiet period, not field cancellation
    await new Promise(resolve => setTimeout(resolve, 100)); input.write("\x13");
    await new Promise(resolve => setTimeout(resolve, 180)); expect(settled).toBe(false);
    input.write("\x13"); expect(await pending).toEqual(["safe"]);
  } finally { controller.abort(); await pending.catch(() => {}); }
});
it("joins fragmented page arrows and Shift-Tab without treating their Escape prefix as undo", async () => {
  const { input, terminal } = terminalFixture(); const controller = new AbortController();
  const pending = terminal.form(snapshot, { presentation: "page", title: "Key", fields: [{ label: "Key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" }, controller.signal);
  try {
    input.write("\r"); input.write("abc"); input.write("\x1b"); input.write("["); input.write("D"); input.write("X");
    input.write("\x1b"); input.write("[Z"); input.write("Y"); // ignored while editing
    input.write("\x13"); expect(await pending).toEqual(["abXYc"]);
  } finally { controller.abort(); await pending.catch(() => {}); }
});
it("holds a lone page Escape for 50ms, then restores only the field", async () => {
  const { input, terminal } = terminalFixture(); const controller = new AbortController();
  const pending = terminal.form(snapshot, { presentation: "page", title: "Key", fields: [{ label: "Key", value: "seed" }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" }, controller.signal);
  try {
    input.write("\r"); input.write("X"); input.write("\x1b");
    await new Promise(resolve => setTimeout(resolve, 20)); input.write("[D"); input.write("Y");
    input.write("\x1b"); await new Promise(resolve => setTimeout(resolve, 80));
    input.write("\x13"); expect(await pending).toEqual(["seed"]);
  } finally { controller.abort(); await pending.catch(() => {}); }
});
it("bounds fragmented page paste and rejects timed-out or unknown CSI without inserting controls", async () => {
  const { input, terminal, write } = terminalFixture(16, 60); const controller = new AbortController();
  const pending = terminal.form(snapshot, { presentation: "page", title: "Key", fields: [{ label: "Key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" }, controller.signal);
  try {
    input.write("\r"); input.write("\x1b"); input.write("[200~"); input.write("[?qyn]"); input.write("\x1b[201~");
    input.write("\x1b["); await new Promise(resolve => setTimeout(resolve, 80));
    input.write("\x13"); await new Promise(resolve => setTimeout(resolve, 180));
    expect(input.isRaw).toBe(true);
    input.write("\x1b[200~"); input.write("x".repeat(8193)); input.write("\x1b[201~"); input.write("\x13");
    await new Promise(resolve => setTimeout(resolve, 180)); expect(input.isRaw).toBe(true);
    input.write("\x1b[999~"); input.write("\x1b"); input.write("\r"); await new Promise(resolve => setTimeout(resolve, 180));
    input.write("\x13"); expect(await pending).toEqual(["[?qyn]"]);
    expect(write.mock.calls.map(call => call[0]).join("")).not.toContain("x".repeat(100));
  } finally { controller.abort(); await pending.catch(() => {}); }
});
it.each(["abort", "Ctrl-C", "EOF"])("cleans page sequence/drain timers and raw ownership on %s", async mode => {
  const { input, output, terminal, write } = terminalFixture(); const controller = new AbortController();
  const pending = terminal.form(snapshot, { presentation: "page", title: "Key", fields: [{ label: "Key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" }, controller.signal);
  input.write("\r"); input.write("\x1b[");
  if (mode === "abort") controller.abort(); else if (mode === "EOF") input.emit("end"); else input.write("\x03");
  await expect(pending).rejects.toThrow("Setup cancelled."); const count = write.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 220));
  expect(write.mock.calls).toHaveLength(count); expect(input.isRaw).toBe(false); expect(input.listenerCount("data")).toBe(0); expect(output.listenerCount("resize")).toBe(0);
});
it("rejects C0/paste payload in page discard mode before any following button input", async () => {
  const { input, terminal } = terminalFixture(); const controller = new AbortController(); let settled = false;
  const pending = terminal.form(snapshot, { presentation: "page", title: "Key", fields: [{ label: "Key", secret: true }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" }, controller.signal).finally(() => { settled = true; });
  try {
    input.write("\r"); input.write("draft"); input.write("\r"); input.write("\x1b"); await new Promise(resolve => setTimeout(resolve, 80));
    input.write("\x00bad\nprivate"); input.write("\x1b[C"); input.write("\r"); await new Promise(resolve => setTimeout(resolve, 180));
    expect(settled).toBe(false); input.write("\r"); input.write("\x13"); expect(await pending).toEqual(["draft"]);
  } finally { controller.abort(); await pending.catch(() => {}); }
});
it.each(["en", "zh"] as const)("keeps the 19-cell menu and stable half/quarter table budgets (%s)", language => {
  const { terminal, write, output } = terminalFixture();
  const menu = language === "en" ? snapshot().menu : ["供应商", "配置", "设置", "退出"];
  for (const columns of [80, 100, 120]) {
    Object.assign(output, { columns });
    const tableWidth = columns - 31; // frame, 19-cell menu, marker and two-space gaps
    const principalWidth = Math.floor(tableWidth / 2);
    const sourceWidth = Math.floor((tableWidth - principalWidth) / 2);
    const statusWidth = tableWidth - principalWidth - sourceWidth;
    const first = 24; const source = first + principalWidth + 2; const status = source + sourceWidth + 2;
    const url = "https://example.com/" + "long-path/".repeat(20);
    const view = { ...snapshot(), language, menu, selected: 0, hints: [],
      columns: ["URL", "Source", "Status"], cells: [[url, "local", "disabled"]] };
    for (const focus of ["content", "menu"] as const) {
      terminal.render({ ...view, focus });
      const rendered = plain(write.mock.calls.at(-1)![0]).split("\n");
      expect(cellWidth(rendered[2]!.slice(0, rendered[2]!.indexOf("│", 1) + 1))).toBe(19);
      for (const label of menu) expect(rendered.join("\n")).toContain(label);
      // Normalize only the menu's UTF-16 length; table assertions use cell offsets.
      const lines = rendered.map(line => line.replace(/^│.*?│/, " ".repeat(19)));
      expect(lines[2]!.slice(first, source)).toBe("URL".padEnd(principalWidth) + "  ");
      expect(lines[2]!.slice(source, status)).toBe("Source".padEnd(sourceWidth) + "  ");
      expect(lines[2]!.slice(status, status + statusWidth)).toBe("Status".padEnd(statusWidth));
      expect(sourceWidth).toBeGreaterThanOrEqual(Math.floor(tableWidth / 4));
      expect(statusWidth).toBeGreaterThanOrEqual(Math.floor(tableWidth / 4));
      expect(lines[3]!.slice(first, source)).toBe(clipCells(url, principalWidth).padEnd(principalWidth) + "  ");
      expect(lines[3]!.slice(source, status)).toBe("local".padEnd(sourceWidth) + "  ");
      expect(lines[3]!.slice(status, status + statusWidth)).toBe("disabled".padEnd(statusWidth));
      expect(lines.every(line => cellWidth(line) === columns - 1)).toBe(true);
      terminal.render({ ...view, focus, cells: [["reference", "environment override", "cooldown 120s"]] });
      const longLines = plain(write.mock.calls.at(-1)![0]).split("\n").map(line => line.replace(/^│.*?│/, " ".repeat(19)));
      expect(longLines[2]).toBe(lines[2]);
      expect(longLines[3]!.slice(source, status)).toBe(clipCells("environment override", sourceWidth).padEnd(sourceWidth) + "  ");
      expect(longLines[3]!.slice(status, status + statusWidth)).toBe(clipCells("cooldown 120s", statusWidth).padEnd(statusWidth));
      if (columns === 120) expect(longLines[3]).toContain("environment override");
      expect(longLines.every(line => cellWidth(line) === columns - 1)).toBe(true);
    }
    terminal.render({ ...view, columns: ["Setting", "Value"], cells: [["URL", "https://example.com/knowledge-base"]] });
    expect(plain(write.mock.calls.at(-1)![0])).toContain("URL      https://example.com/knowledge-base");
    terminal.render({ ...view, route: "order", columns: ["Provider", "Position", "Status"], cells: [["Firecrawl", "#3", "enabled"]] });
    expect(plain(write.mock.calls.at(-1)![0])).toMatch(/Firecrawl\s{2,}#3\s{2,}enabled/);
    terminal.render({ ...view, route: "language", columns: ["Language", "Status"], cells: [["English", "selected"]] });
    expect(plain(write.mock.calls.at(-1)![0])).toMatch(/English\s{2,}selected/);
    terminal.render({ ...view, route: "language", columns: ["Language"], cells: [["English"]] });
    expect(plain(write.mock.calls.at(-1)![0])).toContain("> English");
    terminal.render({ ...view, cells: [] });
    expect(plain(write.mock.calls.at(-1)![0])).toContain(language === "en" ? "No objects" : "无对象");
  }
});
it("keeps required Chinese two-column setting labels readable at 60 columns", () => {
  const { terminal, write } = terminalFixture(16, 60);
  const labels = ["API 根地址", "API 密钥", "默认知识库", "私有网络授权"];
  terminal.render({ ...snapshot(), language: "zh", menu: ["供应商", "配置", "设置", "退出"],
    columns: ["设置", "值"], cells: labels.map(label => [label, "value"]), selected: 0, hints: [] });
  const lines = plain(write.mock.calls.at(-1)![0]).split("\n");
  for (const label of labels) expect(lines.join("\n")).toContain(label);
  expect(cellWidth(lines[2]!.slice(0, lines[2]!.indexOf("│", 1) + 1))).toBe(19);
  expect(lines.every(line => cellWidth(line) === 59)).toBe(true);
});
it.each(["en", "zh"] as const)("aligns page form caret with its rendered field through resize (%s)", async language => {
  const { terminal, write, input, output } = terminalFixture(16, 60);
  const view = () => ({ ...snapshot(), language, menu: language === "en" ? snapshot().menu : ["供应商", "配置", "设置", "退出"] });
  const pending = terminal.form(view, { presentation: "page", title: "Edit", fields: [{ label: "URL", value: "https://example.com/" + "x".repeat(100) }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  try {
    input.write("\r");
    for (const columns of [60, 100, 80, 60]) {
      Object.assign(output, { columns, rows: columns === 60 ? 16 : 24 }); output.emit("resize");
      const lines = plain(write.mock.calls.at(-2)![0]).split("\n");
      const cursor = /\x1b\[(\d+);(\d+)H/.exec(String(write.mock.calls.at(-1)![0]))!;
      expect(Number(cursor[1])).toBe(4);
      expect(Number(cursor[2])).toBe(cellWidth(lines[3]!.slice(0, lines[3]!.indexOf("]"))) + 1);
      expect(lines.every(line => cellWidth(line) === columns - 1)).toBe(true);
      expect(cellWidth(lines[3]!.slice(0, lines[3]!.indexOf("│", 1) + 1))).toBe(19);
      expect(lines[3]).toContain("URL      │ > [");
    }
    input.write("\x13"); await pending;
  } finally { input.write("\x03"); await pending.catch(() => {}); }
});
it("keeps masked modal fields and caret aligned after supported resizes", async () => {
  const { input, output, write, terminal } = terminalFixture();
  const pending = terminal.form(snapshot, { title: "Key", fields: [{ label: "API key", secret: true, value: "fixture-only-secret" }], notes: "", save: "Save", cancel: "Cancel", rejected: "Rejected" });
  try {
    for (const columns of [60, 100, 80]) {
      Object.assign(output, { columns, rows: columns === 60 ? 16 : 24 }); output.emit("resize");
      const lines = plain(write.mock.calls.at(-2)![0]).split("\n");
      const cursor = /\x1b\[(\d+);(\d+)H/.exec(String(write.mock.calls.at(-1)![0]))!;
      const field = lines[Number(cursor[1]) - 1]!;
      expect(field).toContain("API key"); expect(field).toContain("19 characters");
      expect(Number(cursor[2])).toBe(cellWidth(field.slice(0, field.indexOf("]"))) + 1);
      expect(lines.every(line => cellWidth(line) === columns - 1)).toBe(true);
      expect(lines.join("\n")).not.toContain("fixture-only-secret");
    }
    input.write("\t"); input.write("\r"); expect(await pending).toBeUndefined();
  } finally { input.write("\x03"); await pending.catch(() => {}); }
});
it("does not send alternate-buffer sequences to a non-TTY", () => {
  const { input, write, terminal } = terminalFixture(); Object.assign(input, { isTTY: false });
  terminal.open(); terminal.clear("Ready"); terminal.close(); expect(write.mock.calls.map(c => c[0]).join("")).toBe("Ready\n");
});
