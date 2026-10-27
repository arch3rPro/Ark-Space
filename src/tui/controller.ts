/**
 * Pure workbench state machine (plan §2): (state, event) -> state + effects.
 * No IO, no rendering, no async — the host in index.ts owns loading and
 * command execution and feeds results back as plain events, so every
 * transition (including all form/draft/modal flows) is unit-testable.
 */
import type { ProviderId } from "../protocol/types.js";
import type { SetupSnapshot } from "../config/manage.js";
import { msg } from "./messages.js";
import type { TuiLang } from "./messages.js";

export type Region = "top" | "menu" | "content";
export type Page = "providers" | "config" | "settings" | "diagnostics";
export type Mode = "browse" | "details" | "preview" | "form";
export const CONTEXT_COUNT = 6;                       // 4 web providers + WeKnora + UseGPT (ADR 0024 item 3)
export const MENU_VALUES = ["providers", "config", "settings", "diagnostics", "exit"] as const;

export interface PreviewSource { label: string; value: string }
export interface DiagEntry { when: string; ref: string; out: string }

export interface FormState {
  provider: ProviderId;
  reference: string | null;  // null = add, otherwise edit existing local key
  draft: string;             // typed secret; only ever held in memory (ADR 0016)
  typing: boolean;           // Enter starts editing, Enter commits, Esc reverts
}

export interface ModalState {
  kind: "confirm" | "choose";
  title: string;
  items: { value: string; label: string }[];
  cursor: number;            // confirm: 0 = Cancel default
  tag: string;               // outcome routing, see modalPick below
  context?: { provider?: ProviderId; reference?: string; variable?: string };
}

export interface State {
  lang: TuiLang;
  region: Region;
  menuCursor: number;
  page: Page;
  context: number;          // 0..5
  row: number;
  mode: Mode;
  status: string;
  statusWarn: boolean;
  loading: boolean;
  snapshot: SetupSnapshot | null;
  detailRef: string | null;
  preview: { variable: string; sources: PreviewSource[] } | null;
  revealed: boolean;
  modal: ModalState | null;
  form: FormState | null;
  orderDraft: ProviderId[] | null;
  diagnostics: DiagEntry[];
}

export type Op =
  | { kind: "addKey"; provider: ProviderId; secret: string }
  | { kind: "replaceKey"; provider: ProviderId; reference: string; secret: string }
  | { kind: "removeKey"; provider: ProviderId; reference: string }
  | { kind: "toggleKey"; provider: ProviderId; reference: string; enabled: boolean }
  | { kind: "toggleProvider"; provider: ProviderId; enabled: boolean }
  | { kind: "saveOrder"; order: ProviderId[] }
  | { kind: "setLanguage"; lang: TuiLang };

export type Event =
  | { type: "data"; snapshot: SetupSnapshot }
  | { type: "loadError"; text: string }
  | { type: "tab"; delta: 1 | -1 }
  | { type: "context"; delta: 1 | -1 }
  | { type: "move"; delta: 1 | -1 }
  | { type: "enter" }
  | { type: "escape" }
  | { type: "detailsOpen"; reference: string }
  | { type: "previewOpen"; variable: string; sources: PreviewSource[] }
  | { type: "notice"; text: string; warn?: boolean }
  | { type: "reveal" }
  // P2 mutations and modals
  | { type: "keyAdd" }
  | { type: "keyEdit" }
  | { type: "keyRemoveStart" }
  | { type: "keyToggle" }
  | { type: "providerToggle" }
  | { type: "formType"; text: string }
  | { type: "formBackspace" }
  | { type: "formEnter" }        // start typing / commit field
  | { type: "formSave" }         // Ctrl-S
  | { type: "formDone" }         // host: op succeeded, leave form
  | { type: "languageApply" }
  | { type: "orderMove"; delta: 1 | -1 }
  | { type: "orderDrop" }
  | { type: "orderIncludeStart" }
  | { type: "orderSave" }
  | { type: "modalMove"; delta: 1 | -1 }
  | { type: "modalPick" }
  | { type: "contextSet"; index: number }
  | { type: "pageSet"; page: Page }
  | { type: "rowSet"; row: number }
  | { type: "opDone"; kind: Op["kind"] }
  | { type: "quitIntent" }
  | { type: "language"; lang: TuiLang };

export type Effect = { type: "exit" } | { type: "op"; op: Op };

export function initialState(lang: TuiLang, status: string): State {
  return {
    lang, region: "top", menuCursor: 0, page: "providers", context: 0, row: 0,
    mode: "browse", status, statusWarn: false, loading: true, snapshot: null,
    detailRef: null, preview: null, revealed: false, modal: null, form: null,
    orderDraft: null, diagnostics: [],
  };
}

const REGIONS: Region[] = ["top", "menu", "content"];
const CONFIRM_ITEMS = (lang: TuiLang) => [
  { value: "no", label: msg(lang, "cancelDefault") },
  { value: "yes", label: msg(lang, "confirm") },
];

const PROV_LABELS: Record<string, string> = { exa: "Exa", tavily: "Tavily", firecrawl: "Firecrawl", searxng: "SearXNG" };

export function currentProvider(state: State) {
  return state.snapshot?.providers[state.context] ?? null;
}

/** Rows available on the current content page (clamps for move/enter). */
export function rowCount(state: State): number {
  const snapshot = state.snapshot;
  if (!snapshot) return 0;
  if (state.page === "config") return (state.orderDraft ?? snapshot.providerOrder).length;
  if (state.page === "settings") return 2;
  if (state.page === "diagnostics") return state.diagnostics.length;
  const provider = snapshot.providers[state.context];
  if (!provider) return 0; // WeKnora/UseGPT contexts have no rows until P4
  return provider.id === "searxng" ? provider.instances.length : provider.keys.length;
}

export function dirtyOrder(state: State): boolean {
  const saved = state.snapshot?.providerOrder ?? [];
  const draft = state.orderDraft;
  return draft !== null && draft.join(",") !== saved.join(",");
}

function ensureDraft(state: State): ProviderId[] {
  return state.orderDraft ?? [...(state.snapshot?.providerOrder ?? [])];
}

/** Leave transient modes; secret values are never retained past preview (ADR 0016). */
function rest(state: State): State {
  return { ...state, mode: "browse", detailRef: null, preview: null, revealed: false };
}

function notice(state: State, text: string, warn = false): { state: State; effects: Effect[] } {
  return { state: { ...state, status: text, statusWarn: warn }, effects: [] };
}

function selectedKey(state: State) {
  return currentProvider(state)?.keys[state.row] ?? null;
}

function withForm(state: State, form: FormState | null): State {
  return { ...state, form, mode: form ? "form" : "browse" };
}

/** Guard rows that the P2 write surface does not own (env-only edits are refused). */
function refuseGuard(state: State, key: ReturnType<typeof selectedKey>): { state: State; effects: Effect[] } | null {
  if (!key) return notice(state, msg(state.lang, "noRows"));
  if (state.context >= 4) return notice(state, msg(state.lang, "connPending"));
  const provider = currentProvider(state)!;
  if (provider.id === "searxng") return notice(state, msg(state.lang, "searxngPending"));
  if (key.source === "environment") return notice(state, msg(state.lang, "envGuarded"), true);
  return null;
}

export function reduce(state: State, event: Event): { state: State; effects: Effect[] } {
  // ---- modal owns the keyboard while open; Cancel is row 0 (ADR 0024 item 4) ----
  if (state.modal) {
    const modal = state.modal;
    if (event.type === "modalMove" || event.type === "move" || event.type === "tab") {
      const delta = event.type === "modalMove" ? event.delta : event.type === "move" ? event.delta : event.delta === 1 ? 1 : -1;
      return { state: { ...state, modal: { ...modal, cursor: Math.max(0, Math.min(modal.items.length - 1, modal.cursor + delta)) } }, effects: [] };
    }
    if (event.type === "escape") return { state: { ...state, modal: null }, effects: [] };
    if (event.type === "enter" || event.type === "modalPick") {
      const picked = modal.items[modal.cursor]!;
      const closed: State = { ...state, modal: null };
      switch (modal.tag) {
        case "exit":
          return picked.value === "yes" ? { state: closed, effects: [{ type: "exit" }] } : { state: closed, effects: [] };
        case "remove-key": {
          if (picked.value !== "yes" || !modal.context?.provider || !modal.context.reference) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "op", op: { kind: "removeKey", provider: modal.context.provider, reference: modal.context.reference } }] };
        }
        case "overwrite": {
          if (picked.value !== "yes" || !closed.form) return { state: closed, effects: [] };
          const form = closed.form;
          return { state: closed, effects: [{ type: "op", op: { kind: "replaceKey", provider: form.provider, reference: form.reference!, secret: form.draft } }] };
        }
        case "form-discard":
          return picked.value === "yes" ? { state: withForm(closed, null), effects: [] } : { state: closed, effects: [] };
        case "order-include": {
          if (picked.value === "cancel") return { state: closed, effects: [] };
          const draft = [...ensureDraft(state), picked.value as ProviderId];
          return { state: { ...closed, orderDraft: draft, status: msg(state.lang, "draftUpdated"), statusWarn: false }, effects: [] };
        }
        case "order-save-consent":
          if (picked.value !== "yes" || !state.orderDraft) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "op", op: { kind: "saveOrder", order: [...state.orderDraft] } }] };
        case "order-discard":
          return picked.value === "yes"
            ? { state: { ...closed, orderDraft: null, status: msg(state.lang, "draftDiscarded"), statusWarn: false }, effects: [] }
            : { state: closed, effects: [] };
        default:
          return { state: closed, effects: [] };
      }
    }
    return { state, effects: [] };
  }

  // ---- form owns the keyboard while open ----
  if (state.mode === "form" && state.form) {
    const form = state.form;
    switch (event.type) {
      case "formType": return { state: withForm(state, { ...form, draft: form.draft + event.text }), effects: [] };
      case "formBackspace": return { state: withForm(state, { ...form, draft: form.draft.slice(0, -1) }), effects: [] };
      case "formEnter":
        return form.typing
          ? { state: withForm(state, { ...form, typing: false }), effects: [] } // commit draft into the field
          : { state: withForm(state, { ...form, typing: true }), effects: [] };  // start editing
      case "formSave": {
        if (!form.draft) return notice(state, msg(state.lang, "emptySecret"), true);
        if (form.reference === null) {
          return { state, effects: [{ type: "op", op: { kind: "addKey", provider: form.provider, secret: form.draft } }] };
        }
        const title = msg(state.lang, "overwriteConfirm", { ref: form.reference });
        return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "overwrite" } }, effects: [] };
      }
      case "formDone": return { state: withForm(rest(state), null), effects: [] };
      case "escape": {
        if (form.typing) return { state: withForm(state, { ...form, typing: false, draft: "" }), effects: [] }; // revert field
        if (form.draft) {
          const title = msg(state.lang, "discardFormConfirm");
          return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "form-discard" } }, effects: [] };
        }
        return { state: withForm(rest(state), null), effects: [] };
      }
      default: return { state, effects: [] };
    }
  }

  switch (event.type) {
    case "data": {
      const next = { ...state, snapshot: event.snapshot, loading: false };
      return { state: { ...next, row: Math.max(0, Math.min(next.row, Math.max(0, rowCount(next) - 1))) }, effects: [] };
    }
    case "loadError": return { state: { ...state, loading: false, status: event.text, statusWarn: true }, effects: [] };
    case "language": return { state: { ...state, lang: event.lang }, effects: [] };
    case "notice": return notice(state, event.text, event.warn);

    case "tab": {
      const region = REGIONS[(REGIONS.indexOf(state.region) + (event.delta === 1 ? 1 : REGIONS.length - 1)) % REGIONS.length]!;
      return { state: { ...rest(state), region }, effects: [] };
    }
    case "context": {
      // [ ] switches context only: never enables a provider, never issues requests (ADR 0017)
      const context = (state.context + event.delta + CONTEXT_COUNT) % CONTEXT_COUNT;
      return { state: { ...rest(state), region: "content", context, row: 0 }, effects: [] };
    }
    case "contextSet": {
      const context = Math.max(0, Math.min(CONTEXT_COUNT - 1, event.index));
      return { state: { ...rest(state), region: "content", context, row: 0 }, effects: [] };
    }
    case "pageSet": {
      const next = { ...state, page: event.page, row: 0, region: "content" as Region };
      return { state: event.page === "config" ? { ...next, orderDraft: null } : next, effects: [] };
    }
    case "rowSet": {
      const max = Math.max(0, rowCount(state) - 1);
      return { state: { ...state, region: "content", row: Math.max(0, Math.min(max, event.row)) }, effects: [] };
    }
    case "opDone": {
      if (event.kind === "saveOrder") return { state: { ...state, orderDraft: null }, effects: [] };
      return { state, effects: [] };
    }

    case "move": {
      if (state.mode !== "browse") return { state: rest(state), effects: [] };
      if (state.region === "top") return { state: { ...state, region: "content" }, effects: [] };
      if (state.region === "menu") {
        return { state: { ...state, menuCursor: Math.max(0, Math.min(MENU_VALUES.length - 1, state.menuCursor + event.delta)) }, effects: [] };
      }
      return { state: { ...state, row: Math.max(0, Math.min(Math.max(0, rowCount(state) - 1), state.row + event.delta)) }, effects: [] };
    }

    case "enter": {
      if (state.mode !== "browse") return { state: rest(state), effects: [] };
      if (state.region === "top") return { state: { ...state, region: "content" }, effects: [] };
      if (state.region === "menu") {
        const value = MENU_VALUES[state.menuCursor]!;
        if (value === "exit") return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "exitConfirm"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "exit" } }, effects: [] };
        const next = { ...state, page: value as Page, row: 0, region: "content" as Region };
        return { state: value === "config" ? { ...next, orderDraft: null } : next, effects: [] };
      }
      if (state.page === "settings") return reduce(state, { type: "languageApply" });
      return { state, effects: [] }; // Enter on a key row opens edit via the P2 `e` path
    }

    case "escape": {
      if (state.mode !== "browse") return { state: rest(state), effects: [] };
      if (state.page === "config" && state.region === "content") {
        if (dirtyOrder(state)) {
          const title = msg(state.lang, "discardOrderConfirm");
          return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "order-discard" } }, effects: [] };
        }
      }
      if (state.region === "content") return { state: { ...state, region: "menu" }, effects: [] };
      if (state.region === "menu") return { state: { ...state, region: "top" }, effects: [] };
      return { state, effects: [] };
    }

    case "detailsOpen": return { state: { ...state, mode: "details", detailRef: event.reference }, effects: [] };
    case "previewOpen": return { state: { ...state, mode: "preview", revealed: false, preview: { variable: event.variable, sources: event.sources } }, effects: [] };
    case "reveal": return state.mode === "preview" ? { state: { ...state, revealed: !state.revealed }, effects: [] } : { state, effects: [] };

    case "quitIntent":
      return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "exitConfirm"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "exit" } }, effects: [] };

    // ---------------- P2 mutations ----------------
    case "keyAdd": {
      const provider = currentProvider(state);
      if (!provider || state.context >= 4) return notice(state, msg(state.lang, "connPending"));
      if (provider.id === "searxng") return notice(state, msg(state.lang, "searxngPending"));
      return { state: withForm(state, { provider: provider.id, reference: null, draft: "", typing: true }), effects: [] };
    }
    case "keyEdit": {
      const key = selectedKey(state);
      const guard = refuseGuard(state, key);
      if (guard) return guard;
      return { state: withForm(state, { provider: currentProvider(state)!.id, reference: key!.reference, draft: "", typing: true }), effects: [] };
    }
    case "keyRemoveStart": {
      const key = selectedKey(state);
      const guard = refuseGuard(state, key);
      if (guard) return guard;
      const provider = currentProvider(state)!;
      const title = msg(state.lang, "removeConfirm", { ref: key!.reference });
      return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "remove-key", context: { provider: provider.id, reference: key!.reference } } }, effects: [] };
    }
    case "keyToggle": {
      const key = selectedKey(state);
      if (!key) return notice(state, msg(state.lang, "noRows"));
      const provider = currentProvider(state);
      if (!provider) return notice(state, msg(state.lang, "connPending"));
      // currently disabled/cooldown -> enable; otherwise disable (matches the retired workbench mapping)
      const enabled = key.status === "disabled" || key.status === "cooldown";
      return { state, effects: [{ type: "op", op: { kind: "toggleKey", provider: provider.id, reference: key.reference, enabled } }] };
    }
    case "providerToggle": {
      const provider = currentProvider(state);
      if (!provider) return notice(state, msg(state.lang, "connPending"));
      return { state, effects: [{ type: "op", op: { kind: "toggleProvider", provider: provider.id, enabled: !provider.enabled } }] };
    }
    case "languageApply": {
      const target = (state.row === 1 ? "en" : "zh") as TuiLang;
      return { state, effects: [{ type: "op", op: { kind: "setLanguage", lang: target } }] };
    }

    // ---------------- order draft ----------------
    case "orderMove": {
      const draft = ensureDraft(state);
      const i = state.row;
      const j = event.delta === -1 ? i - 1 : i + 1;
      if (j < 0 || j >= draft.length) return { state, effects: [] };
      [draft[i], draft[j]] = [draft[j]!, draft[i]!];
      return { state: { ...state, orderDraft: draft, row: j }, effects: [] };
    }
    case "orderDrop": {
      const draft = [...ensureDraft(state)];
      if (!draft.length) return { state, effects: [] };
      draft.splice(state.row, 1);
      return { state: { ...state, orderDraft: draft, row: Math.max(0, state.row - 1) }, effects: [] };
    }
    case "orderIncludeStart": {
      const current = ensureDraft(state);
      const excluded = (["exa", "tavily", "firecrawl", "searxng"] as ProviderId[]).filter(id => !current.includes(id));
      if (!excluded.length) return notice(state, msg(state.lang, "allIncluded"));
      const items = [{ value: "cancel", label: msg(state.lang, "cancelDefault") }, ...excluded.map(id => ({ value: id, label: PROV_LABELS[id] ?? id }))];
      return { state: { ...state, modal: { kind: "choose", title: msg(state.lang, "includeChoose"), items, cursor: 0, tag: "order-include" } }, effects: [] };
    }
    case "orderSave": {
      if (!dirtyOrder(state)) return notice(state, msg(state.lang, "orderNoop"));
      const saved = state.snapshot?.providerOrder ?? [];
      const draft = state.orderDraft!;
      const adding = draft.filter(id => !saved.includes(id));
      if (adding.length) {
        const title = msg(state.lang, "orderConsent", { names: adding.map(id => PROV_LABELS[id] ?? id).join(", ") });
        return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "order-save-consent" } }, effects: [] };
      }
      return { state, effects: [{ type: "op", op: { kind: "saveOrder", order: [...draft] } }] };
    }

    default: return { state, effects: [] };
  }
}
