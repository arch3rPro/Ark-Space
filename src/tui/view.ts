/**
 * Pure renderers: (state, width) -> lines. No IO. All padding goes through
 * padV (visibleWidth-aware); all glyphs obey the ADR 0024 ASCII rule.
 */
import type { SetupInstanceSnapshot, SetupKeySnapshot, SetupProviderSnapshot } from "../config/manage.js";
import { CONTEXT_COUNT, MENU_VALUES, dirtyOrder, type ModalState, type State } from "./controller.js";
import { msg } from "./messages.js";
import { DIM, FG, SEL, c, padV } from "./components/style.js";
import { truncateToWidth, visibleWidth } from "./port.js";

export const WEB_LABELS = ["Exa", "Tavily", "Firecrawl", "SearXNG"] as const;

export function contextLabel(state: State, index: number): string {
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
export function stripLine(state: State, width: number): string {
  const segs = Array.from({ length: CONTEXT_COUNT }, (_, i) => `[${contextLabel(state, i)}]`);
  const labels = segs.map((s, i) => {
    if (i === state.context) return state.region === "top" ? SEL(s) : FG("1;36", s);
    const provider = state.snapshot?.providers[i];
    if (!provider) return DIM(s); // connection contexts: no enabled state until P4
    return provider.enabled ? DIM(s) : c("2", s);
  });
  const inner = labels.join("   ");
  const provider = currentProvider(state);
  let chip = " ";
  if (provider && provider.id !== "searxng") {
    const n = (pred: (k: SetupKeySnapshot) => boolean) => provider.keys.filter(pred).length;
    chip = padV(` ${FG(32, "+" + n(k => k.available && k.status === "enabled"))} ${FG(33, "~" + n(k => k.status === "cooldown" || k.status === "exhausted"))} ${c(2, "-" + n(k => !k.available || k.status === "disabled"))}`, 13);
  }
  const innerW = segs.reduce((a, s) => a + s.length, 0) + 3 * (segs.length - 1);
  let x0 = Math.max(1, Math.floor((width - innerW - visibleWidth(chip)) / 2));
  x0 = Math.min(x0, Math.max(1, width - innerW - visibleWidth(chip) - 1));
  const line = " ".repeat(x0) + inner;
  return padV(line + " ".repeat(Math.max(1, width - x0 - innerW - visibleWidth(chip))) + chip, width);
}

/** Visible-column hit ranges for context clicks. */
export function stripHits(width: number): [number, number, number][] {
  const segs = Array.from({ length: CONTEXT_COUNT }, (_, i) => `[${contextLabel({} as State, i)}]`);
  const innerW = segs.reduce((a, s) => a + s.length, 0) + 3 * (segs.length - 1);
  let x0 = Math.max(1, Math.floor((width - innerW - 13) / 2));
  x0 = Math.min(x0, Math.max(1, width - innerW - 13 - 1));
  const hits: [number, number, number][] = [];
  let off = 0;
  for (let i = 0; i < segs.length; i++) { hits.push([x0 + off, x0 + off + segs[i]!.length, i]); off += segs[i]!.length + 3; }
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
export function menuHitPage(state: State, y: number): string | null {
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
  if (!provider || provider.id === "searxng") return [];
  void state;
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
  if (!provider) return [" " + contextLabel(state, state.context) + " / " + msg(state.lang, "connNote")];
  if (provider.id === "searxng") {
    const out = [DIM(` ${padV(msg(state.lang, "colUrl"), 16)}${msg(state.lang, "colStatus")}     ${msg(state.lang, "colCidr")}`)];
    if (!provider.instances.length) out.push(DIM(" " + msg(state.lang, "noInstances")));
    provider.instances.forEach((instance, i) => {
      const icon: readonly [string, number] = instance.status === "disabled" ? ["-", 2] : instance.status === "cooldown" ? ["~", 33] : ["?", 2];
      const text = instance.status === "disabled" ? msg(state.lang, "stDisabled") : instance.status === "cooldown" ? msg(state.lang, "stCooldown") : msg(state.lang, "stNotProbed");
      const line = padV(" " + truncateToWidth(instance.baseUrl, 32), 34) + FG(icon[1], `${icon[0]} `) + padV(text, 18) + (instance.source === "environment" ? DIM(msg(state.lang, "externalEnv")) : DIM(msg(state.lang, "srcLocal") + " / " + instance.allowRanges.length));
      out.push(i === state.row && state.region === "content" ? SEL(padV(line, width)) : padV(line, width));
    });
    out.push("", DIM(" " + msg(state.lang, "searxngNote")));
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

function detailField(lang: State["lang"], label: string, value: string): string {
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
    detailField(state.lang, msg(state.lang, "fieldSource"), sourceText(state, key.source)),
    detailField(state.lang, msg(state.lang, "fieldStatus"), statusText(state, key)),
    detailField(state.lang, msg(state.lang, "fieldReason"), reasonText(state, key)),
    detailField(state.lang, msg(state.lang, "fieldCooldownLeft"), cooldown),
    detailField(state.lang, msg(state.lang, "fieldOwners"), owners),
    detailField(state.lang, msg(state.lang, "fieldShared"), shared),
    detailField(state.lang, msg(state.lang, "fieldRouting"), routing),
    detailField(state.lang, msg(state.lang, "fieldAvailable"), key.available ? "+" : "?"),
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
    out.push(detailField(state.lang, source.label, shown));
    out.push(padV("", 14) + DIM(msg(state.lang, "chars", { n: source.value.length })));
  }
  return out.map(line => padV(line, width));
}

// ---------------- form page ----------------
function formLines(state: State, width: number): string[] {
  const form = state.form!;
  const masked = "*".repeat(Math.min(form.draft.length, Math.max(0, width - 24)));
  const field = ` ${msg(state.lang, "fieldSecretLabel")}: ${masked}${form.typing ? "|" : ""}`;
  const out = [
    form.reference ? ` ${msg(state.lang, "formTitleEdit")} / ${form.reference}` : ` ${msg(state.lang, "formTitleAdd")}`,
    "",
    form.draft || !form.typing ? field : ` ${msg(state.lang, "fieldSecretLabel")}: |`,
    " " + DIM(msg(state.lang, "chars", { n: [...form.draft].length })),
    "",
    DIM(" " + (form.typing ? msg(state.lang, "fieldSecretTyping") : msg(state.lang, "fieldSecretHint"))),
  ];
  return out.map(line => padV(line, width));
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
  if (state.mode === "form" && state.form) return msg(state.lang, state.form.reference ? "formTitleEdit" : "formTitleAdd") + " / " + contextLabel(state, state.context);
  if (state.page === "providers") return contextLabel(state, state.context);
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
  else if (state.region === "content" && state.page === "providers") parts.push(kb("a", msg(state.lang, "keyAdd")), kb("e", msg(state.lang, "keyEdit")), kb("i", msg(state.lang, "keyDetails")), kb("p", msg(state.lang, "keyPreview")), kb("d", msg(state.lang, "keyRemove")), kb("Space", msg(state.lang, "keyToggle")));
  else if (state.region === "content" && state.page === "config") parts.push(kb("u/d", msg(state.lang, "keyMoveRow")), kb("Del", msg(state.lang, "keyDrop")), kb("I", msg(state.lang, "keyInclude")), kb("Ctrl-S", state.orderDraft ? FG(33, msg(state.lang, "keySaveStar")) : msg(state.lang, "keySave")));
  else if (state.region === "menu") parts.push(kb("Enter", msg(state.lang, "keyOpen")), kb("Esc", msg(state.lang, "keyBack")));
  parts.push(kb("[ ]", msg(state.lang, "keyContext")), kb("v", msg(state.lang, "keyEnable")), kb("q", msg(state.lang, "keyQuit")));
  return "  " + parts.join(" ");
}
