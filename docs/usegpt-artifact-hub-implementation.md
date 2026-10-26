# UseGPT Artifact Hub 实施方案

状态：待实施。本文只安排后续开发，不表示命令、schema 或文件传输已经存在。

配套文档：[设计方案](usegpt-artifact-hub.md)。

## 1. 分支与完成边界

- 开发分支：`experiment/usegpt-artifact-hub`。
- 基线：`experiment/usegpt-secure-mcp`，`caba7d3`。
- 原 CDP 工作区保持原样，用户已有改动和未跟踪文件不迁移、不删除。
- 新分支仍继承历史 CDP 代码；替换入口必须显式实施，不能因为新增文档就宣称 CDP 已从程序移除。
- 本轮仅交付文档；不安装运行依赖、不创建用户数据目录、不迁移用户数据、不启动服务、不更改版本、不发布 npm。

最终完成条件是已安装的 `arks`、ChatGPT Connector 和至少一个真实本地 Agent 走通：

```text
选择 Project
→ 创建 Task
→ ChatGPT 提交文本/结构化数据/真实文件
→ 本地持久化 ArtifactRevision
→ 创建 Handoff
→ Agent 获取确定 Revision
→ Agent 完成后续工作
→ 删除/恢复 Task
→ 重启后再次读取
→ purge 后仅回收无人引用内容
```

每阶段独立提交，并把证据明确分成 contract、installed-entry、isolated-Skill、真实 Host 和跨平台。不能用 mock 代替真实 Host 验收。

## 2. 当前代码与目标改动范围

实施前重新读取这些文件，基线上的旧语义不应直接沿用：

| 当前入口 | 后续责任 |
|---|---|
| `src/cli/main.ts` | `arks usegpt` 人类入口和机器调用路由 |
| `src/capabilities/usegpt.ts` | 新 capability dispatcher，替换隐式 CDP 执行 |
| `src/protocol/usegpt-schema.ts`、`types.ts`、`schema.ts`、`invoke.ts` | 新请求、结果、错误与校验 |
| `src/mcp/server.ts` | 本地 Agent MCP adapter，共用 dispatcher |
| `src/config/paths.ts`、`schema.ts`、`usegpt.ts` | 全局配置中的 Hub 根目录、dataDir 与连接范围 |
| `src/cli/setup-usegpt.ts` | 常驻服务/Tunnel 配置和明确健康状态，移除 Chrome 检查 |
| `src/usegpt/contracts.ts`、`runtime.ts`、`server.ts` | 审查旧合同，逐步替换成 Hub 合同与 daemon |
| `src/usegpt/secure-mcp-probe.ts` | 实验参考，不能作为生产队列或常驻服务直接扩展 |
| `scripts/usegpt-secure-mcp-probe.mjs` | 保留实验说明；生产 Setup 不依赖临时 npm 安装目录 |
| `src/providers/usegpt-cdp.ts` | 不被新入口调用；最终移除或只保留迁移文档说明 |
| `skills/UseGPT/SKILL.md` | 保持 canonical Skill 路径，更新成成果提交与取用流程 |
| `schemas/protocol/v1/` | 由仓库生成器生成新 schema，不手工复制 |
| `tests/usegpt-*.test.ts` | 拆分新合同测试和历史测试，明确撤销旧行为 |
| `README.md`、`README.zh-CN.md`、`INSTALL.md`、`docs/architecture.md`、`docs/capabilities.md` | 实现交付时同步当前行为、安装方式与限制 |

建议私有模块形状：

```text
src/usegpt/
  contracts.ts          # 内部合同与公开结果映射
  store.ts              # SQLite 事务和迁移
  blobs.ts              # staging、校验、发布、读取与回收
  service.ts            # Project/Task/Artifact/Handoff 业务规则
  daemon.ts             # 单实例、生命周期与 IPC
  host-files.ts         # 原生 Host 文件引用解析与流式导入
  worker.ts             # 后期：一个真实 Agent 执行器
```

文件名只是目标责任分配；已有模块能承载时复用，不为每个逻辑操作创建一层 pass-through class。CLI、MCP 和 ChatGPT MCP 入口都调用同一 service 合同。

## 3. Phase 0：固定合同与运行依赖

交付：

1. 定义 Project、Task、ArtifactRevision、Blob、Handoff、删除批次和读取租约的 schema。
2. 所有 capability 使用 `usegpt.` 前缀；保留现有 Protocol v1 envelope，不虚构 Web Provider。
3. 明确 `task.complete`、`task.wait`、`artifact.publish_status`、storage usage、删除预览的请求/响应。
4. 将 request timeout、业务 pending、取消确认、partial result、dispatch unknown 分开。
5. 固定发布幂等 key 和 Handoff claim token/fencing generation 合同。
6. 为 SQLite 驱动做一个 Node >=20、Linux/macOS/Windows 的打包验证。

依赖选择：仓库当前没有 SQLite 依赖，不能直接假定 Node 的 `node:sqlite` 在声明的 Node 20 范围可用。先评估一个成熟驱动的安装与跨平台兼容，再选定并记录 ADR；不得悄悄提高 Node 最低版本。若原生预编译包不支持某个平台，必须明确平台支持范围或选择替代驱动。

对外 SDK：沿用仓库官方 `@modelcontextprotocol/server` v2。DevSpace 的旧 SDK 和 `ext-apps` 调用只作为行为证据，不直接复制 import；确认 v2 如何注册 `_meta.openai/fileParams` 和 ResourceLink 后再实现。

完成标准：schema、迁移版本、错误分类、SQLite 安装兼容和 SDK metadata 能力都有最小可验证证据；没有把原生依赖安装失败留给用户。SQLite 驱动和支持矩阵是进入 Phase 1 的硬门槛，选型证据未通过时阶段保持阻塞；不能带着未知驱动进入实现。

## 4. Phase 1：可靠存储和删除基础

交付：

- 全局配置仍由 `resolveArkSpacePaths` 定位；新数据默认 `~/.arkspace/usegpt/`。
- 可配置 rootDir 和 dataDir；staging 与正式 Blob 位于同一卷。
- daemon 数据目录独占锁；schema 版本检查；SQLite 外键、事务、忙等待与 WAL 设置。
- 所有本地文本、数据和二进制统一写 Blob；URL 产物明确为外部引用。
- Project/Task、产物版本、显式引用关系、幂等请求记录与 outbox 同事务提交。
- 基础 delete/restore/purge、删除批次、读取租约、回收任务。
- 配额预留与释放，不能并发绕过限额。

必须先验证的故障场景：

| 场景 | 期望 |
|---|---|
| 两个任务提交相同字节 | 两个逻辑身份，共用一份 Blob |
| 并发更新同一 Artifact | Revision 唯一，不覆盖旧版本 |
| 写一半进程退出 | 不产生 available Revision |
| Blob 发布后 DB 事务失败 | 留下可核对孤儿，不出现虚假成功 |
| 读取中 purge | 读取租约保护，后续读取拒绝 |
| 回收时另一个发布相同哈希 | 无新引用挂到已删除文件 |
| 删除生产 Task，但另一个 Task 已保留 Revision | 消费者继续读取，生产任务入口不可读取 |
| Project 删除后恢复 | 不复活早前单独删除的 Task |
| 配额不足 | 返回稳定错误，既有正式产物仍在 |
| 非法文件名、路径穿越、符号链接 | 无法写出受管目录 |

完成标准：存储和删除是同一可恢复模型的一部分，不能先上线“只增不减”然后再补回收安全。

## 5. Phase 2：常驻服务与已安装入口

交付：

- 生产 daemon 固定安装路径和可恢复启动，完成一个 Task 不退出服务。
- `arks usegpt start/stop/status` 管理常驻服务，`arks usegpt serve` 是其前台运行入口；`arks usegpt mcp serve --profile <configured-profile>` 是 Tunnel 启动的生产 stdio adapter。以上均为待实施合同，命令不再在后续阶段另行改名。
- 本地 Agent 通过 `arks invoke usegpt.* --input <file>` 或 `arks mcp serve` 操作同一个 daemon。
- ChatGPT 使用独立的 stdio MCP adapter，由 tunnel-client 的 MCP command 启动，按设计方案的 profile 身份/项目/tool allowlist 映射到同一 service；工具名固定为 `usegpt_` 加逻辑操作下划线形式。
- loopback/IPC 访问身份和项目范围检查；Tunnel control-plane key 不充当任务 API bearer key。
- 单独报告 daemon、数据库、Tunnel 连接、MCP 初始化和 Host 工具调用健康；不能把 poller started 当 Host 完成。
- SIGINT/SIGTERM 只关闭自己拥有的进程、释放锁和上传，不能关闭用户终端。
- 外部 tunnel-client 包不自动下载或执行，除非 Setup 得到环境变更授权并核对官方来源。

CLI 输出：stdout 是协议结果，stderr 是日志；任务等待完成后 CLI 可以返回，daemon 和 Tunnel 不随 CLI 退出而关闭。

完成标准：从本地 tarball 安装到仓库外的干净目录，清空仓库 NODE_PATH 和其他隐式依赖，启动 daemon、创建 Task、跨进程读回、停止服务。核对完整传递依赖，避免重复探针曾漏包 `dist/io/json-store.js` 的问题。命令示例用 bash 和 zsh 都验证，脚本不得使用 zsh 只读变量 `status` 或主动 `exit` 用户交互 shell。

## 6. Phase 3：ChatGPT 文本与数据提交

交付：

- Project 选择和 Task 创建/关联。
- `usegpt.artifact.publish_inline` 支持 Markdown、JSON 和 URL 集合；字节限额且信任边界校验。
- `task.complete` 显式列出已交付产物和未交付项。
- 通过稳定 ID 和短摘要返回 receipt。
- ChatGPT 提交后，新的本地 Agent 进程能够发现和读取。

真实 Host 验收：

```text
ChatGPT 创建或关联 task
→ 提交结论和 Markdown
→ 提交 JSON 和参考链接
→ 显式完成 task
→ 本地 Agent 查询项目和任务
→ 按确定 Revision 读取
```

此阶段 Agent 通过 `project.list`、`task.list` 和 `artifact.list` 主动发现并读取，无自动通知，也不要求创建 Handoff。阶段 5 再验证定向交接与领取，所以阶段 3/4 不依赖尚未实现的 Handoff API。

不依赖 App 无限轮询或 `sendFollowUpMessage` 才能发布；用户在 ChatGPT 发起工作是合法主路径。Connector 工具启用和具体 ChatGPT 模式的组合能力逐项记录。

完成标准：保存实际 receipt、脱敏调用轨迹和本地数据校验结果；真实正文不提交 Git。

## 7. Phase 4：Host 文件导入

先实现一种真实 Host 文件类型，再逐种扩展：

1. 声明 `openai/fileParams`。
2. 接收 Host 原生文件对象。
3. 解析来源适配器和受信任主机；每次重定向重新验证，整次导入有截止时间。
4. 文件名只作 metadata，不进入受管物理路径。
5. stream -> staging -> 大小校验 -> SHA-256 -> 持久发布 -> DB 事务。
6. 远端 file reference 过期返回明确错误，不要求用户粘贴 cookie 或下载凭证。
7. 结果丢失用幂等 receipt 查询，不无条件重跑。

能力验收矩阵：

| ChatGPT 能力 | 检查项 |
|---|---|
| 网页搜索 | 文本与可用 URL 可提交，不宣称可验证搜索执行本身 |
| 深度研究 | 最终报告是否允许调用 Connector 提交；原生文件是否可绑定 |
| 图像生成 | 生成 PNG 是否能作为原生 file 参数传递 |
| 数据分析/文件生成 | CSV/JSON/PDF 的真实字节能否导入 |
| 绘图 | PNG/SVG/其他真实输出格式逐项验收 |

其他能力不需要新增专属 capability，只需对应产物格式和 Host 文件通路可用。Host 不支持的能力组合显示 unsupported 或给出明确手动导出路径，不能伪造产物已存储。

完成标准：至少一个真实 PNG 和一个真实文档/数据文件，确认本地哈希、大小、重启后读取，以及另一个 Agent 的读取结果。Mock URL 下载只证明本地传输合同。

## 8. Phase 5：交接发现与 Skill

交付：

- Handoff create/list/claim/complete/cancel。
- Project + Task + 固定 Revision 输入。
- 原子领取，token 与 fencing generation 校验。
- 有界 wait 和 cursor-based events，独立消费者 cursor。
- 更新 canonical `skills/UseGPT/SKILL.md`，将 ChatGPT 生产与本地 Agent 消费拆为操作分支并链接相应参考。
- 通过现有 manifests 引用 canonical Skill，不生成镜像、不改版本。

Agent 接入：只支持 MCP 的 Agent 使用工具；只支持 shell 的 Agent 使用 `arks invoke`；Skill 提供操作策略。安装 Skill 不表示 Agent 会自动运行。

完成标准：至少两种消费入口共享同一份 Task/Artifact 状态；两个并发 Agent 不能同时领取同一 Handoff。Skill 放在仓库外测试，不能靠 sibling 文件满足隐式依赖。

## 9. Phase 6：一个真实 Agent 的主动执行

此阶段需要选择首个实际本地 Agent adapter；在选择之前，Pull 和人工启动已可使用，不凭空创建通用 adapter registry。

交付：

- owner 明确配置的固定 executable + 参数模板，进程使用参数数组而不是拼接 shell。
- Handoff 只传对象 ID；正文不进入进程命令行。
- 持久 outbox 派发、claim lease、dispatch fence 和执行记录。
- 明确 accepted 不等于 delivered，更不等于 completed。
- 重启后查询已存在执行记录，结果不明留 unknown。
- 执行器权限、工作目录和允许项目由本地配置控制；ChatGPT 不能指定任意命令。
- 取消、超时和部分输出独立保存。

完成标准：ChatGPT 提交产物并创建交接后，本地服务自动启动已授权 Agent；Agent 取用固定 Revision、交付新产物；重启或断连不会重复启动不确定任务。

## 10. Phase 7：历史、清理、备份与运维

基础删除已在 Phase 1 完成；此阶段补完整用户入口：

- Project/Task 时间线、生产来源与消费记录。
- 存储总量、按 Project/Task 的逻辑占用与实际可回收量。
- 归档、回收站、恢复、清理预览、显式永久删除。
- 上传/读取租约检查、孤儿核对、可重试回收 job。
- 缓存清理、日志轮转、磁盘不足错误。
- 迁移 dataDir 的停服快照与哈希核验。
- 一致性备份和恢复到新目录的验证。

完成标准：删除一个 Task 不影响项目共享资料或其他 Task；删除 Project 后可按批次恢复；永久删除清理其请求正文、摘要、索引和缓存；共享对象仍由其他引用保留。外部 Agent 副本、ChatGPT 历史、备份和磁盘安全擦除明确不在默认删除承诺内。

## 11. CDP 退出与旧数据迁移

新分支不继续修复 CDP。程序入口的替换按如下顺序实施：

1. 新命令优先使用 Hub，不隐式启动 Chrome。
2. Setup、doctor、Skill 和中英文 README 移除新的 CDP 安装引导。
3. 旧 `task.start` 自动执行语义不可静默改成“排队等用户去 ChatGPT”；返回稳定 unsupported/deprecated 说明并指向新工作流。
4. 旧 task/artifact-get 合同若可兼容只读，可提供显式 legacy read；不可伪装成新任务已成功执行。
5. 用户手动选择 legacy import 后，复制旧任务文本/产物到新 Task，记录来源；不导入 Chrome profile、cookie、旧 bearer token 或任意私有端点。
6. 原始旧目录和实验 worktree 默认保留；删除旧数据是单独明确动作。
7. 新入口和真实 Host 验收后，移除未使用 CDP 模块、依赖及旧测试；不删除仍有其他功能使用的依赖。

版本、兼容性说明和发布只在用户显式请求 release 时处理。

## 12. 检查命令与证据

仓库已有命令：

```bash
npm run validate
npm run typecheck
npm test
npm run verify:package
```

文档交付运行 validate 与链接检查即可，不需要为无代码改动运行全部测试。后续实现按阶段运行相关测试、typecheck、installed-entry；最终集成运行 `npm run check` 和 `npm run verify:package`。增加的新测试必须进入已有 `npm test` 路径，不能把不存在的 npm script 写成验收命令。

跨平台至少覆盖：

- Node 最低受支持版本与当前 LTS；
- Linux、macOS、Windows 的路径、文件原子发布、目录保护、SQLite 安装、进程清理；
- POSIX 权限与 Windows ACL 差异；
- 路径包含空格；
- 数据目录迁移跨卷时采用显式复制验证，不能依赖 rename；
- bash/zsh 命令不关闭用户 shell。

真实 Host 验收记录 Host/模式、工具可用性、提交文件类型、receipt、字节校验结果和限制。记录放 `.scratch/usegpt-artifact-hub/`，敏感正文、原生 file reference 和 Tunnel 凭证不提交仓库。

## 13. 首版取舍

首版包含 Project、Task、固定版本 Artifact、Blob、删除恢复、Agent Pull、ChatGPT inline 和至少一种 Host 文件导入。

暂不包含：多租户 ACL、跨设备复制、任意 Agent 插件市场、完整全文检索、自动网页快照、模型能力路由、分布式对象存储和通用分块上传。第二个具体消费者或明确需求出现时再扩展。

CAS 去重来自当前共享与删除需求；不添加文件格式专用的存储后端。只有一个真实 Agent 执行器时保持具体模块，避免先建泛化框架。
