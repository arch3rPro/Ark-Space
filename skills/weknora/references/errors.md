# Errors and pagination

## Two error envelopes

WeKnora returns failures in two different shapes, and a consumer that handles only one will misreport the other.

**Business errors**, rendered by the error handler:

```json
{ "success": false, "error": { "code": 1003, "message": "…", "details": null } }
```

**`code` is a number here.**

**Middleware failures** — authentication, RBAC, and the API-key gate — return:

```json
{ "error": "Forbidden: API key scope does not allow this operation" }
```

Sometimes with a string `code`, for example `TENANT_REQUIRED`. These are not wrapped.

Branch on the HTTP status first, then on whether `error.code` is a number (business error) or absent and `error` is a string (middleware). Do not assume `success` exists.

## Numeric codes

| Code | Meaning | HTTP |
| --- | --- | --- |
| 1000 | `ErrBadRequest` | 400 |
| 1001 | `ErrUnauthorized` | 401 |
| 1002 | `ErrForbidden` | 403 |
| 1003 | `ErrNotFound` | 404 |
| 1004 | `ErrMethodNotAllowed` | 405 |
| 1005 | `ErrConflict` | 409 |
| 1006 | `ErrTooManyRequests` | 429 |
| 1007 | `ErrInternalServer` | 500 |
| 1008 | `ErrServiceUnavailable` | 503 |
| 1009 | `ErrTimeout` | 504 |
| 1010 | `ErrValidation` | 400 |
| 2000–2005 | Tenant: not found, exists, inactive, name required, invalid status, self-service creation disabled | varies |
| 2100–2103 | Agent: missing thinking model, missing allowed tools, invalid max iterations, invalid temperature | 400 |
| 2200–2201 | Vector store binding invalid or unavailable | 400 |
| 2300 | `ErrModelInUse` | 409 |

The published table stops at 1010 and omits 1004, 1008, 1009, and 2300. This table includes them. Treat an unrecognised numeric code by its HTTP status rather than failing.

## Non-coded errors

Two documented failures do not use the code table:

- **Duplicate knowledge.** Uploading a file or URL that already exists returns **409** with `data` carrying the already-existing Knowledge entry. This is not a transient failure: do not retry it. Report the duplicate and the existing entry.
- **Storage quota exceeded.** `StorageQuotaExceededError`. Uploads will keep failing until space is freed; retrying is pointless.

## What `403` does and does not tell you

The API-key gate is default-deny: a route with no declared policy returns `403` for **any** key. That means a `403` conflates at least three causes:

1. the key lacks the required capability;
2. the target knowledge base is outside the key's `knowledge_base_ids` allow-list;
3. the route carries no API-key policy at all.

A consumer cannot distinguish these from the response. On `403`, report the likely scope mismatch and ask the user to inspect the key's capabilities and allow-list in WeKnora. Do not retry in a loop, and do not attempt a broader request to work around it.

One specific consequence worth knowing: a knowledge-base-scoped key gets `403` for `?resource_urls=public`, because that key is also barred from the `/files` proxy.

## Pagination

Offset pagination is the default:

| Param | Default | Bounds |
| --- | --- | --- |
| `page` | 1 | ≥ 1 |
| `page_size` | 20 | 1–100 |

Out-of-range values return validation error `1010`. List responses carry `total`, `page`, and `page_size`.

Cursor pagination applies to audit logs (`after_id` + `limit`, response `next_cursor`), system runtime tasks (`cursor` + `page_size`, response `next_cursor` / `has_more`), and the Wiki index and log (`cursor` + `limit`). None of these are in this Skill's scope except the Wiki index.

## Empty results

`data` may be `null` as well as `[]`, depending on the route and whether the underlying slice was nil. Both mean empty. A `null` here is valid, not malformed — do not retry it and do not report it as an API failure.
