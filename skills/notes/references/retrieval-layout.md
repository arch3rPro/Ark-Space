# Retrieval layout

A retrieval system returns chunks, usually one H2 section at a time. Write each section so a reader who sees only that chunk understands it.

## Structure

- One H1, equal to `title`. Then `## TL;DR`. Then topic H2 sections, `待确认` when needed, and `## 来源` (`## Sources` for `lang: en`).
- Use H3 for subdivisions inside an H2. Do not skip levels.
- Keep each H2 section short enough to read in one screen. Split a long section into two H2 sections that each name their subject.

## Self-contained sections

- Open each H2 with a sentence that names its subject. Avoid openings that depend on earlier text, such as "此外", "上述", "如上", "Also", "As above", "The above".
- Name the tool, version, and date in the section that states a fact about them.
- Write headings that carry the subject, for example `<tool> 的安装与使用` rather than `安装`.

## TL;DR

Two or three sentences with the conclusion, its scope, and the evidence date. A reader who stops here has what they need to decide whether to read on.

## Aliases and tags

- `aliases`: other names, abbreviations, and the Chinese and English forms of the subject, so keyword search finds the note.
- `tags`: short topic labels. Add `tool` for tool surveys.

## Sources

List each source with title, URL or reference, and retrieval date. Every entry in `sources` appears here.
