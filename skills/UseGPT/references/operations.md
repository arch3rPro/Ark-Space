# UseGPT 操作参考

## 1. 配置 Tunnel

首次使用或连接失败时，在可信终端运行：

```bash
arks setup usegpt
```

To configure and start both background services in one run, use:

```bash
arks setup usegpt --start
```

填写 Tunnel ID、Artifact Hub 数据目录，并保存 API key。不要把 API key 放进提示词、任务内容、Artifact 或 Handoff。


```bash
arks usegpt status --json
```

## 2. 启动服务

在 ChatGPT 发布结果前，启动 Hub 和 Tunnel：

```bash
arks usegpt daemon start
arks usegpt tunnel start
```

这两个命令都是后台启动，命令返回后可以关闭终端。检查状态：

```bash
arks usegpt daemon status
arks usegpt tunnel status
```

两者都显示 `running: true` 才继续让 ChatGPT 发布结果。

如果 Tunnel 没有启动，先确认配置，再重试：

```bash
arks setup usegpt
arks usegpt tunnel start
```

## 3. 获取 ChatGPT 的任务结果

ChatGPT 完成任务后，按下面顺序找结果：

```bash
arks usegpt project list --json
arks usegpt task list --project-id <project-id> --json
arks usegpt artifact list --project-id <project-id> --task-id <task-id> --json
```

使用用户指定的项目、任务和 Artifact。只有在用户没有提供 ID 时，才根据任务名称和最近更新时间选择，并把选择结果告诉用户。

文本 Artifact 用固定版本读取：

```bash
arks usegpt artifact read <artifact-id> --revision <revision> --json
```

读取结果时确认：

- `availability` 是 `available`。
- 返回的 `revision` 等于请求的 revision。
- `eof` 是 `true`，或继续使用返回的 `nextOffset` 分页。
- 需要报告时引用 Artifact ID、revision、sizeBytes 和 sha256。

Use the built-in export command for binary files:

```bash
arks usegpt artifact export <artifact-id> \
  --revision <revision> \
  --output-dir /tmp/usegpt-export \
  --json
```

It writes to a private temporary subdirectory and verifies size and SHA-256 before reporting success. Use `node scripts/usegpt-verify-file.mjs` only from a source checkout.

The default operation is to retrieve the completed Artifact; do not start a separate Agent worker just to read a result. Use Handoff/worker only when the task explicitly asks another Agent to produce a new Artifact.


如果任务要求 Agent 接着处理，先查看交接：

```bash
arks usegpt handoff list --project-id <project-id> --json
```

再按接收者领取或运行配置好的 Agent worker。Handoff 中的 `artifactRefs` 是固定输入，必须使用其中的 `artifactId + revision`，不能替换成最新版本。

Handoff 完成只表示 Agent 交付已写回 Hub，不代表业务 Task 自动完成。业务确认后再完成 Task。

## 异常处理：先诊断，再操作

遇到“找不到结果”“无法发布”“Tunnel 断开”“Handoff 没有变化”时，按顺序检查：

```bash
arks usegpt status --json
arks usegpt daemon status
arks usegpt tunnel status
```

判断方式：

- 配置错误、API key 缺失或 Tunnel ID 缺失：运行 `arks setup usegpt` 修复。
- Hub 未运行：运行 `arks usegpt daemon start`。
- Tunnel 未运行：运行 `arks usegpt tunnel start`。
- Hub 和 Tunnel 都运行但没有结果：重新列出 Project、Task、Artifact，确认项目 ID、任务 ID、Artifact ID 和固定 revision；不要猜测最新文件。
- Artifact 是 `pending` 或 `failed`：等待 ChatGPT 完成或报告发布错误。
- Handoff 是 `claimed`、`running` 或 `unknown`：检查执行记录和 Handoff 状态，不要自动重复领取或重放。

Tunnel 日志位置：

```text
~/.arkspace/usegpt/.tunnel/tunnel.log
```

诊断结束标准：配置有效、Hub 与 Tunnel 都是 running，并且能按固定 Artifact revision 读取或导出结果；否则报告具体卡在哪一项。
