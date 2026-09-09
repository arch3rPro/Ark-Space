# Contributing

ArkSpace is being rebuilt as a reusable Agent Skills workspace with an optional shared execution CLI. Contributions should preserve Skill portability and keep shared infrastructure proportional to real needs.

## Before You Start

1. Read `README.md`, `AGENTS.md`, and `docs/architecture.md`.
2. Check `docs/migration.md` before adapting behavior from the existing project.
3. Review the proposed ADR that owns the affected decision.
4. Keep one change focused on one problem.
5. Record upstream attribution and license obligations before importing external material.

## Design-Stage Contributions

During the design stage:

- state whether a proposal changes product scope, a Skill boundary, a public command, a wire/config format, or a security guarantee;
- update or supersede the owning ADR rather than silently changing its decision;
- distinguish accepted behavior from open questions and experiments;
- avoid scaffolding frameworks before a vertical slice needs them.

## Skill Contributions

For a new Skill:

1. Define the user intent and representative activation prompts.
2. Choose guidance-only, Skill-local script, external-tool, or ArkSpace capability execution.
3. Add `skills/<skill-name>/SKILL.md` with compliant `name` and `description` frontmatter.
4. Declare environment requirements in `compatibility` when needed.
5. Keep detailed branch-specific instructions in relative references.
6. Add isolated installation tests and real-entry behavior checks.

Do not create host-specific copies of the same Skill body.

## CLI Contributions

- Keep human commands separate from the versioned `arks invoke` machine protocol.
- Define provider-neutral contracts before adding an adapter.
- Implement narrow operation interfaces; a provider implements only its real capabilities.
- Test multiple API key selection, retries, cooldown, cancellation, redaction, and concurrency where applicable.
- Verify Windows, macOS, and Linux behavior for changes touching paths, processes, installation, or persistence.

## Validation

Use the scripts defined in `package.json` after the implementation scaffold exists. Until then, verify Markdown links and consistency between `README.md` and `README.zh-CN.md`.

## Plugin Development

Keep canonical Skill bodies under `skills/`; Claude Code and Codex manifests reference them directly. Follow [Maintenance](docs/maintenance.md#plugin-release-boundary) for local development, manifest validation, and version releases.

## Release Boundary

Do not publish packages, push branches, create tags, change versions, or run release workflows unless release work is explicitly requested.
