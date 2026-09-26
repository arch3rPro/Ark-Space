# 08 — W12 零配置/额外凭据源决策（G3/G4）

Status: deferred
Type: decision

Source: [spec W12](../spec.md)、[调研笔记 G3/G4](../../../docs/research/pi-web-access-borrowable-patterns.md)

## Decision

**现在不新增任何凭据源或 provider。** 本票只记录范围决策，不授权实现、配置/schema 变更或默认回退路径变更；无需运行时测试。

- **G3 / ADC：暂缓。** ArkSpace 尚无明确的 Google 能力消费者；不能仅为“零配置”引入 ADC OAuth。若将来出现真实 Google 消费者，另行决策凭据类型、显式启用/优先级、token 刷新与过期/时钟偏差、服务账号 JWT、错误分类及端点绑定，再开实现票。不得隐式读取本机 Google 身份。
- **G4 / DuckDuckGo HTML：暂缓，待明确的产品与法律/合规批准。** 非官方 HTML 抓取没有 SLA，页面/反爬变化及服务条款风险未获批准。即使获批，也须先定义真实搜索消费者、使用范围、失败与降级契约，并对外标注“非官方、尽力而为”；不得作为默认、始终可用的 keyless fallback。

## Revisit gates

- ADC：有具名 Google 消费者及明确凭据需求，完成安全/运维契约评审后另开票。
- DDG HTML：产品负责人和法律/合规明确批准具体用法，确认消费者及风险披露后另开票。未满足前本票保持 deferred。

## Verification

仅校验 Markdown 本地链接与文档一致性；不修改 `src/`、schema、依赖或测试。
