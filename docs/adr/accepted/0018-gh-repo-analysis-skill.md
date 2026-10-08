# GitHub repository analysis Skill

- **Status:** accepted
- **Class:** Skill boundary

## Context and authorization

The user authorized broadening the issue/PR-only `github` Skill into project research and analysis and approved the short name `gh-repo`. The completion target is an evidence-backed project answer, not simply a discussion record. This decision extends the initial boundaries in [ADR 0002](../proposed/0002-initial-web-skill-boundaries.md) for a concrete non-runtime consumer; it does not change the web capability taxonomy.

## Decision

Canonical guidance lives at `skills/gh-repo/SKILL.md`. It owns GitHub project overview, maturity/license evaluation, implementation traces, borrowing tradeoffs, and bounded supporting issue/PR reads. `research` retains cross-source public synthesis; `web` retains source discovery/retrieval. Repository analysis requires full-SHA source paths, an entry-to-module-to-tests trace, and a report distinguishing inspected evidence from executed tests and mutable metadata.

Use host tools and native read-only GitHub CLI/API operations. Keep the existing bounded issue/PR helper unchanged. No new `arks` capability, shared credentials, dependency, or analysis framework is introduced. Anonymous bounded public API reads remain possible when `gh` lacks authentication. Tool installation, authentication changes, cloning, and repository execution are separate consent boundaries. Clone ownership and cleanup must be explicit.

Remote acquisition and discussion details load through conditional references. Canonical plugin directories discover the renamed Skill directly; no manifest mirrors or version changes are needed. The Skill is installable from the repository independently of the npm CLI release cycle; it does not require `arks`.

## Alternatives and consequences

Keeping `github` issue-only would miss the authorized user outcome. A new runtime service or required hosted analysis provider would add credential/lifecycle complexity without a concrete need. A single oversized Skill would bury acquisition caveats; two operation references keep the main workflow concise.

The rename breaks callers of the old canonical path; active fixtures/tests and catalog references move to `gh-repo`. Historic research documents remain unchanged. Guidance tests verify reference/evidence contracts, not model routing or live GitHub behavior. Hosted platforms and credentialed reads remain unqualified.

## Source policy

The new guidance is original prose based on the authorized requirements and repository conventions. No Hermes or other external source/assets are imported or adapted; no external source-license attribution is asserted. Official GitHub CLI installation is linked only as an installation source, not imported code.
