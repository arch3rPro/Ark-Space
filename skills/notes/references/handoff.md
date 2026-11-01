# Handoff

## Place the note

- Use the location and file name the user gave. Without one, write `<title>.md` in the working directory and say where.
- When a note on the topic exists, update it: keep its `title` and `aliases`, raise `version`, set `updated`, and refresh `retrieved` for the sources you re-read. Show the user what changed before replacing content they wrote.
- Writing outside the working directory, or replacing an existing note, follows the host's normal authorization rules.

## Import into a knowledge base

This Skill does not import. When the user wants the note in WeKnora, hand the finished file to the `weknora` Skill if it is available, or tell the user the file is ready for import. Map frontmatter fields to the target's tags, metadata, or properties as the target allows.

## Report

State, in the user's language:

- the note path and `status`;
- the sources used and their retrieval dates;
- the count of inferred statements and to-confirm items;
- the lint result: errors and warnings, which warnings were kept and why, or that lint was skipped and the reason;
- links and index entries added, or that the target does not support them.

A clean lint reports form only. Say which facts you checked against sources and which you took from supplied material unchecked.
