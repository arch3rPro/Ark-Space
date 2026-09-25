# 02 — 可取消等待与独立清理截止时间

Status: ready
Type: task

Source: 可借鉴项 W2（C2）— [调研笔记](../../../docs/research/pi-web-access-borrowable-patterns.md)
Depends on: 无

## Context

ArkSpace 已把「超时、取消、部分输出、重试、回退」列为独立结果，并在 `provider-execution.ts` 用 `AbortSignal.any([timeout, signal])`。调研补充：当某个 provider 调用**无法真正取消**时，仍要保证调用方按时返回，并让清理成为独立、可报告的结果（上游 `awaitWithAbort` = `Promise.race`）。风险是「已放弃等待但底层仍在跑」造成资源/计费泄漏。

## Scope

- 在 [provider-execution.ts](../../../src/capabilities/provider-execution.ts) 引入/确认「可取消等待」语义：即使被等待的 promise 不观察 `AbortSignal`，调用方也能在截止时间返回。
- 把清理结果建模为独立字段（`AttemptEvidence.cleanup` 已存在），区分「主失败」与「清理是否确认」。
- 核心为 `Promise.race` 模式，**不引入新依赖**（上游 `promise.try` 只是类型声明）。
- 补测试：provider promise 永不 settle 时仍在截止时间返回，且清理证据如实记录。

## Out of scope

- 不接入本地子进程工具（属后续批次）。
- 不改协议 envelope 形态，仅使用既有 `attempts` 字段。

## Acceptance criteria

- [ ] 一个永不 settle 的 provider 调用在截止时间返回，不挂起。
- [ ] 超时/取消后清理结果独立记录，未确认时不冒充清理成功。
- [ ] 无新运行时依赖。
- [ ] `npm run check` 通过。

## Verification

- `npm test`（新增超时/取消用例）。
- 手工核对一次失败路径的 `attempts` 输出，确认 cleanup 字段语义。
