# Optional managed execution

Use this path when neither public WeKnora environment variable is supplied and `arks` is available. A complete environment pair selects independent REST/script execution instead; an incomplete or invalid pair stops. Managed execution never exports a key or reads private config through the Skill.

## Readiness

Check `arks --version` and capability availability. If the CLI is absent, offer the independent environment path; installation needs separate consent. For a missing managed connection, ask the human to run `arks setup weknora` in their own trusted terminal. Keep keys out of Agent input and captured tool calls.

A user's explicit request to access their selected instance supplies network consent; set `confirmed: true` for that operation. Searches send query content to that instance; explain this before the first search. HTTP carries an informational plaintext warning, not an additional confirmation or permission requirement. Valid localhost, private, and public destinations are supported without CIDR exceptions; address validation, DNS pinning, verified TLS, redirect refusal, no-proxy transport, deadlines, and response bounds still apply.

Request files contain only non-secret operation input. Use one Protocol v1 request per invocation:

```bash
arks invoke weknora.connection.verify --input request.json
```

```json
{"protocolVersion":1,"capability":"weknora.connection.verify","input":{"confirmed":true,"timeoutMs":5000}}
```

The probe reports only whether `/auth/me` accepted the request. A 403 can be a scope/policy restriction; it does not disable the key or prove retrieval is unavailable. Do not repeatedly probe or broaden access to work around a denial.

## Supported operations

| Outcome | Capability | Input |
| --- | --- | --- |
| List accessible knowledge bases | `weknora.knowledge-bases.list` | `confirmed`, optional `page`, `pageSize`, and transport/deadline fields |
| Read one knowledge base and its capabilities | `weknora.knowledge-bases.get` | `confirmed`, optional `knowledgeBaseId` and transport/deadline fields |
| Search one knowledge base | `weknora.search` | `confirmed`, `query`, optional `knowledgeBaseId`, `limit`, and transport/deadline fields |

Use `arks invoke <capability> --input request.json`; each request has `protocolVersion: 1`, its exact `capability`, and an `input` object. Select a knowledge base explicitly when the user named one. Omitted IDs use the managed default where supported; absent default is a configuration/selection blocker, not permission to search all bases.

`page` defaults to 1 and is bounded to 1–10000; `pageSize` defaults to 20 and is bounded to 1–100. Retrieval `timeoutMs` defaults to 5000 and is bounded to 1–30000 milliseconds. The legacy `allowHttp` field is accepted for compatibility but does not gate HTTP execution. Search `limit` defaults to 5 and is bounded to 1–100; `query` is nonblank and at most 4000 characters. Knowledge-base IDs are at most 128 characters using letters, digits, underscores, and hyphens, starting with a letter or digit.

Example single-base search after network/query consent:

```json
{"protocolVersion":1,"capability":"weknora.search","input":{"confirmed":true,"knowledgeBaseId":"kb-id","query":"refund policy","limit":5}}
```

Search checks knowledge-base retrieval capabilities before sending the query. No usable index is a distinct outcome, not empty search results. Empty successful data is normal and does not trigger a different connection or wider query.

## Results and safety

Managed envelopes use `connection: "weknora"`, not Web `provider` or `attempts`. Read `ok` first; on failure report the classified error and safe correction. Keep 403, missing configuration, no index, timeout, cancellation, and empty success distinct. Do not display a raw envelope, key, identity payload, or server error body.

Use only returned document/knowledge-base identifiers and available source titles for attribution; returned chunks do not establish passage offsets, and search success does not prove an imported entry's parsing status. The ordinary entry-searchability preflight remains required before claiming an entry is fully parsed/enabled.

Managed support covers verification, knowledge-base list/detail, and single-base search only. For uploads, document/chunk reads or edits, multi-base search, parse inspection, and streamed chat, ask the human to provide an independent environment pair. Do not extract a stored key, switch paths automatically, or claim these operations are supported by the managed runtime.
