# Changelog

This is the concise version ledger. Detailed changes, upgrade instructions, verification evidence, and qualification limits live in the linked release notes; current development status lives in [Roadmap](ROADMAP.md). Dates below are npm publication dates, not preparation or GitHub Release dates.

## Unreleased

- Read CLI and MCP versions from the installed package manifest instead of duplicated build-time literals, preventing version drift from blocking legitimate npm-global updates.
- Verify built CLI/package/lockfile version consistency during packaging; derive installed-entry check expectations from the package version.

## 0.2.0 - 2026-11-06

- Add the UseGPT Artifact Hub workflow, `notes` and `x-search`, four X capabilities, and the rebuilt Setup workbench with Nitter management.
- Harden X diagnostics, output completeness reporting, credential redaction, and pagination; preserve the CLI entry's executable permissions.
- **Breaking:** require Node.js `>=22.19.0` and retire the old Setup engine and legacy UseGPT/CDP path. See [release notes](release/0.2.0.md).

## 0.1.7 - 2026-10-26

- npm publication; its recorded source revision is the comparison baseline for 0.2.0. A matching Git tag or GitHub Release archive was not found. See [historical notes](release/0.1.7.md).

## 0.1.6 - 2026-10-26

- npm publication with the same recorded source revision as 0.1.7; a detailed release archive was not found. See [historical notes](release/0.1.6.md).

## 0.1.5 - 2026-10-12

- Add manual npm CLI updates, bounded research-evidence review guidance, and Skill/plugin metadata improvements. See [release notes](release/0.1.5.md).

## 0.1.4 - 2026-10-09

- Add optional managed WeKnora configuration, verification, and retrieval. See [release notes](release/0.1.4.md).

## 0.1.3 - 2026-10-05

- Add keyless SearXNG and the human-controlled Setup workbench. See [release notes](release/0.1.3.md).

## 0.1.2 - 2026-09-26

- Add bounded fetch-response retrieval, conservative research-evidence metadata, credential validation, and GitHub Issue/PR guidance. See [release notes](release/0.1.2.md).

## 0.1.1 - 2026-09-10

- Add safe credential onboarding, installation guidance, and isolated-Skill checks. See [release notes](release/0.1.1.md).

## 0.1.0 - 2026-09-09

- Establish the shared CLI, Protocol v1, Provider execution, owned Browser/Monitor lifecycles, and canonical Skills. See [release notes](release/0.1.0.md).
