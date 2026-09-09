# Claude Code Guidance

Read `AGENTS.md` for the project contract and workflow. This file adds no separate architecture or Skill source tree for Claude Code.

- Use canonical content from `skills/` when Skills are introduced.
- Treat `arks` as an external executable boundary, not an importable Skill runtime.
- Ask before installing CLI tools, packages, or changing user-level configuration.
- Do not create Claude-specific copies of Skill bodies.
- Support Claude Code plugin installation through canonical plugin metadata that selects shared Skills.
- Follow the plugin release boundary in `docs/maintenance.md`; manifests reference canonical Skills directly and no plugin mirror is generated.
