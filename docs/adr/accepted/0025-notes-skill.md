# Notes Skill

- **Status:** accepted
- **Class:** Skill boundary

Canonical guidance lives at `skills/notes/SKILL.md`. It owns the finished form of a note: template selection, target-neutral frontmatter, retrieval-friendly layout, evidence-state writing, and a lint check before delivery. Explicit invocation and implicit selection are supported, for example when a user asks to turn research results into a note, a knowledge-base entry, or an update to an existing note.

The Skill is upstream- and downstream-neutral. Evidence may come from `web`, `research`, `gh-repo`, supplied material, or any other tool; the Skill only requires that each fact carry a source and a date. The delivery target may be a local directory, an Obsidian vault, WeKnora, or another knowledge base. The Skill does not implement import, does not assume the target provides a Wiki or graph, and skips linking and index updates when the target does not support them rather than simulating them. Searching sources stays with `web`, synthesized reports with `research`, and WeKnora import with `weknora`.

This is a guidance Skill with one Skill-local script. `scripts/lint-note.mjs` is self-contained Node.js 20+ with no dependencies, no `arks` capability, no sibling Skill, no network, no credentials, and no persistent state. Only the lint step needs Node.js; drafting and delivery do not. No existing Skill is changed to depend on `notes`; the canonical plugin directory discovers it directly and version metadata is unchanged.

Notes use a generic frontmatter subset (`title`, `type`, `lang`, `aliases`, `tags`, `sources`, `retrieved`, `version`, `status`, `updated`) that any target can map to tags, metadata, or properties. The default language is Chinese with English proper names, commands, and API names preserved; `lang: en` selects an English note and English section headings. Each H2 section is self-contained so chunked retrieval stays interpretable, and a TL;DR follows the title.

Defensive writing is addressed with three evidence states instead of a prohibition list. A verified statement is direct and carries a source and date. An inferred statement is marked once, inline, with its basis. An unknown goes into one closing "to confirm" section that names the missing evidence and how to obtain it. Hedging elsewhere in the body is a lint warning.

The lint script checks required frontmatter and enumerated values, TL;DR and Sources presence, `verified` status without `retrieved`, heading levels, H2 length, context-dependent H2 openings, hedge density, and, only when `--root <dir>` is supplied, broken `[[links]]`. Errors set exit code 1; warnings do not. Stdout is text or `--json`, and diagnostics go to stderr. Code blocks, inline code, and block quotes are exempt from hedge detection. The hedge lexicon merges three layers in order: built-in `lexicons/{zh,en}.json`, repeatable `--lexicon <file>`, and an optional `.notes-lint.json` in the note's own directory (no upward search). Each layer has `hedges` and `allow` lists.

A mandatory Skill-owned storage layer or Wiki maintenance script would couple the Skill to particular targets and break the neutral boundary. Per-type Skills would multiply activation surfaces; additional templates are added only for a concrete use. Lint results are advisory evidence about form, not proof that a note is factually correct, and the Chinese lexicon's false-positive rate has not been measured.
