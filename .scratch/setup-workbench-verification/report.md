# Historical cc-switch-inspired setup TUI verification

**Superseded:** this report describes the rejected six-destination sidebar implementation. Current three-axis design evidence and reproduction live in [the approved redesign report](../setup-cc-switch-tui/report.md). Keep the results below as historical evidence, not current qualification.

## Reference and implemented contract

User authorized refactoring setup using read-only `reference/cc-switch-cli`. Source/screenshots were inspected, not executed. Upstream https://github.com/SaladDay/cc-switch-cli, revision `b563ce17fdcc5316701ee8ba00368bdeb24b929a`, MIT. No Rust source, assets, dependencies, backend or configuration behavior was copied; provenance is recorded in ../../NOTICE.md. The reference worktree remained clean.

Native implementation stays in `src/cli/setup-terminal.ts` and `src/cli/setup-workbench.ts`:

- Bordered three-line brand header, fixed navigation and full-width content table, separate status/footer. Six destinations only: Exa, Tavily, Firecrawl, SearXNG, Search order, Language. No dashboard or permanent right details pane.
- Sidebar Up/Down moves only a pending cursor; Enter opens the destination. `*` marks the opened page independently from `>` selection. Esc from content restores navigation to the opened page. Tab/Shift+Tab retains region traversal; lists use vertical arrows and buttons/carets horizontal arrows.
- Typed table columns/cells show reference/URL, source and state directly from metadata, never by parsing translated rows. Active borders are bold cyan; active rows/buttons are black-on-cyan. State badges retain green/red/amber/cyan semantics; unavailable buttons remain gray/dim without `×`. Modal backgrounds are unfocused. `NO_COLOR`/`TERM=dumb` suppress SGR styles.
- Page-top actions use complete-item windows, keeping focused Preview/Cancel visible at 60×16. `[?]` exposes contextual help; `!` retains diagnostics. Workbench and preview help preserve selection/drafts and disclose no secret. In forms literal `?` remains input, not help activation.
- Forms use field/value rows. Normal secret input remains masked, with grapheme counts, editing/caret and a horizontal mask window. Default-Cancel action confirmations never accept Y/N. Key preview remains masked by default with explicit Show full/Hide/Close, read-only source labeling and disclosure reset after undersized transitions.
- Retained ownership/shared/environment guards, explicit private-CIDR consent, independent provider enablement/order, offline opening, bounded confirmed live tests, curated errors and terminal restoration.

## Fresh evidence

- `npm run check`: validation/type checking/build and **35 test files / 355 tests passed**, `check.log`.
- `npm run verify:package`: **185 files / 223463 packed bytes**, no runtime install scripts, `verify-package.log`.
- Built source entry: **168 Linux PTY assertions**, `source-pty.json`.
- Offline isolated installed entry: **168 Linux PTY assertions**, `installed-pty.json`. Owned package and installation removed; no global installation.
- Each PTY report contains **18 text frames**, not screenshots. Assertions include repeated readiness and cleanup checks, not 168 unique scenarios.
- Active error-level LSP: six changed source/test/script paths clean. Generic style warnings/hints are not claimed eliminated.
- Local Markdown links (`npm run validate`), `git diff --check`, and read-only reference-worktree checks passed.

New real-entry checks cover pending navigation versus actual page activation, contextual help and draft preservation, source/status table headings, independent border-column measurements after Firecrawl Esc return, active/inactive button color focus, narrow whole Preview visibility, literal-question-mark secret round-trip and preview-help secrecy. Retained checks cover mask/count/deletion/caret behavior, explicit disclosure/re-mask, byte-preserving preview/non-TTY operation, many-item selection, order Save/Cancel, global locale and exit messages, private CIDR consent, one fixed-query local dispatch, cancellation, raw/echo restoration and process/listener cleanup.

At 80×24, independent zero-based pane borders are columns **0/17/19/78**; at 60×16 they are **0/15/17/58**. Header rows are 1–3, pane title row 4, actions row 5, controls row 7, table headings row 9. Resource viewport is 12 rows wide and four rows compact; smaller than 60×16 blocks actions. Width evidence is common text/CJK cell measurement, not universal font qualification.

Only synthetic credentials and an owned localhost HTTP fixture were used. Full synthetic value output is permitted only in deliberate Show full intervals; archived reveal frames redact it. No real credentials, external service requests or real-user setup writes occurred. The final package verification includes documentation-only evidence updates after the isolated installation; installed CLI source is unchanged.

## Historical evidence and limits

Previous 344-test/143-assertion, 333-test/89-assertion and 317-test/60-assertion results belong to earlier layouts. They do not qualify this refactor. Full-suite language-exit tests were updated to activate the Language destination with Enter rather than expecting arrow-driven page changes; the same Chinese cancel/fatal assertions remain.

No version change, publication, global upgrade or reference modification. Version remains **0.1.2**. Human usability acceptance, real-service behavior, actual Windows/macOS terminals and arbitrary font/emoji geometry remain unverified. Existing backend ambiguity between untouched and explicitly registered identical missing default references remains; both are suppressed.

## Reproduction

```bash
npm run check
npm run verify:package
python3 .scratch/setup-workbench-verification/pty-check.py --report .scratch/setup-workbench-verification/source-pty.json
node dist/cli/main.js setup --lang zh
```

The last command is for a trusted human terminal. The harness accepts `--entry <owned-installed-dist-cli-main.js>` and uses Linux/Python standard-library facilities only. Keep real keys out of Agent captures and chat.
