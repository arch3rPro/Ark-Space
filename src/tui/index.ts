/**
 * `arks setup` workbench (engine: pi-tui via port.ts only, ADR 0023/0024).
 * P2 scope: real data + full key/order/language management. The controller is
 * pure; this host maps raw terminal input to events, executes op effects
 * through commands.ts, and keeps terminal state restorable on every path.
 */
import {
  Box, HStack, Key, ProcessTerminal, TuiAltScreen, VStack, matchesKey,
  decodeKittyPrintable, isKeyRelease,
  type Component, type OverlayHandle, type TuiMouseEvent, type TuiMouseEventResult,
} from "./port.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { setupSafeError } from "../cli/setup-language.js";
import { Framed } from "./components/framed.js";
import { Line } from "./components/line.js";
import { FG } from "./components/style.js";
import { msg } from "./messages.js";
import type { TuiLang } from "./messages.js";
import { initialState, reduce, type Event, type Op } from "./controller.js";
import {
  actionHits, actionLine, contentTitle, currentProvider, currentRowItems, keyBar, menuHitPage,
  menuLines, modalLines, pageLines, stripHits, stripLine,
} from "./view.js";
import { getSetupSnapshot, getConnections, loadPreview } from "./data.js";
import { runOp } from "./commands.js";
import { executeWeknoraVerify } from "../capabilities/weknora-verify.js";
import { startUseGptServices, stopUseGptServices, diagnoseUseGpt } from "../usegpt/services.js";
import { loadConfig } from "../config/store.js";
import { loadCredentialEnvironment } from "../config/credentials.js";
import { executeWebSearch } from "../capabilities/web-search.js";
import { resolveWebSearchInput } from "../protocol/schema.js";
import { createSearchProviderRegistry } from "../providers/registry.js";
import { testSetupKeys, type SetupKeyTestResult } from "../cli/setup-key-tests.js";
import type { FailureKind } from "../protocol/types.js";
import type { DiagEntry, Effect } from "./controller.js";

export interface SetupTuiOptions {
  paths: ArkSpacePaths;
  environment: NodeJS.ProcessEnv;
  language: () => TuiLang;
  provider?: string | undefined; // `arks setup <id>` deep-link: opens that context directly
  onLanguageChange?: ((lang: TuiLang) => void) | undefined;
  signal?: AbortSignal | undefined;
}

const PASTE_RE = /^\u001b\[200~([\s\S]*)\u001b\[201~$/;
const REASON_KEYS: Record<FailureKind, string> = {
  auth: "reasonAuth", permission: "reasonPermission", "rate-limit": "reasonRateLimit", quota: "reasonQuota",
  transient: "reasonTransient", network: "reasonNetwork", "invalid-request": "reasonInvalidRequest",
  "invalid-response": "reasonInvalidResponse", config: "reasonConfig", unknown: "reasonUnknown",
};
const stamp = () => new Date().toTimeString().slice(0, 8);
const printable = (data: string) => [...data].filter(ch => {
  const cp = ch.codePointAt(0)!;
  return cp >= 33 && cp !== 127; // secrets are token-like; spaces/controls refused at input
}).join("");

// Printable character across keyboard protocols: legacy raw byte, kitty CSI-u (flag 1),
// modifyOtherKeys level 2. "" for anything that is not plain/shift text input.
const printableChar = (data: string): string => {
  if (data.length === 1) return data;
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  const mok = /^\x1b\[27;(\d+);(\d+)~$/.exec(data);
  if (mok && (Number(mok[1]) === 1 || Number(mok[1]) === 2)) return String.fromCodePoint(Number(mok[2]));
  return "";
};

const CONTEXT_BY_ID: Record<string, number> = { exa: 0, tavily: 1, firecrawl: 2, searxng: 3, weknora: 4, usegpt: 5 };

export async function runSetupTui(options: SetupTuiOptions): Promise<void> {
  let state = initialState(options.language(), msg(options.language(), "loading"), options.provider ? CONTEXT_BY_ID[options.provider] ?? 0 : 0);
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
  let modal: OverlayHandle | undefined;
  let closed = false;
  let exitResolve: (() => void) | undefined;
  let ioBusy = false; // serialise async reads/writes; keys during IO are dropped (local IO, sub-100ms)
  const registry = createSearchProviderRegistry();
  let testAbort: AbortController | undefined;

  // --- components read live `state`; the engine only asks them to render ---
  const strip: Component = {
    invalidate() {},
    render: (w) => [stripLine(state, w)],
    handleMouse: (e: TuiMouseEvent): TuiMouseEventResult | undefined => {
      if (e.type !== "click") return undefined;
      for (const [a, b, i] of stripHits(state, e.width)) if (e.x >= a && e.x <= b) return (dispatch({ type: "contextSet", index: i }), { handled: true });
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
      dispatch({ type: "pageSet", page: value as "providers" | "config" | "knowledge" | "tools" | "settings" | "diagnostics" });
      return { handled: true };
    },
  };
  let lastInnerW = 1;
  let lastFrameH = 0;
  const page: Component = {
    invalidate() {},
    render: (w) => { lastInnerW = w; return pageLines(state, w); },
    handleMouse: (e: TuiMouseEvent): TuiMouseEventResult | undefined => {
      if (e.type !== "click" || state.mode !== "browse") return undefined;
      if (lastFrameH >= 4 && e.y === lastFrameH - 3) { // the pinned action row, in child-local coordinates
        for (const hit of actionHits(state, lastInnerW)) if (e.x >= hit.start && e.x <= hit.end) return fireButton(hit.event), { handled: true };
      }
      if (state.page === "providers" && state.region !== "menu") {
        const items = currentRowItems(state);
        if (e.y >= 1 && e.y <= items.length) return (dispatch({ type: "rowSet", row: e.y - 1 }), { handled: true });
      }
      if (e.y >= 1) dispatch({ type: "rowSet", row: e.y - 1 });
      return { handled: true };
    },
  };
  const modalBox: Component = {
    invalidate() {},
    render: (w) => state.modal ? modalLines(state.modal, w) : [""],
  };
  const statusLine = new Line();
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastNotice = "";

  function render(): void {
    const rows = process.stdout.rows || 24; // winsize race can report 0/undefined at startup
    const height = Math.max(8, rows - 3);  // strip + body + single bottom row; keep constant or borders jump
    const left = new Framed(menu, () => msg(state.lang, "menuTitle"));
    left.setH(height);
    const right = new Framed(page, () => contentTitle(state));
    right.setH(height);
    right.setFooter(w => actionLine(state, w));
    lastFrameH = height;
    const stripBox = new Box(1, 0);
    stripBox.addChild(strip);
    tui.setLayoutRoot(new VStack([
      { component: stripBox, basis: 1 },
      { component: new HStack([{ component: left, basis: 22, shrink: 0 }, { component: right, basis: 0, grow: 1 }]), basis: height, grow: 0 },
      { component: statusLine, basis: 1 },
    ]));
    // one bottom row: notices show briefly over the global key hints, then fall back
    statusLine.set(state.status ? " " + (state.statusWarn ? FG(33, state.status) : state.status) : keyBar(state));
    if (state.status !== lastNotice) {
      lastNotice = state.status;
      if (noticeTimer) clearTimeout(noticeTimer);
      if (state.status) {
        noticeTimer = setTimeout(() => { if (!closed) dispatch({ type: "statusClear" }); }, 6000);
        noticeTimer.unref?.();
      }
    }
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
      else if (effect.type === "testRun") void runTest(effect);
      else if (effect.type === "service") void runService(effect.action);
      else void applyOp(effect.op);
    }
    syncModal();
    render();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (noticeTimer) clearTimeout(noticeTimer);
    testAbort?.abort(); // never leave a live provider request after the terminal restores
    options.signal?.removeEventListener("abort", close);
    tui.stop(); // restores alt-screen, cursor, mouse, bracketed paste on every path
    exitResolve?.();
  }
  options.signal?.addEventListener("abort", close);

  async function refresh(): Promise<void> {
    try {
      const [snapshot, conn] = await Promise.all([getSetupSnapshot(options.paths, options.environment), getConnections(options.paths, options.environment)]);
      dispatch({ type: "data", snapshot });
      dispatch({ type: "connData", weknora: conn.weknora, usegpt: conn.usegpt });
    }
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
      case "addInstance": dispatch({ type: "notice", text: msg(state.lang, "instAdded") }); break;
      case "editInstance": dispatch({ type: "notice", text: msg(state.lang, "instUpdated") }); break;
      case "removeInstance": dispatch({ type: "notice", text: msg(state.lang, "instRemoved") }); break;
      case "wekSave":
        if (op.field === "key" || (op.field === "url" && op.secret === undefined)) dispatch({ type: "formDone" });
        dispatch({ type: "notice", text: msg(state.lang, "wekSaved") });
        break;
      case "wekRemove": dispatch({ type: "notice", text: msg(state.lang, "wekRemoved") }); break;
      case "usegptSave": dispatch({ type: "notice", text: msg(state.lang, "usegptConfigSaved") }); break;
      case "usegptKey":
        dispatch({ type: "formDone" });
        dispatch({ type: "notice", text: msg(state.lang, "usegptKeySaved") });
        break;
      case "usegptUnlink": dispatch({ type: "notice", text: msg(state.lang, "usegptUnlinked") }); break;
      case "setLanguage":
        options.onLanguageChange?.(op.lang);
        dispatch({ type: "language", lang: op.lang });
        dispatch({ type: "notice", text: msg(state.lang, "opLangSaved") });
        break;
    }
  }

  /** Connection service actions run outside the op lane: busy fence + notice + refresh. */
  async function runService(action: "wekVerify" | "usegptStart" | "usegptStop" | "usegptDiagnose"): Promise<void> {
    if (ioBusy) return;
    ioBusy = true;
    dispatch({ type: "serviceBusy", on: true });
    let detail = "";
    try {
      if (action === "wekVerify") {
        const envelope = await executeWeknoraVerify({ protocolVersion: 1, capability: "weknora.connection.verify", input: { confirmed: true, timeoutMs: 5000 } }, options.paths, options.environment);
        detail = envelope.ok ? `2xx/${envelope.data.status}` : `${envelope.error.kind}${envelope.error.status ? `/${envelope.error.status}` : ""}`;
        dispatch({ type: "notice", text: msg(state.lang, "wekVerifyResult", { res: msg(state.lang, envelope.ok ? "wekVerifyOk" : "wekVerifyBad"), detail: `: ${detail}` }), warn: !envelope.ok });
      } else if (action === "usegptDiagnose") {
        const d = await diagnoseUseGpt(options.environment);
        detail = d.issues.length ? d.issues.join(", ") : "clean";
        dispatch({ type: "notice", text: d.issues.length ? msg(state.lang, "svcDiag", { issues: detail }) : msg(state.lang, "svcDiagClean"), warn: d.issues.length > 0 });
      } else {
        if (action === "usegptStart") await startUseGptServices(options.environment); else await stopUseGptServices(options.environment);
        const d = await diagnoseUseGpt(options.environment);
        const good = action === "usegptStart" ? d.daemonRunning && d.tunnelRunning : !d.daemonRunning && !d.tunnelRunning;
        detail = `daemon:${d.daemonRunning ? "up" : "down"} tunnel:${d.tunnelRunning ? "up" : "down"}`;
        dispatch({ type: "notice", text: msg(state.lang, action === "usegptStart" ? (good ? "svcStartOk" : "svcStartBad") : (good ? "svcStopOk" : "svcStopBad")) + ` (${detail})`, warn: !good });
        await refresh();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      const reason = message.startsWith("Setup:") ? message.slice(6).trim() : "(details suppressed)";
      dispatch({ type: "notice", text: msg(state.lang, action === "usegptStop" ? "stopBad" : "startBad", { reason }), warn: true });
    } finally {
      ioBusy = false;
      dispatch({ type: "serviceBusy", on: false });
    }
  }

  function toDiag(row: SetupKeyTestResult): DiagEntry {
    const status = row.status === "success" ? "stSuccess" : row.status === "failure" ? "stFailure"
      : row.status === "skipped" ? "stSkipped" : row.status === "cancelled" ? "stCancelled" : "stNotTested";
    const out = msg(state.lang, status) + (row.errorKind ? " / " + msg(state.lang, REASON_KEYS[row.errorKind]!) : "");
    return { when: stamp(), ref: row.reference, out, dur: row.durationMs ?? 0 };
  }

  async function runTest(effect: Extract<Effect, { type: "testRun" }>): Promise<void> {
    if (state.testing || testAbort) return; // single runner; controller also fences testIntent
    const ac = new AbortController();
    testAbort = ac;
    try {
      const config = await loadConfig(options.paths.config);
      const environment = await loadCredentialEnvironment(options.paths.credentials, options.environment);
      if (effect.mode === "allKeys") {
        const entry = config.providers[effect.provider];
        if (!entry?.enabled || effect.references.some(r => !(entry.keyRefs as string[]).includes(r))) {
          dispatch({ type: "notice", text: msg(state.lang, "configChanged"), warn: true });
          return;
        }
        dispatch({ type: "testBegin", provider: effect.provider, mode: "allKeys", total: effect.references.length });
        const report = await testSetupKeys({
          config: { ...config, providers: { ...config.providers, [effect.provider]: { ...entry, keyRefs: effect.references } } },
          provider: effect.provider as "exa" | "tavily" | "firecrawl",
          environment, providers: registry, signal: ac.signal,
          onStart: (reference, index, total) => dispatch({ type: "testProgress", completed: index - 1, total, current: reference }),
          onResult: (row, completed, total) => {
            dispatch({ type: "testResult", provider: effect.provider, entry: toDiag(row) });
            dispatch({ type: "testProgress", completed, total, current: null });
          },
        });
        for (const row of report.results) dispatch({ type: "testResult", provider: effect.provider, entry: toDiag(row) }); // cache tail/not-tested rows too
        const passed = report.results.filter(r => r.status === "success").length;
        dispatch({ type: "testEnd", cancelled: report.cancelled });
        dispatch({ type: "notice", text: msg(state.lang, "testPassed", {
          passed, total: report.results.length, stopped: report.cancelled ? msg(state.lang, "stoppedSuffix") : "",
        }), warn: report.cancelled || passed < report.results.length });
      } else {
        dispatch({ type: "testBegin", provider: effect.provider, mode: "pool", total: 1 });
        const startedAt = Date.now();
        const result = await executeWebSearch(resolveWebSearchInput({ query: "Agent Skills documentation", provider: effect.provider, maxResults: 1, timeoutMs: 5_000 }), {
          config, statePath: options.paths.state, providers: registry, environment, signal: ac.signal,
        });
        const kind = result.ok ? "stSuccess" : "stFailure";
        dispatch({ type: "testResult", provider: effect.provider, entry: {
          when: stamp(), ref: effect.provider, dur: Date.now() - startedAt,
          out: msg(state.lang, kind) + (!result.ok && result.error ? " / " + msg(state.lang, REASON_KEYS[result.error.kind]!) : ""),
        } });
        dispatch({ type: "testEnd", cancelled: ac.signal.aborted });
        dispatch({ type: "notice", text: msg(state.lang, "testPoolSummary", { res: msg(state.lang, kind), n: result.attempts.length })
          + " / " + result.attempts.map(a => `${a.provider} ${a.ok ? msg(state.lang, "stSuccess") : msg(state.lang, REASON_KEYS[(a.errorKind ?? "unknown") as FailureKind]!)}`).join(", "), warn: !result.ok });
      }
    } catch {
      // testSetupKeys/executeWebSearch sanitize their own failures, but display nothing raw from here (ADR 0016)
      dispatch({ type: "testEnd", cancelled: true });
      dispatch({ type: "notice", text: msg(state.lang, "testInfra"), warn: true });
    } finally {
      testAbort = undefined;
      await refresh();
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
      case "testIntent": dispatch({ type: "testIntent" }); break;
      case "details": void openDetails(); break;
      case "preview": void openPreview(); break;
      case "orderSave": dispatch({ type: "orderSave" }); break;
      case "orderToggle": dispatch({ type: "orderToggle" }); break;
      default: dispatch({ type: "notice", text: msg(state.lang, "pendingP3"), warn: true });
    }
  }

  tui.addInputListener((data) => {
    if (process.env.ARKS_TUI_DEBUG) process.stderr.write(state.mode === "form" && state.form?.typing ? `key:len${data.length}\n` : `key:${JSON.stringify(data)}\n`); // opt-in stdin trace; masked typing is length-only
    if (closed) return { consume: true };
    if (matchesKey(data, "ctrl+c")) { close(); return { consume: true }; }
    // Flag-2 kitty terminals also emit key-release events; the engine's own filter
    // lives on the focused-component path, which this global listener bypasses.
    if (isKeyRelease(data)) return { consume: true };
    const ch = printableChar(data); // CSI-u / modifyOtherKeys printables decode to the plain character

    if (state.modal) {
      if (matchesKey(data, Key.up)) dispatch({ type: "modalMove", delta: -1 });
      else if (matchesKey(data, Key.down)) dispatch({ type: "modalMove", delta: 1 });
      else if (matchesKey(data, Key.enter)) dispatch({ type: "modalPick" });
      else if (matchesKey(data, Key.escape)) dispatch({ type: "escape" });
      else if (ch === "y") { state = { ...state, modal: state.modal ? { ...state.modal, cursor: 1 } : null }; dispatch({ type: "modalPick" }); }
      else if (ch === "n") dispatch({ type: "escape" });
      return { consume: true };
    }

    if (state.mode === "form") {
      const paste = PASTE_RE.exec(data);
      if (matchesKey(data, Key.escape)) dispatch({ type: "escape" });
      else if (matchesKey(data, "ctrl+s")) dispatch({ type: "formSave" });
      else if (matchesKey(data, Key.enter)) dispatch({ type: "formEnter" });
      else if (matchesKey(data, Key.backspace)) dispatch({ type: "formBackspace" });
      else if (paste && state.form?.typing) dispatch({ type: "formType", text: printable(paste[1]!.trim()) });
      else if (state.form?.typing && ch) dispatch({ type: "formType", text: printable(ch) });
      return { consume: true };
    }

    if (ioBusy) return { consume: true }; // keys during in-flight IO: drop, never queue
    if (state.mode === "preview") { // r toggles reveal, any other key leaves (values cleared on exit)
      if (ch === "r") dispatch({ type: "reveal" }); else dispatch({ type: "escape" });
      return { consume: true };
    }
    if (state.mode === "details") { dispatch({ type: "escape" }); return { consume: true }; } // any key back
    if (state.testing && matchesKey(data, Key.escape)) { testAbort?.abort(); return { consume: true }; } // Esc stops the run, keeps partial rows
    const onConfig = state.region === "content" && state.page === "config";
    const onProviderList = state.region === "content" && state.page === "providers";
    // Browse keys are page-scoped: arrows move lists and switch context; every action
    // letter acts only on the list it is displayed above. No letter aliases.
    if (ch === "q") dispatch({ type: "quitIntent" });
    else if (matchesKey(data, "tab")) dispatch({ type: "tab", delta: 1 });
    else if (matchesKey(data, "shift+tab")) dispatch({ type: "tab", delta: -1 });
    else if (matchesKey(data, Key.up)) dispatch({ type: "move", delta: -1 });
    else if (matchesKey(data, Key.down)) dispatch({ type: "move", delta: 1 });
    else if (state.region === "top" && matchesKey(data, Key.left)) dispatch({ type: "context", delta: -1 }); // arrows belong to the focused region only
    else if (state.region === "top" && matchesKey(data, Key.right)) dispatch({ type: "context", delta: 1 });
    else if (onConfig && ch === "u") dispatch({ type: "orderMove", delta: -1 });
    else if (onConfig && ch === "d") dispatch({ type: "orderMove", delta: 1 });
    else if (onConfig && ch === " ") dispatch({ type: "orderToggle" });
    else if (onConfig && matchesKey(data, "ctrl+s")) dispatch({ type: "orderSave" });
    else if (matchesKey(data, Key.enter)) dispatch({ type: "enter" });
    else if (matchesKey(data, Key.escape)) dispatch({ type: "escape" });
    else if (onProviderList && ch === "i") { ioBusy = true; void openDetails().finally(() => { ioBusy = false; }); }
    else if (onProviderList && ch === "p") { ioBusy = true; void openPreview().finally(() => { ioBusy = false; }); }
    else if (onProviderList && ch === "a") dispatch({ type: "keyAdd" });
    else if (onProviderList && ch === "e") dispatch({ type: "keyEdit" });
    else if (onProviderList && ch === "d") dispatch({ type: "keyRemoveStart" });
    else if (onProviderList && ch === " ") dispatch({ type: "keyToggle" });
    else if (onProviderList && ch === "v") dispatch({ type: "providerToggle" });
    else if (onProviderList && ch === "t") dispatch({ type: "testIntent" });
    return { consume: true };
  });

  render();
  tui.start();
  void refresh();
  await new Promise<void>((resolve) => { exitResolve = resolve; });
}
