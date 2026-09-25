# 04 — 表驱动契约证据与入口级测试形态

Status: ready
Type: task

Source: 可借鉴项 W4（K1, K2）— [调研笔记](../../../docs/research/pi-web-access-borrowable-patterns.md)
Depends on: 无（与 01 有重叠，可同批实施）

## Context

ArkSpace 已有成熟的 provider API 证据约定（`docs/research/*-api-evidence.md`）与分层测试命令；上游的贡献是**把证据与可执行探测脚本放同一目录，让证据可复现**，以及**测试只桩边界、不 mock 内部模块**（把入口当扩展加载、覆盖 `globalThis.fetch`、用临时目录隔离配置）。

## Scope

- 审查现有 provider 契约测试与证据笔记的对应关系，找出「有结论但不可复现」的条目。
- 为至少一个有真实边界的 provider 增加可复现的探测记录 + 固定夹具（探测脚本与证据放到同一约定位置）。
- 在 `tests/` 补一个入口级用例：通过真实入口路径（`arks invoke` 或 MCP）验证行为，只桩边界（fetch/子进程），不 mock 内部模块。
- 沿用 ArkSpace 现有分层（`check` / `test:e2e`），不替换测试框架。

## Out of scope

- 不做上游的 esbuild externals 派生与发布包装器（K3 与 ArkSpace no-mirror 原则有张力，另议）。
- 不运行新的真实付费 API 探测，除非明确选定 provider 并由用户确认成本。

## Acceptance criteria

- [ ] 至少一条 provider 契约结论可在仓库内复现（探测脚本 + 证据同目录）。
- [ ] 存在一个入口级测试，仅桩边界，断言真实调用路径行为。
- [ ] 新增/记录的命令都存在于 `package.json` 或脚本中（不记录不存在的命令）。
- [ ] `npm run check` 通过。

## Verification

- `npm test` 与被固定的探测入口。
- `npm run validate`（文档/命令一致性）。
