# UseGPT Artifact Hub

状态：待实施设计；用户已选择放弃 CDP，以下协议和存储细节尚未实现。

基线：`experiment/usegpt-secure-mcp`（`caba7d3`）。该基线仍包含历史 CDP 代码；继承代码不代表继续采用 CDP。

本分支：`experiment/usegpt-artifact-hub`

实施顺序、文件改动范围、验证门槛和迁移见 [实施方案](usegpt-artifact-hub-implementation.md)。[Architecture](architecture.md) 描述现有实现，本文描述目标设计，不能把本文示例当成已可执行命令。

本文定义 UseGPT 的新方向：ChatGPT 作为成果生产端，本地常驻服务作为持久化、索引、交接和分发端，任意 ArkSpace Agent 通过 MCP、`arks` CLI 或 Skill 使用成果。

## 1. 问题定义

UseGPT 不再尝试从本地 Agent 外部唤醒一个关闭的 ChatGPT 会话。Secure MCP Tunnel 的可验证方向是：ChatGPT 会话主动调用本地 MCP 服务。产品因此把 ChatGPT 的网页搜索、深度研究、图像生成、绘图、文件生成、数据整理和其他能力统一看作“产物生产过程”。

目标链路：

```text
用户在 ChatGPT 中使用能力
  -> ChatGPT 通过 MCP App/Connector 提交产物
  -> UseGPT 本地常驻服务持久化并索引产物
  -> 服务创建或更新任务交接
  -> 任意 ArkSpace Agent 发现交接
  -> Agent 读取文本、数据、图片、文件或链接
  -> Agent 继续工作并提交新的产物
```

这个方向不承诺本地 Agent 能在 ChatGPT 会话关闭时启动 ChatGPT 推理。它解决的是成果的接收、保存、发现、交接和复用。

## 2. 参考实现与借鉴边界

### WebCodex

固定参考版本：[`93d5911587afbb75b6ecf61051e79583ff59597e`](https://github.com/yyjeqhc/webcodex/commit/93d5911587afbb75b6ecf61051e79583ff59597e)。

借鉴：

- Durable Wake 的持久事件、精确消费、dispatch fence 和 delivered/unknown 结果；
- 项目产物的元数据与真实字节分离；
- 通过短期、绑定调用方的 MCP ResourceLink 读取大文件和二进制内容；
- 上传过程有大小预留、并发限制和闲置上传清理。

不直接复制：

- WebCodex 的 Project/Runner 专用模型；
- 进程内短期 export registry 作为永久产物存储；
- 将 Work Result UI 当作公共 Artifact API；
- 假设 Wake 本身传输任意文件。

### DevSpace

固定参考版本：[`531d3f973f09f7b6b4993c9ff58f80a4514b9ba2`](https://github.com/Waishnav/devspace/commit/531d3f973f09f7b6b4993c9ff58f80a4514b9ba2)。

借鉴：

- 使用 ChatGPT Host 提供的原生 `openai/fileParams` 文件对象；
- 只允许受信任的 OpenAI 文件主机和有限重定向；
- 流式写入独占临时文件；
- 校验声明大小、实际大小和 SHA-256；
- `fsync` 后原子发布；
- 不接受任意 URL、本地路径或覆盖已有目标；
- 清理超过 24 小时的失败下载临时文件。

不直接复制：

- 只把文件保存到单个 Workspace 路径；
- 只返回本地相对路径；
- 用 Workspace 数据库代替跨任务 Artifact 索引；
- 假设文件写入后会自动唤醒 Agent。

两个参考项目都证明了 Host 原生文件引用可以进入本地文件系统，但都没有直接提供 UseGPT 所需的跨项目、跨任务、跨 Agent 产物库。

## 3. 领域模型

模型层次如下：

```text
Project
  -> Task
       -> TaskArtifactRef -> Artifact -> ArtifactRevision -> Blob
       -> Handoff
       -> Event
```

### Project

长期工作空间。项目可以是产品、客户、实验、研究主题或一个长期 Agent 工作区。

Project 负责：

- 长期背景和共享资料；
- 项目级权限和保留策略；
- 任务和产物的组织；
- 项目级归档、回收和恢复。

### Task

Project 内的一次具体工作，是历史和交接的主要聚合对象。

Task 负责：

- 请求和目标；
- 状态和时间线；
- 生产者与消费者；
- 任务级产物引用；
- Handoff；
- 删除、恢复和保留状态。

Task 状态：

```text
queued
active
waiting
completed
failed
cancelled
deleted
```

`deleted` 是逻辑状态，不代表真实文件立即删除。

### Artifact

一个有稳定身份的逻辑产物。Artifact 表示“这个东西是什么”，不直接等于某个文件路径。

支持的基础种类：

```text
text
document
structured-data
image
audio
video
archive
link
collection
manifest
```

`kind` 用于筛选和呈现，具体读取行为由 `mediaType` 和存储类型决定。

Artifact 可以是：

- 任务专属产物；
- 项目共享产物；
- 由另一个产物派生的产物；
- 仅保存外部地址的链接产物；
- 包含多个子产物的集合或 manifest。

额外不变量：

- 将校验后的字节保存为 Blob；
- 不因 Host 声称存在一个文件，就把该 Artifact 标记为 `available`；
- 只把 `file_id` 和脱敏来源作为溯源信息，下载 URL 不进入持久日志或事件。

### ArtifactRevision

Artifact 的内容不能原地覆盖。每次更新创建新 Revision：

```text
artifact_report
  revision 1: draft.md
  revision 2: reviewed.md
  revision 3: final.md
```

Agent 在 Handoff 中必须引用确定的 `artifactId + revision`，避免执行期间输入内容变化。

### Blob

Blob 是实际保存的字节，由 SHA-256 内容寻址。多个 ArtifactRevision 可以引用同一个 Blob。

```text
artifact_1@1 ─┐
              ├── sha256:abc...
artifact_2@3 ─┘
```

Artifact 身份和 Blob 身份必须分离：

- `artifactId`：业务对象、名称、任务关系、版本；
- `blobHash`：真实字节、大小、哈希和物理存储。

### Handoff

Handoff 表示“谁接着做什么”，把产物和执行意图绑定起来。

```json
{
  "handoffId": "handoff_123",
  "projectId": "project_123",
  "taskId": "task_456",
  "from": "chatgpt:session_abc",
  "to": "agent:web-builder",
  "instruction": "使用最新文案和主视觉制作首页",
  "artifactRefs": [
    { "artifactId": "artifact_copy", "revision": 2 },
    { "artifactId": "artifact_image", "revision": 1 }
  ],
  "status": "pending"
}
```

Handoff 状态：

```text
pending
claimed
running
completed
failed
cancelled
unknown
```

`unknown` 表示投递或执行结果不确定，不能自动重复启动可能产生副作用的 Agent。

### Event

Event 是本地服务对可观察状态变化的持久记录，例如：

```text
project.created
task.created
task.completed
artifact.available
artifact.revision_created
handoff.created
handoff.claimed
handoff.completed
artifact.reclaimed
```

Event 是通知和恢复的依据，不是唯一的内容存储。事件中只保存稳定 ID、摘要和必要的状态，不复制完整二进制或敏感正文。

## 4. 本地存储布局

建议的默认根目录：

```text
~/.arkspace/usegpt/
```

这是新 Hub 的数据约定，不是现有 ArkSpace 全局目录的搬迁。现有 `src/config/paths.ts` 使用 `ARKSPACE_HOME`、Windows `APPDATA`、`XDG_CONFIG_HOME` 或 `~/.config/arkspace` 保存全局配置。实现时继续在那里保存 `connections.usegpt`（Hub 路径、凭证引用及限额），不要再写一份 UseGPT `config.json`。默认数据根目录仍为用户已讨论的 `~/.arkspace/usegpt/`；显式 `connections.usegpt.rootDir` 可以覆盖它，所有路径在启动时解析为绝对路径并由 doctor 显示。环境变量 `ARKSPACE_HOME` 只影响现有全局配置定位，不静默移动 Hub 数据。

布局：

```text
~/.arkspace/
└── usegpt/
    ├── data/
    │   ├── index.sqlite
    │   ├── staging/        # 与 objects 同卷的未完成传输
    │   └── objects/
    │       └── sha256/
    │           ├── ab/
    │           │   └── cd/
    │           │       └── <full-sha256>
    │           └── ...
    ├── cache/
    ├── logs/
    └── run/
```

### 配置与数据分离

通过现有 ArkSpace 全局配置管理 Hub 运行参数：

- `dataDir`：可选的大容量数据根目录；默认是 `data/`；
- 单文件大小上限；
- 单任务和单项目配额；
- 回收站保留时间；
- 日志轮转上限；
- 是否启用 MCP App 文件导入；
- 已注册 Agent Adapter；
- 默认项目。

凭证、Tunnel ID 和 API key 仍由现有私密凭证机制管理，不写入任务、事件或产物正文。

### `data/index.sqlite`

SQLite 是任务、项目、产物元数据、引用、Handoff 和 Event 的权威来源。

不同时维护一套等价的 JSON manifest 数据库。需要导出 manifest 时从 SQLite 生成。

### `data/objects/`

真实内容按 SHA-256 保存：

```text
objects/sha256/ab/cd/<hash>
```

文件名不来自用户输入，用户可见名称只存在元数据中。相同字节只保存一次。

`rootDir` 包含 `cache/`、`logs/`、`run/`，默认 `dataDir = rootDir/data`。覆盖 dataDir 时数据库、objects、staging 和 `dataDir/.writer.lock` 一起移动；cache、logs、IPC socket 和 PID 仍在 rootDir。daemon 同时锁 rootDir 和 dataDir，阻止两个根目录指向同一数据目录并发写。dataDir 只接受本地卷，迁移完成前不释放旧数据保护。

`dataDir` 必须是本地受管文件系统目录，SQLite、staging 和正式 objects 必须位于同一受支持卷；覆盖 `dataDir` 时 staging 位于该目录的 `staging/`，而不是继续写旧根目录。避免跨卷 rename 破坏原子提交。首版不支持网络文件系统或多个 daemon 同时写同一个数据目录。

路径变更走显式停服迁移：检查可用空间、复制一致性快照、校验哈希和数据库、切换配置、重启验证；保留旧数据直到用户确认迁移。不可通过修改配置直接遗忘旧目录。

### `data/staging/`

只保存未完成传输：

```text
data/staging/<upload-id>.partial
```

启动时和接收新上传前清理：

- 超过 24 小时；
- 所有者属于当前服务用户；
- 不在活跃上传表中；
- 上传租约已经过期且已经被标记中止。

清理器和接收器在同一上传锁下重新检查租约；仅检查 mtime 不足以证明安全。

### `cache/`

只保存可重新生成的数据，例如缩略图、文本预览、导出包和 MIME 探测缓存。清空 Cache 不得破坏正式产物。

### `logs/`

保存轮转诊断日志。日志不得包含原始 API key、Tunnel 凭证、完整文件正文或未脱敏的下载 URL。

## 5. SQLite 逻辑表

最小表集合：

```text
projects

tasks
task_events

artifacts
artifact_revisions
task_artifacts
project_artifacts
artifact_derivations

blobs

handoffs
handoff_artifacts

outbox_events
uploads

delete_jobs
```

关键字段示意：

```text
projects
  id TEXT PRIMARY KEY
  name TEXT NOT NULL
  description TEXT
  status TEXT NOT NULL
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  deleted_at TEXT

tasks
  id TEXT PRIMARY KEY
  project_id TEXT NOT NULL
  title TEXT NOT NULL
  request_json TEXT NOT NULL
  status TEXT NOT NULL
  created_by TEXT NOT NULL
  created_at TEXT NOT NULL
  completed_at TEXT
  deleted_at TEXT

artifacts
  id TEXT PRIMARY KEY
  project_id TEXT NOT NULL
  owner_task_id TEXT
  name TEXT NOT NULL
  kind TEXT NOT NULL
  media_type TEXT NOT NULL
  status TEXT NOT NULL
  created_by TEXT NOT NULL
  created_at TEXT NOT NULL
  deleted_at TEXT

artifact_revisions
  id TEXT PRIMARY KEY
  artifact_id TEXT NOT NULL
  revision INTEGER NOT NULL
  blob_hash TEXT
  external_url TEXT
  size_bytes INTEGER
  sha256 TEXT
  created_at TEXT NOT NULL
  UNIQUE(artifact_id, revision)

blobs
  sha256 TEXT PRIMARY KEY
  size_bytes INTEGER NOT NULL
  media_type TEXT
  ref_count INTEGER NOT NULL
  state TEXT NOT NULL
  created_at TEXT NOT NULL
  last_referenced_at TEXT
  reclaim_after TEXT
```

`artifact_revisions` 的两种内容形式：

```text
blob_hash       所有本地保存的文本、结构化数据和二进制
external_url    外部链接，仅保存地址和元数据
```

小文本也走同一 Blob 提交路径，避免两套持久化与删除语义。数据库中的摘要只能是派生、可清除的有界缓存。

同一 Revision 只能选择一种内容来源。外部链接不应被误认为本地保存的文件。

每个 Artifact 归属一个 Project，可有一个生产 Task；`owner_task_id` 只记录来源，不授予访问权限。`task_artifacts`、`project_artifacts`、`handoff_artifacts` 引用确定 Revision，并定义保留权。跨项目复用时，在目标项目创建独立 Artifact 身份并显式授权导入；可以共用 Blob，不能通过知道哈希绕过授权。

所有外键启用检查，Revision 唯一且不可变；并发发布用事务分配版本号。`ref_count` 仅作为可重建统计缓存，回收前必须查询真实引用、回收站期限及活跃读取租约。Collection/manifest 的成员关系也保存为显式 Revision 引用，防止只在正文里记录引用导致误回收。

首版只有本机 owner 主体与项目范围，不实现多租户用户管理。`project_members` 是后续多主体扩展候选，不创建空表。

索引必须支持：

- 按项目列任务；
- 按任务列产物；
- 按 Handoff 的接收者列待处理工作；
- 按媒体类型、标签、来源和时间搜索；
- 查找 Blob 当前被哪些 ArtifactRevision 引用；
- 查找删除后仍被其他项目引用的 Blob。

## 6. 产物接收接口

### 小型文本和结构化内容

```text
artifact.publish_inline
```

适合：

- 结论；
- Markdown；
- JSON；
- CSV 文本；
- URL 集合；
- 简短元数据。

流程：

```text
校验 schema 和字节上限
→ UTF-8 编码
→ 计算 SHA-256
→ 写入 staging
→ fsync
→ 原子发布 Blob
→ SQLite 事务提交 ArtifactRevision 和引用
→ 写入 outbox event
```

### ChatGPT Host 原生文件

```text
artifact.import_host_file
```

MCP 工具的文件参数必须标记为：

```json
{
  "_meta": {
    "openai/fileParams": ["file"]
  }
}
```

输入使用 Host 提供的原生 file object。服务端：

1. 只接受受信任的 OpenAI 文件引用形状；
2. 验证 `file_id`、`download_url`、MIME 类型、名称和声明大小；
3. 验证允许的下载域名；
4. 使用有限重定向和超时；
5. 流式写入独占 `.partial` 文件；
6. 限制累计字节数；
7. 检查声明大小与实际大小；
8. 计算 SHA-256；
9. `fsync`；
10. 原子发布 Blob；
11. 写入 Artifact、Revision、任务关系和事件。

服务不接受：

- 用户粘贴的任意下载 URL；
- 本地路径；
- 任意 Azure Blob 地址；
- Base64 大对象直接放进单个 MCP JSON；
- 覆盖已有目标。

### 分块传输

Host 原生文件导入是首版二进制主路径。分块接口只在真实消费者无法使用 Host 文件引用且确有文件传输需求时实现，不要求模型自行生成大量 Base64。

```text
artifact.upload_begin
artifact.upload_chunk
artifact.upload_finish
artifact.upload_abort
```

`upload_begin` 创建 `uploads` 记录和大小预留；`upload_chunk` 需要连续 offset；`upload_finish` 重新验证大小和哈希。未知结果的上传不能自动重放，除非使用同一 `uploadId` 并能证明幂等。

## 7. Agent 接口

本节使用的是逻辑短名。对外能力统一前缀为 `usegpt.`，例如 `usegpt.artifact.read`；所有机器请求通过 `arks invoke usegpt.artifact.read --input <file>` 进入 Protocol v1 dispatcher。MCP 名称转换固定为点替换下划线，采用本节进程合同。

MCP、CLI 和 Skill 共享同一内部 dispatcher，不各自实现业务逻辑。

### 项目和任务

```text
project.create
project.list
project.get
project.archive
project.delete
project.restore
project.purge

task.create
task.list
task.get
task.complete
task.wait
task.cancel
task.delete
task.restore
task.purge
```

### 产物

```text
artifact.list
artifact.describe
artifact.search
artifact.read
artifact.export
artifact.publish_status
artifact.delete
storage.usage
delete.preview
```

小型文本可以由 `artifact.read` 直接返回；图片、视频、PDF、ZIP 等返回 metadata 或短期 MCP ResourceLink，由 `resources/read` 读取真实字节。

`artifact.export` 的授权句柄应：

- 绑定调用方；
- 绑定项目、任务和 Revision；
- 设置短期 TTL；
- 限制并发导出数量；
- 在 `resources/read` 时重新检查权限和元数据；
- 不作为永久 Artifact ID。

### Handoff

```text
handoff.create
handoff.list
handoff.get
handoff.claim
handoff.complete
handoff.wait
handoff.fail
handoff.cancel
```

Agent 默认使用流程：

```text
handoff.list(to=currentAgent, status=pending)
→ handoff.claim
→ task.get
→ artifact.describe
→ artifact.read 或 artifact.export
→ 完成工作
→ artifact.publish_*
→ handoff.complete
```

### CLI

以下是计划中的人类 CLI，不是当前已实现命令；统一保留 `usegpt` 命名空间：

```bash
arks usegpt project list
arks usegpt task list --project project_123
arks usegpt handoff list --to agent:web-builder
arks usegpt handoff claim handoff_123
arks usegpt artifact list --task task_456
arks usegpt artifact describe artifact_123 --revision 2
arks usegpt artifact export artifact_123 --revision 2 --output ./input.png
arks usegpt artifact read artifact_123 --revision 2 --output ./report.md
arks usegpt task delete task_456 --confirm
arks usegpt task restore task_456
arks usegpt task purge task_456 --confirm
```

机器输出继续使用版本化 JSON stdout，日志和进度写 stderr。

### Skill

新增的 Skill 应负责使用流程，而不是复制存储实现：

```text
skills/usegpt/SKILL.md
```

它指导 Agent：

1. 检查待处理 Handoff；
2. 接受 Handoff；
3. 读取 Task 摘要；
4. 先获取 Artifact metadata；
5. 仅按需读取正文或导出二进制；
6. 固定使用 Handoff 指定的 Revision；
7. 提交后续产物；
8. 完成或失败 Handoff。

## 8. 主动触发

产物保存和 Agent 启动是两个不同问题。

### Pull

第一阶段只实现 Pull：

```text
Agent 启动
→ handoff.list
→ handoff.claim
```

这最可靠，也不要求 Agent 常驻。

### 本地 Worker

第二阶段实现 `arks usegpt worker`：

```text
outbox_events
→ arks usegpt worker 领取 handoff
→ 查找已注册 Agent Adapter
→ 启动固定命令或连接现有 Agent
→ 将 handoffId/taskId 传给 Agent
```

Handoff 只能引用注册的 Adapter ID，不能携带任意 shell 命令。Worker 记录：

- adapter；
- worker PID；
- start/stop 时间；
- dispatch accepted/delivered/unknown；
- 最终 Handoff 状态。

### 已连接 Agent

第三阶段可以支持：

```text
agent.register
agent.heartbeat
agent.events
```

断线后 Handoff 仍保留在 SQLite 中；恢复连接后 Agent 重新 Pull。事件通知不能替代数据库状态。

## 9. 历史记录

历史记录以 Event 为基础，按 Project 和 Task 展示：

```text
Task created
ChatGPT session published artifact revision 1
Artifact import completed
Handoff created
Agent claimed handoff
Agent published artifact revision 2
Task completed
```

事件记录：

- 稳定对象 ID；
- 事件类型；
- 调用方类别和稳定 ID；
- 时间；
- 状态变化；
- 有界摘要；
- 错误分类；
- correlation ID。

事件不保存：

- API key；
- Cookie；
- 完整下载 URL 中的凭证部分；
- 完整二进制；
- 默认情况下的全部长正文。

这些记录属于本地任务历史。来源会话 ID 是调用方可提供的相关标识，必须标注 `reported` 或 `host_verified`；不能假设 Apps SDK 总能提供真实 ChatGPT conversation ID。服务生成的 producer session ID 不等于 ChatGPT 内部会话 ID。

完整 ChatGPT 对话不自动进入本地历史。需要保留的结论、文档和数据必须显式发布为 Artifact。

## 10. 删除、归档和回收

### Task 删除

```text
task.delete
→ 标记 deleted
→ 隐藏任务历史和 Handoff
→ 使任务路径下的 Artifact 引用失效
→ 项目共享 Artifact 不受影响
→ 无其他有效引用的 Blob 进入待回收
```

### Project 删除

```text
project.delete
→ 项目进入回收站
→ 项目下任务和 Handoff 隐藏
→ 项目产物引用失效
→ 保留期内可以完整恢复
```

### Purge

```text
project.purge / task.purge
→ 删除逻辑记录和引用
→ 写入 delete_jobs
→ 回收器再次检查引用、回收站和活跃读取
→ 仅回收无人引用的 Blob
```

默认保留策略：

| 数据 | 默认策略 |
|---|---|
| 活跃 Project、Task 和正式 Artifact | 不自动删除 |
| 回收站 Project/Task | 默认 30 天 |
| 失败上传和 partial 文件 | 闲置 24 小时后清理 |
| MCP export 句柄 | 短 TTL，过期自动失效 |
| 预览和导出缓存 | 可随时清理 |
| 诊断日志 | 按大小和时间轮转 |
| 无引用 Blob | 进入宽限期后回收 |

删除前必须检查：

- 活跃上传；
- 活跃 Handoff；
- 正在导出的 ResourceLink；
- 其他 Project/Task/ArtifactRevision 引用；
- 回收站保护期限。

删除是逻辑操作，物理回收异步执行。服务重启后仍能从 `delete_jobs` 恢复回收。

## 11. 失败和恢复语义

### 上传成功但响应丢失

调用方不能盲目重新提交。可以用 `idempotencyKey` 查询：

```text
artifact.publish_status(idempotencyKey)
```

### 文件已落盘但数据库提交失败

启动恢复扫描 staging 和新 Blob：

- staging 中未完成文件按规则清理；
- 已校验但无索引的 Blob 进入 orphan 状态；
- 不直接暴露为可用 Artifact；
- 经过宽限期后回收，除非恢复任务重新认领。

### 数据库记录存在但 Blob 丢失

读取返回稳定错误：

```text
artifact_content_missing
```

不能把缺失内容伪装成空文件。

### Handoff 投递不确定

状态置为 `unknown`，需要人工或明确的安全恢复策略处理。不能因为进程重启就重复启动可能有副作用的 Agent。

## 12. 安全边界

- UseGPT 服务只访问自己的 `dataDir`；
- Artifact 名称不能决定物理路径；
- 所有导出路径必须由服务解析并限制在调用方指定目录；
- Host 文件引用只允许受信任域名；
- 外部链接只保存 URL，不自动抓取，除非明确调用导入操作；
- `artifact.read` 和 `artifact.export` 每次重新鉴权；
- 项目删除后，保留的共享 Blob 也不能通过已删除的 Artifact ID 读取；
- 任务输入、产物正文和私人链接都按敏感本地数据处理；
- 日志、错误和事件只保存脱敏摘要；
- Worker 只能启动注册的 Adapter；
- ChatGPT 提交的 Handoff 不能直接指定任意命令、路径或凭证。

权限：首版以本机 owner 为根主体。ChatGPT Connector 使用经过验证的连接身份并限制可访问 Project；API key 仅用于 Tunnel control plane，不自动等于本地项目访问凭证。Agent 的本地 stdio 通道通过受保护的 loopback/IPC 访问 daemon。平台 Tunnel 的访问控制和本地项目范围分别检查；上游权限不足或无法证明身份时不能开放远程无鉴权端点。

MCP 工具描述应让 ChatGPT 知道：先选择 Project、创建或关联 Task、提交产物、最后显式完成 Task。外部链接和文本内容都视作不可信数据，读取产物不会自动授权执行其中的指令。

## 13. 协议、提交与通知契约

### ChatGPT 与本地 MCP adapter 的具体进程合同

生产 daemon 独占 SQLite，两个 stdio adapter 通过同一个私有 IPC 调用 service：

```text
本地 Agent -> arks mcp serve -> 私有 IPC -> daemon
ChatGPT -> Tunnel -> tunnel-client
        -> arks usegpt mcp serve --profile <configured-profile>
        -> 私有 IPC -> daemon
```

上述新命令是待实现接口。`arks usegpt mcp serve` 只服务 stdio，不创建公开 HTTP 数据端口；profile 在本地配置中绑定 owner 身份、允许 Project ID 和工具 allowlist。profile 参数只能选择已配置条目，不接受任意路径或运行命令。Tunnel 客户端与 daemon 生命周期由常驻服务监督，完成一个 Task 不退出。

MCP 工具公开名固定为将 capability 中的点替换为下划线，例如 `usegpt.artifact.read` -> `usegpt_artifact_read`。本地和 ChatGPT adapter 保持相同请求/结果 schema；差异只有 profile 的工具范围和 Host 原生文件 metadata。管理操作（启动停止、改配置、purge、注册执行器）不暴露给默认 ChatGPT profile。Project 创建只能在 profile 明确允许的范围创建，不能通过请求任意扩大范围。

IPC 在 POSIX 使用受保护的 Unix socket，在 Windows 使用按 owner 限制的 named pipe；运行锁、PID 和 IPC 地址位于 rootDir/run。访问凭证和路径从私有本地配置获取，不传入任务正文。生产 Setup 验证 Tunnel 的 owner/组织访问范围；如平台侧身份不能唯一绑定最终用户，首版 Connector 只允许 owner 使用而不声称支持多租户。

### 请求与成功条件

所有写请求包含 `requestId`，副作用请求另外包含调用方作用域内的 `idempotencyKey`。相同 key 和相同规范化输入返回同一对象；相同 key、不同输入返回 `idempotency_conflict`。文件输入以稳定来源 ID 和目标元数据绑定 key，绝不因签名 URL 更新就无条件发起第二次逻辑发布。

产物 `available` 表示：字节校验完成、Blob 已持久发布、Revision 和关系已提交。Task 的 `completed` 由显式 `task.complete` 设置；有必需上传未完成或必需交接未结束时拒绝完成。允许调用方以 `partial` 结果说明已交付和缺失项，不能把缺失文件当成功。Artifact 可用、Task 完成和 Handoff 完成是三个独立事实。

Artifact 响应返回 `artifactId`、`revision`、`taskId`/`projectId`、`mediaType`、`sizeBytes`、`sha256`、`availability`；不默认返回整个正文。大文本读取支持有界分页，二进制通过流式导出。链接产物标为 `external`，不能声称已存为本地快照。

### 错误与取消

在现有 Protocol v1 错误分类中映射错误，`details.code` 提供稳定子码：`task_deleted`、`project_deleted`、`artifact_content_missing`、`quota_exceeded`、`file_reference_expired`、`size_mismatch`、`idempotency_conflict`、`handoff_busy`、`dispatch_unknown`、`unsupported_host_file`。返回可重试性和具体对象 ID；不泄露下载地址或凭证。

请求超时、用户取消、上传失败、部分产物到达和 Agent 结果未知分开表达。取消下载中止 stream、关闭文件并撤销配额预留；取消 Task 只请求停止已登记执行器，停止是否确认单独记录。丢失网络响应不表示事务回滚。

### 提交与事件

元数据变更与对应 outbox 行在同一个 SQLite 事务提交。事件不包含文件字节；通知只携带对象引用。Outbox 使用递增 cursor，每个消费者有自己的确认位置，语义为至少一次通知；消费者以 event ID 去重。消费者再次读取数据库确认真实状态，不能因收到重复事件就再次执行任务。

Handoff 用原子事务领取，生成 claim token 和 fencing generation；完成必须携带当前 token。租约到期只允许回收“尚未派发”的工作；已派发且结果不明的工作保持 `unknown`，不能自动并发启动另一个 Agent。一个 Handoff 的输入固定到 Revision，后续发布不会修改正在执行的输入。

Task `wait` 和 Handoff `wait` 是有界等待，超时返回 pending 及 cursor，不取消后台任务。无通知的 Agent 可以从上次 cursor 拉取；MCP notification 只是加速提示，Skill 不负责唤醒未运行的 Agent。

### 删除的可恢复与永久范围

软删除不实际删掉 ArtifactRevision 或关系，而是保存删除批次和可见性标记。Task 删除首先撤销该任务入口的读取与引用；Artifact 本身只在没有其他有效 task/project 保留关系时随批次进入回收站。`owner_task_id` 仅保留来源 ID：生产 Task purge 时置空或转成无正文的来源标记，不能用外键 cascade 删除仍由其他 Task/Project 保留的 Artifact。Handoff 领取时持有固定 Revision 的执行保留关系，终止后释放；显式 project 保留关系优先于某个 Task 的删除。

Project 删除时其项目作用域下所有读取被拒绝，跨项目副本有独立 Artifact 身份；它们仍保留共用 Blob。恢复只撤销本次批次添加的删除标记；原先已删除的共享资料仍保持删除。

Project 删除时只覆盖此前未删除的后代；恢复同一批次不会复活用户之前单独删除的 Task。Task 删除不删除项目共享产物，也不删除其他任务显式保留的 Revision。活跃 Handoff 必须先取消并确认终止，或者阻止 purge。

执行 purge 前生成删除计划，列出记录数、逻辑字节数、实际可回收字节数、其他任务引用和阻塞项；计划绑定目标版本，执行时再次检查。必要时由用户明确选择清空该范围；普通内容提交不获得 purge 权限。

回收器在短事务内将无保护引用的 Blob 标记为 reclaiming；新发布相同哈希必须等待、复用已确认存在的对象或重新发布，不能把新引用挂到即将被删的文件。删除后保留可重试 job，失败不伪装为已释放空间。读取先登记短读取租约，流结束后释放；导出句柄存在本身不允许永久阻止回收，过期或失效后新读取被拒绝。

永久清除同时处理任务请求正文、产物元数据、派生预览、全文索引和事件摘要中的敏感字段。共享 Blob 由其他合法引用继续保留。SQLite 空闲页/WAL 的回收、安全擦除和外部备份是不同问题；首版承诺逻辑不可访问和受管文件回收，不承诺 SSD 物理擦除。ChatGPT 端历史、Agent 导出副本和用户备份均不在自动删除范围内。

### 配额、备份与重启

发布前为已知大小预留配额，未知大小预留配置上限；传输结束结算实际大小。并发预留在数据库事务中处理。配额不足先清理过期临时数据，仍不足则拒绝新上传，不静默删正式成果。

备份时暂停发布和回收，创建 SQLite 一致性快照并复制其引用的全部不可变 Blob，写入哈希清单；恢复到新目录后先核对完整性再切换配置。不能在持续写入时随意复制裸 `index.sqlite` 而遗漏 WAL。daemon 持有数据目录独占锁并校验 schema 版本，旧版本拒绝打开较新 schema。

## 14. 实施阶段

实施方案为 [usegpt-artifact-hub-implementation.md](usegpt-artifact-hub-implementation.md)，以该文档的阶段编号和验收标准为准。先实现删除安全的存储基础和已安装入口，再逐步接入 ChatGPT inline、原生文件、Agent Pull 和单个真实 Agent 执行器。

## 15. 验收矩阵

### 内容类型

| 类型 | 接收方式 | 存储方式 | Agent 读取方式 |
|---|---|---|---|
| 小型结论 | inline | UTF-8 Blob | `artifact.read` |
| Markdown | inline | Blob | `artifact.read` |
| JSON/CSV | inline | Blob | `artifact.read` 或导出 |
| 图片 | host file | Blob | `artifact.export` |
| PDF/ZIP | host file | Blob | `artifact.export` |
| 外部链接 | inline metadata | URL metadata | `artifact.read` |
| 多个产物 | manifest/collection | Revision refs | `artifact.list` |

### 生命周期

```text
创建 Project
→ 创建 Task
→ ChatGPT 提交 Artifact
→ 创建 Handoff
→ Agent claim
→ Agent 读取固定 Revision
→ Agent 提交新 Artifact
→ Task complete
→ Task delete
→ restore 或 purge
→ Blob garbage collection
```

### 不确定性

必须分别报告：

- ChatGPT Host 是否暴露该文件为原生 file object；
- 文件下载是否成功；
- Blob 是否完整校验；
- 数据库提交是否成功；
- Handoff 是否已被 Agent 接收；
- Agent 执行是否完成。

这些结果不能合并成一个模糊的“成功”。

## 16. 当前决策

1. CDP 方案放弃，不在本分支继续实现。
2. 新方案基于 `experiment/usegpt-secure-mcp` 的 Secure MCP feasibility evidence。
3. ChatGPT 是成果生产端，本地服务是成果存储和交接端。
4. Project 是长期容器，Task 是执行与历史聚合，Artifact 是版本化逻辑对象，Blob 是真实字节。
5. 正式数据默认存储在 `~/.arkspace/usegpt/`，允许配置独立 `dataDir`。
6. SQLite 保存元数据和历史，content-addressed 文件保存真实内容。
7. 删除 Task/Project 先删除访问关系，再异步回收无人引用的 Blob。
8. MCP、CLI 和 Skill 调用同一个内部 dispatcher。
9. Agent 触发先实现 Pull，再实现受控 Worker；不把任意 shell 命令暴露给 ChatGPT。
10. Secure MCP Tunnel 不被描述为外部唤醒已关闭 ChatGPT 会话的机制。
11. ChatGPT 文件导入必须使用 Host 原生 file reference，并执行流式、限额、校验和原子发布。
12. 任何具体 ChatGPT 能力是否支持文件导入，都必须通过真实 Host 验收单独确认。

## 17. 未决问题

- ChatGPT 各能力产生的图片、PDF、数据文件是否都能绑定到 `openai/fileParams`；
- Host 提供的 file reference 在不同能力和不同 MCP Host 版本中的字段差异；
- 是否需要将外部链接导入为本地快照；
- Project 和 Task 的访问主体是否复用 ArkSpace 当前凭证模型；
- Worker 如何启动具体 Agent，第一种受支持 Adapter 是什么；
- `dataDir` 跨平台路径与现有全局配置规则的实施验证；
- 是否需要加密本地 Blob；
- 任务历史是否提供全文搜索，以及索引哪些正文；
## 18. 源码证据与验证范围

以下为实现证据，不能等价为 ArkSpace 已验证支持所有 ChatGPT 能力：

- DevSpace [`artifact-tools.ts#L92-L140`](https://github.com/Waishnav/devspace/blob/531d3f973f09f7b6b4993c9ff58f80a4514b9ba2/src/artifact-tools.ts#L92-L140)：工具 schema、`openai/fileParams` 与目标文件路径。
- DevSpace [`incoming-artifacts.ts#L116-L201`](https://github.com/Waishnav/devspace/blob/531d3f973f09f7b6b4993c9ff58f80a4514b9ba2/src/incoming-artifacts.ts#L116-L201)：原生文件引用、下载域名、重定向与 streaming。
- DevSpace [`artifact-tools.ts#L183-L250`](https://github.com/Waishnav/devspace/blob/531d3f973f09f7b6b4993c9ff58f80a4514b9ba2/src/artifact-tools.ts#L183-L250)：partial、大小、哈希和发布。
- DevSpace [`artifact-tools.ts#L532-L554`](https://github.com/Waishnav/devspace/blob/531d3f973f09f7b6b4993c9ff58f80a4514b9ba2/src/artifact-tools.ts#L532-L554)：有界闲置临时文件清理。
- WebCodex [`docs/MCP.md#L895-L928`](https://github.com/yyjeqhc/webcodex/blob/93d5911587afbb75b6ecf61051e79583ff59597e/docs/MCP.md#L895-L928)：Host 文件导入、授权资源读取、上传配额与清理。
- WebCodex [`resources.rs#L165-L223`](https://github.com/yyjeqhc/webcodex/blob/93d5911587afbb75b6ecf61051e79583ff59597e/src/mcp/resources.rs#L165-L223)：短期导出 registry。
- WebCodex [`agent_wake.rs#L250-L260`](https://github.com/yyjeqhc/webcodex/blob/93d5911587afbb75b6ecf61051e79583ff59597e/src/agent_wake.rs#L250-L260)：SQLite 持久状态与进程内 continuation adapter 的分离。

上游测试只阅读、未执行；本轮没有在真实 ChatGPT 上测试文件导入。此前用户确认过原生 Host 的文本探针完成，以及先激活 App 再本地 seed 的任务完成；这不证明重复执行、后台常驻、跨会话持久唤醒或任意能力组合已通过。

WebCodex 为 Apache-2.0，DevSpace 为 MIT。复制源码前须按仓库来源规则记录 URL、revision、license、导入范围和适配状态，保留必要声明。本设计仅引用证据，未导入上游代码。
