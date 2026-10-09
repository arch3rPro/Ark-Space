# Connect managed retrieval while preserving independent Skill use

Status: resolved
Type: task
Blocked by: 01, 02, 03

## Scope

Verify API evidence and define bounded knowledge-base detail and single-knowledge-base hybrid-search contracts. Implement them through the installed machine boundary using the same connection resolver and safe transport. Check retrieval capabilities before searching. Default knowledge-base ID is a preference, not an authorization boundary.

Update canonical Skill guidance only after these operations work: complete external pair uses the independent REST/script path without `arks`; absent pair can use supported managed operations; incomplete pair stops. Clearly identify environment-only operations still outside the managed slice, including imports and SSE chat. Do not export raw credentials for those operations or silently switch source after failure.

## Acceptance

Validate response boundaries, no-index vs empty data, null/empty results, permissions, cancellation, defaults/explicit target, and secret redaction. Qualify installed-entry invocation and isolated Skill use without CLI/repository siblings. Update installation, architecture, capability docs, and English/Chinese README facts consistently with valid local links. Run applicable package-defined checks and report real-service/cross-platform gaps honestly.

## Comments

This issue, not Setup persistence alone, completes the first usable managed Skill slice in the [spec](../spec.md). Future managed writes/chat need their own completion and side-effect contracts.

## Answer

Implemented bounded knowledge-base list/detail and single-base search, with pinned API-field evidence, original-environment connection selection, default/explicit ID rules, mandatory vector/keyword preflight, null/empty success, nonretryable scoped errors, cancellation/deadline, strict response projection and credential redaction. Installed CLI/MCP expose identical non-Web envelopes and validated schemas. Machine bootstrap now defers all WeKnora connection resolution into its operation; complete external pairs remain independent of broken stored credentials, and invalid-input failures retain the correct non-Web envelope.

Canonical Skill guidance now has an explicit optional managed reference and independent environment path. It stops on incomplete pairs, does not install the CLI implicitly, and does not export secrets for operations outside the managed scope. A copied standalone Skill's SSE path is tested outside the repository with empty PATH and no ArkSpace config. Installation, capability, MCP, architecture, accepted ADR, and English/Chinese README facts are aligned without release/version changes.

Verification: `npm run check` passed 556 tests in 41 files; offline installed-entry and independent-Skill qualification passed 59 tests in 4 files; `npm run test:setup` passed 71 source + 71 installed Linux real-PTY checks including WeKnora-specific save/remove/consent scenarios; package validation and active LSP checks passed. Detailed evidence and explicit real-service/human/hosted-OS gaps are in the [completion report](../report.md).
