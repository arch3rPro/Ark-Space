# Bounded Research execution

- **Status:** proposed
- **Class:** architecture

## Problem

ArkSpace needs cited multi-source synthesis rather than another spelling of Search. Current Provider contracts differ: Exa Agent and Tavily Research are asynchronous, Exa exposes cancellation, Tavily does not document cancellation, and each Provider uses different quality controls and citation shapes.

A local timeout after remote submission does not prove that paid work stopped. Returning prose without separately structured source evidence also makes citation verification unreliable.

## Proposal

Add Protocol v1 capability `research.run` with a bounded synchronous local contract:

- accept a research prompt, `concise | standard | deep` depth, a 10-second to 30-minute timeout, and an optional Provider;
- map depth to documented Provider controls: Exa `low | medium | high` effort and Tavily `mini | auto | pro` model;
- use Exa `POST /agent/runs` plus `GET /agent/runs/{id}` and Tavily `POST /research` plus `GET /research/{request_id}`;
- keep the CLI attached until completion, terminal failure, confirmed cancellation, or an honestly reported uncertain remote state;
- return the report, normalized unique sources, optional field-level grounding, terminal status, stop reason, usage, cost, and remote Job ID;
- preserve attempts and lifecycle evidence independently from report data.

The default Provider order is the configured order filtered to Exa and Tavily. Exa Agent replaces the legacy Exa `/answer` adapter for this capability because Agent supplies durable long-running lifecycle and grounding.

A network, server, or invalid-response failure during submission is marked `acceptance-unknown` and unsafe to retry because neither Provider documents create idempotency.

When Exa polling fails or the local operation is interrupted, call `POST /agent/runs/{id}/cancel` with an independent cleanup timeout. A confirmed terminal response makes fallback safe; a completed response is returned as success. When Tavily polling fails after submission, return the request ID with `safeToRetry: false` because no cancellation endpoint is documented. Terminal `failed` or `cancelled` states are safe to report or fall back from because the remote task is no longer running.

Protocol version 1 does not expose detached submission, status, resume, streaming, file upload, structured Research output, Exa Connect, previous-run continuation, or Provider-specific budget controls.

## Consequences

Research has higher latency and cost than Search. Callers must choose it only when they need synthesis across sources. `concise`, `standard`, and `deep` are quality/cost intent rather than identical Provider behavior.

A caller may receive failure with a remote Job ID that must be inspected manually. ArkSpace never represents uncertain cancellation as completed cleanup and never starts a fallback that could duplicate possibly-running work.

Sources remain separate from generated prose. Consumers must verify that important claims are supported by the returned URLs rather than treating Provider-generated citation formatting as proof.

## Alternatives considered

**Keep using Exa `/answer`.** Rejected for Research because it is an answer endpoint without durable run cancellation or asynchronous ownership semantics.

**Expose every Provider option.** Rejected because Provider-specific models, budgets, file inputs, schemas, and streaming would make fallback semantically dishonest.

**Return immediately with a Job ID.** Deferred because durable detached ownership requires status, resume, expiry, persistence, and operator-facing cleanup commands.

**Retry Tavily after any polling timeout.** Rejected because the original request may still be running and billed.

**Parse citations only from report Markdown.** Rejected because Provider source and grounding fields are the authoritative machine-readable evidence.

## Acceptance criteria

1. Both adapters use current official asynchronous endpoints and authenticate without exposing keys.
2. Polling reaches only the Job URL derived from ArkSpace's configured Provider base URL and returned identifier.
3. Exa interruption awaits confirmed cancellation before fallback; failed cancellation suppresses fallback.
4. Ambiguous submission failures suppress automatic retry even when no Job ID was received.
5. Tavily post-receipt failures suppress key rotation and fallback and expose the request ID.
6. Completed output contains a non-empty report and valid HTTP(S) source URLs when sources are returned.
7. Built CLI tests cover `arks research run` and `arks invoke research.run` through the real entry path.
