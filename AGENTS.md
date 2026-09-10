# Agent Guidance

ArkSpace is a creative workspace for reusable Agent Skills and their supporting tools. This repository is a greenfield redesign; keep the existing ArkSpace repository unchanged unless a task explicitly targets it.

## Start Here

- Read `README.md` for product scope.
- Read `docs/architecture.md` before changing boundaries, protocols, provider execution, credentials, or state.
- Read `docs/migration.md` before porting behavior or fixtures from the existing project.
- Read `INSTALL.md` before installing, upgrading, configuring credentials, or registering MCP for a user.
- Read the relevant ADR before implementing or changing a decision it owns.

## Project Contract

- Keep canonical Skills in `skills/<skill-name>/SKILL.md`.
- Keep shared Node/TypeScript implementation under `src/`.
- Keep deterministic, self-contained Skill scripts inside the owning Skill.
- Let Skills depend on the `arks` machine protocol only when shared execution is necessary.
- Do not require guidance-only, skill-local, or external-tool Skills to use `arks`.
- Support native plugin installation through manifests that reference canonical Skills directly.
- Keep plugin version metadata aligned only during an explicit release; do not create generated plugin mirrors.
- Add host adapters, roles, workflows, registries, or broader plugin systems only for a concrete consumer.
- Keep private credentials, endpoints, state, and personal configuration outside version control.

## Design Workflow

1. Name the user task and its completion semantics.
2. Decide whether the behavior belongs in guidance, a Skill-local script, an external tool, or a shared capability.
3. For shared capabilities, define the request, result, error, cancellation, and side-effect contract before implementation.
4. Implement the smallest real vertical slice through the installed `arks` entry path.
5. Verify behavior through contract, real-entry, isolated-Skill, and applicable cross-platform tests.

Prefer a narrow concrete module over a speculative framework. Introduce an extension point only when multiple implementations or consumers need to vary independently.

## Skill Rules

- Follow the open Agent Skills directory and frontmatter specification.
- Keep `SKILL.md` focused on activation, operation selection, safety, and result use.
- Move operation-specific reference material behind explicit relative links.
- Declare required tools, system packages, network access, and supported hosts in `compatibility` and the Skill instructions.
- A missing CLI may trigger guided installation, but environment changes require user consent and an official, verifiable source.
- Test each published Skill outside the repository so sibling directories cannot satisfy hidden dependencies.

## Runtime and Security Rules

- Use `arks invoke <capability> --input <file>` as the stable machine boundary.
- Keep stdout machine-readable; send diagnostics and progress to stderr.
- Validate CLI input, config, persisted state, provider responses, and other untrusted boundaries.
- Store credential references and key metadata, never raw keys, in state.
- Redact secrets from errors, logs, fixtures, snapshots, and telemetry.
- Model timeout, cancellation, partial output, retries, and provider fallback as separate outcomes.
- Browser and monitor operations require explicit ownership, confirmation for material side effects, and verified cleanup.

## Source and License Rules

- Record the upstream URL, revision, license, imported surface, and adaptation status before bringing external material into the project.
- Treat API documentation used to implement behavior separately from copied source code.
- Preserve required copyright and license notices.
- Do not copy old architecture, generated package trees, or registry structure merely to speed migration.

## Validation and Release

- Use commands defined by the repository's `package.json`; do not document validation commands that do not exist.
- Documentation changes must leave local links valid and English/Chinese README facts aligned.
- Structural changes require applicable cross-platform and installed-entry evidence before completion.
- Follow `docs/maintenance.md#plugin-release-boundary`: plugins load canonical sources directly; only the Node/TypeScript CLI is built, while plugin versions change during an explicitly requested release.
- Do not publish packages, create tags, push releases, or change versions unless explicitly requested.
- Leave unrelated and user-created files untouched.
