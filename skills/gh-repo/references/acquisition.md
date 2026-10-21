# Remote acquisition

## Readiness and bounds

Use local checkouts and cached full-SHA evidence first; reuse files within this task, without introducing a persistent credential-bearing cache. If `gh` is available and authenticated reads are useful, check `gh auth status --hostname github.com` at most once per task. Record only readiness, not raw authentication output. Use existing valid authentication; missing or invalid login does not block public anonymous reads. A failed private-access path stops, not falls back to anonymous.

For public REST reads, use a bounded HTTPS GET to `https://api.github.com`, with `Accept: application/vnd.github+json`, no Authorization or cookies, no redirects, and verified TLS. For an exact issue/PR record, the helper also offers an explicit anonymous route. If no bounded reader is available, request a local checkout or user-prepared CLI rather than an unbounded download.

Default analysis bounds: one repository, 20 files, 200 KiB per file, 2 MiB total, 20 remote requests; each request times out after 15 seconds unless a smaller operation-specific bound applies. Enforce byte bounds at the transport, not after download. Count metadata, discussions, failed attempts, retries, and remote authentication probes. No recursive trees, unbounded pagination, or repeated `/rate_limit` probes.

## Optional login and recovery

Public tasks can continue anonymously. Offer login when the user needs private access or more metadata capacity; do not require it merely to read public source. With consent, the **user** runs these commands in a trusted terminal:

```bash
gh auth login --hostname github.com --web
gh auth status --hostname github.com
```

The user completes browser/device-code and any organization SSO authorization there. Never initiate login, receive passwords/tokens/device codes, extract credentials, or switch accounts. Successful login does not establish permission to every private repository. Resume missing evidence after verification; retain already-read pinned files. Missing CLI installation also needs consent, an [official source](https://cli.github.com/), and a version smoke check.

Ordinary REST limits are normally 60 requests/hour per source IP anonymously and 5,000/hour with user authentication; endpoint-specific and secondary limits also apply. Read response headers rather than assuming quota. Classify before deciding recovery:

| Outcome | Recovery |
| --- | --- |
| Missing tool or authentication | Choose a public anonymous route before acquisition, or let the user prepare required access. |
| Invalid authentication | Offer user-controlled repair; never repeatedly reuse it. |
| Permission failure or 404 | Report inaccessible-or-not-found; private access stops. |
| Primary limit (`403`/`429`, remaining `0`, with no secondary-limit signal) | Stop the exhausted REST route until `x-ratelimit-reset`; run the first-limit decision below instead of waiting or immediately ending analysis. |
| Secondary limit (`429`, `Retry-After`, or a secondary-limit error) | Stop; respect `Retry-After` and GitHub's waiting rules before any user-approved retry. |
| Temporary network failure | A limited retry may fit the remaining budget; otherwise report the gap. |
| Oversized, malformed, or truncated response | Mark omitted/incomplete; do not repeat the same oversized request. |

A plain 403 is not proof of a limit or missing login. Never rotate identities, tokens, or proxies to bypass limits; one pre-existing authenticated identity is not rotation. For secondary or unclassified limits, use local/already-fetched evidence only until the required wait has elapsed and the user approves retry; do not switch network routes. A secondary-limit signal takes precedence over remaining `0`. See [official limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) and [retry best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).

### First-limit decision

1. **Probe readiness, then ask once.** Run `gh auth status --hostname github.com` at most once per task *before* asking anything; it counts against the request budget and yields readiness only, never raw output or tokens.
   - **Valid existing authentication:** continue with read-only authenticated `gh api --hostname github.com --method GET` reads under the same bounds. That is the user's normal authenticated quota, not a bypass, so there is nothing to ask. Say briefly that authenticated reads are being used. If this route hits its own limit, go to steps 2-3.
   - **Missing, invalid, or unavailable authentication:** report the classified limit, affected evidence, and available reset/retry time without secrets, then ask the user once to choose:
     - **Continue without login (default for public source):** reuse local/cached evidence, then eligible bounded public-source reads below.
     - **User-controlled login:** if `gh` is available, offer the trusted-terminal commands above. Login is optional and may provide a separate authenticated quota, not a guarantee of access or relief from secondary limits.
     - **Provide a checkout or finish partial:** use a user-provided checkout, or report the exact evidence still unavailable.
   Never ask about logging in before probing readiness, and never suggest switching accounts. In an unattended subagent, return this decision to the parent Agent for the user rather than waiting for input or repeatedly calling the API. If the user declines login, continue the eligible public-source path; if no answer is available, use local evidence and only eligible public-source reads under the existing task authorization.
2. **Continue source analysis where eligible.** These source reads are only for primary REST quota exhaustion on a confirmed public repository, within the original request/byte/time budget and GitHub's applicable limits. Use an existing full SHA or resolve the requested ref with a bounded, noninteractive `git ls-remote`; then fetch validated known paths from `raw.githubusercontent.com/OWNER/REPO/FULL_COMMIT_SHA/ENCODED_PATH`. Follow the pin/path/transport rules below. Do not replace blocked REST calls with GraphQL, HTML scraping, or the helper's anonymous mode. Stop a source route on its own limit or denial. Unknown paths/tree coverage remain partial; raw files do not supply current metadata or discussions. Request a user checkout or separately consented bounded clone only when needed; a rate limit alone is not clone consent.
3. **Finish or hand off.** Resume missing evidence after user-confirmed login with at most one readiness verification, not a polling loop. Reuse pinned files and count the verification/request against the budget. If recovery is unavailable or exhausted, return a qualified partial report with missing evidence and a concrete next step; never silently hang or claim completion.

## Pin and traverse

Resolve a full 40-character commit SHA before source attribution. Build inventory from a pinned tree; known pinned document paths may be fetched directly after path validation but do not establish complete inventory. Unknown tree coverage means partial inventory. For public refs, a bounded, noninteractive `git ls-remote` against the fixed HTTPS repository URL may resolve a SHA without cloning. Disable credential prompts and bound output/time; a broad ref listing is not needed. For validated known paths, `https://raw.githubusercontent.com/OWNER/REPO/FULL_COMMIT_SHA/ENCODED_PATH` may reduce REST file calls. Use the same TLS, redirect, byte, and time bounds, with no credentials. These paths neither promise unlimited access nor establish repository inventory or authorize cloning.

Endpoint templates below are not shell strings to interpolate from arbitrary user text:

| Evidence | GET endpoint / native command | Qualification |
| --- | --- | --- |
| Current overview | `gh repo view github.com/OWNER/REPO --json nameWithOwner,description,url,defaultBranchRef,isArchived,licenseInfo,stargazerCount,updatedAt` or `repos/OWNER/REPO` | Mutable metadata; record observation date. |
| Resolve revision | `repos/OWNER/REPO/commits/ENCODED_REF` | Verify returned full commit SHA. For default branch, use metadata's branch name, not hardcoded `main`. |
| Root tree | `repos/OWNER/REPO/git/trees/FULL_COMMIT_SHA` | Nonrecursive; stop if `truncated` is true. |
| Selected subdirectory | `repos/OWNER/REPO/git/trees/TREE_SHA` | Use only a subtree SHA from the pinned parent; record its path. |
| Selected file | `repos/OWNER/REPO/contents/ENCODED_PATH?ref=FULL_COMMIT_SHA` | Confirm type, size, encoding, and path before decoding. |

Validate owner/repo as nonempty ASCII letters/digits/underscore/dot/hyphen components, rejecting `.` and `..`. Supply a validated endpoint as an argument, using explicit `--hostname github.com --method GET` for native `gh api` reads. Use an argument-array process tool; never `eval` or concatenate untrusted shell fragments. If shell is the only interface, use correct literal quoting; stop if safe quoting is unavailable.

Encode each path segment independently (for example, `src/a b#c.ts` → `src/a%20b%23c.ts`); encode a ref as one endpoint component (`feature/a` → `feature%2Fa`). Encode query values separately. Reject absolute paths, empty/interior traversal segments, and paths not in the selected tree unless using a known pinned document path. Encode paths in immutable citation URLs too.

Contents may return `encoding: none` and empty content above its inline threshold (normally 1 MiB), and does not support files over 100 MiB. Empty content is not proof of an empty file. Within the agreed byte budget, a bounded GET of the same pinned Contents endpoint with `Accept: application/vnd.github.raw+json` or verified pinned raw content may supply bytes. Use no credential-bearing URL or arbitrary response-provided download host. If size exceeds budget or raw bytes cannot be bounded, mark omitted and ask before increasing scope. Treat symlinks, submodules, binaries, LFS pointers, and directory listings as such, not implementation bodies. Contents directory listings cap at 1,000 entries; per-directory Trees can still truncate.

## Clone only when needed

Clone only with explicit consent for repository, destination (new agent-owned temporary directory), transfer/disk bounds, and cleanup. Clone/install/authentication/execution require separate consent. Use a nonrecursive, no-checkout, shallow/single-branch, blob-filtered clone with hooks disabled; resolve and verify the selected full SHA before reading paths. Blob filtering is not a guaranteed cap: enforce host timeout/disk limits and stop if the server ignores the filter or the revision cannot be obtained within bounds. No submodules, dependency installs, checkout hooks, or repository command execution. If safe bounded cloning is unavailable, use bounded reads or report the gap. Record directory ownership; remove only that agreed directory. Report retained paths/incomplete cleanup on failure. Never repurpose or delete an existing user checkout.
