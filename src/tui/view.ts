/**
 * Pure renderers: (state, width) -> lines. No IO. All padding goes through
 * padV (visibleWidth-aware); all glyphs obey the ADR 0024 ASCII rule.
 */
import type { SetupInstanceSnapshot, SetupKeySnapshot, SetupProviderSnapshot } from "../config/manage.js";
import { CONTEXT_COUNT, MENU_VALUES, dirtyOrder, type ModalState, type State } from "./controller.js";
import { msg } from "./messages.js";
import { DIM, FG, SEL, c, padV } from "./components/style.js";
import { truncateToWidth } from "./port.js";

export const WEB_LABELS = ["Exa", "Tavily", "Firecrawl", "SearXNG"] as const;

export function contextLabel(index: number): string {
  return index < 4 ? WEB_LABELS[index]! : index === 4 ? "WeKnora" : "UseGPT";
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
// Fixed left-aligned slots and a constant-width status chip: the labels never
// shift when content, context, or provider counts change (user complaint P6: strip drift).
const STRIP_X0 = 2;
const CHIP_W = 13;
const stripInnerWidth = (): number =>
  Array.from({ length: CONTEXT_COUNT }, (_, i) => `[${contextLabel(i)}]`.length).reduce((a, s) => a + s, 0) + 3 * (CONTEXT_COUNT - 1);

export function stripLine(state: State, width: number): string {
  const segs = Array.from({ length: CONTEXT_COUNT }, (_, i) => `[${contextLabel(i)}]`);
  const labels = segs.map((s, i) => {
    if (i === state.context) return state.region === "top" ? SEL(s) : FG("1;36", s);
    const provider = state.snapshot?.providers[i];
    if (!provider) return DIM(s); // connection contexts: no enabled state until P4
    return provider.enabled ? DIM(s) : c("2", s);
  });
  const inner = labels.join("   ");
  let chip = padV(" ", CHIP_W);
  const provider = currentProvider(state);
  if (provider && provider.id !== "searxng") {
    const n = (pred: (k: SetupKeySnapshot) => boolean) => provider.keys.filter(pred).length;
    chip = padV(` ${FG(32, "+" + n(k => k.available && k.status === "enabled"))} ${FG(33, "~" + n(k => k.status === "cooldown" || k.status === "exhausted"))} ${c(2, "-" + n(k => !k.available || k.status === "disabled"))}`, CHIP_W);
  }
  const gap = Math.max(1, width - STRIP_X0 - stripInnerWidth() - CHIP_W);
  return truncateToWidth(padV(" ".repeat(STRIP_X0) + inner + " ".repeat(gap) + chip, width), width);
}

/** Visible-column hit ranges for context clicks; must match stripLine's slot layout. */
export function stripHits(_width: number): [number, number, number][] {
  const segs = Array.from({ length: CONTEXT_COUNT }, (_, i) => `[${contextLabel(i)}]`);
  const hits: [number, number, number][] = [];
  let off = 0;
  for (let i = 0; i < segs.length; i++) { hits.push([STRIP_X0 + off, STRIP_X0 + off + segs[i]!.length, i]); off += segs[i]!.length + 3; }
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
    case "config": return orderLines(state, width);
    case "settings": return languageLines(state, width);
    case "diagnostics": return diagnosticLines(state, width);
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

/** x ranges for the rendered button bar (matches providerLines layout exactly). */
export function buttonHits(state: State): { event: string; start: number; end: number }[] {
  let x = 1;
  return providerButtons(state).map(b => {
    const seg = `[${b.key}] ${b.label}`;
    const hit = { event: b.event, start: x, end: x + seg.length };
    x += seg.length + 2;
    return hit;
  });
}

function providerLines(state: State, width: number): string[] {
  const provider = currentProvider(state);
  if (!provider) return state.context === 4 ? weknoraLines(state, width) : usegptLines(state, width);
  if (provider.id === "searxng") {
    const out = [DIM(padV(" " + msg(state.lang, "colUrl"), 28) + padV("  " + msg(state.lang, "colStatus"), 14) + msg(state.lang, "colCidr"))];
    if (!provider.instances.length) out.push(DIM(" " + msg(state.lang, "noInstances")));
    provider.instances.forEach((instance, i) => {
      const icon: readonly [string, number] = instance.status === "disabled" ? ["-", 2] : instance.status === "cooldown" ? ["~", 33] : ["?", 2];
      const text = instance.status === "disabled" ? msg(state.lang, "stDisabled") : instance.status === "cooldown" ? msg(state.lang, "stCooldown") : msg(state.lang, "stNotProbed");
      const line = padV(" " + truncateToWidth(instance.baseUrl, 26), 28) + FG(icon[1], `${icon[0]} `) + padV(text, 12) + (instance.source === "environment" ? DIM(msg(state.lang, "externalEnv")) : DIM(msg(state.lang, "srcLocal") + " / " + instance.allowRanges.length));
      out.push(i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width));
    });
    out.push("", DIM(" " + msg(state.lang, "searxngNote")));
    const buttons = providerButtons(state);
    out.push(" "+buttons.map(b => c("1;36", `[${b.key}]`) + " " + b.label).join("  "));
    return out;
  }
  const out = [DIM(padV(` ${msg(state.lang, "colKey")}`, 22) + padV(msg(state.lang, "colStatus"), 12) + padV(msg(state.lang, "colSource"), 12) + msg(state.lang, "colOwner"))];
  if (!provider.keys.length) out.push(DIM(" " + msg(state.lang, "noKeys")));
  provider.keys.forEach((key, i) => {
    const [icon, color] = keyIcon(key);
    const line = padV(" " + truncateToWidth(key.reference, 20), 22) + FG(color, padV(`${icon} ${statusText(state, key)}`, 12)) + padV(sourceText(state, key.source), 12) + msg(state.lang, "owned", { n: key.ownedResources });
    out.push(i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width));
  });
  const buttons = providerButtons(state);
  out.push("", " " + buttons.map(b => c("1;36", `[${b.key}]`) + " " + b.label).join("  "));
  return out;
}

function orderLines(state: State, width: number): string[] {
  const order = state.orderDraft ?? state.snapshot?.providerOrder ?? [];
  const out = order.map((id, i) => {
    const index = state.snapshot?.providers.findIndex(p => p.id === id) ?? -1;
    const provider = index >= 0 ? state.snapshot?.providers[index] : undefined;
    const line = padV(" " + truncateToWidth(`${i + 1}. ${WEB_LABELS[index] ?? id}`, 14), 16) + (provider?.enabled ? DIM(msg(state.lang, "stEnabled")) : DIM(msg(state.lang, "stDisabled")));
    return i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width);
  });
  const btn = [
    { key: "u/d", label: msg(state.lang, "keyMoveRow") },
    { key: "Del", label: msg(state.lang, "keyDrop") },
    { key: "I", label: msg(state.lang, "keyInclude") },
    { key: "Ctrl-S", label: dirtyOrder(state) ? FG(33, msg(state.lang, "keySaveStar")) : msg(state.lang, "keySave") },
  ];
  out.push("", " " + btn.map(b => c("1;36", `[${b.key}]`) + " " + b.label).join("  "));
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

function diagnosticLines(state: State, width: number): string[] {
  const out = [DIM(" " + msg(state.lang, "diagNote"))];
  if (!state.diagnostics.length) out.push(DIM(" " + msg(state.lang, "diagEmpty")));
  state.diagnostics.forEach((entry, i) => {
    const line = padV(` ${entry.when}  ${entry.ref}`, width - 24) + padV(entry.out, 12) + `+${entry.dur}ms`;
    out.push(i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width));
  });
  return out;
}

function detailField(label: string, value: string): string {
  return padV(" " + label, 14) + value;
}

function detailsLines(state: State, width: number): string[] {
  const provider = currentProvider(state);
  const key = provider?.keys.find(k => k.reference === state.detailRef);
  if (!provider || !key) return [" " + msg(state.lang, "previewChanged")];
  const cooldown = key.cooldownRemainingMs ? msg(state.lang, "secondsLeft", { n: Math.ceil(key.cooldownRemainingMs / 1000) }) : "-";
  const shared = [...(key.sharedProviders ?? []), ...(key.sharedConnections ?? [])].join("/") || "-";
  const routing = provider.automaticPosition ? msg(state.lang, "autoPosition", { n: provider.automaticPosition }) : msg(state.lang, "explicitOnly");
  const owners = msg(state.lang, "owned", { n: key.ownedResources });
  const out = [
    detailField(msg(state.lang, "fieldSource"), sourceText(state, key.source)),
    detailField(msg(state.lang, "fieldStatus"), statusText(state, key)),
    detailField(msg(state.lang, "fieldReason"), reasonText(state, key)),
    detailField(msg(state.lang, "fieldCooldownLeft"), cooldown),
    detailField(msg(state.lang, "fieldOwners"), owners),
    detailField(msg(state.lang, "fieldShared"), shared),
    detailField(msg(state.lang, "fieldRouting"), routing),
    detailField(msg(state.lang, "fieldAvailable"), key.available ? "+" : "?"),
    "", DIM(" " + msg(state.lang, "refreshNote")),
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
  const hintKey = secret ? (form.typing ? "fieldSecretTyping" : "fieldSecretHint") : "fieldPlainHint";
  const out = [
    title,
    "",
    form.draft || !form.typing ? field : ` ${msg(state.lang, labelKey)}: |`,
    " " + DIM(msg(state.lang, "chars", { n: [...form.draft].length })),
    "",
    DIM(" " + msg(state.lang, hintKey)),
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
    : wk.source === "environment" || wk.source === "environment-override" ? msg(state.lang, "wekEnv")
    : wk.hasLocal ? msg(state.lang, "wekManaged") : msg(state.lang, "wekMissing");
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
  const run = (b: boolean | undefined) => b ? FG(32, msg(state.lang, "svcRunning")) : msg(state.lang, "svcStopped");
  const note = !u?.configured ? msg(state.lang, "usegptNotConfigured") : msg(state.lang, "usegptNote");
  const keyText = u?.keySource === "environment" ? msg(state.lang, "wekEnv")
    : u?.keySource === "file" ? msg(state.lang, "wekManaged")
    : u?.keySource === "invalid" ? msg(state.lang, "previewInvalidEnv") : msg(state.lang, "wekMissing");
  return connRows(state, width, [
    [msg(state.lang, "rowHub"), run(u?.daemonRunning)],
    [msg(state.lang, "rowTunnel"), run(u?.tunnelRunning)],
    [msg(state.lang, "rowStart"), msg(state.lang, "startHint")],
    [msg(state.lang, "rowStop"), msg(state.lang, "stopHint")],
    [msg(state.lang, "rowDiagnose"), msg(state.lang, "diagHint")],
    [msg(state.lang, "rowUseGptTunnel"), u?.tunnelId ? truncateToWidth(u.tunnelId, Math.max(8, width - 20)) : msg(state.lang, "wekMissing")],
    [msg(state.lang, "rowUseGptDir"), u?.dataDir ? truncateToWidth(u.dataDir, Math.max(8, width - 20)) : msg(state.lang, "wekMissing")],
    [msg(state.lang, "rowUseGptKey"), keyText],
    [msg(state.lang, "rowUnlinkUseGpt"), msg(state.lang, "usegptUnlinkHint")],
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
  if (state.page === "config") {
    return msg(state.lang, "pageConfig") + " / " + (dirtyOrder(state) ? FG(33, msg(state.lang, "unsaved")) : msg(state.lang, "unchanged"));
  }
  return msg(state.lang, "page" + state.page.charAt(0).toUpperCase() + state.page.slice(1));
}

const kb = (key: string, label: string) => c("1;36", `[${key}]`) + label;

export function keyBar(state: State): string {
  const parts = [kb("Tab", msg(state.lang, "keyFocus"))];
  if (state.modal) parts.push(kb("up/dn", msg(state.lang, "keyMove")), kb("Enter", msg(state.lang, "keyPick")), kb("y/n", msg(state.lang, "keyQuickPick")), kb("Esc", msg(state.lang, "keyBack")));
  else if (state.mode === "form") parts.push(kb("Enter", msg(state.lang, "keyCommit")), kb("Ctrl-S", msg(state.lang, "keySave")), kb("Esc", msg(state.lang, "keyBack")));
  else if (state.mode === "details") parts.push(kb("...", msg(state.lang, "keyAnyBack")));
  else if (state.mode === "preview") parts.push(kb("r", msg(state.lang, "keyReveal")), kb("...", msg(state.lang, "keyAnyBack")));
  else if (state.region === "content" && state.page === "providers") {
    if (state.context >= 4) parts.push(kb("Enter", msg(state.lang, "keyRowOp")));
    else if (state.context === 3) parts.push(kb("a", msg(state.lang, "keyAdd")), kb("e", msg(state.lang, "keyEdit")), kb("d", msg(state.lang, "keyRemove")));
    else parts.push(kb("a", msg(state.lang, "keyAdd")), kb("e", msg(state.lang, "keyEdit")), kb("i", msg(state.lang, "keyDetails")), kb("p", msg(state.lang, "keyPreview")), kb("d", msg(state.lang, "keyRemove")), kb("Space", msg(state.lang, "keyToggle")));
    parts.push(kb("v", msg(state.lang, "keyEnable")), kb("t", msg(state.lang, "keyTest")));
  }
  else if (state.region === "content" && state.page === "config") parts.push(kb("u/d", msg(state.lang, "keyMoveRow")), kb("Del", msg(state.lang, "keyDrop")), kb("I", msg(state.lang, "keyInclude")), kb("Ctrl-S", state.orderDraft ? FG(33, msg(state.lang, "keySaveStar")) : msg(state.lang, "keySave")));
  else if (state.region === "menu") parts.push(kb("Enter", msg(state.lang, "keyOpen")), kb("Esc", msg(state.lang, "keyBack")));
  parts.push(kb("<-/->", msg(state.lang, "keyContext")), kb("q", msg(state.lang, "keyQuit")));
  return "  " + parts.join(" ");
}
