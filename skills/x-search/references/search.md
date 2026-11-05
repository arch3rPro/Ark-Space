# Search posts

```json
{"protocolVersion":1,"capability":"x.search","input":{"confirmed":true,"query":"agent skills","from":["jack"],"since":"2025-01-01","mode":"latest","limit":20}}
```

| Field | Notes |
| --- | --- |
| `query` | Up to 500 characters; may be empty when `from` is given. |
| `from` | Up to 10 handles, with or without `@`. |
| `since`, `until` | `YYYY-MM-DD`. |
| `minLikes` | Integer lower bound. |
| `mode` | `latest` (default), `top`, `media`. |
| `filter` | `media`, `images`, `videos`, `links`, `news`, `quote`, `mentions`, `replies`. |
| `includeRetweets` | Default false. |
| `limit` | 1–50, default 20. The instance returns whole pages, so you can get more than asked. |
| `cursor` | The previous `nextCursor`; use it only when more results are needed. |

Result: `data.items[]` tweets, `nextCursor`, `hasMore`. Narrow the query rather than paging far. `timeoutMs` defaults to 20000 (max 60000).
