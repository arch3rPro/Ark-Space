import process from "node:process";
import { createInterface, emitKeypressEvents, type Key } from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (value: string) => [...segmenter.segment(value)].map(part => part.segment);
function graphemeWidth(value: string): number {
  if (/^[\p{Mark}\u200d]+$/u.test(value)) return 0;
  const point = value.codePointAt(0)!;
  // Common terminal presentation, not a promise about every font. Structural focus uses ASCII.
  const emoji = !value.includes("\ufe0e") && (/\p{Emoji_Presentation}|\p{Regional_Indicator}/u.test(value) ||
    /[#*0-9]\ufe0f?\u20e3/u.test(value) || /\p{Extended_Pictographic}/u.test(value) && /[\ufe0f\u200d]/u.test(value));
  return emoji || (point >= 0x1100 && (
    point <= 0x115f || point === 0x2329 || point === 0x232a || point >= 0x2e80 && point <= 0xa4cf ||
    point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff ||
    point >= 0xfe10 && point <= 0xfe6f || point >= 0xff00 && point <= 0xff60 || point >= 0x20000)) ? 2 : 1;
}
const sgr = /\u001b\[[0-9;]*m/g;
// Metadata is plain text; only renderer-owned semantic/focus/accent helpers introduce SGR styling.
const clean = (value: string) => stripVTControlCharacters(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
const tokens = (value: string) => value.split(/(\u001b\[[0-9;]*m)/).flatMap(part => /^\u001b\[[0-9;]*m$/.test(part) ? [part] : graphemes(clean(part)));
const tokenWidth = (part: string) => part.startsWith("\u001b") ? 0 : graphemeWidth(part);
export const cellWidth = (value: string) => graphemes(value.replace(sgr, "")).reduce((sum, part) => sum + graphemeWidth(part), 0);
export function clipCells(value: string, width: number): string {
  if (width <= 0) return "";
  const parts = tokens(value); const clipped = parts.reduce((sum, part) => sum + tokenWidth(part), 0) > width;
  let result = ""; let used = 0;
  for (const part of parts) { const size = tokenWidth(part); if (used + size > width - (clipped ? 1 : 0)) break; result += part; used += size; }
  return result + (clipped ? "…" : "") + (result.includes("\u001b") ? "\u001b[0m" : "");
}
function pad(value: string, width: number) { const clipped = clipCells(value, width); return clipped + " ".repeat(Math.max(0, width - cellWidth(clipped))); }
function wrapCells(value: string, width: number): string[] {
  return value.split("\n").flatMap(line => {
    const rows: string[] = []; let row = ""; let used = 0;
    for (const part of tokens(line)) { const size = tokenWidth(part); if (used + size > width) { rows.push(row); row = ""; used = 0; } row += part; used += size; }
    return [...rows, row];
  });
}
export type SetupTone = "neutral" | "success" | "danger" | "warning" | "info" | "muted";
const palette: Record<SetupTone, string> = { neutral: "", success: "32", danger: "31", warning: "33", info: "36", muted: "90" };
const providerAccents: Record<string, { foreground: number; background: number; text: number }> = {
  Exa: { foreground: 34, background: 44, text: 37 }, Tavily: { foreground: 35, background: 45, text: 30 },
  Firecrawl: { foreground: 33, background: 43, text: 30 }, SearXNG: { foreground: 32, background: 42, text: 30 },
};
export type SetupFocus = "top" | "menu" | "content";
export type SetupRoute = "providers" | "order" | "language";
export interface SetupHint { key: string; label: string; reason?: string; tone?: SetupTone }
/** Browse has three focus regions and one primary list. Hints are never controls. */
export interface WorkbenchView {
  providers: readonly string[]; providerIndex: number;
  menu: readonly string[]; menuCursor: number; openedMenu: number;
  route: SetupRoute; focus: SetupFocus; language: "en" | "zh";
  title: string; summary: string; summaryTone?: SetupTone;
  columns: string[]; cells: string[][]; rowTones?: SetupTone[]; selected: number;
  hints: SetupHint[]; status: string; statusTone?: SetupTone; footer: string;
}
export function setupFocusHelp(focus: SetupFocus, language: WorkbenchView["language"]): string {
  if (focus === "top") return language === "zh" ? "顶部 · ←→ 切换供应商 · ↓ 内容 · Tab 菜单 · ?" : "Top · ←→ switch provider · ↓ Content · Tab Menu · ?";
  if (focus === "menu") return language === "zh" ? "菜单 · ↑↓ 选择 · Enter 打开 · → 内容 · Shift-Tab 顶部 · ?" : "Menu · ↑↓ move · Enter open · → Content · Shift-Tab Top · ?";
  return language === "zh" ? "内容 · ↑↓ 选行 · ← 菜单 · Tab 顶部 · Esc · ?" : "Content · ↑↓ rows · ← Menu · Tab Top · Esc · ?";
}
export interface SetupForm {
  presentation?: "page"; dirty?: boolean; error?: string; initialField?: number;
  title: string; fields: { label: string; secret?: boolean; value?: string }[];
  notes: string; save: string; cancel: string; rejected: string;
}

export interface SecretPreview {
  title: string; sources: { label: string; value: string }[];
  show: string; hide: string; close: string; length: string;
}

/** Bounded terminal ownership for the human setup command only. */
export class SetupTerminal {
  private active = false;
  private helpOpen = false;
  constructor(private readonly input = process.stdin, private readonly output = process.stdout) {}
  open() {
    if (!this.input.isTTY || !this.output.isTTY || this.active) return;
    this.active = true;
    this.output.write("\u001b[?1049h\u001b[2J\u001b[H");
  }
  clear(content = "") {
    this.output.write(`${this.active ? "\u001b[2J\u001b[H" : ""}${content}${content ? "\n" : ""}`);
  }
  close() {
    if (!this.active) return;
    this.active = false;
    this.output.write("\u001b[?25h\u001b[?1049l");
  }
  // Conservative browse viewport, including the wrapped compact page hints.
  get pageSize() { return Math.max(1, (this.output.rows || 24) - 10); }
  private get modalBodyWidth() { return Math.min((this.output.columns || 80) - 5, 68) - 4; }
  private get small() { return (this.output.columns || 80) < 60 || (this.output.rows || 24) < 16; }
  render(view: WorkbenchView) { this.paint(view); }
  private get colors() { return !process.env.NO_COLOR && process.env.TERM !== "dumb"; }
  private tone(text: string, tone: SetupTone = "neutral") {
    return this.colors && palette[tone] ? `\u001b[${palette[tone]}m${text}\u001b[0m` : text;
  }
  private button(label: string, focused: boolean, tone: SetupTone = "neutral", disabled = false) {
    const text = `[${clean(label)}]`;
    if (!this.colors) return focused ? `>${text}<` : text;
    if (disabled) return `\u001b[90;2${focused ? ";4" : ""}m${text}\u001b[0m`;
    return focused ? `\u001b[30;46;1m${text}\u001b[0m` : this.tone(text, tone);
  }
  /** Window whole controls around the current action; never truncate a keycap. */
  private buttonBar(items: string[], selected: number, width: number, help = true) {
    const more = help ? "[?]" : "";
    if (!items.length) return more;
    if (cellWidth(items.join(" ") + (help ? " " + more : "")) <= width) return items.join(" ") + (help ? " " + more : "");
    let start = Math.max(0, Math.min(selected, items.length - 1)); let end = start + 1;
    const fits = (a: number, b: number) => cellWidth(items.slice(a, b).join(" ") + " " + more) <= width;
    while (start > 0 && fits(start - 1, end)) start--;
    while (end < items.length && fits(start, end + 1)) end++;
    return items.slice(start, end).join(" ") + (more ? " " + more : "");
  }
  private border(text: string, focused: boolean) {
    return this.colors ? `\u001b[${focused ? "1;36" : "90"}m${text}\u001b[0m` : text;
  }
  private selection(text: string, focused: boolean) {
    return focused && this.colors ? `\u001b[30;46;1m${text.replace(/\u001b\[0m/g, "\u001b[30;46;1m")}\u001b[0m` : text;
  }
  private frame(lines: string[], width: number) {
    this.output.write("\u001b[2J\u001b[H" + lines.map(line => clipCells(line, width)).join("\n"));
  }
  private paint(view: WorkbenchView, modal?: { title: string; body: string[]; footer: string; help?: string[]; tone?: SetupTone; bodyTones?: SetupTone[]; offset?: number; page?: boolean; cursor?: { row: number; column: number } }) {
    view = { ...view, title: clean(view.title), summary: clean(view.summary),
      providers: view.providers.map(clean), menu: view.menu.map(clean), columns: view.columns.map(clean),
      cells: view.cells.map(row => row.map(clean)), hints: view.hints.map(hint => ({ ...hint, key: clean(hint.key), label: clean(hint.label), reason: clean(hint.reason ?? "") })),
      status: clean(view.status), footer: clean(view.footer) };
    if (this.helpOpen && modal) modal = { title: view.language === "zh" ? "帮助" : "Help", body: modal.help ?? [], footer: this.button(view.language === "zh" ? "关闭" : "Close", true) };
    const width = Math.max(1, (this.output.columns || 80) - 1); const height = Math.max(1, this.output.rows || 24);
    let lines: string[] = [];
    if (this.small) lines = view.language === "zh" ? ["窗口过小", "请扩大至 60×16", "Esc 返回 · Ctrl-C 退出"] : ["Window too small", "Enlarge to 60×16", "Esc back · Ctrl-C exit"];
    else {
      const compact = width < 79; const leftWidth = 19; const mainWidth = width - leftWidth - 1; const contentWidth = mainWidth - 4;
      const bodyHeight = height - 5;
      const active = (area: SetupFocus) => !modal && view.focus === area;
      const paneActive = active("content") || Boolean(modal?.page);
      const edge = (label: string, size: number, focused: boolean, bottom = false) => {
        const title = label ? clipCells(`─ ${label} `, size - 2) : "";
        return this.border((bottom ? "└" : "┌") + title + "─".repeat(Math.max(0, size - 2 - cellWidth(title))) + (bottom ? "┘" : "┐"), focused);
      };
      const paneRow = (text: string, size: number, focused: boolean) => this.border("│", focused) + " " + pad(text, size - 4) + " " + this.border("│", focused);
      const tabs = view.providers.map((name, n) => {
        const selected = n === view.providerIndex; const focused = selected && active("top");
        const label = `[${name}]`;
        if (!this.colors) return `${selected ? "*" : " "}${label}`;
        const accent = providerAccents[name];
        if (!accent) return label;
        return `\u001b[${selected ? `${accent.text};${accent.background};1${focused ? ";4" : ""}` : accent.foreground}m${label}\u001b[0m`;
      }).join("   ") + (this.colors ? "  " : "");
      const brand = this.border("ArkSpace", active("top"));
      // Keep the original header location, reserving its longest localized provider badge.
      const summaryWidth = Math.max(cellWidth(view.summary), cellWidth(view.language === "zh" ? "供应商 关 · 仅显式" : "Provider Off · explicit only"));
      const headerSummary = !compact && view.route === "providers" && cellWidth(tabs) + summaryWidth + 12 <= width;
      const headerWidth = width - (headerSummary ? summaryWidth + 2 : 0);
      const gap = Math.max(2, Math.floor((headerWidth - cellWidth(brand) - cellWidth(tabs)) / 2));
      lines = [pad(brand + " ".repeat(gap) + tabs, headerWidth) + (headerSummary ? "  " + pad(this.tone(view.summary, view.summaryTone), summaryWidth) : ""),
        edge(view.language === "zh" ? "菜单" : "Menu", leftWidth, active("menu")) + " " + edge(modal?.page ? clean(modal.title) : view.title, mainWidth, paneActive)];
      // Pack whole, nonfocusable page key hints below the table, never above it.
      const hintLines: string[] = []; let hintLine = "";
      for (const hint of view.hints) {
        const text = `${hint.key} ${hint.label}`;
        const chip = this.tone(text, hint.reason ? "muted" : hint.tone ?? "info");
        if (hintLine && cellWidth(hintLine) + 2 + cellWidth(text) > contentWidth) { hintLines.push(hintLine); hintLine = ""; }
        hintLine += (hintLine ? "  " : "") + chip;
      }
      if (hintLine) hintLines.push(hintLine);
      const listHeight = Math.max(1, bodyHeight - hintLines.length - 1 - (headerSummary ? 0 : 1));
      const start = Math.max(0, view.selected - listHeight + 1);
      // Selection and lifecycle state are independent, including in monochrome.
      const columnWidths = view.columns.length === 3 ? [contentWidth - (compact ? 22 : 28), compact ? 8 : 12, compact ? 10 : 12]
        : view.columns.length === 2 ? [contentWidth - 17, 14] : [contentWidth - 2];
      const tableRow = (cells: string[], tone?: SetupTone) => cells.map((cell, n) => {
        const text = pad(cell, columnWidths[n] ?? 0);
        return n === cells.length - 1 ? this.tone(text, tone) : text;
      }).join(" ");
      let main = [this.tone("  " + tableRow(view.columns), "muted"),
        ...Array.from({ length: listHeight }, (_, n) => {
          const index = start + n; const cells = view.cells[index];
          if (!cells) return n === 0 && !view.cells.length ? this.tone(view.language === "zh" ? "无对象 · a 添加" : "No objects · a Add", "muted") : "";
          const focused = active("content") && index === view.selected;
          const marker = index === view.selected ? focused ? "> " : "· " : "  ";
          let text = tableRow(cells, view.rowTones?.[index]);
          if (focused && this.colors && cells.length > 1) {
            const last = pad(cells.at(-1) ?? "", columnWidths.at(-1)!);
            text = tableRow(cells.slice(0, -1)) + " " + `\u001b[40m${this.tone(last, view.rowTones?.[index])}`;
          }
          return this.selection(pad(marker + text, contentWidth), focused);
        }), ...(headerSummary ? [] : [this.tone(view.summary, view.summaryTone)]), ...hintLines];
      if (modal?.page) {
        const body = modal.body.flatMap((line, n) => wrapCells(clean(line), contentWidth).map(row => this.tone(row, modal.bodyTones?.[n])));
        // The Save/Cancel row is anchored even when notes overflow the page.
        main = [...body.slice(0, bodyHeight - 1)];
        while (main.length < bodyHeight - 1) main.push("");
        main.push(modal.footer);
      }
      for (let n = 0; n < bodyHeight; n++) {
        const label = view.menu[n] ?? (modal?.page && n === view.menu.length ? view.language === "zh" ? "（已锁定）" : "(locked)" : "");
        const focused = n === view.menuCursor && active("menu");
        const nav = label ? this.selection(pad(`${focused ? ">" : " "}${n === view.openedMenu ? "*" : " "}${label}`, leftWidth - 4), focused) : "";
        lines.push(paneRow(nav, leftWidth, active("menu")) + " " + paneRow(main[n] ?? "", mainWidth, paneActive));
      }
      lines.push(edge("", leftWidth, active("menu"), true) + " " + edge("", mainWidth, paneActive, true),
        pad(this.tone(view.status, view.statusTone), width), pad(view.footer, width));
      if (modal?.page) {
        lines[height - 1] = pad(view.language === "zh" ? "Enter 编辑/提交字段 · Esc 撤销 · Ctrl-S 保存" : "Enter edit/commit · Esc undo/back · Ctrl-S save", width);
        if (modal.cursor) {
          this.frame(lines, width);
          this.output.write(`\u001b[${3 + modal.cursor.row};${leftWidth + 4 + modal.cursor.column}H\u001b[?25h`); return;
        }
      } else if (modal) {
        const modalWidth = Math.min(width - 4, 68); const bodyWidth = modalWidth - 4;
        const body = modal.body.flatMap((line, n) => wrapCells(clean(line), bodyWidth).map(row => this.tone(row, modal.bodyTones?.[n] ?? modal.tone)));
        const available = Math.max(1, height - 8); const offset = Math.min(modal.offset ?? 0, Math.max(0, body.length - available));
        const content = body.slice(offset, offset + available);
        const box = [edge(clean(modal.title), modalWidth, true), ...content.map(line => paneRow(line, modalWidth, true)),
          this.border("├" + "─".repeat(modalWidth - 2) + "┤", true), paneRow(modal.footer, modalWidth, true), edge("", modalWidth, true, true)];
        const top = Math.max(1, Math.floor((height - box.length) / 2)); const left = Math.floor((width - modalWidth) / 2);
        for (let n = 0; n < box.length; n++) {
          const old = lines[top + n] ?? "";
          lines[top + n] = pad(wrapCells(old, left)[0] ?? "", left) + box[n] + " ".repeat(Math.max(0, width - left - modalWidth));
        }
        if (modal.cursor) {
          this.frame(lines, width);
          const row = top + 2 + modal.cursor.row - offset; const col = left + 3 + Math.min(bodyWidth - 1, modal.cursor.column);
          this.output.write(`\u001b[${row};${col}H\u001b[?25h`); return;
        }
      }
    }
    this.output.write("\u001b[?25l"); this.frame(lines.slice(0, height), width);
  }
  private async listen<T>(draw: () => void, onKey: (key: Key, finish: (value: T) => void) => void, signal?: AbortSignal, onData?: (chunk: string, finish: (value: T) => void) => void, start?: (finish: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    if (signal?.aborted) throw new Error("Setup cancelled.");
    const wasRaw = this.input.isRaw; let cleanup = () => {};
    try {
      if (!onData) {
        // Use Node's decoder with a short Escape delay; the non-terminal interface never echoes input.
        const parser = createInterface({ input: this.input, terminal: false, escapeCodeTimeout: 50 });
        try { emitKeypressEvents(this.input, parser); } finally { parser.close(); }
      }
      this.input.setRawMode(true); this.input.resume();
      return await new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (value: T) => { if (settled) return; settled = true; cleanup(); resolve(value); };
        const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
        const cancel = () => fail(new Error("Setup cancelled."));
        const ioError = () => fail(new Error("Setup terminal I/O failed."));
        const render = () => { if (settled) return; try { draw(); } catch { ioError(); } };
        const keypress = (_text: string, key: Key) => {
          if (key.ctrl && (key.name === "c" || key.name === "d")) { cancel(); return; }
          if (this.small && key.name !== "escape") { render(); return; }
          try {
            if (this.helpOpen) { if (["escape", "return", "enter", "?"].includes(key.name ?? "") || key.sequence === "?") this.helpOpen = false; }
            else onKey(key, finish);
            render();
          } catch { ioError(); }
        };
        const decoder = new StringDecoder("utf8");
        const data = (chunk: Buffer | string) => {
          const text = typeof chunk === "string" ? chunk : decoder.write(chunk); if (!text) return; if (/[\u0003\u0004]/.test(text)) { cancel(); return; }
          if (this.small && text !== "\u001b") { render(); return; }
          try { onData?.(text, finish); render(); } catch { ioError(); }
        };
        cleanup = () => {
          this.input.off("keypress", keypress); this.input.off("data", data); this.input.off("end", cancel); this.input.off("close", cancel);
          this.input.off("error", ioError); this.output.off("error", ioError); this.output.off("resize", render); signal?.removeEventListener("abort", cancel);
        };
        if (onData) this.input.on("data", data); else this.input.on("keypress", keypress);
        this.input.once("end", cancel); this.input.once("close", cancel); this.input.on("error", ioError); this.output.on("error", ioError);
        this.output.on("resize", render); signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        render();
        if (!settled) start?.(finish, fail);
      });
    } finally { this.helpOpen = false; cleanup(); this.input.setRawMode(Boolean(wasRaw)); if (!wasRaw) this.input.pause(); this.output.write("\u001b[?25h"); }
  }
  async busy<T>(view: () => WorkbenchView, action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, cancelOnEscape = false): Promise<T> {
    const controller = new AbortController(); let pending: Promise<T> | undefined;
    try {
      return await this.listen(() => this.paint(view()), key => { if (cancelOnEscape && key.name === "escape") controller.abort(); }, signal, undefined, (finish, fail) => {
        pending = action(controller.signal); pending.then(finish, fail);
      });
    } finally { controller.abort(); await pending?.catch(() => {}); }
  }
  workbench(view: () => WorkbenchView, signal?: AbortSignal): Promise<Key> {
    return this.listen(() => this.paint(view()), (key, finish) => finish(key), signal);
  }
  confirm(view: () => WorkbenchView, title: string, message: string, accept: string, cancel = "Cancel", signal?: AbortSignal, acceptTone: SetupTone = "neutral"): Promise<boolean> {
    let yes = false; let offset = 0;
    return this.listen(() => this.paint(view(), { title, body: message.split("\n"), footer: this.buttonBar([this.button(cancel, !yes), this.button(accept, yes, acceptTone)], yes ? 1 : 0, this.modalBodyWidth), help: view().language === "zh" ? ["确认：默认取消。Tab 或 ←→ 选择按钮；Enter 执行。", "Esc 取消；PgUp/Dn 滚动。Y/N 不执行确认。"] : ["Confirmation defaults to Cancel. Tab or ←→ selects; Enter activates.", "Esc cancels; PgUp/Dn scrolls. Y/N does not confirm."], offset }), (key, finish) => {
      if (key.name === "?" || key.sequence === "?") this.helpOpen = true;
      else if (key.name === "escape") finish(false);
      else if (key.name === "return" || key.name === "enter") finish(yes);
      else if (key.name === "tab") yes = !yes;
      else if (key.name === "left" || key.name === "home") yes = false;
      else if (key.name === "right" || key.name === "end") yes = true;
      else if (key.name === "pagedown") offset += 4; else if (key.name === "pageup") offset = Math.max(0, offset - 4);
    }, signal);
  }
  choose(view: () => WorkbenchView, title: string, entries: string[], accept: string, cancel: string, signal?: AbortSignal, notes = ""): Promise<number | undefined> {
    let selected = 0; let button = 0;
    return this.listen(() => this.paint(view(), { title, body: [...entries.map((entry, n) => `${n === selected ? ">" : " "} ${entry}`), ...(notes ? ["", ...notes.split("\n")] : [])], offset: Math.max(0, selected - Math.max(1, (this.output.rows || 24) - 8) + 1), help: view().language === "zh" ? ["↑↓ 选择项目；Tab 或 ←→ 选择操作按钮。", "Enter 仅执行聚焦按钮；Esc 取消，不执行操作。"] : ["↑↓ selects an item; Tab or ←→ selects an action button.", "Enter activates the focused button; Esc cancels without executing an action."], footer: this.buttonBar([this.button(cancel, button === 0), this.button(accept, button === 1, "success")], button, this.modalBodyWidth) }), (key, finish) => {
      if (key.name === "?" || key.sequence === "?") this.helpOpen = true;
      else if (key.name === "escape") finish(undefined);
      else if (["return", "enter"].includes(key.name ?? "")) finish(button === 1 ? selected : undefined);
      else if (key.name === "tab") button = 1 - button;
      else if (["up", "down", "home", "end"].includes(key.name ?? "")) selected = key.name === "home" ? 0 : key.name === "end" ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, selected + (key.name === "up" ? -1 : 1)));
      else if (key.name === "left") button = 0;
      else if (key.name === "right") button = 1;
    }, signal);
  }
  async notice(view: () => WorkbenchView, title: string, body: string, close = "Close", signal?: AbortSignal, tone: SetupTone = view().statusTone ?? "neutral") {
    let offset = 0;
    await this.listen<void>(() => this.paint(view(), { title, body: body.split("\n"), tone, footer: this.button(close, true) + (view().language === "zh" ? " · PgUp/Dn 滚动" : " · PgUp/Dn scroll"), offset }), (key, finish) => {
      if (["escape", "return", "enter"].includes(key.name ?? "")) finish();
      else if (key.name === "pagedown") offset += 4; else if (key.name === "pageup") offset = Math.max(0, offset - 4);
    }, signal);
  }
  async previewSecret(view: () => WorkbenchView, preview: SecretPreview, signal?: AbortSignal): Promise<void> {
    let shown = false; let button = 2; let offset = 0;
    const masked = (value: string) => { const chars = graphemes(value); return chars.length <= 12 ? "*".repeat(chars.length) : chars.slice(0, 3).join("") + "******" + chars.slice(-3).join(""); };
    const close = (finish: () => void) => { shown = false; this.paint(view()); finish(); };
    await this.listen<void>(() => {
      if (this.small) { shown = false; offset = 0; }
      this.paint(view(), {
      title: preview.title,
      body: preview.sources.flatMap(source => [source.label, `${graphemes(source.value).length} ${preview.length}`, shown ? source.value : masked(source.value)]),
      footer: this.buttonBar([preview.show, preview.hide, preview.close].map((label, n) => this.button(label, button === n, n < 2 ? "info" : "neutral")), button, this.modalBodyWidth),
      help: view().language === "zh" ? ["只读预览：默认遮罩；显示完整/隐藏/关闭必须显式执行。", "Tab 或 ←→ 选择按钮；Enter 执行；Esc 关闭。", "缩小到不可用窗口会重置显示；预览不保存或联网。"] : ["Read-only preview: masked by default; explicitly Show full, Hide or Close.", "Tab or ←→ selects; Enter activates; Esc closes.", "A tiny resize resets disclosure. Preview never saves or connects."], offset,
      });
    }, (key, finish) => {
      if (key.name === "?" || key.sequence === "?") this.helpOpen = true;
      else if (key.name === "escape") close(finish);
      else if (["return", "enter"].includes(key.name ?? "")) {
        if (button === 2) close(finish); else { shown = button === 0; offset = 0; }
      } else if (key.name === "tab") button = (button + (key.shift ? -1 : 1) + 3) % 3;
      else if (key.name === "left") button = Math.max(0, button - 1);
      else if (key.name === "right") button = Math.min(2, button + 1);
      else if (key.name === "home") button = 0;
      else if (key.name === "end") button = 2;
      else if (key.name === "pagedown") offset += 4;
      else if (key.name === "pageup") offset = Math.max(0, offset - 4);
    }, signal);
  }
  async form(view: () => WorkbenchView, form: SetupForm, signal?: AbortSignal): Promise<string[] | undefined> {
    const values = form.fields.map(field => field.value ?? ""); const cursors = values.map(value => graphemes(value).length);
    const staged = form.presentation === "page"; const original = [...values];
    let editing = !staged; let beforeEdit = ""; let discard = false; let discardYes = false;
    let focus = Math.max(0, Math.min(values.length - 1, form.initialField ?? 0)); let fieldFocus = focus; let rejected = false; let draining = false; let submitting = false; let timer: NodeJS.Timeout | undefined;
    let sequence = ""; let sequenceTimer: NodeJS.Timeout | undefined;
    const drain = () => {
      rejected = true; draining = true; submitting = false; sequence = "";
      if (sequenceTimer) clearTimeout(sequenceTimer);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { draining = false; this.output.emit("resize"); }, 150);
    };
    const fits = (text: string) => values[focus]!.length + text.length <= 8192;
    const draw = () => {
      const currentView = view();
      if (discard) { this.paint(currentView, { title: currentView.language === "zh" ? "放弃草稿" : "Discard draft", body: [currentView.language === "zh" ? "放弃未保存的更改？" : "Discard unsaved changes?"], footer: this.buttonBar([this.button(form.cancel, !discardYes), this.button(currentView.language === "zh" ? "放弃" : "Discard", discardYes, "warning")], discardYes ? 1 : 0, this.modalBodyWidth, false) }); return; }
      const bodyWidth = staged ? (this.output.columns || 80) - 1 - 19 - 5 : this.modalBodyWidth;
      const labelWidth = Math.min(staged ? 8 : 12, Math.floor(bodyWidth / 3));
      const caretColumns: number[] = [];
      const body = [pad(view().language === "zh" ? "字段" : "Field", labelWidth) + " │ " + (view().language === "zh" ? "值" : "Value"), ...form.fields.map((field, n) => {
        const chars = graphemes(values[n]!); const suffix = field.secret ? ` · ${chars.length} ${view().language === "zh" ? "字符" : "characters"}` : "";
        const display = field.secret ? chars.map(() => "*") : chars;
        const capacity = Math.max(1, bodyWidth - labelWidth - 7 - cellWidth(suffix));
        let start = cursors[n]!;
        let before = 0;
        while (start > 0 && before + cellWidth(display[start - 1]!) < capacity) before += cellWidth(display[--start]!);
        let end = start; let used = 0;
        while (end < display.length && used + cellWidth(display[end]!) <= capacity) used += cellWidth(display[end++]!);
        caretColumns[n] = labelWidth + 6 + before;
        return pad(clean(field.label), labelWidth) + ` │ ${focus === n ? ">" : " "} [${display.slice(start, end).join("")}]${suffix}`;
      })];
      if (form.error) body.push(form.error);
      if (rejected) body.push(form.rejected);
      body.push(...form.notes.split("\n"));
      this.paint(view(), { page: staged, title: form.title, body, bodyTones: body.map((_, n) => n <= values.length ? "neutral" : n < values.length + 1 + (form.error ? 1 : 0) + (rejected ? 1 : 0) ? "danger" : "warning"), footer: this.buttonBar([this.button(form.cancel, focus === values.length), this.button(form.save, focus === values.length + 1, "success")], focus === values.length + 1 ? 1 : 0, bodyWidth, false),
        ...(focus < values.length && editing ? { cursor: { row: focus + 1, column: caretColumns[focus]! } } : {}) });
    };
    const handle = (chunk: string, finish: (value: string[] | undefined) => void) => {
        const pasted = /^\u001b\[200~([\s\S]*)\u001b\[201~$/.exec(chunk);
        const controls = /[\u0000-\u001f\u007f-\u009f]/;
        // Validate raw payloads even while the field/button/discard group owns input.
        if (pasted ? controls.test(pasted[1]!) : controls.test(chunk) &&
          !["\u001b", "\t", "\r", "\n", "\r\n", "\u0013", "\u0001", "\u0005", "\b", "\u007f"].includes(chunk) &&
          !/^\u001b\[(?:[ABCDHFZ]|3~)$/.test(chunk) &&
          !(editing && /^[^\u0000-\u001f\u007f-\u009f]+(?:\r\n|\r|\n)$/.test(chunk))) { drain(); return; }
        const cancelForm = () => {
          if (staged && (form.dirty || values.some((value, n) => value !== original[n]))) { discard = true; discardYes = false; }
          else finish(undefined);
        };
        if (discard) {
          if (chunk === "\u001b") discard = false;
          else if (chunk === "\u001b[D") discardYes = false;
          else if (chunk === "\u001b[C") discardYes = true;
          else if (chunk === "\t") discardYes = !discardYes;
          else if (["\r", "\n", "\r\n"].includes(chunk)) { if (discardYes) finish(undefined); else discard = false; }
          return;
        }
        if (chunk === "\u001b") {
          if (timer) clearTimeout(timer); submitting = false;
          if (staged && editing) { values[focus] = beforeEdit; cursors[focus] = graphemes(beforeEdit).length; editing = false; }
          else cancelForm(); return;
        }
        if (submitting) {
          if (chunk !== "\n") { drain(); return; }
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { if (!this.small) finish([...values]); else { submitting = false; this.output.emit("resize"); } }, 150); return;
        }
        if (staged && chunk === "\u0013") {
          editing = false; submitting = true;
          timer = setTimeout(() => { if (!this.small) finish([...values]); else { submitting = false; this.output.emit("resize"); } }, 150); return;
        }
        if (staged && !editing && focus < values.length && ["\u001b[A", "\u001b[B"].includes(chunk)) {
          focus = Math.max(0, Math.min(values.length - 1, focus + (chunk === "\u001b[A" ? -1 : 1))); fieldFocus = focus; return;
        }
        if (staged && (chunk === "\t" || chunk === "\u001b[Z")) {
          if (editing) return;
          const regions = [fieldFocus, values.length, values.length + 1];
          focus = regions[(regions.indexOf(focus) + (chunk === "\t" ? 1 : -1) + regions.length) % regions.length]!; return;
        }
        if (chunk === "\t" || chunk === "\u001b[Z") { focus = (focus + (chunk === "\t" ? 1 : -1) + values.length + 2) % (values.length + 2); return; }
        const submit = () => {
          if (focus === values.length) cancelForm();
          else if (focus === values.length + 1) {
            submitting = true; timer = setTimeout(() => {
              if (!this.small) finish([...values]); else { submitting = false; this.output.emit("resize"); }
            }, 150);
          } else if (staged) {
            if (editing) editing = false;
            else { beforeEdit = values[focus]!; editing = true; }
          } else focus = focus === values.length - 1 ? values.length + 1 : focus + 1;
        };
        if (["\r", "\n", "\r\n"].includes(chunk)) { submit(); return; }
        const singleLineSubmit = /^([^\u0000-\u001f\u007f-\u009f]+)(?:\r\n|\r|\n)$/.exec(chunk);
        if (singleLineSubmit && focus < values.length && editing) {
          if (!fits(singleLineSubmit[1]!)) { drain(); return; }
          const insert = graphemes(singleLineSubmit[1]!); const chars = graphemes(values[focus]!);
          chars.splice(cursors[focus]!, 0, ...insert); values[focus] = chars.join(""); cursors[focus] = graphemes(chars.slice(0, cursors[focus]! + insert.length).join("")).length; submit(); return;
        }
        if (focus >= values.length) {
          if (chunk === "\u001b[D" || chunk === "\u001b[H") focus = values.length;
          else if (chunk === "\u001b[C" || chunk === "\u001b[F") focus = values.length + 1;
          return;
        }
        if (staged && !editing) return;
        const chars = graphemes(values[focus]!); let cursor = cursors[focus]!;
        if (chunk === "\u001b[D") { cursors[focus] = Math.max(0, cursor - 1); return; }
        if (chunk === "\u001b[C") { cursors[focus] = Math.min(chars.length, cursor + 1); return; }
        if (chunk === "\u001b[H" || chunk === "\u0001") { cursors[focus] = 0; return; }
        if (chunk === "\u001b[F" || chunk === "\u0005") { cursors[focus] = chars.length; return; }
        if (chunk === "\u001b[A" || chunk === "\u001b[B") return;
        if (chunk === "\u007f" || chunk === "\b") { if (cursor) chars.splice(--cursor, 1); }
        else if (chunk === "\u001b[3~") chars.splice(cursor, 1);
        else {
          const text = pasted?.[1] ?? chunk;
          // Drain a rejected paste tail in raw mode so it cannot reach the next screen.
          if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) {
            drain(); return;
          }
          if (!fits(text)) { drain(); return; }
          const insert = graphemes(text); chars.splice(cursor, 0, ...insert); cursor += insert.length; rejected = false;
        }
        const prefix = chars.slice(0, cursor).join("");
        values[focus] = chars.join(""); cursors[focus] = graphemes(prefix).length;
    };
    try {
      return await this.listen(draw, () => {}, signal, (incoming, finish) => {
        // Drain before framing any paste tail, including Escape, so queued bytes cannot
        // reach field/discard/save handlers. Ctrl-C/EOF/abort still cancel in listen().
        if (draining) { drain(); return; }
        if (sequenceTimer) clearTimeout(sequenceTimer);
        // At most 8192 UTF-16 code units plus the two bracketed-paste delimiters.
        if (sequence.length + incoming.length > 8204) { drain(); return; }
        const chunk = sequence + incoming; sequence = "";
        const csiPrefix = /^\u001b(?:\[[0-9;]*)?$/.test(chunk);
        const pastePrefix = chunk.startsWith("\u001b[200~") && !chunk.endsWith("\u001b[201~");
        if (csiPrefix || pastePrefix) {
          if (csiPrefix && chunk.length > 32) { drain(); return; }
          sequence = chunk;
          sequenceTimer = setTimeout(() => {
            const pending = sequence; sequence = "";
            if (pending === "\u001b") handle(pending, finish); else drain();
            this.output.emit("resize");
          }, pastePrefix ? 150 : 50);
          return;
        }
        if (chunk.startsWith("\u001b") && !/^\u001b\[(?:[ABCDHFZ]|3~)$/.test(chunk) && !/^\u001b\[200~[\s\S]*\u001b\[201~$/.test(chunk)) { drain(); return; }
        handle(chunk, finish);
      });
    } finally { if (timer) clearTimeout(timer); if (sequenceTimer) clearTimeout(sequenceTimer); sequence = ""; }
  }
}
