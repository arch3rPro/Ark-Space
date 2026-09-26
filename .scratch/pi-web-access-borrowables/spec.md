# Spec: pi-web-access 可借鉴项的范围与优先级

Status: scoped — 范围与优先级已于 2026-09-25 确认；首批工单见 [`issues/`](issues/)。

调研依据：[pi-web-access 可借鉴能力调研](../../docs/research/pi-web-access-borrowable-patterns.md)（上游固定修订 `610a52033f1e9705c0023ff9e0fac399319310a3`，MIT）。用户已同意该笔记中的「可借鉴项」；本 spec 只把它们整理成可决策的范围与优先级，**不含实现方案与代码**。

## 目标

在 ArkSpace 内，以最小依赖与既有边界为约束，吸收 pi-web-access 中被验证有效的模式；每项都落到 ArkSpace 已有或明确的边界（capability / provider adapter / protocol / config / skill-local script）。

## 非目标

- 不实现任何代码，不新建 capability / provider / 协议字段。
- 不引入上游明文 key 配置、本地浏览器 cookie、Curator UI、Pi 宿主耦合机制（见「明确不做」）。
- 不对齐上游的 provider 广度（30+），不引入 `all` 并发矩阵。
- 不修改 `docs/research/pi-web-access-borrowable-patterns.md` 已记录的上游事实。

## 决策原则

- ArkSpace 现有依赖仅 `@modelcontextprotocol/server`、`ajv`、`commander`、`zod`（[package.json](../../package.json)）。新增重依赖（readability / turndown / unpdf / linkedom / ffmpeg）必须有真实消费者。
- 只在多实现或多消费者出现时引入扩展点（[AGENTS.md](../../AGENTS.md)、[architecture.md](../../docs/architecture.md)）。
- 任何网络抓取与子进程调用都受「校验不可信边界」「最小子进程环境」「显式确认与可验证清理」约束（[AGENTS.md](../../AGENTS.md)）。
- 未验证事实不得据以决策；先补验证再排期。

## 优先级分层

### T1 — 现在可做（低风险，无架构变更）

| # | 借鉴项 | 来源项 | 落点 | 说明 |
| --- | --- | --- | --- | --- |
| W1 | 失败分类与显式 provider 严格失败 | H1, H2 | [src/errors/provider-error.ts](../../src/errors/provider-error.ts)、[src/capabilities/provider-execution.ts](../../src/capabilities/provider-execution.ts)、`tests/` | ArkSpace 已有分类回退（`fallbackOn`）与尝试证据。借鉴点是**用表驱动测试固定错误文案→类别映射**，防止分类静默漂移；以及「显式选择 > 旧配置 > auto」优先级的具名测试。 |
| W2 | 可取消等待 + 独立清理截止时间 | C2 | [src/capabilities/provider-execution.ts](../../src/capabilities/provider-execution.ts)、[src/providers/contracts.ts](../../src/providers/contracts.ts) | ArkSpace 已在 attempts 中记录 `cleanup`。借鉴 `Promise.race` + 独立清理截止的模式，明确「已放弃等待但底层仍在跑」的资源/计费泄漏，并把清理结果作为独立证据。无新依赖（上游的 `promise.try` 只是类型声明）。 |
| W3 | 错误渲染与主结果渲染分离 | H3 | [src/errors/](../../src/errors/)、[src/cli/](../../src/cli/) | 只借鉴「纯 plan 函数 + 薄适配层」的解耦。上游的展开交互依赖 Pi TUI，不移植。 |
| W4 | 表驱动契约证据与测试形态 | K1, K2 | `tests/`、[package.json](../../package.json) 的分层校验命令 | 借鉴「先探测真实 Provider、再固化为夹具」「把入口当扩展加载 / 注入假 fetch / 子进程隔离配置」。ArkSpace 已有分层 `check` / `test:e2e`，沿用分层而非全量替换。 |
| W5 | 逐工具启用/禁用 | I1（可移植部分） | [src/mcp/server.ts](../../src/mcp/server.ts)、[src/cli/main.ts](../../src/cli/main.ts)、[src/config/schema.ts](../../src/config/schema.ts) | 只做 enabled/disabled 与可选别名；不做宿主特有的延迟激活/transcript 重建。 |

### T2 — 需先决策或先补验证（架构级或依赖级）

| # | 借鉴项 | 来源项 | 落点 | 前置条件 |
| --- | --- | --- | --- | --- |
| W6 | 本地 HTTP 抓取路径的信任边界（SSRF） | A1, A2, A3 | [src/providers/](../../src/providers/)、[src/protocol/](../../src/protocol/)、[src/config/schema.ts](../../src/config/schema.ts)、[src/capabilities/web-fetch.ts](../../src/capabilities/web-fetch.ts) | **仅当** ArkSpace 决定新增本地直连抓取（见 W9）。当前所有 `web.*` 都经 Provider API，本地无任意 URL 直连路径，SSRF 面尚不存在；现有检查仅 hostname 级（[resource-schema.ts](../../src/protocol/resource-schema.ts)、[site-monitor-schema.ts](../../src/protocol/site-monitor-schema.ts)）。若做，必须先定义 `allowRanges`/`trustEnvProxy` 逃生阀语义并在 `arks doctor` 暴露生效范围，且先解决未验证的 DNS rebinding 窗口。 |
| W7 | 大结果按需检索（responseId / 分页 / findText） | B1, B2, B3 | [src/protocol/types.ts](../../src/protocol/types.ts)、`src/state/`、[src/capabilities/](../../src/capabilities/) | ArkSpace 无长驻进程，`arks invoke` 是单次进程（[architecture.md](../../docs/architecture.md)）。要复用必须先有**持久化检索语义 + 缓存清理/所有权**，属架构级成本。B3 的 fuzzy 对 CJK 命中质量未验证，需先验证。 |
| W8 | 抓取模式与抽取降级链 | D1, D2 | [src/protocol/types.ts](../../src/protocol/types.ts)、[src/providers/contracts.ts](../../src/providers/contracts.ts)、[skills/web/references/fetch.md](../../skills/web/references/fetch.md) | D1 的 `readable/raw/answer` 会让 provider 能力矩阵变复杂，需同步 [capabilities.md](../../docs/capabilities.md)；`answer` 会把页面内容发给模型，须显式 opt-in。D2 的本地 Readability/RSC/Jina 兜底会引入新依赖，须先证明 Provider 侧提取确有缺陷。 |
| W9 | GitHub 的结构化视图 | E1 的「API 视图 + 阈值」部分、E2 | `skills/` skill-local script，或 `src/capabilities/` 新能力 | **不采纳完整本地克隆**（见「明确不做」）。可借鉴：按体积阈值在 API 视图与回退之间切换、PR/Issue 结构化渲染、`gh` 可用性缓存、非交互环境变量（`GIT_TERMINAL_PROMPT=0` 等）。若走 `gh`，须建模宿主凭证访问与最小子进程环境。 |
| W10 | 证据工件（source/passage/claim + hash + 偏移） | F1 | [src/protocol/](../../src/protocol/)、[src/capabilities/research.ts](../../src/capabilities/research.ts) | 必须先定义 `extraction_span` 相对哪种文本口径（原始 HTML / 纯文本 / Markdown），否则引用漂移；CJK 断句质量未验证。 |
| W11 | 统一凭据源解析的卫生规则 | G1（卫生部分） | [src/config/credentials.ts](../../src/config/credentials.ts)、`src/credentials/` | 只借鉴 `$ENV` / `!command` 的**校验护栏**（命令超时、输出上限、环境白名单、控制字符拒绝、脱敏）与分类错误。`!command` 默认开启是高风险，若引入必须独立 ADR + 显式 opt-in，不能进默认路径。 |
| W12 | 零配置/额外凭据源 | G3, G4 | [src/providers/](../../src/providers/)、[src/config/credentials.ts](../../src/config/credentials.ts) | G3（ADC OAuth）需处理 token 刷新/时钟偏差/JWT，属新凭据源；G4（DuckDuckGo HTML）无 SLA、可能 ToS 灰区。二者都需先有真实消费者，且 G4 必须标注「非官方、尽力而为」。 |
| W13 | 代理传输与脱敏 | J2 | [src/config/schema.ts](../../src/config/schema.ts)、[src/providers/http.ts](../../src/providers/http.ts)、[src/errors/provider-error.ts](../../src/errors/provider-error.ts) | 依赖本地 `curl` 可执行（**可用性未验证**）与临时目录写盘。借鉴「代理 URL 脱敏 + `NO_PROXY` 解析」，但传输实现需评估单进程模型下的并发与清理。 |
| W14 | 多候选配置路径探测 | J1 | [src/config/paths.ts](../../src/config/paths.ts) | 低技术风险，但会引入「改了哪个文件」的困惑；若做必须由 `arks doctor` 明确当前生效路径。 |
| W15 | 有界并发 | C1 | [src/capabilities/](../../src/capabilities/)、[src/config/schema.ts](../../src/config/schema.ts) 的 `execution` 段 | 仅在 `web.fetch` 支持多 URL 或 provider 并发调用时才有意义。并发会改变 key-pool 的配额竞争，须先确认事务性选 key 不会被并发重复选择（[key-pool.ts](../../src/key-pool/key-pool.ts)）。 |
| W16 | PDF 多引擎、视频/帧抽取 | D3, D4 | 未来 Skill 的 `compatibility` + skill-local script，或 [src/providers/](../../src/providers/) | `unpdf`/PDF.js、ffmpeg/yt-dlp 均为重依赖或系统依赖；Datalab/Gemini 是额外付费凭据。**未验证** ArkSpace 目标用户是否需要；先确认真实需求再评估。 |

### 明确不做（引用调研结论）

- 明文 API key 存配置、浏览器 cookie 提取/解密、Curator 本地浏览器 UI、`web_enable` 动态工具激活、Pi TUI 展开诊断、Pi `modelRegistry` 宿主凭据复用、`!command` 默认开启、`all` 多 provider 并发、GitHub 全量本地克隆。
- 理由与上游证据见[调研笔记「明确不建议借鉴」](../../docs/research/pi-web-access-borrowable-patterns.md#明确不建议借鉴)。

## 依赖关系

- 已决定新增本地直连抓取：W8 先定义入口契约（工单 07），W6 据此实现安全门（工单 06）；W6 验收前，不得从 CLI/MCP/`arks invoke` 启用真实本地直连。
- W7 依赖先建立持久化检索与缓存所有权语义。
- W15 依赖 W6（并发只影响本地直连抓取时）或先扩展多 URL 协议输入；并依赖 key-pool 并发安全确认。
- W10 依赖先定义文本口径。
- W11 / W13 / W16 各自依赖先确认消费者与验证未验证项；W12 已记录为暂缓决策：不新增凭据源/provider，ADC 等待 Google 消费者，DDG HTML 等待明确产品/法律批准（见 [`issues/08-w12-credential-source-keyless-provider-decision.md`](issues/08-w12-credential-source-keyless-provider-decision.md)）。W13–W16 当前统一暂缓，见 [`issues/09-w13-w16-follow-up-triage.md`](issues/09-w13-w16-follow-up-triage.md)。

## 已决策（2026-09-25）

| # | 问题 | 决定 | 后果 |
| --- | --- | --- | --- |
| 1 | 是否新增本地直连 HTTP 抓取路径 | **新增** | W6（SSRF 信任边界）、W8（抓取模式/本地抽取）、W15（有界并发）解除阻塞，进入范围；W6/W8 必须先于任何本地直连抓取落地。 |
| 2 | 是否接受持久化检索状态 | **接受** | W7（responseId/分页/findText）进入范围，需先定义缓存所有权与清理语义。 |
| 3 | 是否接受引入新依赖 | **接受** | W8（readability/turndown）、W16（unpdf/ffmpeg）进入范围，但仍需逐项确认消费者与跨平台验证。 |
| 4 | T1 的 W1–W5 是否作为首批实现项 | **是** | 已拆为本目录 `issues/01`–`05`。 |
| 5 | W12 是否现在新增 ADC 或 DuckDuckGo HTML | **否** | 不新增凭据源/provider；ADC 等待 Google 消费者，DDG HTML 等待明确产品/法律批准；详见工单 08。 |

**下一批（已解阻，已拆工单）：** W8（工单 07 先定义本地入口契约，不暴露真实直连）→ W6（工单 06 安全门）→ W8 完成安全纵向切片。W7、W15、W16 仍未拆工单。

当前 T2 工单：

- [`issues/06-local-fetch-ssrf-boundary.md`](issues/06-local-fetch-ssrf-boundary.md)：本地直连抓取的 SSRF 信任边界，依赖 W8 的入口契约。
- [`issues/07-local-fetch-extraction-fallback.md`](issues/07-local-fetch-extraction-fallback.md)：本地直连抓取与抽取降级链，先做最小真实消费者。
- [`issues/08-w12-credential-source-keyless-provider-decision.md`](issues/08-w12-credential-source-keyless-provider-decision.md)：W12 决策记录；不新增凭据源/provider。
- [`issues/09-w13-w16-follow-up-triage.md`](issues/09-w13-w16-follow-up-triage.md)：W13–W16 后续能力准入复核；当前统一暂缓。

工单拆分遵循 [issue-tracker 约定](../../docs/agents/issue-tracker.md)：一票一文件、从 `01` 编号、文件头带 `Status:`。

## 验证方式（实现阶段适用）

按 [AGENTS.md](../../AGENTS.md)：契约测试、真实入口测试、隔离 Skill 测试、以及适用的跨平台证据。仓库现有命令：`npm run check`、`npm run test:e2e`、`npm run test:hosts`、`npm run verify:release`；不得记录不存在的命令。

## 未决 / 风险

- T1 各项虽低风险，但仍需确认不破坏现有 Protocol v1 输出稳定性。
- T2 多数项的**未验证前提**（DNS rebinding、CJK find、`extraction_span` 口径、`curl` 可用性、上游分类覆盖）必须在实现前补验证，不得以假设推进。
- 上游许可为 MIT，若未来复用其实现代码，须按 [AGENTS.md](../../AGENTS.md) 记录 URL/revision/许可/导入面并更新 `NOTICE.md`；本 spec 与调研笔记均未导入上游代码。
