# Accounts

Profile:

```json
{"protocolVersion":1,"capability":"x.user","input":{"confirmed":true,"username":"jack","includeAbout":false}}
```

`includeAbout` adds location and account-origin details; request it only when needed. Stats can be `null` (not reported).

Timeline:

```json
{"protocolVersion":1,"capability":"x.timeline","input":{"confirmed":true,"username":"jack","tab":"posts","limit":20}}
```

`tab` is `posts` (default), `replies`, `media` or `articles`. `limit` is 1–50, a minimum, because pages are whole. Page with `cursor` only when the user needs older posts. Tweets can include `poll: {options: [{label, votes}], totalVotes, status}`, including quoted tweets. Local truncation of strings, arrays, or quotes is reported once in `warnings[]` with: `Nitter response was truncated locally; returned content may be incomplete even when hasMore is false.` `hasMore` describes upstream pagination only. The cursor continues after the entire current page; merge repeated tweets or context by `id` rather than automatically looping. `next_cursor` must be null or a non-empty string up to 2000 characters, consistent with boolean `has_more`; invalid pagination data is rejected, not shortened.

A protected or suspended account returns `protected-account` or `user-suspended`. Those describe the account, not a broken connection: report them and stop.
