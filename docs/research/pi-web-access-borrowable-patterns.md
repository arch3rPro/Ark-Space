# pi-web-access 可借鉴能力调研

调研日期：2026-09-25

## 范围与来源

本笔记只研究上游 `nicobailon/pi-web-access`（MIT，TypeScript，Pi coding-agent 扩展，npm 包 `pi-web-access`，版本 0.31.0[^pkg]）在固定修订 [`610a52033f1e9705c0023ff9e0fac399319310a3`](https://github.com/nicobailon/pi-web-access/commit/610a52033f1e9705c0023ff9e0fac399319310a3)（main，2026-09-23）下可被 ArkSpace 借鉴的**事实性能力与模式**。目标不是实现方案，也不是路线图排序。

上游文件检查清单（均位于该固定修订）：

- GitHub 克隆/API：`github-extract.ts`、`github-api.ts`、`github-issue-pr.ts`
- 网络安全边界：`ssrf-protection.ts`、`extract.ts`、`fetch-params.ts`、`utils.ts`（代理）
- 大结果存储/检索：`storage.ts`、`content-find.ts`、`index.ts`（`get_search_content`、工具名、内联上限）
- 并发/取消：`extract.ts`（`fetchAllContent`、`pLimit`）、`abortable.ts`、`promise-try.d.ts`
- 证据工件：`source-check.ts`
- 零配置/凭据复用：`exa.ts`、`openai-search.ts`、`kimi-search.ts`、`duckduckgo.ts`、`credential-source.ts`、`gemini-adc.ts`、`chrome-cookies.ts`、`auth-fetch.ts`、`gemini-web-config.ts`
- 内容抽取：`extract.ts`、`rsc-extract.ts`、`jina-search.ts`、`pdf-extract.ts`、`datalab-pdf-extract.ts`、`gemini-pdf-extract.ts`、`youtube-extract.ts`、`video-extract.ts`、`crawl4ai.ts`、`firecrawl.ts`、`data-uri-sanitize.ts`、`declared-web-links.ts`
- 路由/错误分类：`gemini-search.ts`、`render-search-error.ts`、`page-query.ts`
- 工具激活/注册：`tool-activation.ts`、`index.ts`
- 配置/脱敏：`utils.ts`、`credential-source.ts`、`feature-config.ts`
- Curator/摘要：`curator-page.ts`、`curator-run.ts`、`curator-server.ts`、`summary-model-scope.ts`、`summary-review.ts`
- 测试/打包/证据：`test/`（重点 `provider-precedence`、`search-routing`、`ssrf-protection`、`get-search-content`、`content-find`、`github-extract`、`tool-activation`）、`evidence/CONTRACT-EVIDENCE.md`、`evidence/contract-probe.mjs`、`scripts/build.js`、`scripts/publish.js`、`package.json`、`LICENSE`、`SECURITY.md`、`README.md`

ArkSpace 侧边界依据：`AGENTS.md`、`docs/architecture.md`、`docs/capabilities.md`、`package.json`、`src/providers/contracts.ts`、`src/capabilities/provider-execution.ts`、`src/capabilities/web-fetch.ts`、`src/config/schema.ts`、`src/config/credentials.ts`、`src/protocol/types.ts`、`src/io/json-store.ts`、`skills/web/references/`。

[^pkg]: package.json 固定修订版本，见 [参考来源](#参考来源)。

---

## 可借鉴能力

### 主题 A：网络信任边界与 SSRF

#### A1. 目标 URL 的 DNS 预检 + 私网/保留段阻断 + 手动重定向循环

- **能力**：在发起抓取前解析主机名并对**每一个** A/AAAA 地址做公网校验；重定向逐跳重新校验，而不是交给 `fetch` 自动跟随。
- **上游证据**：`validateRemoteUrl` 对 hostname 做 `dnsLookup(hostname, { all: true, verbatim: true })`，并对全部地址调用 `assertPublicAddress`（[ssrf-protection.ts#L183-L225](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L183-L225)）。`assertPublicAddress` 覆盖 IPv4 的 `0/8`、`10/8`、`127/8`、`100.64/10`、`169.254/16`、`172.16/12`、`192.168/16`、`198.18/15`、`>=224`，以及 IPv6 的未指定、loopback、ULA `fc00::/7`、link-local `fe80::/10`、IPv4-mapped（[ssrf-protection.ts#L345-L410](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L345-L410)）。`fetchRemoteUrl` 用 `redirect: "manual"`、最多 5 跳、对每一跳重新验证；且 loopback 豁免只对显式配置的原始 origin 生效，重定向目标永不继承（[ssrf-protection.ts#L6-L9](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L6-L9)、[#L227-L280](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L227-L280)）。
- **对 ArkSpace 的意义**：ArkSpace 目前所有网络抓取都经 Provider API，本地没有对任意用户 URL 的直接 HTTP 抓取路径；但 `web.fetch`/`web.crawl`/`web.map` 仍接收任意 URL，且 `arks` 未来若加入本地 HTTP provider 或浏览器抓取，就新增了 SSRF 面。这套"先验证、再逐跳验证"的规则是可复用的信任边界实现。ArkSpace 现仅有对 webhook/monitor URL 的 hostname 级检查（[`src/protocol/resource-schema.ts#L31`](../../src/protocol/resource-schema.ts)、[`src/protocol/site-monitor-schema.ts#L11`](../../src/protocol/site-monitor-schema.ts)），没有 DNS 预检、没有 CIDR 层，也没有逐跳重定向校验。
- **潜在落点**：新增本地抓取 provider 时，落在 `src/providers/`（provider adapter，见 [`src/providers/contracts.ts`](../../src/providers/contracts.ts)）或 `src/protocol/` 的 URL schema 校验；配置项落在 [`src/config/schema.ts`](../../src/config/schema.ts)。
- **成本/风险**：CIDR 解析、IPv6/IPv4-mapped 归一化、DNS 重绑定（TOCTOU）都是易错点；上游只在 Node 内用 `dns.lookup` 预检，并未把解析结果 pin 到连接，理论上仍存在 DNS rebinding 窗口（上游代码未声称解决，**未验证**是否有缓解）。`198.18/15` 与 TUN/fake-IP 代理的交互说明这类严格策略会误伤常见代理环境。

#### A2. 可配置的 `allowRanges` 与 `trustEnvProxy` 逃生阀

- **能力**：用显式 CIDR 白名单豁免保留段（给 TUN/fake-IP 代理），或用 `trustEnvProxy` 在存在 `HTTP(S)_PROXY`/`ALL_PROXY` 时跳过本地 DNS 预检；两者都严格校验、`allowRanges` 非法值直接抛错。
- **上游证据**：`SsrfConfig = { allowRanges, trustEnvProxy }`，非法条目抛出而非静默忽略（[ssrf-protection.ts#L112-L160](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L112-L160)）；`shouldTrustEnvProxy` 识别 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`、尊重 `NO_PROXY`，且 `NO_PROXY` 主机仍做本地校验（[ssrf-protection.ts#L334-L343](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L334-L343)）；README 说明 `trustEnvProxy` 只调整 DNS 预检、不是代理传输配置（[README.md#L112-L124](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L112-L124)）。
- **对 ArkSpace 的意义**：ArkSpace 明确要求"校验不可信边界"并"支持跨平台"（[`AGENTS.md`](../../AGENTS.md)）。任何 SSRF 防线若没有受审计的逃生阀，会在企业代理/容器环境中直接不可用。`trustEnvProxy` 的"失败即关闭、非法配置即报错"与 ArkSpace 的 fail-loudly 配置风格一致。
- **潜在落点**：[`src/config/schema.ts`](../../src/config/schema.ts)（新增 `ssrf` 段，`.strict()` + 显式校验），实现落在 `src/providers/` 的 HTTP 层或 `src/protocol/`。
- **成本/风险**：白名单本身削弱防护；若 ArkSpace 采纳，需要在 `arks doctor` 中暴露当前生效的豁免范围，否则用户无法判断是否被放开。

#### A3. Hostname 级抓取域名策略（allow/deny）

- **能力**：独立的 `fetchContent.domainPolicy.allow/deny`，allow 非空时变成白名单；在 SSRF 之前先按 hostname 匹配（含子域）。
- **上游证据**：`loadFetchContentDomainPolicy` 解析并校验条目（[ssrf-protection.ts#L67-L110](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L67-L110)）；`assertDomainPolicy` 先 deny 后 allow（[ssrf-protection.ts#L282-L292](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L282-L292)）。
- **对 ArkSpace 的意义**：ArkSpace 的 skill/host 场景常有"只允许抓取某厂商文档域"的需求；把域名策略与 IP 层 SSRF 分开，可由 capability 层在派发前完成，无需改 provider adapter。
- **潜在落点**：`src/capabilities/web-fetch.ts` / `src/capabilities/web-crawl.ts` 的请求解析，配置落 [`src/config/schema.ts`](../../src/config/schema.ts)。
- **成本/风险**：allow 列表语义（是否含子域、是否需 trailing-dot 归一化）必须与协议 schema 明确；上游代码里 `domainMatches` 用 `hostname === entry || endsWith("." + entry)`（[ssrf-protection.ts#L294-L296](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L294-L296)），这是一个可测试的精确语义。

### 主题 B：大结果存储与按需检索（responseId）

#### B1. `responseId` + 会话外缓存 + 分页/查找的检索工具

- **能力**：搜索/抓取返回一个 `responseId`，完整内容不塞进单次工具结果，而是按需 `offset`/`limit` 分页，或用 `findText` 就地定位。抓取全文写入私有缓存目录（非会话 JSONL），一小时 TTL、128 条 / 128 MiB，LRU 淘汰；目录/文件权限 `0700`/`0600`。
- **上游证据**：`generateId()` 生成 id（[storage.ts#L72-L74](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/storage.ts#L72-L74)）；缓存常量（[storage.ts#L9-L16](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/storage.ts#L9-L16)）；`get_search_content` 工具注册、`offset`/`limit`/`findText`/`findMode` 参数（[index.ts#L2888-L2930](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L2888-L2930)）；README 描述缓存生命周期、权限与 `findText` 行为（[README.md#L227-L240](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L227-L240)）。
- **对 ArkSpace 的意义**：ArkSpace 的 `web.fetch` 结果字段是每 URL 一段 `content`（[`src/protocol/types.ts`](../../src/protocol/types.ts)），`maxCharacters` 有上限但**没有会话级检索工具**。上游的"结果信封只放指针、全文按需拉取"可减少协议输出膨胀，并为长文提供确定性分页。
- **潜在落点**：协议/结果字段在 `src/protocol/types.ts` 与 `src/protocol/*-schema.ts`；分页/查找逻辑可自成 `src/capabilities/` 的独立能力（如 `web.content.get`）或放在 `src/state/`（本地缓存）；若只是 Skill 指令层的用法，则落 `skills/web/references/`。
- **成本/风险**：ArkSpace 目前没有长驻 daemon，`arks invoke` 是单次进程（[`docs/architecture.md`](../architecture.md)），进程内 `Map` 缓存无法跨调用存活；要复用该模式必须先有持久化检索能力与状态清理语义。这会引入新的状态所有权和并发问题，属于架构级成本。

#### B2. 内联内容上限与"先内联、再后台补全"的两段式

- **能力**：`maxInlineContentChars` 同时是默认值和硬上限（最小值 1000、上限 200000、默认 30000）；超限内容转后台抓取，结果里只提示 responseId 和下一页用法。
- **上游证据**：`getMaxInlineContentChars` 钳制到 `[1000, 200000]`，默认 `30_000`（[index.ts#L628-L640](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L628-L640)）；引导文案示例 `Use get_search_content({ responseId, urlIndex: 0, offset, limit })`（[index.ts#L1446-L1458](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L1446-L1458)）。
- **对 ArkSpace 的意义**：ArkSpace 已有 `maxCharacters`（[`src/protocol/types.ts`](../../src/protocol/types.ts)），但没有"默认值=最大值+钳制"的单一配置源，也没有超限时的续取指引。这个模式让"结果体积"成为一个可测、可解释的契约。
- **潜在落点**：[`src/protocol/types.ts`](../../src/protocol/types.ts) 与 [`src/config/schema.ts`](../../src/config/schema.ts)；续取指引应写在 `src/capabilities/` 的 warnings/correction 或 `skills/web/references/fetch.md`。
- **成本/风险**：分页续取必须有稳定切片语义（按字符还是按行？上游 `initialContentSlice` 会在 `\n` 处回退，[index.ts#L647-L665](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L647-L665)）；否则会出现丢字/重字。ArkSpace 的 `maxCharacters` 目前是 Provider 参数，语义可能与此不同，需要单独确认。

#### B3. 三态查找（exact / case-insensitive / fuzzy）+ 有界摘录预算

- **能力**：`findContent` 支持三种模式；fuzzy 用词元编辑距离（长度 ≥9 容错 2、≥5 容错 1），并要求段落内命中比例 ≥60%；输出硬上限 20000 字符，超限时按查询分配代表性摘录，并明确报告"未返回的代表性摘录"。
- **上游证据**：`CONTEXT_CHARS = 400`、`MAX_OUTPUT_CHARS = 20_000`（[content-find.ts#L3-L4](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/content-find.ts#L3-L4)）；`editDistanceWithin` 与阈值（[content-find.ts#L16-L38](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/content-find.ts#L16-L38)、[#L50-L77](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/content-find.ts#L50-L77)）；`findContent` 的预算式格式化（[content-find.ts#L121-L254](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/content-find.ts#L121-L254)）。
- **对 ArkSpace 的意义**：ArkSpace 的 `research` skill 明确要"带引用的合成"（[`docs/capabilities.md`](../capabilities.md)）。一个有界、可解释的查找器能让 Skill 在不把整页塞进上下文的情况下定位证据；"超限时报告缺失摘录"比静默截断更符合 ArkSpace 对"部分输出单独建模"的要求（[`AGENTS.md`](../../AGENTS.md)）。
- **潜在落点**：纯函数、无网络依赖，最适合放 `src/capabilities/` 内的辅助模块，或作为 `research` 能力的内部工具；若做成独立能力则需协议 schema。
- **成本/风险**：fuzzy 算法对中文等非空格语言不友好（词元正则基于 `\p{L}\p{N}`，但段落拆分按 `\n`，[content-find.ts#L54-L67](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/content-find.ts#L54-L67)）；ArkSpace 需要中文分词时这是限制，**未验证**上游对 CJK 的命中质量。

### 主题 C：并发、取消与截止时间

#### C1. 有界并发（`p-limit`）+ 按批隔离

- **能力**：抓取/搜索都限制并发为 3；每条独立批次限制，从而多个工具调用仍可并行。
- **上游证据**：`CONCURRENT_LIMIT = 3` 与 `const fetchLimit = pLimit(CONCURRENT_LIMIT)`（[extract.ts#L33](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L33)、[#L308](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L308)）；`fetchAllContent` 用 `Promise.all(urls.map(url => fetchLimit(...)))`（[extract.ts#L1451-L1458](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L1451-L1458)）；搜索侧同值，注释明确"每批独立以便不同 Pi 工具调用并行"（[index.ts#L256-L260](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L256-L260)）。
- **对 ArkSpace 的意义**：ArkSpace 的 `provider-execution.ts` 是**串行**尝试 provider/key（[`src/capabilities/provider-execution.ts`](../../src/capabilities/provider-execution.ts)），capability 内部多 URL 是 Provider 一次批量请求。上游的"单次调用内多 URL 并发、调用之间不共享并发额度"是一个可测的性能/限流模式。
- **潜在落点**：`src/capabilities/web-fetch.ts` / `web-crawl.ts` / `research.ts`（若未来支持多 URL 并发 adapter 调用）；并发配置落 [`src/config/schema.ts`](../../src/config/schema.ts) 的 `execution` 段。
- **成本/风险**：并发会改变 key-pool 的配额竞争与 provider 限流行为；ArkSpace 的 key-pool 是事务性选/记录（[`src/key-pool/key-pool.ts`](../../src/key-pool/key-pool.ts)），并发前必须确认不会重复选择同一 key。ArkSpace 已明确"只在有真实消费者时引入扩展点"，故这是实现级而非接口级借鉴。

#### C2. 可取消等待不可取消的工作（`awaitWithAbort`）+ 独立清理截止时间

- **能力**：`awaitWithAbort` 用 `Promise.race` 观察 `AbortSignal`，即使被等待的 Promise 本身不可取消也能立即返回；感知 abort 的克隆/子进程额外做整棵进程树终止与 grace，防子进程读到宿主 TTY。
- **上游证据**：`abortable.ts` 全文（[abortable.ts#L1-L17](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/abortable.ts#L1-L17)）；`execClone` 的 `detached` 子进程、`terminateProcessTree`、超时/abort 双触发（[github-extract.ts#L500-L586](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L500-L586)）。
- **对 ArkSpace 的意义**：ArkSpace 已把"超时、取消、部分输出、重试、回退"列为**独立结果**（[`AGENTS.md`](../../AGENTS.md)、[`docs/architecture.md`](../architecture.md)），并在 `provider-execution.ts` 用 `AbortSignal.any([timeout, signal])`。上游补充的是：当某个 Provider 调用无法真正取消时，仍要保证调用方按时返回，并让清理成为独立、可报告的结果。
- **潜在落点**：`src/capabilities/provider-execution.ts`（取消/清理证据字段已在 [`src/providers/contracts.ts`](../../src/providers/contracts.ts) 与 protocol `attempts` 中体现）；若接入本地子进程工具，落 `src/providers/`。
- **成本/风险**：`awaitWithAbort` 依赖 `promise.try` 类型声明（[promise-try.d.ts#L1-L7](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/promise-try.d.ts#L1-L7)），ArkSpace 无该依赖；这只是类型声明，核心是 `Promise.race` 模式。风险是"已放弃等待但底层仍在跑"造成的资源/计费泄漏，必须和清理证据一起建模。

### 主题 D：内容抽取流水线

#### D1. 抓取模式（readable / raw / answer）与单一本地 HTTP 入口

- **能力**：`mode` 三选一：`readable` 走完整抽取链；`raw` 只走直连 HTTP 且要求文本 content-type；`answer` 用模型基于页面内容回答。无论哪种模式，**入口都先做 SSRF 校验**。
- **上游证据**：`FetchMode` 定义与描述（[index.ts#L256-L270](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L256-L270)）；`extractContent` 先 `validateRemoteUrl`，再分流 `auth`/`raw` 到直连 HTTP（[extract.ts#L507-L540](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L507-L540)）；`raw` 模式拒绝非文本 content-type（[extract.ts#L1230-L1240](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L1230-L1240)）。
- **对 ArkSpace 的意义**：ArkSpace 的 `web.fetch` 输入只有 `onlyMainContent`/`maxCharacters`（[`src/protocol/types.ts`](../../src/protocol/types.ts)），没有"原始字节 vs 可读正文 vs 基于内容作答"的区分。上游证明这是一个**可放进协议**的正交维度，且"raw 也必须过安全门"是重要约束。
- **潜在落点**：[`src/protocol/types.ts`](../../src/protocol/types.ts)（扩展 `WebFetchInput`）+ [`src/providers/contracts.ts`](../../src/providers/contracts.ts)（各 adapter 声明支持哪些 mode）；Skill 说明落 [`skills/web/references/fetch.md`](../../skills/web/references/fetch.md)。
- **成本/风险**：不同 Provider 对 raw/answer 支持不一（Exa/Tavily/Firecrawl 各有语义），协议层加 mode 会让 provider 能力矩阵变复杂，需要 `docs/capabilities.md` 的 Provider 覆盖表同步。answer 模式还会把页面内容发给模型，涉及隐私/成本，必须显式 opt-in（上游 README 也强调这点，[README.md#L223](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L223)）。

#### D2. 分层降级：Readability → RSC flight → Jina Reader → 自托管/远程抽取

- **能力**：本地优先用 `linkedom` + `@mozilla/readability`；失败则解析 Next.js RSC flight 数据；仍不足则按有序 provider 列表继续（Jina Reader 无需 key，Firecrawl/Crawl4AI 自托管优先）；第三方托管抽取默认关闭，需 `fetchRouting.allowRemoteHostedProviders` 显式开启。
- **上游证据**：抽取器依赖 `defuddle/node`、`linkedom`（[extract.ts#L83-L84](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L83-L84)）；默认抓取顺序与"远程托管需 opt-in"（[extract.ts#L71-L75](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L71-L75)、[#L210-L260](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L210-L260)）；Jina Reader URL 拼接（[extract.ts#L355-L365](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L355-L365)）；RSC 解析器（[rsc-extract.ts#L13](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/rsc-extract.ts#L13)）；README 完整降级说明（[README.md#L354](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L354)）。
- **对 ArkSpace 的意义**：ArkSpace 把抽取完全交给 Provider（Exa/Tavily/Firecrawl），没有本地正文解析。上游说明：本地可先做零成本正文抽取，"是否需要付费/远程 Provider"可以成为一个可配置的降级维度。更重要的是其安全立场：**远程托管抽取器默认关闭**，因为它会看到与本地安全门不同的重定向链。
- **潜在落点**：本地抽取适合 `src/providers/`（新增一个本地 `http`/`readability` adapter，实现 `WebFetchProvider`）或 `skills/<name>/scripts/`（确定性、自包含，符合 [`AGENTS.md`](../../AGENTS.md) 对 skill-local script 的定位）；路由顺序落 [`src/capabilities/web-fetch.ts`](../../src/capabilities/web-fetch.ts) 与 [`src/config/schema.ts`](../../src/config/schema.ts) 的 `fallbackOn`/`providerOrder`。
- **成本/风险**：引入 `linkedom`/readability/turndown/defuddle 等依赖会扩大 ArkSpace 的依赖面与打包体积（ArkSpace 目前依赖仅 `@modelcontextprotocol/server`、`ajv`、`commander`、`zod`，[`package.json`](../../package.json)）。这些是纯 JS 依赖，跨平台风险低，但与 ArkSpace "最小依赖、按需扩展"的取向冲突。

#### D3. PDF 多引擎链（Datalab → Gemini → 本地 unpdf）与显式 pin

- **能力**：`pdf.provider: "auto"|"gemini"|"datalab"|"unpdf"`；auto 先 Datalab（有 key 时）、再 Gemini（有 key 时）、最后本地 `unpdf`；显式 pin 跳过其他远程层，但远程引擎失败仍回退本地 unpdf（凭证/配置错误和调用方取消除外）。
- **上游证据**：`PDFProvider` 类型与优先级（[pdf-extract.ts#L44-L59](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/pdf-extract.ts#L44-L59)）；`loadPDFConfig` 校验（[pdf-extract.ts#L70-L140](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/pdf-extract.ts#L70-L140)）；README 明确链与 pin 语义（[README.md#L296-L308](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L296-L308)）。
- **对 ArkSpace 的意义**：ArkSpace 的 `WebFetchInput` 不区分 PDF；PDF 会走 Provider 的通用抓取。上游展示了"按内容类型选择多引擎 + 本地确定性兜底 + 显式 pin"的组合，且把"远程失败回退本地、但配置/凭证错误和取消不回退"讲清楚。这与 ArkSpace 把失败分类建模的取向一致。
- **潜在落点**：`src/capabilities/web-fetch.ts` 的内容类型分流 + `src/providers/`；配置落 [`src/config/schema.ts`](../../src/config/schema.ts)。本地 `unpdf` 属技术选型而非边界。
- **成本/风险**：`unpdf`/PDF.js 是较重依赖且需跨平台验证；上游的 Datalab/Gemini 是额外付费凭证，对 ArkSpace 意味着新的 provider/key 维度。

#### D4. YouTube/本地视频与帧抽取

- **能力**：YouTube 走 Gemini Web（浏览器 cookie 可选）→ Gemini API → Perplexity 的链；本地视频用 ffmpeg 分析；可按 timestamp/range 抽取帧（YouTube 还需 `yt-dlp`）。缺二进制时仍可做转录/视觉描述。
- **上游证据**：`extractContent` 中的视频/帧分支（[extract.ts#L553-L694](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/extract.ts#L553-L694)）；README 说明可选依赖与降级（[README.md#L270-L296](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L270-L296)）。
- **对 ArkSpace 的意义**：ArkSpace 初始切片聚焦文本 web 数据，视频是明确的范围外能力。这里可借鉴的是**可选系统二进制 + 缺省降级**的声明方式（ArkSpace 的 `AGENTS.md` 要求 Skill 声明系统包与网络依赖）。
- **潜在落点**：更适合未来 Skill 的 `compatibility` 与 skill-local script，而非 `src/` capability；若要做，落 `skills/<name>/scripts/`。
- **成本/风险**：ffmpeg/yt-dlp 是重量级系统依赖，且 bilibili 等中文平台未覆盖；**未验证** ArkSpace 目标用户是否需要。

### 主题 E：GitHub 克隆与 API 回退

#### E1. 克隆优先、API 回退、按仓库大小设阈值

- **能力**：`githubClone.enabled`、`maxRepoSizeMB`（默认 350）、`cloneTimeoutSeconds`（默认 30）、`clonePath`（默认 `/tmp/pi-github-repos`）；超过阈值不克隆，改用 `gh api` 的 tree/readme/file 视图并提示可用 `forceClone: true`；完整 SHA 的 URL 直接走 API。
- **上游证据**：配置默认值与解析（[github-extract.ts#L64-L138](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L64-L138)）；主流程的大小检查与 API 回退（[github-extract.ts#L906-L1000](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L906-L1000)）；`gh` vs `git` 的 `--depth 1 --single-branch`（[github-extract.ts#L589-L615](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L589-L615)）；API 视图上限（tree 200 条、文件 100K 字符、README 8K）（[github-api.ts#L4-L7](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-api.ts#L4-L7)）。
- **对 ArkSpace 的意义**：ArkSpace 没有 GitHub 专用能力；`web.fetch` 对 GitHub URL 会走通用 Provider。上游把"大仓库不克隆、小仓库浅克隆、失败退 API"做成三级策略，并给用户一个显式 `forceClone`。这是一个可独立成能力的垂直切片（对应 ArkSpace 的"小型真实垂直切片"原则）。
- **潜在落点**：作为 `src/capabilities/` 的新能力（例如 `web.repo`）或某个 Skill 的 skill-local script；凭证复用 `gh` CLI 的状态落 `src/providers/` 或 Skill 声明。若只是 GitHub URL 特化，也可放在 `skills/web/references/` 指导下用现有 `web.fetch` + 本地工具。
- **成本/风险**：克隆会在用户磁盘写数据、可能持有私有仓库访问权，属于 ArkSpace 明确定义的"material side effect / 需要显式所有权与清理"范畴（[`AGENTS.md`](../../AGENTS.md)）。上游用 owner 文件 + PID/boot-id 判断陈旧克隆并清理（[github-extract.ts#L31-L35](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L31-L35)、[#L262-L470](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L262-L470)），这是很重的工程成本；ArkSpace 若采纳必须把清理作为独立证据。

#### E2. PR/Issue 结构化渲染（`gh` 优先、REST 有界回退）

- **能力**：识别 PR/issue URL 后优先 `gh pr/issue view`（字段级重试以兼容旧 gh），失败用无认证 REST 有界回退（受同一域名策略与 SSRF 约束，且 REST 无 checks）；正文/评论/审查/检查/文件/提交各设内联上限；`#issuecomment-`、`#discussion_r` 锚点强制内联。
- **上游证据**：字段集与内联上限常量（[github-issue-pr.ts#L8-L37](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-issue-pr.ts#L8-L37)）；URL 解析（[github-issue-pr.ts#L119-L151](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-issue-pr.ts#L119-L151)）；限流提示要求 `gh auth login`（[github-issue-pr.ts#L280-L287](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-issue-pr.ts#L280-L287)）；README 描述（[README.md#L266-L268](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L266-L268)）。
- **对 ArkSpace 的意义**：这是"已知站点特化渲染"的范例：同一 URL 既可能是普通 HTML，也可能是结构化知识源。ArkSpace 的 `web.fetch` 目前没有 URL 形态特化。这段逻辑几乎肯定属于 skill-local 或独立能力，而非 provider 适配器。
- **潜在落点**：`skills/<name>/scripts/`（确定性、自包含、依赖 `gh` 外部工具），或 `src/capabilities/` 新能力；`gh` 可用性检测可参考上游 `checkGhAvailable` 缓存（[github-api.ts#L11-L25](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-api.ts#L11-L25)）。
- **成本/风险**：在 Agent 环境中调用 `gh` 意味着访问宿主凭证与可能触发认证提示；上游用 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=Never`、`GH_PROMPT_DISABLED=1` 禁止交互（[github-extract.ts#L553-L561](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L553-L561)），这符合 ArkSpace"最小子进程环境"精神但 ArkSpace 仍需自己建模。

### 主题 F：证据工件（source-check）

#### F1. 机器可读引用工件：source/passage/claim + content hash + 偏移

- **能力**：`source_check` 产出 `ResearchArtifact`：`sources[]`（含 `quality` 分类、fetch 状态、content hash）、`passages[]`（`passage_id`、`source_url`、`extraction_span {start,end}`、content hash）、`claims[]`（`supported/contradicted/unclear/missing-evidence` + supporting/contradicting passage ids + 置信度）。关键：**不做自动语义判定**——有证据则 `unclear`、无证据则 `missing-evidence`，交给人工复核。
- **上游证据**：类型定义（[source-check.ts#L1-L45](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/source-check.ts#L1-L45)）；来源质量正则分类（[source-check.ts#L47-L93](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/source-check.ts#L47-L93)）；passage 抽取与 SHA-256（[source-check.ts#L96-L160](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/source-check.ts#L96-L160)）；`assessClaim` 的保守默认（[source-check.ts#L162-L172](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/source-check.ts#L162-L172)）；README 对其语义的说明（[README.md#L242-L256](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L242-L256)）。
- **对 ArkSpace 的意义**：ArkSpace 的 `research` skill 要求"带引用的合成"，协议结果已有 `attempts`/`warnings`，但没有可复用的**引用数据结构**（passage id + 字节偏移 + 内容哈希）。这套结构让"引用可定位、可校验、可 diff"，且明确区分"检索到证据"与"语义支持"。
- **潜在落点**：协议层 `src/protocol/types.ts` + `src/protocol/*-schema.ts`；产出逻辑可放 `src/capabilities/research.ts` 或独立 `web.sourcecheck` 能力。
- **成本/风险**：`extraction_span` 必须与最终返回给用户的文本切片一致，否则引用会漂移。上游对 passage 抽取是启发式句子拆分（≤400 字符的句子，[source-check.ts#L104-L126](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/source-check.ts#L104-L126)），对 CJK 断句质量**未验证**。ArkSpace 若做这一步需要明确定义字符偏移的文本口径（原始 HTML？纯文本？Markdown？）。

### 主题 G：零配置 / 凭据复用路径

#### G1. 统一凭据源解析：显式值 / `$ENV` / `!command` / 环境回退，且带分类错误与脱敏

- **能力**：配置值可以是明文、`$VAR`、`${VAR}`、`$$escaped`、`!command`（执行命令取 stdout）。命令运行有 5 秒超时、16 KiB 输出上限、受控环境变量白名单、控制字符拒绝；错误按 `invalid-source`/`command-failed`/`command-timeout`/`command-aborted`/`command-empty`/`command-invalid-output`/`command-output-too-large`/`environment-empty`/`oauth-credential-rejected` 分类；`redactCredential` 在任意文本中替换凭证。
- **上游证据**：常量与错误类型（[credential-source.ts#L1-L45](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/credential-source.ts#L1-L45)）；`COMMAND_ENVIRONMENT_NAMES` 白名单（[credential-source.ts#L9-L25](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/credential-source.ts#L9-L25)）；`hasCredentialSource`/`resolveCredential`（[credential-source.ts#L145-L192](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/credential-source.ts#L145-L192)）；`redactCredential`（[#L80-L82](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/credential-source.ts#L80-L82)）。
- **对 ArkSpace 的意义**：ArkSpace 已有环境变量引用与本地 `credentials.json`（[`src/config/schema.ts`](../../src/config/schema.ts) 只接受 `env:` 前缀；[`src/config/credentials.ts`](../../src/config/credentials.ts) 存明文值但**已明确**"state 只存 key 元数据、不存原始 key"，见 [`docs/architecture.md`](../architecture.md)）。上游的 `!command` 与 `$VAR` 语法、命令输出上限、受控环境、错误分类是可借鉴的**边界校验细节**，尤其"命令输出过大/含控制字符即拒绝"。
- **潜在落点**：`src/config/credentials.ts` / 新增 `src/credentials/`；若 ArkSpace 要支持外部密钥管理器，这里就是 ADR 0009 提到的演进点。
- **成本/风险**：`!command` 允许配置执行任意命令，是**高风险**面。上游用环境白名单和超时缓解，但 ArkSpace 的信任模型更保守（"环境变更需用户同意、官方可验证来源"）。若采纳，需要独立 ADR 与显式 opt-in，不能默认开启。

#### G2. 复用 Pi 宿主已有模型凭证（零 key 可用性探测）

- **能力**：当宿主已登录某个模型 provider 时，扩展直接通过宿主的 model registry 取 key/headers，无需用户再配 key。OpenAI 搜索要求官方 Responses 端点（`api.openai.com` 或官方 Codex）才复用，遇到自定义 `baseUrl` 默认**拒绝**并 fail-closed；Kimi 按 provider 列表复用；Gemini 支持 ADC。
- **上游证据**：`resolvePiAuth` 遍历 provider、取 `getApiKeyAndHeaders`、对自定义 baseUrl 抛 `CustomOpenAIBaseUrlError`（[openai-search.ts#L242-L296](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/openai-search.ts#L242-L296)）；`isOpenAISearchAvailable` 同样 fail-closed（[openai-search.ts#L328-L345](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/openai-search.ts#L328-L345)）；Kimi provider 复用（[kimi-search.ts#L11-L70](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/kimi-search.ts#L11-L70)）；README 明确 OpenAI URL 复用的条款（[README.md#L52-L66](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L52-L66)）。
- **对 ArkSpace 的意义**：ArkSpace 的 credential 解析是"只从环境/本地存储取 key"（[`src/config/credentials.ts`](../../src/config/credentials.ts)），没有宿主 credential 复用概念（`arks` 是独立 CLI，宿主不可见）。但"凭证与 endpoint 绑定、不要跨 endpoint 复用"这条**安全不变式**直接适用于 ArkSpace 的 key-pool 与 baseUrl：一个 key 不应被拼到另一个 baseUrl 上。
- **潜在落点**：`src/capabilities/provider-execution.ts`（已按 providerConfig.baseUrl 调用）与 [`src/config/schema.ts`](../../src/config/schema.ts)；这是校验/断言层，不需要新能力。
- **成本/风险**：宿主 credential 复用是 Pi 特有机制（依赖 `@earendil-works/pi-coding-agent` 的 `modelRegistry`），**不可移植**到 ArkSpace 的独立 CLI；只借鉴其 fail-closed 校验规则。

#### G3. ADC（Application Default Credentials）OAuth 流程与优先级

- **能力**：支持读取 `~/.config/gcloud/application_default_credentials.json`（或 `GOOGLE_APPLICATION_CREDENTIALS`），区分 `authorized_user`（refresh_token）与 `service_account`（JWT 签名）两种凭据并换取 access token；仅在 `geminiAuth: "adc"` 且**没有**显式 Gemini key、且**没有**显式 baseUrl 时才启用（显式配置优先）；token 有内存过期缓存；OAuth 失败单独分类为 `oauth-credential-rejected`。
- **上游证据**：ADC 路径（[gemini-adc.ts#L9-L10](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-adc.ts#L9-L10)）；两种凭据类型分派（[gemini-adc.ts#L254-L268](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-adc.ts#L254-L268)）；`isGeminiAdcAvailable` 的优先级（[gemini-adc.ts#L270-L294](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-adc.ts#L270-L294)）；错误分类（[gemini-adc.ts#L179-L192](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-adc.ts#L179-L192)）。
- **对 ArkSpace 的意义**：ArkSpace 的 provider 都是静态 API key；ADC 是"无长期 key、用环境已有云身份"的另一条凭据路径。其**优先级规则**（显式 key > 显式 baseUrl > ADC）与**只在显式选择时才尝试**的保守设计，直接符合 ArkSpace 的 credential source 解析与 fail-loudly 取向。
- **潜在落点**：`src/credentials/` 或 `src/config/credentials.ts`（新增 credential source 类型）；provider 侧在 `src/providers/`。ArkSpace 的 architecture 已把"credential source resolution"列为稳定扩展点（[`docs/architecture.md`](../architecture.md)）。
- **成本/风险**：需要处理 token 刷新、时钟偏差、服务账号 JWT 签名等；ArkSpace 若只支持静态 key，则这是明确的范围外依赖。

#### G4. Keyless 兜底 provider（DuckDuckGo HTML）

- **能力**：DuckDuckGo HTML 端点作为**始终可用**（`isDuckDuckGoAvailable(): boolean { return true; }`）的无 key 搜索，带 UA 与超时，解析 `uddg` 重定向参数取真实 URL。
- **上游证据**：`isDuckDuckGoAvailable` 与 `searchWithDuckDuckGo`（[duckduckgo.ts#L47-L70](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/duckduckgo.ts#L47-L70)）；`decodeResultUrl` 解析 `uddg`（[duckduckgo.ts#L32-L45](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/duckduckgo.ts#L32-L45)）。
- **对 ArkSpace 的意义**：ArkSpace 的可用性完全依赖用户配置 Exa/Tavily/Firecrawl key。一个无 key 的兜底搜索 provider 能显著降低首次使用门槛，并为资源受限/无 key 环境提供降级。代价是依赖第三方 HTML 抓取，稳定性与合规性需评估。
- **潜在落点**：`src/providers/`（实现 `WebSearchProvider`）+ `src/capabilities/web-search.ts` 的 provider 列表；provider 注册见 [`src/providers/registry.ts`](../../src/providers/registry.ts)。
- **成本/风险**：HTML 抓取无 SLA、易失效、且可能是 ToS 灰区；ArkSpace 的 provider 适配器本来假设有正式 API key。若采纳，需要明确标注"非官方、尽力而为"。

#### G5. 浏览器 cookie 提取与认证抓取（opt-in、同源、仅本地直连）

- **能力**：`allowBrowserCookies: true`/`PI_ALLOW_BROWSER_COOKIES=1` 显式开启后，从 Chromium 系浏览器的 cookie 库（macOS keychain / Linux secret-tool / Windows DPAPI）解密 Google 等域 cookie；`authFetch` profile 限定 hosts 与子域、要求 HTTPS、拒绝跨源重定向、且**绝不把 cookie/认证内容发给托管抽取 provider**。跨平台浏览器路径与 keychain service 名列表完整。
- **上游证据**：cookie 提取入口与平台配置（[chrome-cookies.ts#L62-L80](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/chrome-cookies.ts#L62-L80)、[#L97-L115](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/chrome-cookies.ts#L97-L115)）；opt-in 开关（[gemini-web-config.ts#L75-L101](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-web-config.ts#L75-L101)）；认证抓取的 host 限制与重定向守卫（[auth-fetch.ts#L39-L66](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/auth-fetch.ts#L39-L66)）；README 的 opt-in 与安全声明（[README.md#L331-L335](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L331-L335)）。
- **对 ArkSpace 的意义**：ArkSpace 的 `browser` 能力是**远程** Firecrawl 会话，不接触本地浏览器；`authFetch` 式的本地认证抓取与 ArkSpace 的浏览器所有权/确认模型（[`docs/architecture.md`](../architecture.md)）方向不同。可借鉴的只是"host 白名单 + 强制 HTTPS + 拒绝跨源重定向 + 不把凭证外送"的守卫规则。
- **潜在落点**：若 ArkSpace 未来支持本地认证抓取，落 `src/providers/` 并要求显式确认；cookie 解密本身不建议进 `src/`。
- **成本/风险**：读取/解密用户浏览器 cookie 是高度敏感操作，涉及平台差异、keychain 权限弹窗、浏览器版本老化；上游实现约 670 行且仍在演进。**明确不建议**进入 ArkSpace 默认路径（见下节）。

### 主题 H：路由与失败分类

#### H1. 按错误类别选择是否回退（`fallbackOn`）+ 显式 provider 严格失败

- **能力**：`searchRouting: { providers: [...], fallbackOn: ["transient","quota","network","invalid-response","unsupported"], useCurrentModel }`。错误被 `classifyProviderError` 归入 `credential/aborted/unsupported/quota/auth/invalid-request/transient/invalid-response/network/config/unknown`；只有 `fallbackOn` 列出的类别才继续下一个 provider，否则**抛错不回退**。显式指定单一 provider 永远严格。单个 provider 数组则并发全部执行并合并。
- **上游证据**：`SearchRoutingConfig` 与 `SearchProviderErrorKind`（[gemini-search.ts#L54-L73](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-search.ts#L54-L73)）；分类器（[gemini-search.ts#L329-L363](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-search.ts#L329-L363)）；有序路由循环（[gemini-search.ts#L589-L612](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-search.ts#L589-L612)）；`search` 入口的 auto/数组/严格分支（[gemini-search.ts#L614-L632](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-search.ts#L614-L632)）；测试覆盖按类别 fail-closed（[test/search-routing.test.mjs#L31-L230](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/test/search-routing.test.mjs#L31-L230)）。
- **对 ArkSpace 的意义**：ArkSpace 已有 `fallbackOn`（[`src/config/schema.ts`](../../src/config/schema.ts)）与 `FAILURE_KINDS`、以及 `executeWithProviders` 的"仅在 `fallbackOn` 包含该 kind 时才换 provider"（[`src/capabilities/provider-execution.ts`](../../src/capabilities/provider-execution.ts)）。上游补充的是**错误分类器的完整性和测试化**：把 HTTP 状态、错误文本、provider 特例（如 xAI 403 配额、Tavily 432、OpenAI 400/422 unsupported tool）映射为类别，并逐条写测试。ArkSpace 的分类在 [`src/errors/provider-error.ts`](../../src/errors/provider-error.ts)，可对照补齐。
- **潜在落点**：`src/errors/provider-error.ts` + `src/capabilities/provider-execution.ts`；测试落 `tests/`。
- **成本/风险**：错误文本启发式会随 Provider 文案变化而失效；必须像上游一样用表驱动测试固定行为，否则回退策略会静默漂移。

#### H2. 优先级：显式选择 > 旧版单 provider 配置 > `searchRouting` > auto 链
- **能力**：`provider` 缺省或 `auto` 时用配置的 provider；`provider` 为数组或 `all` 时并发执行；配置了顶层 `provider` 时它**优先于** `searchRouting`；只有未显式配置 provider 且存在 `searchRouting` 时才走有序路由；否则走内建的 auto 回退链。
- **上游证据**：`search` 入口的分支顺序（[gemini-search.ts#L614-L632](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-search.ts#L614-L632)）；测试 `legacy single-provider config takes precedence over searchRouting`（[test/search-routing.test.mjs#L217-L248](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/test/search-routing.test.mjs#L217-L248)）与 `explicit named provider overrides configured provider`（[test/provider-precedence.test.mjs#L96-L120](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/test/provider-precedence.test.mjs#L96-L120)）。
- **对 ArkSpace 的意义**：ArkSpace 已有 `provider`（显式）与 `providerOrder`（配置顺序）（[`src/capabilities/web-fetch.ts`](../../src/capabilities/web-fetch.ts)）。上游把这条优先级**写成表驱动测试**，值得对照：确保 `input.provider` 严格只执行该 provider、`providerOrder` 与 `fallbackOn` 交互可预测。
- **潜在落点**：`tests/`（契约/真实入口测试）；实现已在 `src/capabilities/provider-execution.ts`。
- **成本/风险**：优先级规则一旦被测试固定，后续加入新配置项时要同步避免歧义；这是测试成本而非实现成本。

#### H3. 错误/取消渲染与主结果渲染分离（可单测的纯函数 plan）

- **能力**：把错误/取消的展示**计划**（纯字符串，无 theme/ANSI）抽成 `buildSearchErrorPlan`，UI 层只负责着色与组件；诊断块报告 cancel 原因、浏览器连接状态、心跳年龄、已完成/出错查询数、取消前已获得的逐查询结果，并在折叠态给出展开提示。
- **上游证据**：模块头注释明确说明动机（[render-search-error.ts#L1-L24](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/render-search-error.ts#L1-L24)）；`SearchErrorPlan` 结构与构建逻辑（[render-search-error.ts#L47-L170](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/render-search-error.ts#L47-L170)）。
- **对 ArkSpace 的意义**：这是“把可测试的呈现逻辑与宿主 UI 解耦”的通用模式。ArkSpace 的 `arks` 只输出机器 JSON，没有 TUI，但同样的思路适用于 **stderr 诊断/进度**与 **stdout 结果**的分离（[`AGENTS.md`](../../AGENTS.md)、[`docs/architecture.md`](../architecture.md)）：诊断计划可被单测，UI/日志适配层只做格式化。
- **潜在落点**：`src/errors/` 或 `src/cli/` 的 stderr 诊断格式化；协议 warning/correction 已是机器可读（[`src/protocol/types.ts`](../../src/protocol/types.ts)）。
- **成本/风险**：上游这段**强依赖 Pi TUI 的展开交互**（`app.tools.expand`），其具体交互不可移植；只有“纯 plan + 薄适配层”是可移植的。

### 主题 I：工具激活 / 注册

#### I1. 可配置工具名 + 逐工具启用/禁用 + 延迟激活

- **能力**：`toolNames` 可重命名四个工具（默认 `web_search`/`source_check`/`fetch_content`/`get_search_content`），名称必须匹配 `^[A-Za-z][A-Za-z0-9_-]{0,63}$`；`tools.<key>.enabled` 可逐工具关闭；重工具可通过一个 `web_enable` loader 与 `setActiveTools` 在会话内延迟激活，并记录到 transcript 以便会话树重建时恢复；Pi 版本过低时优雅退化为“始终可用”并打印一次警告。
- **上游证据**：默认工具名与校验（[index.ts#L239-L255](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L239-L255)）；逐工具启用判断（[index.ts#L295-L299](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/index.ts#L295-L299)）；`tool-activation.ts` 全文（[tool-activation.ts#L1-L134](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/tool-activation.ts#L1-L134)）；测试（[test/tool-activation.test.mjs](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/test/tool-activation.test.mjs)）。
- **对 ArkSpace 的意义**：ArkSpace 的 MCP stdio 工具名是固定的能力名（[`src/mcp/server.ts`](../../src/mcp/server.ts)），且尚未有“按用户配置重命名/禁用”或“延迟激活”。上游证明：当能力众多时，把重能力做成按需激活可显著减少上下文占用。ArkSpace 的能力数量目前很少，**这项是为了未来扩展做的模式储备**，符合“只在有真实消费者时引入”的约束（[`AGENTS.md`](../../AGENTS.md)）。
- **潜在落点**：`src/mcp/server.ts`（MCP 工具注册/名称映射）与 `src/cli/main.ts`（`arks` 子命令启用/禁用）；配置落 [`src/config/schema.ts`](../../src/config/schema.ts)。
- **成本/风险**：延迟激活与 transcript 重建是**宿主特有**机制，在 `arks`/MCP 中语义不同（MCP 客户端自行决定加载哪些工具）；直接照搬会把宿主耦合带进来。逐工具启/禁用是低风险、可移植的部分。

### 主题 J：配置、代理与脱敏

#### J1. 多候选配置目录探测 + 环境变量优先

- **能力**：配置目录解析顺序：`PI_CODING_AGENT_DIR` > `XDG_CONFIG_HOME/pi`（若其中存在旧文件则用 `~/.pi`）> `~/.pi/agent` > `~/.pi`；配置文件名 `web-search.json`。
- **上游证据**：`getWebSearchConfigDir`/`getWebSearchConfigPath`（[utils.ts#L11-L37](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/utils.ts#L11-L37)）；测试 `test/config-path.test.mjs`。
- **对 ArkSpace 的意义**：ArkSpace 已有自己的配置/状态路径（[`src/config/paths.ts`](../../src/config/paths.ts)）。可借鉴的是**向后兼容的探测顺序 + 环境变量最高优先级**，以及为旧路径保留迁移分支。
- **潜在落点**：`src/config/paths.ts`。
- **成本/风险**：多候选路径会增加“用户改了哪个文件”的困惑；必须由 `arks doctor` 明确指出当前生效路径。

#### J2. 代理：Node fetch 经 curl 转发 + 代理 URL 脱敏 + `NO_PROXY` 解析

- **能力**：因 Node fetch 忽略 `HTTP(S)_PROXY` 且 undici `ProxyAgent` 对部分 HTTP 代理 TLS 失败，改为包装 `globalThis.fetch`，在代理激活时调用本地 `curl` 转发（临时目录、逐跳手动重定向、最多 20 跳）；代理 URL 的用户名/密码在错误信息中替换为 `redacted`；`NO_PROXY` 支持 `*`、通配、IPv6 方括号与端口。
- **上游证据**：`normalizeProxyUrl`/`redactProxyUrl`（[utils.ts#L221-L252](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/utils.ts#L221-L252)）；`installGlobalProxyFetch` 与 `fetchViaCurl`（[utils.ts#L324-L510](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/utils.ts#L324-L510)）；`hostnameMatchesNoProxy`（[ssrf-protection.ts#L294-L332](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/ssrf-protection.ts#L294-L332)）；README 的代理解释（[README.md#L337-L352](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L337-L352)）。
- **对 ArkSpace 的意义**：ArkSpace 的 Provider 调用直接 `fetch`，没有代理支持；在受限企业网络中会失败。上游的“代理 URL 脱敏”与 `NO_PROXY` 精确解析是可借鉴的安全细节。
- **潜在落点**：`src/config/schema.ts`（proxy 配置）+ `src/providers/http.ts`（传输层）；代理 URL 脱敏应进入 [`src/errors/provider-error.ts`](../../src/errors/provider-error.ts) 与 `AGENTS.md` 的“错误脱敏”要求。
- **成本/风险**：依赖本地 `curl` 可执行文件、临时目录写盘、以及代理激活的全局状态；在 ArkSpace 的 `arks invoke` 单进程模型下全局 fetch 包装可行，但需处理并发与清理。**未验证** ArkSpace 目标环境是否允许 `curl`。

### 主题 K：测试、证据与打包

#### K1. 表驱动 provider 契约证据（先探测、再固化）

- **能力**：仓库为某个 Provider（SERPdive）保留了真实 API 探测记录 `evidence/CONTRACT-EVIDENCE.md`，逐条列请求/响应/边界（`max_results` 是上限不是下限、缺失 query、无效 key、无 key、中途 abort）并配一个 `evidence/contract-probe.mjs` 探测脚本。
- **上游证据**：`evidence/CONTRACT-EVIDENCE.md` 目录结构（[evidence/CONTRACT-EVIDENCE.md#L1-L9](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/evidence/CONTRACT-EVIDENCE.md#L1-L9)），例如 `max_results` 语义（[#L224-L229](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/evidence/CONTRACT-EVIDENCE.md#L224-L229)）与 abort 行为（[#L482-L496](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/evidence/CONTRACT-EVIDENCE.md#L482-L496)）；探测脚本 `evidence/contract-probe.mjs`。
- **对 ArkSpace 的意义**：ArkSpace 已有高度成熟的 provider API 证据笔记约定（[`docs/research/`](.) 下的 `*-api-evidence.md`，如 [`research-provider-api-evidence.md`](research-provider-api-evidence.md)、[`weknora-api-evidence.md`](weknora-api-evidence.md)），并把探测结果落成 `tests/`。上游的贡献是**把证据与可执行探测脚本放在同一目录**，让证据可复现。
- **潜在落点**：`docs/research/` 约定 + `scripts/` 或 `tests/` 的探测夹具；ArkSpace 已规定“不得记录不存在的校验命令”（[`AGENTS.md`](../../AGENTS.md)）。
- **成本/风险**：真实 API 探测会产生调用成本并可能触碰配额；必须像上游一样只针对明确需要的 Provider。

#### K2. 测试形态：把入口当扩展加载、注入假 `fetch`、子进程隔离配置

- **能力**：测试不 mock 模块，而是把 `index.ts` 作为扩展 import，提供最小 `pi` 桩（`registerTool`、`on`、`appendEntry`…），覆盖 `globalThis.fetch` 返回构造的 Response，通过 `PI_CODING_AGENT_DIR` 指向临时目录并提供/清理环境变量，从 stdout 读取调用记录做断言。
- **上游证据**：provider-precedence 测试的完整加载方式（[test/provider-precedence.test.mjs#L1-L90](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/test/provider-precedence.test.mjs#L1-L90)）；用 `node --test` 运行（[package.json](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/package.json)）。
- **对 ArkSpace 的意义**：ArkSpace 已要求“通过契约、真实入口、隔离 Skill 和相关跨平台测试验证”（[`AGENTS.md`](../../AGENTS.md)），并使用 Vitest 与真实 `arks invoke`（[`package.json`](../../package.json)）。上游的“不 mock 内部模块、只桩边界”与“子进程隔离配置防状态污染”值得对照测试设计。
- **潜在落点**：`tests/`。
- **成本/风险**：子进程测试较慢；ArkSpace 已有 `test:e2e-providers` 等分层命令，可沿用分层而非全量替换。

#### K3. 打包：externals 从 package.json 派生 + 发布包装器恢复 manifest

- **能力**：esbuild 打包 `index.ts`，把 `dependencies`、`peerDependencies` 与宿主 `@earendil-works/*` 全部标记 external（从 package.json 派生，未来依赖自动 external）；`npm run release` 使用包装器在 publish 前后恢复 `pi.extensions`，避免中断导致 manifest 停留在 `./dist`（因为 `postpublish` 在失败/中断时不会执行）。
- **上游证据**：`scripts/build.js` 全文（[scripts/build.js#L1-L32](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/scripts/build.js#L1-L32)）；`scripts/publish.js` 的恢复逻辑（[scripts/publish.js#L1-L49](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/scripts/publish.js#L1-L49)）；`package.json` 的 `prepublishOnly`/`postpublish`。
- **对 ArkSpace 的意义**：ArkSpace 明确要求“只构建 Node/TypeScript CLI、插件直接加载 canonical sources、版本仅在显式 release 时变更”（[`AGENTS.md`](../../AGENTS.md)、[`docs/architecture.md`](../architecture.md)）。上游的**发布失败恢复**（SIGINT/SIGTERM 下仍恢复 manifest）是 ArkSpace 可以借鉴的发布卫生模式。
- **潜在落点**：`scripts/`（[`package.json`](../../package.json) 的 `verify:release`）。
- **成本/风险**：上游做法隐含“发布时临时改写 manifest”，与 ArkSpace 的 no-mirror 原则有张力；只借鉴其信号处理/恢复的健壮性，不照搬 manifest 改写。

### 主题 L：Curator UI（描述 + 耦合评估）

#### L1. 本地 HTTP + 浏览器页面的人工审核/摘要草稿

- **能力**：`/curator` 打开一个本地 HTTP 服务托管的单页 UI，展示多查询结果、允许选择、编辑/批准自动生成的摘要草稿，然后把选择回传 `onSubmit`；服务有会话 token、`bind` 地址解析、stale watchdog（30 秒阈值、1 秒轮询）、请求体上限 64 KiB、超时后自动提交；摘要模型按可配置的 Pi 模型优先级选择，慢时回退到确定性摘要。
- **上游证据**：`curator-server.ts` 的常量、`CuratorServerOptions`、`startCuratorServer`（[curator-server.ts#L1-L45](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/curator-server.ts#L1-L45)、[#L193-L200](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/curator-server.ts#L193-L200)、[#L690](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/curator-server.ts#L690)）；session token 校验（[curator-server.ts#L270](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/curator-server.ts#L270)、[#L361-L378](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/curator-server.ts#L361-L378)）；`curator-page.ts` 是内联 HTML 生成器（[curator-page.ts#L1-L40](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/curator-page.ts#L1-L40)）；摘要模型选择（[summary-model-scope.ts#L1-L125](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/summary-model-scope.ts#L1-L125)）。
- **对 ArkSpace 的意义**：Curator 本质是“在无头 Agent 流程中插入一个人工确认/审核步骤”。ArkSpace 的 `research` 结果是带引用工件，理论上也需要“人复核”。但**上游 Curator 与 Pi 扩展生命周期强耦合**：它由 Pi 的 `registerCommand`/`registerShortcut` 触发、依赖 `ctx.ui.notify`、`ctx.sessionManager`、brain 状态机，并由 `curator-run.ts` 作为会话内运行态承载。
- **潜在落点**：若要复用，最合适的是 Skill-local 形态——一个 `skills/<name>/scripts/` 下的本地服务 + 浏览器页面，由 Skill 指令引导用户打开并确认；而非 `src/` capability。ArkSpace 的 `browser` 能力目前是远程 Firecrawl，不覆盖本地 UI。
- **成本/风险**：内联 HTML UI 约 3600 行、需处理服务绑定/端口/token/stale/超时/浏览器打开失败，是**大工程且偏宿主耦合**；ArkSpace 无 TUI，也尚未有需要人工审核的消费方。**明确不建议**现在借鉴，理由见下节。

---

## 明确不建议借鉴

| 项 | 上游证据 | 不借鉴理由 |
| --- | --- | --- |
| 在 `web-search.json` 中明文存放 API key | README 配置示例（[README.md#L31-L46](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/README.md#L31-L46)） | 与 ArkSpace 的 credential 边界直接冲突：架构只允许 state 存 key 元数据，原始 key 走环境变量或专用 `credentials.json`，且“state 不含原始 key”（[`docs/architecture.md`](../architecture.md)、[`src/config/schema.ts`](../../src/config/schema.ts) 仅接受 `env:` 引用）。 |
| 浏览器 cookie 提取/解密（Chromium keychain/DPAPI/secret-tool） | `chrome-cookies.ts`（[#L62-L115](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/chrome-cookies.ts#L62-L115)） | 读取用户浏览器会话凭据是高敏感、跨平台易碎、且与 ArkSpace 的“浏览器操作需显式所有权/确认/可验证清理”模型无关。ArkSpace 的 `browser` 是远程 Firecrawl 会话，不接触本地浏览器。仅卫生规则（host 白名单/HTTPS/拒绝跨源重定向）可借鉴。 |
| Curator 本地浏览器 UI | `curator-page.ts`、`curator-server.ts`、`curator-run.ts` | 强依赖 Pi 扩展生命周期（命令/快捷键/session/brain 状态），且要求 ArkSpace 引入本地 HTTP 服务与人机确认层；ArkSpace 尚无需要人工审核的消费方，违反“只在有真实消费者时引入扩展点”。 |
| `web_enable` 动态工具激活 | `tool-activation.ts`（[#L22-L90](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/tool-activation.ts#L22-L90)） | 依赖 Pi `getAllTools`/`getActiveTools`/`setActiveTools` 及 transcript 模块；`arks`/MCP 客户端自行决定工具加载，“延迟激活”语义不成立。只有逐工具 enabled 配置可移植。 |
| `render-search-error.ts` 的展开诊断交互 | [render-search-error.ts#L1-L24](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/render-search-error.ts#L1-L24) | 内容与 Pi TUI 的展开键绑定；ArkSpace 输出机器 JSON，无 TUI。可借鉴的只是“纯 plan + 薄适配层”的解耦方式。 |
| 宿主模型凭证自动复用（Pi `modelRegistry`） | [openai-search.ts#L242-L296](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/openai-search.ts#L242-L296)、[kimi-search.ts#L46-L70](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/kimi-search.ts#L46-L70) | 依赖 Pi 宿主内部 API，ArkSpace 的 `arks` 是独立 CLI，无宿主 registry。只借鉴“凭证与 endpoint 绑定、自定义 baseUrl 默认拒绝”的 fail-closed 规则。 |
| `!command` 凭据源在默认路径启用 | [credential-source.ts#L152-L176](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/credential-source.ts#L152-L176) | 配置即可执行任意命令，风险与 ArkSpace“环境变更需用户同意、官方可验证来源”冲突；若引入必须独立 ADR + 显式 opt-in。 |
| 多 provider 并发 `all` 模式与超大 provider 矩阵 | [gemini-search.ts#L519-L560](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-search.ts#L519-L560)、[RESOLVED_SEARCH_PROVIDERS#L47](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/gemini-search.ts#L47) | 上游维护约 30 个 provider、每个都有各自可用性探测与错误特例；ArkSpace 明确“窄而具体的模块优于推测性框架，只在多实现/多消费者时加扩展点”，现阶段 3 个 provider 不需要 `all` 并发语义。 |
| GitHub 全量克隆到本地 `/tmp` | [github-extract.ts#L111-L115](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/github-extract.ts#L111-L115) | 会在用户磁盘写数据、可能持有私有仓库权限、需要 owner 文件 + PID/boot-id 清理（约 1000 行）；属重副作用。ArkSpace 现阶段用 `web.fetch` 的 Provider 路径即可，“API 视图 + 阈值”可借鉴，本地克隆不建议。 |

---

## 来源许可与合规

- 上游 `pi-web-access` 采用 MIT 许可，版权 `Copyright (c) 2025 Nico Bailon`（[LICENSE](https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/LICENSE)）。MIT 允许使用、复制、修改、合并、发布，但要求在任何副本或实质部分中保留版权与许可声明。
- ArkSpace 的 [`AGENTS.md`](../../AGENTS.md) 规定：将外部材料引入项目前必须记录上游 URL、修订、许可、导入面与适配状态；把“用于实现行为的 API 文档”与“复制的源代码”分开处理；保留必需的版权与许可声明；禁止仅为加速迁移而复制旧架构。
- **本笔记没有导入任何上游源代码或成段散文。** 笔记中的引文仅为定位事实所需的极短片段（标识符、常量值、函数名、配置键、简短行为描述），并在文中注明来源；没有复制实现，也不构成可编译代码。若未来 ArkSpace 真正复用上游实现，需按 MIT 与 `AGENTS.md` 重新记录许可与导入面。
- 本调研遵守约束：未修改除本文件外的任何文件，未运行构建/测试/安装，未在仓库内创建临时文件（临时文件位于 `/tmp/piweb`）。

---

## 未验证 / 存疑

- **DNS rebinding**：上游 `validateRemoteUrl` 只在 fetch 前用 `dns.lookup` 预检，未把解析结果固定到实际连接；理论上的 TOCTOU/DNS rebinding 窗口**未验证**是否被 undici 或自定义 dispatcher 缓解。
- **CJK 查找质量**：`content-find.ts` 的 fuzzy 词元/句子切分以空格与换行为主，对中文断句与词的命中质量**未验证**（未运行其测试或真实中文语料）。
- **`source-check.ts` 的 `extraction_span` 偏移口径**：未确认该 `start/end` 相对的是抓取后的 Markdown 文本还是其他表示；若要复用，需先确认文本口径，否则引用会漂移。
- **`github-extract.ts` 陈旧克隆清理的跨平台可靠性**：owner 文件的 PID + Linux boot-id + 进程存在性判断逻辑较复杂；是否在所有平台都能安全清理**未完整验证**（只读源码，未运行）。
- **Curator 在 ArkSpace 中的可复用比例**：只确认其与 Pi 生命周期强耦合；未评估是否有可能在 MCP 客户端（而非 `arks` CLI）中提供类似人工审核，属方向性未决。
- **`arks` 环境下 `curl` 可用性**：代理方案依赖本地 `curl` 可执行；ArkSpace 的目标平台/企业环境是否普遍具备**未验证**（[`AGENTS.md`](../../AGENTS.md) 要求跨平台验证，未执行）。
- **上游测试是否全绿**：本次只读源码，未运行 `npm test`（任务禁止运行构建/测试/安装），因此“上游行为如其测试所述”部分依赖其测试文件存在性与源码一致性，实际执行结果**未验证**。
- **provider `fallbackOn` 的分类边界**：`classifyProviderError` 依赖错误文本正则，未逐一验证每个 provider 文案在真实响应下都能正确归类（例如某些网关把配额错误包装成 500）。
- **`fetchRouting.allowRemoteHostedProviders` 的默认关闭**：README 与 `extract.ts` 均表明默认关闭，但未逐 provider 走查是否所有远程抽取路径都受该开关控制（只确认了默认顺序常量与配置加载）。
- **`package.json` 的发布产物**：上游 0.31.0 的 `files` 与 `pi.extensions` 行为已读，但未验证实际 npm 发布产物内容。
- **上游对中文/非英文站点的抽取质量**：未评估；上游文档与源码注释也未声称有针对性优化。

---

## 参考来源

所有上游引用均固定在修订 [`610a52033f1e9705c0023ff9e0fac399319310a3`](https://github.com/nicobailon/pi-web-access/commit/610a52033f1e9705c0023ff9e0fac399319310a3)（main，2026-09-23）。完整树见 [`git/trees` API](https://api.github.com/repos/nicobailon/pi-web-access/git/trees/610a52033f1e9705c0023ff9e0fac399319310a3?recursive=1)。下列路径均以 `https://github.com/nicobailon/pi-web-access/blob/610a52033f1e9705c0023ff9e0fac399319310a3/` 为前缀：

- `package.json`、`LICENSE`、`SECURITY.md`、`README.md`、`CHANGELOG.md`
- `github-extract.ts`、`github-api.ts`、`github-issue-pr.ts`
- `ssrf-protection.ts`、`extract.ts`、`fetch-params.ts`、`utils.ts`、`abortable.ts`、`promise-try.d.ts`
- `storage.ts`、`content-find.ts`、`index.ts`、`source-check.ts`
- `credential-source.ts`、`exa.ts`、`openai-search.ts`、`kimi-search.ts`、`duckduckgo.ts`、`gemini-adc.ts`、`chrome-cookies.ts`、`gemini-web-config.ts`、`auth-fetch.ts`
- `rsc-extract.ts`、`jina-search.ts`、`pdf-extract.ts`、`datalab-pdf-extract.ts`、`gemini-pdf-extract.ts`、`youtube-extract.ts`、`video-extract.ts`、`crawl4ai.ts`、`firecrawl.ts`、`data-uri-sanitize.ts`、`declared-web-links.ts`
- `gemini-search.ts`、`render-search-error.ts`、`page-query.ts`、`feature-config.ts`
- `curator-page.ts`、`curator-run.ts`、`curator-server.ts`、`summary-model-scope.ts`、`summary-review.ts`
- `tool-activation.ts`
- `evidence/CONTRACT-EVIDENCE.md`、`evidence/contract-probe.mjs`
- `test/provider-precedence.test.mjs`、`test/search-routing.test.mjs`、`test/ssrf-protection.test.mjs`、`test/get-search-content.test.mjs`、`test/content-find.test.mjs`、`test/github-extract.test.mjs`、`test/tool-activation.test.mjs`、`test/config-path.test.mjs`
- `scripts/build.js`、`scripts/publish.js`

ArkSpace 本地依据（相对当前工作树）：`AGENTS.md`、`docs/architecture.md`、`docs/capabilities.md`、`package.json`、`src/providers/contracts.ts`、`src/providers/http.ts`、`src/providers/registry.ts`、`src/capabilities/provider-execution.ts`、`src/capabilities/web-fetch.ts`、`src/capabilities/web-crawl.ts`、`src/config/schema.ts`、`src/config/credentials.ts`、`src/config/paths.ts`、`src/protocol/types.ts`、`src/protocol/resource-schema.ts`、`src/protocol/site-monitor-schema.ts`、`src/io/json-store.ts`、`src/key-pool/key-pool.ts`、`src/mcp/server.ts`、`src/errors/provider-error.ts`、`skills/web/references/fetch.md`、`docs/research/` 现有笔记。
