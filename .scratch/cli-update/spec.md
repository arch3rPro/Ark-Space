# Manual npm CLI update

Status: implemented (unreleased)

## User decision

Provide explicit `arks update --check` and `arks update`, using the official npm stable release of `@arkspace/cli`. No startup polling or automatic installation. Skills and host plugins retain their own update paths.

## Contract

- `--check` reads bounded, validated metadata from the fixed HTTPS npm registry endpoint; it never starts npm or reads ArkSpace configuration/credentials.
- Compare stable versions numerically. Never downgrade or reinstall an equal version. This cannot detect unreleased same-version source changes.
- `arks update` resolves and displays the exact current npm-global target, then asks interactive `[y/N]` on stderr. Accept single-letter Y/N case-insensitively; empty input defaults to N, invalid input reprompts. No `--confirm` option. Without interactive stdin and stderr, return a confirmation-required plan and never install, even if a caller pipes `y`.
- Installation requires that the executing package is the normal, unlinked global package owned by the available npm. Source, project-local, linked, missing, or mismatched installations stop with manual-update guidance.
- After interactive Y consent, installation pins the checked release and the verified global prefix; uses official registry settings, `--ignore-scripts`, and engine checks. Never invokes a shell or sudo. Does not invoke separate Skill/plugin installers, alter host registrations, or modify ArkSpace state. Npm-package-owned bundled files change with the package.
- npm progress/output is not exposed as machine stdout or echoed in errors. On install failure/interruption, explicitly state possible partial changes; do not claim rollback. Verify the installed package name/version before reporting success.
- Check timeout/cancellation are safe read-only failures. Installation cancellation stops the child and waits for exit before returning. No automatic retry.
- `--json` emits one CLI-specific JSON object, not a new Protocol v1 capability. Errors have nonzero exit status; prompts/diagnostics/progress stay on stderr. N/empty is a declined outcome without changes; interruption is a cancelled failure. EOF never implies approval.

## Evidence

Tests exercise the built public CLI with intercepted external registry/npm boundaries and temporary homes/prefixes. Test a packed, isolated install without touching the real global installation. Cover offline check, no credentials bootstrap, malformed/oversized/error metadata, version comparisons, refused scope, confirmation, precise install arguments, subprocess failure, cancellation, and installed-version verification. Record native OS qualification honestly; do not equate Windows/macOS shape tests with hosted execution.

### Initial implementation verification (0.1.4)

- Project validation, typecheck, build, 72 focused tests, package verification (235 files), and diff checks passed.
- Tests include the exact packed artifact in an isolated prefix, intercepted official registry/npm boundaries, and seven native Linux PTY cases for Y/y, N/n, empty, EOF, and Ctrl-C with terminal mode restoration.
- A live read-only check against the official registry returned current/latest `0.1.4` and `up-to-date`; no installation was performed.
- Native Windows/macOS qualification, real registry installation, and publication were not performed. The implementation retained `0.1.4` at this stage; the previously installed global CLI was not changed.

### Explicit 0.1.5 release preparation

The user subsequently authorized version alignment, commit, and push for a 0.1.5 candidate, but not npm publication or tags. `npm run check` passed 666 tests / 42 files, including 45 updater entry tests and the buffered-Y/EOF refusal regression. `npm run test:setup` passed 84 source and 84 isolated-installed Linux PTY checks. See [release evidence](../../release/0.1.5.md) for the candidate's boundaries.

## Exclusions

No new Provider, MCP tool, machine capability, background cache, arbitrary update URL, arbitrary target version/prefix, automatic elevation, release, tag, or version change.
