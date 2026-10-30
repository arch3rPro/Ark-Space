import { describe, expect, it } from "vitest";
import type { ProviderId } from "../src/protocol/types.js";
import type { SetupKeySnapshot, SetupProviderSnapshot, SetupSnapshot } from "../src/config/manage.js";
import { Framed } from "../src/tui/components/framed.js";
import { MENU_VALUES, dirtyOrder, initialState, orderRows, reduce, rowCount, type DiagEntry, type Event, type State } from "../src/tui/controller.js";
import { assertWidthSafe, visibleWidth } from "../src/tui/port.js";
import { messageKeys, msg } from "../src/tui/messages.js";
import { actionLine, menuLines, pageLines, stripLine } from "../src/tui/view.js";

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

describe("Setup wording", () => {
  it.each(["secret", "text", "url", "cidr"] as const)("%s form hints describe editing, saving and the actual Esc behavior", field => {
    const opened = reduce(loaded(), { type: "keyAdd" }).state;
    const typing: State = { ...opened, form: { ...opened.form!, field, draft: "sample" } };
    const rendered = pageLines(typing, 160).join("\n");
    const typingKeys = actionLine(typing, 160);
    expect(typingKeys).toContain("Enter");
    expect(typingKeys).toContain("Ctrl-S");
    expect(typingKeys).toContain("Esc");
    expect(rendered).not.toContain("提交");
    const finished = reduce(typing, { type: "formEnter" });
    expect(finished.effects).toEqual([]);
    const idle = pageLines(finished.state, 160).join("\n");
    const idleKeys = actionLine(finished.state, 160);
    expect(idleKeys).toContain("Enter");
    expect(idleKeys).toContain("编辑");
    expect(idleKeys).toContain("Esc");
    expect(reduce(typing, { type: "escape" }).state.form?.draft).toBe("");
    expect(reduce(finished.state, { type: "escape" }).state.modal?.cursor).toBe(0);
    if (field === "secret") expect(rendered).toContain("妥善保护");
  });

  it("details omit internal refresh notes while retaining the displayed key facts", () => {
    const detail = reduce(loaded(), { type: "detailsOpen", reference: "env:EXA_API_KEY" }).state;
    const text = pageLines(detail, 120).join("\n");
    expect(text).toContain("本地存储");
    expect(text).toContain("可用性");
    expect(text).not.toMatch(/快照|刷新|snapshot|refresh/);
  });

  it.each(["zh", "en"] as const)("%s connection rows avoid duplicate Enter and separate invalid-key status from preview errors", lang => {
    const tools: State = { ...loaded(lang), region: "content", page: "tools", context: 5,
      usegpt: { configured: false, daemonRunning: false, tunnelRunning: false, issues: [], keySource: "invalid", savedKey: true } };
    const text = pageLines(tools, 160).join("\n");
    expect(text).not.toMatch(/Enter|预览|preview/);
    expect(text).toContain(lang === "zh" ? "环境变量中的密钥无效" : "invalid environment credential");
    expect(actionLine(tools, 160)).toContain("[Enter]");
    expect(text).toContain(lang === "zh" ? "诊断连接" : "Diagnose connection");
    expect(text).toContain(lang === "zh" ? "恢复配置" : "Restore configuration");
    expect(msg(lang, "usegptIssueHub")).toContain("Artifact Hub");
    expect(msg(lang, "usegptIssueHubUnavailable")).toContain("Artifact Hub");
  });

  it("uses the approved source labels and natural notices without inventing help", () => {
    expect(["srcLocalValue", "srcEnvValue", "srcEnvOver"].map(k => msg("zh", k)))
      .toEqual(["本地存储", "环境变量", "环境变量（覆盖本地）"]);
    expect(msg("zh", "colKey")).toBe("密钥变量名");
    expect(msg("zh", "dataError")).not.toContain("?");
    expect(msg("zh", "emptySecret")).toBe("未输入密钥，未保存。");
    expect(msg("zh", "orderNoop")).toBe("顺序无更改，无需保存。");
    expect(msg("zh", "opRemoved", { ref: "EXA_API_KEY" })).toBe("已移除 EXA_API_KEY，相关测试结果已清除。");
    expect(msg("zh", "testInfra")).toBe("测试异常，已停止。为保护密钥，不显示原始错误。");
    expect(msg("zh", "usegptKeySaved")).toBe("UseGPT API 密钥已保存");
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
  it("strip width is constant and shows only the current page group", () => {
    const empty = stripLine(loaded("zh", []), 120);
    const full = stripLine(loaded("zh", Array.from({ length: 9 }, (_, i) => key(`env:K${i}_API_KEY`))), 120);
    expect(visibleWidth(empty)).toBe(120);
    expect(visibleWidth(full)).toBe(120);
    for (const label of ["Exa", "Tavily", "Firecrawl", "SearXNG", "Order"]) expect(full).toContain(`[${label}]`); // order rides the strip (P8)
    expect(full).not.toContain("[WeKnora]"); // connections moved to their own pages
    const kn = stripLine({ ...loaded(), page: "knowledge" as const, context: 4 }, 120);
    expect(visibleWidth(kn)).toBe(120);
    expect(kn).toContain("[WeKnora]");
  });
  it("strip labels keep the same columns across contexts and chip widths", () => {
    const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    const base = plain(stripLine(loaded(), 120));
    for (const ctx of [1, 2, 3]) { // same group, different chips (SearXNG renders none)
      const st = reduce(loaded(), { type: "contextSet", index: ctx }).state;
      const line = plain(stripLine(st, 120));
      expect(line.indexOf("[Exa]")).toBe(base.indexOf("[Exa]"));
      expect(line.indexOf("[SearXNG]")).toBe(base.indexOf("[SearXNG]"));
    }
  });
  it("menu focus shows the full name of the item under the cursor; pages without tabs never show tabs", () => {
    const menuZh = stripLine({ ...loaded(), region: "menu" as const, menuCursor: MENU_VALUES.indexOf("providers") }, 120);
    expect(menuZh).toContain("搜索引擎设置");
    expect(menuZh).not.toContain("[Exa]");
    const order = stripLine({ ...loaded(), region: "content" as const, page: "config" as const }, 120);
    expect(order).toContain("[Order]"); // the order page keeps the strip and highlights the pseudo tab
    const settings = stripLine({ ...loaded(), region: "content" as const, page: "settings" as const }, 120);
    expect(settings).toContain("语言设置");
    expect(settings).not.toContain("[Exa]");
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
  it("vertical arrows in the strip region move nothing; Enter enters content instead", () => {
    const top = loaded(); // fresh state boots with the strip focused
    expect(top.region).toBe("top");
    expect(reduce(top, { type: "move", delta: 1 }).state).toBe(top); // same state, no teleport, no cursor move
    expect(reduce(top, { type: "enter" }).state.region).toBe("content");
  });
  it("context switch cycles the five search tabs across the order page and never writes", () => {
    expect(loaded().context).toBe(0);
    const toOrder = reduce(loaded(), { type: "context", delta: -1 }).state; // wrap lands on [Order]
    expect(toOrder.page).toBe("config");
    expect(reduce(toOrder, { type: "context", delta: -1 }).state.context).toBe(3); // back to SearXNG
    expect(reduce(loaded(), { type: "context", delta: 1 }).state.context).toBe(1);
    expect(reduce(loaded(), { type: "contextSet", index: 4 }).state.context).toBe(0); // WeKnora is not a search tab
    expect(reduce(loaded(), { type: "contextSet", index: 6 }).state.page).toBe("config");
  });
  it("menu arrows switch pages live; Enter only moves focus; Esc from Order lands on Search", () => {
    const menu = { ...loaded(), region: "menu" as const };
    const down = reduce(menu, { type: "move", delta: 1 }).state;
    expect([down.menuCursor, down.page, down.context, down.region] as const).toEqual([1, "knowledge", 4, "menu"]);
    const enter = reduce(down, { type: "enter" }).state;
    expect(enter.region).toBe("content"); // no page teleport on Enter
    const atExit = reduce({ ...down, menuCursor: MENU_VALUES.length - 1 }, { type: "move", delta: 1 }).state;
    expect(atExit.page).toBe("knowledge"); // the exit row never switches the page
    expect(reduce(atExit, { type: "enter" }).state.modal?.tag).toBe("exit");
    const back = reduce({ ...loaded(), region: "content" as const, page: "config" as const }, { type: "escape" }).state;
    expect([back.region, back.page, back.menuCursor] as const).toEqual(["menu", "providers", 0]);
  });
  it("entering knowledge/tools pages pins the context to the single member", () => {
    const kn = reduce(loaded(), { type: "pageSet", page: "knowledge" });
    expect(kn.state.context).toBe(4);
    expect(kn.state.region).toBe("content");
    const tools = reduce({ ...loaded(), context: 4 }, { type: "pageSet", page: "tools" });
    expect(tools.state.context).toBe(5);
    const back = reduce(tools.state, { type: "pageSet", page: "providers" });
    expect(back.state.context).toBe(0); // search tab is clamped back into the group
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
      type: "previewOpen", variable: "EXA_API_KEY", sources: [{ label: "本地存储", value: "sk-secret-value" }],
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

  it("searxng rows open instance add/edit forms (P4)", () => {
    const searxng = { ...loaded(), region: "content" as const, context: 3 };
    const added = reduce(searxng, { type: "keyAdd" });
    expect(added.state.mode).toBe("form");
    expect(added.state.form?.intent).toBe("instAdd");
    const edited = reduce({ ...searxng, row: 0 }, { type: "keyEdit" });
    expect(edited.state.form?.intent).toBe("instEdit");
    expect(edited.state.form?.draft).toBe("http://127.0.0.1:8888");
  });

  it("instance edit to the same URL writes without re-asking for grants", () => {
    const searxng = { ...loaded(), region: "content" as const, context: 3 };
    const s = reduce({ ...searxng, mode: "form" as const, form: { provider: "searxng" as const, reference: "http://127.0.0.1:8888", draft: "http://127.0.0.1:8888", typing: false, intent: "instEdit" as const, field: "url" as const } }, { type: "formSave" });
    expect(s.effects).toEqual([{ type: "op", op: { kind: "editInstance", oldBaseUrl: "http://127.0.0.1:8888", baseUrl: "http://127.0.0.1:8888", allowRanges: ["127.0.0.0/8"] } }]);
  });

  it("private endpoint change gates on per-instance CIDR consent (ADR 0014)", () => {
    const searxng = { ...loaded(), region: "content" as const, context: 3 };
    const s = reduce({ ...searxng, mode: "form" as const, form: { provider: "searxng" as const, reference: null, draft: "http://10.1.2.3:8080", typing: false, intent: "instAdd" as const, field: "url" as const } }, { type: "formSave" });
    expect(s.state.modal?.tag).toBe("cidr-grant");
    expect(s.effects).toEqual([]);
    const mv = reduce(s.state, { type: "modalMove", delta: 1 });
    const granted = reduce(mv.state, { type: "modalPick" });
    expect(granted.effects).toEqual([{ type: "op", op: { kind: "addInstance", baseUrl: "http://10.1.2.3:8080", allowRanges: ["10.1.2.3/32"] } }]);
    const manual = reduce({ ...s.state, modal: { ...s.state.modal!, cursor: 2 } }, { type: "modalPick" });
    expect(manual.state.mode).toBe("form");
    expect(manual.state.form?.intent).toBe("cidrAdd");
    const bad = reduce({ ...manual.state, form: { ...manual.state.form!, draft: "not-a-cidr" } }, { type: "formSave" });
    expect(bad.effects).toEqual([]); // invalid list stays in the form, nothing written
    expect(bad.state.mode).toBe("form");
    const saved = reduce({ ...manual.state, form: { ...manual.state.form!, draft: "10.1.2.3/32,fd00::/8" } }, { type: "formSave" });
    expect(saved.effects).toEqual([{ type: "op", op: { kind: "addInstance", baseUrl: "http://10.1.2.3:8080", allowRanges: ["10.1.2.3/32", "fd00::/8"] } }]);
  });

  it("public endpoint skips the grant gate", () => {
    const searxng = { ...loaded(), region: "content" as const, context: 3 };
    const s = reduce({ ...searxng, mode: "form" as const, form: { provider: "searxng" as const, reference: null, draft: "https://search.example.org", typing: false, intent: "instAdd" as const, field: "url" as const } }, { type: "formSave" });
    expect(s.effects).toEqual([{ type: "op", op: { kind: "addInstance", baseUrl: "https://search.example.org", allowRanges: [] } }]);
  });

  it("removing the last local instance asks with the ADR wording", () => {
    const searxng = { ...loaded(), region: "content" as const, context: 3 };
    const s = reduce(searxng, { type: "keyRemoveStart" });
    expect(s.state.modal?.tag).toBe("inst-remove");
    const yes = reduce({ ...s.state, modal: { ...s.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "op", op: { kind: "removeInstance", baseUrl: "http://127.0.0.1:8888" } }]);
  });

  it("environment-managed searxng instance is read-only", () => {
    const state = { ...loaded(), region: "content" as const, context: 3 };
    const withEnv = { ...state, snapshot: { ...state.snapshot!, providers: state.snapshot!.providers.map((p, i) => i === 3 ? { ...p, instances: [{ ...p.instances[0]!, source: "environment" as const }] } : p) } };
    expect(reduce(withEnv, { type: "keyEdit" }).state.mode).toBe("browse");
    expect(reduce(withEnv, { type: "keyRemoveStart" }).state.modal).toBeNull();
  });
});

describe("P5 regressions found by the PTY qualification", () => {
  it("refresh and failure notices pass through an open form", () => {
    const s = loaded();
    const open = reduce(s, { type: "keyAdd" }).state;
    expect(open.mode).toBe("form");
    const next = reduce(open, { type: "data", snapshot: { ...s.snapshot!, providers: s.snapshot!.providers.map((p, i) => i === 0 ? { ...p, keys: [...p.keys, key("env:EXA_API_KEY_2")] } : p) } });
    expect(next.state.mode).toBe("form"); // the form itself must survive the refresh
    expect(next.state.snapshot!.providers[0]?.keys).toHaveLength(3);
    const told = reduce(open, { type: "notice", text: "operation failed", warn: true });
    expect(told.state.status).toBe("operation failed");
    expect(told.state.statusWarn).toBe(true);
  });
});

describe("P4 connection pages", () => {
  const wekState = (): State => ({
    ...loaded(), region: "content" as const, page: "knowledge" as const, context: 4,
    weknora: { baseUrl: "https://kb.example/api/v1", source: "managed", available: true, hasLocal: true, status: "configured (not tested)", sharedProviders: [], warnings: [], allowRanges: [] } as never,
  });

  it("weknora rows map to endpoint/key/kb/verify actions", () => {
    let s = wekState();
    s = reduce(s, { type: "keyEdit" }).state; expect(s.mode).toBe("form"); expect(s.form?.intent).toBe("wekUrl");
    s = { ...wekState(), row: 1 };
    const k = reduce(s, { type: "keyEdit" }).state; expect(k.form?.intent).toBe("wekKey"); expect(k.form?.field).toBe("secret");
    s = { ...wekState(), row: 2 };
    expect(reduce(s, { type: "keyEdit" }).state.form?.intent).toBe("wekKb");
    s = { ...wekState(), row: 3 };
    expect(reduce(s, { type: "enter" }).state.modal?.tag).toBe("wek-verify");
  });

  it("changing the weknora root re-consents key reuse; verify confirm runs the service", () => {
    const s = wekState();
    const saved = reduce({ ...s, mode: "form" as const, form: { provider: "weknora" as const, reference: null, draft: "https://new.example/api/v1", typing: false, intent: "wekUrl" as const, field: "url" as const } }, { type: "formSave" });
    expect(saved.state.modal?.tag).toBe("wek-url-reuse");
    const yes = reduce({ ...saved.state, modal: { ...saved.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "op", op: { kind: "wekSave", field: "url", value: "https://new.example/api/v1", reuseSavedKey: true } }]);
    const v = reduce({ ...s, row: 3 }, { type: "enter" }); // verify consent -> yes
    expect(v.state.modal?.tag).toBe("wek-verify");
    const run = reduce({ ...v.state, modal: { ...v.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(run.effects).toEqual([{ type: "service", action: "wekVerify" }]);
  });

  it("saving a new weknora key over a managed one asks to replace first", () => {
    const s = wekState();
    const saved = reduce({ ...s, mode: "form" as const, form: { provider: "weknora" as const, reference: null, draft: "sk-secret", typing: true, intent: "wekKey" as const, field: "secret" as const } }, { type: "formSave" });
    expect(saved.state.modal?.tag).toBe("wek-key-replace");
    const yes = reduce({ ...saved.state, modal: { ...saved.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects[0]).toEqual({ type: "op", op: { kind: "wekSave", field: "key", value: "sk-secret", reuseSavedKey: false, replaceSavedKey: true } });
  });

  it("environment-sourced weknora is read-only and conflict is fenced", () => {
    const envState = { ...wekState(), weknora: { ...wekState().weknora!, source: "environment", status: "configured (not tested)" } as never };
    expect(reduce(envState, { type: "enter" }).state.mode).toBe("browse");
    const conflict = { ...wekState(), weknora: { ...wekState().weknora!, status: "conflict" } as never };
    expect(reduce(conflict, { type: "enter" }).state.statusWarn).toBe(true);
  });

  it("usegpt start/stop confirmations default to cancel; diagnose is a plain service call", () => {
    const s = { ...loaded(), region: "content" as const, page: "tools" as const, context: 5, usegpt: { configured: true, daemonRunning: false, tunnelRunning: false, issues: [], keySource: "missing" as const, savedKey: false } };
    const start = reduce({ ...s, row: 0 }, { type: "enter" }); // Artifact Hub
    expect(start.state.modal?.tag).toBe("usegpt-hub");
    expect(start.state.modal?.cursor).toBe(0); // cancel first (ADR 0016)
    expect(start.state.modal?.note).toBeTruthy();
    const yes = reduce({ ...start.state, modal: { ...start.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "service", action: "usegptHubStart" }]);
    const stop = reduce({ ...s, usegpt: { ...s.usegpt!, daemonRunning: true, tunnelRunning: true }, row: 1 }, { type: "enter" });
    expect(stop.state.modal?.tag).toBe("usegpt-tunnel");
    const diag = reduce({ ...s, row: 2 }, { type: "enter" });
    expect(diag.effects).toEqual([{ type: "service", action: "usegptDiagnose" }]);
    const info = reduce({ ...s, row: 2 }, { type: "enter" });
    expect(info.effects).toEqual([{ type: "service", action: "usegptDiagnose" }]);
    const incomplete = reduce({ ...s, usegpt: { ...s.usegpt!, configured: false }, row: 0 }, { type: "enter" });
    expect(incomplete.effects).toEqual([]);
    expect(incomplete.state.status).toContain("UseGPT");
    const running = reduce({ ...s, usegpt: { ...s.usegpt!, daemonRunning: true, tunnelRunning: true }, row: 0 }, { type: "enter" });
    expect(running.state.modal?.tag).toBe("usegpt-hub");
    expect(running.state.modal?.note).toContain("停止");
    const stopped = reduce({ ...s, row: 0 }, { type: "enter" });
    expect(stopped.state.modal?.tag).toBe("usegpt-hub");
    expect(stopped.state.modal?.note).toContain("启动");
  });

  it("service busy fences mutations but navigation and refresh stay live", () => {
    const busy = reduce(wekState(), { type: "serviceBusy", on: true });
    expect(busy.state.svcBusy).toBeTruthy();
    expect(reduce(busy.state, { type: "keyAdd" }).effects).toEqual([]);
    expect(reduce(busy.state, { type: "testIntent" }).effects).toEqual([]);
    const moved = reduce(busy.state, { type: "tab", delta: 1 });
    expect(moved.state.region).toBe("top"); // single-tab pages ignore context arrows
    expect(reduce(busy.state, { type: "context", delta: 1 }).state.context).toBe(4);
    const idle = reduce(busy.state, { type: "serviceBusy", on: false });
    expect(idle.state.svcBusy).toBeNull();
  });

  it("connData lands snapshots; rowCount covers both pages", () => {
    const s = reduce(loaded(), { type: "connData", weknora: null, usegpt: { configured: false, daemonRunning: false, tunnelRunning: false, issues: ["not-configured"], keySource: "missing" as const, savedKey: false } });
    expect(s.state.weknora).toBeNull();
    expect(s.state.usegpt?.configured).toBe(false);
    expect(rowCount({ ...loaded(), page: "knowledge" as const, context: 4, weknora: null })).toBe(5);
    expect(rowCount({ ...loaded(), page: "tools" as const, context: 5 })).toBe(7);
  });
});

describe("P6 connection parity writes", () => {
  const usegptState = (over: Partial<State> = {}): State => ({
    ...loaded(), region: "content" as const, page: "tools" as const, context: 5, ...over,
    usegpt: { configured: true, daemonRunning: false, tunnelRunning: false, issues: [], tunnelId: "tunnel_old_00000000", dataDir: "/home/u/.arks/hub", keySource: "missing" as const, savedKey: false },
  });
  const yesPick = (s: State): { state: State; effects: unknown[] } => reduce({ ...s, modal: { ...s.modal!, cursor: 1 } }, { type: "modalPick" });

  it("weknora remove row asks cancel-default consent and writes only on yes", () => {
    const s = { ...loaded(), region: "content" as const, page: "knowledge" as const, context: 4, row: 4 } as State;
    const asked = reduce(s, { type: "enter" });
    expect(asked.state.modal?.tag).toBe("wek-remove");
    expect(asked.effects).toEqual([]);
    expect(reduce(asked.state, { type: "modalPick" }).effects).toEqual([]); // cancel at default cursor
    expect(yesPick(asked.state).effects).toEqual([{ type: "op", op: { kind: "wekRemove" } }]);
  });

  it("usegpt tunnel/dir forms validate before dispatching a save", () => {
    const bad = reduce({ ...usegptState(), row: 3 }, { type: "keyEdit" });
    expect(bad.state.mode).toBe("form");
    const typed = { ...bad.state, form: { ...bad.state.form!, draft: "nope" } };
    expect(reduce(typed, { type: "formSave" }).effects).toEqual([]);
    const good = { ...typed, form: { ...typed.form!, draft: "tunnel_new_00000001" } };
    const saved = reduce(good, { type: "formSave" });
    expect(saved.effects).toEqual([{ type: "op", op: { kind: "usegptSave", field: "tunnelId", value: "tunnel_new_00000001" } }]);
    expect(saved.state.mode).toBe("browse");
    const dForm = reduce({ ...usegptState(), row: 4 }, { type: "keyEdit" });
    const rel = { ...dForm.state, form: { ...dForm.state.form!, draft: "relative/path" } };
    expect(reduce(rel, { type: "formSave" }).effects).toEqual([]);
    const traversal = { ...rel, form: { ...rel.form!, draft: "/home/u/../hub2" } };
    expect(reduce(traversal, { type: "formSave" }).effects).toEqual([]);
    const abs = { ...rel, form: { ...rel.form!, draft: "/home/u/hub2" } };
    expect(reduce(abs, { type: "formSave" }).effects).toEqual([{ type: "op", op: { kind: "usegptSave", field: "dataDir", value: "/home/u/hub2" } }]);
  });

  it("usegpt key entry masks, asks replace consent only over a saved key, hands the draft to the op only on yes", () => {
    const fresh = reduce({ ...usegptState(), row: 5 }, { type: "keyEdit" });
    expect(fresh.state.form?.field).toBe("secret");
    expect(fresh.state.form?.typing).toBe(true);
    const typed = { ...fresh.state, form: { ...fresh.state.form!, draft: "sk-secret-123", typing: false } };
    const direct = reduce(typed, { type: "formSave" });
    expect(direct.effects).toEqual([{ type: "op", op: { kind: "usegptKey", secret: "sk-secret-123" } }]);
    const over: State = { ...typed, usegpt: { ...typed.usegpt!, savedKey: true, keySource: "file" as const } };
    const asked = reduce(over, { type: "formSave" });
    expect(asked.effects).toEqual([]);
    expect(asked.state.modal?.tag).toBe("usegpt-key-replace");
    expect(reduce(asked.state, { type: "modalPick" }).effects).toEqual([]);
    const yes = yesPick(asked.state);
    expect(yes.effects).toEqual([{ type: "op", op: { kind: "usegptKey", secret: "sk-secret-123", replaceSavedKey: true } }]);
  });

  it("usegpt unlink is a consent modal; cancel writes nothing", () => {
    const asked = reduce({ ...usegptState(), row: 6 }, { type: "enter" });
    expect(asked.state.modal?.tag).toBe("usegpt-unlink");
    expect(reduce(asked.state, { type: "modalPick" }).effects).toEqual([]);
    expect(yesPick(asked.state).effects).toEqual([{ type: "op", op: { kind: "usegptUnlink" } }]);
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

  it("u/d reorders; Esc with a dirty draft asks discard with Cancel default", () => {
    const moved = reduce(config(), { type: "orderMove", delta: 1 }); // row 0 down
    expect(moved.state.orderDraft).toEqual(["tavily", "exa", "firecrawl", "searxng"]);
    const esc = reduce(moved.state, { type: "escape" });
    expect(esc.state.modal?.tag).toBe("order-discard");
    const yes = reduce({ ...esc.state, modal: { ...esc.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.state.orderDraft).toBeNull();
    expect(yes.effects).toEqual([]);
  });

  it("SearXNG rides along by default; saving the implicit add asks consent once, then persists the full list", () => {
    const base = config();
    const legacy = { ...base, snapshot: { ...base.snapshot!, providerOrder: ["exa", "tavily", "firecrawl"] as ProviderId[] } };
    expect(orderRows(legacy).join()).toBe("exa,tavily,firecrawl,searxng");
    expect(dirtyOrder(legacy)).toBe(true);
    const save = reduce(legacy, { type: "orderSave" });
    expect(save.state.modal?.tag).toBe("order-save-consent");
    const yes = reduce({ ...save.state, modal: { ...save.state.modal!, cursor: 1 } }, { type: "modalPick" });
    expect(yes.effects).toEqual([{ type: "op", op: { kind: "saveOrder", order: ["exa", "tavily", "firecrawl", "searxng"] } }]);
    const clean = reduce({ ...base, orderDraft: ["exa", "tavily", "firecrawl", "searxng"] }, { type: "orderSave" });
    expect(clean.effects).toEqual([]); // identical to saved -> honest no-op
    expect(clean.state.status).toContain("无更改");
  });

  it("Space toggles the routing participation of the row under the cursor only", () => {
    const t = reduce(config(), { type: "orderToggle" }); // exa, enabled in fixture
    expect(t.effects).toEqual([{ type: "op", op: { kind: "toggleProvider", provider: "exa", enabled: false } }]);
    expect(t.state.orderDraft).toBeNull(); // toggling is not a reorder; the draft stays untouched
    const firecrawl = reduce({ ...config(), row: 2 }, { type: "orderToggle" }); // fixture: enabled false
    expect(firecrawl.effects).toEqual([{ type: "op", op: { kind: "toggleProvider", provider: "firecrawl", enabled: true } }]);
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
  const diag = (ref: string, out = "success"): DiagEntry => ({ provider: "exa", when: "01:02:03", ref, out, dur: 12 });
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

describe("single bottom row semantics (P6.6)", () => {
  it("first data clears the loading notice", () => {
    const boot = reduce(initialState("en", "loading config..."), { type: "data", snapshot: snapshot([key("env:EXA_API_KEY")]) }).state;
    expect(boot.status).toBe("");
  });
  it("statusClear reverts a notice but never interrupts loading or test progress", () => {
    const st = reduce(loaded("en"), { type: "notice", text: "done" }).state;
    expect(reduce(st, { type: "statusClear" }).state.status).toBe("");
    const running = reduce(st, { type: "testBegin", provider: "exa", mode: "allKeys", total: 2 }).state;
    expect(running.status).toContain("0/2"); // testBegin takes the row over with progress
    expect(reduce(running, { type: "statusClear" }).state.status).toBe(running.status); // and aging must not blank it
  });
});
