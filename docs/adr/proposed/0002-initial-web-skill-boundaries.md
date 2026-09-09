# Initial web capability skill boundaries

- **Status:** proposed
- **Class:** architecture

## Problem

The existing provider capability catalog exposes too many Skills organized around implementation history. Closely related operations compete for activation, while browser sessions and durable monitors are mixed despite different safety and lifecycle requirements. The replacement needs fewer, clearer Skills without creating one oversized Skill that loads unrelated rules.

## Proposal

Publish up to four initial Skills, grouped by user intent and execution lifecycle:

1. **`web`** — bounded retrieval: search, related pages, fetch, map, crawl, structured extraction, and code context.
2. **`research`** — long-running synthesis with citations, status, timeout, and cancellation.
3. **`browser`** — interaction within an owned, bounded browser session.
4. **`monitor`** — durable recurring work with explicit cost, ownership, pause, resume, and deletion.

Provider configuration is not a Skill. `arks setup`, `arks provider`, `arks key`, and `arks doctor` own infrastructure setup. Skills detect missing setup and direct the user to those commands.

The `monitor` Skill ships only after its lifecycle guarantees are implemented. Until then, the published catalog may contain three Skills.

Each Skill keeps its main body focused on task recognition and operation selection. Detailed operation instructions live in referenced Markdown files and load only when needed.

## Boundary rationale

`web` operations share bounded request/result behavior and produce source material rather than an interpreted conclusion. Code context is specialized retrieval, so it belongs here rather than occupying a separate activation surface.

`research` has different completion semantics: a successful provider request is insufficient unless the result contains traceable sources and addresses the research question. It may also require polling and cancellation.

`browser` owns an active session and immediate external side effects. Its cleanup and verification requirements do not belong in ordinary retrieval instructions.

`monitor` survives the invoking agent session and may continue to incur cost. Treating it as a browser subcommand would hide its durable ownership contract.

## Alternatives considered

**Retain the existing eight Skills.** This preserves familiar names but also preserves routing ambiguity, repeated setup guidance, and implementation-shaped boundaries.

**Merge everything into one `web` Skill.** This minimizes the catalog but forces ordinary search tasks to share instructions with browser side effects, long-running research, and persistent monitors. The activation body and safety model become too broad.

**Use three Skills by merging Monitor into Browser.** Browser and Monitor may share a provider, but implementation reuse is not a user-facing boundary. Their ownership, duration, cost, and deletion semantics differ enough to warrant separation.

**Keep Code Context as its own Skill.** Its audience is specialized, but its execution is still bounded retrieval. A `web` description and operation-specific reference can trigger it without another top-level Skill. Split it later only if activation tests show that users cannot reliably reach it.

**Create a Provider Manager Skill.** Configuration is infrastructure rather than a user outcome. A CLI setup command is easier to discover, test, and reuse from every dependent Skill.

## Acceptance criteria

1. Representative user prompts activate exactly one initial Skill without requiring knowledge of provider names.
2. The `web` main body remains concise by loading operation references progressively.
3. Provider setup instructions have one owning CLI flow.
4. Browser actions require confirmation and post-action verification where side effects exist.
5. Monitor is absent until durable ownership and deletion are proven.
6. Isolated installation tests prove that each published Skill can locate and validate `arks` without repository-relative paths.
7. Future non-web Skills may use guidance-only, local-script, external-tool, or ArkSpace-capability execution without adopting these four boundaries.

## Risks

- `web` may still be too broad; activation and instruction-size evaluation must verify it.
- Users may expect code context under `research`; descriptions and examples need to make retrieval versus synthesis clear.
- Deferring Monitor reduces initial feature parity but avoids publishing an unsafe partial lifecycle.
- Four initial names can become a permanent taxonomy by accident; future Skills must be classified from their own user intent rather than fitted into the web model.
