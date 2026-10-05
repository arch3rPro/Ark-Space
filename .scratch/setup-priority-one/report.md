# Priority-one optimization qualification

Status: all four authorized implementation items are completed and qualified within the Linux/synthetic boundary below. This is not a release, real-provider verification, human UX acceptance, or Windows/macOS terminal acceptance.

## Delivered behavior

### Key details

`i` now displays curated effective/local source and environment override information, provider configuration separately from normal key health, manual-disable/health reasons, cooldown, sharing and owned-resource kind counts, and actionable next steps. Credential values, raw provider responses/errors, resource URLs and other authority-bearing resource data are excluded.

Opening details re-reads the metadata snapshot and refuses a changed selected reference. Cooldown is explicitly a snapshot, not a live countdown while the notice is open. Existing ownership, shared-reference, effective-environment and read-only write protections remain enforced by management operations under locks.

### All-key diagnostics

Progress identifies the current reference independently of completed count. Classified results, safe completion timestamps and durations are retained only in memory for this Setup session and can be read through `i`, including across read-only provider-context switches. Managed write attempts conservatively clear retained results, as does a normal pool test; absent references are pruned on refresh.

Results are explicitly historical evidence, **not validation of the current credential**. External edits to an otherwise valid credential cannot be detected without storing its value or fingerprint; neither is retained. Known local replacements and removals invalidate cached diagnostics. All-key diagnostics remain isolated from normal persisted configuration, rotation, cooldown and health. Disabled/cooling keys remain included only through explicit all-key consent; provider enablement and consented reference membership are revalidated. Esc stops with partial rows and keeps Setup open; Ctrl-C exits Setup.

### Formal terminal regression

- `npm run test:setup` invokes the self-contained `scripts/test-setup-pty.mjs`, `scripts/setup-pty-check.py` and synthetic network-denying fetch fixture.
- Linux CI invokes it alongside the existing cross-platform checks. No historical `.scratch` helpers are imported.
- Tests launch the actual built CLI through stdlib PTYs, then pack and install a separate owned, **offline** CLI installation and test its `arks` entry. No global install, real API, real credential or real-user configuration is used.
- Coverage includes raw Shift-Tab/arrows/CR/LF/Tab/Space/Ctrl-S/Esc, masked existing editing, unchanged-save no-op, Cancel-first material action/network consent, disabled references, fixed A/B targets, C in flight with completed count two, cancellation before D, tiny resize, state fingerprints, temporary-directory/process cleanup and terminal canonical/echo/screen/cursor restoration.
- Real-byte readback additionally verifies normal manual-disable status remains distinct from successful session diagnostics, completion/duration fields and historical-result warnings are available through scrollable details, and opening details performs no persisted state/credential writes.

### Original-text Unicode lookup

`web.content.get` escapes the search text as a literal and uses locale-independent native Unicode case-insensitive matching on the **original** cached content. `matchIndex` and subsequent offsets remain original-string UTF-16 indices. Case-sensitive matching and output budgets are unchanged. It does not interpret regex syntax supplied in search text.

## Regression evidence

- Unicode RED: cached `İ Hello` searched for `hello` returned index 3 instead of original index 2. GREEN covers Turkish expanding-lowercase prefixes, Unicode/CJK/astral characters, literal metacharacters/backslashes, not-found and case-sensitive behavior, and the real built `arks invoke web.content.get` JSON/stdout/stderr boundary with initialized isolated configuration.
- Native session-history RED: `]`, `[`, then `i` lost the previous diagnostic result. Read-only refresh now preserves historical rows; the regression is GREEN.
- Fresh-details RED: details reported an already expired cached cooldown. Refresh on opening plus explicit snapshot labeling makes the regression GREEN.
- Formal PTY RED: a second unchanged save incorrectly satisfied a stale `No changes` wait and sent the next action before the form closed. The harness now waits for the current closed-form/resource-table state, not arbitrary longer sleeps or weakened input guards. Both raw CR and LF paths pass.
- Independent read-only review and follow-up found no confirmed correctness/security blocker. The cooldown snapshot limitation is explicitly documented.

## Final qualification

| Command / probe | Current result |
| --- | --- |
| `npm run check` | Passed project/link validation, compiler/build and **37 files / 443 tests** |
| `npm run test:setup` | Passed **60 Linux real-PTY logical checks for source** and **60 for offline isolated installed `arks`** |
| `npm run verify:package` | Passed: **188 files / 236046 packed bytes**, no runtime install scripts |
| Active LSP path probe | 11 changed code/test/script files checked; 0 errors, 11 clean outcomes, 0 inconclusive |
| `git diff --check` | Passed |

These counts qualify the final files, not earlier passing versions of the harness. Source build was refreshed before final terminal qualification; final full check and package verification also rebuilt successfully.

## Explicit remaining gates and boundaries

- **Windows/macOS real TTY are unverified**, tracked separately in task #36. Non-Linux skip results, simulated streams and ordinary cross-platform unit CI are not actual terminal qualification.
- Real provider services, human usability, browser behavior, mouse, arbitrary terminal/font geometry and end-user acceptance remain unclaimed.
- Package version remains **0.1.2**. No publication, tags, pushes, CI dispatch, global installation, reference-tree mutation or real-user credential/configuration changes were performed.
- User-created and unrelated uncommitted work was retained. Historical scratch evidence remains historical; the formal test entry is self-contained.
