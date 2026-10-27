/**
 * `arks setup` workbench (engine: pi-tui via port.ts only, ADR 0023/0024).
 * P2 scope: real data + full key/order/language management. The controller is
 * pure; this host maps raw terminal input to events, executes op effects
 * through commands.ts, and keeps terminal state restorable on every path.
 */
import {
  Box, HStack, Key, ProcessTerminal, TuiAltScreen, VStack, matchesKey,
  type Component, type OverlayHandle, type TuiMouseEvent, type TuiMouseEventResult,
} from "./port.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { setupSafeError } from "../cli/setup-language.js";
import { Framed } from "./components/framed.js";
import { Line } from "./components/line.js";
import { DIM, SEL, FG, padV } from "./components/style.js";
import { msg } from "./messages.js";
import type { TuiLang } from "./messages.js";
import { initialState, reduce, type Event, type Op, type State } from "./controller.js";
import {
  buttonHits, contentTitle, currentProvider, currentRowItems, keyBar, menuHitPage,
  menuLines, modalLines, pageLines, stripHits, stripLine,
} from "./view.js";
import { getSetupSnapshot, loadPreview } from "./data.js";
import { runOp } from "./commands.js";

export interface SetupTuiOptions {
  paths: ArkSpacePaths;
  environment: NodeJS.ProcessEnv;
  language: () => TuiLang;
  onLanguageChange?: ((lang: TuiLang) => void) | undefined;
  signal?: AbortSignal | undefined;
}

const PASTE_RE = /^\u001b\[200~([\s\S]*)\u001b\[201~$/;
const printable = (data: string) => [...data].filter(ch => {
  const cp = ch.codePointAt(0)!;
  return cp >= 33 && cp !== 127; // secrets are token-like; spaces/controls refused at input
}).join("");

export async function runSetupTui(options: SetupTuiOptions): Promise<void> {
  let state = initialState(options.language(), msg(options.language(), "loading"));
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
  let modal: OverlayHandle | undefined;
  let closed = false;
  let exitResolve: (() => void) | undefined;
  let ioBusy = false; // serialise async reads/writes; keys during IO are dropped (local IO, sub-100ms)

  // --- components read live `state`; the engine only asks them to render ---
  const strip: Component = {
    invalidate() {},
    render: (w) => [stripLine(state, w)],
    handleMouse: (e: TuiMouseEvent): TuiMouseEventResult | undefined => {
      if (e.type !== "click") return undefined;
      for (const [a, b, i] of stripHits(e.width)) if (e.x >= a && e.x <= b) return (dispatch({ type: "contextSet", index: i }), { handled: true });
      return undefined;
    },
  };
  const menu: Component = {
    invalidate() {},
    render: (w) => menuLines(state, w),
    handleMouse: (e: TuiMouseEvent): TuiMouseEventResult | undefined => {
      if (e.type !== "click") return undefined;
      const value = menuHitPage(state, e.y);
      if (value === null) return undefined;
      if (value === "exit") return dispatch({ type: "quitIntent" }), { handled: true };
      dispatch({ type: "pageSet", page: value as "providers" | "config" | "settings" | "diagnostics" });
      return { handled: true };
    },
  };
  const page: Component = {
    invalidate() {},
    render: (w) => { lastWidth = w; return pageLines(state, w); },
    handleMouse: (e: TuiMouseEvent): TuiMouseEventResult | undefined => {
      if (e.type !== "click" || state.mode !== "browse") return undefined;
      if (state.page === "providers" && state.region !== "menu") {
        const items = currentRowItems(state);
        if (e.y >= 1 && e.y <= items.length) return (dispatch({ type: "rowSet", row: e.y - 1 }), { handled: true });
        const buttonRow = 1 + Math.max(items.length, 1) + 1; // header, rows, blank, buttons
        if (e.y === buttonRow) {
          for (const hit of buttonHits(state)) if (e.x >= hit.start && e.x <= hit.end) return fireButton(hit.event), { handled: true };
        }
      }
      if (e.y >= 1) dispatch({ type: "rowSet", row: e.y - 1 });
      return { handled: true };
    },
  };
  let lastWidth = 80;
  const modalBox: Component = {
    invalidate() {},
    render: (w) => state.modal ? modalLines(state.modal, w) : [""],
  };
  const statusLine = new Line();
  const footerLine = new Line();

  function render(): void {
    const rows = process.stdout.rows || 24; // winsize race can report 0/undefined at startup
    const height = Math.max(8, rows - 4);  // strip + body + status + footer constant, or borders jump
    const left = new Framed(menu, () => msg(state.lang, "menuTitle"));
    left.setH(height);
    const right = new Framed(page, () => contentTitle(state));
    right.setH(height);
    const stripBox = new Box(1, 0);
    stripBox.addChild(strip);
    tui.setLayoutRoot(new VStack([
      { component: stripBox, basis: 1 },
      { component: new HStack([{ component: left, basis: 22, shrink: 0 }, { component: right, basis: 0, grow: 1 }]), basis: height, grow: 0 },
      { component: statusLine, basis: 1 },
      { component: footerLine, basis: 1 },
    ]));
    statusLine.set(" " + (state.statusWarn ? FG(33, state.status) : state.status));
    footerLine.set(keyBar(state));
    tui.requestRender(true);
  }

  function syncModal(): void {
    if (state.modal && !modal) {
      modal = tui.showOverlay(new Framed(modalBox, () => state.modal?.title ?? ""), { width: "62%", anchor: "center" });
    } else if (!state.modal && modal) {
      modal.hide();
      modal = undefined;
    }
  }

  function dispatch(event: Event): void {
    const result = reduce(state, event);
    state = result.state;
    for (const effect of result.effects) {
      if (effect.type === "exit") close();
      else void applyOp(effect.op);
    }
    syncModal();
    render();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", close);
    tui.stop(); // restores alt-screen, cursor, mouse, bracketed paste on every path
    exitResolve?.();
  }
  options.signal?.addEventListener("abort", close);

  async function refresh(): Promise<void> {
    try { dispatch({ type: "data", snapshot: await getSetupSnapshot(options.paths, options.environment) }); }
    catch { dispatch({ type: "loadError", text: msg(state.lang, "dataError") }); }
  }

  async function applyOp(op: Op): Promise<void> {
    if (ioBusy) return;
    ioBusy = true;
    if (op.kind === "addKey" || op.kind === "replaceKey") dispatch({ type: "notice", text: msg(state.lang, "formBusy") });
    const result = await runOp(options.paths, options.environment, op);
    ioBusy = false;
    if (!result.ok) {
      const known = setupSafeError(state.lang, `Setup: ${result.reason}`);
      return void dispatch({ type: "notice", text: known ?? msg(state.lang, "opFailed", { reason: result.reason }), warn: true });
    }
    await refresh();
    dispatch({ type: "opDone", kind: op.kind });
    switch (op.kind) {
      case "addKey": dispatch({ type: "formDone" }); dispatch({ type: "notice", text: msg(state.lang, "opAdded", { ref: result.detail ?? "" }) }); break;
      case "replaceKey": dispatch({ type: "formDone" }); dispatch({ type: "notice", text: msg(state.lang, "opReplaced", { ref: op.reference }) }); break;
      case "removeKey": dispatch({ type: "notice", text: msg(state.lang, "opRemoved", { ref: op.reference }) }); break;
      case "toggleKey": dispatch({ type: "notice", text: msg(state.lang, op.enabled ? "opKeyOn" : "opKeyOff", { ref: op.reference }) }); break;
      case "toggleProvider": {
        const label = currentProvider(state)?.id ?? op.provider;
        dispatch({ type: "notice", text: msg(state.lang, op.enabled ? "opProviderOn" : "opProviderOff", { name: label }) });
        break;
      }
      case "saveOrder": dispatch({ type: "notice", text: msg(state.lang, "opOrderSaved") }); break;
      case "setLanguage":
        options.onLanguageChange?.(op.lang);
        dispatch({ type: "language", lang: op.lang });
        dispatch({ type: "notice", text: msg(state.lang, "opLangSaved") });
        break;
    }
  }

  async function openDetails(): Promise<void> {
    const item = currentRowItems(state)[state.row];
    if (!item || !("reference" in item)) return;
    const reference = item.reference;
    await refresh(); // ADR 0017: snapshot refreshed before the detail view reads it
    const fresh = currentProvider(state)?.keys.find(k => k.reference === reference);
    if (!fresh) return dispatch({ type: "notice", text: msg(state.lang, "previewChanged"), warn: true });
    dispatch({ type: "detailsOpen", reference });
  }

  async function openPreview(): Promise<void> {
    const provider = currentProvider(state);
    if (!provider) return;
    if (provider.id === "searxng") return dispatch({ type: "notice", text: msg(state.lang, "previewKeyless"), warn: true });
    const item = currentRowItems(state)[state.row];
    if (!item || !("reference" in item)) return;
    const outcome = await loadPreview(options.paths, provider.id, item.reference, options.environment);
    if (outcome.kind === "ok") {
      const labels: Record<string, string> = {
        local: msg(state.lang, "srcLocalValue"), env: msg(state.lang, "srcEnvValue"), "env-over": msg(state.lang, "srcEnvOver"),
      };
      return dispatch({ type: "previewOpen", variable: outcome.variable, sources: outcome.sources.map(s => ({ label: labels[s.label] ?? s.label, value: s.value })) });
    }
    const reason = outcome.kind === "missing" ? "previewMissing" : outcome.kind === "invalid-env" ? "previewInvalidEnv" : "previewChanged";
    dispatch({ type: "notice", text: msg(state.lang, reason), warn: true });
  }

  function fireButton(event: string): void {
    switch (event) {
      case "keyAdd": dispatch({ type: "keyAdd" }); break;
      case "keyEdit": dispatch({ type: "keyEdit" }); break;
      case "keyRemove": dispatch({ type: "keyRemoveStart" }); break;
      case "keyToggle": dispatch({ type: "keyToggle" }); break;
      case "details": void openDetails(); break;
      case "preview": void openPreview(); break;
      default: dispatch({ type: "notice", text: msg(state.lang, "pendingP3"), warn: true });
    }
  }

  tui.addInputListener((data) => {
    if (closed) return { consume: true };
    if (matchesKey(data, "ctrl+c")) { close(); return { consume: true }; }

    if (state.modal) {
      if (matchesKey(data, Key.up) || data === "k") dispatch({ type: "modalMove", delta: -1 });
      else if (matchesKey(data, Key.down) || data === "j") dispatch({ type: "modalMove", delta: 1 });
      else if (matchesKey(data, Key.enter)) dispatch({ type: "modalPick" });
      else if (matchesKey(data, Key.escape)) dispatch({ type: "escape" });
      else if (data === "y") { state = { ...state, modal: state.modal ? { ...state.modal, cursor: 1 } : null }; dispatch({ type: "modalPick" }); }
      else if (data === "n") dispatch({ type: "escape" });
      return { consume: true };
    }

    if (state.mode === "form") {
      const paste = PASTE_RE.exec(data);
      if (matchesKey(data, Key.escape)) dispatch({ type: "escape" });
      else if (matchesKey(data, "ctrl+s")) dispatch({ type: "formSave" });
      else if (matchesKey(data, Key.enter)) dispatch({ type: "formEnter" });
      else if (matchesKey(data, Key.backspace)) dispatch({ type: "formBackspace" });
      else if (paste && state.form?.typing) dispatch({ type: "formType", text: printable(paste[1]!.trim()) });
      else if (state.form?.typing && data.length === 1) dispatch({ type: "formType", text: printable(data) });
      return { consume: true };
    }

    if (ioBusy) return { consume: true }; // keys during in-flight IO: drop, never queue
    const onConfig = state.region === "content" && state.page === "config";
    if (data === "q") dispatch({ type: "quitIntent" });
    else if (matchesKey(data, "tab")) dispatch({ type: "tab", delta: 1 });
    else if (matchesKey(data, "shift+tab")) dispatch({ type: "tab", delta: -1 });
    else if (matchesKey(data, Key.up) || data === "k") dispatch({ type: "move", delta: -1 });
    else if (matchesKey(data, Key.down) || data === "j") dispatch({ type: "move", delta: 1 });
    else if (matchesKey(data, Key.left) && state.region === "top") dispatch({ type: "context", delta: -1 });
    else if (matchesKey(data, Key.right) && state.region === "top") dispatch({ type: "context", delta: 1 });
    else if (data === "[") dispatch({ type: "context", delta: -1 });
    else if (data === "]") dispatch({ type: "context", delta: 1 });
    else if (onConfig && (data === "u" || data === "U")) dispatch({ type: "orderMove", delta: -1 });
    else if (onConfig && (data === "d" || data === "D")) dispatch({ type: "orderMove", delta: 1 });
    else if (onConfig && matchesKey(data, Key.delete)) dispatch({ type: "orderDrop" });
    else if (onConfig && data === "I") dispatch({ type: "orderIncludeStart" });
    else if (onConfig && matchesKey(data, "ctrl+s")) dispatch({ type: "orderSave" });
    else if (matchesKey(data, Key.enter)) dispatch({ type: "enter" });
    else if (matchesKey(data, Key.escape)) dispatch({ type: "escape" });
    else if (data === "i") { ioBusy = true; void openDetails().finally(() => { ioBusy = false; }); }
    else if (data === "p") { ioBusy = true; void openPreview().finally(() => { ioBusy = false; }); }
    else if (data === "a") dispatch({ type: "keyAdd" });
    else if (data === "e") dispatch({ type: "keyEdit" });
    else if (data === "d") dispatch({ type: "keyRemoveStart" });
    else if (data === " ") dispatch({ type: "keyToggle" });
    else if (data === "v" || data === "V") dispatch({ type: "providerToggle" });
    else if (data === "t") dispatch({ type: "notice", text: msg(state.lang, "pendingP3"), warn: true });
    return { consume: true };
  });

  render();
  tui.start();
  void refresh();
  await new Promise<void>((resolve) => { exitResolve = resolve; });
}
