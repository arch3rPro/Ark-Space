# 05 — MCP/CLI 逐工具启用禁用与可选别名

Status: completed
Type: task

Source: 可借鉴项 W5（I1，可移植部分）— [调研笔记](../../../docs/research/pi-web-access-borrowable-patterns.md)
Depends on: 无

## Context

上游允许逐工具 `enabled=false`、可配置工具名（`^[A-Za-z][A-Za-z0-9_-]{0,63}$`）、以及宿主特有的延迟激活。ArkSpace 侧只有可移植的部分有意义：MCP 客户端自行决定加载哪些工具，「延迟激活/transcript 重建」语义不成立。

## Scope

- [config schema](../../../src/config/schema.ts)：新增逐工具/逐子命令的 `enabled` 开关，以及可选的别名（校验 `^[A-Za-z][A-Za-z0-9_-]{0,63}$`）。
- [MCP server](../../../src/mcp/server.ts)：按配置决定注册哪些工具、使用哪个名称。
- [CLI](../../../src/cli/main.ts)：按配置启用/禁用子命令。
- 默认行为不变：未配置时全部启用、使用现有名称。
- 补配置解析与注册行为的测试。

## Out of scope

- 不做 `web_enable` 式延迟激活、transcript 重建、Pi 版本退化逻辑。
- 不改任何 capability 的实现或协议。

## Acceptance criteria

- [ ] 关闭某工具后，MCP 不再注册它；CLI 不再暴露对应子命令。
- [ ] 别名通过正则校验，非法值 fail-loudly。
- [ ] 未配置时工具集合与名称与现状完全一致。
- [ ] `npm run check` 通过。

## Verification

- `npm test`（配置解析 + 注册行为）。
- MCP 手工检查：`arks mcp serve` 的 tools/list 与配置一致。
