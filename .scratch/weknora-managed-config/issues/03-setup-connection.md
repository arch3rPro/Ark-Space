# Add connection-specific WeKnora Setup UI

Status: resolved
Type: task
Blocked by: 01, 02

## Scope

Approve the ADR 0017 layout extension before implementing a WeKnora context/page. Reuse terminal forms, draft/save/cancel, masking, confirmations, busy operations, and restoration; do not model this connection as a keyed search Provider.

Support explicit API root, one key, optional manually entered default knowledge-base ID, and narrow private-range consent. Show external overrides read-only, keep saved/effective source distinct, and require acknowledgement before sending an existing key to a changed endpoint. Removal is local only.

## Acceptance

Opening/saving does not access the network. Tests cover non-TTY handling, secret masking, dirty/unchanged saves, external configuration, endpoint changes, replacement/removal, consented probe, cancellation, and terminal restoration. Online knowledge-base selection waits for the supported detail/list contract rather than using raw requests. Real human and cross-platform acceptance is reported separately from PTY simulations.

## Comments

Follow the [spec](../spec.md); no release/version changes are authorized.

## Implementation report

The user explicitly requested completion of the connection-specific context/page in this run. `setup weknora` opens the connection, and Web pages advertise `w WeKnora`; Top arrows and brackets cycle service contexts. The three focus regions and four menu functions remain unchanged; the first menu label becomes Connections for this context. After user UX feedback, the top strip displays all five labels when width permits and windows only when needed; selected labels remain visible and summary/body positions are preserved. WeKnora is not added to ProviderId, search order, rotation, health, or fallback.

`src/cli/setup-weknora.ts` owns the concrete connection page. It reuses terminal forms and busy/confirmation controls, masks the local key, shows saved/effective metadata separately, refuses external/conflicting edits, and supports offline manual default KB ID and narrow endpoint CIDRs. Changing endpoints clears inherited ranges and requires saved-key reuse acknowledgement; key replacement and private-network authorization have separate Cancel-default confirmations. Unchanged saves close without writes/consent. Removal affects only the local connection/unshared credential, including when an external pair is active. Partial save/unlink errors remain curated and reference-only. Optional verification calls the existing five-second `/auth/me` capability only after network consent and separate HTTP plaintext-risk consent; Esc stops it, and only classified outcomes are displayed. No online KB browsing is introduced.

Changed files: `src/cli/setup.ts`, `src/cli/setup-workbench.ts`, `src/cli/setup-language.ts`, new `src/cli/setup-weknora.ts`, and new `tests/setup-weknora.test.ts`. Main/config/protocol/MCP/Skill ownership was left with the parent and parallel implementation.

Evidence:

- Test-first baseline: `npx vitest run tests/setup-weknora.test.ts` initially failed all 7 initial connection cases; the later discovery case failed before its binding was implemented.
- `npx vitest run tests/setup*.test.ts tests/config.test.ts tests/weknora-config.test.ts`: **8 files, 291 tests passed**, including 15 new WeKnora Setup checks. Native stream tests exercise actual form masking/save/discard and probe Esc cancellation with raw/listener restoration; these are not OS PTYs.
- `npm run typecheck`: passed after shared capability integration settled.
- Active LSP probe: five changed TypeScript files clean, zero diagnostics.
- `npm run test:setup`: passed; existing real Linux PTY regression suite performed **60 source-entry + 60 offline installed-entry logical checks**. This suite qualifies the retained Web/terminal behavior, not new WeKnora-specific real PTY scenarios.

Parent integration added WeKnora-specific real Linux PTY coverage to `scripts/setup-pty-check.py`. The final `npm run test:setup` passed 71 source-entry + 71 offline-installed-entry logical checks, including new offline save/default/key masking, unchanged-save, Cancel-default probe/remove, confirmed local removal, and terminal restoration scenarios. Full integration/documentation and 556 project tests passed; see the [completion report](../report.md).

Remaining qualification limits: no actual user secrets or live instance were used; real services, human usability, and hosted Windows/macOS terminals remain unverified. Parent updated the accepted optional-connection ADR and spec to record the authorized context extension; no release/version changes were made.
