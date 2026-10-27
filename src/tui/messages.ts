/**
 * Bilingual message table (replaces inline t("en","zh") call sites; plan §2).
 * Every returned string passes the ADR 0024 width-safety assertion.
 */
import { assertWidthSafe } from "./port.js";

export type TuiLang = "en" | "zh";

// key -> [zh, en]
const TABLE: Record<string, readonly [string, string]> = {
  menuTitle: ["功能", "Menu"],
  pageProviders: ["Providers", "Providers"],
  pageConfig: ["路由顺序", "Order"],
  pageSettings: ["语言设置", "Settings"],
  pageDiagnostics: ["诊断", "Diagnostics"],
  pageExit: ["退出", "Exit"],
  ready: ["就绪", "ready"],
  loading: ["读取配置中...", "loading config..."],
  dataError: ["读取配置失败，按 ? 查看帮助", "failed to read config"],
  exitConfirm: ["退出 ArkSpace Setup？（默认取消）", "Exit ArkSpace Setup? (cancel default)"],
  cancelDefault: ["取消（默认）", "Cancel (default)"],
  confirm: ["确认", "Confirm"],

  // columns
  colKey: ["密钥参考", "key"],
  colStatus: ["状态", "status"],
  colOrder: ["路由位", "order"],
  colOwner: ["归属", "owners"],
  colSource: ["来源", "source"],
  colUrl: ["URL", "URL"],
  colCidr: ["授权网段", "cidr"],

  // statuses / sources
  stEnabled: ["启用", "enabled"],
  stDisabled: ["停用", "disabled"],
  stCooldown: ["冷却", "cooldown"],
  stExhausted: ["耗尽", "exhausted"],
  stUnavailable: ["不可用", "unavailable"],
  stNotProbed: ["已配置（未探测）", "configured (not probed)"],
  srcLocal: ["本地", "local"],
  srcEnvironment: ["环境只读", "env read-only"],
  srcMissing: ["缺失", "missing"],
  externalEnv: ["外部(env)配置", "external env config"],
  autoPosition: ["自动 #{n}", "auto #{n}"],
  explicitOnly: ["仅显式", "explicit only"],
  owned: ["{n} 项资源", "{n} owned"],
  current: ["当前", "current"],

  // failure reasons
  reasonAuth: ["认证失败", "auth"], reasonPermission: ["权限不足", "permission"],
  reasonRateLimit: ["限流", "rate-limit"], reasonQuota: ["配额耗尽", "quota"],
  reasonTransient: ["瞬时错误", "transient"], reasonNetwork: ["网络错误", "network"],
  reasonInvalidRequest: ["请求无效", "invalid-request"], reasonInvalidResponse: ["响应无效", "invalid-response"],
  reasonConfig: ["配置错误", "config"], reasonUnknown: ["未知原因", "unknown"],
  reasonOperatorDisabled: ["手动停用", "operator-disabled"],

  // pages
  noKeys: ["暂无密钥", "no keys"],
  noInstances: ["暂无实例", "no instances"],
  searxngNote: ["SearXNG 免密钥 / CIDR 授权随 P3 测试流开放", "SearXNG keyless / CIDR consent lands with P3"],
  orderNote: ["只读展示 / 草稿/保存在 P2", "read-only / draft/save in P2"],
  connNote: ["连接服务配置在 P4 接线", "connection pages land in P4"],
  diagNote: ["本次会话诊断（内存态，不持久化）", "session diagnostics (memory only)"],
  diagEmpty: ["暂无诊断记录 / 测试流在 P3", "no diagnostics yet / test flow lands in P3"],
  pendingP2: ["管理动作（增删改/启停）在 P2 接线", "mutations (add/edit/remove/toggle) land in P2"],
  pendingP3: ["测试流在 P3 接线", "test flow lands in P3"],

  // details / preview
  detailsTitle: ["详情", "Details"],
  refreshNote: ["详情取自最近一次快照 / 实时刷新随 P3 开放", "details from latest snapshot / live refresh in P3"],
  previewTitle: ["密钥预览", "Key preview"],
  maskedNote: ["默认掩码 / r 显示原文 / 离开即清除", "masked by default / r reveals / cleared on exit"],
  chars: ["{n} 字符", "{n} characters"],
  srcLocalValue: ["本地已保存", "local stored"],
  srcEnvValue: ["生效环境值", "effective environment"],
  srcEnvOver: ["生效环境值（覆盖本地）", "effective environment (overrides local)"],
  previewMissing: ["无法预览：所选密钥缺失", "preview unavailable: selected key is missing"],
  previewInvalidEnv: ["无法预览：环境密钥无效", "preview unavailable: invalid environment credential"],
  previewChanged: ["无法预览：所选引用已更改", "preview unavailable: selected reference changed"],
  previewKeyless: ["SearXNG 免密钥，无内容可预览", "SearXNG is keyless; nothing to preview"],
  fieldSource: ["来源", "source"], fieldStatus: ["状态", "status"], fieldReason: ["原因", "reason"],
  fieldCooldownLeft: ["冷却剩余", "cooldown left"], fieldOwners: ["归属", "ownership"],
  fieldShared: ["共享", "shared"], fieldRouting: ["路由", "routing"], fieldAvailable: ["可用性", "availability"],
  secondsLeft: ["{n}s", "{n}s"],

  // P2 mutations
  noRows: ["请先选择一行", "select a row first"],
  connPending: ["连接服务在 P4 接线", "connection pages land in P4"],
  searxngPending: ["SearXNG 实例管理在 P3 接线", "SearXNG instance management lands in P3"],
  envGuarded: ["环境密钥只读：请在来源侧变更", "environment key is read-only: change it at its source"],
  emptySecret: ["未输入密钥值，保存为空操作", "no secret entered; save is a no-op"],
  formTitleAdd: ["添加密钥", "Add key"],
  formTitleEdit: ["编辑密钥", "Edit key"],
  fieldSecretHint: ["Enter 提交草稿/Ctrl-S 保存/Esc 回退/取消", "Enter commits draft/Ctrl-S saves/Esc reverts/cancels"],
  fieldSecretTyping: ["输入中（掩码）/ Enter 提交", "typing (masked)/Enter commits"],
  fieldSecretLabel: ["密钥值", "secret"],
  overwriteConfirm: ["覆盖 {ref}？（默认取消）", "Overwrite {ref}? (cancel default)"],
  discardFormConfirm: ["放弃已输入的密钥？（默认取消）", "Discard typed secret? (cancel default)"],
  discardOrderConfirm: ["放弃未保存的顺序？（默认取消）", "Discard unsaved order? (cancel default)"],
  removeConfirm: ["移除 {ref}？（默认取消）", "Remove {ref}? (cancel default)"],
  includeChoose: ["纳入路由（保存前仍会确认）", "Include in routing (save still confirms)"],
  allIncluded: ["全部 Provider 已在顺序内", "all providers already in order"],
  orderNoop: ["顺序无更改/保存为空操作", "order unchanged/save is a no-op"],
  orderConsent: ["新纳入 {names} 会将其公开标识符写入路由，确认保存？", "Adding {names} writes their public identifiers into routing. Save?"],
  draftUpdated: ["草稿已更新/Ctrl-S 保存", "draft updated/Ctrl-S saves"],
  draftDiscarded: ["已放弃草稿", "draft discarded"],
  opAdded: ["密钥已添加：{ref}", "key added: {ref}"],
  opReplaced: ["密钥已替换：{ref}", "key replaced: {ref}"],
  opRemoved: ["已移除 {ref}/该密钥诊断作废", "{ref} removed/its diagnostics invalidated"],
  opKeyOn: ["{ref} 已启用", "{ref} enabled"],
  opKeyOff: ["{ref} 已停用", "{ref} disabled"],
  opProviderOn: ["{name} 已启用", "{name} enabled"],
  opProviderOff: ["{name} 已停用", "{name} disabled"],
  opOrderSaved: ["路由顺序已保存", "routing order saved"],
  opLangSaved: ["界面语言已保存", "interface language saved"],
  opFailed: ["操作失败：{reason}", "operation failed: {reason}"],
  formBusy: ["保存中...", "saving..."],

  // key bar labels
  keyFocus: ["焦点区", "focus"], keyQuit: ["退出", "quit"], keyPick: ["选择", "pick"],
  keyBack: ["返回", "back"], keyMove: ["移动", "move"], keyOpen: ["打开", "open"],
  keyAnyBack: ["任意键返回", "any key back"], keyReveal: ["显隐", "reveal"],
  keyDetails: ["详情", "details"], keyPreview: ["预览", "preview"],
  keyContext: ["切上下文", "context"], keyHelp: ["帮助", "help"],
  keyAdd: ["添加", "add"], keyEdit: ["编辑", "edit"], keyRemove: ["移除", "remove"],
  keyToggle: ["启停", "toggle"], keyTest: ["测试", "test"], keyEnable: ["启停Provider", "enable"],
  keyQuickPick: ["快选", "quick"], keyCommit: ["提交/编辑", "commit/edit"],
  keySave: ["保存", "save"], keySaveStar: ["保存*", "SAVE*"], keyDrop: ["移出", "drop"],
  keyInclude: ["纳入", "include"], keyMoveRow: ["调序", "move"],
  unsaved: ["未保存", "unsaved"], unchanged: ["未更改", "unchanged"],
};

export function msg(lang: TuiLang, key: keyof typeof TABLE | string, vars?: Record<string, string | number>): string {
  const pair = TABLE[key];
  if (!pair) throw new Error(`Unknown TUI message key: ${key}`);
  let text = lang === "zh" ? pair[0] : pair[1];
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  assertWidthSafe(text, `messages.${key}`);
  return text;
}

/** Test hook: iterate every table entry through the width assertion. */
export function messageKeys(): string[] { return Object.keys(TABLE); }
