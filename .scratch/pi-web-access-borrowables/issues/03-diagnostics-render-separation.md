# 03 — 诊断渲染与主结果分离（纯 plan 函数）

Status: ready
Type: task

Source: 可借鉴项 W3（H3）— [调研笔记](../../../docs/research/pi-web-access-borrowable-patterns.md)
Depends on: 无

## Context

上游把错误/取消的展示**计划**抽成不依赖 theme/ANSI 的纯函数 `buildSearchErrorPlan`，UI 层只负责着色与组件，因此计划本身可单测。ArkSpace 无 TUI，但 `AGENTS.md` / `architecture.md` 已要求 **stdout 机器 JSON 与 stderr 诊断分离**。同一解耦适用于 stderr 诊断/进度。

## Scope

- 把 stderr 诊断/进度格式化抽成纯函数（无 ANSI、无宿主耦合），落在 `src/errors/` 或 `src/cli/`。
- 适配层只做字符串输出，不含可测业务逻辑。
- 确保 stdout 仍是唯一 Protocol v1 JSON envelope，不因重构改变。
- 为纯函数补单测。

## Out of scope

- 不移植上游的展开交互（`app.tools.expand`，Pi TUI 专属）。
- 不改机器可读的 protocol `warnings` / `correction`。

## Acceptance criteria

- [ ] 诊断计划为纯函数，单测可直接断言输出字符串/结构。
- [ ] 无 ANSI/theme 依赖进入纯函数。
- [ ] stdout 输出与重构前一致（现有契约测试通过）。
- [ ] `npm run check` 通过。

## Verification

- `npm test`。
- 真实入口检查：`arks invoke <capability> --input <file>` 的 stdout 仍为单个 JSON envelope（现有测试覆盖）。
