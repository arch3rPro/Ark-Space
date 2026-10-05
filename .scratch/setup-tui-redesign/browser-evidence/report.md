# Independent prototype browser validation — BLOCKED

Date: 2026-10-04. Parent task 20 remains **in progress**. No prototype correction or formal TUI work was performed.

## Actual results

- Read root `AGENTS.md`, `README.md`, `INSTALL.md`, and the prototype README/spec before installation.
- Retrieved official browser documentation from https://playwright.dev/docs/browsers. Used documented temporary `PLAYWRIGHT_BROWSERS_PATH`; did not use `install-deps`.
- Official npm metadata request: `npm view playwright version repository license dist.integrity --json --registry=https://registry.npmjs.org`.
- Resolved and pinned **Playwright 1.63.0**, repository `https://github.com/microsoft/playwright.git`, license **Apache-2.0**. Integrity is preserved in `playwright-registry.json`. Only API usage, no upstream source copied into the repository.
- Temporary npm install passed with `--prefix <mkdtemp>/runtime --cache <mkdtemp>/cache --ignore-scripts --no-audit --no-fund`, official registry and pinned version.
- `node <temporary runtime>/node_modules/playwright/cli.js install chromium` passed. Headless shell selected by Playwright was build **1243**. Actual Chromium runtime version is unavailable because launch failed.
- **Browser launch blocked**: `chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory`; process exit 127. No OS dependency installation was attempted.
- Browser behavioral checks: **0 passed, 0 failed, all unexecuted**. This is an environment blocker, not a prototype test failure.
- `node --check .scratch/setup-tui-redesign/browser-check.cjs` passed. This is syntax validation only, not browser validation.
- No screenshots or browser geometry measurements were produced. No images were available for visual inspection.
- Reported zero page/console errors and network attempts mean **no page was launched**, not proof of error-free rendering or network behavior.

## Repeatable browser check

New script: `.scratch/setup-tui-redesign/browser-check.cjs`.

On an already suitable host, install the pinned package/browser in a temporary directory, then invoke with:

```bash
PLAYWRIGHT_MODULE_PATH="$TEMP/runtime/node_modules/playwright" \
PLAYWRIGHT_BROWSERS_PATH="$TEMP/browsers" \
node .scratch/setup-tui-redesign/browser-check.cjs
```

The caller must own temporary installation/removal and apply a process deadline. The script needs no repository dependency installation, build, server, or actual API. It opens the independent `file://` HTML with its sibling model, owns a headless context, blocks/logs requests except `file:`/`data:`, closes each case page, continues after independent case failures, and closes its context/browser in `finally`. It writes only browser evidence and screenshots under this scratch directory. `results.json` distinguishes launch blockers from case failures.

Coverage queued but **not executed**: normal/empty/add/yN/partial-error/compact/tiny screenshots and geometry; single global language entry; no fake empty rows and empty-entry focus; add/save selection; Escape focus restoration; environment/owned/shared guards; default-No Enter and focused-Yes Enter, y/n/Escape; textbox y; Tab/Shift-Tab region and modal traps; Many12 paging/Home/End/stable reference selection; order draft Cancel/Save; dirty draft sidebar leave/return; SearXNG invalid URL/permissions reset/private consent; partial orphan retention/no registered row; locale focus; simulated connection; resize/draft/modal bounds; tiny pointer and keyboard protection including modal resize.

Additional requested distinctions explicitly queued:

1. Dirty order draft → another sidebar page → return must not silently discard the draft without confirmation.
2. External **key** reference unlink may be valid; external-only **SearXNG URL** removal must not pretend to mutate local configuration.
3. Tiny viewport Tab must not leave focus in an invisible modal; Enter/y must not accept hidden dangerous operations.

## Read-only inspection risks (not reproduced browser failures)

The existing source suggests these cases merit close review: `navigate('order')` reconstructs `orderDraft`; generic removal permits `source === 'environment'` without the SearXNG distinction; tiny-mode key handling allows native Tab while hiding an open dialog. The spec proposes compact single-column layout, but CSS retains a two-column grid at 600px. These are **static observations only**, not observed browser behavior, and the prototype has not been changed.

## Cleanup and evidence

- `cleanup.txt`: temporary root `/tmp/ark-setup-browser.oTHcam` removed, including npm prefix/cache and downloaded browsers; tracked diff and prototype/model hashes unchanged.
- Launch logs show Playwright killed/reaped the failed child and cleaned its temporary profile. Subsequent check found PID 329312 absent and `/tmp/playwright_chromiumdev_profile-QOGPzm` absent.
- Launch failed before a Browser object was returned, so `browser.close()` could not be called; the script's `finally` closes any successfully created Browser. Playwright handled the failed launch cleanup.
- The first metadata-processing attempt combined npm stdout/stderr, so an npm update notice made JSON parsing fail. This was a harness issue, corrected by separating streams. No prototype checks were attempted then; that temporary directory was also removed (`initial-metadata-harness-cleanup.txt`).
- `install-stages.txt`, `playwright-registry.json`, `results.json`, and `browser-check-failing-tail.txt` preserve stage/provenance/failure evidence. Captured output was bounded; only failing tails were retained.
- No apt, install-deps, global installs, project package changes, real credentials, API requests, DNS/proxy/security changes, or production source edits.

Next step: run this scratch-only browser check on a host already satisfying Chromium's OS dependencies, or obtain separate explicit authorization for environment preparation. Do not approve implementation or mark browser acceptance complete on this evidence.
