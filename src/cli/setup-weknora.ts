import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { getWeknoraConnectionSnapshot, saveWeknoraConnection, removeWeknoraConnection, type WeknoraConnectionSnapshot } from "../config/manage.js";
import { loadCredentialStore, validateCredentialValue } from "../config/credentials.js";
import { WeknoraConnectionSchema, WEKNORA_MANAGED_KEY_REF, type WeknoraConnection } from "../config/schema.js";
import { executeWeknoraVerify } from "../capabilities/weknora-verify.js";
import { setupSafeError, type SetupLanguage } from "./setup-language.js";
import { ProviderError } from "../errors/provider-error.js";
import type { SetupTerminal, WorkbenchView, SetupTone } from "./setup-terminal.js";

/** One connection page; no Provider identity, key pool, routing or state writes. */
export class SetupWeknora {
  private effective: WeknoraConnectionSnapshot | undefined;
  private saved: WeknoraConnection | undefined;
  private conflict = false;
  private result = "";
  private pending: string[] | undefined;
  hasDraft() { return this.pending !== undefined; }
  discardDraft() { this.pending = undefined; }
  private pendingStatus() {
    const missing = [!this.pending?.[0] ? this.t("address", "地址") : "", !this.pending?.[1] ? this.t("key", "密钥") : ""].filter(Boolean);
    return this.t("Draft · add ", "已暂存 · 待填写") + missing.join(this.t(" and ", "和"));
  }
  constructor(private readonly paths: ArkSpacePaths, private readonly terminal: SetupTerminal,
    private readonly environment: NodeJS.ProcessEnv, private readonly language: () => SetupLanguage,
    private readonly signal?: AbortSignal) {}
  private t(en: string, zh: string) { return this.language() === "zh" ? zh : en; }
  async refresh() {
    this.saved = (await loadConfig(this.paths.config)).connections?.weknora;
    this.conflict = ["WEKNORA_BASE_URL", "WEKNORA_API_KEY", WEKNORA_MANAGED_KEY_REF.slice(4)].some(name => Object.hasOwn(this.environment, name));
    try { this.effective = await getWeknoraConnectionSnapshot(this.paths, this.environment); }
    catch { this.effective = undefined; this.conflict = true; }
  }
  page() {
    const t = this.t.bind(this); const effective = this.effective;
    return {
      title: t("WeKnora configuration", "WeKnora配置"),
      summary: this.pending ? this.pendingStatus() : this.result || t(effective?.available ? "Configured · not tested" : this.conflict ? "External configuration · read-only" : this.saved ? "Missing credential · not tested" : "Not configured", effective?.available ? "已配置 · 未测试" : this.conflict ? "外部配置 · 只读" : this.saved ? "密钥缺失 · 未测试" : "尚未配置"),
      summaryTone: (this.conflict ? "warning" : "muted") as SetupTone,
      columns: [t("Setting", "设置"), t("Value", "值")],
      cells: [
        [t("Required · API address", "必填 · API地址"), this.pending?.[0] || effective?.baseUrl || this.saved?.baseUrl || t("not configured", "未配置")],
        [t("Required · API key", "必填 · API密钥"), this.pending?.[1] || effective?.available ? "********" : this.conflict ? t("unavailable", "不可用") : t("not entered", "未填写")],
        [t("Optional · Default KB ID", "选填 · 默认知识库ID"), (this.pending ? this.pending[2] : effective?.defaultKnowledgeBaseId ?? this.saved?.defaultKnowledgeBaseId) || t("none (optional)", "无（选填）")],
      ],
      rowTones: Array.from({ length: 3 }, () => "neutral" as const),
    };
  }
  hints(selectedRow = 0) {
    const readonly = this.conflict ? this.t("External configuration is read-only; change the address/key in the original environment.", "外部配置只读；请在原环境修改地址和密钥。") : "";
    return [
      { intent: "edit" as const, keys: ["return", "enter", "e"], key: "Enter/e", label: this.t("Edit selected field", "编辑所选字段"), reason: readonly },
      ...(selectedRow === 1 ? [{ intent: "preview" as const, keys: ["p"], key: "p", label: this.t("Preview key", "预览密钥") }] : []),
      { intent: "details" as const, keys: ["i"], key: "i", label: this.t("Details", "详情") },
      { intent: "remove" as const, keys: ["d"], key: "d", label: this.t("Remove local", "删除本地"), reason: this.saved ? "" : this.t("No local connection to remove.", "没有可删除的本地连接。"), tone: "danger" as const },
      { intent: "test" as const, keys: ["t"], key: "t", label: this.t("Test", "测试"), reason: this.effective?.available && !this.pending ? "" : this.t("Complete the address and key first; external settings must be fixed in their original environment.", "请先补齐地址和密钥；外部配置需在原环境修复。") },
    ];
  }
  async act(intent: string, view: () => WorkbenchView, selectedRow = 0) {
    const t = this.t.bind(this);
    const confirm = (title: string, body: string, accept: string, tone: SetupTone = "warning") => this.terminal.confirm(view, title, body, accept, t("Cancel", "取消"), this.signal, tone);
    const notice = (body: string, tone: SetupTone = "info") => this.terminal.notice(view, t("WeKnora details", "WeKnora 详情"), body, t("Close", "关闭"), this.signal, tone);
    await this.refresh();
    if (this.signal?.aborted) throw new Error("Setup cancelled.");
    if (intent === "preview") {
      if (selectedRow !== 1) return;
      const sources: { label: string; value: string }[] = [];
      if (this.pending?.[1]) sources.push({ label: t("Temporary · not saved", "本次暂存 · 未保存"), value: this.pending[1] });
      if (this.effective?.source === "environment") {
        const value = validateCredentialValue(this.environment.WEKNORA_API_KEY ?? "");
        if (value) sources.push({ label: t("Environment · WEKNORA_API_KEY", "环境变量 · WEKNORA_API_KEY"), value });
      } else if (this.saved) {
        const store = await loadCredentialStore(this.paths.credentials);
        const local = validateCredentialValue(store.values[WEKNORA_MANAGED_KEY_REF.slice(4)] ?? "");
        if (local) sources.push({ label: t("Local saved", "本地已保存"), value: local });
        const value = validateCredentialValue(this.environment[WEKNORA_MANAGED_KEY_REF.slice(4)] ?? "");
        if (value) sources.push({ label: t("Environment override · connection unavailable", "环境覆盖 · 连接不可用"), value });
      }
      if (sources.length) await this.terminal.previewSecret(view, { title: t("API key preview", "API密钥预览"), sources,
        show: t("Show full", "显示完整"), hide: t("Hide", "隐藏"), close: t("Close", "关闭"), length: t("characters", "字符") }, this.signal);
      else await notice(t("No key available to preview.", "没有可预览的密钥。"));
      return;
    }
    if (intent === "details") {
      await notice([
        `${t("API address", "API地址")}: ${this.pending?.[0] || this.effective?.baseUrl || this.saved?.baseUrl || t("not configured", "未配置")}`,
        ...(this.conflict ? [t("Source: original environment (read-only); change it there.", "来源：原始环境变量（只读）；请在原环境修改。")] : this.pending ? [this.pendingStatus()] : []),
        `${t("Key file", "密钥文件")}: ${this.effective?.source === "environment" ? t("not stored locally", "未保存在本地") : this.paths.credentials}`,
        `${t("Default KB (optional)", "默认知识库（选填）")}: ${(this.pending ? this.pending[2] : this.effective?.defaultKnowledgeBaseId ?? this.saved?.defaultKnowledgeBaseId) || t("none", "无")}`,
        `${t("Status", "状态")}: ${this.result || (this.effective?.available ? t("not tested", "未测试") : t("incomplete / unavailable", "未完成 / 不可用"))}`,
      ].join("\n")); return;
    }
    if (intent === "remove") {
      if (!this.saved || !await confirm(t("Remove local connection", "删除本地连接"), t("Unlink the saved connection and delete its unshared local credential? External values and all remote content remain untouched.", "取消已保存连接并删除未共享的本地凭据？外部变量及所有远程内容保持不变。"), t("Delete", "删除"), "danger")) return;
      await removeWeknoraConnection(this.paths); this.pending = undefined; this.result = ""; await this.refresh(); return;
    }
    if (intent === "test") {
      if (!this.effective?.available || this.pending) return;
      if (!await confirm(t("Test connection", "测试连接"), `${this.effective.baseUrl}\n` + t("Send a request to check the address and key, up to 5 seconds.", "发送请求检查地址和密钥，最长5秒。"), t("Test", "测试"), "info")) return;
      const result = await this.terminal.busy(view, signal => executeWeknoraVerify({ protocolVersion: 1, capability: "weknora.connection.verify", input: { confirmed: true, timeoutMs: 5000 } }, this.paths, this.environment, signal), this.signal, true);
      const outcomes: Record<string, string> = {
        auth: t("Authentication failed; check the API key.", "身份验证失败，请检查API密钥。"),
        permission: t("Server denied access; check account permissions.", "服务器拒绝访问，请检查账号权限。"),
        timeout: t("Connection timed out; check the server and network.", "连接超时，请检查服务器和网络。"),
        cancelled: t("Test stopped.", "测试已停止。"),
        network: t("Could not connect; check the server and network.", "无法连接，请检查服务器和网络。"),
        "rate-limit": t("Too many requests; try again later.", "请求过多，请稍后重试。"),
        "invalid-response": t("Unexpected server response; check the API address and server version.", "服务器响应异常，请检查API地址和服务器版本。"),
        "business-failure": t("Server did not accept the check; inspect its configuration.", "服务器未通过检查，请检查服务配置。"),
        config: t("Configuration unavailable; check the address and key source.", "配置不可用，请检查地址和密钥来源。"),
        "http-status": t("Server returned an error; check its status.", "服务器返回错误，请检查服务状态。"),
      };
      const message = result.ok ? t("Connection verified", "连接验证通过") : outcomes[result.error.kind] ?? t("Connection could not be verified; check the server configuration.", "未能验证连接，请检查服务器配置。");
      this.result = result.ok ? message : t("Connection test failed", "连接测试未通过");
      await notice(message, result.ok ? "success" : "warning"); return;
    }
    if (!["edit", "add"].includes(intent) || this.conflict) return;
    const original = this.saved;
    const store = await loadCredentialStore(this.paths.credentials);
    const stored = store.values[WEKNORA_MANAGED_KEY_REF.slice(4)];
    const originalKey = original && validateCredentialValue(stored ?? "") ? stored! : "";
    const initial = this.pending ? [...this.pending] : [original?.baseUrl ?? "", originalKey, original?.defaultKnowledgeBaseId ?? ""];
    const fieldIndexes = [Math.max(0, Math.min(2, selectedRow))];
    let draft = [...initial]; let error = "";
    let initialField = 0;
    const readyToSave = fieldIndexes[0] === 0 ? Boolean(initial[1]) : fieldIndexes[0] === 1 ? Boolean(initial[0]) : Boolean(initial[0] && initial[1]);
    const fieldNames = [t("API address", "API地址"), t("API key", "API密钥"), t("Default KB ID", "默认知识库ID")];
    const fieldNotes = [
      t("Enter the complete API address, e.g. https://kb.example/api/v1.", "填写完整API地址，例如 https://kb.example/api/v1。"),
      `${t("Key file", "密钥文件")}：${this.paths.credentials}\n` + t("Key hidden by default; return to the list and press p to preview.", "默认不显示密钥；返回列表后按 p 预览"),
      t("Optional: enter the default knowledge base ID; blank clears it.", "选填：填写默认知识库ID；留空清除默认值。"),
    ];
    const title = t("WeKnora configuration", "WeKnora配置") + ` · ${fieldNames[fieldIndexes[0]!]}`;
    for (;;) {
      const labels = [t("*API URL", "*API地址"), t("*API key", "*API密钥"), t("KB ID", "默认库ID")];
      const values = await this.terminal.form(view, { presentation: "page", title, dirty: draft.some((value, i) => value !== initial[i]), error, initialField,
        fields: fieldIndexes.map(index => ({ label: labels[index]!, value: draft[index]!, ...(index === 1 ? { secret: true } : {}) })),
        notes: fieldNotes[fieldIndexes[0]!]! + "\n" + (readyToSave ? t("After saving, return to the list and press t to test.", "保存后返回列表，可按 t 测试连接。") : t("Keep this field temporarily until address and key are complete; discarded on exit.", "本项先暂存，补齐地址和密钥后保存；退出会丢弃未完成项。")),
        save: readyToSave ? t("Save", "保存") : t("Keep temporarily", "暂存"), cancel: t("Cancel", "取消"), rejected: t("Rejected input", "输入被拒绝") }, this.signal);
      if (!values) return;
      if (this.signal?.aborted) throw new Error("Setup cancelled.");
      fieldIndexes.forEach((index, i) => { draft[index] = values[i]!; });
      if (draft.every((value, i) => value === initial[i]) && (original && originalKey || fieldIndexes[0] === 2)) return;
      const parsed = WeknoraConnectionSchema.safeParse({ baseUrl: draft[0] || "https://pending.example/api/v1", apiKeyRef: WEKNORA_MANAGED_KEY_REF, allowRanges: [], ...(draft[2] ? { defaultKnowledgeBaseId: draft[2] } : {}) });
      if (!parsed.success) { const invalidField = parsed.error.issues[0]?.path[0] === "defaultKnowledgeBaseId" ? 2 : 0; initialField = Math.max(0, fieldIndexes.indexOf(invalidField)); error = invalidField === 2 ? t("Invalid knowledge base ID; check it or leave blank.", "知识库ID无效；请检查或留空。") : t("Invalid API address; enter a complete address such as https://kb.example/api/v1.", "API地址无效；请填写完整地址，例如 https://kb.example/api/v1。"); continue; }
      if (fieldIndexes[0] === 0 && !draft[0]) { error = t("Enter a complete API address.", "请填写完整API地址。"); continue; }
      if (draft[1] && !validateCredentialValue(draft[1]!) || fieldIndexes[0] === 1 && !draft[1]) { initialField = Math.max(0, fieldIndexes.indexOf(1)); error = t("Supply a valid nonempty API key.", "请输入有效的非空 API 密钥。"); continue; }
      if (!draft[0] || !draft[1]) { this.pending = [...draft]; this.result = ""; return; }
      error = ""; initialField = 0;
      const endpointChanged = original && original.baseUrl !== parsed.data.baseUrl;
      const reuse = Boolean(endpointChanged && draft[1] === stored);
      if (reuse && !await confirm(t("Reuse saved key", "复用已保存密钥"), `${original!.baseUrl}\n→ ${parsed.data.baseUrl}\n` + t("Use the saved key with this new API address?", "允许将已保存密钥用于这个新API地址？"), t("Authorize", "授权"))) continue;
      const replace = stored !== undefined && draft[1] !== stored;
      if (replace && !await confirm(t("Replace key", "替换密钥"), t("Replace the key in the local file? Keys used elsewhere cannot be replaced here.", "替换本地文件中的密钥？其他服务仍使用的密钥不能在此替换。"), t("Replace", "替换"))) continue;
      // An unchanged key is reused, not rewritten, preserving shared-reference protections.
      this.result = "";
      try {
        await saveWeknoraConnection(this.paths, { baseUrl: parsed.data.baseUrl, allowRanges: [], ...(parsed.data.defaultKnowledgeBaseId !== undefined ? { defaultKnowledgeBaseId: parsed.data.defaultKnowledgeBaseId } : {}) }, originalKey && draft[1] === stored ? undefined : draft[1], { reuseSavedKey: reuse, replaceSavedKey: replace }, this.environment);
      } catch (failure) {
        error = failure instanceof ProviderError ? setupSafeError(this.language(), failure.message) ?? t("Connection save failed; inspect saved configuration and credentials before retrying. No error body was displayed.", "连接保存失败；重试前请检查已保存的配置和凭据。未显示错误正文。") : t("Unable to safely save local files; inspect saved state before retrying.", "无法安全保存本地文件；重试前请检查已保存状态。");
        await notice(error, "danger"); continue;
      }
      this.pending = undefined; await this.refresh(); return;
    }
  }
}
