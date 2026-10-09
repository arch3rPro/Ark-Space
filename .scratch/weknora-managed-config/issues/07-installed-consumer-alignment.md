# Align installed WeKnora consumers with the configured source

Type: task
Status: resolved

## User report

Setup and its connection test succeeded, but the loaded Skill still required `WEKNORA_BASE_URL` and `WEKNORA_API_KEY` instead of using the saved connection.

## Cause

The installed Skill was the older independent-only version, explicitly refusing `arks`. The global CLI was also older than the reviewed source and rejected the persisted top-level `connections` field. Both CLI builds retained version `0.1.3`; version equality was not capability evidence. Source-only implementation and qualification had deliberately not modified these installations without permission.

## Answer

The user explicitly authorized updating both installed consumers from the current checkout and using their configured HTTP instance, acknowledging plaintext key transmission.

- Backed up the old CLI and Skill outside active Skill discovery paths.
- Rebuilt and packed the current checkout, then installed the local tarball globally with lifecycle scripts disabled. No publication or version change occurred.
- Synchronized only the three differing WeKnora Skill files. Its complete installed directory matches canonical source; unrelated Skills and Agent settings remain untouched.
- Preserved existing connection and credential files; their size, modification time, and inode were unchanged after installation. No key was exported or requested again.
- Verified the default global `arks` version/help entry now accepts the configuration and advertises WeKnora.
- Ran the installed global entry through verification/retrieval qualification: **48 tests in 2 files passed**.
- Successfully listed and read knowledge-base details on the authorized actual instance, both with `source: managed`, while neither public environment variable was supplied.
- Documented opt-in local-tarball installation in [INSTALL.md](../../../INSTALL.md). The Agent must reload Skills or open a fresh session to replace earlier loaded instructions.

Actual-instance addresses, keys, identifiers, names, and response bodies are intentionally excluded. This live evidence does not qualify search, imports, document/chunk access, parsing, or chat.

## Comments

A future installation of the published pinned release can replace this unreleased source build. Do not infer managed support from the unchanged version number alone; check the capability and keep the installed Skill and CLI aligned.
