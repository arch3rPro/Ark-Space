# Remote job receipts and retry safety

- **Status:** proposed
- **Class:** architecture

## Problem

Some Provider operations return a remote Job receipt before the result exists. A later polling failure does not prove that the remote work stopped. Ordinary key rotation or Provider fallback could submit the same paid operation again while the first Job remains active.

Firecrawl Crawl and Extract have different cleanup contracts. Crawl documents a cancellation endpoint. Extract documents status polling but no cancellation endpoint.

## Proposal

Treat receipt creation as the boundary between retry-safe setup and owned remote work.

Before a receipt, normal error classification, key rotation, and fallback apply. After a receipt:

- an operation with confirmed cancellation may retry only after cleanup reaches a terminal success;
- an operation without confirmed cancellation sets `safeToRetry: false`;
- the shared executor stops key rotation and fallback when `safeToRetry` is false;
- attempt evidence carries the remote resource type, Job ID, and `possibly-running` state;
- the public correction tells callers to inspect that Job instead of submitting a duplicate.

A Provider's generic retryable error category remains distinct from operation-level retry safety. The public `retryable` value is false whenever either condition forbids retry.

## Consequences

Firecrawl Crawl awaits `DELETE /v2/crawl/{id}` after timeout or a non-terminal polling failure and reports cancellation independently from the primary failure. Firecrawl Extract cannot make the same cleanup guarantee, so a post-receipt failure returns the Job ID and suppresses automatic retry.

This design avoids duplicate cost and work but may require manual Provider-dashboard inspection. Protocol version 1 does not offer detached Job resume commands.

## Alternatives considered

**Apply ordinary fallback after every polling failure.** Rejected because a second key or Provider can duplicate paid work that is still running.

**Hide the remote Job and return a generic timeout.** Rejected because it represents uncertain ownership as clean failure and gives operators no recovery evidence.

**Refuse to implement Extract until cancellation exists.** Rejected because bounded synchronous waiting is useful when completion succeeds, and the unsafe settlement path can be represented honestly.

**Add durable detached Job management now.** Deferred because it requires persistence, resume, expiry, and explicit operator ownership beyond the current bounded retrieval slice.

## Acceptance criteria

1. Post-receipt failures without confirmed cleanup never rotate keys or fall back.
2. Attempt evidence exposes the remote Job and uncertain state without exposing credentials.
3. Cancellable Jobs await cleanup and report cleanup success independently.
4. Tests prove that two configured keys still produce one remote Extract submission after a polling failure.
5. User-facing guidance distinguishes retryable Provider failures from unsafe duplicate operations.
