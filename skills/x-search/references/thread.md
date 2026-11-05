# Read a thread

```json
{"protocolVersion":1,"capability":"x.thread","input":{"confirmed":true,"tweet":"https://x.com/jack/status/20","includeReplies":true,"maxReplies":20,"sort":"relevance"}}
```

`tweet` is a numeric id or a full x.com / twitter.com status URL. Replies are off by default; turn them on only when the user wants the discussion.

Result: `data.tweet`, `ancestors` (earlier posts), `continuation` (author's later posts), `replies` (groups of reply chains), `repliesOmitted`, `nextCursor`, `hasMore`. A deleted or hidden tweet comes back with `available: false` and a `tombstone` reason; report it instead of guessing the content. `quote` holds one level of quoted tweet.
