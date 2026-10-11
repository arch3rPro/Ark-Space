# Manual npm CLI update

- **Status:** accepted
- **Class:** maintenance

## Context

Users need a supported way to learn whether a newer stable CLI package is available and, if desired, install it. Background polling or implicit installation would add network activity to unrelated commands and could change a user's global tools without consent. Skills and host plugins have independent update paths.

The updater is introduced in the 0.1.5 release-candidate implementation. Published `@arkspace/cli@0.1.4` does not provide these commands, and candidate source availability does not establish that a 0.1.5 package is available on npm. The candidate includes read-only checks and an interactive installer restricted to verified npm-global packages; users gain the commands only when a containing release is published.

## Decision

Provide explicit `arks update --check` and `arks update` against the official npm stable release. The check reads bounded, validated metadata and compares stable versions numerically; it does not read ArkSpace configuration or credentials, start npm, downgrade, reinstall an equal version, or detect unreleased source changes with the same version.

Metadata retrieval uses a fixed HTTPS registry identity with TLS verification, no redirects or authentication, a 10-second deadline, and a 64 KiB decoded-body limit. Unlike caller-supplied Web URLs, this immutable endpoint can use system DNS routing, including transparent fake-IP setups, while authenticating the registry hostname through TLS; it does not grant private-network exceptions to any Web/Provider capability. Disabling TLS verification is refused.

The updating command must identify the exact npm-global target and obtain interactive `[y/N]` consent on stderr. Accept only single-letter Y/N case-insensitively; empty input means no, invalid input reprompts, and EOF never approves. There is no `--confirm` option. Without interactive stdin and stderr, report that confirmation is required and do not install, even if input is piped.

Installation is restricted to a verified, unlinked npm-global installation owned by the available npm. Source, local, linked, missing, and mismatched installations receive manual-update guidance. After consent, install the exact checked newer stable version at the verified global prefix, using engine checks, official registry settings, and `--ignore-scripts`. Do not invoke a shell or sudo. Preserve ArkSpace credentials/configuration and do not invoke separate Skill/plugin installers or alter host registrations. Bundled Skills and plugin manifests are npm-package-owned files and can change with the package.

`--json` returns one CLI-specific JSON object on stdout, not a Protocol v1 capability. Prompts, diagnostics, and progress remain on stderr. npm output is not exposed as machine stdout or echoed in errors. Errors use a nonzero exit status; declining is a no-change outcome, while interruption is a cancelled failure. Check cancellation is read-only; install cancellation stops and awaits the child. Do not automatically retry or promise rollback: install failure/interruption may leave partial changes, and success requires verifying the installed package name and version.

No command other than an explicit update check polls the registry. This is human maintenance behavior, not a Provider, MCP tool, or machine capability.

## Consequences

The updater is deliberately limited to one official package source and one verified global target. This reduces accidental scope and prevents a CLI maintenance command from becoming an arbitrary package installer. Users must update Skills and host plugins through their own tools. Source, local, and linked development installs stay manual.

Release qualification must test the built public CLI against intercepted registry/npm boundaries and an isolated packed installation, without touching the real global installation. Tests must cover metadata bounds and errors, version comparisons, offline checks, confirmation and refused scopes, exact installation arguments, subprocess failure/cancellation, and installed-version verification. Record native OS evidence accurately; synthetic shape tests are not hosted Windows/macOS execution.

## Acceptance criteria

1. `--check` is bounded, validated, read-only, and performs no credential/configuration bootstrap or npm invocation.
2. Version comparison selects only a strictly newer stable release; no downgrade or same-version reinstall.
3. Interactive consent is required for install, with empty/EOF/invalid/non-TTY behavior as specified; no `--confirm` bypass exists.
4. Only the verified npm-global package can update, and installation pins the checked version and verified prefix with engine checks and scripts disabled.
5. No shell, elevation, automatic retry, separate Skill/plugin installation, host-registration change, or ArkSpace-state modification occurs.
6. JSON stdout is one updater object; prompts, progress, and diagnostics stay on stderr, and failure/cancellation does not imply rollback.
7. Isolated built-CLI tests cover registry and npm boundaries; native OS qualification is reported without claiming unperformed hosted testing.
