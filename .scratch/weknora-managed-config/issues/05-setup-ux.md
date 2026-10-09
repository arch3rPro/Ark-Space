# Make Setup understandable and truly field-based

Status: resolved

## User feedback

Deliver the following corrections together, across WeKnora and shared Setup presentation:

1. Explain private-server access plainly; it is a network safety exception, not WeKnora knowledge-base permission.
2. Even an empty connection edits exactly one selected field. Remove configure-all forms. Preserve the complete address/key runtime boundary: incomplete values are session-only drafts, shown as pending; completion saves the valid pair together. Ordinary exit must explicitly discard pending values with Cancel as default.
3. Provide the same masked-default, explicitly revealable, read-only secret preview as other providers.
4. Details must be concise and avoid redundant source/address/specification lectures.
5. Show actionable human-readable verification outcomes. A blocked destination is not proof of a wrong API address or key. Diagnose the transport rather than disable DNS validation, pinning or private-address protections.
6. Reduce unnecessary left-menu width and allocate right-table columns to their content across all services. Keep focused objects, metadata, forms and cursor positions correct on resize.
7. Say where credentials are stored; do not label a path merely “plaintext storage”. Do not imply the file is encrypted.
8. Replace repetitive masked/offline/no-test implementation vocabulary with relevant actions and completion semantics.
9. Provide a usable API-address example and put unencrypted-HTTP risk acknowledgement at the actual network test, not a wall of address-field instructions. Changing an endpoint still resets its network exceptions and requires existing-key reuse consent.

## Completion evidence

Implemented the field-only Setup flow, session drafts and guarded discard, selected-key preview, short source-aware test outcomes, concise details and field-specific notes. Shared menus use 15 English / 12 Chinese cells and data-aware table allocations; labels and resized form/caret coordinates are covered. No machine/security source-selection or transport protections were relaxed.

`npm run check` passed 602 tests in 41 files. `npm run test:setup` passed 84 source + 84 offline-installed Linux real-PTY checks, including empty single-field setup, no incomplete-file writes, completed-pair persistence, masked saved/pending previews, unchanged saves and Cancel/default confirmed draft discard. Three consecutive final reruns passed. `npm run verify:package` passed with 210 packed files and no runtime install scripts. A real synthetic HTTP test demonstrates blocked-before-authentication then consented exact-address success with unchanged credentials.

Only isolated homes, synthetic credentials and test services were used. The user's actual service/DNS, Windows/macOS real TTY and human UX remain unqualified. Detailed caveats and verification are in the [completion report](../report.md).
