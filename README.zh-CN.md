# ArkSpace

[English](README.md)

![ArkSpace 是一个未来感方舟式工作空间，包含研究、知识库、工作流、工具箱、规划和工程能力。](./assets/readme/hero.png)

**ArkSpace 是一个面向可复用 Agent Skills 及其可靠执行工具的创意工作区。** 它为 Agent 提供聚焦、可安装的指导，同时允许不同能力选择真正适合的执行方式：Host 工具、Skill 自带脚本、外部应用，或 ArkSpace 共享服务。

> **状态：** 0.1.0 是首个预览版，已提供 Web 检索、Code Context、带引用的 Research、具备所有权的 Firecrawl Browser Session、独立的 Exa 与 Firecrawl Monitor，以及 MCP stdio。该版本不代表替换或退役现有 ArkSpace；真实 Provider 与迁移验证将在发布后继续。

## 不变的核心价值

ArkSpace 的长期范围不局限于第一批 Provider 能力：

- Skill 是可复用的产品单元，不是统一 Runtime 的包装层。
- Skill 可以是纯指导、自带脚本、声明外部依赖，或调用共享能力。
- 只有在凭证、Provider fallback、额度或持久状态需要协调时才使用集中执行。
- 为确有需要的 Host 提供原生 Plugin 安装，同时不复制 canonical Skill 正文。
- 只有真实支持的 Host 需要时才增加 Host 专用集成。
- 来源、许可证、私有配置和外部副作用必须保持显式。

## 第一阶段能力

第一阶段重建目前价值最明确的 Provider 能力：

- 公共 Web 搜索、相似页面、正文读取、站点 Map、Crawl 和结构化提取；
- 代码与 API 上下文检索；
- 带引用和长时间运行的研究；
- 浏览器交互；
- 具备持久所有权和显式生命周期操作的定期监控；
- 集中的多 API Key 轮询、冷却、fallback 和诊断。

已实现的 canonical Skill 边界为 `web`、`research`、`browser` 和 `monitor`。

## `arks` CLI

ArkSpace 的共享执行命令是 **`arks`**，使用 Node.js 和 TypeScript 实现，要求 Node.js 20 或更高版本。可从 npm 安装已发布版本：

```bash
npm install --global @arkspace/cli@0.1.0
arks setup
arks doctor
```

源码检出环境使用：

```bash
npm install
npm run build
npm link
```

首个切片已实现：

```bash
arks setup
arks key add exa --env EXA_API_KEY_1
arks key add firecrawl --env FIRECRAWL_API_KEY_1
arks doctor
arks provider list
arks web search "agent skills"
arks web related "https://example.com/reference"
arks web fetch "https://example.com/docs"
arks web map "https://docs.example.com" --query "API reference"
arks web crawl "https://docs.example.com" --max-pages 20 --max-depth 2
arks web extract "https://example.com/pricing" --prompt "Extract plans" --schema schema.json
arks code context "current TypeScript SDK usage"
arks research run "compare current agent research APIs" --depth standard
arks browser open "https://example.com"
arks browser snapshot <session-id>
arks browser close <session-id>
arks monitor create --query "agent releases" --period 1d --webhook https://example.com/hook --secret-file ./monitor.secret --confirm
arks monitor status <monitor-id>
arks monitor pause <monitor-id> --confirm
arks monitor delete <monitor-id> --confirm
arks monitor site create --input ./site-monitor.json --confirm
arks monitor site checks <site-monitor-id>
arks monitor site delete <site-monitor-id> --confirm
arks mcp serve
```

需要共享执行的 Skill 通过版本化机器接口调用 CLI，不导入 Runtime 源码，也不解析仓库路径：

```bash
arks invoke web.search --input search-request.json
arks invoke web.related --input related-request.json
arks invoke web.fetch --input fetch-request.json
arks invoke web.map --input map-request.json
arks invoke web.crawl --input crawl-request.json
arks invoke web.extract --input extract-request.json
arks invoke code.context --input code-context-request.json
arks invoke research.run --input research-request.json
arks invoke browser.open --input browser-open-request.json
arks invoke browser.interact --input browser-action-request.json
arks invoke monitor.create --input monitor-create-request.json
arks invoke monitor.runs --input monitor-runs-request.json
```

`monitor.*` 表示 Exa recurring search；`monitor.site.*` 是独立的 Firecrawl 契约，保留 scrape、crawl、web search target、五字段 cron 或自然语言计划、1–365 天 retention、可选 goal judging、Provider credit estimate 和逐页面 check 结果。

`arks mcp serve` 使用官方 MCP TypeScript SDK，通过 stdio 暴露同一套 Protocol v1 capability dispatcher，不复制 Provider 逻辑或生命周期规则。

## Plugin 安装

ArkSpace 已提供 Claude Code 和 Codex 原生 Plugin 的开发态 Manifest，同时保留可移植的 canonical Skills。Canonical Skills 始终位于 `skills/`；两个 Host 都直接使用这个目录。

Codex Marketplace 直接指向仓库根目录，因此 Plugin 不需要编译，也不需要镜像 Package 目录。日常修改就是源码修改。只有明确发布版本时才更新 Plugin 版本元数据，并验证 Tag Source 的安装；需要软件构建的只有 Node/TypeScript CLI。

## 项目导航

| 需求 | 阅读 |
| --- | --- |
| 理解新系统边界 | [架构](docs/architecture.md) |
| 查看迁移阶段和切换门槛 | [迁移计划](docs/migration.md) |
| 查看 0.1 版本范围、证据和发布阻塞项 | [0.1 版本证据](docs/migration/v1-evidence.md) |
| 新增或设计 Skill | [Adding Skills](docs/adding-skills.md) |
| 配置 MCP stdio transport | [MCP transport](docs/mcp.md) |
| 查看目标 Host 与操作系统支持 | [Platform Support](docs/platform-support.md) |
| 维护方案文档与未来代码 | [Maintenance](docs/maintenance.md) |
| 查看 CLI 边界决策 | [ADR 0001](docs/adr/proposed/0001-node-typescript-arks-cli.md) |
| 查看首批 Skill 边界提案 | [ADR 0002](docs/adr/proposed/0002-initial-web-skill-boundaries.md) |
| 查看 Plugin 直接源码分发决策 | [ADR 0004](docs/adr/proposed/0004-direct-source-plugin-distribution.md) |
| 查看 Browser 与 Monitor 所有权决策 | [ADR 0007](docs/adr/proposed/0007-owned-browser-and-monitor-resources.md) |
| 查看 MCP stdio transport 决策 | [ADR 0008](docs/adr/proposed/0008-mcp-stdio-transport.md) |

## 仓库约定

- 开始实现后，canonical Skills 位于 `skills/<skill-name>/SKILL.md`。
- 共享 CLI 代码位于 `src/`；Skills 不直接 import 它。
- Skill 自带脚本保留在所属 Skill 目录中。
- 私有密钥、Endpoint、本地状态和个人配置不得提交。
- 引入外部源码前必须记录来源、许可证和适配状态。
- Plugin Manifest 直接引用 canonical Skills，不维护生成式 Plugin 镜像。
- 现有 ArkSpace 仓库只作为行为证据，不作为新项目的架构来源。

修改项目之前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。
