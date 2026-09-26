# 09 — W13–W16 后续能力准入复核

Status: deferred
Type: decision

## Decision

暂不实现 W13–W16：当前没有足够真实消费者证明这些能力应进入公共 Protocol v1 或共享 runtime。

- **W13 代理传输与脱敏**：当前 Provider 使用标准 `fetch`，没有 ArkSpace-owned 代理传输契约。不要仅为读取环境代理变量而引入 `curl` 子进程、临时文件或新的并发/清理语义。若出现需要，先定义代理认证、`NO_PROXY`、DNS/SSRF、凭据脱敏和清理证据。
- **W14 多候选配置路径探测**：当前 `ARKSPACE_HOME`、XDG 和 Windows `APPDATA` 已提供明确的单一生效路径；增加隐式候选路径会制造“实际修改了哪个配置”的歧义。保留现状，继续由 `arks doctor` 报告生效配置路径。
- **W15 有界并发**：当前 `web.fetch` 的本地路径明确限制为单 URL，远程 Provider 调用按顺序执行；没有需要并发的公共输入。不要提前加入并发池或 `all` 路由。若未来扩大为多 URL，先定义 key-pool 原子领取、总预算、部分结果和取消语义。
- **W16 PDF/视频/帧抽取**：当前产品切片是文本 Web 检索，没有已确认消费者；`unpdf`、`ffmpeg`、`yt-dlp` 和额外付费 Provider 均应保持 Skill-local、显式依赖，直到有具体需求。

## Re-entry criteria

重新打开本工单需要至少一个具体消费者、输入/输出契约和验证环境。实现前分别补充 ADR 或工单，禁止把未验证的能力提前注册到公共 Protocol v1。

## Verification

本决策不修改 runtime。现有 `npm run check` 与 `arks doctor --json` 覆盖当前配置路径和协议回归；宿主测试仍需本机安装 `claude` 命令。
