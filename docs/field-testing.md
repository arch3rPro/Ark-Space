# Field Testing Log

This document records friction, failures, and improvement opportunities observed while using released ArkSpace behavior. It is an evidence intake log, not a Roadmap, specification, changelog, or delivery commitment.

A Roadmap or tracked development plan owns accepted scope, priority, sequencing, and target releases. This log preserves what happened before planning decisions are made. When an observation becomes planned work, link the owning issue or plan and change its status to `transferred`; keep the evidence here rather than duplicating it.

## Recording rules

- Record behavior observed through an installed release or documented entry path.
- Include enough environment and reproduction detail for another person to verify the observation.
- State the user goal, actual behavior, impact, and workaround separately.
- Describe candidate improvements as hypotheses until a development plan accepts them.
- Never include API keys, credential values, private endpoints, auth links, account identifiers, or unredacted Provider responses.

## Status

| Status | Meaning |
| --- | --- |
| `observed` | Reported from actual use but not independently reproduced. |
| `confirmed` | Reproduced or verified against the released behavior. |
| `transferred` | Accepted into an owning issue, milestone, or development plan. |
| `resolved` | A released change addresses the observation and verification evidence is linked. |
| `closed` | No product change will be made; the reason is recorded. |

## Entry template

```markdown
### FT-NNN — Short outcome-oriented title

- **Date:** YYYY-MM-DD
- **Release:** Version or commit
- **Area:** Setup, Skill, CLI, Provider, Browser, Monitor, installation, or release
- **Status:** observed | confirmed | transferred | resolved | closed
- **Environment:** Host, operating system, installation path, and relevant Provider
- **User goal:** What the user was trying to complete
- **Observed behavior:** What happened through the real entry path
- **Impact:** Why this blocks, delays, confuses, or increases risk
- **Evidence:** Reproduction steps, sanitized output, test, or source reference
- **Workaround:** Current safe path, or `none`
- **Candidate improvement:** A testable hypothesis, not an accepted commitment
- **Planning link:** Owning issue or plan after transfer, or `none`
- **Resolution evidence:** Released version and verification after resolution, or `none`
```

## Observations

### FT-001 — Configure multiple Provider keys entirely through setup

- **Date:** 2026-09-10
- **Release:** 0.1.1
- **Area:** Setup and credentials
- **Status:** confirmed
- **Environment:** Local interactive terminal using the published `@arkspace/cli@0.1.1`
- **User goal:** Configure more than one API key for the same Provider without learning ArkSpace configuration internals.
- **Observed behavior:** `arks setup` stores one canonical key per Provider. Additional keys require an externally supplied environment variable and a separate `arks key add <provider> --env <variable>` command.
- **Impact:** The guided onboarding path stops before the key-pool configuration is complete. Users must understand environment-variable persistence, credential references, and external secret management even for ordinary local use.
- **Evidence:** `src/cli/setup.ts` configures `EXA_API_KEY`, `TAVILY_API_KEY`, and `FIRECRAWL_API_KEY` once each; `arks key add` records only an `env:` reference.
- **Workaround:** Supply additional keys through externally managed environment variables and register each variable with `arks key add`.
- **Candidate improvement:** Let `arks setup` repeat hidden key entry per Provider, assign stable non-secret references automatically, and verify the resulting available/configured key counts. Define add, replace, disable, and remove behavior before implementation while preserving environment-variable precedence and owned-resource key pinning.
- **Planning link:** none
- **Resolution evidence:** none

### FT-002 — Reject invalid confirmation input instead of treating it as No

- **Date:** 2026-09-10
- **Release:** 0.1.1
- **Area:** Setup interaction
- **Status:** confirmed
- **Environment:** Local interactive terminal using the published `@arkspace/cli@0.1.1`
- **User goal:** Answer each `[y/N]` setup question with confidence that mistyped or unsupported input will not change the intended choice.
- **Observed behavior:** The confirmation parser returns `true` only for `y` or `yes`. Empty input and every other value return `false`, so typos and unrecognized answers silently skip the Provider as if the user chose No.
- **Impact:** A user can unintentionally skip credential configuration without receiving an invalid-input message or another chance to answer.
- **Evidence:** `src/cli/setup.ts` normalizes the response and evaluates only `answer === "y" || answer === "yes"`.
- **Workaround:** Rerun `arks setup` and enter exactly `y` or `yes` when configuration is required.
- **Candidate improvement:** Accept `y`/`yes`, `n`/`no`, and empty input as the documented default. For every other value, display the accepted choices and repeat the same question without advancing the setup stage.
- **Planning link:** none
- **Resolution evidence:** none

### FT-003 — Distinguish installable Skill hosts from qualified hosts

- **Date:** 2026-09-10
- **Release:** 0.1.1
- **Area:** Skill installation and compatibility
- **Status:** confirmed
- **Environment:** Portable installation through `npx skills@latest add arch3rPro/Ark-Space`
- **User goal:** Install canonical ArkSpace Skills into any compatible Agent offered by the Agent Skills installer.
- **Observed behavior:** Each canonical Skill says it is intended for Claude Code and Codex CLI, while the Agent Skills installer can install the same canonical directories into additional filesystem-based Agent hosts.
- **Impact:** Users may interpret the `compatibility` declaration as an exclusive host restriction and avoid an installation path that the portable installer supports.
- **Evidence:** The four canonical `SKILL.md` files name Claude Code and Codex CLI in `compatibility`; an actual `npx skills add` installation exposes additional Agent targets.
- **Workaround:** Select the desired Agent through the portable installer while treating hosts without installed-entry evidence as unqualified rather than unsupported.
- **Candidate improvement:** Make each `compatibility` declaration describe the portable runtime requirements without presenting Claude Code and Codex CLI as the complete host set. Document installable hosts separately from hosts with installed-entry and operating-system qualification evidence.
- **Planning link:** none
- **Resolution evidence:** none
