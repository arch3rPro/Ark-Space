# Read a thread

```json
{"protocolVersion":1,"capability":"x.thread","input":{"confirmed":true,"tweet":"https://x.com/jack/status/20","includeReplies":true,"maxReplies":20,"sort":"relevance"}}
```

`tweet` is a numeric id or a full x.com / twitter.com status URL. Replies are off by default; turn them on only when the user wants the discussion.

Result: `data.tweet`, `ancestors` (earlier posts), `continuation` (author's later posts), `replies` (groups of reply chains), `repliesOmitted`, `nextCursor`, and `hasMore`. The envelope also has `warnings[]`. Tweets can include `poll: {options: [{label, votes}], totalVotes, status}`; a quoted tweet can include the same poll data. A local truncation of a string, array, or quote adds this warning once: `Nitter response was truncated locally; returned content may be incomplete even when hasMore is false.` `hasMore` reports only upstream pagination.

The cursor continues after the entire current page. Pagination may repeat the main tweet or context; merge by tweet `id` rather than automatically looping. `repliesOmitted` counts reply threads dropped by `maxReplies`; a cursor cannot recover them, so increase `maxReplies` and reread the same page. `maxReplies` is a soft limit on reply tweets and a chain may exceed it; continuation and ancestors do not count toward it. A deleted or hidden tweet comes back with `available: false` and a `tombstone` reason; report it instead of guessing the content. `quote` holds one level of quoted tweet.
