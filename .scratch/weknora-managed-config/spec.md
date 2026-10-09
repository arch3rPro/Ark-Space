# Optional WeKnora managed configuration

Status: implemented in unreleased source; automated Linux/source/installed-entry qualification; real-service, human UX and hosted Windows/macOS acceptance unverified

## User task and completion

A human can optionally save a WeKnora connection through `arks setup`, then an Agent can perform explicitly supported knowledge-base operations using that connection without seeing its key. A user with manually supplied `WEKNORA_BASE_URL` and `WEKNORA_API_KEY` can continue using the installed Skill without `arks`.

Configuration persistence alone is not feature completion. Delivery must distinguish “connection saved/tested” from “Skill can use managed configuration.” No live service, hosted OS, or human UX qualification is implied by simulated tests.

Accepted boundary: [ADR 0019](../../docs/adr/accepted/0019-optional-weknora-managed-connection.md). Existing security and interaction contracts: [ADR 0009](../../docs/adr/accepted/0009-local-credential-setup.md), [ADR 0017](../../docs/adr/accepted/0017-workbench-modal-setup.md).

## Scope

One managed connection, one credential reference, optional default knowledge-base ID and a read-only connection test. The user-configured WeKnora host may be public, private or loopback without a separate IP grant. No Web Provider registration, automatic search order, key pool, instance rotation, cross-instance fallback, server deployment changes, model configuration, or general-purpose authenticated HTTP proxy.

Managed runtime support covers connection verification, knowledge-base list/detail, and single-knowledge-base search. File import, content edits, and SSE chat remain available through the independent environment path until explicitly implemented through the managed boundary. Never claim unsupported operations work with stored configuration.

## Connection shape

An optional `connections.weknora` configuration entry contains:

- `baseUrl`: explicit API root ending in `/api/v1`; preserve any deployment prefix. Never silently append the suffix. Reject credentials, query, fragment, invalid schemes, and malformed authority.
- `apiKeyRef`: the dedicated `env:ARKSPACE_WEKNORA_API_KEY` reference; raw value belongs only in the existing private credential store. Public environment pairs remain a separate source. An external override of this dedicated reference is a conflict, not an implicit mixed connection.
- `allowRanges`: retained for valid legacy configuration compatibility only; ignored by WeKnora destination policy and reset to an empty list on new saves. There is no CIDR entry or authorization step in Setup.
- `defaultKnowledgeBaseId`: optional selection preference, not an allow-list or upload authorization; at most 128 letters/digits/underscores/hyphens, starting with a letter or digit, matching runtime identifier validation.

No default endpoint is discovered or installed. HTTP is supported with an informational plaintext-transport warning; TLS validation is never disabled. An explicit user request to read the configured instance authorizes network access. Existing configurations must remain loadable without the optional entry.

## Connection resolution

Resolve the connection from the original process environment, before credential hydration:

| Original external environment | Resolution |
| --- | --- |
| Both WeKnora variables supplied and valid | Use that external pair; do not read a stored key to complete it. |
| Neither variable supplied | Resolve the managed endpoint and its credential reference together. |
| One variable supplied, or either supplied value empty/invalid | Configuration error; no managed fallback or mixed pair. |

The Skill uses the independent REST/script path when the external pair is complete. With neither variable supplied, it may use supported `arks` operations if the CLI and managed configuration are available. Missing CLI is not an automatic installation trigger. Missing configuration offers manual environment setup or consented CLI setup.

The CLI applies the same pair-selection rules. Do not infer external ownership from hydrated `process.env`. References resolving to externally supplied values must be visibly identified; do not pair an external-only reference value with a managed address without an explicit connection-level contract. The implemented dedicated managed reference prevents accidental overlap with the public pair; the resolver rejects an external override of it.

A failed request never changes connection source. Explicit resource targets override the default knowledge-base preference, not server authorization.

## Setup interaction

The implemented extension preserves ADR 0017's Top/Menu/Content focus regions and global order/language. `setup weknora`, the advertised `w` action, or Top arrows/brackets opens a separate connection context, not a fifth `SetupProviderId`. Its first menu label is Connections. The header displays all five services when its available width permits; only narrow headers window the labels, always retaining the selected service without moving summary/body panes. Editing reuses terminal forms, draft/save/cancel, confirmation, busy operations, masking, and restoration. The user authorized completing the remaining integration in one run; this extends only the context strip, not Web execution.

The primary list shows API address and API key as required fields, plus a default knowledge-base ID explicitly marked optional. Enter always edits exactly the selected field, including first-time setup; there is no configure-all form. Incomplete values remain in the current Setup session only, with a Temporary action and explicit missing-field status. Completing the valid address/key pair saves it together; ordinary exit confirms discarding incomplete drafts with Cancel as default. Key rows use the existing masked-default, explicitly revealable preview. Shared layout retains the original 19-cell menu and allocates three-column resource tables approximately 50% to URL/reference and 25% each to source/status; details and verification outcomes use short human-readable labels. Credential source and current/saved address distinctions belong in details; no private-network authorization option exists. The user explicitly removed that extra CLI requirement; it is not a WeKnora API prerequisite. Configuration status remains “configured, not tested” until a consented probe. Actions: edit/save, optional default selection, consented test, and remove local configuration. Opening or saving performs no network request. External configuration is read-only; local saves do not override the active external pair.

Changing an endpoint requires explicit acknowledgement before reusing its saved key, including when a form resubmits the same key value. Replacing an existing or orphaned saved credential requires separate explicit replacement consent, checked under the file lock to reject concurrent unconsented overwrite. Endpoint changes still require saved-key reuse consent, but never require an IP authorization step. Removing a connection never deletes remote content or external environment values. Shared credential references must remain protected, including references shared between Providers and connections.

Atomic writes reuse existing stores and locks, with no prompt or network wait inside a lock. If saving a secret succeeds but saving its reference fails, report the partial state using references only; do not claim rollback or success.

## Runtime contract

Supported managed operations use the installed `arks invoke <capability> --input <file>` boundary. `weknora.connection.verify` follows the contract below. `weknora.knowledge-bases.list`, `weknora.knowledge-bases.get`, and `weknora.search` use strict bounded requests and validated projections described in the [runtime retrieval contract](runtime-contract.md) and [self-contained managed Skill guide](../../skills/weknora/references/managed.md). These operations are WeKnora-specific, not disguised as `web.search`.

- Requests contain operation inputs and bounded deadlines, never raw keys, arbitrary origins, headers, or route strings.
- Results follow the machine-readable envelope, contain operation-specific validated data and non-secret source metadata, and do not expose configuration files or keys.
- Do not add WeKnora to `ProviderId` merely to populate an envelope field. Define the non-Web envelope/schema representation explicitly and test existing consumers and MCP compatibility before changing it.
- Local validation failures perform no network request. HTTP status and WeKnora business failure are both checked. A 403 is permission/scope/policy evidence, not automatic key invalidation.
- Cancellation and deadline are separate from empty successful data. No retry or alternate-connection fallback is implicit.
- Connection verification sends only `GET /auth/me`, with explicit network consent and a five-second budget; it reports only classified evidence, not identity details. It proves neither retrieval nor ingestion permission.
- Knowledge-base detail can establish target access and capability flags. Search checks usable retrieval capabilities first; no index is a distinct outcome, not “no results.” Empty list data may be `null` or `[]`.
- Default-knowledge-base browsing is separately consented because names may be sensitive; manual ID entry works offline.

Source API contracts: [endpoints](../../skills/weknora/references/endpoints.md), [errors](../../skills/weknora/references/errors.md), [pitfalls](../../skills/weknora/references/pitfalls.md). Confirm request/response evidence for each new operation before implementation; do not guess API bodies.

## Implemented verification contract (issue 02)

`arks invoke weknora.connection.verify --input request.json` accepts this strict request:

```json
{"protocolVersion":1,"capability":"weknora.connection.verify","input":{"confirmed":true,"timeoutMs":5000}}
```

`confirmed: true` records authorization to contact the selected connection (including server logging) and is required, never defaulted. An explicit user request to read the configured instance supplies that authorization; there is no separate HTTP permission. HTTP is supported and displays an informational plaintext warning. The legacy `allowHttp` field remains accepted but is ignored. `timeoutMs` defaults to 5000, accepts integers 1–5000, and bounds connection/configuration resolution plus DNS, TLS, response headers/body and parsing after request validation. CLI input reading and MCP startup/framing are outside the execution budget. Machine invocation defers credential loading to its selected operation; WeKnora does not hydrate unrelated credential values or parse human-command aliases before its bounded resolver. No origin, CIDR, raw key, header, or route inputs are accepted.

Success is a new **non-Web Protocol v1 variant**, not a Web Provider envelope:

```json
{"protocolVersion":1,"capability":"weknora.connection.verify","connection":"weknora","ok":true,"source":"managed","data":{"outcome":"accepted","status":200},"warnings":[]}
```

Failure uses the same fixed identifiers, `ok: false`, `warnings`, optional `source` (only after successful source resolution), and `error: {kind, message, retryable: false, status?}`. It has no `data`, `provider`, or `attempts`. Messages are fixed classification strings and curated correction guidance, not remote messages or raw local exceptions. HTTP transport adds an informational fixed plaintext warning. Status is included only when available; source is `managed` or `environment`, never an endpoint or credential reference.

Kinds: `invalid-request`, `config`,  `auth` (401), `permission` (ambiguous 403, never invalid-key evidence), `rate-limit` (429), `http-status` (other non-2xx), `business-failure` (2xx with `success: false`), `invalid-response` (bad JSON/content shape), `blocked-address`, `dns`, `redirect`, `timeout`, `cancelled`, `network` (including failed TLS validation), `headers`, `body`, `content-type`, `encoding`, `invalid-url`, `configuration`. The `blocked-address` enum value is retained for protocol compatibility, not as a WeKnora private-IP restriction. No retries, automatic key disablement, health/cursor writes, or connection fallback occur. Success requires JSON with boolean `success: true` on a 2xx response. Identity/data fields are discarded and never serialized. Acceptance proves only `/auth/me`, not retrieval, upload, chat, index readiness, or every configured credential.

The dedicated authenticated transport fixes `GET <validated API root>/auth/me`, preserves deployment prefixes, bounds the key to 4096 printable ASCII bytes, headers to 16 KiB, and body to 64 KiB. It refuses **all** redirects, including redirects without Location, independently of caller options; ignores ambient proxies; validates every DNS answer as a valid IP and pins the chosen address; accepts public, private and loopback destinations without CIDR authorization; and explicitly enforces HTTPS certificate validation even under an ambient TLS-disable setting. Cancellation destroys in-flight I/O. Deadline and cancellation also return classified envelopes during configuration resolution; late resolution cannot start a request.

The CLI captures the original environment before credential hydration and passes it to invoke and MCP startup. MCP retains that startup snapshot and paths for subsequent tool calls. The dispatcher requires an explicit `originalEnvironment` for this capability; it never guesses from hydrated `environment` or `process.env`. Absent/incomplete/invalid external pairs and external managed-reference overrides retain the issue-01 rules. A complete external pair receives no managed preferences or stored-key supplementation. Its configured private or loopback endpoint works without local configuration or IP exceptions.

Request/response validation lives in `src/protocol/weknora-schema.ts`; committed Draft-7 schemas are `schemas/protocol/v1/weknora-connection-verify-{request,response}.schema.json`. The request schema describes pre-default input. Existing Web request/response schemas and Provider IDs are unchanged. Consumers must dispatch by capability: this additive variant does not remove or repurpose any existing field. MCP exposes `weknora_connection_verify` (or a configured tool alias), uses the same dispatcher/consent schema, validates the result, returns identical JSON text and structuredContent, and sets isError from ok. Existing Web tools keep their original contracts. Setup invokes verification after network/HTTP-risk consent; the canonical Skill selects supported managed operations only when neither public environment variable is supplied.

## Authenticated transport boundary

Reuse the pinned, validated transport mechanism in `src/providers/local-http.ts` without turning its existing credential-free public surface into an arbitrary authenticated client. The existing hosted `requestJson` helper is not sufficient for user-selected origins.

Require validated configured origin, all-address IP validity checks and pinned lookup, no redirects, no ambient proxies, bounded response/header sizes, bounded time, and cancellation. Inject `X-API-Key` only inside the execution process. Reject cross-origin routing and never include key/header values or raw server error bodies in diagnostics. Secret-bearing HTTP displays an informational plaintext-transport warning; an explicit user request to read the configured instance authorizes the request.

## Compatibility and documentation

Canonical Skill guidance now selects the supported path and states which operations remain environment-only. Independent SSE execution is verified from a copied Skill with no repository siblings, no arks on PATH, and no local config. The Skill never reads credential files or exports secrets through captured output.

The earlier “never calls arks” and blanket “never place key in a file” statements are replaced by the explicit optional managed boundary. The independent path must still forbid ad-hoc key files or shell-profile writes; trusted human Setup is the explicit managed-storage exception. Keep installation compatibility optional and README English/Chinese facts aligned.

## Acceptance gates

- Full, absent, incomplete, empty, and invalid external pairs; original vs hydrated environment; no address/key mixing or source fallback.
- Legacy configuration compatibility, reference-only persistence, concurrent saves, partial failures, and credential sharing across Providers/connections.
- No network on open/save; trusted-TTY-only secret input; masking, environment read-only status, endpoint-change consent, cancellation and restoration.
- API-root/prefix preservation, invalid URL rejection, public/private/loopback WeKnora support without grants, unchanged public-web/SearXNG address guards, pinned DNS, redirect refusal, response limits, TLS verification, and key/error redaction.
- Permission 403 vs authentication 401, business `success: false`, usable-index preflight, and valid empty results.
- Installed-entry contract checks, isolated Skill installation with no `arks` and complete environment pair, managed invocation, and regression checks for existing Web operations.
- Applicable real cross-platform TTY evidence remains a separate gate; skips/simulations are not human acceptance.

## Delivery issues

1. [Connection configuration and source resolution](issues/01-connection-resolution.md)
2. [Authenticated transport and verification contract](issues/02-transport-verification.md)
3. [Connection-specific Setup UI](issues/03-setup-connection.md)
4. [Managed retrieval and independent Skill qualification](issues/04-managed-retrieval.md)
5. [Field-based Setup and shared UX corrections](issues/05-setup-ux.md)
6. [Remove the extra IP policy and correct table allocation](issues/06-remove-extra-ip-policy.md)
