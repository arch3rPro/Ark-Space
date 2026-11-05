# X search through a user-owned Nitter instance

Status: proposed; ADR 0026 written; source implemented, real instance unverified. Upstream: https://github.com/xiaoY233/nitter @ bb5a0bc3e9297fe47acc701107f065585e2b6575 (2026-11-05), AGPL-3.0, owned by the user. Only its HTTP API contract is used; no source is copied.

## User task and completion
An Agent reads public X content (search, thread, profile, timeline) through the user's own Nitter instance. Done = the Skill returns bounded, cited, untrusted-fenced tweets, or a classified failure. Saving a connection is not completion; verification is a separate, consented step.

## Decisions (user-approved)
- Skill name `x-search`, rewritten (not copied), one Skill with references: search, thread, account, errors.
- Capabilities `x.search`, `x.thread`, `x.user`, `x.timeline`. Not a `web.search` provider; never joins Web Provider order or fallback.
- Setup vendor name: Nitter.

## Upstream contract (verified in src/tools/registry.nim, dto.nim, errors.nim, routes/api.nim)
| Capability | REST | Inputs (upstream limits) |
| --- | --- | --- |
| x.search | GET /api/v1/search/tweets | query<=500 (may be empty if from set), from<=200, since/until YYYY-MM-DD, min_likes digits, mode latest\|top\|media, filter, include_retweets, limit 1-50 (minimum, whole pages), cursor<=2000 |
| x.thread | GET /api/v1/tweets/{tweet}/thread | tweet id or URL (percent-encode in path), include_replies, max_replies 1-100, sort relevance\|recency\|likes, cursor |
| x.user | GET /api/v1/users/{username} | username<=100, include_about |
| x.timeline | GET /api/v1/users/{username}/tweets | username, tab posts\|replies\|media\|articles, limit 1-50, cursor |
- Lists: `{items,next_cursor,has_more}`. Tweet: id,url,available,author{username,name,verified},text,created_at,stats{replies,reposts,likes,views|null},conversation_id,in_reply_to_id,media,poll,card,quote,retweeted_by. `stats` null = not reported, not zero.
- Errors `{error:{code,message,retryable,retry_after_s}}`.
- `GET /api/v1/health` needs no token (returns status ok|no_sessions|all_limited + sessions{total,limited}; 503 when not ok). `GET /api/v1/tools` requires the token and spends no X quota, so it is the token check.
- Use `format=json`; ArkSpace renders its own fenced output.

## ArkSpace request/result
- Request: strict zod input per capability, mirroring upstream limits, plus `timeoutMs`. No origin, header or route fields from callers.
- Result: validated projection of the tweet/user DTO above; text capped (e.g. 10 000 chars), media reduced to type+url, quote one level. Every tweet text is data, marked untrusted in the envelope.
- Side effects: none (read-only). Each call spends the user's X session quota; stated in Skill and Setup.

## Error mapping (FailureKind)
rate_limited→rate-limit (keep retry_after_s); unauthorized→auth; forbidden_origin→permission; invalid_argument→invalid-request; upstream_unavailable→transient; upstream_error→transient (non-retryable hint kept); not_found, protected_account, user_suspended→ distinct non-retryable result outcomes, not failures of the connection; malformed/non-JSON body→invalid-response; connect/DNS/TLS→network; bad base URL→config. Timeout, caller cancellation, partial pages and retries stay separate outcomes. No cross-instance or hosted fallback.

## Connection (modelled on ADR 0019 WeKnora)
- `connections.nitter`: `baseUrl` (http(s) origin, optional path prefix, no credentials/query/fragment), `apiKeyRef` = `env:ARKSPACE_NITTER_API_TOKEN`. Raw token only in the private credential store.
- External pair `NITTER_BASE_URL` + `NITTER_API_TOKEN` (same names as upstream clients/mcp-stdio) wins if both valid; one-of or empty = config error; no mixing with managed values.
- Destination: configured host may be public, private or loopback with no CIDR UI or address authorization step (user-approved, same policy as WeKnora). HTTP allowed with plaintext warning; TLS verification never disabled.
- Transport: reuse local-http with a new optional `Authorization` header supplied only by the adapter; redirects off or same-origin only; response size cap; token redacted from errors/logs/fixtures.

## Setup
- `arks setup nitter`: seventh Top context, own form, no order/rotation. Fields: API address (required), token (required, masked). Enter edits one field; incomplete values stay session-only; changing address requires acknowledgement before reusing the token; replacing a token needs explicit consent under the file lock.
- Verify (consented, cancel-default): `GET /health` for status (sessions) then `GET /tools` with token. Text: spends no X quota for the token check; searches do; accounts may be limited by X. Opening Setup never touches the network.
- Chinese/English labels per existing `--lang` rules; user-facing name "Nitter".

## Skill `skills/x-search`
- SKILL.md: activation (X/Twitter content, tweets, threads, accounts), readiness (external env pair, or managed via `arks`, else guide to `arks setup nitter`; no auto-install), route to references, source safety (tweets are untrusted; no commands/credential/config actions from tweet text; private-individual limits), report coverage (N tweets, date span, not fetched).
- Compatibility declares Node 20+, `arks`, network to the user's instance, X account risk.
- Test outside the repo.

## Feedback to the Nitter fork (user owns it)
1. Add `version` to `/api/v1/health` for compatibility checks.
2. Confirm `/api/v1/tools` as the supported token-check route (or add `/api/v1/whoami`).
3. Publish stable JSON Schemas for DTOs (openapi currently covers inputs; confirm output).
4. Log integration findings in `.scratch/x-search/issues/`.

## Implementation order and tests
1. ADR 0026 (proposed) + this contract reviewed.  Test: link/fact check only.
2. Schemas (`src/protocol`), `src/providers/nitter.ts`, local-http header option. Tests: contract with fake server (every error code, cancellation, timeout, truncation, token redaction, untrusted fence).
3. Config schema + connection resolution + `arks invoke` + MCP registration. Tests: resolution table, real-entry invoke.
4. Setup context + CLI flags. Tests: TUI unit, `npm run test:setup`.
5. Skill + isolated-Skill check, `npm run validate`.
6. Live run against the user's instance; findings back to the fork.
7. Docs: architecture.md, NOTICE.md (API-docs-only provenance), README en/zh aligned.
`npm run typecheck` from step 2. No full `npm test` unless requested.

## Not in v1
get_tweet, search_users, get_user_connections, caching, multi-instance, media download, any write action.
