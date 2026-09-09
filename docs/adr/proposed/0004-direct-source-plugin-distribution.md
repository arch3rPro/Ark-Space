# Direct-source plugin distribution

- **Status:** proposed
- **Class:** architecture

## Problem

ArkSpace must support native Claude Code and Codex plugin installation while keeping one canonical Skill source. A generated Codex package mirror would duplicate the repository and add a build step that the plugin format does not require.

## Proposal

Keep canonical Skill bodies under `skills/`. Maintain the host manifests required for discovery:

- `.claude-plugin/plugin.json` for Claude Code;
- `.codex-plugin/plugin.json` for Codex;
- `.agents/plugins/marketplace.json` for a Codex marketplace entry.

The Codex plugin manifest points its `skills` field at `./skills/`. The marketplace entry points its source URL at the repository root. Codex therefore installs the repository as the plugin source; no generated mirror or plugin compilation step exists.

Routine development edits canonical files directly and tests the repository plugin. An explicit release updates version metadata and validates installation from the exact tag or source revision exposed by the marketplace.

The Node/TypeScript `arks` CLI remains separately built and distributed as executable software. Plugin installation must either install a compatible CLI, guide the user through installation, or report the missing dependency. The CLI build is not a Codex plugin build.

## Evidence

`obra/superpowers` uses this layout:

- `.codex-plugin/plugin.json` declares `"skills": "./skills/"`;
- `.agents/plugins/marketplace.json` points the plugin source URL to `"./"`;
- canonical Skill files remain at repository-root `skills/`;
- the repository has no generated Codex mirror directory.

Codex installs Superpowers through its plugin marketplace directly from that source arrangement.

## Alternatives considered

**Generate a Codex package mirror.** Rejected because the host can consume the repository root directly. A mirror duplicates source and creates drift without adding an installation capability.

**Build an archive only during releases.** A release archive may be useful for generic distribution, but it is not required by the direct-source Codex plugin model and must not become the canonical installation path without evidence.

**Support only portable Skill installation.** This avoids host manifests but gives up native marketplace discovery and installation.

**Bundle a compiled CLI inside the plugin.** This couples plugin metadata to platform-specific executable artifacts. Keep CLI distribution separate unless installed-host testing proves that plugin-managed installation is necessary.

## Acceptance criteria

1. Codex resolves `.codex-plugin/plugin.json` from the repository root.
2. The manifest resolves canonical Skills through `./skills/`.
3. The marketplace entry points to the repository root rather than a package mirror.
4. Claude Code and Codex installation pass without generating a duplicate Skill tree.
5. Routine source changes require no plugin compilation.
6. Explicit releases update version metadata and test the exact tagged source.
7. Plugin installation detects or guides installation of a compatible `arks` CLI.
8. Private configuration, credentials, runtime state, caches, and development-only files are not exposed through the plugin.

## Risks

- Host marketplace rules may require repository metadata not needed by local installation.
- Direct-source installation exposes every non-ignored repository file unless the host applies package selection rules; package contents must be audited.
- The plugin and separately distributed CLI can become version-incompatible without an explicit protocol compatibility check.
- Claude Code and Codex manifest capabilities may diverge and require narrowly scoped host metadata.
