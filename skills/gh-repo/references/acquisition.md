# Remote acquisition

## Readiness and bounds

Check `gh --version` before CLI use. If missing, ask before installation from https://cli.github.com/ and verify the version afterward. `gh` normally requires authentication even for public reads; do not initiate login or require authentication just to analyze public code. With existing access, prefer native `gh repo view` and read-only `gh api` requests. Stop on private access failure and report only a sanitized error.

For public repositories without authenticated `gh`, use the host's bounded HTTPS reader against `https://api.github.com/repos/OWNER/REPO` and the same GET endpoints below, with `Accept: application/vnd.github+json`. No Authorization header or tokens. Anonymous rate limits are lower; on rate limit, stop and report the gap rather than retry indefinitely. If no bounded HTTPS tool exists, ask for a local checkout or user-controlled CLI readiness; do not alter configuration automatically.

Set request timeouts (default 15 seconds) and enforce the main Skill's byte/file/request limits in the host tool before fetching. Filtering a large response after download is not a transport bound. If the tool cannot bound a response, use a smaller known endpoint or report that route unavailable. Never use recursive trees or unbounded `--paginate`. Count metadata and discussion requests in the budget.

## Pin and traverse

The following are endpoint templates, not shell strings to interpolate from arbitrary user text:

| Evidence | GET endpoint / native command | Qualification |
| --- | --- | --- |
| Current overview | `gh repo view OWNER/REPO --json nameWithOwner,description,url,defaultBranchRef,isArchived,licenseInfo,stargazerCount,updatedAt` or `repos/OWNER/REPO` | Mutable metadata; record observation date. |
| Resolve revision | `repos/OWNER/REPO/commits/ENCODED_REF` | Verify returned `sha` is a full 40-character hex commit SHA. For default branch, use metadata's branch name, not a hardcoded `main`. |
| Root tree | `repos/OWNER/REPO/git/trees/FULL_COMMIT_SHA` | Nonrecursive, one directory. Stop if `truncated` is true. |
| Selected subdirectory | `repos/OWNER/REPO/git/trees/TREE_SHA` | Use only a subtree SHA returned by the pinned parent. Record its path. |
| Selected file | `repos/OWNER/REPO/contents/ENCODED_PATH?ref=FULL_COMMIT_SHA` | Confirm file type, size, encoding, and path before decoding. |

Invoke `gh api` with one validated endpoint argument and read-only GET (explicit `--method GET` if using fields, since fields otherwise select POST). Validate owner and repo as nonempty ASCII letters/digits/underscore/dot/hyphen components, rejecting `.` and `..`. Supply arguments directly via the host's argument-array process tool, never `eval` or concatenate untrusted shell fragments. If shell is the only interface, use the host/platform's correct literal argument quoting, not raw user substitution; stop if safe quoting is unavailable.

Encode each repository path segment independently using a URL encoder (such as `encodeURIComponent`), then join with `/`; encode a branch/ref used as a single endpoint component in full. Encode query values independently (or use `gh api --method GET -f ref=FULL_COMMIT_SHA` as separate arguments). A file `src/a b#c.ts` becomes `src/a%20b%23c.ts`; a ref `feature/a` becomes `feature%2Fa`. Never encode the entire endpoint or treat a path's `?`, `#`, spaces, or `%` as URL syntax. Reject absolute paths, empty/interior traversal segments, and paths not returned by the selected tree. Encode paths in immutable citation URLs too.

GitHub Contents can return `encoding: none` with empty content above its inline size threshold (normally 1 MiB), and does not support files over 100 MiB. Empty content is not proof of an empty file. Within the agreed byte budget, a bounded GET of that same pinned Contents endpoint with `Accept: application/vnd.github.raw+json` can supply raw bytes; alternatively use a verified pinned raw URL on `raw.githubusercontent.com`. Use no credential-bearing URLs or arbitrary response-provided download hosts. If the size exceeds budget or the host cannot bound raw bytes, mark the file omitted and ask before increasing scope. Treat symlinks, submodules, binary files, LFS pointers, and directory listings as such, not implementation bodies; Contents directory listings also have a 1,000-entry ceiling. Per-directory Trees are preferable for inventory, but can still truncate.

## Clone only when needed

Prefer targeted remote files or a user-provided checkout. For a clone, first obtain explicit approval for the repository, destination (new agent-owned temporary directory), transfer/disk bounds, and cleanup. Use a nonrecursive, no-checkout, shallow/single-branch, blob-filtered clone with hooks disabled; resolve and verify the selected full SHA before reading selected paths. Blob filtering is a request, not a guaranteed cap: use a host-enforced timeout/disk limit, and stop if the server ignores the filter or the requested revision cannot be obtained within bounds. No submodules, dependency installs, checkout hooks, or repository command execution. If safe bounded cloning is unavailable, stay with API reads.

Record the created directory and its ownership. Remove only that directory according to the agreed cleanup; on failure/cancellation report retained paths and incomplete cleanup. Never repurpose or delete an existing user checkout.
