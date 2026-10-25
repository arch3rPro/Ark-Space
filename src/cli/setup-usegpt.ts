import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { removeUseGptConfig, saveUseGptConfig } from "../config/usegpt.js";
import { USEGPT_TOKEN_VARIABLE, UseGptConfigSchema, type UseGptConfig } from "../config/schema.js";
import { executeUseGpt } from "../capabilities/usegpt.js";
import type { SetupLanguage } from "./setup-language.js";
import type { SetupTerminal, SetupTone, WorkbenchView } from "./setup-terminal.js";

export class SetupUseGpt {
  private saved: UseGptConfig | undefined;
  private pending: string[] | undefined;
  private result = "";
  constructor(private readonly paths: ArkSpacePaths, private readonly terminal: SetupTerminal,
    private readonly environment: NodeJS.ProcessEnv, private readonly language: () => SetupLanguage,
    private readonly signal?: AbortSignal) {}
  hasDraft() { return this.pending !== undefined; }
  discardDraft() { this.pending = undefined; }
  private t(en: string, zh: string) { return this.language() === "zh" ? zh : en; }
  private values() { return this.pending ?? [this.saved?.cdpUrl ?? "http://127.0.0.1:9222", this.saved?.serviceUrl ?? "http://127.0.0.1:47832"]; }
  async refresh() { this.saved = (await loadConfig(this.paths.config)).connections?.usegpt; }
  private tokenState() { return this.environment[USEGPT_TOKEN_VARIABLE]?.trim() ? this.t("configured", "已配置") : this.t("missing", "缺失"); }
  page() {
    const [cdpUrl, serviceUrl] = this.values();
    return {
      title: this.t("UseGPT configuration", "UseGPT配置"),
      summary: this.pending ? this.t("Draft · unsaved", "草稿 · 未保存") : this.result || (this.saved?.enabled ? this.t("Configured · not tested", "已配置 · 未测试") : this.t("Not configured", "尚未配置")),
      summaryTone: (this.pending ? "warning" : "muted") as SetupTone,
      columns: [this.t("Setting", "设置"), this.t("Value", "值")],
      cells: [
        [this.t("Chrome CDP URL", "Chrome CDP地址"), cdpUrl!],
        [this.t("Service URL", "服务地址"), serviceUrl!],
        [this.t("Token environment", "Token环境变量"), `${USEGPT_TOKEN_VARIABLE} · ${this.tokenState()}`],
      ],
      rowTones: ["neutral", "neutral", "neutral"] as SetupTone[],
    };
  }
  hints(selectedRow = 0) {
    return [
      { intent: "edit" as const, keys: ["return", "enter", "e"], key: "Enter/e", label: this.t("Edit selected address", "编辑所选地址"), reason: selectedRow > 1 ? this.t("Token is read from the environment only.", "Token仅从环境变量读取。") : "" },
      { intent: "details" as const, keys: ["i"], key: "i", label: this.t("Details", "详情") },
      { intent: "remove" as const, keys: ["d"], key: "d", label: this.t("Unlink local config", "解绑本地配置"), reason: this.saved ? "" : this.t("No local UseGPT configuration to remove.", "没有可删除的本地UseGPT配置。"), tone: "danger" as const },
      { intent: "test" as const, keys: ["t"], key: "t", label: this.t("Check live status", "检查实时状态"), reason: this.saved?.enabled && !this.pending ? "" : this.t("Save the addresses first.", "请先保存地址。") },
    ];
  }
  async act(intent: string, view: () => WorkbenchView, selectedRow = 0) {
    await this.refresh();
    if (this.signal?.aborted) throw new Error("Setup cancelled.");
    const t = this.t.bind(this);
    const confirm = (title: string, body: string, accept: string, tone: SetupTone = "warning") => this.terminal.confirm(view, title, body, accept, t("Cancel", "取消"), this.signal, tone);
    const notice = (body: string, tone: SetupTone = "info") => this.terminal.notice(view, t("UseGPT details", "UseGPT详情"), body, t("Close", "关闭"), this.signal, tone);
    if (intent === "remove") {
      if (!this.saved || !await confirm(t("Unlink UseGPT configuration", "解绑UseGPT配置"), t("Remove only the local binding. Tasks and the Chrome profile remain untouched.", "仅解绑本地配置；任务和Chrome profile保持不变。"), t("Unlink", "解绑"), "danger")) return;
      await removeUseGptConfig(this.paths); this.pending = undefined; this.result = ""; await this.refresh(); return;
    }
    if (intent === "details") {
      await notice([`${t("Chrome CDP URL", "Chrome CDP地址")}: ${this.values()[0]}`, `${t("Service URL", "服务地址")}: ${this.values()[1]}`, `${t("Token", "Token")}: ${USEGPT_TOKEN_VARIABLE} · ${this.tokenState()}`, t("Use an external Chrome with a separate profile and log in manually. Chrome 136 default profiles are not debuggable; background interference cannot be guaranteed.", "请使用独立profile的外部Chrome并手动登录。Chrome 136默认profile不可调试；无法保证后台不干扰。"), t("CDP is loopback only; serve on the browser host. SSH forwarding applies to the service port only. Setup never starts Chrome, installs it, logs in, or sends tasks.", "CDP仅允许loopback；serve需在浏览器主机。SSH forward仅用于service端口。Setup不会启动Chrome、安装、自动登录或发送任务。")].join("\n")); return;
    }
    if (intent === "test") {
      if (!this.saved?.enabled || this.pending) return;
      if (!await confirm(t("Check UseGPT status", "检查UseGPT状态"), t("Query the configured service and Chrome status. No task will be sent.", "查询已配置的服务和Chrome状态；不会发送任务。"), t("Check", "检查"), "info")) return;
      const response = await this.terminal.busy(view, signal => executeUseGpt({ protocolVersion: 1, capability: "usegpt.connection.status", input: {} }, this.paths, this.environment, signal), this.signal, true);
      const ok = response.ok && response.data?.connected === true && response.data?.authenticated === true && response.data?.composerAvailable === true;
      this.result = ok ? t("Connected and authenticated", "已连接且已登录") : t("Status check failed", "状态检查未通过");
      await notice(ok ? t("UseGPT is ready.", "UseGPT已就绪。") : t("UseGPT is not ready; check Chrome, service, and token configuration.", "UseGPT未就绪；请检查Chrome、服务和Token配置。"), ok ? "success" : "warning"); return;
    }
    if (intent !== "edit" || selectedRow > 1) return;
    const original = this.values(); let draft = [...original]; let error = "";
    for (;;) {
      const values = await this.terminal.form(view, { presentation: "page", title: t("UseGPT configuration", "UseGPT配置"), dirty: draft.some((value, index) => value !== original[index]), error, initialField: selectedRow, fields: [{ label: "*Chrome CDP URL", value: draft[0]! }, { label: "*Service URL", value: draft[1]! }], notes: t("Save addresses offline. Token is never entered or stored by setup. Use i for external Chrome and SSH instructions.", "地址可离线保存。Token不会由setup输入或保存。按i查看外部Chrome和SSH说明。"), save: t("Save", "保存"), cancel: t("Cancel", "取消"), rejected: t("Invalid loopback HTTP URL", "无效的loopback HTTP地址") }, this.signal);
      if (!values) return;
      if (this.signal?.aborted) throw new Error("Setup cancelled.");
      draft = values.map(value => value.trim());
      const parsed = UseGptConfigSchema.safeParse({ enabled: this.saved?.enabled ?? true, cdpUrl: draft[0], serviceUrl: draft[1], tokenRef: `env:${USEGPT_TOKEN_VARIABLE}` });
      if (!parsed.success) { error = t("Use a loopback HTTP origin without credentials, path, query, or fragment.", "请输入不带凭据、路径、查询或片段的loopback HTTP地址。"); continue; }
      this.pending = [...draft];
      try { await saveUseGptConfig(this.paths, parsed.data); }
      catch { error = t("Unable to save local configuration; retry or cancel.", "无法保存本地配置；请重试或取消。"); continue; }
      this.pending = undefined; this.result = ""; await this.refresh(); return;
    }
  }
}
