# Writing rules

## Write for the reader's task

A note is a record the reader can act on without reopening the sources. Decide what the reader must be able to do afterwards, then cover it completely: what the subject is, what it is for, how to use it, how it differs from alternatives, and what limits matter. Completeness decides length; split long material into sections for retrieval rather than cutting it.

Lead with plain language. The first sentence of the summary says what the subject is and what it does, before any version, license, or statistic. Teach with commands and real examples instead of describing them. Put facts about the source (author, stars, dates) only where they help a decision.

## Two evidence states

| State | Write it as | Requires |
| --- | --- | --- |
| Verified | A direct statement | Source and date, in the sentence or the Sources section |
| Inferred | A direct statement with one inline mark, for example `（推断：依据 …）` or `(inferred from …)` | The basis, named in the mark |

Keep the mark on the inference itself; leave the surrounding verified sentences unmarked. Keep source attribution light: one Sources section, plus an inline source only where a claim is contestable or a vendor's own number.

## Missing evidence

Check what you can before writing. A fact you can look up is looked up, not listed as open. When the evidence does not cover a topic the note needs, return to the evidence step (see SKILL.md step 1) or tell the user what is missing. Leave out a fact you cannot support. When a gap changes the reader's decision, say so in one plain sentence at the relevant place; do not collect gaps into a closing section.

## Frontmatter

Fields: `title`, `type`, `lang`, `aliases`, `tags`, `sources`, `retrieved`, `version`, `status`, `updated`.

- `type`: `note` or `tool-research`.
- `lang`: `zh` or `en`.
- `status`: `draft`, `verified`, or `outdated`. Set `verified` only when `retrieved` holds the date the sources were read.
- `retrieved` and `updated`: `YYYY-MM-DD`.
- `version`: the tool or topic version the note describes; use the note revision number when none applies.
- `sources`: URLs or document references that appear in the Sources section.

## Language

Default to Chinese. Keep English proper names, commands, flags, and API names as written. With `lang: en`, write the body and section headings in English (`Summary`, `Sources`).

## Sentences

- Put the subject and the claim in the sentence. Write the tool name rather than "it" at the start of a section.
- Give numbers, versions, and dates in full.
- Keep code, commands, and quotations in code blocks or block quotes; lint does not check them for hedges.
- Hedging words in the body (probably, 可能, 大概) are lint warnings. Replace each with a verified statement or an inline inference mark. Keep a hedge that reports genuine variation in the source, and add it to the `allow` list of a lexicon.

## Lexicon files

Lint merges three layers in order: built-in `scripts/lexicons/{zh,en}.json`, each `--lexicon <file>`, then `.notes-lint.json` beside the note. Each file has the form:

```json
{ "hedges": ["word to flag"], "allow": ["word to stop flagging"] }
```

Later layers add to `hedges` and `allow`; an `allow` entry removes that word from the merged `hedges`.
