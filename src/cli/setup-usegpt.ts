import { homedir } from "node:os";
import { join } from "node:path";
import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { removeUseGptConfig, saveUseGptConfig } from "../config/usegpt.js";
import { loadCredentialStore, storeCredential, validateCredentialValue } from "../config/credentials.js";
import { USEGPT_API_KEY_VARIABLE, UseGptConfigSchema, type UseGptConfig } from "../config/schema.js";
import type { SetupLanguage } from "./setup-language.js";
import type { SetupTerminal, SetupTone, WorkbenchView } from "./setup-terminal.js";

const defaultDataDir = () => join(homedir(), ".arkspace", "usegpt");

export class SetupUseGpt {
  private saved: UseGptConfig | undefined;
  private keyAvailable = false;
  private pending: string[] | undefined;
  private result = "";
  constructor(private readonly paths: ArkSpacePaths, private readonly terminal: SetupTerminal,
    private readonly environment: NodeJS.ProcessEnv, private readonly language: () => SetupLanguage,
    private readonly signal?: AbortSignal) {}
  hasDraft() { return this.pending !== undefined; }
  discardDraft() { this.pending = undefined; }
  private t(en: string, zh: string) { return this.language() === "zh" ? zh : en; }
  private values() { return this.pending ?? [this.saved?.tunnelId ?? "", this.saved?.dataDir ?? defaultDataDir()]; }
  async refresh() { this.saved = (await loadConfig(this.paths.config)).connections?.usegpt; this.keyAvailable = Boolean((await loadCredentialStore(this.paths.credentials)).values[USEGPT_API_KEY_VARIABLE]); }
  private apiKeyState() {
    if (Object.hasOwn(this.environment, USEGPT_API_KEY_VARIABLE)) return validateCredentialValue(this.environment[USEGPT_API_KEY_VARIABLE] ?? "")
      ? this.t("environment override", "环境覆盖") : this.t("invalid environment override", "环境覆盖无效");
    return this.keyAvailable ? this.t("saved locally", "已本地保存") : this.t("missing", "缺失");
  }
  page() {
    const [tunnelId, dataDir] = this.values();
    return {
      title: this.t("UseGPT Artifact Hub", "UseGPT产物中心"),
      summary: this.pending ? this.t("Draft · unsaved", "草稿 · 未保存") : this.result || (this.saved?.enabled ? this.t("Configured · not tested", "已配置 · 未测试") : this.t("Not configured", "尚未配置")),
      summaryTone: (this.pending ? "warning" : "muted") as SetupTone,
      columns: [this.t("Setting", "设置"), this.t("Value", "值")],
      cells: [
        [this.t("Tunnel ID", "隧道ID"), tunnelId || this.t("missing", "缺失")],
        [this.t("Data directory", "数据目录"), dataDir!],
        [this.t("API key", "API密钥"), `${USEGPT_API_KEY_VARIABLE} · ${this.apiKeyState()}`],
      ],
      rowTones: ["neutral", "neutral", "neutral"] as SetupTone[],
    };
  }
  hints(_selectedRow = 0) {
    return [
      { intent: "edit" as const, keys: ["return", "enter", "e"], key: "Enter/e", label: this.t("Edit selected setting", "编辑所选设置"), reason: "" },
      { intent: "details" as const, keys: ["i"], key: "i", label: this.t("Details", "详情") },
      { intent: "remove" as const, keys: ["d"], key: "d", label: this.t("Unlink local config", "解绑本地配置"), reason: this.saved ? "" : this.t("No local UseGPT configuration to remove.", "没有可删除的本地UseGPT配置。"), tone: "danger" as const },
    ];
  }
  async act(intent: string, view: () => WorkbenchView, selectedRow = 0) {
    await this.refresh();
    if (this.signal?.aborted) throw new Error("Setup cancelled.");
    const t = this.t.bind(this);
    const confirm = (title: string, body: string, accept: string, tone: SetupTone = "warning") => this.terminal.confirm(view, title, body, accept, t("Cancel", "取消"), this.signal, tone);
    const notice = (body: string, tone: SetupTone = "info") => this.terminal.notice(view, t("UseGPT details", "UseGPT详情"), body, t("Close", "关闭"), this.signal, tone);
    if (intent === "remove") {
      if (!this.saved || !await confirm(t("Unlink UseGPT configuration", "解绑UseGPT配置"), t("Remove the local Hub binding only. Stored task data and local credentials are not deleted.", "仅解绑本地Hub配置；不会删除已保存的任务数据和本地凭据。"), t("Unlink", "解绑"), "danger")) return;
      await removeUseGptConfig(this.paths); this.pending = undefined; this.result = ""; await this.refresh(); return;
    }
    if (intent === "details") {
      await notice([
        `${t("Tunnel ID", "隧道ID")}: ${this.values()[0] || t("missing", "缺失")}`,
        `${t("Data directory", "数据目录")}: ${this.values()[1]}`,
        `${t("API key", "API密钥")}: ${USEGPT_API_KEY_VARIABLE} · ${this.apiKeyState()}`,
        `${t("Local credential file", "本地凭证文件")}: ${this.paths.credentials}`,
        t("Select the API key row and press Enter to save a masked key locally. The credential store is plaintext with restrictive permissions. Environment values override saved credentials.", "选择API密钥行并按Enter，以遮罩输入保存本地密钥。凭证库为受限权限的明文存储，环境变量优先于已保存凭据。"),
      ].join("\n")); return;
    }
    if (intent !== "edit") return;
    if (selectedRow === 2) {
      const original = (await loadCredentialStore(this.paths.credentials)).values[USEGPT_API_KEY_VARIABLE] ?? "";
      let draft = original; let error = "";
      for (;;) {
        const values = await this.terminal.form(view, {
          presentation: "page", title: t("API key", "API密钥"), dirty: draft !== original, error, initialField: 0,
          fields: [{ label: t("*API key", "*API密钥"), value: draft, secret: true }],
          notes: `${t("Local credential file", "本地凭证文件")}: ${this.paths.credentials}\n` + t("Saved as plaintext with restrictive local permissions. Environment CONTROL_PLANE_API_KEY overrides the saved key. Existing content is loaded masked; cancel leaves it unchanged.", "密钥以明文保存在受限权限文件中。环境变量CONTROL_PLANE_API_KEY优先于已保存密钥。已保存内容以遮罩加载，取消不更改。"),
          save: t("Save", "保存"), cancel: t("Cancel", "取消"), rejected: t("Invalid API key", "API密钥无效"),
        }, this.signal);
        if (!values) return;
        this.signal?.throwIfAborted();
        const normalized = validateCredentialValue(values[0] ?? "");
        if (!normalized) { draft = ""; error = t("Enter a non-empty key without control characters or placeholders.", "请输入不含控制字符或占位值的非空密钥。"); continue; }
        draft = normalized;
        if (draft === original) return;
        if (original && !await confirm(t("Replace saved API key", "替换已保存API密钥"), t("Replace the locally saved API key? Environment values remain unchanged.", "替换本地已保存的API密钥？环境变量保持不变。"), t("Replace", "替换"))) return;
        this.signal?.throwIfAborted();
        try { await storeCredential(this.paths.credentials, USEGPT_API_KEY_VARIABLE, draft, { overwrite: true }); }
        catch { error = t("Unable to save the credential; retry or cancel.", "无法保存凭据；请重试或取消。"); continue; }
        await this.refresh(); return;
      }
    }
    const original = this.values(); let draft = [...original]; let error = "";
    for (;;) {
      const values = await this.terminal.form(view, {
        presentation: "page", title: t("UseGPT Artifact Hub", "UseGPT产物中心"), dirty: draft.some((value, index) => value !== original[index]), error, initialField: selectedRow,
        fields: [{ label: t("*Tunnel ID", "*隧道ID"), value: draft[0]! }, { label: t("*Data directory", "*数据目录"), value: draft[1]! }],
        notes: t("Save the Tunnel ID and data directory offline. API key is entered hidden and saved in the private credential store.", "离线保存隧道ID和数据目录。API密钥以隐藏输入保存到私密凭证库。"),
        save: t("Save", "保存"), cancel: t("Cancel", "取消"), rejected: t("Invalid Tunnel ID or absolute data directory", "隧道ID或绝对数据目录无效"),
      }, this.signal);
      if (!values) return;
      draft = values.map(value => value.trim());
      const parsed = UseGptConfigSchema.safeParse({ enabled: this.saved?.enabled ?? true, tunnelId: draft[0], apiKeyRef: `env:${USEGPT_API_KEY_VARIABLE}`, dataDir: draft[1] });
      if (!parsed.success) { error = t("Use a tunnel_ ID and an absolute local data directory.", "请输入以tunnel_开头的隧道ID和绝对本地数据目录。"); continue; }
      this.pending = [...draft];
      try { await saveUseGptConfig(this.paths, parsed.data); }
      catch { error = t("Unable to save local configuration; retry or cancel.", "无法保存本地配置；请重试或取消。"); continue; }
      this.pending = undefined; this.result = ""; await this.refresh(); return;
    }
  }
}
