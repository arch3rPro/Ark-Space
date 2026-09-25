# 01 — 错误分类器完整性与表驱动回退测试

Status: ready
Type: task

Source: 可借鉴项 W1（H1, H2）— [调研笔记](../../../docs/research/pi-web-access-borrowable-patterns.md)
Depends on: 无

## Context

ArkSpace 已有分类回退：`fallbackOn`、`FAILURE_KINDS`、以及 `executeWithProviders` 中「仅当 `fallbackOn` 含该 kind 才换 provider」的逻辑（[provider-execution.ts](../../../src/capabilities/provider-execution.ts)、[provider-error.ts](../../../src/errors/provider-error.ts)）。调研发现上游的贡献是**分类器完整性 + 表驱动测试固定行为**：把 HTTP 状态、错误文本、provider 特例映射为类别，并逐条写测试，避免回退策略随 provider 文案漂移而静默改变。

## Scope

- 对照上游的类别集合（`credential/aborted/unsupported/quota/auth/invalid-request/transient/invalid-response/network/config/unknown`）审计 ArkSpace 的 `FAILURE_KINDS` 与 `correctionFor`，找出未覆盖或映射可疑的类别。
- 在 `tests/` 增加表驱动用例：给定 status / 错误文本 / provider 特例 payload，断言归类结果，并断言 `fallbackOn` 门控（未列出的类别不回退）。
- 固定「显式 `input.provider` 严格失败、绝不回退」的具名测试。
- 若审计发现真实缺口，修复分类；否则只补测试，不改行为。

## Out of scope

- 不做上游 `all` 多 provider 并发、数组 provider 合并语义。
- 不改 Protocol v1 的 envelope 字段。
- 不新增 provider。

## Acceptance criteria

- [ ] 每个 `FAILURE_KIND` 至少有一条夹具与断言。
- [ ] `fallbackOn` 子集行为有测试：列出的类别回退、未列出的不回退。
- [ ] 显式 provider 严格失败有具名测试。
- [ ] 错误文本→类别的映射改动都有对应测试固定。
- [ ] `npm run check` 通过。

## Verification

- `npm test`（Vitest，含新增用例）。
- 如改动分类：`npm run check`，并确认无测试因文案变化而需放宽断言。
