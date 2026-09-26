# 06 — 本地直连抓取的 SSRF 信任边界

Status: completed
Type: task

Source: 可借鉴项 W6（A1–A3）— [调研笔记](../../../docs/research/pi-web-access-borrowable-patterns.md)
Depends: 07-local-fetch-extraction-fallback.md（仅入口契约；不等待本地直连启用）

## Context

ArkSpace 当前 `web.fetch`/`web.crawl` 只调用 Exa、Tavily、Firecrawl；没有本地任意 URL 直连路径。因此 SSRF 防护不能先抽成无消费者的通用层。本工单只在 W8 先定义本地 HTTP provider 与路由契约后，给该入口加安全边界。

上游固定修订中的模式包括：hostname DNS A/AAAA 全量预检、保留/私有地址阻断、手动重定向逐跳校验、显式 `allowRanges` 与代理信任语义。上游自身未消除 DNS 预检与连接之间的 TOCTOU/rebinding 窗口；ArkSpace 不得把预检描述成完整防护。

## Scope

- 为本地 HTTP 抓取定义并实现 HTTP(S) URL 的 SSRF 校验：地址族归一化、IPv4-mapped IPv6、未指定/loopback/link-local/私有/共享地址/保留地址，以及 DNS 返回的全部 A/AAAA。
- 禁止自动跟随重定向；每个 Location 逐跳执行同一校验，限制重定向次数、响应头大小、响应体大小和总截止时间。
- 在配置中定义严格的 `allowRanges` 与 `trustEnvProxy` 语义；非法 CIDR fail-loudly。默认拒绝私网/保留段。
- 明确代理环境、`NO_PROXY`、DNS rebinding 限制，并由 `arks doctor` 暴露生效的豁免范围/警告。
- 对本地 provider 返回分类错误和安全证据；不绕过既有 Protocol envelope。

## Out of scope

- 不给远程 Exa/Tavily/Firecrawl 请求添加假 SSRF 证明。
- 不把 DNS 预检描述为连接级 pinning；如需解决 rebinding，另开设计/实现工单。
- 不默认信任代理、不默认允许私网、不读取浏览器 cookie、不支持任意命令。

## Acceptance criteria

- [ ] 本地 HTTP provider 所有用户 URL 在连接前经过校验；DNS 多地址中任一禁止地址都会拒绝。
- [ ] 重定向关闭自动跟随，并逐跳重新校验；超出上限以稳定错误返回。
- [ ] 默认配置不允许 loopback、link-local、私网、共享地址、未指定地址和保留地址；IPv4-mapped IPv6 有测试。
- [ ] `allowRanges`/`trustEnvProxy` 的配置、`NO_PROXY` 和 doctor 输出有契约测试；非法配置不静默降级。
- [ ] 超时、取消、响应大小和内容类型边界不会泄漏响应正文或凭据。
- [ ] DNS 预检 TOCTOU/rebinding 限制在文档和错误/doctor 输出中明确，不宣称已消除。
- [ ] `npm run check`、适用的入口测试和跨平台行为证据通过。

## Verification

先由 W8 的本地入口契约确定 provider 是否真的接收任意 URL，再运行 loopback、私网/保留地址、双栈、多重定向、代理环境和超限响应测试。不得把仅 hostname 的测试当作完成证据。
