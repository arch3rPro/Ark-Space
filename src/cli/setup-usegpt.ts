import { homedir } from "node:os";
import { join } from "node:path";
import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { removeUseGptConfig, saveUseGptConfig } from "../config/usegpt.js";
import { USEGPT_API_KEY_VARIABLE, UseGptConfigSchema, type UseGptConfig } from "../config/schema.js";
import type { SetupLanguage } from "./setup-language.js";
import type { SetupTerminal, SetupTone, WorkbenchView } from "./setup-terminal.js";

const defaultDataDir = () => join(homedir(), ".arkspace", "usegpt");

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
  private values() { return this.pending ?? [this.saved?.tunnelId ?? "", this.saved?.dataDir ?? defaultDataDir()]; }
  async refresh() { this.saved = (await loadConfig(this.paths.config)).connections?.usegpt; }
  private apiKeyState() { return this.environment[USEGPT_API_KEY_VARIABLE]?.trim() ? this.t("configured", "已配置") : this.t("missing", "缺失"); }
  page() {
    const [tunnelId, dataDir] = this.values();
    return {
      title: this.t("UseGPT Artifact Hub", "UseGPT产物中心"),
      summary: this.pending ? this.t("Draft · unsaved", "草稿 · 未保存") : this.result || (this.saved?.enabled ? this.t("Configured · not tested", "已配置 · 未测试") : this.t("Not configured", "尚未配置")),
      summaryTone: (this.pending ? "warning" : "muted") as SetupTone,
      columns: [this.t("Setting", "设置"), this.t("Value", "值")],
      cells: [
        [this.t("Tunnel ID", "Tunnel ID"), tunnelId || this.t("missing", "缺失")],
        [this.t("Data directory", "数据目录"), dataDir!],
        [this.t("Control-plane API key", "Control-plane API key"), `${USEGPT_API_KEY_VARIABLE} · ${this.apiKeyState()}`],
      ],
      rowTones: ["neutral", "neutral", "neutral"] as SetupTone[],
    };
  }
  hints(selectedRow = 0) {
    return [
      { intent: "edit" as const, keys: ["return", "enter", "e"], key: "Enter/e", label: this.t("Edit selected setting", "编辑所选设置"), reason: selectedRow > 1 ? this.t("The API key is read from the environment only.", "API key仅从环境变量读取。") : "" },
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
      if (!this.saved || !await confirm(t("Unlink UseGPT configuration", "解绑UseGPT配置"), t("Remove the local Hub binding only. Stored task data is not deleted.", "仅解绑本地Hub配置；不会删除已保存的任务数据。"), t("Unlink", "解绑"), "danger")) return;
      await removeUseGptConfig(this.paths); this.pending = undefined; this.result = ""; await this.refresh(); return;
    }
    if (intent === "details") {
      await notice([
        `${t("Tunnel ID", "Tunnel ID")}: ${this.values()[0] || t("missing", "缺失")}`,
        `${t("Data directory", "数据目录")}: ${this.values()[1]}`,
        `${t("Control-plane API key", "Control-plane API key")}: ${USEGPT_API_KEY_VARIABLE} · ${this.apiKeyState()}`,
        t("Setup stores the Tunnel ID and the environment-variable reference only. Enter the restricted API key in your trusted terminal, never in this chat or the setup form.", "Setup仅保存Tunnel ID和环境变量引用。请在可信终端中设置受限API key，不要在聊天或setup表单中输入。"),
      ].join("\n")); return;
    }
    if (intent !== "edit" || selectedRow > 1) return;
    const original = this.values(); let draft = [...original]; let error = "";
    for (;;) {
      const values = await this.terminal.form(view, {
        presentation: "page", title: t("UseGPT Artifact Hub", "UseGPT产物中心"), dirty: draft.some((value, index) => value !== original[index]), error, initialField: selectedRow,
        fields: [{ label: "*Tunnel ID", value: draft[0]! }, { label: "*Data directory", value: draft[1]! }],
        notes: t("Save the Tunnel ID and data directory offline. API key is read from the environment and never entered or stored here.", "离线保存Tunnel ID和数据目录。API key从环境变量读取，不在此处输入或保存。"),
        save: t("Save", "保存"), cancel: t("Cancel", "取消"), rejected: t("Invalid Tunnel ID or absolute data directory", "Tunnel ID或绝对数据目录无效"),
      }, this.signal);
      if (!values) return;
      draft = values.map(value => value.trim());
      const parsed = UseGptConfigSchema.safeParse({ enabled: this.saved?.enabled ?? true, tunnelId: draft[0], apiKeyRef: `env:${USEGPT_API_KEY_VARIABLE}`, dataDir: draft[1] });
      if (!parsed.success) { error = t("Use a tunnel_ ID and an absolute local data directory.", "请输入tunnel_ ID和绝对本地数据目录。"); continue; }
      this.pending = [...draft];
      try { await saveUseGptConfig(this.paths, parsed.data); }
      catch { error = t("Unable to save local configuration; retry or cancel.", "无法保存本地配置；请重试或取消。"); continue; }
      this.pending = undefined; this.result = ""; await this.refresh(); return;
    }
  }
}
