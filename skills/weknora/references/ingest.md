# Ingest: write now, process in the background

Ordinary import completes after the entry and requested decorations are saved. Searchability is a separate, opt-in check; parsing, Wiki, and graph generation may continue after returning.

## Prepare before uploading

1. Confirm the target knowledge base, then read `GET /knowledge-bases/:id` and `GET /knowledge-bases/:id/tags`. Paginate tags as needed; use IDs from this knowledge base, not names or guessed IDs.
2. Reuse 1–3 clearly relevant existing tags. If none fit, propose tags and obtain approval before creating them with `POST /knowledge-bases/:id/tags`; otherwise report that no suitable tag was available. Preserve explicit user choices. If server automatic tagging is enabled, report it as pending rather than claiming its tags are already assigned.
3. Prepare `custom_metadata` from evidence: source URL or supplied filename, document type, language, and author/date/version only when stated in the source. Omit unknown fields. Do not infer confidentiality or department, expose absolute local paths, or store signed URLs, credentials, or secrets. Upload time is not publication time.
4. When source text is available, prepare an objective summary: Chinese **80–150 characters**, or other languages **40–80 words**, in 1–3 sentences covering subject, key conclusion, and scope. Shorter is fine for sparse content. Read enough of the source to justify the summary; label an excerpt-only summary. A filename or URL alone is not evidence for a summary.

## Choose the summary strategy

- **Source available, supported deployment:** default to a Skill-written short summary. Send `process_config.summary_enabled:false` on this import, then save the summary as `description` after metadata. Explain that this replaces automatic summary generation for this document, including its automatic structured profile; it does not disable Wiki or graph.
- **Source unavailable, automatic profile requested, or support unverified:** retain automatic summary generation. Do not invent a summary or promise a short one. Return immediately and report the automatic summary as pending. Shortening an existing automatic summary is a separate requested operation, after its generation/refresh has finished.

These fields were checked against upstream revision `e7aaf8ae02608d1d9e0f84aa864106a5f1ae78a3`. Confirm support from the deployment's version/documentation before relying on `summary_enabled` or manual `description` semantics; a 2xx can silently ignore an unknown field. `GET /system/info` is a version probe, not a guarantee of feature support. If support is unknown, use automatic mode and disclose the limitation. Do not upload test documents or change server settings to probe support.

## Request shapes

Paths below omit the `/api/v1` root supplied by `$WEKNORA_BASE_URL`.

| Import | Endpoint | `tag_ids` | `process_config` |
| --- | --- | --- | --- |
| File | `POST /knowledge-bases/:id/knowledge/file` | Multipart string: `id1,id2` | Multipart JSON string |
| URL | `POST /knowledge-bases/:id/knowledge/url` | JSON array | JSON object |
| Markdown | `POST /knowledge-bases/:id/knowledge/manual` | JSON array | JSON object; include `status:"publish"` |

For supported deployments and an already prepared short summary, a Markdown request is:

```json
{
  "title": "Document title",
  "content": "# Source content\n…",
  "status": "publish",
  "tag_ids": ["existing-tag-id"],
  "process_config": { "summary_enabled": false }
}
```

Keep all other parsing and indexing settings inherited. Do not disable Wiki/graph, reparse existing documents, or tune knowledge-base configuration as part of ordinary ingestion.

### Metadata and short summary

The file-upload `metadata` field stores internal metadata, not the document-detail `custom_metadata`. URL and Markdown creation do not document a `custom_metadata` field. For all three modes, use the returned ID to update it through `PUT /knowledge/:id`; parsing need not be completed.

```json
{
  "custom_metadata": {
    "source_url": "https://example.com/docs",
    "document_type": "guide",
    "language": "zh-CN"
  }
}
```

Limits: at most 20 fields; nonblank keys 1–64 characters; values string/number/boolean/null, at most 1000 characters. The object **replaces** existing custom metadata. Read and merge existing fields before updating an already decorated entry. Preserve its schema and user-provided values.

Save metadata **first**. Changing it while a summary exists can enqueue a summary refresh. In Skill-written mode, after the metadata update succeeds, send a separate `PUT /knowledge/:id`:

```json
{ "description": "Source-backed short summary." }
```

Sending metadata and a new description together can itself enqueue a refresh. Omit `description` to preserve it; an empty string clears it. In automatic mode, leave description untouched while generation/refresh is active. Do not call `regenerate-summary` during a routine import.

## Return without waiting

A successful creation response must include the new entry ID. Apply the updates above, then read `GET /knowledge/:id` once to check saved fields. If verification fails, distinguish saved-but-unverified from confirmed saved; do not claim the decorations succeeded. Stop on validation, permission, or unsupported-field errors and report partial completion, retaining the ID.

Report:

- Entry ID and target knowledge base.
- Tags actually saved, or no match / automatic tagging pending.
- Custom metadata confirmed saved, omitted unknowns, and any failed update.
- Summary strategy: short description saved, automatic pending, or incomplete.
- Observed parse status and enable status; background Wiki/graph work is not verified complete.

A `409` is an existing entry, not a new one: report the returned ID and request permission before changing its metadata, tags, or summary. A network failure with uncertain acceptance also requires checking for an existing entry before retrying. A decoration failure never warrants re-uploading the source.

For explicitly requested searchability verification, follow the bounded waiting workflow in [SKILL.md](../SKILL.md). Do not create a watcher or detached polling process by default.

## Official contract sources

API documentation used as contract evidence, not copied implementation:

- [Knowledge API](https://weknora.weixin.qq.com/docs/04-api/02-api-knowledge): import shapes, process overrides, metadata and description updates.
- [Tags API](https://weknora.weixin.qq.com/docs/04-api/02-api-chunks): knowledge-base tag operations.
- [Update service at the checked revision](https://github.com/Tencent/WeKnora/blob/e7aaf8ae02608d1d9e0f84aa864106a5f1ae78a3/internal/application/service/knowledge.go): replacement metadata and refresh ordering.
- [File creation at the checked revision](https://github.com/Tencent/WeKnora/blob/e7aaf8ae02608d1d9e0f84aa864106a5f1ae78a3/internal/application/service/knowledge_create.go): upload metadata is internal metadata.
