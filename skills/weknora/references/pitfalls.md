# Pitfalls

Traps that produce a plausible-looking but wrong result. The first one is the reason this Skill exists: the vendor skill's own examples contain it, and it turns an ingestion failure into what looks like a retrieval failure.

## The silent draft

`POST /knowledge-bases/:id/knowledge/manual` accepts a `status` field. `IsDraft()` is true when `status` is **empty** or `"draft"`, so this body:

```json
{ "title": "Release notes", "content": "# …" }
```

creates a **permanent draft**. It is never parsed, never chunked, and never indexed. Every later search returns nothing, and the symptom points at retrieval while the cause is ingestion.

Send the status explicitly:

```json
{ "title": "Release notes", "content": "# …", "status": "publish", "tag_ids": ["release"] }
```

The same applies to `PUT /knowledge/manual/:id` when updating.

## Wrong names and shapes

| Symptom | Wrong | Right | Why |
| --- | --- | --- | --- |
| Entry never becomes searchable | omit `status` | `status: "publish"` | Empty and `"draft"` both mean draft. |
| Tags silently dropped | `tag_id` | `tag_ids`: array for URL/Markdown JSON, comma-separated string for file multipart and list queries | Use actual tag IDs from the target knowledge base. |
| Building on a compatibility path | `GET …/hybrid-search` | `POST …/hybrid-search` | `GET` exists only for backwards compatibility; `POST` is the documented and recommended form. |
| `404` when reading chunks | `GET /knowledge/:id/chunks` | `GET /chunks/:knowledge_id` | The chunks prefix is `/chunks`, not nested under `/knowledge`. |
| Wrong status judgement | `pending → processing → completed \| failed` | `pending → processing → finalizing → completed \| failed`, plus `draft` and `deleting` | The enum has more members than the common summary suggests. `finalizing` is normal, not a stall. |
| "No results" when the index is off | search without preflight | read `capabilities` on the knowledge base first | A knowledge base with retrieval indexes off searches empty **without erroring**. |
| `null` treated as malformed and retried | retry on `data: null` | `null` means the same as `[]` | A nil slice serialises to `null`. Both are valid empty results. |
| `403` retried in a loop | retry | inspect the key's capabilities and allow-list | The gate is default-deny; `403` conflates missing capability, out-of-list knowledge base, and an unpolicyed route. |
| `403` on public link rewriting | `?resource_urls=public` with a knowledge-base-scoped key | stay in the default `handle` mode | Such a key is barred from the `/files` proxy, so anonymous links would bypass the same restriction. |
| Answer truncated or reported incomplete | stop reading on connection close | stop on `complete` or `error` | A `session_title` event can follow `complete`; connection close is not the terminal signal. |
| Consumer crashes after a server upgrade | throw on an unknown `response_type` | ignore unknown types | The documented type list is incomplete; the server emits types it does not document. |
| Every import waits for slow enhancements | poll until parsed for an ordinary upload | return after entry/decorations are saved, with observed status | Writing and searchability are different completion criteria; wait only when requested. |
| Saved upload claimed searchable | treat creation success as retrieval readiness | require `parse_status == "completed"` and `enable_status == "enabled"` for that claim | Parsing and enhancements are asynchronous. |
| Custom fields missing from document details | send file-upload `metadata` | save `custom_metadata` via `PUT /knowledge/:id` | Internal metadata and user-editable custom metadata are separate. |
| Short summary overwritten | save description during automatic generation, or with changed metadata | choose the summary strategy and metadata-first sequence in [Ingest](ingest.md) | Metadata changes can queue an automatic summary refresh. |
| Duplicate upload retried | retry on `409` | report the existing entry from `data` | A duplicate file or URL returns `409` with the existing Knowledge attached. |

## Shapes that vary

- `data` is `null` on some routes and `[]` on others for the same empty condition. Handle both everywhere rather than per-route.
- `/system/info` uses `{"code":0,"msg":"success","data":…}` instead of `{"success":true,…}`. Do not use it as a general response-shape reference.

## Things not to do

- Do not create a knowledge base or entry to test the connection. Use `GET /auth/me` to check credentials and `POST /chunker/preview` to check chunking.
- Do not infer a route from REST convention. If a route is not in [Endpoints](endpoints.md), it is out of scope.
- Independent requests read the key from the environment, not ad-hoc key files, shell profiles, or literal command arguments. Optional managed credentials stay inside human-controlled `arks setup weknora` storage; the Skill never reads or exports them.
- Do not treat `finalizing` as hung. It is the phase between a finished parse and a completed one.
