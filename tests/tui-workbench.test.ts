import { describe, expect, it } from "vitest";
import type { ProviderId } from "../src/protocol/types.js";
import type { SetupKeySnapshot, SetupProviderSnapshot, SetupSnapshot } from "../src/config/manage.js";
import { Framed } from "../src/tui/components/framed.js";
import { CONTEXT_COUNT, MENU_VALUES, dirtyOrder, initialState, reduce, type DiagEntry, type Event, type State } from "../src/tui/controller.js";
import { assertWidthSafe, visibleWidth } from "../src/tui/port.js";
import { messageKeys, msg } from "../src/tui/messages.js";
import { menuLines, stripLine } from "../src/tui/view.js";

function key(reference: string, over: Partial<SetupKeySnapshot> = {}): SetupKeySnapshot {
  return {
    reference, keyId: "k-" + reference, source: reference.startsWith("env:") && over.source === undefined && reference.includes("ENV") ? "environment" : "local",
    hasLocal: true, available: true, status: "enabled", ownedResources: 0, ...over,
  };
}

function provider(id: SetupProviderSnapshot["id"], over: Partial<SetupProviderSnapshot> = {}): SetupProviderSnapshot {
  return { id, enabled: true, automaticPosition: 1, keys: [], instances: [], ...over };
}

function snapshot(keys: SetupKeySnapshot[]): SetupSnapshot {
  return {
    providerOrder: ["exa", "tavily", "firecrawl", "searxng"],
    setupLanguage: "zh",
    providers: [
      provider("exa", { keys }),
      provider("tavily", { keys: [key("env:TAVILY_ENV_API_KEY", { source: "environment" })] }),
      provider("firecrawl", { enabled: false, keys: [key("env:FIRECRAWL_API_KEY")] }),
      provider("searxng", { instances: [{ baseUrl: "http://127.0.0.1:8888", allowRanges: ["127.0.0.0/8"], status: "configured (not probed)", source: "local" }] }),
    ],
  };
}

function loaded(lang: TuiLangAlias = "zh", keys: SetupKeySnapshot[] = [key("env:EXA_API_KEY"), key("env:EXA_API_KEY_1")]): State {
  return reduce(initialState(lang, "ready"), { type: "data", snapshot: snapshot(keys) }).state;
}
type TuiLangAlias = "zh" | "en";

const go = (s: State, ...events: Event[]) => events.reduce<{ state: State; effects: import("../src/tui/controller.js").Effect[] }>((acc, e) => reduce(acc.state, e), { state: s, effects: [] });

describe("messages width safety (ADR 0024 item 2)", () => {
  it("renders every table entry in both languages without ambiguous glyphs", () => {
    for (const k of messageKeys()) {
      expect(() => msg("zh", k, { n: 1, ref: "r", names: "x" })).not.toThrow();
      expect(() => msg("en", k, { n: 1, ref: "r", names: "x" })).not.toThrow();
    }
  });
});

describe("Framed fixed height (ADR 0024 item 1)", () => {
  it("pads short and clips long children to the allocated height", () => {
    for (const lines of [["a"], Array.from({ length: 40 }, (_, i) => "x" + i), []]) {
      const frame = new Framed({ invalidate() {}, render: () => lines }, "t");
      frame.setH(12);
      expect(frame.render(30).length).toBe(12);
    }
  });
  it("keeps every rendered line exactly at the requested width", () => {
    const frame = new Framed({ invalidate() {}, render: () => ["短内容", "ascii"] }, "标题");
    frame.setH(12);
    for (const line of frame.render(30)) expect(visibleWidth(line)).toBe(30);
  });
  it("never leaks forbidden glyphs through rendered lines", () => {
    const frame = new Framed({ invalidate() {}, render: () => ["ok"] }, "t");
    frame.setH(8);
    for (const line of frame.render(20)) expect(() => assertWidthSafe(line.replace(/[─│╭╮╰╯]/g, ""), "frame")).not.toThrow();
  });
});

describe("strip and menu geometry", () => {
  it("strip width is constant regardless of key counts, with all six contexts", () => {
    const empty = stripLine(loaded("zh", []), 120);
    const full = stripLine(loaded("zh", Array.from({ length: 9 }, (_, i) => key(`env:K${i}_API_KEY`))), 120);
    expect(visibleWidth(empty)).toBe(120);
    expect(visibleWidth(full)).toBe(120);
    for (const label of ["Exa", "Tavily", "Firecrawl", "SearXNG", "WeKnora", "UseGPT"]) expect(full).toContain(`[${label}]`);
  });
  it("menu rows match the value list and pad to width", () => {
    const rows = menuLines(loaded(), 18);
    expect(rows.length).toBe(MENU_VALUES.length);
    for (const row of rows) expect(visibleWidth(row)).toBe(18);
  });
});

describe("navigation", () => {
  it("cycles regions both directions via tab", () => {
    let { state } = { state: loaded() };
    for (const [expected, delta] of [["menu", 1], ["content", 1], ["top", 1], ["content", -1]] as const) {
      state = reduce(state, { type: "tab", delta }).state;
      expect(state.region).toBe(expected);
    }
  });
  it("context switch wraps, resets rows, and never writes", () => {
    expect(loaded().context).toBe(0);
    expect(reduce(loaded(), { type: "context", delta: -1 }).state.context).toBe(CONTEXT_COUNT - 1);
    expect(reduce(loaded(), { type: "context", delta: 1 }).state.context).toBe(1);
  });
  it("row movement clamps to page size", () => {
    const atContent = { ...loaded(), region: "content" as const };
    expect(go(atContent, { type: "move", delta: 1 }, { type: "move", delta: 1 }).state.row).toBe(1);
    expect(reduce({ ...atContent, row: 9 }, { type: "move", delta: 1 }).state.row).toBe(1);
    expect(reduce(atContent, { type: "move", delta: -1 }).state.row).toBe(0);
  });
});

describe("exit modal", () => {
  it("defaults to Cancel; only Confirm exits", () => {
    const asked = reduce(loaded(), { type: "quitIntent" }).state;
    expect(asked.modal?.tag).toBe("exit");
    expect(asked.modal?.cursor).toBe(0);
    const cancelled = reduce(asked, { type: "modalPick" });
    expect(cancelled.effects).toEqual([]);
    expect(cancelled.state.modal).toBeNull();
    const confirmed = reduce({ ...asked, modal: { ...asked.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(confirmed.effects).toEqual([{ type: "exit" }]);
  });
});

describe("preview and details hygiene", () => {
  it("escape from preview clears secret values", () => {
    const previewing = reduce(loaded(), {
      type: "previewOpen", variable: "EXA_API_KEY", sources: [{ label: "本地已保存", value: "sk-secret-value" }],
    }).state;
    expect(previewing.mode).toBe("preview");
    const rested = reduce(previewing, { type: "escape" }).state;
    expect(rested.mode).toBe("browse");
    expect(rested.preview).toBeNull();
  });
  it("any key closes details; reveal only works in preview", () => {
    const details = reduce(loaded(), { type: "detailsOpen", reference: "env:EXA_API_KEY" }).state;
    expect(reduce(details, { type: "move", delta: 1 }).state.mode).toBe("browse");
    expect(reduce(loaded(), { type: "reveal" }).state.revealed).toBe(false);
  });
});

describe("P2 key management", () => {
  const content = (): State => ({ ...loaded(), region: "content" });

  it("add: a -> type -> Ctrl-S emits addKey with the typed secret", () => {
    const r = go(content(),
      { type: "keyAdd" },
      { type: "formType", text: "sk-super-secret-1" },
      { type: "formEnter" },                       // commit draft (no typing caret)
      { type: "formSave" },
    );
    expect(r.state.mode).toBe("form");
    expect(r.effects).toEqual([{ type: "op", op: { kind: "addKey", provider: "exa", secret: "sk-super-secret-1" } }]);
    expect(go(r.state, { type: "formDone" }).state.mode).toBe("browse");
  });

  it("add refuses empty secret as no-op", () => {
    const r = go(content(), { type: "keyAdd" }, { type: "formSave" });
    expect(r.effects).toEqual([]);
    expect(r.state.statusWarn).toBe(true);
  });

  it("edit of an environment key is refused and opens nothing", () => {
    const tavily = { ...loaded(), region: "content" as const, context: 1 };
    const r = reduce(tavily, { type: "keyEdit" });
    expect(r.state.mode).toBe("browse");
    expect(r.state.statusWarn).toBe(true);
  });

  it("edit of a local key asks for explicit overwrite before replaceKey", () => {
    const r = go(content(),
      { type: "keyEdit" },
      { type: "formType", text: "new-secret-value" },
      { type: "formSave" },
    );
    expect(r.effects).toEqual([]);
    expect(r.state.modal?.tag).toBe("overwrite");
    expect(r.state.modal?.cursor).toBe(0); // cancel default
    const yes = reduce({ ...r.state, modal: { ...r.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "op", op: { kind: "replaceKey", provider: "exa", reference: "env:EXA_API_KEY", secret: "new-secret-value" } }]);
  });

  it("form escape: typing reverts the field, committed draft asks discard (cancel keeps form)", () => {
    const typing = go(content(), { type: "keyAdd" }, { type: "formType", text: "abc" }).state;
    const reverted = reduce(typing, { type: "escape" }).state;
    expect(reverted.form?.typing).toBe(false);
    expect(reverted.form?.draft).toBe("");
    const committed = go(content(), { type: "keyAdd" }, { type: "formType", text: "abc" }, { type: "formEnter" }).state;
    const asked = reduce(committed, { type: "escape" }).state;
    expect(asked.modal?.tag).toBe("form-discard");
    const stayed = reduce(asked, { type: "modalPick" }).state; // cursor 0 = cancel
    expect(stayed.mode).toBe("form");
    expect(stayed.form?.draft).toBe("abc");
  });

  it("remove requires confirm; yes emits removeKey with the selected reference", () => {
    const r = go(content(), { type: "keyRemoveStart" });
    expect(r.state.modal?.tag).toBe("remove-key");
    const no = reduce(r.state, { type: "modalPick" });
    expect(no.effects).toEqual([]);
    const yes = reduce({ ...r.state, modal: { ...r.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "op", op: { kind: "removeKey", provider: "exa", reference: "env:EXA_API_KEY" } }]);
  });

  it("Space toggles the selected key; v toggles the provider", () => {
    expect(go(content(), { type: "keyToggle" }).effects).toEqual([
      { type: "op", op: { kind: "toggleKey", provider: "exa", reference: "env:EXA_API_KEY", enabled: false } },
    ]);
    const disabledKey = { ...content() };
    disabledKey.snapshot!.providers[0]!.keys[0]!.status = "disabled";
    expect(go(disabledKey, { type: "keyToggle" }).effects[0]).toEqual(
      { type: "op", op: { kind: "toggleKey", provider: "exa", reference: "env:EXA_API_KEY", enabled: true } },
    );
    expect(go(content(), { type: "providerToggle" }).effects).toEqual([
      { type: "op", op: { kind: "toggleProvider", provider: "exa", enabled: false } },
    ]);
  });

  it("searxng rows refuse add/edit", () => {
    const searxng = { ...loaded(), region: "content" as const, context: 3 };
    expect(reduce(searxng, { type: "keyAdd" }).state.mode).toBe("browse");
    expect(reduce(searxng, { type: "keyEdit" }).state.mode).toBe("browse");
  });
});

describe("P2 order draft", () => {
  const config = (): State => ({ ...loaded(), region: "content", page: "config" });

  it("u/d edit a draft, not saved state; Ctrl-S (reorder-only) saves directly", () => {
    const moved = reduce(config(), { type: "orderMove", delta: 1 });
    expect(dirtyOrder(moved.state)).toBe(true);
    expect(moved.state.snapshot!.providerOrder).toEqual(["exa", "tavily", "firecrawl", "searxng"]); // saved untouched
    const save = reduce(moved.state, { type: "orderSave" });
    expect(save.effects).toEqual([{ type: "op", op: { kind: "saveOrder", order: ["tavily", "exa", "firecrawl", "searxng"] } }]);
    const after = reduce(save.state, { type: "opDone", kind: "saveOrder" }).state;
    expect(after.orderDraft).toBeNull();
  });

  it("saving an unchanged draft is a no-op", () => {
    const r = reduce(config(), { type: "orderSave" });
    expect(r.effects).toEqual([]);
    expect(r.state.status).toContain("无更改");
  });

  it("Del drops from the draft; Esc with a dirty draft asks discard with Cancel default", () => {
    const dropped = reduce(config(), { type: "orderDrop" });
    expect(dropped.state.orderDraft).toEqual(["tavily", "firecrawl", "searxng"]);
    const esc = reduce(dropped.state, { type: "escape" });
    expect(esc.state.modal?.tag).toBe("order-discard");
    const yes = reduce({ ...esc.state, modal: { ...esc.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.state.orderDraft).toBeNull();
    expect(yes.effects).toEqual([]);
  });

  it("I chooser re-includes a dropped provider; identical set saves without consent prompt", () => {
    const dropped = reduce({ ...config(), row: 3 }, { type: "orderDrop" }).state;   // searxng out of draft
    const chooser = reduce(dropped, { type: "orderIncludeStart" });
    expect(chooser.state.modal?.tag).toBe("order-include");
    const pick = reduce({ ...chooser.state, modal: { ...chooser.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(pick.state.orderDraft).toEqual(["exa", "tavily", "firecrawl", "searxng"]);
    const save = reduce(pick.state, { type: "orderSave" }); // draft back to the saved set -> honest no-op, nothing to persist
    expect(save.effects).toEqual([]);
    expect(dirtyOrder(pick.state)).toBe(false);
    expect(save.state.status).toContain("无更改");
  });

  it("adding a provider that was never routed demands consent before saveOrder", () => {
    const partial: State = {
      ...loaded(), region: "content", page: "config",
      snapshot: { ...snapshot([key("env:EXA_API_KEY")]), providerOrder: ["exa", "tavily"] },
    };
    const drafted = { ...partial, orderDraft: ["exa", "tavily", "searxng"] as ProviderId[] };
    const save = reduce(drafted, { type: "orderSave" });
    expect(save.effects).toEqual([]);
    expect(save.state.modal?.tag).toBe("order-save-consent");
    expect(save.state.modal?.title).toContain("SearXNG");
    const cancelled = reduce(save.state, { type: "modalPick" }); // cursor 0 = cancel
    expect(cancelled.effects).toEqual([]);
    const yes = reduce({ ...save.state, modal: { ...save.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "op", op: { kind: "saveOrder", order: ["exa", "tavily", "searxng"] } }]);
  });

  it("language page Enter maps to setLanguage by row", () => {
    const settings = { ...loaded(), region: "content" as const, page: "settings" as const, row: 1 };
    expect(reduce(settings, { type: "enter" }).effects).toEqual([{ type: "op", op: { kind: "setLanguage", lang: "en" } }]);
  });
});

describe("P3 test flow", () => {
  const content = (): State => ({ ...loaded(), region: "content" });
  const diag = (ref: string, out = "success"): DiagEntry => ({ when: "01:02:03", ref, out, dur: 12 });
  const withDiag = (s: State, n: number): State => ({ ...s, diagnostics: Array.from({ length: n }, (_, i) => diag(`env:OLD${i}`)) });

  it("keyed context opens a chooser with Cancel first and consent note", () => {
    const r = reduce(content(), { type: "testIntent" });
    expect(r.state.modal?.tag).toBe("test-scope");
    expect(r.state.modal?.cursor).toBe(0);
    expect(r.state.modal?.items.map(i => i.value)).toEqual(["cancel", "pool", "all"]);
    expect(r.state.modal?.note).toContain("5");
  });

  it("pool choice emits testRun; all choice carries the snapshot references", () => {
    const open = reduce(content(), { type: "testIntent" }).state;
    const pool = reduce({ ...open, modal: { ...open.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(pool.effects).toEqual([{ type: "testRun", provider: "exa", mode: "pool", references: ["env:EXA_API_KEY", "env:EXA_API_KEY_1"] }]);
    const all = reduce({ ...open, modal: { ...open.modal!, cursor: 2 } }, { type: "modalPick" });
    expect(all.effects[0]).toMatchObject({ mode: "allKeys", references: ["env:EXA_API_KEY", "env:EXA_API_KEY_1"] });
  });

  it("searxng uses a single live-confirm (no key chooser)", () => {
    const searxng = { ...loaded(), region: "content" as const, context: 3 };
    const r = reduce(searxng, { type: "testIntent" });
    expect(r.state.modal?.tag).toBe("test-live");
    const yes = reduce({ ...r.state, modal: { ...r.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "testRun", provider: "searxng", mode: "pool", references: [] }]);
    const no = reduce(r.state, { type: "modalPick" });
    expect(no.effects).toEqual([]);
  });

  it("pool runs clear stale diagnostics; allKeys runs keep them", () => {
    const seeded = withDiag(content(), 3);
    expect(reduce(seeded, { type: "testBegin", provider: "exa", mode: "pool", total: 1 }).state.diagnostics).toEqual([]);
    expect(reduce(seeded, { type: "testBegin", provider: "exa", mode: "allKeys", total: 2 }).state.diagnostics.length).toBe(3);
  });

  it("during a run: mutations fence off, navigation stays live, second testIntent refuses", () => {
    const running = reduce(content(), { type: "testBegin", provider: "exa", mode: "allKeys", total: 2 }).state;
    expect(reduce(running, { type: "keyAdd" }).state.mode).toBe("browse");
    expect(reduce(running, { type: "keyRemoveStart" }).state.modal).toBeNull();
    expect(reduce(running, { type: "testIntent" }).state.status).toContain("测试进行中");
    expect(reduce(running, { type: "move", delta: 1 }).state.row).toBe(1);
    expect(reduce(running, { type: "escape" }).state.testing).not.toBeNull(); // host owns Esc-abort; reducer never cancels the run here
  });

  it("progress updates status with the bare variable; results cache one row per reference", () => {
    const running = reduce(content(), { type: "testBegin", provider: "exa", mode: "allKeys", total: 2 }).state;
    const prog = reduce(running, { type: "testProgress", completed: 0, total: 2, current: "env:EXA_API_KEY" });
    expect(prog.state.status).toContain("EXA_API_KEY");
    expect(prog.state.status).not.toContain("env:");
    let s = reduce(prog.state, { type: "testResult", provider: "exa", entry: diag("env:EXA_API_KEY", "failure") }).state;
    s = reduce(s, { type: "testResult", provider: "exa", entry: diag("env:EXA_API_KEY", "success") }).state;
    expect(s.diagnostics.filter(d => d.ref === "env:EXA_API_KEY").length).toBe(1);
    expect(s.diagnostics[0]!.out).toBe("success");
  });

  it("result list caps at 60 entries keeping the newest", () => {
    let s = withDiag(content(), 59);
    s = reduce(s, { type: "testResult", provider: "exa", entry: diag("env:A") }).state;
    s = reduce(s, { type: "testResult", provider: "exa", entry: diag("env:B") }).state;
    expect(s.diagnostics.length).toBe(60);
    expect(s.diagnostics.at(-1)!.ref).toBe("env:B");
    expect(s.diagnostics.some(d => d.ref === "env:OLD0")).toBe(false);
  });

  it("testEnd unlocks management ops", () => {
    const running = reduce(content(), { type: "testBegin", provider: "exa", mode: "allKeys", total: 2 }).state;
    const done = reduce(running, { type: "testEnd", cancelled: false }).state;
    expect(done.testing).toBeNull();
    expect(reduce(done, { type: "keyAdd" }).state.mode).toBe("form");
  });

  it("any managed write invalidates session diagnostics conservatively", () => {
    const seeded = withDiag(content(), 2);
    expect(reduce(seeded, { type: "opDone", kind: "toggleProvider" }).state.diagnostics).toEqual([]);
  });

  it("modal note lines render above the items", async () => {
    const { modalLines } = await import("../src/tui/view.js");
    const open = reduce(content(), { type: "testIntent" }).state.modal!;
    const lines = modalLines(open, 40);
    expect(lines.length).toBe(open.items.length + 1 + open.note!.split("\n").length);
  });
});
