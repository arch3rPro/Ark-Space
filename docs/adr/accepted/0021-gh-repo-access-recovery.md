# GitHub access and recovery for gh-repo

- **Status:** accepted
- **Class:** Skill boundary

## Context

ADR 0018 established the `gh-repo` analysis Skill and described anonymous public reads, consent boundaries, and a bounded issue/PR helper. Guidance needs explicit recovery when public access is limited or authentication is absent, while keeping login user-controlled and reports honest about evidence gaps.

## Decision

Use local checkouts and cached full-SHA evidence first. For remote work, one selected-host `gh` readiness/auth-status check per task is optional; absent login must not block anonymous public reads. Existing authenticated `gh` remains the default. User-controlled login instructions are `gh auth login --hostname github.com --web`, followed by `gh auth status --hostname github.com`; resume evidence gathering only after the user performs that step. Never expose or manage credentials. Private access failures stop.

Remote evidence remains bounded by the Skill defaults: 20 files, 200 KiB per file, 2 MiB total, and 20 requests, counting failures. Pin a full SHA. Inventory comes from a pinned tree; known pinned document paths may be validated and fetched but do not imply complete inventory. Fixed public `git ls-remote` and pinned raw URLs may reduce API requests, not promise unlimited access, establish inventory, or authorize a clone. Clone, installation, authentication, and execution are separate consent boundaries.

Hosts must bound network responses, stdout, and runtimes. Distinguish 403 and 429 using headers, respect `Retry-After` and reset guidance, and stop rather than wait a long time when no bounded guidance exists. Do not rotate authentication, bypass limits, or retry after limits. Preserve gathered evidence and report partial results with transport failures and evidence gaps.

The optional issue/PR helper keeps authenticated `gh` as its default; explicit `--anonymous` is for public records only. Both routes retain one success JSON schema, a 10-second acquisition deadline with awaited child cleanup and 256 KiB body limit. Anonymous mode performs one fixed public GET without authorization/cookies, redirects, or TLS bypass. Errors are structured and sanitized on stderr; no prompting, fallback, or retries. Node.js 20 is required only for this optional helper; `gh` is optional for anonymous reads.

## Consequences and boundaries

ADR 0018 remains authoritative except that its clause saying the helper is unchanged is superseded by this decision. No new reference file, SDK, account registry, shared runtime, or tool-specific clone script is introduced. Guidance is original prose informed by official API documentation; no external source code is imported.

Validation, typecheck, package verification and 52 focused helper/guidance/plugin tests passed on Linux, including isolated Skill copies, deadlines during body reading, and owned-child cancellation. One live anonymous read of `cli/cli#1` succeeded. Credentialed access, actual rate-limit recovery, and native macOS/Windows behavior remain unqualified; fixtures do not establish them. No release follows from this decision.

## Source policy

Original implementation uses Node built-ins; no external source code is imported. Official documentation informs authentication and error semantics separately from source-code licensing: [REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), and [`gh api`](https://cli.github.com/manual/gh_api).
