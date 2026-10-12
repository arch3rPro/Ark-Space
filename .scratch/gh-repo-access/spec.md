# gh-repo access and recovery

Status: completed (source only)

## Approved outcome

Public repository analysis is usable without GitHub login; existing authentication is an optional advantage. Private access stops without permission. Limit/routing failure preserves gathered evidence and produces a qualified partial report. No automatic login, token/identity rotation, proxy pools, new shared runtime, or clone/download without consent.

## Helper contract

Public test seams agreed in the approved plan: the installed `node scripts/view-issue-pr.mjs` entry and isolated canonical Skill guidance. External `gh`/HTTPS boundaries are fixtures; no private helper exports or live limit exhaustion.

- Existing `--repo OWNER/REPO --number NUMBER` keeps authenticated `gh` as the default and the exact success shape `{ok:true,data:...}`.
- `--anonymous` is an explicit public-record choice. One GET to fixed `https://api.github.com/repos/<owner>/<repo>/issues/<number>`, no Authorization/cookies, no redirects, verified TLS; no automatic fallback after auth/access/rate errors.
- Validate owner/repo components, reject dot/traversal/option/URL injection; integer number 1..2147483647, canonicalize digits. Validate the response identity/fields before normalizing.
- Budget: 10-second acquisition deadline with awaited child cleanup; 256 KiB body and bounded gh headers/stderr. Never echo raw stderr, headers, or error bodies. Same normalization/clipping for either transport.
- Error stderr remains one `{ok:false,error:{kind,message,...}}` object, stdout empty. Distinguish invalid-input, tool-unavailable, auth-required, auth-invalid, not-found-or-inaccessible, access-denied, rate-limited, timeout, response-too-large, invalid-response, network-error, cancelled, and safe generic GitHub failures. Whitelist status and bounded Retry-After/reset/remaining/resource hints; no automatic retries.
- SIGINT/SIGTERM cancel with exit130. Await owned gh child exit, escalating if necessary, before reporting; anonymous request and body share deadline/cancellation. Other errors exit1, invalid args exit2.

## Guidance contract

One readiness check for github.com per task, use existing local checkout/cached SHA files first. Pin full SHA; known/public Git refs and bounded pinned Raw may reduce REST calls but never invent inventory or promise unlimited routes. Directory/metadata/discussions stay bounded. Budget includes failed external attempts; no repeated /rate_limit probes. Rate-limited paths stop and respect server waits; retain results, distinguish mutable metadata from pinned source, and identify gaps.

User-controlled login lives in acquisition.md: user runs `gh auth login --hostname github.com --web` and `gh auth status --hostname github.com` in a trusted terminal only. Private denial never becomes anonymous access; neither helper nor Skill exports/stores credentials. Do not execute repository contents.

## Verification

Public-script/isolated-Skill fixtures for both routes, invalid arguments/responses, HTTP status distinctions, rate headers, TLS/redirect/auth omission, bytes/deadline/cancellation and child settlement. Preserve five pre-existing test WIP files. Focused validation only; no version/release/push/global installation or implied native qualification.

Evidence: 52 focused tests passed (29 new access cases, 3 existing helper cases, 20 guidance/plugin cases); validate, typecheck, package verifier (235 files), node syntax checks and active diagnostics on four touched code paths passed. A single live anonymous `cli/cli#1` read succeeded. Real credentialed access, actual limit recovery, full suite and native macOS/Windows were not checked. Existing five test WIP files were not edited.
