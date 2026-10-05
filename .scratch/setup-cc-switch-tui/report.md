# Historical partial three-axis Setup TUI — verification

**Completion claim withdrawn:** the user rejected this implementation's passive top strip and retained browse toolbar/subfocus model. The results below cover that partial implementation only. Current whole-rebuild evidence is in [the replacement report](../setup-tui-rebuild/report.md); do not run the old navigation scenarios as current qualification.

## Implemented contract

User approved `design-review.md` with “同意 继续”. Native sources now separate the top Exa/Tavily/Firecrawl/SearXNG context, left Providers/Configuration/Settings/Exit function menu, and right content/edit mode. This replaces the rejected six-destination sidebar; it is not merely moved labels.

- Left/Right changes browse panes; Up/Down selects. Menu Enter opens a function. `[`/`]` changes provider context outside forms/overlays/busy states. Search order and language remain global.
- Resource Enter/e opens a right-pane draft. Field Enter starts editing, another Enter commits only to the draft, and field Esc restores its pre-edit value. Tab/Shift-Tab is ignored during field editing; otherwise traversal is directional. Ctrl-S validates the draft through existing action-specific guards. Confirmation cancellation retains the draft; dirty form cancellation defaults to Cancel/Discard.
- Key editing stays masked, with grapheme count, caret and a horizontal window. Existing-key preview remains read-only and masked until explicitly revealed; tiny resize clears disclosure. No raw values appear in ordinary state, status, diagnostics or archived text frames.
- Root exit defaults to Cancel. No Y/N confirmation shortcut. Saving/opening stays offline; an explicit connection test requires consent and uses the shared bounded dispatcher.
- Existing ownership/shared-reference/environment, endpoint/CIDR, routing and cancellation guards remain. No backend, dependency, version or reference-tree change was required by this redesign.

## Fresh evidence

| Check | Result | Artifact |
| --- | --- | --- |
| `npm run check` | 35 files / **379 tests passed** | `check.log` |
| `npm run verify:package` | **185 files / 226540 packed bytes**, no runtime install scripts | `verify-package.log` |
| Built source entry | **106 Linux PTY assertions** | `source-pty.json` |
| Offline isolated installed entry | **106 Linux PTY assertions** | `installed-pty.json` |
| Active error-level LSP | six changed source/test/script paths clean | session diagnostic probe |

Each PTY report contains **10 text frames**, not screenshots. Counts include repeated readiness and cleanup assertions, not 106 unique scenarios. Final package verification includes documentation-only evidence updates; installed executable sources are unchanged. Local-link validation and `git diff --check` passed; the reference worktree is clean.

Actual PTY checks cover independent menu/provider state, empty-list Enter, field-only draft commit, fragmented Left/Right CSI input, editing Tab isolation, full synthetic key round-trip, field rollback, masked preview and explicit reveal/redaction, tiny disclosure reset, default-Cancel Delete/Discard/Exit, global order surviving context/help, global language, NO_COLOR and styled bilingual compact frames, non-TTY nonmutation, offline private-CIDR authorization, default-canceled test versus explicitly authorized fixed-query localhost test, Ctrl-C and resource cleanup.

Independent text-cell checks show aligned header/pane widths **79 at 80×24** and **59 at 60×16**. Compact right-content editing puts the actual caret at **row 6, column 40** for the 29-grapheme synthetic value; full-width diagnostic placement is row 6, column 60. Undersized Ctrl-S cannot write files; restoring size retains input. This qualifies the tested text geometry, not arbitrary fonts.

Production-page regressions additionally cover rejected-paste Escape/discard tails, bounded fragmented CSI and bracketed paste, timer cleanup, reverse traversal, canceled replacement/authorization retaining drafts, inherited CIDRs clearing after endpoint changes, and explicitly edited CIDRs surviving invalid-URL validation retries. The parser drains rejected tails until 150 ms quiet; lone Escape has a 50 ms delay, with a bounded 32-unit CSI prefix and 8192 + 12 paste buffer.

## Scope and cleanup

Only synthetic credentials, owned temporary homes, and an owned localhost HTTP fixture were used. Reveal frames are redacted; no real keys, external service requests, or user setup writes occurred. Owned CLI processes, listener, temporary package and offline installation were cleaned. No global install/upgrade, publication, tag or version change; package remains **0.1.2**.

Read-only reference: https://github.com/SaladDay/cc-switch-cli, revision `b563ce17fdcc5316701ee8ba00368bdeb24b929a`, MIT. Source/screenshots consulted; no source/assets/dependencies imported and no execution of the reference application claimed.

Human usability acceptance, real-service behavior, Windows/macOS terminals, arbitrary font/emoji geometry and browser screenshots remain **unverified**. Earlier 355/168, 344/143 and older results belong to prior layouts, not this design. `diagnostic-pty.json` is exploratory evidence before the final expanded harness; final source/installed reports above are authoritative.

## Reproduction

```bash
npm run check
npm run verify:package
python3 .scratch/setup-cc-switch-tui/pty-check.py --report .scratch/setup-cc-switch-tui/source-pty.json
node dist/cli/main.js setup --lang zh
```

The final command is for a trusted human terminal; do not capture real keys through an Agent. The Linux/Python standard-library harness accepts `--entry <owned-installed-dist-cli-main.js>` and reuses fixtures from the historical verification directory, not its old navigation scenarios.
