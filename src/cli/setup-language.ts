import type { SetupLanguage } from "../config/schema.js";
export type { SetupLanguage } from "../config/schema.js";

const en = {
  ready: "ArkSpace configuration ready at {path}\nAPI keys were not requested because this is not an interactive terminal.\nRun `arks setup` in a trusted local terminal.",
  safety: "\nArkSpace secure setup — trusted human terminal only.\nKeys are plaintext in {path}, protected by local file permissions.\nChanges save per entry; back does not undo. Blank/0 returns; Ctrl-C/EOF exits.",
  configuredCount: "{count} configured (unverified)",
  navigation: "↑/↓ select · Enter open · Esc/0 back · Ctrl-C exit",
  formFooter: "Enter submit · Esc back · Ctrl-C exit · Changes save immediately",
  back: "Back / exit", choice: "Choice (blank/0 goes back): ", invalidChoice: "Invalid choice; enter a listed number.",
  saved: "Saved immediately. Back does not undo saved changes.", cancelled: "Setup cancelled. Previously saved entries remain; pending input was discarded.",
  operationFailed: "Operation failed; check local configuration and file access. No error body was displayed.",
  notSaved: "Operation failed ({kind}). Check the selected reference, URL, permissions or owned resources; inspect saved state before retrying or going back.",
  cidrs: "Explicit CIDRs for this instance only (blank permits none; no DNS grants): ", invalidCidrs: "Invalid CIDRs; enter valid explicit IP ranges (prefer /32 or /128), or blank for none.",
  privateConsent: "Permit this private IP only ({range})? Queries will be sent to it.",
  searxngPrivacy: "SearXNG receives your queries. Instances rotate round-robin; automatic order is unchanged. Public endpoints need no private permissions.",
  instanceUrl: "SearXNG HTTP(S) URL (blank/0 returns): ", advancedUrl: "Advanced SearXNG HTTP(S) URL (blank/0 returns): ",
  invalidUrl: "Invalid URL: use HTTP(S) without credentials, query, fragment or controls.",
  keyInstructions: "{url}\nEnter one key at a time; blank returns. Never paste keys into Agent chats.",
  secret: "API key (hidden; blank returns): ", replacementSecret: "Replacement API key (hidden; blank cancels): ",
  rejectedSecret: "Rejected multiline or control input; enter one key at a time.",
  keysTitle: "{id} keys (no key values shown)", keyRow: "Key #{number} — {source}, {available}, {status}",
  keyDetailLine: "{reference} | ID {id} | {source} | {status} | owned resources: {owners}",
  envKey: "Environment-managed: replacement is read-only. Disable/unlink here does not delete the environment variable; edit your external environment separately.",
  keyDetail: "Key detail", replaceKey: "Replace selected local key (confirm)", restoreKey: "Restore cooled key now (clear cooldown)", enableKey: "Re-enable selected key", disableKey: "Disable selected key", removeKey: "Remove / unlink selected key (confirm)",
  replacementReadOnly: "Replacement requires a selected local key; environment-managed values are read-only.",
  replaceConsent: "Replace this selected local key? Owned resources may prevent replacement.",
  removeKeyConsent: "Remove this reference and its local credential if unshared? Environment values remain external.",
  instancesTitle: "SearXNG instances (reachability unverified)",
  envInstance: "Environment-managed endpoint: read-only. Change SEARXNG_URL / SEARXNG_BASE_URL externally, or explicitly add a local instance. Nothing was imported.",
  instanceTitle: "Instance: {url}; permissions: {ranges}", none: "none",
  editUrl: "Edit URL (public default / narrow IP consent)", editAdvanced: "Advanced: edit URL and explicit manual CIDRs", removeInstance: "Remove instance (confirm)",
  removeLastConsent: "Remove the last local instance? SearXNG will also be removed from automatic order; an external environment endpoint may become visible again.", removeInstanceConsent: "Remove this instance?",
  newUrl: "New HTTP(S) URL (blank keeps current URL; 0 cancels): ", invalidEditUrl: "Invalid credential-free HTTP(S) URL; not saved. Retry this URL or enter 0 to cancel.",
  liveConsent: "Send a live search to {id}? It may incur fees and request logs. Query: Agent Skills documentation.",
  liveResult: "Live test: {status}; {count} actual attempt(s). Only attempted keys/instances have execution evidence; other entries remain unverified.",
  attempt: "Attempt: {provider} {id} — {status}", success: "success", failed: "failed",
  externalProvider: "Environment-managed SearXNG endpoint: change its environment externally or explicitly add a local instance; enable/disable does not import it.",
  providerTitle: "{id} — {status}; {selection}", enabled: "enabled", disabled: "disabled", cooldown: "cooldown", exhausted: "exhausted", configured: "configured (not probed)",
  explicitOnly: "explicit-only", automatic: "automatic order {position}",
  addInstances: "Add instances", addKeys: "Add keys (continuous hidden input)", manageInstance: "Manage selected instance", manageKey: "Manage selected key",
  disableProvider: "Disable provider (does not change order)", enableProvider: "Enable provider (does not change order)", liveTest: "Live provider test (confirmation required)", advancedInstances: "Advanced add instances (explicit manual CIDRs)",
  externalToggle: "Environment-managed provider: no local toggle is available. Change the environment externally or add a local instance explicitly.",
  nonemptyOrder: "Keep at least one provider in the order.",
  routingConsent: "Change automatic order from {old} to {next}? Queries follow configured order and may reach hosted providers before or after SearXNG, or instead of it when removed. Approve this privacy-sensitive routing change?",
  orderTitle: "Automatic provider order: {order} (enable status is separate)", moveEarlier: "Move selected provider earlier", moveLater: "Move selected provider later", removeOrder: "Remove selected provider from order", includeProvider: "Include configured provider", includeTitle: "Include configured provider (append)", selectOrder: "Select order entry", boundary: "Already at the boundary.",
  dashboard: "Setup dashboard", manageOrder: "Manage automatic provider order", localCheck: "Local configuration check (no network)", localChecked: "Local configuration checked; no network request made. Credentials/instances are not live-validated. Run arks doctor for readiness details.",
  statusLine: "Status: {status} | Selection: {selection}", credentialsLine: "Credentials: {available} available / {total} references",
  availabilityNote: "Available = local validation only, not API validity.", sourcesLine: "Local: {local} | Environment: {environment} | Missing: {missing}",
  eligibleLine: "Eligible for new requests: {count}", healthLine: "Health: {cooldown} cooling | {disabled} disabled | {exhausted} exhausted", liveUnchecked: "Live verification: Not performed by dashboard (unverified)",
  instancesLine: "Instances (keyless): {total} | External: {external}", instanceHealth: "Health: {cooldown} cooling | {disabled} disabled", reachability: "Reachability: unverified (no network check)",
  local: "local", environment: "environment", missing: "missing", available: "available", unavailable: "unavailable", unknown: "unknown",
  yesNo: " [y/N] ",
  auth: "auth", permission: "permission", "rate-limit": "rate-limit", quota: "quota", transient: "transient", network: "network", "invalid-request": "invalid-request", "invalid-response": "invalid-response", config: "config",
  unsupportedProvider: "Unsupported setup provider. Choose exa, tavily, firecrawl, searxng or weknora.",
  readFiles: "Setup: Unable to read or update local setup files safely; inspect their permissions and format.", readCredentials: "Setup: Unable to read the credential store safely; inspect its permissions and format.",
  owned: "Setup: Tracked owned resources require this credential and enabled provider for cleanup; clean them up first.",
  staleKey: "Setup: The selected key reference is no longer configured; refresh setup.", invalidSecret: "Setup: Credential values must be non-empty and must not contain controls or placeholders.",
  environmentRef: "Setup: The selected reference is environment-managed; change it externally or add a new local key.", sharedRef: "Setup: The selected reference is shared; unlink it or add a new local key instead.", noLocalKey: "Setup: The selected key has no local credential to replace.",
  weknoraPartialSave: "Setup: Local credential remains stored as env:ARKSPACE_WEKNORA_API_KEY, but connection save failed; inspect local configuration before retrying.",
  weknoraPartialRemove: "Setup: WeKnora reference was unlinked, but its local credential remains stored; inspect the orphaned credential before retrying.",
  weknoraShared: "Setup: The WeKnora reference is shared; unlink other uses before replacing its credential.",
  partialAdd: "Setup: Local credential remains stored as {reference}, but registration failed; recover with arks key add {provider} --env {variable}.",
  partialReplace: "Setup: Local credential was replaced, but key health reset failed; inspect state before retrying.", partialRemove: "Setup: Reference was unlinked, but its local credential remains stored; remove the orphaned credential after inspecting the store.",
  noLocalInstance: "Setup: SearXNG has no local entry; environment endpoints are external. Add a local instance explicitly first.", noProvider: "Setup: Provider has no local configuration; add a key explicitly first.", invalidOrder: "Setup: Automatic provider order must be nonempty and contain no duplicates.", unknownProvider: "Setup: Unknown provider in automatic order.", invalidIdentity: "Setup: Invalid SearXNG instance identity.", staleInstance: "Setup: The selected instance is no longer configured; refresh setup.", invalidEndpoint: "Setup: Invalid SearXNG endpoint or per-instance CIDR configuration.", duplicateInstance: "SearXNG instance is already configured; permissions were not changed.", removeLastOrder: "Setup: Change automatic provider order before removing the last SearXNG instance.", invalidSearxng: "Setup: Invalid SearXNG URL.", keyedOnly: "Setup: SearXNG is keyless.", managedOnly: "Setup: Only Exa, Tavily, Firecrawl, and SearXNG are managed here.", invalidLanguage: "Setup: Setup language must be en or zh.",
} as const;
type Message = keyof typeof en;
const zh: Record<Message, string> = {
  ready: "ArkSpace 配置已就绪：{path}\n当前不是交互终端，因此未请求 API 密钥。\n请在可信的本地终端运行 `arks setup`。",
  safety: "\nArkSpace 安全设置 — 仅限可信的人工操作终端。\n密钥以明文存储在 {path}，由本地文件权限保护。\n每项更改立即保存；返回不会撤销。空白/0 返回；Ctrl-C/EOF 退出。",
  configuredCount: "已配置 {count} 项（未联网验证）",
  navigation: "↑/↓ 选择 · Enter 打开 · Esc/0 返回 · Ctrl-C 退出",
  formFooter: "Enter 提交 · Esc 返回 · Ctrl-C 退出 · 更改立即保存",
  back: "返回 / 退出", choice: "请选择编号（空白/0 返回）：", invalidChoice: "选择无效；请输入列出的编号。",
  saved: "已立即保存。返回不会撤销已保存的更改。", cancelled: "设置已取消。之前保存的项目仍然保留；待提交输入已丢弃。",
  operationFailed: "操作失败；请检查本地配置和文件访问权限。未显示错误正文。", notSaved: "操作失败（{kind}）。请检查所选引用、URL、权限或所属资源；重试或返回前先检查已保存状态。",
  cidrs: "仅此实例的显式 CIDR（空白不授予权限；不授权 DNS）：", invalidCidrs: "CIDR 无效；请输入有效的显式 IP 范围（建议 /32 或 /128），或留空。",
  privateConsent: "仅允许此私有 IP（{range}）？查询将发送至该地址。", searxngPrivacy: "SearXNG 会收到您的查询。实例轮流使用；自动顺序不变。公共端点无需私有网络权限。",
  instanceUrl: "SearXNG HTTP(S) URL（空白/0 返回）：", advancedUrl: "高级 SearXNG HTTP(S) URL（空白/0 返回）：", invalidUrl: "URL 无效：请使用无凭据、查询参数、片段或控制字符的 HTTP(S) URL。",
  keyInstructions: "{url}\n每次输入一个密钥；空白返回。切勿将密钥粘贴到 Agent 聊天中。", secret: "API 密钥（隐藏输入；空白返回）：", replacementSecret: "替换 API 密钥（隐藏输入；空白取消）：", rejectedSecret: "已拒绝多行或控制字符输入；请每次输入一个密钥。",
  keysTitle: "{id} 密钥（不显示密钥值）", keyRow: "密钥 #{number} — {source}，{available}，{status}", keyDetailLine: "{reference} | ID {id} | {source} | {status} | 所属资源：{owners}",
  envKey: "由环境管理：替换为只读。此处禁用/取消引用不会删除环境变量；请单独修改外部环境。", keyDetail: "密钥详情", replaceKey: "替换所选本地密钥（需确认）", restoreKey: "立即恢复冷却密钥（清除冷却）", enableKey: "重新启用所选密钥", disableKey: "禁用所选密钥", removeKey: "删除 / 取消所选密钥引用（需确认）", replacementReadOnly: "替换需要所选本地密钥；由环境管理的值为只读。", replaceConsent: "替换所选本地密钥？所属资源可能阻止替换。", removeKeyConsent: "删除此引用及其未共享的本地凭据？环境值仍由外部管理。",
  instancesTitle: "SearXNG 实例（连通性未验证）", envInstance: "由环境管理的端点：只读。请在外部修改 SEARXNG_URL / SEARXNG_BASE_URL，或明确添加本地实例。未导入任何内容。", instanceTitle: "实例：{url}；权限：{ranges}", none: "无", editUrl: "编辑 URL（默认公共地址 / 窄范围 IP 授权）", editAdvanced: "高级：编辑 URL 和显式手动 CIDR", removeInstance: "删除实例（需确认）", removeLastConsent: "删除最后一个本地实例？SearXNG 也会从自动顺序中移除；外部环境端点可能再次可见。", removeInstanceConsent: "删除此实例？", newUrl: "新 HTTP(S) URL（空白保留当前 URL；0 取消）：", invalidEditUrl: "无凭据 HTTP(S) URL 无效；未保存。请重试或输入 0 取消。",
  liveConsent: "向 {id} 发送联网搜索？可能产生费用和请求日志。查询：Agent Skills documentation。", liveResult: "联网测试：{status}；实际尝试 {count} 次。仅尝试过的密钥/实例有执行证据；其他项目仍未验证。", attempt: "尝试：{provider} {id} — {status}", success: "成功", failed: "失败",
  externalProvider: "由环境管理的 SearXNG 端点：请在外部修改环境或明确添加本地实例；启用/禁用不会导入该端点。", providerTitle: "{id} — {status}；{selection}", enabled: "已启用", disabled: "已禁用", cooldown: "冷却中", exhausted: "额度耗尽", configured: "已配置（未探测）", explicitOnly: "仅显式选择", automatic: "自动顺序 #{position}",
  addInstances: "添加实例", addKeys: "添加密钥（连续隐藏输入）", manageInstance: "管理所选实例", manageKey: "管理所选密钥", disableProvider: "禁用 Provider（不改变顺序）", enableProvider: "启用 Provider（不改变顺序）", liveTest: "Provider 联网测试（需确认）", advancedInstances: "高级添加实例（显式手动 CIDR）", externalToggle: "由环境管理的 Provider：没有本地开关。请在外部修改环境或明确添加本地实例。",
  nonemptyOrder: "顺序中至少保留一个 Provider。", routingConsent: "将自动顺序从 {old} 改为 {next}？查询按配置顺序发送，可能在 SearXNG 之前或之后发送至托管 Provider，移除后也可能改由托管 Provider 接收。确认此涉及隐私的路由更改？", orderTitle: "自动 Provider 顺序：{order}（启用状态独立）", moveEarlier: "将所选 Provider 前移", moveLater: "将所选 Provider 后移", removeOrder: "从顺序中移除所选 Provider", includeProvider: "加入已配置的 Provider", includeTitle: "加入已配置的 Provider（追加）", selectOrder: "选择顺序条目", boundary: "已经位于边界。",
  dashboard: "设置面板", manageOrder: "管理自动 Provider 顺序", localCheck: "本地配置检查（不联网）", localChecked: "本地配置已检查；未发送网络请求。凭据/实例未联网验证。请运行 arks doctor 查看就绪详情。",
  statusLine: "状态：{status} | 选择：{selection}", credentialsLine: "凭据：{available} 个本地检查可用 / {total} 个引用", availabilityNote: "可用仅指本地校验，不代表 API 有效。", sourcesLine: "本地：{local} | 环境：{environment} | 缺失：{missing}", eligibleLine: "可参与新请求：{count}", healthLine: "健康：{cooldown} 冷却中 | {disabled} 已禁用 | {exhausted} 额度耗尽", liveUnchecked: "联网验证：面板不主动检查（并非实时服务状态）", instancesLine: "实例（无需密钥）：{total} | 外部：{external}", instanceHealth: "健康：{cooldown} 冷却中 | {disabled} 已禁用", reachability: "连通性：未验证（未联网检查）",
  local: "本地", environment: "环境", missing: "缺失", available: "本地检查可用", unavailable: "不可用", unknown: "未知", yesNo: " [y/是/确认，默认否] ",
  auth: "身份验证", permission: "权限", "rate-limit": "请求限流", quota: "额度", transient: "暂时故障", network: "网络", "invalid-request": "请求无效", "invalid-response": "响应无效", config: "配置",
  weknoraPartialSave: "设置：本地凭据仍保留为 env:ARKSPACE_WEKNORA_API_KEY，但连接保存失败；重试前请检查本地配置。",
  weknoraPartialRemove: "设置：WeKnora 引用已取消，但本地凭据仍保留；重试前请检查孤立凭据。",
  weknoraShared: "设置：WeKnora 引用已共享；替换凭据前请先取消其他用途的引用。",
  unsupportedProvider: "不支持的设置 Provider。请选择 exa、tavily、firecrawl、searxng 或 weknora。",
  readFiles: "设置：无法安全读取或更新本地设置文件；请检查权限和格式。",  readCredentials: "设置：无法安全读取凭据文件；请检查权限和格式。", owned: "设置：已跟踪的所属资源需要此凭据和已启用的 Provider 进行清理；请先清理这些资源。", staleKey: "设置：所选密钥引用已不在配置中；请刷新设置。", invalidSecret: "设置：凭据不能为空，也不能包含控制字符或占位符。", environmentRef: "设置：所选引用由环境管理；请在外部修改或添加新的本地密钥。", sharedRef: "设置：所选引用已共享；请取消引用或添加新的本地密钥。", noLocalKey: "设置：所选密钥没有可替换的本地凭据。", partialAdd: "设置：本地凭据已保留为 {reference}，但注册失败；请使用 arks key add {provider} --env {variable} 恢复。", partialReplace: "设置：本地凭据已替换，但密钥健康状态重置失败；重试前请检查状态文件。", partialRemove: "设置：引用已取消，但本地凭据仍保留；检查凭据文件后请删除孤立凭据。", noLocalInstance: "设置：SearXNG 没有本地配置；环境端点由外部管理。请先明确添加本地实例。", noProvider: "设置：Provider 没有本地配置；请先明确添加密钥。", invalidOrder: "设置：自动 Provider 顺序不能为空或包含重复条目。", unknownProvider: "设置：自动顺序中有未知 Provider。", invalidIdentity: "设置：SearXNG 实例标识无效。", staleInstance: "设置：所选实例已不在配置中；请刷新设置。", invalidEndpoint: "设置：SearXNG 端点或实例 CIDR 配置无效。", duplicateInstance: "SearXNG 实例已配置；权限未更改。", removeLastOrder: "设置：删除最后一个 SearXNG 实例前，请先修改自动 Provider 顺序。", invalidSearxng: "设置：SearXNG URL 无效。", keyedOnly: "设置：SearXNG 无需密钥。", managedOnly: "设置：此处仅管理 Exa、Tavily、Firecrawl 和 SearXNG。", invalidLanguage: "设置：语言必须为 en 或 zh。",
};
export function setupMessage(language: SetupLanguage, key: Message, values: Record<string, string | number> = {}): string {
  return (language === "zh" ? zh[key] : en[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}
export function initialSetupLanguage(explicit: SetupLanguage | undefined, saved: SetupLanguage | undefined, environment: NodeJS.ProcessEnv): SetupLanguage {
  return explicit ?? saved ?? (/^zh/i.test(environment.LC_ALL || environment.LC_MESSAGES || environment.LANG || "") ? "zh" : "en");
}
export function setupAffirmative(answer: string): boolean { return /^(y|yes|是|确认)$/i.test(answer.trim()); }

// Exact allowlist: never echo arbitrary error messages, even ones with a Setup: prefix.
const errorKeys: Message[] = ["weknoraPartialSave", "weknoraPartialRemove", "weknoraShared", "readFiles", "readCredentials", "owned", "staleKey", "invalidSecret", "environmentRef", "sharedRef", "noLocalKey", "partialReplace", "partialRemove", "noLocalInstance", "noProvider", "invalidOrder", "unknownProvider", "invalidIdentity", "staleInstance", "invalidEndpoint", "duplicateInstance", "removeLastOrder", "invalidSearxng", "keyedOnly", "managedOnly", "invalidLanguage"];
export function setupSafeError(language: SetupLanguage, message: string): string | undefined {
  const key = errorKeys.find(key => message === en[key] || message === `Setup: ${en[key]}`);
  if (key) return setupMessage(language, key);
  const partial = /^Setup: Local credential remains stored as (env:([A-Z][A-Z0-9_]*)), but registration failed; recover with arks key add (exa|tavily|firecrawl) --env \2\.$/.exec(message);
  if (partial) return setupMessage(language, "partialAdd", { reference: partial[1]!, variable: partial[2]!, provider: partial[3]! });
  return undefined;
}
