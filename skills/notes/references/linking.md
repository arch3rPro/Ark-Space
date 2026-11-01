# Linking

Read this only when the delivery target supports links or an index.

## Check target support first

Links and index entries are written only for what the target resolves. Obsidian vaults resolve `[[note title]]` and `[[note title|label]]`. A plain directory or a knowledge base without link resolution gets none; skip linking and say so in the delivery report. Do not simulate a Wiki, graph, or index.

## Link rules

- Link to a note that exists in the target. Confirm it before writing the link.
- Use the target note's `title` or an entry from its `aliases`.
- Link the first mention of a related tool or topic in a section; repeat the plain name afterwards.
- Add a link only where the reader benefits from following it.

## Check links

Pass `--root <dir>` to lint with the target's root directory. Lint then reports each `[[link]]` that resolves to no note there. Omit `--root` when the target does not resolve links.

## Index updates

When the target keeps an index or a map-of-content note that the user maintains, add one entry for the new note in that file's existing format. Create no index the target does not already have.
