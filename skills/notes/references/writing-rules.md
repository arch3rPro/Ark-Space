# Writing rules

## Three evidence states

Sort every statement into one state before writing it.

| State | Write it as | Requires |
| --- | --- | --- |
| Verified | A direct statement | Source and date, in the sentence or the Sources section |
| Inferred | A direct statement with one inline mark, for example `（推断：依据 …）` or `(inferred from …)` | The basis, named in the mark |
| Unknown | One item in the closing to-confirm section | The missing evidence and how to obtain it |

A fact with no source or date is an unknown. A claim that rests on one source says so in the sentence that states it. Keep the mark on the inference itself; leave the surrounding verified sentences unmarked.

## To-confirm section

Use the heading `待确认` (`To confirm` when `lang: en`). Each item names what is unknown, the evidence that would settle it, and how to get that evidence. Leave the section out when nothing is unknown.

## Frontmatter

Fields: `title`, `type`, `lang`, `aliases`, `tags`, `sources`, `retrieved`, `version`, `status`, `updated`.

- `type`: `note` or `tool-research`.
- `lang`: `zh` or `en`.
- `status`: `draft`, `verified`, or `outdated`. Set `verified` only when `retrieved` holds the date the sources were read.
- `retrieved` and `updated`: `YYYY-MM-DD`.
- `version`: the tool or topic version the note describes; use the note revision number when none applies.
- `sources`: URLs or document references that appear in the Sources section.

## Language

Default to Chinese. Keep English proper names, commands, flags, and API names as written. With `lang: en`, write the body and section headings in English (`TL;DR`, `Sources`, `To confirm`).

## Sentences

- Put the subject and the claim in the sentence. Write the tool name rather than "it" at the start of a section.
- Give numbers, versions, and dates in full.
- Keep code, commands, and quotations in code blocks or block quotes; lint does not check them for hedges.
- Hedging words in the body (probably, 可能, 大概) are lint warnings. Replace each with a verified statement, an inline inference mark, or a to-confirm item. Keep a hedge that reports genuine variation in the source, and add it to the `allow` list of a lexicon.

## Lexicon files

Lint merges three layers in order: built-in `scripts/lexicons/{zh,en}.json`, each `--lexicon <file>`, then `.notes-lint.json` beside the note. Each file has the form:

```json
{ "hedges": ["word to flag"], "allow": ["word to stop flagging"] }
```

Later layers add to `hedges` and `allow`; an `allow` entry removes that word from the merged `hedges`.
