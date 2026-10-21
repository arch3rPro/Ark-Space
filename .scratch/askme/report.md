# askme implementation verification

Status: Implemented

## Delivered

Canonical Skill: `skills/askme/SKILL.md`; conditional recovery instructions: `skills/askme/references/recovery.md`; Codex display metadata with implicit invocation enabled: `skills/askme/agents/openai.yaml`.

Updated activation fixtures, English/Chinese catalogs, capability reference, package inclusion checks, and ADR 0022. No CLI, dependencies, credentials, host configuration, plugin versions, or other Skill workflows changed. The user's prompt collection remains unchanged.

## Evidence

- `npm run check`: passed, 45 test files and 703 tests. Includes structure, local links, activation-fixture completeness and isolated Skill copying. These tests do not evaluate model behavior.
- `npm run verify:package`: passed; required askme files are present in npm dry-run output.
- Skill Creator packaging with Python 3: passed frontmatter/organization validation; local archive produced at `artifacts/askme.zip`. No publication performed.
- Model-assisted replay using `/tmp/arkspace-askme-g54fRN/askme` without repository or sibling Skills: six cases passed for challenge handling, hypothetical budget, constraint conflict, clear task execution, reasoning correction, and scope drift. The reviewer returned actual next responses and case-specific judgments. This is qualitative evidence from a single model-assisted run, not an independent benchmark.
- Replay findings led to small clarifications: unknown constraint compatibility pauses the conflicting action; uncertain user edits are preserved; reading the recovery classification for a challenge does not require a full interview. These wording refinements received structural checks but were not replayed again.

## Limits

Automatic model selection, long-session recall, human usability, and live Claude Code/Codex host behavior were not qualified. No Windows/macOS execution qualification is claimed. The Skill has no executable platform-specific behavior; intended portability follows self-contained Markdown guidance and plain-text question fallback.
