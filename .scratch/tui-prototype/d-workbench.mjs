// Prototype D - three-axis workbench, ADR 0017 model, pi-tui engine, opencode-style panels.
// Run: node d-workbench.mjs   (real TTY, Node >=22.19). Fake data; writes nothing.
import {
  ProcessTerminal, TuiAltScreen, HStack, VStack, Text, Box, Input, SelectList,
  matchesKey, Key, visibleWidth, truncateToWidth,
} from "@earendil-works/pi-tui";

const zh = process.env.ARKS_LANG !== "en";
const T = (cn, en) => (zh ? cn : en); // call sites are consistently (中文, English)
const NC = process.env.NO_COLOR || !process.stdout.isTTY;
const c = (code, s) => (NC ? s : `\u001b[${code}m${s}\u001b[0m`);
const DIM = (s) => c("2", s), FG = (n, s) => c(n, s), SEL = (s) => c("30;46;1", s);
// ANSI/CJK-aware padding (padEnd miscounts both escape bytes and double-width chars)
const padV = (s, w) => s + " ".repeat(Math.max(0, w - visibleWidth(s)));

// ---------------- data ----------------
const store = {
  language: zh ? "zh" : "en",
  order: ["exa", "tavily", "searxng"],
  providers: {
    exa: { label: "Exa", enabled: true, keys: [
      { ref: "***a3f2", env: false, health: "verified", last: "812ms" },
      { ref: "env:EXA_API_KEY", env: true, health: "verified", last: "903ms" },
      { ref: "***7b10", env: false, health: "unknown", last: "-" },
      { ref: "***c44d", env: false, health: "cooling", last: "429 / 40ms" },
      { ref: "***e901", env: false, health: "failed", last: "timeout" },
      { ref: "***12ab", env: false, health: "verified", last: "770ms" },
      { ref: "***3cd7", env: false, health: "unknown", last: "-" },
      { ref: "***f808", env: false, health: "verified", last: "1.2s" } ] },
    tavily: { label: "Tavily", enabled: true, keys: [{ ref: "***9f2c", env: false, health: "unknown", last: "-" }] },
    firecrawl: { label: "Firecrawl", enabled: false, keys: [] },
    searxng: { label: "SearXNG", enabled: true, keys: [{ ref: "http://127.0.0.1:8888", env: false, health: "cooling", cidr: "127.0.0.0/8", last: "5s" }] },
  },
  diagnostics: [
    { ref: "Exa ***a3f2", out: T("成功", "ok"), ms: "812ms", when: "12:01:44" },
    { ref: "Exa ***c44d", out: T("失败/429", "failed/429"), ms: "40ms", when: "12:01:51" },
    { ref: "SearXNG 8888", out: T("不可达", "unreachable"), ms: "5s", when: "12:02:03" },
  ],
};
const PIDS = () => Object.keys(store.providers);
const HEALTH = { verified: ["+", 32], cooling: ["~", 33], failed: ["!", 31], unknown: ["?", 2], disabled: ["-", 90] };

// ---------------- app ----------------
const app = { region: "top", tab: 0, menu: 0, row: 0, page: "providers", status: T("就绪", "ready"), mode: "browse", formValue: "", sub: null, modeRef: null, editing: null, busy: null };

// ---------------- Framed panel (opencode-ish border) ----------------
class Framed {
  constructor(child, title) { this.child = child; this.title = title; this.h = 0; }
  setH(h) { this.h = h; }
  invalidate() { this.child.invalidate?.(); }
  handleInput(d) { this.child.handleInput?.(d); }
  handleMouse(e) { return this.child.handleMouse?.(e.y >= 1 ? { ...e, y: e.y - 1 } : e); }
  render(width) {
    const t = typeof this.title === "function" ? this.title() : this.title;
    const head = t ? `─ ${t} ` : "─";
    let out = [c("90", "╭" + head + "─".repeat(Math.max(0, width - visibleWidth(head) - 2)) + "╮")];
    let inner = this.child.render(width - 4);
    if (this.h >= 3) { // fill/clip to fixed height so borders never jump
      const need = this.h - 2;
      inner = inner.slice(0, need);
      while (inner.length < need) inner.push("");
    }
    for (const l of inner) out.push(c("90", "│") + " " + padV(l, width - 4) + " " + c("90", "│"));
    out.push(c("90", "╰" + "─".repeat(width - 2) + "╯"));
    return out;
  }
}

class Line { // single-row status/footer - never wraps, so layout height is constant
  constructor() { this.s = ""; }
  set(s) { this.s = s; }
  invalidate() {}
  render(width) { return [truncateToWidth(this.s, width)]; }
}

// ---------------- Top provider strip ----------------
class TopStrip {
  constructor() { this.hits = []; }
  invalidate() {}
  current() { return PIDS()[this.tab ?? app.tab]; }
  render(width) {
    const ids = PIDS();
    const segs = ids.map((id, i) => `[${store.providers[id].label}]`);
    const labels = ids.map((id, i) => {
      const p = store.providers[id];
      const txt = segs[i];
      if (i === app.tab) return app.region === "top" ? SEL(txt) : FG("1;36", txt);
      return p.enabled ? DIM(txt) : c("2", txt);
    });
    const inner = labels.join("   ");
    // constant-width status chips: " +n ~n !n " - no horizontal jitter when counts change
    const cur = store.providers[ids[app.tab]];
    const n = (h) => cur.keys.filter((k) => (k.disabled ? "disabled" : k.health) === h).length;
    const chip = padV(` ${FG(32, "+" + n("verified"))} ${FG(33, "~" + n("cooling"))} ${FG(31, "!" + n("failed"))}`, 14);
    const innerW = segs.reduce((a, s) => a + s.length, 0) + 3 * (segs.length - 1);
    let x0 = Math.max(1, Math.floor((width - innerW - visibleWidth(chip)) / 2));
    x0 = Math.min(x0, Math.max(1, width - innerW - visibleWidth(chip) - 1));
    this.hits = [];
    let off = 0;
    for (let i = 0; i < segs.length; i++) {
      this.hits.push([x0 + off, x0 + off + segs[i].length, i]);
      off += segs[i].length + 3;
    }
    const line = " ".repeat(x0) + inner;
    return [padV(line + " ".repeat(Math.max(1, width - x0 - innerW - visibleWidth(chip))) + chip, width)];
  }
  handleMouse(e) {
    for (const [a, b, i] of this.hits) if (e.x >= a && e.x <= b && e.type === "click") { app.tab = i; app.row = 0; return { handled: true, focus: false, render: true }; }
    return undefined;
  }
  handleInput(d) {
    if (matchesKey(d, Key.left)) app.tab = (app.tab + PIDS().length - 1) % PIDS().length;
    else if (matchesKey(d, Key.right)) app.tab = (app.tab + 1) % PIDS().length;
    else if (matchesKey(d, Key.down) || matchesKey(d, Key.enter)) setRegion("content");
    else if (d === "v" || d === "V") { const p = store.providers[PIDS()[app.tab]]; p.enabled = !p.enabled; status(`${p.label} ${p.enabled ? "ON" : "OFF"}`); }
    render();
  }
}

// ---------------- Key table ----------------
class KeyTable {
  constructor() { this.rows = []; }
  invalidate() {}
  items() {
    if (app.page === "providers") return store.providers[PIDS()[app.tab]].keys;
    if (app.page === "config") return orderRows().map((id) => ({ ref: store.providers[id].label, order: true }));
    if (app.page === "diagnostics") return store.diagnostics.map((d) => ({ ref: d.ref, diag: d }));
    return [];
  }
  render(width) {
    const rows = this.items();
    this.rows = rows;
    if (app.page === "providers") {
      const c1 = Math.min(26, Math.max(14, width - 40));
      const cell = (styled, plain, w) => styled + " ".repeat(Math.max(1, w - visibleWidth(plain)));
      const h1 = ` ${T("密钥参考", "key")}`; const h2 = T("状态", "health"); const h3 = T("路由位", "order"); const h4 = T("最近测试", "last");
      const out = [cell(DIM(h1), h1, c1 + 1) + cell(DIM(h2), h2, 13) + cell(DIM(h3), h3, 8) + DIM(h4)];
      const ids = PIDS();
      rows.slice(0, 14).forEach((k, i) => {
        const on = i === app.row && app.region === "content";
        const [ic, col] = HEALTH[k.disabled ? "disabled" : k.health] ?? HEALTH.unknown;
        const hTxt = k.env ? T("环境只读", "env/ro") : k.disabled ? T("已停用", "disabled") : T({ verified: "已验证", cooling: "冷却中", failed: "上次失败", unknown: "未测试" }[k.health] ?? "?", { verified: "verified", cooling: "cooling", failed: "failed", unknown: "untested" }[k.health] ?? "?");
        const pos = store.order.indexOf(ids[app.tab]);
        const plain1 = ` ${k.ref}`;
        const plain2 = ` ${ic} ${hTxt}`;
        const line = cell(plain1, plain1, c1 + 1) + cell(FG(col, plain2), plain2, 13) + cell(String(pos >= 0 ? pos + 1 : "-"), String(pos >= 0 ? pos + 1 : "-"), 8) + DIM(k.last ?? "-");
        out.push(on ? SEL(padV(line, width)) : padV(line, width));
      });
      if (rows.length > 14) out.push(DIM(` ... ${rows.length - 14} more`));
      if (!rows.length) out.push(DIM(" " + T("暂无密钥 / 按 a 或点下方 [添加]", "no keys / press a or click Add")));
      const btns = [["a", T("添加", "Add")], ["e", T("编辑", "Edit")], ["t", T("测试全部", "Test")], ["d", T("移除", "Remove")], ["Space", T("启停", "toggle")]];
      out.push("", " " + btns.map(([k, label]) => c("1;36", `[${k}]`) + " " + label).join("  "));
      return out;
    }
    if (app.page === "config") {
      const out = [];
      rows.forEach((r, i) => { const on = i === app.row && app.region === "content"; out.push(on ? SEL(padV(` ${i + 1}. ${r.ref}`, width)) : padV(` ${i + 1}. ${r.ref}`, width)); });
      out.push("", " " + c("1;36", "[u/d]") + " " + T("调序", "move") + "  " + c("1;36", "[I]") + " " + T("纳入", "include") + "  " + c("1;36", "[Ctrl-S]") + " " + T("保存", "save"));
      return out;
    }
    const out = [DIM(" " + T("本次会话诊断（内存态，不持久化）", "session diagnostics (memory only)")), ""];
    rows.forEach((r, i) => { const d = r.diag; const on = i === app.row && app.region === "content"; const okc = d.out.includes("失败") || d.out === "failed/429" ? 31 : d.out.match(/成功|ok/) ? 32 : 33; out.push(on ? SEL(padV(` ${d.when}  ${d.ref}`, width - 14)) + " " + FG(okc, d.out) + " " + DIM(d.ms) : padV(` ${d.when}  ${d.ref}`, width - 14) + " " + FG(okc, d.out) + " " + DIM(d.ms)); });
    return out;
  }
  handleMouse(e) {
    if (e.type !== "click") return undefined;
    const y = e.y - (app.page === "providers" ? 1 : app.page === "diagnostics" ? 2 : 1);
    if (app.page === "settings") return undefined;
    if (y >= 0 && y < this.rows.length) { app.row = y; app.region = "content"; render(); return { handled: true, focus: true }; }
    return undefined; // fall through: button bar clicks handled by parent for now
  }
  handleInput(d) {
    const n = this.items().length;
    if (matchesKey(d, Key.up)) app.row = Math.max(0, app.row - 1);
    else if (matchesKey(d, Key.down)) app.row = Math.min(Math.max(0, n - 1), app.row + 1);
    else if (app.page === "providers") {
      const p = store.providers[PIDS()[app.tab]];
      const k = p.keys[app.row];
      if (d === "a") { app.mode = "form"; app.editing = null; return switchContent(); }
      if (d === "t") return testFlow();
      if (d === "e" || matchesKey(d, Key.enter)) { if (!k) return render(); if (k.env) return status(T("环境密钥只读；本地优先需显式覆盖确认（实施）", "env key read-only; local override needs explicit confirm (impl)"), "33"), render(); app.mode = "form"; app.editing = k; return switchContent(); }
      if (d === "i") { if (!k) return render(); app.mode = "details"; app.modeRef = k; status(T("快照已刷新（模拟）", "snapshot refreshed (sim)")); return switchContent(); }
      if (d === "p") { if (!k || k.env) return status(T("环境密钥不可预览原文", "env keys cannot be previewed"), "33"), render(); app.mode = "preview"; app.modeRef = k; return switchContent(); }
      if (d === "d") { if (!k) return render(); return confirmOverlay(T(`移除 ${k.ref}？（默认取消）`, `Remove ${k.ref}? (cancel is default)`), () => { p.keys.splice(p.keys.indexOf(k), 1); store.diagnostics = store.diagnostics.filter((x) => !x.ref.includes(k.ref)); app.row = 0; status(T("已移除 / 该密钥诊断结果作废", "removed / its diagnostics invalidated")); render(); }); }
      if (d === " " && k && !k.env) { k.disabled = !k.disabled; return status(`${k.ref} ${k.disabled ? "OFF" : "ON"}`), render(); }
    } else if (app.page === "config") {
      const rows = orderRows();
      if (d === "u" && app.row > 0) { ensureDraft(); [orderDraft[app.row - 1], orderDraft[app.row]] = [orderDraft[app.row], orderDraft[app.row - 1]]; app.row--; }
      else if (d === "d" && app.row < rows.length - 1) { ensureDraft(); [orderDraft[app.row + 1], orderDraft[app.row]] = [orderDraft[app.row], orderDraft[app.row + 1]]; app.row++; }
      else if (matchesKey(d, Key.delete) && rows.length) { ensureDraft(); orderDraft.splice(app.row, 1); app.row = Math.max(0, app.row - 1); status(T("草稿：已移出顺序 / Ctrl-S 保存", "draft: dropped / Ctrl-S saves")); }
      else if (d === "I") { const rest = PIDS().filter((id) => !orderRows().includes(id)); if (!rest.length) return status(T("全部 Provider 已纳入", "all providers included")), render(); return menuModal(T("纳入路由（公开标识符会进入路由配置）", "Include in routing (public ids enter config)"), [{ value: "cancel", label: T("取消（默认）", "Cancel (default)") }, ...rest.map((id) => ({ value: id, label: store.providers[id].label }))], (v) => { if (v === "cancel") return; confirmOverlay(T(`确认将 ${store.providers[v].label} 纳入路由？`, `Route through ${store.providers[v].label}?`), () => { ensureDraft(); orderDraft.push(v); status(T("草稿已更新 / Ctrl-S 保存", "draft updated / Ctrl-S saves")); render(); }); }); }
      else if (matchesKey(d, "ctrl+s")) { if (!dirtyOrder()) return status(T("无更改 / 保存为空操作", "no changes / save is a no-op")), render(); store.order = [...orderRows()]; orderDraft = null; status(T("路由顺序已保存（原型仅内存）", "order saved (memory only)")); }
      else if (matchesKey(d, Key.escape)) { if (!dirtyOrder()) { setRegion("menu"); return; } confirmOverlay(T("放弃未保存的顺序？（默认取消）", "Discard unsaved order? (cancel default)"), () => { orderDraft = null; status(T("已放弃草稿", "draft discarded")); setRegion("menu"); }); return render(); }
    } else if (app.page === "diagnostics" && d === "t") return testFlow();
    render();
  }
}

// ---------------- settings page ----------------
const th = { selectedPrefix: SEL, selectedText: SEL, description: DIM, scrollInfo: DIM, noMatch: (s) => s };
function settingsList() {
  const l = new SelectList([
    { value: "zh", label: "中文", description: store.language === "zh" ? T("当前", "current") : "" },
    { value: "en", label: "English", description: store.language === "en" ? T("当前", "current") : "" },
  ], 4, th);
  l.onSelect = (i) => { store.language = i.value; status(T("语言已切换", "language switched")); render(); };
  return l;
}

// ---------------- left menu ----------------
const MENU = () => [
  { value: "providers", label: "Providers", description: T("密钥与动作", "keys") },
  { value: "config", label: T("Configuration", "Configuration"), description: T("路由顺序", "order") },
  { value: "settings", label: T("Settings", "Settings"), description: T("语言", "language") },
  { value: "diagnostics", label: T("Diagnostics", "Diagnostics"), description: String(store.diagnostics.length) },
  { value: "connections", label: "Connections", description: T("WeKnora / UseGPT", "WeKnora / UseGPT") },
  { value: "exit", label: T("Exit", "Exit"), description: "" },
];
function menuList() {
  // focus ring: highlighted row only reads as "focused" when the menu region actually owns focus
  const thM = { selectedPrefix: (s) => (app.region === "menu" ? SEL(s) : FG("1;36", s)), selectedText: (s) => (app.region === "menu" ? SEL(s) : FG("1;36", s)), description: DIM, scrollInfo: DIM, noMatch: (s) => s };
  const l = new SelectList(MENU(), 6, thM);
  l.onSelect = (i) => {
    if (i.value === "exit") return confirmOverlay(T("退出 ArkSpace Setup？", "Exit ArkSpace Setup?"), close);
    app.page = i.value; app.row = 0; setRegion("content");
  };
  l.onCancel = () => setRegion("top");
  return l;
}

// ---------------- masked input (form) ----------------
class MaskedInput {
  constructor() { this.v = ""; }
  invalidate() {}
  render(width) {
    return [
      " " + T("密钥值（掩码输入 / Enter 提交到草稿 / Esc 取消）", "secret (masked / Enter commits draft / Esc cancels)"),
      " " + FG(36, T("值：", "value:")) + "*".repeat(Math.min(this.v.length, width - 12)) + (NC ? "" : c("7", " ")),
      DIM(" " + T("保存需 Ctrl-S 并显式确认；原型不写盘", "save via Ctrl-S with explicit confirm; prototype writes nothing")),
    ];
  }
  handleInput(d) {
    if (matchesKey(d, Key.escape)) { app.mode = "browse"; return render(); }
    if (matchesKey(d, Key.enter)) {
      const p = store.providers[PIDS()[app.tab]];
      if (this.v.length >= 8) {
        if (app.editing) { const k = app.editing; store.diagnostics = store.diagnostics.filter((x) => !x.ref.includes(k.ref)); k.ref = "***" + this.v.slice(-4); k.health = "unknown"; k.last = "-"; status(T("已替换（实施：显式覆盖确认后写盘）", "replaced (impl: explicit overwrite + save)")); }
        else { p.keys.push({ ref: "***" + this.v.slice(-4), env: false, health: "unknown", last: "-" }); status(T("已添加（内存）", "added (memory)")); }
      } else status(T("太短，未保存", "too short, not saved"), "31");
      app.mode = "browse"; app.editing = null; this.v = ""; return setRegion("content");
    }
    if (matchesKey(d, Key.backspace)) { this.v = this.v.slice(0, -1); return render(); }
    const paste = /^\u001b\[200~([\s\S]*)\u001b\[201~$/.exec(d);
    if (paste) { this.v += paste[1].trim(); return render(); }
    if (d.length === 1 && d.codePointAt(0) >= 33 && d.codePointAt(0) !== 127) { this.v += d; return render(); }
  }
}

// ---------------- modal / draft / flow infra ----------------
let modalHandle = null;
function closeModal() { if (modalHandle) { modalHandle.hide(); modalHandle = null; } }
function menuModal(title, items, onPick) {
  const l = new SelectList(items.map(({ value, label, desc }) => ({ value, label, description: desc ?? "" })), Math.min(items.length, 6), th);
  l.setFilter("");
  l.onCancel = () => { closeModal(); render(); };
  l.onSelect = (i) => { closeModal(); onPick(i.value); render(); };
  modalHandle = tui.showOverlay(new Framed(l, title), { width: "62%", anchor: "center" });
  render();
}
// order draft - u/d/Del/I mutate a draft; Ctrl-S commits; Esc with dirty asks (cancel default)
let orderDraft = null;
const orderRows = () => orderDraft ?? store.order;
const dirtyOrder = () => !!orderDraft && orderDraft.join(",") !== store.order.join(",");
const ensureDraft = () => { if (!orderDraft) orderDraft = [...store.order]; };
// content modes: focus must follow the component swap or keys land on the old table
function switchContent() { focusOwner = contentFor(); tui.setFocus(focusOwner); render(); }
function exitMode() { app.mode = "browse"; app.editing = null; setRegion("content"); }
// test flow: scope chooser > fee consent (cancel default) > sequential progress, Esc stops > memory-only history
let testTimer = null;
function testFlow() {
  if (app.busy) return;
  menuModal(T("测试范围（默认取消）", "Test scope (cancel default)"), [
    { value: "cancel", label: T("取消（默认）", "Cancel (default)") },
    { value: "pool", label: T("池测试 / 当前 Provider", "pool test / current provider") },
    { value: "keys", label: T("逐密钥测试 / 全部本地密钥", "per-key test / all local keys") },
  ], (v) => { if (v === "cancel") return;
    confirmOverlay(T("将发起真实计费/网络请求（原型仅模拟）。继续？", "Would send billable/network requests (simulated here). Continue?"), () => runTest(v)); });
}
function runTest(scope) {
  const ids = scope === "pool" ? [PIDS()[app.tab]] : PIDS();
  const jobs = []; for (const id of ids) for (const k of store.providers[id].keys) if (!k.env && !k.disabled) jobs.push({ id, k });
  if (!jobs.length) return status(T("无可测密钥", "no testable keys"), "33"), render();
  app.busy = { i: 0, n: jobs.length };
  const step = () => {
    const { id, k } = jobs[app.busy.i]; const ok = Math.random() > 0.25;
    k.health = ok ? "verified" : "failed"; k.last = (200 + ((Math.random() * 900) | 0)) + "ms";
    store.diagnostics.unshift({ ref: `${store.providers[id].label} ${k.ref}`, out: ok ? T("成功", "ok") : T("失败/模拟", "failed/sim"), ms: k.last, when: new Date().toTimeString().slice(0, 8) });
    app.busy.i++;
    if (app.busy.i >= app.busy.n) { app.busy = null; testTimer = null; status(T("测试完成 / 历史仅内存", "done / history memory-only")); }
    else status(T(`测试中 ${app.busy.i}/${app.busy.n} / Esc 停止`, `testing ${app.busy.i}/${app.busy.n} / Esc stops`));
    render();
  };
  step(); if (app.busy) testTimer = setInterval(step, 600);
}
function stopTest() {
  if (testTimer) clearInterval(testTimer); testTimer = null;
  if (app.busy) { status(T(`已停止 ${app.busy.i}/${app.busy.n} / 保留已完成结果`, `stopped ${app.busy.i}/${app.busy.n} / partials kept`)); app.busy = null; render(); }
}
// details / preview are content-area page modes (right frame), not overlays - tests frame reuse
class Fields {
  constructor(rows) { this.rows = rows; }
  invalidate() {}
  render(w) { const t = Math.max(10, (w >> 1) - 2); return this.rows.map(([a, b]) => padV(" " + a, t) + padV(String(b), w - t)); }
  handleInput() { exitMode(); }
}
class PreviewPage {
  constructor(k) { this.k = k; this.reveal = false; }
  invalidate() {}
  render(w) { return [
    " " + T("安全预览 / 仅受信终端；返回即清除", "Secure preview / trusted TTY; cleared on exit"),
    " " + (this.reveal ? FG(36, "sk-live-fake-" + this.k.ref.slice(-4) + "-fullvalue") : DIM("***************  " + this.k.ref.slice(-4))),
    " " + DIM(T("r 显示/隐藏原文 / 其他任意键返回", "r toggle reveal / any other key returns")),
  ]; }
  handleInput(d) { if (d === "r") { this.reveal = !this.reveal; render(); } else exitMode(); }
}
function detailFields(k) {
  const id = PIDS()[app.tab];
  return [
    [T("来源", "source"), k.env ? T("环境变量 / 只读", "env var / read-only") : T("本地 credentials", "local credentials")],
    [T("状态", "health"), k.disabled ? T("已停用", "disabled") : k.health],
    [T("原因", "reason"), k.health === "failed" ? T("上次超时 / 无 payload", "last timeout / no payload") : k.health === "cooling" ? T("429 冷却中", "cooling after 429") : "-"],
    [T("冷却剩余", "cooldown left"), k.health === "cooling" ? "~10s" : "-"],
    [T("路由", "routing"), store.order.includes(id) ? T("在顺序内", "in order") : T("未纳入", "excluded")],
    [T("快照守卫", "snapshot guard"), T("实施：读取前刷新，引用变更则拒绝", "impl: refresh before read, refuse on ref change")],
  ];
}
// connections: two-level page (WeKnora / UseGPT) inside the same right frame
class ConnPanel {
  invalidate() {}
  top() { return [["WeKnora", T("端点已配置 / 未验证", "endpoint set / untested")], ["UseGPT", T("服务运行中 / 隧道开", "running / tunnel on")]]; }
  rows() {
    return app.sub === "WeKnora"
      ? [[T("地址", "endpoint"), "http://10.0.0.8:8080"], [T("密钥", "key"), "****2f9a" + (this.st ? "   " + this.st : "")], [T("动作", "actions"), "[t] " + T("验证", "verify") + " / [e] " + T("改密钥", "change key")]]
      : [[T("服务", "service"), this.st ?? T("运行中 / pid 1234", "running / pid 1234")], [T("隧道", "tunnel"), "wss://*** (on)"], [T("动作", "actions"), "[t] " + T("诊断", "diagnose") + " / [s] " + T("启停服务", "start/stop")]];
  }
  render(w) {
    if (!app.sub) { const out = this.top().map(([nm, st], i) => { const line = padV(` ${nm}`, 12) + DIM(st); return i === app.row && app.region === "content" ? SEL(padV(line, w)) : padV(line, w); }); out.push("", " " + c("1;36", "[Enter]") + " " + T("进入连接详情", "open details")); return out; }
    const out = this.rows().map(([a, b]) => padV(" " + a, 10) + String(b));
    out.push("", DIM(T(" t 验证/诊断（真实请求需同意）/ s 启停本地服务 / Esc 返回", " t verify/diagnose (billable needs consent) / s toggle service / Esc back")));
    return out;
  }
  handleInput(d) {
    if (!app.sub) {
      const rows = this.top();
      if (matchesKey(d, Key.up)) app.row = Math.max(0, app.row - 1);
      else if (matchesKey(d, Key.down)) app.row = Math.min(rows.length - 1, app.row + 1);
      else if (matchesKey(d, Key.enter)) { app.sub = rows[app.row][0]; this.st = null; }
      else if (matchesKey(d, Key.escape)) return setRegion("menu");
      return render();
    }
    if (matchesKey(d, Key.escape)) { app.sub = null; app.row = 0; return render(); }
    if (d === "t") { this.st = T("验证中...（模拟）", "checking... (sim)"); render(); setTimeout(() => { this.st = T("成功 / 214ms", "ok / 214ms"); status(T("连接检查完成", "connection check done")); render(); }, 900); return render(); }
    if (d === "s" && app.sub === "UseGPT") this.st = this.st === T("已停止", "stopped") ? T("运行中 / pid 1234", "running / pid 1234") : T("已停止", "stopped");
    if (d === "e" && app.sub === "WeKnora") { app.mode = "form"; app.editing = null; return setRegion("content"); }
    render();
  }
}

// ---------------- assembly ----------------
const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
let stripRef;
const stripBox = new Box(1, 0);
stripBox.addChild((stripRef = new TopStrip()));
const table = new KeyTable();
const connPanel = new ConnPanel();
const statusText = new Line();
const footer = new Line();
let menu = menuList();
let contentCache = { key: "", comp: null };
let focusOwner = null;

function contentFor() {
  const key = `${app.page}:${app.mode}:${app.sub ?? ""}`;
  if (contentCache.key === key && contentCache.comp) return contentCache.comp;
  let comp;
  if (app.mode === "form") comp = new MaskedInput();
  else if (app.mode === "details") comp = new Fields(detailFields(app.modeRef));
  else if (app.mode === "preview") comp = new PreviewPage(app.modeRef);
  else if (app.page === "settings") comp = settingsList();
  else if (app.page === "connections") comp = connPanel;
  else comp = table;
  contentCache = { key, comp };
  return comp;
}

function status(msg, col) { app.status = col ? FG(col, msg) : msg; }
const kb = (k, l) => c("1;36", `[${k}]`) + l;
function keyBar() {
  const parts = [kb("Tab", T("焦点区", "focus"))];
  if (app.mode === "form") parts.push(kb("Enter", T("提交草稿", "commit draft")), kb("Esc", T("取消", "cancel")));
  else if (app.mode === "preview") parts.push(kb("r", T("显隐", "reveal")), c("1;36", "[...]") + T("任意键返回", "any key back"));
  else if (app.mode === "details") parts.push(c("1;36", "[...]") + T("任意键返回", "any key back"));
  else if (app.busy) parts.push(kb("Esc", T("停止测试", "stop")));
  else if (app.page === "providers" && app.region === "content") parts.push(kb("a", T("添加", "add")), kb("e", T("编辑", "edit")), kb("i", T("详情", "details")), kb("p", T("预览", "preview")), kb("t", T("测试", "test")), kb("d", T("删除", "remove")), kb("Space", T("停用", "toggle")));
  else if (app.page === "config") parts.push(kb("u/d", T("调序", "move")), kb("Del", T("移出", "drop")), kb("I", T("纳入", "include")), kb("Ctrl-S", dirtyOrder() ? FG(33, T("保存*", "SAVE*")) : T("保存", "save")));
  else if (app.page === "connections") parts.push(app.sub ? kb("t", T("验证", "check")) + kb("s", T("服务", "service")) + kb("Esc", T("返回", "back")) : kb("Enter", T("进入", "open")));
  else parts.push(kb("Enter", T("选择", "pick")));
  parts.push(c("1;36", "[ ]") + T("切Provider", "provider"), kb("v", T("启停", "enable")), kb("?", T("帮助", "help")), kb("q", T("退出", "quit")));
  return "  " + parts.join(" ");
}
function setRegion(r) {
  app.region = r;
  focusOwner = r === "top" ? stripRef : r === "menu" ? menu : contentFor();
  tui.setFocus(focusOwner);
  render();
}
function render() {
  const content = contentFor();
  const rows = process.stdout.rows || 24; // winsize race can give 0/undefined - fall back, never eat the frame
  const H = Math.max(8, rows - 4); // strip + H + status + footer must be constant or borders jump
  const left = new Framed(menu, T("功能", "Menu")); left.setH(H);
  const rightTitle = app.mode === "details" ? T("详情", "Details") + " / " + (app.modeRef?.ref ?? "")
    : app.mode === "preview" ? T("安全预览", "Secure preview")
    : app.page === "providers" ? store.providers[PIDS()[app.tab]].label
    : app.page === "config" ? T("路由顺序", "Order") + " / " + (dirtyOrder() ? FG(33, T("未保存", "unsaved")) : T("未更改", "unchanged"))
    : app.page === "connections" ? (app.sub ?? T("连接服务", "Connections"))
    : { settings: T("设置", "Settings"), diagnostics: T("诊断", "Diagnostics") }[app.page];
  const right = new Framed(content, () => rightTitle + (app.mode === "form" ? " / " + T("表单", "form") : "")); right.setH(H);
  tui.setLayoutRoot(new VStack([
    { component: stripBox, basis: 1 },
    { component: new HStack([
      { component: left, basis: 22, shrink: 0 },
      { component: right, basis: 0, grow: 1 },
    ]), basis: H, grow: 0 },
    { component: statusText, basis: 1 },
    { component: footer, basis: 1 },
  ]));
  statusText.set(" " + app.status);
  footer.set(keyBar());
  tui.setFocus(focusOwner);
  tui.requestRender(true);
}

function confirmOverlay(msg, onYes) {
  menuModal(msg, [{ value: "no", label: T("取消（默认）", "Cancel (default)") }, { value: "yes", label: T("确认", "Confirm") }], (v) => { if (v === "yes") onYes(); });
}

tui.addInputListener((d) => {
  if (app.busy && matchesKey(d, Key.escape)) { stopTest(); return { consume: true }; }
  if (matchesKey(d, "ctrl+c")) { close(); return { consume: true }; }
  if (modalHandle) return undefined; // overlay owns keys (cancel-default lists)
  if (app.mode !== "browse") return undefined; // form / details / preview own keys via focus
  if (d === "q") { close(); return { consume: true }; }
  if (matchesKey(d, "tab")) { const order = ["top", "menu", "content"]; setRegion(order[(order.indexOf(app.region) + 1) % 3]); return { consume: true }; }
  if (matchesKey(d, "shift+tab")) { const back = { top: "content", menu: "top", content: "menu" }; setRegion(back[app.region]); return { consume: true }; }
  if (d === "[" ) { app.tab = (app.tab + PIDS().length - 1) % PIDS().length; return (setRegion("content"), { consume: true }); }
  if (d === "]" ) { app.tab = (app.tab + 1) % PIDS().length; return (setRegion("content"), { consume: true }); }
  if (d === "v" || d === "V") { const p = store.providers[PIDS()[app.tab]]; p.enabled = !p.enabled; status(`${p.label} ${p.enabled ? "ON" : "OFF"}`); return (render(), { consume: true }); }
  if (d === "?") { help(); return { consume: true }; }
  return undefined;
});

function help() {
  const hlp = new Text([
    FG("1", T("三轴工作台 / 帮助", "Workbench help")),
    T("Tab / Shift-Tab  在 Top、Menu、Content 三个焦点区循环", "Tab / Shift-Tab cycles Top, Menu, Content focus"),
    T("[ ]  切换 Provider 上下文（不启用、不发请求）", "[ ] switch provider context only"),
    T("v  启停当前 Provider / a/e/t/d/Space  密钥动作", "v provider on/off / a/e/t/d/Space key actions"),
    T("鼠标：点标签切 Provider，点行选中，点菜单进入", "mouse: click tab / row / menu"),
    T("所有安全语义保持：掩码、Cancel-default、CIDR 授权", "safety kept: masked, cancel-default, CIDR consent"),
  ].join("\n"), 1, 1);
  const hd = tui.showOverlay(new Framed(hlp, " ? "), { width: "80%", anchor: "center" });
  tui.addInputListener(function esc(d) { if (matchesKey(d, Key.escape) || d === "?") { hd.hide(); tui.removeInputListener(esc); render(); } });
}

function close() { tui.stop(); console.log(T("已退出 / 未写任何文件", "Exited / nothing written")); process.exit(0); }

// initial
menu = menuList();
render();
setRegion("top");
tui.start();