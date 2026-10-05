import { BlockList, isIP } from "node:net";
import type { ArkSpacePaths } from "../config/paths.js";
import { SearxngInstanceSchema } from "../config/schema.js";
import { addSearxngInstance, loadConfig } from "../config/store.js";
import {
  getSetupSnapshot, addSetupKey, replaceSetupKey, removeSetupKey, setSetupKeyEnabled,
  setSetupProviderEnabled, setSetupProviderOrder, updateSetupInstance, removeSetupInstance, setSetupLanguage,
  type SetupProviderId, type SetupSnapshot,
} from "../config/manage.js";
import { loadCredentialEnvironment, loadCredentialStore, validateCredentialValue } from "../config/credentials.js";
import { executeWebSearch } from "../capabilities/web-search.js";
import { testSetupKeys, type SetupKeyTestResult } from "./setup-key-tests.js";
import { resolveWebSearchInput } from "../protocol/schema.js";
import { FAILURE_KINDS, type ProviderId } from "../protocol/types.js";
import { createSearchProviderRegistry } from "../providers/registry.js";
import { ProviderError } from "../errors/provider-error.js";
import { setupMessage, setupSafeError, type SetupLanguage } from "./setup-language.js";
import { SetupTerminal, setupFocusHelp, type WorkbenchView, type SetupTone, type SetupFocus, type SetupRoute, type SetupHint } from "./setup-terminal.js";

type PageIntent = "add" | "edit" | "details" | "preview" | "remove" | "toggleKey" | "toggleProvider" | "test" | "up" | "down" | "include" | "save" | "apply";
type PageBinding = SetupHint & { intent: PageIntent; keys: string[] };

const providers = ["exa", "tavily", "firecrawl", "searxng"] as const;
const names = ["Exa", "Tavily", "Firecrawl", "SearXNG"];
const keyPages = { exa: "https://dashboard.exa.ai/api-keys", tavily: "https://app.tavily.com/home", firecrawl: "https://www.firecrawl.dev/app/api-keys" };
const privateNetworks = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]] as const) privateNetworks.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const) privateNetworks.addSubnet(ip, prefix, "ipv6");

/** Real setup controller: session-only focus/drafts; all writes use existing management helpers. */
export async function runSetupWorkbench(paths: ArkSpacePaths, terminal: SetupTerminal, initialLanguage: SetupLanguage, options: { provider?: string; environment: NodeJS.ProcessEnv; signal?: AbortSignal; onLanguageChange?: (language: SetupLanguage) => void }) {
  let language = initialLanguage; let providerIndex = Math.max(0, providers.indexOf(options.provider as SetupProviderId));
  let route = "providers" as SetupRoute; let openedMenu = 0; let menuCursor = 0;
  let focus: SetupFocus = "menu"; let row = 0;
  let current: SetupSnapshot = { providers: [], providerOrder: [] }; let orderDraft: ProviderId[] | undefined;
  const selections = new Map<string, string>(); const positions = new Map<string, number>();
  const keyDiagnostics = new Map<string, SetupKeyTestResult>();
  const diagnosticId = (provider: string, reference: string) => `${provider}:${reference}`;
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000 ? value : undefined;
  const resultLabel = (state: SetupKeyTestResult["status"]) => ({ success: t("passed", "通过"), failure: t("failed", "失败"), skipped: t("unavailable", "不可测试"), cancelled: t("cancelled", "已取消"), "not-tested": t("not tested", "未测试") })[state];
  const cacheResult = (provider: SetupProviderId, result: SetupKeyTestResult) => {
    if (!current.providers.find(p => p.id === provider)?.keys.some(key => key.reference === result.reference)) return;
    keyDiagnostics.set(diagnosticId(provider, result.reference), {
      reference: result.reference, status: ["success", "failure", "skipped", "cancelled", "not-tested"].includes(result.status) ? result.status : "not-tested",
      attemptCount: numeric(result.attemptCount) ?? 0,
      ...(FAILURE_KINDS.includes(result.errorKind!) ? { errorKind: result.errorKind } : {}),
      ...(numeric(result.completedAt) !== undefined ? { completedAt: result.completedAt } : {}),
      ...(numeric(result.durationMs) !== undefined ? { durationMs: result.durationMs } : {}),
    });
  };
  const selectionId = () => route === "providers" ? providers[providerIndex]! : route;
  const t = (en: string, zh: string) => language === "zh" ? zh : en;
  const m = (key: Parameters<typeof setupMessage>[1], values?: Record<string, string | number>) => setupMessage(language, key, values);
  let status = t("Ready · unverified", "就绪 · 未联网验证"); let statusTone: SetupTone = "muted"; let lastNotice = "";
  const setStatus = (message: string, tone: SetupTone = "neutral") => { status = message; statusTone = tone; };
  const lifecycleTone = (state: string): SetupTone => state === "disabled" ? "danger" : state === "cooldown" || state === "exhausted" ? "warning" : "success";
  const diagnostics: string[] = [];
  const cancel = () => { if (options.signal?.aborted) throw new Error("Setup cancelled."); };
  const p = () => current.providers.find(p => p.id === providers[providerIndex])!;
  const keys = () => p().keys.filter(k => !(k.source === "missing" && !k.hasLocal && k.reference === `env:${p().id.toUpperCase()}_API_KEY`));
  const resources = () => p().id === "searxng" ? p().instances.map(i => i.baseUrl) : keys().map(k => k.reference);
  const list = () => route === "providers" ? resources() : route === "order" ? orderDraft ?? current.providerOrder : ["en", "zh"];
  const dirtyOrder = () => orderDraft !== undefined && orderDraft.join(",") !== current.providerOrder.join(",");
  const remember = () => { const identity = list()[row]; if (identity) selections.set(selectionId(), identity); positions.set(selectionId(), row); };
  const refresh = async (retainDiagnostics = true) => {
    // Read-only navigation retains historical rows, never current credential proof.
    // Managed writes invalidate them; missing references are pruned below.
    // No credential values or fingerprints are kept to detect external edits.
    if (!retainDiagnostics) { if (keyDiagnostics.size) lastNotice = ""; keyDiagnostics.clear(); }
    // Preserve external precedence while keeping malformed injected values unavailable in the metadata view.
    const environment = Object.fromEntries(Object.entries(options.environment).map(([name, value]) => [name, typeof value === "string" ? value : ""]));
    cancel(); current = await getSetupSnapshot(paths, environment);
    for (const id of keyDiagnostics.keys()) if (!current.providers.some(p => p.keys.some(key => diagnosticId(p.id, key.reference) === id))) keyDiagnostics.delete(id);
    const identity = selections.get(selectionId()); const entries = list(); const index = identity ? entries.indexOf(identity) : -1;
    row = index >= 0 ? index : Math.min(positions.get(selectionId()) ?? 0, Math.max(0, entries.length - 1)); remember();
  };
  // The page binding table drives both the displayed hints and keyboard dispatch.
  // Guards still run for disabled bindings so the reason is accessible without a button cursor.
  const bindings = (): PageBinding[] => {
    if (route === "language") return [{ intent: "apply", keys: ["return", "enter"], key: "Enter", label: t("Apply", "应用"), tone: "success" }];
    if (route === "order") return [
      { intent: "up", keys: ["u"], key: "u", label: t("Up", "上移"), reason: row === 0 ? m("boundary") : "" },
      { intent: "down", keys: ["d"], key: "d", label: t("Down", "下移"), reason: row >= list().length - 1 ? m("boundary") : "" },
      { intent: "remove", keys: ["delete"], key: "Del", label: t("Remove", "移除"), reason: list().length <= 1 ? m("nonemptyOrder") : "", tone: "danger" },
      { intent: "include", keys: ["I"], key: "I", label: t("Include", "加入"), tone: "success" },
      { intent: "save", keys: ["ctrl-s"], key: "Ctrl-S", label: t("Save", "保存"), tone: "success" },
    ];
    const provider = p(); const key = keys()[row]; const noObject = t("Select an object first.", "请先选择对象。");
    const instanceReason = provider.external ? m("envInstance") : !provider.instances[row] ? noObject : "";
    return [
      { intent: "edit", keys: ["return", "enter", "e"], key: "Enter/e", label: t("Edit", "编辑"), reason: provider.id === "searxng" ? instanceReason : keyGuard("replace"), tone: "warning" },
      { intent: "add", keys: ["a"], key: "a", label: t("Add", "添加"), tone: "success" },
      { intent: "details", keys: ["i"], key: "i", label: t("Details", "详情"), reason: selected() ? "" : noObject },
      ...(provider.id === "searxng" ? [] : [
        { intent: "preview" as const, keys: ["p"], key: "p", label: t("Preview", "预览"), reason: key?.available || key?.hasLocal ? "" : t("Preview unavailable: selected key is missing.", "无法预览：所选密钥缺失。") },
      ]),
      { intent: "remove", keys: ["d"], key: "d", label: t("Remove", "删除"), reason: provider.id === "searxng" ? instanceReason : keyGuard("remove"), tone: "danger" },
      ...(provider.id === "searxng" ? [] : [
        { intent: "toggleKey" as const, keys: ["space", " "], key: "Space", label: t("Key on/off", "密钥开关"), reason: key ? "" : noObject },
      ]),
      { intent: "toggleProvider", keys: ["v", "V"], key: "v", label: t("Provider on/off", "供应商开关"),
        reason: provider.external ? m("externalToggle") : provider.enabled && provider.keys.some(k => k.ownedResources) ? m("owned") : provider.id === "searxng" && !provider.instances.length ? m("noLocalInstance") : "", tone: provider.enabled ? "success" : "danger" },
      { intent: "test", keys: ["t"], key: "t", label: t("Test provider", "测试供应商"), reason: testReason() },
    ];
  };
  const testReason = () => !p().enabled || !(p().id === "searxng" ? p().instances.some(i => i.status !== "disabled" && i.status !== "cooldown") : keys().length > 0)
    ? t("Test unavailable: provider disabled or no configured objects.", "测试不可用：供应商已禁用或没有已配置对象。") : "";
  const view = (): WorkbenchView => {
    const provider = p(); const order = orderDraft ?? current.providerOrder;
    const state = (available: boolean, status: string) => !available ? m("unavailable") : m(status === "disabled" ? "disabled" : status === "cooldown" ? "cooldown" : status === "exhausted" ? "exhausted" : "enabled");
    const cells = route === "providers" ? provider.id === "searxng"
      ? provider.instances.map(i => [i.baseUrl, m(i.source ?? "local"), i.status.startsWith("configured") ? m("configured") : state(true, i.status)])
      : keys().map(k => [k.reference.slice(4), m(k.source), state(k.available, k.status)])
      : route === "order" ? order.map((id, index) => [id, String(index + 1), m(current.providers.find(p => p.id === id)?.enabled ? "enabled" : "disabled")])
        : [["English", language === "en" ? t("Current", "当前") : ""], ["中文", language === "zh" ? t("Current", "当前") : ""]];
    return {
      language, providers: names, providerIndex, menuCursor, openedMenu, route, focus,
      menu: [t("Providers", "供应商"), t("Configuration", "配置"), t("Settings", "设置"), t("Exit", "退出")],
      title: route === "providers" ? names[providerIndex]! : route === "order" ? dirtyOrder() ? t("Order · unsaved", "顺序 · 未保存") : t("Order · unchanged", "顺序 · 未更改") : "Language / 语言",
      summary: route === "providers" ? `${t("Provider", "供应商")} ${provider.enabled ? t("On", "开") : t("Off", "关")} · ${provider.automaticPosition ? `${t("auto", "自动")} #${provider.automaticPosition}` : t("explicit only", "仅显式")}`
        : route === "order" ? `${t("Saved", "已保存")}: ${current.providerOrder.join(" → ")}` : t("Global setup preference", "全局设置语言"),
      summaryTone: route === "providers" ? provider.enabled ? "success" : "danger" : "muted",
      columns: route === "providers" ? [provider.id === "searxng" ? "URL" : t("Reference", "引用"), t("Source", "来源"), t("Status", "状态")]
        : route === "order" ? [t("Provider", "供应商"), t("Position", "顺序"), t("Status", "状态")] : [t("Language", "语言"), t("Status", "状态")],
      cells, selected: row,
      rowTones: route === "providers" ? provider.id === "searxng" ? provider.instances.map(i => lifecycleTone(i.status)) : keys().map(k => k.available ? lifecycleTone(k.status) : "muted")
        : route === "order" ? order.map(id => current.providers.find(p => p.id === id)?.enabled ? "success" : "danger") : cells.map(() => "neutral"),
      hints: bindings().map(({ intent: _intent, keys: _keys, ...hint }) => hint),
      status: status + (lastNotice ? t(" · ! details", " · ! 详情") : ""), statusTone,
      footer: setupFocusHelp(focus, language),
    };
  };
  const confirm = (title: string, body: string, accept: string, tone: SetupTone) => terminal.confirm(view, title, body, accept, t("Cancel", "取消"), options.signal, tone);
  const errorText = (error: unknown) => error instanceof ProviderError ? setupSafeError(language, error.message) ?? m("notSaved", { kind: m(error.kind) }) : m("operationFailed");
  const notify = async (message: string, retain = true, tone: SetupTone = "danger") => {
    setStatus(message, tone); lastNotice = message;
    if (retain && !diagnostics.includes(message)) diagnostics.push(message);
    await terminal.notice(view, t("Details", "详情"), message, t("Close", "关闭"), options.signal, tone);
  };
  const mutate = async (fn: () => Promise<unknown>) => {
    cancel();
    // An attempted write may partially succeed before reporting a guarded error.
    if (keyDiagnostics.size) lastNotice = "";
    keyDiagnostics.clear();
    try { await fn(); setStatus(m("saved"), "success"); return true; } catch (error) { await notify(errorText(error)); return false; }
  };
  const selected = () => resources()[row];
  const keyGuard = (operation: "replace" | "remove") => {
    const key = keys()[row]; if (!key) return t("Select a key first.", "请先选择密钥。");
    if (key.ownedResources) return m("owned");
    if (operation === "replace" && (key.source === "environment" || !key.hasLocal)) return m("replacementReadOnly");
    if (operation === "replace" && current.providers.reduce((n, p) => n + p.keys.filter(k => k.reference === key.reference).length, 0) > 1) return m("sharedRef");
    return "";
  };
  const addOrEdit = async (edit: boolean) => {
    const provider = p(); const target = edit ? selected() : undefined;
    if (edit && !target) { setStatus(t("Select an object first.", "请先选择对象。"), "warning"); return; }
    if (provider.id !== "searxng") {
      const reason = edit ? keyGuard("replace") : ""; if (reason) { setStatus(reason, "warning"); lastNotice = reason; return; }
      let original = "";
      if (edit) {
        try {
          const local = (await loadCredentialStore(paths.credentials)).values[target!.slice(4)];
          if (!local || !validateCredentialValue(local)) { setStatus(t("Edit unavailable: stored key is missing or invalid.", "无法编辑：已保存密钥缺失或无效。"), "warning"); return; }
          original = local;
        } catch (error) { await notify(errorText(error)); return; }
      }
      let draft = original; let formError = "";
      for (;;)  {
        const values = await terminal.form(view, {
          presentation: "page", dirty: draft !== original, error: formError, title: `${t(edit ? "Edit" : "Add", edit ? "编辑" : "添加")} ${names[providerIndex]}`,
          fields: [{ label: t("API key", "API 密钥"), secret: true, value: draft }],
          notes: `${edit ? `${t("Target", "目标")}: ${target}\n` : ""}${keyPages[provider.id]}\n${t("Plaintext storage", "明文保存")}: ${paths.credentials}`,
          save: t("Save", "保存"), cancel: t("Cancel", "取消"), rejected: m("rejectedSecret"),
        }, options.signal);
        if (!values) return; draft = values[0]!; cancel();
        if (!validateCredentialValue(draft)) { formError = m("rejectedSecret"); setStatus(formError, "warning"); continue; }
        formError = "";
        if (edit && draft === original) { await refresh(); focus = "content"; setStatus(t("No changes.", "没有修改。"), "info"); return; }
        if (edit && !await confirm(t("Replace key", "替换密钥"), `${provider.id} / ${target}\n${m("replaceConsent")}`, t("Replace", "替换"), "warning")) continue;
        let added: string | undefined;
        const ok = await mutate(async () => { if (edit) await replaceSetupKey(paths, provider.id, target!, draft, options.environment); else added = await addSetupKey(paths, provider.id, draft, options.environment); });
        if (!ok) { formError = lastNotice; continue; }
        selections.set(selectionId(), added ?? target!); await refresh(); focus = "content"; return;
      }
    }
    const instance = edit ? provider.instances.find(i => i.baseUrl === target) : undefined;
    if (instance?.source === "environment") { setStatus(m("envInstance"), "warning"); return; }
    let url = instance?.baseUrl ?? ""; let cidrs = instance?.allowRanges.join(", ") ?? "";
    let validEndpoint = instance?.baseUrl; let scopedCidrs = cidrs; let formError = ""; let errorField = 0;
    const invalid = (message: string, field: number) => { formError = message; errorField = field; setStatus(message, "warning"); };
    for (;;) {
      const values = await terminal.form(view, {
        presentation: "page", error: formError, initialField: errorField,
        dirty: url !== (instance?.baseUrl ?? "") || cidrs !== (instance?.allowRanges.join(", ") ?? ""), title: `${t(edit ? "Edit" : "Add", edit ? "编辑" : "添加")} SearXNG`,
        fields: [{ label: "HTTP(S) URL", value: url }, { label: t("Manual CIDRs (blank = public)", "手动 CIDR（空白 = 公共网络）"), value: cidrs }],
        notes: t("Changed endpoint clears old CIDRs. Queries go to this endpoint.\nAdding local overrides the external endpoint; order is unchanged.", "更改端点清除旧 CIDR。查询将发送至此地址。\n添加本地实例覆盖外部端点；自动顺序不变。"),
        save: t("Save", "保存"), cancel: t("Cancel", "取消"), rejected: m("rejectedSecret"),
      }, options.signal);
      if (!values) return;
      url = values[0]!.trim(); const supplied = values[1]!.trim();
      const parsed = SearxngInstanceSchema.safeParse({ baseUrl: url || instance?.baseUrl, allowRanges: [] });
      if (!parsed.success) { cidrs = supplied; invalid(m("invalidUrl"), 0); continue; }
      const changed = validEndpoint !== undefined && validEndpoint !== parsed.data.baseUrl;
      validEndpoint = parsed.data.baseUrl;
      // Invalid-URL retries retain newly edited ranges, not just the latest field string.
      // Only unchanged ranges scoped to the preceding endpoint are inherited and cleared.
      cidrs = changed && supplied.split(/[,\s]+/).filter(Boolean).join(",") === scopedCidrs.split(/[,\s]+/).filter(Boolean).join(",") ? "" : supplied;
      let ranges = cidrs.split(/[,\s]+/).filter(Boolean);
      if (!SearxngInstanceSchema.safeParse({ baseUrl: parsed.data.baseUrl, allowRanges: ranges }).success) { invalid(m("invalidCidrs"), 1); continue; }
      scopedCidrs = cidrs;
      formError = ""; errorField = 0;
      let host: string;
      try { host = new URL(parsed.data.baseUrl).hostname.replace(/^\[|\]$/g, ""); }
      catch { invalid(m("invalidUrl"), 0); continue; }
      const family = isIP(host);
      if (!ranges.length && family && privateNetworks.check(host, family === 4 ? "ipv4" : "ipv6")) {
        const range = `${host}/${family === 4 ? 32 : 128}`;
        if (!await confirm(t("Network permission", "网络授权"), m("privateConsent", { range }), t("Authorize", "授权"), "warning")) continue;
        ranges = [range];
      } else if (ranges.length && (parsed.data.baseUrl !== instance?.baseUrl || ranges.join(",") !== instance?.allowRanges.join(","))) {
        if (!await confirm(t("Network permission", "网络授权"), `${parsed.data.baseUrl}\n${ranges.join(", ")}\n${t("Authorize explicit IP ranges for this instance only?", "仅为此实例授权显式 IP 范围？")}`, t("Authorize", "授权"), "warning")) continue;
      }
      if (await mutate(() => edit ? updateSetupInstance(paths, target!, parsed.data.baseUrl, ranges) : addSearxngInstance(paths.config, parsed.data.baseUrl, ranges))) {
        selections.set(selectionId(), parsed.data.baseUrl); await refresh(); focus = "content"; return;
      }
    }
  };
  const remove = async () => {
    const provider = p(); const target = selected(); if (!target) { setStatus(t("Select an object first.", "请先选择对象。"), "warning"); return; }
    const reason = provider.id === "searxng" ? provider.external ? m("envInstance") : "" : keyGuard("remove");
    if (reason) { setStatus(reason, "warning"); lastNotice = reason; return; }
    const body = provider.id === "searxng" ? m(provider.instances.length === 1 ? "removeLastConsent" : "removeInstanceConsent") : m("removeKeyConsent");
    if (!await confirm(t("Remove", "删除"), `${provider.id} / ${target}\n${body}`, t("Delete", "删除"), "danger")) return;
    await mutate(() => provider.id === "searxng" ? removeSetupInstance(paths, target) : removeSetupKey(paths, provider.id, target));
    await refresh();
  };
  const preview = async () => {
    const reference = selected(); if (!reference || p().id === "searxng") return;
    // Re-read configuration and sources; preview never writes, probes, or enters diagnostics.
    try {
      remember(); await refresh();
      if (!keys().some(key => key.reference === reference)) {
        setStatus(t("Preview unavailable: selected reference changed.", "无法预览：所选引用已更改。"), "warning"); return;
      }
      const variable = reference.slice(4);
      const store = await loadCredentialStore(paths.credentials);
      const local = store.values[variable]; const external: unknown = options.environment[variable];
      const sources: { label: string; value: string }[] = [];
      if (local !== undefined) sources.push({ label: t("Local stored", "本地已保存"), value: local });
      if (Object.hasOwn(options.environment, variable)) {
        if (typeof external !== "string" || !validateCredentialValue(external)) {
          setStatus(t("Preview unavailable: invalid environment credential.", "无法预览：环境密钥无效。"), "danger"); return;
        }
        sources.push({ label: t(local ? "Effective environment (overrides local)" : "Effective environment", local ? "生效环境值（覆盖本地）" : "生效环境值"), value: validateCredentialValue(external)! });
      }
      if (!sources.length) { setStatus(t("Preview unavailable: selected key is missing.", "无法预览：所选密钥缺失。"), "warning"); return; }
      await terminal.previewSecret(view, { title: t("Key preview", "密钥预览") + ` · ${variable}`, sources,
        show: t("Show full", "显示完整"), hide: t("Hide", "隐藏"), close: t("Close", "关闭"), length: t("characters", "字符"),
      }, options.signal);
    } catch (error) {
      if (options.signal?.aborted || error instanceof Error && error.message === "Setup cancelled.") throw error;
      setStatus(t("Preview unavailable: credential source could not be read safely.", "无法预览：无法安全读取密钥来源。"), "danger");
    }
  };
  const liveTest = async () => {
    const provider = p();
    const reason = testReason(); if (reason) { setStatus(reason, "warning"); return; }
    const references = keys().map(key => key.reference);
    let mode = 0;
    if (provider.id === "searxng") {
      if (!await confirm(t("Test connection", "测试连接"), m("liveConsent", { id: provider.id }), t("Test", "测试"), "info")) return;
    } else {
      const consent = t(
        `Live queries to ${provider.id}; fees/logging may apply.\nPool: 5s total. All: 5s/key, max ${references.length} requests.\nAll includes disabled/cooling keys; no rotation/health changes.`,
        `向 ${provider.id} 发送真实请求，可能计费并被记录。\n轮询共 5 秒；全量每 Key 5 秒，最多 ${references.length} 次请求。\n全量包括禁用/冷却 Key；不改变轮询和健康状态。`,
      );
      const choice = await terminal.choose(view, t("Test connection", "测试连接"), [
        t("One pool test (round-robin)", "轮询测试一次"),
        t(`Test all ${references.length} keys individually`, `逐一测试全部 ${references.length} 个 Key`),
      ], t("Test", "测试"), t("Cancel", "取消"), options.signal, consent);
      if (choice === undefined) return; mode = choice;
    }
    cancel(); setStatus(mode === 1 ? t(`Testing keys 0/${references.length} · Esc stops · Ctrl-C exits`, `测试 Key 0/${references.length} · Esc 停止 · Ctrl-C 退出`) : t("Testing connection… Ctrl-C cancels", "正在测试连接… Ctrl-C 取消"), "info"); terminal.render(view());
    try {
      const config = await loadConfig(paths.config);
      const environment = await loadCredentialEnvironment(paths.credentials, options.environment);
      if (mode === 1 && provider.id !== "searxng") {
        const entry = config.providers[provider.id];
        if (!entry?.enabled || references.some(reference => !entry.keyRefs.includes(reference))) {
          await notify(t("Configuration changed; reopen the test dialog.", "配置已改变，请重新打开测试弹窗。")); await refresh(); return;
        }
        const report = await terminal.busy(view, signal => testSetupKeys({
          config: { ...config, providers: { ...config.providers, [provider.id]: { ...entry, keyRefs: references } } },
          provider: provider.id as "exa" | "tavily" | "firecrawl", environment, signal,
          onStart: (reference, index, total) => {
            if (!references.includes(reference)) return;
            setStatus(t(`Testing ${reference} · completed ${index - 1}/${total}`, `正在测试 ${reference} · 已完成 ${index - 1}/${total}`), "info"); terminal.render(view());
          },
          onResult: (result, completed, total) => {
            cacheResult(provider.id, result);
            setStatus(t(`Testing keys ${completed}/${total} · Esc stops · Ctrl-C exits`, `测试 Key ${completed}/${total} · Esc 停止 · Ctrl-C 退出`), "info"); terminal.render(view());
          },
        }), options.signal, true);
        for (const result of report.results) cacheResult(provider.id, result);
        const results = references.flatMap(reference => { const result = keyDiagnostics.get(diagnosticId(provider.id, reference)); return result ? [result] : []; });
        const passed = results.filter(row => row.status === "success").length;
        const summary = t(`Key results: ${passed}/${results.length} passed${report.cancelled ? " · stopped" : ""}`, `Key 结果：${passed}/${results.length} 通过${report.cancelled ? " · 已停止" : ""}`);
        const rows = results.map(row => `${row.reference.slice(4)} · ${resultLabel(row.status)}${row.errorKind ? " · " + m(row.errorKind) : ""}`);
        await notify(summary + "\n" + rows.join("\n"), false, report.cancelled ? "warning" : passed === results.length ? "success" : "danger");
      } else {
        const result = await terminal.busy(view, async signal => executeWebSearch(resolveWebSearchInput({ query: "Agent Skills documentation", provider: provider.id, maxResults: 1, timeoutMs: 5_000 }), {
          config, statePath: paths.state, providers: createSearchProviderRegistry(), environment, signal,
        }), options.signal);
        await notify(m("liveResult", { status: m(result.ok ? "success" : "failed"), count: result.attempts.length }) + "\n" + result.attempts.map(a => `${a.provider} · ${a.ok ? m("success") : m(a.errorKind ?? "failed")}`).join("\n"), true, result.ok ? "success" : "danger");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Setup cancelled.") throw error;
      await notify(errorText(error));
    }
    await refresh(mode === 1);
  };
  const draftStatus = (en: string, zh: string) => t(en, zh) + " · " + ((orderDraft ?? current.providerOrder).join(",") === current.providerOrder.join(",") ? t("unchanged", "未更改") : t("unsaved", "未保存"));
  const orderIntent = async (intent: PageIntent) => {
    const draft = orderDraft ??= [...current.providerOrder];
    if (intent === "up" || intent === "down") {
      const next = row + (intent === "up" ? -1 : 1);
      if (next < 0 || next >= draft.length) { setStatus(m("boundary"), "warning"); return; }
      [draft[row], draft[next]] = [draft[next]!, draft[row]!]; row = next; remember();
      setStatus(draftStatus("Moved in draft", "已移动草稿条目"), "warning");
    } else if (intent === "remove") {
      if (draft.length <= 1) { setStatus(m("nonemptyOrder"), "warning"); return; }
      draft.splice(row, 1); row = Math.min(row, draft.length - 1); remember();
      setStatus(draftStatus("Removed from draft", "已移除草稿条目"), "warning");
    } else if (intent === "include") {
      const available = current.providers.filter(p => !draft.includes(p.id) && (p.keys.some(k => k.available) || p.instances.length));
      if (!available.length) { setStatus(t("No configured provider to include.", "没有可加入的已配置 Provider。"), "warning"); return; }
      const index = await terminal.choose(view, t("Include provider", "加入 Provider"), available.map(p => p.id), t("Include", "加入"), t("Cancel", "取消"), options.signal);
      if (index !== undefined) {
        draft.push(available[index]!.id); row = draft.length - 1; remember();
        setStatus(draftStatus("Included in draft", "已加入草稿条目"), "warning");
      }
    } else if (intent === "save") {
      const old = (await getSetupSnapshot(paths, options.environment)).providerOrder;
      if (!draft.length) { setStatus(m("nonemptyOrder"), "warning"); return; }
      const privacy = old.join(",") !== draft.join(",") && [...old, ...draft].includes("searxng") && [...old, ...draft].some(id => id !== "searxng");
      const preview = `${t("Saved", "已保存")}: ${old.join(" → ")}\n${t("Draft", "草稿")}: ${draft.join(" → ")}`;
      if (!await confirm(t("Save order", "保存顺序"), preview + (privacy ? "\n" + m("routingConsent", { old: old.join(" → "), next: draft.join(" → ") }) : ""), t("Save", "保存"), "success")) return;
      if (await mutate(() => setSetupProviderOrder(paths, draft))) { orderDraft = undefined; await refresh(); }
    }
  };
  const openMenu = async () => {
    remember(); openedMenu = menuCursor;
    route = (["providers", "order", "language"] as const)[openedMenu]!;
    if (route === "order" && !orderDraft) orderDraft = [...current.providerOrder];
    await refresh(); focus = "content";
  };
  const switchProvider = async (delta: number) => {
    remember(); providerIndex = (providerIndex + delta + providers.length) % providers.length;
    // Global routes and drafts are not replaced by a context change.
    if (route === "providers") await refresh();
  };
  const details = async () => {
    const reference = selected(); remember(); await refresh();
    if (selected() !== reference) { setStatus(t("Selected reference changed; reopen details.", "所选引用已更改，请重新打开详情。"), "warning"); return; }
    if (p().id === "searxng") {
      const instance = p().instances[row]!;
      await terminal.notice(view, t("Details", "详情"), `${instance.baseUrl}\nCIDRs: ${instance.allowRanges.join(", ")}\n${t("Source", "来源")}: ${m(instance.source ?? "local")}\n${t("Provider configuration", "供应商配置")}: ${m(p().enabled ? "enabled" : "disabled")}\n${t("Keyless; permission applies only to this instance.", "无需密钥；授权仅适用于此实例。")}`, t("Close", "关闭"), options.signal, "info"); return;
    }
    const key = keys()[row]!; const last = keyDiagnostics.get(diagnosticId(p().id, key.reference));
    const reason = key.healthReason === "operator-disabled" ? t("manually disabled", "手动禁用") : FAILURE_KINDS.some(kind => kind === key.healthReason) ? m(key.healthReason as typeof FAILURE_KINDS[number]) : key.healthReason ? m("unknown") : t("none", "无");
    const health = ["enabled", "disabled", "cooldown", "exhausted"].includes(key.status) ? key.status as "enabled" | "disabled" | "cooldown" | "exhausted" : "unknown";
    const types = key.ownedResourceTypes;
    const body = [key.reference,
      `${t("Provider configuration", "供应商配置")}: ${m(p().enabled ? "enabled" : "disabled")}`,
      `${t("Effective source", "生效来源")}: ${key.source === "environment" && key.hasLocal ? t("environment overrides local", "环境值覆盖本地") : m(key.source)} · ${t("Local stored", "本地保存")}: ${key.hasLocal ? t("yes", "是") : t("no", "否")}`,
      `${t("Credential", "密钥值")}: ${key.available ? t("available (not verified)", "可用（未验证）") : t("missing or invalid; fix the effective source", "缺失或无效；请修复生效来源")}`,
      `${t("Key health", "密钥健康")}: ${m(health)} · ${t("Reason", "原因")}: ${reason}`,
      ...(numeric(key.cooldownRemainingMs) !== undefined ? [`${t("Cooldown remaining (snapshot)", "剩余冷却（快照）")}: ${Math.ceil(key.cooldownRemainingMs! / 1000)} s`] : []),
      `${t("Shared providers", "共享供应商")}: ${key.sharedProviders?.filter(id => providers.includes(id as SetupProviderId)).join(", ") || t("none", "无")}`,
      `${t("Owned resources", "拥有资源")}: ${numeric(key.ownedResources) ?? 0}${types ? ` · Browser ${numeric(types.browserSessions) ?? 0} · Monitor ${numeric(types.monitors) ?? 0} · Site Monitor ${numeric(types.siteMonitors) ?? 0}` : ""}`,
      `${t("Last diagnostic", "最近诊断")}: ${last ? resultLabel(last.status) : t("not tested", "未测试")}${last?.errorKind ? " · " + m(last.errorKind) : ""}`,
      ...(last?.completedAt !== undefined ? [`${t("Completed", "完成时间")}: ${new Date(last.completedAt).toISOString()}`] : []),
      ...(last?.durationMs !== undefined ? [`${t("Duration", "耗时")}: ${last.durationMs} ms`] : []),
      t("Historical session result, not current credential validation; external credential changes may make it stale.", "本次会话的历史结果，不代表当前密钥验证；外部更改密钥可能使其过时。"),
      t("Diagnostics are session-only; they do not enable keys or change health.", "诊断仅保留于本次会话；不会启用密钥或改变健康状态。"),
      keyGuard("replace") || t("Enter/e edits the local key; p previews with explicit disclosure.", "Enter/e 编辑本地密钥；p 预览需显式显示。"),
      ...(key.ownedResources ? [t("Clean up owned resources first: arks browser close / arks monitor delete / arks monitor site delete (with confirmation).", "请先清理拥有资源：arks browser close / arks monitor delete / arks monitor site delete（需确认）。")] : []),
      t("arks doctor checks local readiness; t opens consented network diagnostics. Space changes key health; v changes provider configuration.", "arks doctor 检查本地就绪状态；t 打开需授权的联网诊断。Space 更改密钥健康；v 更改供应商配置。"),
    ].join("\n");
    await terminal.notice(view, t("Details", "详情"), body, t("Close", "关闭"), options.signal, "info");
  };
  const dispatch = async (binding: PageBinding) => {
    // Preview re-reads sources before disclosure, including stale/missing references.
    if (binding.reason && binding.intent !== "preview") { setStatus(binding.reason, "warning"); lastNotice = binding.reason; return; }
    if (route === "order") { await orderIntent(binding.intent); return; }
    if (route === "language") {
      const next = row === 0 ? "en" : "zh";
      if (await mutate(() => setSetupLanguage(paths, next))) { language = next; setStatus(m("saved"), "success"); options.onLanguageChange?.(next); await refresh(); }
      return;
    }
    switch (binding.intent) {
      case "add": await addOrEdit(false); break;
      case "edit": await addOrEdit(true); break;
      case "remove": await remove(); break;
      case "preview": await preview(); break;
      case "details": await details(); break;
      case "test": await liveTest(); break;
      case "toggleProvider": await mutate(() => setSetupProviderEnabled(paths, p().id, !p().enabled)); await refresh(); break;
      case "toggleKey": {
        const key = keys()[row]!;
        await mutate(() => setSetupKeyEnabled(paths, p().id, key.reference, key.status === "disabled" || key.status === "cooldown")); await refresh(); break;
      }
    }
  };
  const exit = async () => confirm(t("Exit setup", "退出设置"), orderDraft && orderDraft.join(",") !== current.providerOrder.join(",")
    ? t("Discard the order draft and exit?", "放弃顺序草稿并退出？") : t("Exit setup?", "退出设置？"),
    orderDraft && orderDraft.join(",") !== current.providerOrder.join(",") ? t("Discard", "放弃") : t("Exit", "退出"), "warning");
  await refresh();
  try {
    for (;;) {
      cancel(); const key = await terminal.workbench(view, options.signal);
      const name = key.name;
      // Named keys (including CR/LF Enter and Space) take precedence over raw control bytes.
      // Only printable intent tokens retain sequence case, preserving uppercase V/I.
      const token = key.ctrl ? `ctrl-${name}` : name && name.length > 1 ? name
        : key.sequence?.length === 1 && /^[ -~]$/.test(key.sequence) ? key.sequence
          : key.shift && name?.length === 1 ? name.toUpperCase() : name ?? "";
      if (name === "escape") {
        if (route === "order" && dirtyOrder()) {
          if (await confirm(t("Discard order draft", "放弃顺序草稿"), t("Discard unsaved order changes?", "放弃未保存的顺序更改？"), t("Discard", "放弃"), "warning")) {
            orderDraft = undefined; row = Math.min(row, current.providerOrder.length - 1); remember(); setStatus(t("Draft canceled.", "草稿已取消。"));
          }
          focus = "content"; continue;
        }
        if (focus !== "menu") { focus = "menu"; menuCursor = openedMenu; continue; }
        if (await exit()) return; continue;
      }
      if (token === "[" || token === "]") { await switchProvider(token === "[" ? -1 : 1); continue; }
      if (name === "tab") {
        const regions: SetupFocus[] = ["top", "menu", "content"];
        focus = regions[(regions.indexOf(focus) + (key.shift ? -1 : 1) + regions.length) % regions.length]!; continue;
      }
      if (token === "?") {
        const instructions = [route === "providers" ? t("Keys / instances", "密钥 / 实例") : route === "order" ? t("Order draft", "顺序草稿") : t("Language", "语言"),
          t("Tab/Shift-Tab: Top/Menu/Content. Top ←→ switches provider; ↓ enters opened content. [ ] also switches provider.", "Tab/Shift-Tab：顶部/菜单/内容。顶部 ←→ 切换供应商；↓ 进入已打开内容。[ ] 也可切换供应商。"),
          t("Menu ↑↓ moves its pending cursor; Enter opens. * marks the opened function. Content ← returns to Menu; Menu → enters Content.", "菜单 ↑↓ 移动待选光标；Enter 打开。* 标记已打开功能。内容 ← 返回菜单；菜单 → 进入内容。"),
          t("Row actions act only in Content. v toggles the provider from Top/Menu/Content on the Providers page. Hints are not focusable buttons. ↑↓ selects rows; Home/End and PgUp/Dn move the list.", "行操作仅在内容区生效。供应商页的 v 在顶部、菜单、内容区均可切换供应商开关。提示不是可聚焦按钮。↑↓ 选择行；Home/End 和 PgUp/Dn 移动列表。"),
          ...bindings().map(binding => `${binding.key} ${binding.label}${binding.reason ? " — " + binding.reason : ""}`),
          route === "providers" ? t("Space toggles the selected KEY, not the provider. v toggles PROVIDER, independent of order. t tests the PROVIDER pool only after network consent.", "Space 切换所选密钥，不是供应商。v 切换供应商，与顺序独立。t 在联网授权后测试整个供应商池。") : "",
          t("Esc: dirty order asks Cancel/Discard; otherwise Content/Top → Menu → confirmed exit. ! shows reasons/diagnostics. Ctrl-C cancels.", "Esc：顺序草稿有更改时询问取消/放弃；否则内容/顶部 → 菜单 → 确认退出。! 显示原因/诊断。Ctrl-C 取消。")].filter(Boolean).join("\n");
        await terminal.notice(view, t("Help", "帮助"), instructions, t("Close", "关闭"), options.signal, "neutral"); continue;
      }
      if (token === "!") {
        const reasons = bindings().filter(binding => binding.reason).map(binding => `${binding.key} ${binding.label}: ${binding.reason}`);
        const details = [...diagnostics, ...reasons, ...(lastNotice ? [lastNotice] : [])].join("\n\n");
        if (details) await notify(details, false, reasons.length ? "warning" : statusTone); continue;
      }
      const binding = bindings().find(binding => binding.keys.includes(token));
      // Provider enablement targets the top context, not a selected row or pane.
      if (binding && (focus === "content" || binding.intent === "toggleProvider")) { await dispatch(binding); continue; }
      if (focus === "top") {
        if (name === "left" || name === "right") await switchProvider(name === "left" ? -1 : 1);
        else if (name === "down" || name === "return" || name === "enter") focus = "content";
        continue;
      }
      if (name === "left" && focus === "content") { focus = "menu"; continue; }
      if (name === "right" && focus === "menu") { focus = "content"; continue; }
      if (focus === "menu" && (name === "return" || name === "enter")) {
        if (menuCursor === 3) { if (await exit()) return; } else await openMenu();
        continue;
      }
      if (key.ctrl || !["up", "down", "pageup", "pagedown", "home", "end"].includes(name ?? "")) continue;
      const delta = (name === "up" || name === "pageup" ? -1 : 1) * (name === "pageup" || name === "pagedown" ? terminal.pageSize : 1);
      if (focus === "menu") menuCursor = name === "home" ? 0 : name === "end" ? 3 : Math.max(0, Math.min(3, menuCursor + delta));
      else { row = name === "home" ? 0 : name === "end" ? Math.max(0, list().length - 1) : Math.max(0, Math.min(list().length - 1, row + delta)); remember(); }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Setup cancelled.") throw error;
    await notify(errorText(error)); throw new Error("Setup operation failed.");
  }
}
