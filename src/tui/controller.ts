/**
 * Pure workbench state machine (plan §2): (state, event) -> state + effects.
 * No IO, no rendering, no async — the host in index.ts owns loading and
 * command execution and feeds results back as plain events, so every
 * transition (including all form/draft/modal flows) is unit-testable.
 */
import type { ProviderId } from "../protocol/types.js";
import type { SetupSnapshot, WeknoraConnectionSnapshot } from "../config/manage.js";
import { msg } from "./messages.js";
import type { TuiLang } from "./messages.js";

export type Region = "top" | "menu" | "content";
export type Page = "providers" | "config" | "settings" | "diagnostics";
export type Mode = "browse" | "details" | "preview" | "form";
export const CONTEXT_COUNT = 6;                       // 4 web providers + WeKnora + UseGPT (ADR 0024 item 3)
export const MENU_VALUES = ["providers", "config", "settings", "diagnostics", "exit"] as const;

export interface PreviewSource { label: string; value: string }
export interface DiagEntry { when: string; ref: string; out: string; dur: number }

export interface TestRun {
  provider: string;
  mode: "pool" | "allKeys";
  total: number;
  completed: number;
  current: string | null;
}

export interface FormState {
  provider: ProviderId | "weknora" | "usegpt";
  reference: string | null;  // null = add, otherwise edit existing local key (or old instance URL)
  draft: string;             // typed value; secrets only ever held in memory (ADR 0016)
  typing: boolean;           // Enter starts editing, Enter commits, Esc reverts
  intent: "key" | "instAdd" | "instEdit" | "cidrAdd" | "cidrEdit" | "wekUrl" | "wekKey" | "wekKb" | "usegptTunnel" | "usegptDir" | "usegptKey";
  field: "secret" | "url" | "cidr" | "text";
  pending?: { url: string; oldUrl?: string | undefined }; // cidr second step carries the staged endpoint
}

export interface ModalState {
  kind: "confirm" | "choose";
  title: string;
  items: { value: string; label: string }[];
  cursor: number;            // confirm: 0 = Cancel default
  tag: string;               // outcome routing, see modalPick below
  note?: string;             // consent body shown under the title (split on \n by the view)
  context?: { provider?: ProviderId; reference?: string | undefined; variable?: string | undefined };
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
  testing: TestRun | null;   // live key/pool test in flight (host owns the abort)
  svcBusy: string | null;    // connection service action in flight (start/stop/verify)
  weknora: WeknoraConnectionSnapshot | null;
  usegpt: UseGptStatus | null;
}

export interface UseGptStatus { configured: boolean; daemonRunning: boolean; tunnelRunning: boolean; issues: string[]; tunnelId?: string | undefined; dataDir?: string | undefined; keySource: "missing" | "file" | "environment" | "invalid"; savedKey: boolean }

export type Op =
  | { kind: "addKey"; provider: ProviderId; secret: string }
  | { kind: "replaceKey"; provider: ProviderId; reference: string; secret: string }
  | { kind: "removeKey"; provider: ProviderId; reference: string }
  | { kind: "toggleKey"; provider: ProviderId; reference: string; enabled: boolean }
  | { kind: "toggleProvider"; provider: ProviderId; enabled: boolean }
  | { kind: "saveOrder"; order: ProviderId[] }
  | { kind: "setLanguage"; lang: TuiLang }
  // P4 connection writes
  | { kind: "addInstance"; baseUrl: string; allowRanges: string[] }
  | { kind: "editInstance"; oldBaseUrl: string; baseUrl: string; allowRanges: string[] }
  | { kind: "removeInstance"; baseUrl: string }
  | { kind: "wekSave"; field: "url" | "key" | "kb"; value: string; reuseSavedKey: boolean; secret?: string }
  | { kind: "wekRemove" }
  // P6 connection parity writes (port of the retired v1 shells)
  | { kind: "usegptSave"; field: "tunnelId" | "dataDir"; value: string }
  | { kind: "usegptKey"; secret: string }
  | { kind: "usegptUnlink" };

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
  | { type: "language"; lang: TuiLang }
  // P3 test flow (host feeds runner callbacks back as events; Esc stop lives in the host)
  | { type: "testIntent" }
  | { type: "testBegin"; provider: string; mode: "pool" | "allKeys"; total: number }
  | { type: "testProgress"; completed: number; total: number; current: string | null }
  | { type: "testResult"; provider: string; entry: DiagEntry }
  | { type: "testEnd"; cancelled: boolean }
  // P4 connection events
  | { type: "connData"; weknora: WeknoraConnectionSnapshot | null; usegpt: UseGptStatus | null }
  | { type: "serviceBusy"; on: boolean };

export type Effect =
  | { type: "exit" }
  | { type: "op"; op: Op }
  | { type: "testRun"; provider: ProviderId; mode: "pool" | "allKeys"; references: string[] }
  | { type: "service"; action: "wekVerify" | "usegptStart" | "usegptStop" | "usegptDiagnose" };

export function initialState(lang: TuiLang, status: string, context = 0): State {
  return {
    lang, region: context >= 4 ? "content" : "top", menuCursor: 0, page: "providers", context, row: 0,
    mode: "browse", status, statusWarn: false, loading: true, snapshot: null,
    detailRef: null, preview: null, revealed: false, modal: null, form: null,
    orderDraft: null, diagnostics: [], testing: null, svcBusy: null, weknora: null, usegpt: null,
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
  if (state.context === 4) return 5; // endpoint / key / kb / verify / remove
  if (state.context === 5) return 9; // hub / tunnel / start / stop / diagnose / tunnelId / dir / key / unlink
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
          return { state: closed, effects: [{ type: "op", op: { kind: "replaceKey", provider: form.provider as ProviderId, reference: form.reference!, secret: form.draft } }] };
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
        case "cidr-grant": {
          if (picked.value === "cancel" || !modal.context?.variable) return { state: closed, effects: [] };
          const url = modal.context.variable;
          const oldUrl = modal.context.reference;
          if (picked.value === "grant") {
            const cidr = privateGrant(url);
            return instanceWrite(closed, oldUrl, url, cidr ? [cidr] : []);
          }
          const form: FormState = { provider: "searxng", reference: null, draft: "", typing: true, intent: oldUrl ? "cidrEdit" : "cidrAdd", field: "cidr", pending: { url, oldUrl } };
          return { state: { ...closed, form, mode: "form" as Mode }, effects: [] };
        }
        case "inst-remove":
          if (picked.value !== "yes" || !modal.context?.reference) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "op", op: { kind: "removeInstance", baseUrl: modal.context.reference } }] };
        case "wek-url-reuse": {
          if (picked.value !== "yes" || !modal.context?.variable) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "op", op: { kind: "wekSave", field: "url", value: modal.context.variable, reuseSavedKey: true } }] };
        }
        case "wek-key-replace":
          if (picked.value !== "yes" || !closed.form) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "op", op: { kind: "wekSave", field: "key", value: closed.form.draft, reuseSavedKey: false } }] };
        case "wek-verify": case "usegpt-start": case "usegpt-stop":
          if (picked.value !== "yes") return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "service", action: modal.tag === "wek-verify" ? "wekVerify" : modal.tag === "usegpt-start" ? "usegptStart" : "usegptStop" }] };
        case "wek-remove":
          return { state: closed, effects: picked.value === "yes" ? [{ type: "op", op: { kind: "wekRemove" } }] : [] };
        case "usegpt-key-replace":
          if (picked.value !== "yes" || !closed.form) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "op", op: { kind: "usegptKey", secret: closed.form.draft } }] };
        case "usegpt-unlink":
          return { state: closed, effects: picked.value === "yes" ? [{ type: "op", op: { kind: "usegptUnlink" } }] : [] };
        case "test-scope": {
          if (picked.value === "cancel") return { state: closed, effects: [] };
          const provider = currentProvider(state);
          if (!provider) return { state: closed, effects: [] };
          const references = provider.keys.map(k => k.reference);
          if (picked.value === "all" && !references.length) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "testRun", provider: provider.id, mode: picked.value === "pool" ? "pool" : "allKeys", references }] };
        }
        case "test-live": {
          if (picked.value !== "yes" || !modal.context?.provider) return { state: closed, effects: [] };
          return { state: closed, effects: [{ type: "testRun", provider: modal.context.provider, mode: "pool", references: [] }] };
        }
        default:
          return { state: closed, effects: [] };
      }
    }
    return { state, effects: [] };
  }

  // ---- an in-flight test or service action owns the mutation keys; navigation stays live ----
  if (state.testing || state.svcBusy) {
    switch (event.type) {
      case "testBegin": case "testProgress": case "testResult": case "testEnd":
      case "serviceBusy": case "connData":
      case "notice": case "data": case "language": case "tab": case "context":
      case "contextSet": case "move": case "pageSet": case "rowSet":
        break; // handled by the main switch below
      case "testIntent":
        return notice(state, msg(state.lang, "testBusy"), true);
      default:
        return { state, effects: [] }; // mutations/preview/details are fenced until the run ends
    }
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
      case "formSave": return formSaveEvent(state, form);
      case "formDone": return { state: withForm(rest(state), null), effects: [] };
      case "escape": {
        if (form.typing) return { state: withForm(state, { ...form, typing: false, draft: "" }), effects: [] }; // revert field
        if (form.draft) {
          const title = msg(state.lang, "discardFormConfirm");
          return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "form-discard" } }, effects: [] };
        }
        return { state: withForm(rest(state), null), effects: [] };
      }
      // read-only events must pass through: refresh() lands while the form is still
      // open (applyOp order), and swallowing opFailed notices hid write errors (P5 fix)
      case "data": {
        const next = { ...state, snapshot: event.snapshot, loading: false };
        return { state: { ...next, row: Math.max(0, Math.min(next.row, Math.max(0, rowCount(next) - 1))) }, effects: [] };
      }
      case "connData":
        return { state: { ...state, weknora: event.weknora, usegpt: event.usegpt }, effects: [] };
      case "loadError":
        return { state: { ...state, loading: false, status: event.text, statusWarn: true }, effects: [] };
      case "notice":
        return notice(state, event.text, event.warn);
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
      // any attempted managed write invalidates session diagnostics conservatively (ADR 0017 semantics)
      const cleared = { ...state, diagnostics: [] };
      if (event.kind === "saveOrder") return { state: { ...cleared, orderDraft: null }, effects: [] };
      return { state: cleared, effects: [] };
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
      if (state.page === "providers" && state.context >= 4) return connectionEnter(state);
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

    case "testIntent": {
      if (state.context >= 4) return notice(state, msg(state.lang, "connPending"), true);
      const provider = currentProvider(state);
      if (!provider) return notice(state, msg(state.lang, "noRows"), true);
      const name = PROV_LABELS[provider.id] ?? provider.id;
      if (provider.id === "searxng") {
        if (!provider.instances.length) return notice(state, msg(state.lang, "searxngNoInst"), true);
        const modal: ModalState = { kind: "confirm", title: msg(state.lang, "testLive", { name }), note: msg(state.lang, "testLiveNote"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "test-live", context: { provider: provider.id } };
        return { state: { ...state, modal }, effects: [] };
      }
      const references = provider.keys.map(k => k.reference);
      if (!references.length) return notice(state, msg(state.lang, "noKeysToTest"), true);
      const items = [
        { value: "cancel", label: msg(state.lang, "cancelDefault") },
        { value: "pool", label: msg(state.lang, "poolTest") },
        { value: "all", label: msg(state.lang, "allKeysTest", { n: references.length }) },
      ];
      const modal: ModalState = { kind: "choose", title: msg(state.lang, "testScope", { name }), note: msg(state.lang, "testScopeNote"), items, cursor: 0, tag: "test-scope" };
      return { state: { ...state, modal }, effects: [] };
    }
    case "testBegin": {
      const testing: TestRun = { provider: event.provider, mode: event.mode, total: event.total, completed: 0, current: null };
      // a pool run moves global health/cursor, so earlier session rows are stale by contract
      const diagnostics = event.mode === "pool" ? [] : state.diagnostics;
      const status = event.mode === "pool" ? msg(state.lang, "testingPool") : msg(state.lang, "testingKeys", { done: 0, total: event.total });
      return { state: { ...state, testing, diagnostics, status, statusWarn: false }, effects: [] };
    }
    case "testProgress": {
      if (!state.testing) return { state, effects: [] };
      const status = event.current
        ? msg(state.lang, "testCurrent", { ref: event.current.slice(4), done: event.completed, total: event.total })
        : msg(state.lang, "testingKeys", { done: event.completed, total: event.total });
      return { state: { ...state, testing: { ...state.testing, completed: event.completed, total: event.total, current: event.current }, status }, effects: [] };
    }
    case "testResult": {
      const kept = state.diagnostics.filter(d => d.ref !== event.entry.ref); // cache per reference, newest wins
      return { state: { ...state, diagnostics: [...kept, event.entry].slice(-60) }, effects: [] };
    }
    case "testEnd":
      return { state: { ...state, testing: null }, effects: [] };

    case "connData":
      return { state: { ...state, weknora: event.weknora, usegpt: event.usegpt }, effects: [] };
    case "serviceBusy":
      return { state: { ...state, svcBusy: event.on ? "op" : null, status: event.on ? msg(state.lang, "svcBusy") : state.status }, effects: [] };

    case "quitIntent":
      return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "exitConfirm"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "exit" } }, effects: [] };

    // ---------------- P2 mutations ----------------
    case "keyAdd": {
      const provider = currentProvider(state);
      if (provider?.id === "searxng") {
        if (provider.external) return notice(state, msg(state.lang, "instEnvGuarded"), true);
        return { state: withForm(state, { provider: "searxng", reference: null, draft: "", typing: true, intent: "instAdd", field: "url" }), effects: [] };
      }
      if (!provider || state.context >= 4) return notice(state, msg(state.lang, "connPending"));
      return { state: withForm(state, { provider: provider.id, reference: null, draft: "", typing: true, intent: "key", field: "secret" }), effects: [] };
    }
    case "keyEdit": {
      if (state.context === 3) {
        const provider = currentProvider(state)!;
        const instance = provider.instances[state.row];
        if (!instance) return notice(state, msg(state.lang, "noRows"), true);
        if (instance.source === "environment") return notice(state, msg(state.lang, "instEnvGuarded"), true);
        return { state: withForm(state, { provider: "searxng", reference: instance.baseUrl, draft: instance.baseUrl, typing: false, intent: "instEdit", field: "url" }), effects: [] };
      }
      if (state.context >= 4) return connectionEnter(state);
      const key = selectedKey(state);
      const guard = refuseGuard(state, key);
      if (guard) return guard;
      return { state: withForm(state, { provider: currentProvider(state)!.id, reference: key!.reference, draft: "", typing: true, intent: "key", field: "secret" }), effects: [] };
    }
    case "keyRemoveStart": {
      if (state.context === 3) {
        const provider = currentProvider(state)!;
        const instance = provider.instances[state.row];
        if (!instance) return notice(state, msg(state.lang, "noRows"), true);
        if (instance.source === "environment") return notice(state, msg(state.lang, "instEnvGuarded"), true);
        const last = provider.instances.filter(i => i.source !== "environment").length === 1;
        const title = last ? msg(state.lang, "instRemoveLast") : msg(state.lang, "removeConfirm", { ref: instance.baseUrl });
        return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "inst-remove", context: { reference: instance.baseUrl } } }, effects: [] };
      }
      if (state.context >= 4) return notice(state, msg(state.lang, "connPending"));
      const key = selectedKey(state);
      const guard = refuseGuard(state, key);
      if (guard) return guard;
      const provider = currentProvider(state)!;
      const title = msg(state.lang, "removeConfirm", { ref: key!.reference });
      return { state: { ...state, modal: { kind: "confirm", title, items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "remove-key", context: { provider: provider.id, reference: key!.reference } } }, effects: [] };
    }
    case "keyToggle": {
      if (state.context === 3) return notice(state, msg(state.lang, "searxngNoToggle"), true);
      if (state.context >= 4) return notice(state, msg(state.lang, "connPending"));
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

// ---------------- P4 connection helpers ----------------

const PRIVATE_V4 = /^(10\.|127\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** IP-literal private host -> exact /32 or /128 grant candidate (mirrors the retired workbench gate); domains and public IPs get nothing automatic. */
export function privateGrant(url: string): string | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return null; }
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (PRIVATE_V4.test(h)) return `${h}/32`;
  if (/^::1$/.test(h) || /^f[cd]/i.test(h) || /^fe80:/i.test(h)) return `${h}/128`;
  return null;
}

function parseCidrs(text: string): string[] | null {
  const list = text.split(",").map(s => s.trim()).filter(Boolean);
  if (!list.length || list.length > 20) return null;
  return list.every(c => /^[^/\s]+\/\d{1,3}$/.test(c)) ? list : null;
}

function instanceWrite(state: State, oldUrl: string | undefined, url: string, ranges: string[]) {
  return oldUrl === undefined
    ? { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op" as const, op: { kind: "addInstance" as const, baseUrl: url, allowRanges: ranges } }] }
    : { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op" as const, op: { kind: "editInstance" as const, oldBaseUrl: oldUrl, baseUrl: url, allowRanges: ranges } }] };
}

/** Private endpoints need an explicit per-instance grant before any request could succeed (ADR 0014: grants never migrate between instances). */
function cidrGate(state: State, url: string, oldUrl?: string) {
  const grant = privateGrant(url);
  const items = [
    { value: "cancel", label: msg(state.lang, "cancelDefault") },
    ...(grant ? [{ value: "grant", label: msg(state.lang, "cidrGrant", { cidr: grant }) }] : []),
    { value: "manual", label: msg(state.lang, "cidrManual") },
  ];
  const modal: ModalState = { kind: "choose", title: msg(state.lang, "cidrConsent"), items, cursor: 0, tag: "cidr-grant", context: { provider: "searxng", variable: url, reference: oldUrl } };
  return { state: { ...state, form: null, mode: "browse" as Mode, modal }, effects: [] as Effect[] };
}

function formSaveEvent(state: State, form: FormState): { state: State; effects: Effect[] } {
  const draft = form.draft.trim();
  switch (form.intent) {
    case "key":
      if (!form.draft) return notice(state, msg(state.lang, "emptySecret"), true);
      if (form.reference === null) return { state, effects: [{ type: "op", op: { kind: "addKey", provider: form.provider as ProviderId, secret: form.draft } }] };
      return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "overwriteConfirm", { ref: form.reference }), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "overwrite" } }, effects: [] };
    case "instAdd": case "instEdit": {
      if (!draft) return notice(state, msg(state.lang, "urlEmpty"), true);
      const oldUrl = form.intent === "instEdit" ? form.reference ?? undefined : undefined;
      const instance = oldUrl !== undefined ? currentProvider(state)?.instances.find(i => i.baseUrl === oldUrl) : undefined;
      if (oldUrl !== undefined && draft === oldUrl) return instanceWrite(state, oldUrl, draft, instance?.allowRanges ?? []);
      if (privateGrant(draft)) return cidrGate(state, draft, oldUrl);
      return instanceWrite(state, oldUrl, draft, []);
    }
    case "cidrAdd": case "cidrEdit": {
      const ranges = parseCidrs(draft);
      if (!ranges) return notice(state, msg(state.lang, "cidrInvalid"), true);
      return instanceWrite(state, form.pending?.oldUrl, form.pending?.url ?? draft, ranges);
    }
    case "wekUrl": {
      if (!draft) return notice(state, msg(state.lang, "urlEmpty"), true);
      const wk = state.weknora;
      if (wk && wk.baseUrl === draft) return notice(state, msg(state.lang, "noopSave"));
      if (!wk || (!wk.available && !wk.hasLocal)) {
        // first-time setup stores endpoint and credential in one write; chain the key field now
        return { state: withForm(state, { ...form, draft: "", typing: true, intent: "wekKey", field: "secret", pending: { url: draft } }), effects: [] };
      }
      if (wk.hasLocal) return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "wekUrlReuseConsent"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "wek-url-reuse", context: { variable: draft } } }, effects: [] };
      return { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op", op: { kind: "wekSave", field: "url", value: draft, reuseSavedKey: false } }] };
    }
    case "wekKey":
      if (!form.draft) return notice(state, msg(state.lang, "emptySecret"), true);
      if (form.pending?.url) return { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op", op: { kind: "wekSave", field: "url", value: form.pending.url, reuseSavedKey: false, secret: form.draft } }] };
      if (state.weknora?.hasLocal) return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "overwriteConfirm", { ref: "env:ARKSPACE_WEKNORA_API_KEY" }), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "wek-key-replace" } }, effects: [] };
      return { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op", op: { kind: "wekSave", field: "key", value: form.draft, reuseSavedKey: false } }] };
    case "wekKb":
      return { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op", op: { kind: "wekSave", field: "kb", value: draft, reuseSavedKey: false } }] };
    case "usegptTunnel":
      if (!/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(draft)) return notice(state, msg(state.lang, "usegptTunnelInvalid"), true);
      return { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op", op: { kind: "usegptSave", field: "tunnelId", value: draft } }] };
    case "usegptDir":
      if (!draft.startsWith("/") || /[\s\u0000-\u001f\u007f\\]/.test(draft) || draft.includes("..")) return notice(state, msg(state.lang, "usegptDirInvalid"), true);
      return { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op", op: { kind: "usegptSave", field: "dataDir", value: draft } }] };
    case "usegptKey":
      if (!form.draft) return notice(state, msg(state.lang, "emptySecret"), true);
      if (state.usegpt?.savedKey) return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "overwriteConfirm", { ref: "env:CONTROL_PLANE_API_KEY" }), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "usegpt-key-replace" } }, effects: [] };
      return { state: { ...state, form: null, mode: "browse" as Mode }, effects: [{ type: "op", op: { kind: "usegptKey", secret: form.draft } }] };
  }
}

function connectionEnter(state: State): { state: State; effects: Effect[] } {
  if (state.context === 4) {
    const wk = state.weknora;
    if (wk && (wk.status === "conflict" || wk.source === "environment")) {
      return notice(state, msg(state.lang, wk.status === "conflict" ? "wekConflictGuard" : "wekExternalGuard"), true);
    }
    const base = { provider: "weknora" as const, reference: null, typing: false };
    switch (state.row) {
      case 0: return { state: withForm(state, { ...base, draft: wk?.baseUrl ?? "", intent: "wekUrl", field: "url" }), effects: [] };
      case 1: return { state: withForm(state, { ...base, draft: "", typing: true, intent: "wekKey", field: "secret" }), effects: [] };
      case 2: return { state: withForm(state, { ...base, draft: wk?.defaultKnowledgeBaseId ?? "", intent: "wekKb", field: "text" }), effects: [] };
      case 3: return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "rowVerify"), note: msg(state.lang, "wekVerifyConsent"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "wek-verify" } }, effects: [] };
      case 4: return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "rowRemoveConn"), note: msg(state.lang, "wekRemoveConsent"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "wek-remove" } }, effects: [] };
    }
    return { state, effects: [] };
  }
  const u = state.usegpt;
  switch (state.row) {
    case 0: case 1: return notice(state, msg(state.lang, "statusNote"));
    case 2: return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "rowStart"), note: msg(state.lang, "usegptStartConsent"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "usegpt-start" } }, effects: [] };
    case 3: return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "rowStop"), note: msg(state.lang, "usegptStopConsent"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "usegpt-stop" } }, effects: [] };
    case 4: return { state, effects: [{ type: "service", action: "usegptDiagnose" }] };
    case 5: return { state: withForm(state, { provider: "usegpt", reference: null, draft: u?.tunnelId ?? "", typing: false, intent: "usegptTunnel", field: "text" }), effects: [] };
    case 6: return { state: withForm(state, { provider: "usegpt", reference: null, draft: u?.dataDir ?? "", typing: false, intent: "usegptDir", field: "text" }), effects: [] };
    case 7: return { state: withForm(state, { provider: "usegpt", reference: null, draft: "", typing: true, intent: "usegptKey", field: "secret" }), effects: [] };
    case 8: return { state: { ...state, modal: { kind: "confirm", title: msg(state.lang, "rowUnlinkUseGpt"), note: msg(state.lang, "usegptUnlinkConsent"), items: CONFIRM_ITEMS(state.lang), cursor: 0, tag: "usegpt-unlink" } }, effects: [] };
    default: return { state, effects: [] };
  }
}
