# X capability diagnosis and repair — 2026-11-06

Status: implemented; targeted regression and bounded Linux live verification passed. Not full release or cross-platform qualification.

## Scope and completion

Repair the four existing `x.*` read capabilities without changing connection ownership, consent, quota policy, whole-page limits, automatic retries, or fallback. Keep existing user configuration and the pre-existing `package.json` change untouched.

Affected boundaries: `arks invoke`, the shared X dispatcher/projection, Nitter-only HTTP path validation, Protocol v1 response schemas, MCP schema consumers, and canonical `skills/x-search` guidance.

## Changes

- Add optional safe `error.reason`: `input-unreadable`, `input-json`, `request-schema`, `confirmation-required`, `capability-disabled`, `response-schema`. Messages are fixed local text, not raw upstream errors, caller values, or paths.
- Keep canonical `arks invoke <known x.*>` argument-parser errors inside a JSON failure envelope. Unknown argument values are not echoed to stderr; help keeps its normal successful behavior.
- Report local text/array/quote truncation once in envelope `warnings`; upstream `hasMore` is not used to claim local completeness.
- Preserve validated tweet and quote polls as `options[{label,votes}]`, `totalVotes`, and `status`. Keep output bounded and report local truncation.
- Require boolean upstream `has_more` and an explicitly present `next_cursor` that is null or a nonempty string of at most 2,000 characters, consistent with the boolean. Reject malformed cursors rather than truncating them.
- Check canonical parsed JSON as well as raw response text for credential echoes so JSON Unicode escapes cannot hide a token.
- Increase only the Nitter route's encoded path limit to 32 KiB. A valid 2,000-character cursor plus a 500-character query can exceed the former 4 KiB bound after percent encoding; route scoping, credentials, address/TLS checks, no redirects, deadlines, and body bounds are unchanged.
- Clarify thread paging: `repliesOmitted` counts reply threads dropped on the current page by `maxReplies`. The cursor continues after that whole page and cannot recover dropped threads; increase the limit and reread the same page when needed. Main tweet/context may repeat, so merge by tweet ID.
- Correct Skill runtime compatibility and remove reliance on a nonexistent capability-list command.

## Upstream contract evidence

- Revision: `bb5a0bc3e9297fe47acc701107f065585e2b6575` of `xiaoY233/nitter`.
- [DTO contract](https://github.com/xiaoY233/nitter/blob/bb5a0bc3e9297fe47acc701107f065585e2b6575/src/tools/dto.nim): poll options have string labels and integer votes, plus `total_votes` and string `status`.
- [Operation behavior](https://github.com/xiaoY233/nitter/blob/bb5a0bc3e9297fe47acc701107f065585e2b6575/src/tools/impl.nim): page cursor/boolean construction, whole reply-chain limits, and omitted-thread semantics.

## Red/green evidence

Before their fixes, focused tests failed for missing local truncation warnings, absent poll projection, merged confirmation/disabled reasons, malformed pagination, JSON-escaped credential echoes, and percent-expanded cursors. Built-entry tests also failed for indistinguishable local input failures and raw Commander parameter errors. The corresponding tests passed after the fixes.

Final regression command:

```bash
npm test -- tests/x-capabilities.test.ts tests/x-cli-diagnostics.test.ts tests/protocol.test.ts tests/mcp.test.ts tests/local-http.test.ts
```

Result: **5 files, 105 tests passed** (35 X capability, 28 X CLI diagnostics, 33 Protocol, 4 MCP, 5 local HTTP). The command rebuilt the CLI. Diagnostic fixtures explicitly block/record network attempts and check that private fixture values do not reach stdout/stderr. Coverage includes unreported `stats:null`, quoted polls, poll bounds, cancellation, timeout, no fallback/retry, opaque cursor forwarding, and transport guards.

Also passed:

- `npm run typecheck`
- `npm run generate:schemas` (four X response schemas updated)
- `npm run validate`
- Active LSP diagnostics on seven changed TypeScript files: **0 diagnostics**.
- `git diff --check -- <X-change paths>`
- Canonical Skill relative-link checks.

Parallel documentation changes were outside this X-focused verification scope.

## Live results after rebuilding

Executed with `arks invoke <capability> --input -`, the existing managed Nitter connection, `confirmed:true`, a 20-second operation timeout, and no retries. No credentials, private endpoints, raw response bodies, or cursors are recorded here.

| Call | Input | Result | Elapsed |
| --- | --- | --- | --- |
| `x.user` | `OpenAI` | Profile returned | 695 ms |
| `x.timeline` | `OpenAI`, posts, limit 3 | 15 tweets; more and cursor present | 1,544 ms |
| `x.search` | `OpenAI`, latest, limit 3 | 20 tweets; more and cursor present | 1,411 ms |
| `x.thread` | Public status URL below; replies enabled, maxReplies 3 | 3 continuation tweets, 3 reply chains/tweets, 30 omitted threads; more and cursor present | 2,745 ms |
| `x.thread`, page 2 | Same URL/options and the first response cursor | 3 continuation tweets, 3 reply chains/tweets, 33 omitted threads; more and a new cursor present | 4,049 ms |

Thread sample: <https://x.com/OpenAI/status/2114780711664398349>.

All five calls exited 0, returned `ok:true`, and left stderr empty. Page 2 kept the same root, advanced the cursor, and returned **3 new reply tweets, 0 overlapping reply tweets**. This checks one real transition, not exhaustion of the conversation. The inspected returned tweets had text and timestamps, with no detected HTML markup; none of the live samples contained polls.

`limit:3` returning whole pages is the existing documented contract, not a bug. All calls correctly reported `HTTP transport is plaintext.`; configuration was not changed.

## Remaining qualification limits

- Live polls, live truncation, real account limits/suspension, and recovery were not deliberately triggered; poll/truncation/security behavior is covered by bounded fixtures.
- Only one thread continuation page was fetched. No automatic pagination or retries were added.
- No full-suite, release/package, setup PTY, installed-host, or Windows/macOS qualification was run for this targeted change.
- HTTP plaintext transport remains a deployment risk on an untrusted network; switching to HTTPS requires an appropriate instance endpoint and user-owned configuration change.
- No version changes, publishing, or global package replacement.
