# 07 — 本地直连抓取与抽取降级链（W8）

Status: completed
Type: task

Source: 可借鉴项 W8（D1–D2）— [调研笔记](../../../docs/research/pi-web-access-borrowable-patterns.md)
Depends: 无
Blocks: 06-local-fetch-ssrf-boundary.md

## Context

用户已同意新增本地直连 HTTP 抓取路径和引入新依赖，但现有 `web.fetch` 是 Provider API 批量调用，`WebFetchInput` 只有 `onlyMainContent`/`maxCharacters`。需要先做最小真实消费者和可验证的路由契约，再决定是否引入 readability/turndown/linkedom 等依赖。

参考模式是 `readable`/`raw`/`answer` 的显式模式与本地抽取优先、远程 provider 后备。ArkSpace 首批只考虑不把页面自动发送给模型的模式；`answer` 必须另行 opt-in 和成本/隐私决策。

## Scope

- 定义本地 HTTP fetch provider 的能力边界、请求/响应契约、超时/取消、大小上限、内容类型和正文口径。
- 为 `web.fetch` 增加最小显式模式（至少区分 raw 与 readable，或给出有证据的更小设计）；保持 Protocol v1 版本兼容策略，并同步 `docs/capabilities.md`、Skill reference 和 JSON schema。
- 定义本地路径的 HTTP(S) 安全门接口与路由，并先用注入传输验证 raw/抽取契约；**在 W6 安全门完成前，不得从任何入口启用真实本地直连 HTTP 请求**。W6 验收后再开启最小纵向切片：安全门 → 响应上限/内容类型校验 → raw 或本地 readable 抽取；Provider API 仍可按配置顺序 fallback。
- 仅在真实失败样本证明需要时引入正文抽取依赖；记录依赖版本、许可证、导入面和跨平台验证。优先标准库/已有依赖，不复制上游代码。
- 为显式 provider 选择、auto 路由、失败分类、部分结果、取消和入口隔离增加契约测试；本地路径不应泄漏私密 URL、请求头或响应原文到错误。

## Out of scope

- 不实现 `answer` 模式、模型调用、Pi 宿主耦合、浏览器 cookie 或 Curator UI。
- 不实现 GitHub 克隆、PDF/视频/帧抽取、responseId 持久化检索或有界并发；这些分别属于其他 T2 工单。
- 不把第三方远程抽取器默认插入本地路径；任何远程托管抽取必须显式 opt-in。
- 不在 W8 内假设 W6 的 SSRF 已解决；本地路径必须阻塞到安全门契约完成。

## Acceptance criteria

- [ ] 有一个可在隔离测试中启动/注入的本地 HTTP provider，契约明确声明支持的模式和限制。
- [ ] raw/readable 的输入、输出、空正文、非文本 content-type、编码和 maxCharacters 语义均有 schema/测试证据。
- [ ] W6 验收前，本地直连在 CLI、MCP、`arks invoke` 均不可访问；启用后所有本地请求先经过安全门。默认路由不扩大现有远程 provider 的安全声明。
- [ ] `provider` 显式选择不会悄悄改成另一路径；`auto` 的优先级、失败分类和 fallbackOn 有表驱动测试。
- [ ] 取消/超时不会遗留未报告的本地工作；结果遵循既有 Protocol envelope 和 attempt evidence。
- [ ] 不引入未经证明需要的新重依赖；如引入，写清版本、许可证、消费者和跨平台检查。
- [ ] `npm run check`、真实 `arks invoke web.fetch` 入口测试及适用的 `npm run test:hosts` 证据通过。

## Verification

先用注入 fetcher/loopback server 固化 HTTP 契约，再评估最小抽取依赖。若标准库 raw 路径已经满足真实消费者，应先交付 raw，延后 readable；不要为“以后可能需要”提前引入解析器。
