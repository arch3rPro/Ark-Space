# CLI update version drift

Status: source fix implemented and verified; not a new npm release.

## User-host result

The user reported macOS, Node 25.9.0, npm 11.12.1, and npm prefix/root under `/opt/homebrew`. `arks`, `node`, and `npm` all resolved through `/opt/homebrew/bin`; the Node executable resolved into the Homebrew Cellar. After manually installing official `@arkspace/cli@0.2.0`, the user observed version 0.2.0 and an `up-to-date` result from `arks update --check --json`.

The old installed package's manifest was not retained, so its exact version cannot be inferred solely from the old CLI's `0.1.5` output. The current development machine's separate source link was not used as evidence about this Mac and was not changed.

## Confirmed package defect

Read-only inspection of official npm tarballs, after SHA-512 integrity checks, found:

| Published package | package.json | Built CLI | Built MCP |
| --- | --- | --- | --- |
| 0.1.5 | 0.1.5 | 0.1.5 | 0.1.5 |
| 0.1.6 | 0.1.6 | 0.1.5 | 0.1.5 |
| 0.1.7 | 0.1.7 | 0.1.5 | 0.1.5 |

`verifyTarget` correctly requires the executing global package to have the current runtime version. The duplicated old literals made ordinary 0.1.6/0.1.7 installs fail that identity check and receive the generic source/local/linked refusal. This is a confirmed defect in those artifacts, not definitive proof of which old artifact was installed on the user's Mac.

## Correction

- `src/version.ts` reads bounded, validated version metadata from the package itself, with a fixed error for invalid identity. CLI and MCP share that source in source and built/installed layouts.
- Stable-only update selection remains unchanged; valid prerelease/build labels can still be reported by `--version`.
- Installed-entry verification scripts derive the expected version from the package rather than a duplicated literal.
- Packaging requires the version module, checks root lockfile versions, and executes the built CLI under an isolated ArkSpace home to compare its version with `package.json`.
- The global-target, symlink, confirmation, timeout, cancellation, TLS and lifecycle-script protections in `src/cli/update.ts` are unchanged.
- Installation guidance documents recovery for the affected old packages; the change ledger records this source correction under Unreleased.

## Verification

Before the fix, a manifest-only version change in an isolated npm-global layout reproduced the exact refusal despite a valid global target. The copied MCP package also reported the old build-time version. Both public-entry regressions passed after the correction.

Commands run:

```bash
npm test -- tests/cli-update-entry.test.ts tests/mcp.test.ts tests/cli-entry.test.ts
npm run typecheck
npm run verify:package
npm run validate
node --check scripts/test-installed-hosts.mjs
node --check scripts/test-setup-pty.mjs
```

Results: **64 tests across three files passed** (51 updater, four MCP, nine CLI entry). Package verification passed with **330 files**; typecheck, project validation, both script syntax checks and active LSP diagnostics on five changed TypeScript files passed with zero diagnostics.

A separate disposable package-copy self-check passed with a consistent manifest-only version bump, then failed specifically at the new built-version gate when its CLI was deliberately replaced with an old literal. The repository and real global installation were not altered by that check.

## Boundaries

No project/plugin version bump, publish, tag change, remote push, global installation or credential change was performed for this fix. The published 0.2.0 artifact remains immutable. The additional source guardrails require a future separately authorized release; the user's manual recovery to existing 0.2.0 is already confirmed.

Unrelated concurrent edits in `src/config/nitter.ts`, `src/protocol/x-schema.ts`, and X failure handling in `src/cli/main.ts` are outside this fix and are left untouched, including when staging the shared CLI file.

The full runtime suite and Setup PTY suite were not rerun: operation logic and terminal behavior are unchanged, and validation targeted the affected version, updater, CLI, MCP and package boundaries. The source patch was tested locally on Linux; native macOS evidence covers the user's published-0.2.0 upgrade/check, not execution of this unreleased patch or a future interactive install.
