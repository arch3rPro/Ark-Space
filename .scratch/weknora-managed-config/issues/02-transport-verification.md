# Add bounded authenticated connection verification

Status: resolved
Type: task
Blocked by: 01

## Scope

Define request, result, error, cancellation, and side-effect schemas before adding a WeKnora verification capability through the installed `arks invoke` boundary. Resolve non-Web envelope representation without adding WeKnora to Web Provider selection. Reuse pinned transport internals for configured-origin `GET /auth/me`; do not expose arbitrary URL/header forwarding.

## Acceptance

Consented verification has a five-second budget, no redirects, no ambient proxies, endpoint-specific CIDRs, pinned validated DNS, bounded responses, and cancellation. Classify 401, ambiguous 403, business failure, invalid JSON, timeout, and cancellation without raw payloads or secrets. Exercise the installed entry and preserve existing Web/MCP contracts. A successful probe proves only that route's acceptance.

## Comments

Follow the [spec](../spec.md). Do not claim the Skill uses managed credentials after verification alone.

## Answer

Implemented `weknora.connection.verify` through `arks invoke` and MCP. Strict consent input requires `confirmed: true`, separate `allowHttp: true` for plaintext transport, and an execution budget of at most five seconds. The additive non-Web envelope uses `connection: "weknora"` and no fabricated Provider or Web attempts. Request/result schemas are published under `schemas/protocol/v1/`; existing Web schemas and Provider IDs remain unchanged.

The narrow authenticated transport uses existing pinned/DNS-validated internals and fixes the path to `GET /auth/me`. Redirects, arbitrary headers/routes, ambient proxy use, unsafe addresses, oversized response headers/body, invalid encoding, and invalid TLS certificates fail closed. TLS remains verified despite an ambient disable setting. A 403 is ambiguous permission evidence, not key invalidation; non-2xx, business failure, malformed JSON, cancellation, and deadline are classified. Identity and raw errors are discarded. No persistent state, retries, key rotation, or fallback is introduced.

CLI machine invocation defers credential loading into its selected operation, preserving both JSON errors and complete external-pair independence from broken local credentials. Original environment provenance reaches CLI and MCP execution. Existing Web invocation still receives locally loaded credentials.

Verification:

- Initial RED: missing registration/contracts; later RED caught pre-dispatch credential bootstrap rejecting external and managed broken-store cases outside the JSON boundary.
- `npm run check`: validation, typecheck, build, and 515 tests across 39 files passed.
- Offline temporary npm installation, then `ARKSPACE_VERIFY_ENTRY=<temporary installed .bin/arks> npm test -- tests/weknora-verify.test.ts`: 23 tests passed using synthetic credentials and isolated homes, including CLI/MCP provenance and broken stores.
- `npm run verify:package`: passed; no synthetic TLS fixture is packaged.
- Active LSP probe: 11 changed TypeScript files, no diagnostics.
- Runnable regression tests include redirect refusal, all-address DNS validation/pinning, response/header caps, proxy rejection, HTTP consent, cancellation, and synthetic TLS rejection with a permissive positive control.

Setup, canonical Skill routing, retrieval, imports, and chat remain unchanged. No real WeKnora service or hosted cross-platform qualification, publication, or version changes were performed.
