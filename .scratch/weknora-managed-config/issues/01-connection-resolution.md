# Define optional WeKnora connection resolution

Status: resolved
Type: task

## Scope

Implement the connection schema, original-environment-aware pair resolver, safe snapshot, and connection-specific save/remove operations from the [spec](../spec.md). Keep WeKnora outside `ProviderId` and search order. Use existing credential validation, private storage, atomic writes, and locks.

Extend credential-reference accounting to include connections so Provider mutation cannot silently remove or replace a connection's shared secret. Handle credential-save/config-save partial failure honestly. Finalize dedicated reference naming and external-reference rules before implementation.

## Acceptance

Tests cover old configs, full/absent/incomplete/empty external pairs, hydrated vs original environment, no mixed pairs, no fallback, shared references, concurrency, redaction, and partial writes. Saving performs no network request.

## Comments

The dual-path boundary is accepted. The configuration-only slice is implemented; Setup, HTTP transport, and managed Skill execution are not yet available.

## Answer

- Added optional reference-only `connections.weknora` and the dedicated `env:ARKSPACE_WEKNORA_API_KEY` reference. API roots must explicitly end in `/api/v1`; narrow CIDRs are IPv4 /24 or narrower and IPv6 /64 or narrower.
- Resolution requires the original environment explicitly. Full external pairs do not read local secrets; incomplete/empty pairs and externally overridden managed references fail rather than mix sources.
- Added nonsecret snapshot and locked offline save/remove functions. Saved-key replacement requires explicit consent, including orphaned credentials; endpoint changes require saved-key-reuse consent even when a masked form resubmits the same value. Ranges require fresh authorization and reset when omitted.
- Shared-reference accounting protects connection credentials from Provider mutation and preserves them on unlink. Partial writes report the actual persisted state without secret or raw IO details.
- RED regression checks exposed concurrent silent overwrite and same-value endpoint consent bypass; both were fixed. `npm run check` passed project validation, typecheck, build, and 492 tests across 38 files, including 39 WeKnora configuration tests. Active LSP checks on four changed TypeScript files found no diagnostics; `git diff --check` passed.

No remote request, Setup UI change, protocol addition, release/version change, installed-entry qualification, or hosted cross-platform qualification was performed.
