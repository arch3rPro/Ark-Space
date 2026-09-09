# Native plugin installation with release-only package generation

- **Status:** rejected — Codex manifests can reference the repository root and canonical `skills/` directory directly, so a generated release package is unnecessary.
- **Class:** architecture

## Problem

ArkSpace must support native plugin installation for Claude Code and Codex while keeping one canonical Skill source. The existing approach made generated package copies part of routine development, so ordinary Skill or documentation changes created rebuild and parity work unrelated to an actual release.

The new project needs fast source development, real installed-host evidence, and deterministic release packages without maintaining a continuously synchronized Codex mirror.

## Proposal

Support both portable Skill installation and native Claude Code/Codex plugin installation.

Canonical Skill bodies live only under `skills/`. Host plugin manifests are maintained as source metadata and select those Skills. Publishable plugin directories and archives are generated artifacts under `dist/` and are not edited or synchronized during routine development.

Development uses one of two paths:

1. a host-supported local plugin/source path;
2. an `arks` development-link or source-install command that points the host at canonical sources.

A focused compatibility test may build a disposable plugin artifact when the host cannot exercise packaging directly from source. The artifact remains ignored and is not treated as a release package.

A publishable Codex or Claude Code package is generated only during an explicitly requested version-release workflow. That workflow builds from a clean checkout, embeds source-version metadata, tests installation and invocation from the exact artifact, and publishes only after authorization.

Routine validation checks canonical Skills, manifests, links, and protocol compatibility. It does not require parity with a previously generated release package.

## Alternatives considered

**Continuously rebuild and commit host package mirrors.** This makes package contents visible on every commit but duplicates source, creates noisy diffs, and turns unrelated edits into packaging work. It also allows hand edits and drift between canonical and generated copies.

**Support only portable Skill installation.** This is simpler but gives up native discovery and installation where Claude Code or Codex plugin packaging improves the user experience.

**Build release artifacts after every change but do not commit them.** This avoids source duplication but still adds unnecessary build cost to routine work. Disposable artifacts remain appropriate only for changes that affect plugin compatibility.

**Maintain separate native Skill bodies per host.** This can optimize host-specific behavior but creates multiple authorities for the same Skill. Host differences belong in manifests or narrowly scoped adapters unless behavior genuinely diverges.

## Acceptance criteria

1. Claude Code and Codex can install ArkSpace through documented native plugin paths.
2. Both plugin formats consume canonical Skill bodies without hand-maintained copies.
3. Routine edits and checks do not regenerate a publishable Codex package.
4. Local development can exercise canonical sources without a version release.
5. Focused compatibility builds are disposable and ignored.
6. An explicit release deterministically creates artifacts from a clean checkout.
7. Installed-host tests run against the exact artifacts selected for publication.
8. Artifacts include source-version metadata and exclude private configuration, credentials, state, caches, and development-only files.

## Risks

- A host may not support direct local-source loading; the development tool must then create a disposable package or link without turning it into a committed mirror.
- Release-only packaging can allow manifest drift to remain unnoticed unless routine validation checks manifest references and targeted compatibility tests run when those references change.
- Supporting two native plugin formats still has maintenance cost even with one Skill source.
- Host packaging requirements may change independently and require version-specific adapters.
