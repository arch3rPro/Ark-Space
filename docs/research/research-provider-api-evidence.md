# Research provider API evidence: Tavily and Exa

Checked against first-party API references and changelogs on 2026-09-09. This note evaluates provider contracts for a cited, long-form Research capability; it does not prescribe the legacy ArkSpace runtime architecture.

## Decision summary

- **Tavily:** use its native asynchronous Research API: create with `POST https://api.tavily.com/research`, then poll `GET https://api.tavily.com/research/{request_id}`, or request an SSE stream at creation. It directly returns a cited report and source list.
- **Exa:** use the asynchronous Agent API for long-form research: create with `POST https://api.exa.ai/agent/runs`, then poll `GET https://api.exa.ai/agent/runs/{id}` or consume/replay events. It has explicit lifecycle, cancellation, graceful stop, deletion, structured output, and field-level grounding.
- **Do not model Exa Research on legacy ArkSpace `/answer`.** `/answer` remains a current, synchronous-or-streaming answer endpoint, but it has no durable run lifecycle or cancellation surface. The current Agent API is the purpose-built long-running workflow.
- Provider-neutral orchestration should preserve provider request IDs, distinguish submission from polling, map provider statuses without losing the raw status, store authoritative citations separately from prose, and treat create retries as potentially duplicating work.

## Tavily Research API

### Endpoint, authentication, and lifecycle

The current OpenAPI documents:

| Operation | Contract |
| --- | --- |
| Create | `POST https://api.tavily.com/research` |
| Poll | `GET https://api.tavily.com/research/{request_id}` |
| Stream | `POST /research` with `stream: true`, returning SSE |
| Auth | `Authorization: Bearer <Tavily API key>` and JSON request content |

A non-streaming create returns HTTP `201` with `request_id`, `created_at`, initial `status`, `input`, `model`, and `response_time`. Polling returns HTTP `202` while status is `pending` or `in_progress`; HTTP `200` carries terminal status `completed` or `failed`. The documented Research API index contains create, get-status, and streaming operations, but no task cancel, stop, or delete operation.

Sources: [Create Research Task API/OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research.md), [Get Research Task Status API/OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research-get.md), [Research streaming reference](https://docs.tavily.com/documentation/api-reference/endpoint/research-streaming.md), [official documentation index](https://docs.tavily.com/llms.txt).

### Request options and bounds

`input` is the only required body field. The current OpenAPI documents these optional controls:

- `model`: `mini`, `pro`, or `auto`; default `auto`. `mini` targets narrow work, while `pro` targets comprehensive, multi-angle work.
- `stream`: boolean; default `false`.
- `citation_format`: `numbered`, `mla`, `apa`, or `chicago`; default `numbered`.
- `include_domains`: at most 20 domains. This is a **soft preference**, so other domains may still appear; matching includes subdomains.
- `exclude_domains`: at most 20 domains. This is a **hard blocklist** and blocks the named domain and its subdomains.
- `output_length`: `short`, `standard`, or `long`; default `standard`. The documentation calls these targets, not hard caps.
- `output_schema`: a constrained schema object that must contain `properties` and may contain `required`. Property types are limited by the documented schema to `object`, `string`, `integer`, `number`, and `array`; property definitions require `type` and `description`.
- `files`: at most five `.txt`, `.md`, or `.json` attachments, each represented by `name`, base64 `data`, and optional `type: "base64"`. Each text file and all files combined are limited to 80,000 words.

The reference states no minimum/maximum length for `input`. Therefore a client should not invent a provider limit; it may apply its own product-level guardrails while preserving the distinction from an official API bound.

Source: [Tavily Create Research Task OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research.md).

### Result and citation shape

A completed poll response requires:

- `request_id`, `created_at`, `status: "completed"`, `response_time`;
- `content`, either a report string or an object when `output_schema` was requested;
- `sources`, an array whose documented item fields are `title`, `url`, and `favicon`;
- optional `usage`, described as credit usage (example: `{ "credits": 16 }`).

A failed terminal response requires `request_id`, `status: "failed"`, and `response_time`, and may include usage. Pending/in-progress responses are intentionally smaller. The prose report carries citations in the selected `citation_format`; the separate `sources` array is source metadata rather than passage-level grounding and does not document snippets or offsets.

Sources: [Tavily Get Research Task Status OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research-get.md), [Tavily Create Research Task OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research.md).

### Errors, cancellation, and safe retry

The create OpenAPI lists `400` invalid request, `401` missing/wrong key, `429` rate limit, `432` key/plan limit, `433` pay-as-you-go limit, and `500` server error. The poll OpenAPI lists `401`, `404`, and `500`. Neither reference documents an idempotency key or a create-request deduplication token.

Safe operational implications:

- Polling `GET /research/{request_id}` is observational and can be retried with bounded exponential backoff and jitter.
- A `400` or `401` should not be retried unchanged. `432` and `433` require an account/limit change. A `429` should be delayed rather than rotated immediately into another create.
- A transport failure or `500` after create is **ambiguous**: the server may have accepted a task before the client lost the response. Because no idempotency mechanism is documented, blind POST retry can create duplicate billable research. Preserve any received `request_id`; otherwise surface an uncertain-submission result or retry only under an explicit duplicate-work policy.
- There is no documented task-cancellation endpoint. Stopping an SSE client or stopping local polling must not be represented as provider-side cancellation.

Sources: [Tavily Create Research Task OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research.md), [Tavily Get Research Task Status OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research-get.md), [Tavily Research streaming reference](https://docs.tavily.com/documentation/api-reference/endpoint/research-streaming.md).

### Deprecation status

The current Research create/get references contain no deprecation markers for the endpoints or fields above, and the current Tavily changelog does not announce retirement of this Research API. This is evidence of the present documented contract, not a promise of permanence.

Sources: [Tavily Research OpenAPI](https://docs.tavily.com/documentation/api-reference/endpoint/research.md), [Tavily changelog](https://docs.tavily.com/changelog.md).

## Exa Agent API

### Endpoint, authentication, and lifecycle

The current Agent reference documents:

| Operation | Contract |
| --- | --- |
| Create | `POST https://api.exa.ai/agent/runs` |
| List | `GET /agent/runs` |
| Poll | `GET /agent/runs/{id}` |
| Cancel immediately | `POST /agent/runs/{id}/cancel` |
| Gracefully stop | `POST /agent/runs/{id}/stop` (only beta `max` effort) |
| Delete stored run | `DELETE /agent/runs/{id}` |
| Events/replay | `GET /agent/runs/{id}/events` |

Authentication may use `x-api-key: <key>` or `Authorization: Bearer <key>`. Create returns an `agent_run` object immediately unless `Accept: text/event-stream` requests SSE. The documented state machine is:

```text
queued -> running -> completed | failed | cancelled
```

Those three terminal states are paired with terminal `stopReason` values `schema_satisfied`, `budget_reached`, `stopped`, `error`, or `cancelled`; queued/running uses `null`. Runs stop after a documented one-hour timeout. Polling and stored-event GETs provide asynchronous recovery; `previousRunId` creates a **new** follow-up run rather than reusing the prior ID.

Sources: [Exa Agent overview](https://exa.ai/docs/reference/agent-api/overview.md), [Create a run API/OpenAPI](https://exa.ai/docs/reference/agent-api/create-a-run.md), [Get a run API/OpenAPI](https://exa.ai/docs/reference/agent-api/get-a-run.md), [List/replay run events](https://exa.ai/docs/reference/agent-api/list-run-events.md).

### Request options and bounds

`query` is required and has `minLength: 1`; the reference does not document a maximum query length. Optional fields include:

- `systemPrompt` for source preferences and other behavior guidance;
- `input.data` records to process/enrich and `input.exclusion` records/entities to avoid;
- `outputSchema`, supporting JSON Schema draft-07, 2019-09, and 2020-12;
- `effort`: `minimal`, `low`, `medium`, `high`, `xhigh`, `auto`, or `max`; default `auto`;
- `previousRunId`, constrained to 1–200 characters and pattern `^[A-Za-z0-9_.:-]+$`;
- string-valued `metadata` for caller tracking (not documented as a deduplication mechanism);
- up to five `dataSources` for Exa Connect;
- `budget.maxCostDollars` for metered `auto` and `max`: accepted range $1–$100, subject to a lower server-configured maximum; default cap $5 for `auto` and $20 for `max`. Fixed efforts do not accept a budget.

`max` is public beta and requires `Exa-Beta: agent-max-effort-2026-07-27`. The overview documents 50 concurrent runs. Starting a run past that limit returns `429` with `CONCURRENCY_LIMIT_REACHED`. A create counts as two account-QPS requests, so starts are limited to half the account QPS (default example: five starts/second for 10 QPS). Status/event/list GETs do not count against QPS.

Sources: [Exa Create a run OpenAPI](https://exa.ai/docs/reference/agent-api/create-a-run.md), [Exa Agent guide](https://exa.ai/docs/reference/agent-api-guide.md), [Exa Agent overview: limits and effort](https://exa.ai/docs/reference/agent-api/overview.md).

### Result and citation shape

A run object includes `id`, `status`, `stopReason`, timestamps, the canonicalized `request`, `output`, `usage`, and `costDollars`. The output contract is:

- `output.text`: natural-language answer/summary;
- `output.structured`: JSON shaped by `outputSchema`, or `null` without a schema;
- `output.grounding`: field-level grounding entries.

Each grounding entry contains:

- `field`: the supported output path;
- `citations`: entries with required `url` and optional `title`;
- optional model-reported `confidence`: `low`, `medium`, `high`, or `null`.

The guide explicitly says streaming `agent_run.source.added` events are previews, not a complete citation list; terminal `output.grounding` is authoritative. It also warns that unsupported structured fields may be returned as `null` even when the caller's schema marks them required/non-nullable. Therefore consumers must validate evidence-required fields themselves rather than treating `schema_satisfied` as strict validation against the submitted schema.

Usage includes non-negative `agentComputeUnits`, search count, email count, phone-number count, and data-source usage. `costDollars` provides total and per-component amounts.

Sources: [Exa Get a run OpenAPI](https://exa.ai/docs/reference/agent-api/get-a-run.md), [Exa Agent overview: output](https://exa.ai/docs/reference/agent-api/overview.md), [Exa Agent guide: streaming and completed output](https://exa.ai/docs/reference/agent-api-guide.md).

### Cancellation, stopping, deletion, and retention

- **Cancel:** `POST /agent/runs/{id}/cancel` immediately terminates an active run without results, yielding `status: "cancelled"` and `stopReason: "cancelled"`. Usage accrued before cancellation is billed. Repeating cancel after any terminal state returns the existing run unchanged.
- **Stop:** `POST /agent/runs/{id}/stop` asks an active run to wrap up with partial results, yielding `status: "completed"` and `stopReason: "stopped"`. It is supported only for beta `max` runs and requires the beta header. Repeating after a terminal state returns the existing run unchanged.
- **Delete:** `DELETE /agent/runs/{id}` removes stored history and returns `{ id, object: "agent_run.deleted", deleted: true }` on success.
- **Zero Data Retention:** when ZDR is enabled per team, streamed output cannot be retrieved after completion. Non-streamed async results are available for polling for up to ten minutes and are then immediately deleted; `previousRunId` and Connect `dataSources` are unavailable under the documented ZDR constraints.

Sources: [Cancel a run](https://exa.ai/docs/reference/agent-api/cancel-a-run.md), [Stop a run](https://exa.ai/docs/reference/agent-api/stop-a-run.md), [Delete a run](https://exa.ai/docs/reference/agent-api/delete-a-run.md), [Exa Agent guide: Zero Data Retention](https://exa.ai/docs/reference/agent-api-guide.md).

### Errors and safe retry

The create OpenAPI documents `400`, `401`, `429`, and `500`; structured codes include `INVALID_REQUEST`, `TEAM_NOT_FOUND`, `RUN_NOT_FOUND`, `PREVIOUS_RUN_NOT_FOUND`, `PREVIOUS_RUN_NOT_COMPLETED`, `CONCURRENCY_LIMIT_REACHED`, `INVALID_OUTPUT_SCHEMA`, `INVALID_DATA_SOURCE`, `TIMEOUT`, and `SERVER_ERROR`. The current create schema documents no idempotency key/header.

Safe operational implications:

- Polling GETs are explicitly outside Agent QPS and can be retried with backoff/jitter.
- On `CONCURRENCY_LIMIT_REACHED`, wait for an existing run to finish; immediate repeated creates cannot succeed while the limit remains saturated.
- Do not retry invalid schema/input/auth errors unchanged. Treat `TIMEOUT`/`SERVER_ERROR` as potentially transient, but distinguish a returned failed run from an ambiguous create transport failure.
- A lost create response is duplication-sensitive because no create idempotency contract is documented. Caller `metadata` can aid reconciliation but is not documented to suppress duplicates.
- Cancel and stop are explicitly terminal-state stable, so repeating them for a known run ID is safe at the API-state level. Deletion is not documented as repeat-idempotent; after an ambiguous delete result, confirm with GET before deciding whether to retry.

Sources: [Exa Create a run OpenAPI](https://exa.ai/docs/reference/agent-api/create-a-run.md), [Exa Agent overview: limits](https://exa.ai/docs/reference/agent-api/overview.md), [Cancel a run](https://exa.ai/docs/reference/agent-api/cancel-a-run.md), [Stop a run](https://exa.ai/docs/reference/agent-api/stop-a-run.md), [Delete a run](https://exa.ai/docs/reference/agent-api/delete-a-run.md).

### Deprecations and adjacent endpoints

Exa's April 2026 changelog says the old Exa **`/research` endpoint was removed** and replaced by `/search` with `type: "deep-reasoning"`. This is distinct from both `/answer` and the newer Agent API. The June 2026 changelog introduced Exa Agent as a frontier web-research API with `query`, `effort`, `outputSchema`, and `input.data`.

The current `/answer` OpenAPI remains published and is not marked deprecated. It accepts required non-empty `query`; optional `stream`, `text`, `systemPrompt`, `userLocation`, Draft-07 `outputSchema`; and `model` values `exa`, `exa-pro`, `exa-research`, or `exa-fast` (default `exa`). A non-streaming `200` returns `answer` (string or schema-shaped object), optional `requestId`, `citations`, and `costDollars`. Citation entries require `title` and `url` and may include `publishedDate`, `author`, document `id`, `image`, `favicon`, and requested full `text`. `/answer` is useful for a one-shot answer but does not expose durable polling/cancel/delete semantics.

Sources: [Exa changelog: API deprecation notice and Agent introduction](https://exa.ai/docs/changelog.md), [Exa Answer API/OpenAPI](https://exa.ai/docs/reference/answer.md), [Exa Agent overview](https://exa.ai/docs/reference/agent-api/overview.md).

## Comparison with legacy ArkSpace behavior

This comparison describes the existing repository implementation only; it is not a design endorsement.

### Legacy Tavily `/research`

`skills/web-research/scripts/tavily_research.py` already posts `input` plus selected `model`, `citation_format`, domain filters, `output_length`, and `output_schema` to `/research`, optionally polling `/research/{request_id}`. It terminates local polling only on `completed` or `failed` and normalizes `content`, `sources`, `usage`, and timing fields.

Gaps relative to the current official contract:

- it does not expose `stream` or file attachments;
- it treats stopping local wait as timeout, with no provider-side cancellation (correctly, since Tavily documents none);
- it does not use HTTP `202` versus `200` as lifecycle evidence;
- it cannot reconcile an ambiguous create or prevent duplicate POST retries;
- its generic source normalization should not imply passage-level grounding, because Tavily documents only title/URL/favicon source metadata.

### Legacy Exa `/answer`

`skills/web-research/scripts/exa_answer.py` sends only `{ "query": ... }` to `/answer`, waits synchronously, and normalizes fallback answer fields plus `sources`/`citations` and a request ID. It labels that one-shot operation as `deep_research`.

Gaps relative to current Exa capabilities:

- it does not expose `/answer` options such as model, streaming, structured output, system prompt, location, full citation text, or cost;
- more importantly, it has no durable run ID lifecycle, polling, terminal-state model, cancellation, graceful stop, deletion, event replay, effort/budget controls, or authoritative field-level grounding;
- mapping current long-form Research to Agent runs avoids pretending a synchronous answer request has lifecycle guarantees it does not provide.

Legacy source files inspected: `skills/web-research/scripts/tavily_research.py`, `skills/web-research/scripts/exa_answer.py`, `skills/provider-manager/scripts/arkspace_runtime/tavily_client.py`, and `skills/provider-manager/scripts/arkspace_runtime/exa_client.py`.

## Provider-neutral contract implications

A future Research capability can stay provider-neutral without flattening away evidence:

1. Return a submission record with provider, raw provider ID, normalized state, raw state, and whether completion is available by poll or stream.
2. Normalize Tavily `pending`/`in_progress` and Exa `queued`/`running` into nonterminal states while preserving raw values; terminal states must retain failure versus cancellation.
3. Represent cancellation support as a capability flag. Tavily is `none`; Exa supports destructive cancel, and beta `max` additionally supports partial-result stop.
4. Preserve both report content and structured citations. Tavily has report citations plus a source list; Exa Agent has authoritative field-level grounding. Do not coerce them into a falsely identical citation model.
5. Treat create as non-idempotent unless a provider later documents an idempotency mechanism. Apply automatic retries freely only to observational GETs and explicitly terminal-stable cancel/stop operations.
6. Surface timeout as the caller's observation, not as proof the provider task stopped. This is essential for Tavily, where no cancel endpoint is documented, and for Exa when the caller has not issued cancel.
