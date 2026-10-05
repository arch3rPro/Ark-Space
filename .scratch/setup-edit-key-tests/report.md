# Existing-key editing and all-key diagnostics

## Requested completion

Existing local keys load their saved value into the masked editor; editing is not a blank replacement prompt. The Provider test dialog supports both one round-robin pool operation and an explicitly consented diagnostic of every displayed configured key.

## Contract

- Environment-managed, shared-reference and owned-resource write guards remain enforced. Missing or invalid stored values refuse editing. Field Enter commits only to the draft; Esc restores that field. Changed saves retain validation and replacement consent. Unchanged saves do not write or ask to replace.
- Provider test starts on Cancel. Consent identifies live queries, fees/logging, and request budgets. Pool mode retains its five-second operation and normal rotation/state behavior.
- All-key mode requires the Provider to be enabled. It fixes each key target and runs sequentially, at most one request per key with a five-second per-key deadline, the fixed public query `Agent Skills documentation`, and at most one result. A successful key does not stop testing later keys. Disabled/cooling keys are deliberately included; unusable values are reported without network access.
- Diagnostics use an owned temporary state directory and clean it up, without persisting secrets or changing normal cursor/health/configuration. There is no cross-key or cross-Provider fallback. Reports show only references, classified outcomes and counts, never keys, raw error bodies, snippets or query results.
- Esc stops all-key diagnostics and displays partial outcomes; Ctrl-C retains full Setup cancellation. SearXNG remains keyless and keeps its instance-pool test.

## Evidence (synthetic qualification complete; human UX acceptance pending)

- Preload regression was RED for both actual CR/LF cases against the old blank draft, then GREEN with masked loading and editing.
- `npm run check`: 36 files / 426 tests passed, including fixed-target diagnostics and native dialog/cancellation checks.
- Independent review found a stale-consent issue. Two native-dialog tests were RED for removing a still-effective environment reference and disabling the Provider while consent was open. The all-key path now revalidates that the Provider is enabled and every authorized reference remains configured before diagnostics; both tests are GREEN. The helper never forces Provider enablement. Targeted independent re-review found no blocking issue.
- Source and offline isolated installed entries each passed **43 Linux PTY checks / 5 text frames**: [source](source-pty.json), [installed](installed-pty.json). Coverage includes 80×24 English and 60×16 Chinese masked preload, unchanged save, Cancel-first network consent, A-success followed by B-auth-failure with exactly two fixed-target requests, unchanged normal state, and Esc stopping active C before pending D while preserving partial results and Setup availability. `pty-check.py` uses synthetic keys and an owned Node fetch interceptor, never real network access. Owned processes, homes and installation directories were cleaned.
- `npm run verify:package`: 188 files / 231888 packed bytes, no runtime install scripts. `git diff --check` passed; reference worktrees remain unchanged. Build/typecheck passed. Active LSP probes reported no errors, but the silent push-only servers could not confirm clean rechecks; the full compiler result is the affirmative typecheck evidence.
- No publication, version change, global installation or real-user configuration changes. Human usability, real services, browser and Windows/macOS terminals remain unqualified.
