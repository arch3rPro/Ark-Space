# README, credential setup, and Agent installation patterns

Research date: 2026-09-10

## Sources

- [`mattpocock/skills` README](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/README.md), revision `3cca18b368ae95cdbdebbff572ccafa662551015`.
- [`engineering/wizard` Skill](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/wizard/SKILL.md) and [wizard template](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/wizard/template.sh), same revision.
- [`ayghri/i-have-adhd` README](https://github.com/ayghri/i-have-adhd/blob/ff690b6fbd3383e4fce6a7e50c7b409ca9a6a804/README.md) and [installation guide](https://github.com/ayghri/i-have-adhd/blob/ff690b6fbd3383e4fce6a7e50c7b409ca9a6a804/INSTALL.md), revision `ff690b6fbd3383e4fce6a7e50c7b409ca9a6a804`.

These sources were consulted for interaction and documentation patterns. No upstream source code is imported.

## Findings

### Repository homepage

The `mattpocock/skills` homepage leads with a short identity and a 30-second installation path, then explains the concrete problems the catalog addresses. Host-specific installation alternatives are collapsed behind focused sections. The full catalog appears as reference after value, setup, and rationale.

ArkSpace should follow `value → proof → first use → mechanism → reference`: identify the four Skills and their outcomes immediately, show one complete installation and readiness path, then explain the optional shared runtime and deeper architecture.

### Credential setup

The wizard separates Agent work from human-only work. Each stage names the source URL, tells the user what to retrieve, captures secrets through hidden terminal input, writes them idempotently, and ends with verification. Secret prompts use hidden input; irreversible writes use confirmation; reruns preserve existing values.

ArkSpace should make `arks setup` the owner of credential onboarding. The command must explicitly direct users to a trusted local terminal, never an Agent conversation. It should link to official Provider pages, accept secrets with hidden input, keep persisted credentials outside configuration and state, apply restrictive file permissions where supported, and run readiness checks without printing secret values.

### Agent-directed installation

The `i-have-adhd` README offers a copyable Agent prompt that points to repository-owned installation instructions. Its `INSTALL.md` then owns host-specific install, verify, update, uninstall, activation, and troubleshooting steps.

ArkSpace should provide the same two-level design: a short prompt on the homepage and a repository-owned `INSTALL.md`. The Agent contract must require environment-change consent, use only documented package or plugin commands, keep API keys out of conversation text and command arguments, ask the human to run credential setup privately, and verify both `arks` and installed Skills.
