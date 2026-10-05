# Whole Setup TUI rebuild — implementation and verification

## Scope

The user rejected incremental changes and explicitly requested a whole reference-driven Setup TUI rebuild. The prior 379-test/106-PTY work was partial and is not qualification for this replacement.

The browse controller and its typed rendering contract were rewritten in `src/cli/setup-workbench.ts` and `src/cli/setup-terminal.ts`. The old action/control arrays, cursor indices, nested `resources/actions/controls` focus loop, two stacked button bars, and toolbar activation dispatch are removed. Existing backend management/security helpers and validated low-level input/secret primitives remain; no dependency, provider protocol, credential schema, release version, or reference code was changed.

## New model

- Actual focus regions: **Top / Menu / Content**, cycled with Tab/Shift-Tab. Top Left/Right changes provider; Top Down/Enter enters content. Initial focus is Menu. Brackets remain an advertised alternate, not the only way to switch providers.
- Functional Menu Up/Down selects, Enter opens, Right enters Content. Content Left consistently returns to Menu. There is no focusable browse toolbar.
- A primary resource table/list occupies the content pane. The single page-binding table supplies nonfocusable intent hints and keyboard dispatch; actions operate on content rows. Provider state moves to the wide header or compact content summary rather than a second button bar.
- Provider intents: Enter/e edit; a add; i details; p secure preview; d remove; Space selected-key enablement; **V provider enablement**; **t provider-pool test**, explicitly not a selected-key test. Existing ownership/environment/shared-reference and network-consent guards remain.
- Global order is a list: u/d reorder, Delete remove, I confirmed inclusion, Ctrl-S guarded save. Dirty Esc asks Cancel/Discard and preserves drafts when canceled. Global language is an option list with Enter Apply. Provider changes preserve these global states and per-provider selection.
- Right-content editing retains field Enter/edit/draft commit, field Esc rollback, whole-draft Ctrl-S validation, retained drafts after canceled consent, masked grapheme count/caret, bounded fragmented input and paste draining. Forms/overlays/busy states own input before browse dispatch.
- Badge and focus-specific footer directions follow the session language; the critical top-switch instructions fit 60×16 in English and Chinese.

Reference: https://github.com/SaladDay/cc-switch-cli, revision `b563ce17fdcc5316701ee8ba00368bdeb24b929a`, MIT. Its current source and screenshots informed the structure and row-intent model. No Rust/assets/dependencies imported; reference worktree clean. A one-line header, wrapped content hints below the table, and an operable Top focus are ArkSpace adaptations, not pixel-identical screenshot reproduction.

## Fresh evidence

- **`npm run check`: 35 files / 402 tests passed**, `check.log`.
- **Source entry: 88 Linux PTY assertions**, `source-pty.json`.
- **Offline isolated installed entry: 88 Linux PTY assertions**, `installed-pty.json`.
- **Package: 185 files / 227616 packed bytes**, no runtime install scripts, `verify-package.log` (including final documentation-only evidence updates; installed executable sources unchanged).
- Active error-level LSP: six source/test/script paths clean. Independent bounded source review confirmed the old browse model is gone, top focus is operable, and overlays retain input ownership; no additional critical defect was established within that read.
- `git diff --check` passed; reference worktree clean. Owned package/installation, synthetic homes, terminal processes, and localhost listener were cleaned.

The new black-box harness was RED against the previous built UI on the actual Top-focus/Right-switch scenario. Fresh production-byte regressions also exposed and fixed CR/LF page-intent normalization; named controls now take precedence over raw single-byte sequences. CR/LF editing/language, ASCII Space/V, ANSI Delete, uppercase I and Ctrl-S are exercised through actual terminal input, not just key-name mocks.

Each PTY report archives **10 text frames**, not screenshots. Assertion counts include repeated readiness and cleanup checks, not 88 unique scenarios. They cover top arrow switching, absence of nested toolbar traversal, early primary-table placement, masked right drafts and exact synthetic credential save, fragmented CSI and editing Tab isolation, preview/reveal/tiny reset, default-canceled Delete/Discard, global order/context/help preservation, global language, styled/NO_COLOR bilingual compact frames, non-TTY nonmutation, canceled and authorized CIDR saves, explicit localhost-only provider test and Ctrl-C cleanup.

An initial `ctx_batch_execute` full-suite attempt injected `__CM_FS__` counters into child stderr, failing strict CLI output assertions and a timing-sensitive UI readiness assertion. Those results are not claimed clean. The exact suite was rerun through `ctx_execute` without that batch injection and passed all 402 tests; production/test stderr assertions were not weakened.

## Limits

No real credentials, external service requests, user setup writes, global installation/upgrade, publication, or version change. Version remains **0.1.2**. The global `arks` installation was not replaced; use the source command below to review this implementation.

Automated checks are implementation evidence, **not user acceptance**. Human usability, mouse interactions, real services, actual Windows/macOS terminals and arbitrary fonts remain unqualified. Do not reuse prior layout evidence or call a successful test count complete UX acceptance.

## Reproduction

```bash
npm run check
npm run verify:package
python3 .scratch/setup-tui-rebuild/pty-check.py --report .scratch/setup-tui-rebuild/source-pty.json
node dist/cli/main.js setup --lang zh
```

The final command belongs in a trusted human terminal. Never capture real keys through an Agent. The harness uses Python standard-library facilities and synthetic/owned resources only; `--entry <owned-installed-dist-cli-main.js>` exercises an isolated installation.
