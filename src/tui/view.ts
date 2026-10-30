/**
 * Pure renderers: (state, width) -> lines. No IO. All padding goes through
 * padV (visibleWidth-aware); all glyphs obey the ADR 0024 ASCII rule.
 */
import type { SetupInstanceSnapshot, SetupKeySnapshot, SetupProviderSnapshot } from "../config/manage.js";
import { MENU_VALUES, dirtyOrder, orderRows, pageTabs, selectedTab, selectedConnectionKey, type ModalState, type Page, type State } from "./controller.js";
import { msg } from "./messages.js";
import { DIM, FG, SEL, c, padV } from "./components/style.js";
import { truncateToWidth, visibleWidth } from "./port.js";

export const WEB_LABELS = ["Exa", "Tavily", "Firecrawl", "SearXNG"] as const;

export function contextLabel(index: number): string {
  return index < 4 ? WEB_LABELS[index]! : index === 4 ? "WeKnora" : index === 5 ? "UseGPT" : "Order";
}

export function currentProvider(state: State): SetupProviderSnapshot | null {
  return state.snapshot?.providers[state.context] ?? null;
}

export function currentRowItems(state: State): (SetupKeySnapshot | SetupInstanceSnapshot)[] {
  const provider = currentProvider(state);
  if (!provider) return [];
  return provider.id === "searxng" ? provider.instances : provider.keys;
}

const STATUS_ICON: Record<string, readonly [string, number]> = {
  enabled: ["+", 32], cooldown: ["~", 33], exhausted: ["~", 33], disabled: ["-", 2], unavailable: ["?", 2],
};

export function keyIcon(key: SetupKeySnapshot): readonly [string, number] {
  if (!key.available) return STATUS_ICON.unavailable!;
  return STATUS_ICON[key.status] ?? STATUS_ICON.enabled!;
}

function statusText(state: State, key: SetupKeySnapshot): string {
  if (!key.available) return msg(state.lang, "stUnavailable");
  const map: Record<string, string> = { enabled: "stEnabled", disabled: "stDisabled", cooldown: "stCooldown", exhausted: "stExhausted" };
  return msg(state.lang, map[key.status] ?? "stEnabled");
}

function reasonText(state: State, key: SetupKeySnapshot): string {
  if (!key.healthReason) return "-";
  const map: Record<string, string> = {
    auth: "reasonAuth", permission: "reasonPermission", "rate-limit": "reasonRateLimit", quota: "reasonQuota",
    transient: "reasonTransient", network: "reasonNetwork", "invalid-request": "reasonInvalidRequest",
    "invalid-response": "invalid-response", config: "reasonConfig", unknown: "reasonUnknown",
    "operator-disabled": "reasonOperatorDisabled",
  };
  const key_ = map[key.healthReason];
  return key_ === "invalid-response" ? msg(state.lang, "reasonInvalidResponse") : msg(state.lang, key_ ?? "reasonUnknown");
}

function sourceText(state: State, source: string): string {
  const map: Record<string, string> = { local: "srcLocal", environment: "srcEnvironment", missing: "srcMissing" };
  return msg(state.lang, map[source] ?? source);
}

// ---------------- top strip ----------------
// Centered, width-deterministic slots and a constant-width status chip: the strip
// sits mid-screen and never shifts when content, context, or key counts change.
const CHIP_W = 13;
const MENU_STRIP_KEYS: Record<Page | "exit", string> = {
  providers: "stripProviders", config: "stripConfig", knowledge: "stripKnowledge",
  tools: "stripTools", settings: "pageSettings", exit: "pageExit",
};

/** The strip follows the page: tabs for grouped pages, a centered full name otherwise (and while the menu has focus). */
function stripView(state: State): { tabs: number[] } | { title: string } {
  if (state.region !== "menu") {
    const tabs = pageTabs(state.page);
    if (tabs.length) return { tabs };
  }
  const item: Page | "exit" = state.region === "menu" ? MENU_VALUES[state.menuCursor]! : state.page;
  return { title: msg(state.lang, MENU_STRIP_KEYS[item]) };
}

const stripSegs = (tabs: number[]): string[] => tabs.map(i => `[${contextLabel(i)}]`);
const stripInnerW = (plain: string[]): number => plain.reduce((a, s) => a + s.length, 0) + 3 * Math.max(0, plain.length - 1);
const stripX0 = (width: number, contentW: number): number => Math.max(1, Math.floor((width - contentW - CHIP_W) / 2));

export function stripLine(state: State, width: number): string {
  const view = stripView(state);
  let inner: string;
  let contentW: number;
  if ("tabs" in view) {
    const plain = stripSegs(view.tabs);
    contentW = stripInnerW(plain);
    inner = view.tabs.map((ctx, i) => ctx === selectedTab(state)
      ? (state.region === "top" ? SEL(plain[i]!) : FG("1;36", plain[i]!))
      : DIM(plain[i]!)).join("   ");
  } else {
    contentW = visibleWidth(view.title);
    inner = c("1", view.title);
  }
  let chip = padV(" ", CHIP_W);
  const provider = currentProvider(state);
  if (provider && provider.id !== "searxng" && provider.keys.length) {
    const n = (pred: (k: SetupKeySnapshot) => boolean) => provider.keys.filter(pred).length;
    chip = padV(` ${FG(32, "+" + n(k => k.available && k.status === "enabled"))} ${FG(33, "~" + n(k => k.status === "cooldown" || k.status === "exhausted"))} ${c(2, "-" + n(k => !k.available || k.status === "disabled"))}`, CHIP_W);
  }
  const x0 = stripX0(width, contentW);
  const gap = Math.max(1, width - x0 - contentW - CHIP_W);
  return truncateToWidth(padV(" ".repeat(x0) + inner + " ".repeat(gap) + chip, width), width);
}

/** Visible-column hit ranges for context clicks; absolute context indices; empty in title mode. */
export function stripHits(state: State, width: number): [number, number, number][] {
  const view = stripView(state);
  if (!("tabs" in view) || view.tabs.length < 2) return [];
  const plain = stripSegs(view.tabs);
  const hits: [number, number, number][] = [];
  let off = 0;
  const x0 = stripX0(width, stripInnerW(plain));
  for (let i = 0; i < plain.length; i++) { hits.push([x0 + off, x0 + off + plain[i]!.length, view.tabs[i]!]); off += plain[i]!.length + 3; }
  return hits;
}

// ---------------- left menu ----------------
export function menuLines(state: State, width: number): string[] {
  return MENU_VALUES.map((value, i) => {
    const label = (i === state.menuCursor && state.region === "menu" ? "> " : "  ") + msg(state.lang, "page" + value.charAt(0).toUpperCase() + value.slice(1));
    return i === state.menuCursor && state.region === "menu" ? SEL(padV(label, width)) : padV(label, width);
  });
}

/** Menu rows for mouse hit-testing (row y = index + 1 inside the frame body). */
export function menuHitPage(_state: State, y: number): string | null {
  const value = MENU_VALUES[y];
  return value === undefined ? null : value;
}

// ---------------- content pages ----------------
export function pageLines(state: State, width: number): string[] {
  if (state.loading) return [" " + msg(state.lang, "loading")];
  if (state.mode === "details") return detailsLines(state, width);
  if (state.mode === "preview") return previewLines(state, width);
  if (state.mode === "form" && state.form) return formLines(state, width);
  switch (state.page) {
    case "providers": return providerLines(state, width);
    case "knowledge": return weknoraLines(state, width);
    case "tools": return usegptLines(state, width);
    case "config": return orderLines(state, width);
    case "settings": return languageLines(state, width);
  }
}

export type ButtonDef = { key: string; label: string; event: string };

export function providerButtons(state: State): ButtonDef[] {
  const provider = currentProvider(state);
  if (provider?.id === "searxng") return [
    { key: "a", label: msg(state.lang, "keyAdd"), event: "keyAdd" },
    { key: "e", label: msg(state.lang, "keyEdit"), event: "keyEdit" },
    { key: "d", label: msg(state.lang, "keyRemove"), event: "keyRemove" },
  ];
  if (!provider) return [];
  return [
    { key: "a", label: msg(state.lang, "keyAdd"), event: "keyAdd" },
    { key: "e", label: msg(state.lang, "keyEdit"), event: "keyEdit" },
    { key: "i", label: msg(state.lang, "keyDetails"), event: "details" },
    { key: "p", label: msg(state.lang, "keyPreview"), event: "preview" },
    { key: "t", label: msg(state.lang, "keyTest"), event: "testIntent" },
    { key: "d", label: msg(state.lang, "keyRemove"), event: "keyRemove" },
    { key: "Space", label: msg(state.lang, "keyToggle"), event: "keyToggle" },
  ];
}

/** Page-scoped actions, pinned as the centered bottom row of the content frame. */
export function actionDefs(state: State): { key: string; label: string; event?: string }[] {
  if (state.mode !== "browse") return [];
  if (state.page === "providers") return providerButtons(state).map(b => ({ key: b.key, label: b.label, event: b.event }));
  if (state.page === "knowledge" || state.page === "tools") {
    const key = selectedConnectionKey(state);
    if (!key) return [{ key: "Enter", label: msg(state.lang, "keyRowOp"), event: "enter" }];
    const editable = !key.external && !key.sharedProviders.length;
    return [
      ...(editable ? [{ key: key.hasLocal ? "e" : "a", label: msg(state.lang, key.hasLocal ? "keyEdit" : "keyAdd"), event: key.hasLocal ? "keyEdit" : "keyAdd" }] : []),
      { key: "i", label: msg(state.lang, "keyDetails"), event: "details" },
      { key: "p", label: msg(state.lang, "keyPreview"), event: "preview" },
      ...(editable && key.hasLocal ? [{ key: "d", label: msg(state.lang, "keyRemove"), event: "keyRemove" }] : []),
    ];
  }
  if (state.page === "config") return [
    { key: "u/d", label: msg(state.lang, "keyMoveRow") },
    { key: "Space", label: msg(state.lang, "keyToggle"), event: "orderToggle" },
    { key: "Ctrl-S", label: msg(state.lang, dirtyOrder(state) ? "keySaveStar" : "keySave"), event: "orderSave" },
  ];
  return [];
}
const actionSegs = (defs: { key: string; label: string }[], full: boolean): string[] =>
  defs.map(b => full ? `[${b.key}] ${b.label}` : `[${b.key}]`);
const actionTotal = (segs: string[], gap: number): number => segs.reduce((a, s) => a + s.length, 0) + gap * Math.max(0, segs.length - 1);

/** Shared geometry for the pinned action row: full labels, keys-only fallback, centering. */
function actionLayout(state: State, width: number): { defs: { key: string; label: string; event?: string }[]; plain: string[]; gap: number; x0: number } | null {
  const defs = actionDefs(state);
  if (!defs.length) return null;
  const full = actionSegs(defs, true);
  const useFull = actionTotal(full, 2) <= width;
  const plain = useFull ? full : actionSegs(defs, false);
  const gap = useFull ? 2 : 1;
  return { defs, plain, gap, x0: Math.max(0, Math.floor((width - actionTotal(plain, gap)) / 2)) };
}

export function actionLine(state: State, width: number): string {
  const l = actionLayout(state, width);
  if (!l) return "";
  const segs = l.defs.map((b, i) => c("1;36", `[${b.key}]`)
    + (l.plain[i]!.length === b.key.length + 2 ? "" : (b.key === "Ctrl-S" && state.page === "config" && dirtyOrder(state) ? FG(33, " " + b.label) : " " + b.label)));
  return truncateToWidth(padV(" ".repeat(l.x0) + segs.join(" ".repeat(l.gap)), width), width);
}

/** x ranges for the pinned action row; matches actionLine's layout exactly. */
export function actionHits(state: State, width: number): { event: string; start: number; end: number }[] {
  const l = actionLayout(state, width);
  if (!l) return [];
  const hits: { event: string; start: number; end: number }[] = [];
  let x = l.x0;
  for (let i = 0; i < l.defs.length; i++) {
    if (l.defs[i]!.event) hits.push({ event: l.defs[i]!.event!, start: x, end: x + l.plain[i]!.length });
    x += l.plain[i]!.length + l.gap;
  }
  return hits;
}

function providerLines(state: State, width: number): string[] {
  const provider = currentProvider(state);
  if (!provider) return state.context === 4 ? weknoraLines(state, width) : usegptLines(state, width);
  if (provider.id === "searxng") {
    const urlWidth = Math.min(36, Math.max(18, Math.floor(width * 0.45)));
    const statusWidth = Math.min(14, Math.max(10, Math.floor(width * 0.2)));
    const detailWidth = Math.max(1, width - urlWidth - statusWidth);
    const out = [DIM(padV(" " + truncateToWidth(msg(state.lang, "colUrl"), urlWidth), urlWidth) + padV(truncateToWidth(msg(state.lang, "colStatus"), statusWidth), statusWidth) + truncateToWidth(msg(state.lang, "colCidr"), detailWidth))];
    if (!provider.instances.length) out.push(DIM(" " + msg(state.lang, "noInstances")));
    provider.instances.forEach((instance, i) => {
      const icon: readonly [string, number] = instance.status === "disabled" ? ["-", 2] : instance.status === "cooldown" ? ["~", 33] : ["?", 2];
      const text = instance.status === "disabled" ? msg(state.lang, "stDisabled") : instance.status === "cooldown" ? msg(state.lang, "stCooldown") : msg(state.lang, "stNotProbed");
      const detail = instance.source === "environment" ? msg(state.lang, "externalEnv") : msg(state.lang, "srcLocal") + " / " + instance.allowRanges.length;
      const line = padV(" " + truncateToWidth(instance.baseUrl, urlWidth - 1), urlWidth) + FG(icon[1], padV(truncateToWidth(`${icon[0]} ${text}`, statusWidth), statusWidth)) + truncateToWidth(detail, detailWidth);
      out.push(i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width));
    });
    out.push("", DIM(" " + msg(state.lang, "searxngNote")));
    return [...out, ...diagRows(state, "searxng")];
  }
  const referenceWidth = Math.min(36, Math.max(18, Math.floor(width * 0.45)));
  const statusWidth = Math.min(14, Math.max(10, Math.floor(width * 0.2)));
  const sourceWidth = Math.max(1, width - referenceWidth - statusWidth);
  const out = [DIM(padV(` ${msg(state.lang, "colKey")}`, referenceWidth) + padV(truncateToWidth(msg(state.lang, "colStatus"), statusWidth), statusWidth) + truncateToWidth(msg(state.lang, "colSource"), sourceWidth))];
  if (!provider.keys.length) out.push(DIM(" " + msg(state.lang, "noKeys")));
  provider.keys.forEach((key, i) => {
    const [icon, color] = keyIcon(key);
    const line = padV(" " + truncateToWidth(key.reference, referenceWidth - 1), referenceWidth) + FG(color, padV(truncateToWidth(`${icon} ${statusText(state, key)}`, statusWidth), statusWidth)) + truncateToWidth(sourceText(state, key.source) + (key.source === "environment" && key.hasLocal ? " / " + msg(state.lang, "wekOverride") : ""), sourceWidth);
    out.push(i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width));
  });
  return [...out, ...diagRows(state, provider.id)];
}

function orderLines(state: State, width: number): string[] {
  const order = orderRows(state);
  const out = order.map((id, i) => {
    const index = state.snapshot?.providers.findIndex(p => p.id === id) ?? -1;
    const provider = index >= 0 ? state.snapshot?.providers[index] : undefined;
    const line = padV(" " + truncateToWidth(`${i + 1}. ${WEB_LABELS[index] ?? id}`, 14), 16) + (provider?.enabled ? DIM(msg(state.lang, "stEnabled")) : DIM(msg(state.lang, "stDisabled")));
    return i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width);
  });
  return out;
}

function languageLines(state: State, width: number): string[] {
  const entries: readonly [string, string][] = [["zh", "中文"], ["en", "English"]];
  return entries.map(([value, label], i) => {
    const current = (state.snapshot?.setupLanguage ?? state.lang) === value;
    const line = padV(` ${label}`, 14) + (current ? FG(32, msg(state.lang, "current")) : "");
    return i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width);
  });
}

/** Session test results for one engine, shown under its key/instance list. */
function diagRows(state: State, providerId: string): string[] {
  const results = state.diagnostics.filter(d => d.provider === providerId);
  if (!results.length) return [];
  const out = ["", DIM(" " + msg(state.lang, "diagNote"))];
  for (const e of results.slice(-6)) out.push(padV(` ${e.when}  ${truncateToWidth(e.ref, 22)}`, 38) + padV(e.out, 16) + `+${e.dur}ms`);
  return out;
}

function detailField(label: string, value: string): string {
  return padV(" " + label, 14) + value;
}

function detailsLines(state: State, width: number): string[] {
  const connection = selectedConnectionKey(state);
  if (connection) {
    const source = connection.external ? msg(state.lang, "srcEnvironment") : connection.hasLocal ? msg(state.lang, "srcLocal") : msg(state.lang, "srcMissing");
    return [
      detailField(msg(state.lang, "fieldSource"), source),
      detailField(msg(state.lang, "srcLocalValue"), connection.hasLocal ? "+" : "-"),
      detailField(msg(state.lang, "fieldShared"), connection.sharedProviders.join("/") || "-"),
      "", DIM(" " + msg(state.lang, "connNote")),
    ].map(line => padV(line, width));
  }
  const provider = currentProvider(state);
  const key = provider?.keys.find(k => k.reference === state.detailRef);
  if (!provider || !key) return [" " + msg(state.lang, "previewChanged")];
  const cooldown = key.cooldownRemainingMs ? msg(state.lang, "secondsLeft", { n: Math.ceil(key.cooldownRemainingMs / 1000) }) : "-";
  const shared = [...(key.sharedProviders ?? []), ...(key.sharedConnections ?? [])].join("/") || "-";
  const routing = provider.automaticPosition ? msg(state.lang, "autoPosition", { n: provider.automaticPosition }) : msg(state.lang, "explicitOnly");
  const owners = msg(state.lang, "owned", { n: key.ownedResources });
  const out = [
    detailField(msg(state.lang, "fieldSource"), sourceText(state, key.source) + (key.source === "environment" && key.hasLocal ? " / " + msg(state.lang, "wekOverride") : "")),
    detailField(msg(state.lang, "fieldStatus"), statusText(state, key)),
    detailField(msg(state.lang, "fieldReason"), reasonText(state, key)),
    detailField(msg(state.lang, "fieldCooldownLeft"), cooldown),
    detailField(msg(state.lang, "fieldOwners"), owners),
    detailField(msg(state.lang, "fieldShared"), shared),
    detailField(msg(state.lang, "fieldRouting"), routing),
    detailField(msg(state.lang, "fieldAvailable"), key.available ? "+" : "?"),
  ];
  return out.map(line => padV(line, width));
}

function previewLines(state: State, width: number): string[] {
  const preview = state.preview;
  if (!preview) return [" " + msg(state.lang, "previewMissing")];
  const out = [
    " " + msg(state.lang, "maskedNote"),
    "",
  ];
  for (const source of preview.sources) {
    const shown = state.revealed ? source.value : "*".repeat(Math.min(24, source.value.length));
    out.push(detailField(source.label, shown));
    out.push(padV("", 14) + DIM(msg(state.lang, "chars", { n: source.value.length })));
  }
  return out.map(line => padV(line, width));
}

// ---------------- form page ----------------
function formTitleKey(form: NonNullable<State["form"]>): string {
  return form.intent === "key" ? (form.reference ? "formTitleEdit" : "formTitleAdd")
    : form.intent === "instAdd" ? "formInstAdd" : form.intent === "instEdit" ? "formInstEdit"
    : form.intent === "cidrAdd" || form.intent === "cidrEdit" ? "formCidr"
    : form.intent === "wekUrl" ? "wekUrlFormTitle" : form.intent === "wekKey" ? "wekKeyFormTitle"
    : form.intent === "usegptTunnel" ? "usegptTunnelFormTitle" : form.intent === "usegptDir" ? "usegptDirFormTitle"
    : form.intent === "usegptKey" ? "usegptKeyFormTitle" : "wekKbFormTitle";
}

function formLines(state: State, width: number): string[] {
  const form = state.form!;
  const secret = form.field === "secret";
  const labelKey = secret ? "fieldSecretLabel" : form.field === "url" ? "fieldUrlLabel" : form.field === "cidr" ? "fieldCidrLabel" : "fieldTextLabel";
  const shown = secret ? "*".repeat(Math.min(form.draft.length, Math.max(0, width - 24))) : form.draft;
  const field = ` ${msg(state.lang, labelKey)}: ${shown}${form.typing ? "|" : ""}`;
  const titleKey = formTitleKey(form);
  const titleRef = form.intent === "key" || form.intent === "instEdit" ? form.reference : form.intent.startsWith("cidr") ? form.pending?.url : null;
  const title = " " + msg(state.lang, titleKey) + (titleRef ? " / " + titleRef : "");
  const hintKey = secret ? (form.typing ? "fieldSecretTyping" : "fieldSecretHint") : (form.typing ? "fieldPlainTyping" : "fieldPlainHint");
  const out = [
    title,
    "",
    form.draft || !form.typing ? field : ` ${msg(state.lang, labelKey)}: |`,
    " " + DIM(msg(state.lang, "chars", { n: [...form.draft].length })),
    "",
    DIM(" " + msg(state.lang, hintKey)),
    ...(secret ? [DIM(" " + msg(state.lang, "keyStorageNote")), DIM(" " + (state.credentialFile ?? "credentials.json").replace(/[\u0000-\u001f\u007f-\u009f]/g, "?"))] : []),
  ];
  return out.map(line => padV(line, width));
}

/** Connection pages: label/value rows; Enter on a row triggers its action (contexts 4/5). */
function connRows(state: State, width: number, rows: [string, string][], note: string): string[] {
  const out = rows.map((r, i) => {
    const line = " " + padV(r[0], 24) + r[1];
    return i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width);
  });
  out.push("", DIM(" " + note));
  return out;
}

function weknoraLines(state: State, width: number): string[] {
  const wk = state.weknora;
  const keyText = !wk ? msg(state.lang, "wekMissing")
    : wk.source === "environment-override" ? msg(state.lang, "srcEnvironment") + " / " + msg(state.lang, "wekOverride")
    : wk.source === "environment" ? msg(state.lang, "srcEnvironment")
    : wk.hasLocal ? msg(state.lang, "srcLocal") : msg(state.lang, "wekMissing");
  const note = wk?.status === "conflict" ? msg(state.lang, "wekConflictGuard")
    : wk && wk.source !== "managed" ? msg(state.lang, "wekExternalGuard")
    : wk?.status === "missing" ? msg(state.lang, "wekMissing") : msg(state.lang, "wekNote");
  return connRows(state, width, [
    [msg(state.lang, "rowEndpoint"), wk?.baseUrl ? truncateToWidth(wk.baseUrl, Math.max(8, width - 20)) : msg(state.lang, "wekMissing")],
    [msg(state.lang, "rowKey"), keyText],
    [msg(state.lang, "rowKb"), wk?.defaultKnowledgeBaseId ?? msg(state.lang, "wekMissing")],
    [msg(state.lang, "rowVerify"), msg(state.lang, "wekVerifyHint")],
    [msg(state.lang, "rowRemoveConn"), msg(state.lang, "wekRemoveHint")],
  ], note);
}

function usegptLines(state: State, width: number): string[] {
  const u = state.usegpt;
  const note = !u?.configured ? msg(state.lang, "usegptNotConfigured") : msg(state.lang, "usegptNote");
  const keyText = u?.keySource === "environment" ? msg(state.lang, "srcEnvironment") + (u.savedKey ? " / " + msg(state.lang, "wekOverride") : "")
    : u?.keySource === "file" ? msg(state.lang, "srcLocal")
    : u?.keySource === "invalid" ? msg(state.lang, "invalidEnvKey") : msg(state.lang, "wekMissing");
  return connRows(state, width, [
    [msg(state.lang, "rowHub"), msg(state.lang, u?.daemonRunning ? "svcRunning" : "svcStopped") + " / " + msg(state.lang, u?.daemonRunning ? "stopHubHint" : "startHubHint")],
    [msg(state.lang, "rowTunnel"), msg(state.lang, u?.tunnelRunning ? "svcRunning" : "svcStopped") + " / " + msg(state.lang, u?.tunnelRunning ? "stopTunnelHint" : "startTunnelHint")],
    [msg(state.lang, "rowDiagnose"), msg(state.lang, "diagHint")],
    [msg(state.lang, "rowUseGptTunnel"), u?.tunnelId ? truncateToWidth(u.tunnelId, Math.max(8, width - 20)) : msg(state.lang, "wekMissing")],
    [msg(state.lang, "rowUseGptDir"), u?.dataDir ? truncateToWidth(u.dataDir, Math.max(8, width - 20)) : msg(state.lang, "wekMissing")],
    [msg(state.lang, "rowUseGptKey"), keyText],
    [msg(state.lang, "rowRestoreUseGpt"), msg(state.lang, "usegptRestoreHint")],
  ], note);
}

// ---------------- modal ----------------
export function modalLines(modal: ModalState, width: number): string[] {
  const out: string[] = [];
  if (modal.note) for (const line of modal.note.split("\n")) out.push(DIM(padV(" " + line, width)));
  if (modal.note) out.push(padV("", width));
  modal.items.forEach((item, i) => {
    const line = (i === modal.cursor ? "> " : "  ") + item.label;
    out.push(i === modal.cursor ? SEL(padV(line, width)) : padV(line, width));
  });
  return out;
}

// ---------------- titles + key bar ----------------
export function contentTitle(state: State): string {
  if (state.mode === "details") return msg(state.lang, "detailsTitle") + " / " + (state.detailRef ?? "");
  if (state.mode === "preview") return msg(state.lang, "previewTitle") + " / " + (state.preview?.variable ?? "");
  if (state.mode === "form" && state.form) return msg(state.lang, formTitleKey(state.form)) + " / " + contextLabel(state.context);
  if (state.page === "providers") return contextLabel(state.context);
  if (state.page === "knowledge") return "WeKnora";
  if (state.page === "tools") return "UseGPT";
  if (state.page === "config") {
    return msg(state.lang, "pageConfig") + " / " + (dirtyOrder(state) ? FG(33, msg(state.lang, "unsaved")) : msg(state.lang, "unchanged"));
  }
  return msg(state.lang, "page" + state.page.charAt(0).toUpperCase() + state.page.slice(1));
}

/** Global keys share the content frame's inner geometry and keys-only fallback; magenta keeps them visibly separate. */
export function keyBar(state: State, width: number, offset = 0): string {
  const defs: { key: string; label: string }[] = [{ key: "Tab", label: msg(state.lang, "keyFocus") }];
  if (state.modal) {
    defs.push({ key: "up/dn", label: msg(state.lang, "keyMove") }, { key: "Enter", label: msg(state.lang, "keyPick") });
    if (state.modal.kind === "confirm" && state.modal.items[1]?.value === "yes") defs.push({ key: "y/n", label: msg(state.lang, "keyQuickPick") });
    defs.push({ key: "Esc", label: msg(state.lang, "keyBack") });
  }
  else if (state.mode === "details") defs.push({ key: "...", label: msg(state.lang, "keyAnyBack") });
  else if (state.mode === "preview") defs.push({ key: "r", label: msg(state.lang, "keyReveal") }, { key: "...", label: msg(state.lang, "keyAnyBack") });
  else if (state.mode === "browse") defs.push({ key: "Enter", label: msg(state.lang, "keyOpen") }, { key: "Esc", label: msg(state.lang, "keyBack") });
  // form mode: commit/save/cancel hints render inside the form itself
  defs.push({ key: "<-/->", label: msg(state.lang, "keyContext") }, { key: "q", label: msg(state.lang, "keyQuit") });
  const inner = Math.max(10, width - offset - 4); // content frame inner region: borders + one pad column each side
  const segs = (full: boolean) => defs.map(d => full ? `[${d.key}]${d.label}` : `[${d.key}]`);
  const total = (ss: string[], gap: number) => ss.reduce((a, x) => a + x.length, 0) + gap * (ss.length - 1);
  let plain = segs(true);
  let gap = 3;
  if (total(plain, gap) > inner) { plain = segs(false); gap = 1; } // same narrow-screen fallback as the action row
  const colored = plain.map((pl, i) => c("1;35", `[${defs[i]!.key}]`) + pl.slice(defs[i]!.key.length + 2));
  const x0 = offset + 2 + Math.max(0, Math.floor((inner - total(plain, gap)) / 2));
  return truncateToWidth(padV(" ".repeat(x0) + colored.join(" ".repeat(gap)), width), width);
}
