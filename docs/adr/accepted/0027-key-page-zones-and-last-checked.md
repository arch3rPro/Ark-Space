# Three-zone key page and last-checked time

- **Status:** accepted; implemented in source with automated Linux PTY qualification; human UX acceptance pending
- **Class:** interaction and persistence
- **Supersedes:** only the key *details* clauses of [ADR 0017](../accepted/0017-workbench-modal-setup.md) (the `i` key, its refresh-before-read rule and its detail fields). Editing, removal, order, security, credential and ownership protections remain in force. The separate `p` Preview is merged into the edit form (see Addendum).

## Problem

The details view repeated what the key list already showed, was mostly empty for a healthy key, and could not say whether a key had ever been used: state recorded failures only, so "never used" and "used successfully" looked identical.

## Decision

- **State:** `KeyState` gains an optional `lastCheckedAt` (epoch milliseconds). `recordKeyResult` sets it on success and on failure; selection alone does not. Absent means never checked. The field is optional, so existing state files stay valid; a build that predates it rejects a state file that contains it (the schema is strict), so downgrading after use is unsupported.
- **Setup tests:** per-key tests (`t`, all keys) record each success or failure into the real state, exactly as a real call would, including cooldown. The pool test already used the real state. Tests that omit `recordStatePath` keep the isolated temporary state.
- **Key list columns:** variable, status, checked time, source. Status is only the switch, enabled or disabled; cooldown, exhaustion and an unavailable value appear as the icon colour and in the anomaly zone. Checked time is absolute (`HH:MM` today, `MM-DD HH:MM` earlier) because Setup refreshes on open and after writes, not continuously; no record shows "not checked".
- **Zones below the list:** a note zone (search priority of the engine, environment override, sharing when present) and an anomaly zone (reason, cooldown remaining, open resources by type). Rows that do not apply are omitted, and the anomaly zone is absent when there is nothing to report. Both follow the selected row.
- **Removed:** the `i` key, the details mode and its title/key-bar state, on the engine pages and on the connection key rows.
- **Unchanged:** SearXNG instances have no key and no checked time.

## Consequences

- Every existing key shows "not checked" until its next real call or Setup test.
- A failed test can put a key into cooldown or disable it, as a real failure would; consent for live tests already warns of cost and logging.
- Anomalies are read from recorded state, not detected live; another terminal's failure appears after the next Setup refresh.
- Checked time after a cooldown expires is the time of the last result, which may have been a failure.

## Addendum: preview merged into the edit form

`e` replaces `p`. Opening a key's form fetches its stored value through the same refresh-and-match check the preview used, then shows it above the new-value field: masked by default, `Ctrl-R` reveals it, and it is dropped when the form closes. A key that cannot be replaced here (environment, shared, or owned by another resource) opens the same view read-only: no input, no save, and a reason line, so the value stays inspectable. `r` cannot be the reveal key because every printable character is input in a form.
