# Maintenance

## Document ownership

- `README.md` and `README.zh-CN.md` explain the user-facing project and must remain factually aligned.
- `docs/architecture.md` owns the current system map and boundaries.
- `ROADMAP.md` owns the current implementation progress summary and next acceptance gates.
- `docs/migration.md` owns historical migration context and replacement cutover gates; its original phases are not current status.
- `docs/field-testing.md` owns observations from real use before they are accepted into a Roadmap, issue, or development plan.
- Proposed ADRs own decisions and alternatives that remain proposed; implementation status is verified against current source and evidence, not inferred from an ADR status label.
- `AGENTS.md` owns cross-agent repository rules; `CLAUDE.md` contains Claude-specific differences only.
- Plugin manifests own host metadata and reference canonical Skills directly; no generated plugin mirror exists.

Keep each fact in one owner and link to it elsewhere.

## Decision lifecycle

Architecture, public protocol, configuration, persistence, installation, and Skill-boundary changes require an ADR. Proposed records may contain acceptance criteria and open implementation gates. When a decision ships, move it to the accepted location, change its status, and describe shipped reality in the present tense.

Never rewrite an existing ADR into a different decision; supersede it and cross-link both records.

## Design-stage checks

Before code scaffolding exists:

- verify local Markdown links;
- keep English and Chinese README claims aligned;
- distinguish proposals from implemented behavior;
- avoid documenting commands or package scripts that do not exist.

## Implementation-stage checks

Once `package.json` exists, define canonical formatting, type-checking, linting, unit, contract, real-entry, and isolated-Skill commands there. Documentation should point to those scripts instead of duplicating their command bodies.

Changes touching installation, paths, subprocesses, persistence, or cancellation require Windows, macOS, and Linux evidence. Provider changes require fixture-based contract tests; the opt-in live procedure in `docs/provider-e2e.md` complements rather than replaces them. Setup workbench terminal qualification uses `npm run test:setup` (build plus source and isolated-installed-entry PTY checks). This development qualification is Linux-only and requires standard-library Python 3; it is not an end-user CLI dependency. Missing Python on Linux fails the check; unsupported platforms must be reported as skipped rather than qualified. Real-TTY Windows/macOS behavior remains unverified.

## Plugin release boundary

Claude Code and Codex plugin manifests reference the repository's canonical `skills/` directory. Routine changes require manifest and source validation, not plugin compilation or mirror regeneration.

An explicitly requested version release performs the plugin release checks:

1. validate canonical Skills, CLI contracts, and host manifests;
2. update the plugin version metadata once;
3. verify that referenced paths resolve and private configuration is excluded;
4. publish only after explicit authorization.

A qualification arrangement from an earlier release does not automatically carry forward to a new major/minor candidate. For 0.2.0, hosted platform and installed-host qualification remain open gates and must be explicitly recorded; do not claim broader platform support until evidence exists.

The Node/TypeScript CLI has a separate software build and npm release process. Do not describe that build as compiling the Codex plugin.

## Package and release gates

`npm run verify:package` builds and dry-runs the exact npm artifact. It requires the CLI entry and all canonical Skills and manifests, enforces size and path allowlists, scans packed text for credential-like literals, and rejects runtime dependencies with install scripts. Repository installs default to `ignore-scripts=true`; the lockfile's reviewed but denied development-only lifecycle set is pinned in the verifier so dependency drift fails closed.

`npm run test:hosts` installs the packed artifact into a temporary prefix and verifies the installed absolute command through Claude Code and Codex. It requires both host CLIs locally.

Record a post-release passing `npm run test:e2e` using the procedure in `docs/provider-e2e.md`; it remains manual because it requires dedicated credentials, a public test webhook, charges, and post-run dashboard inspection.

`npm run verify:release` composes project structure validation, typechecking, package verification, identity, legal metadata, and clean-Git checks. A release candidate must pass both `npm run check` and `npm run verify:release` on a clean reviewed commit. The verifier does not publish or tag. Installed-host, hosted platform, and credentialed Provider evidence must be evaluated and reported for the candidate; prior 0.1 arrangements are not a 0.2.0 waiver.

## Release boundary

Publishing requires a clean reviewed commit, passing `npm run check` and `npm run verify:release`, and separate explicit authorization to publish. Passing checks or preparing 0.2.0 is not publication authorization. Publication does not declare replacement cutover complete; the stricter gates in `docs/migration.md` still govern replacing or retiring the existing ArkSpace project. Do not publish npm packages, create tags, change plugin versions, or retire the existing project as a side effect of ordinary maintenance.
