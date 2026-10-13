# Ingest: write now, process in the background

Ordinary import completes after the entry and requested decorations are saved. Searchability is a separate, opt-in check; parsing, Wiki, and graph generation may continue after returning.

## Prepare before uploading

1. Confirm the target knowledge base, then read `GET /knowledge-bases/:id` and `GET /knowledge-bases/:id/tags`. Paginate tags as needed; use IDs from this knowledge base, not names or guessed IDs.
2. Reuse 1–3 clearly relevant existing tags. If no existing tags fit (including an empty tag list), generate 1–3 topic tags from the document content and create them with `POST /knowledge-bases/:id/tags`. The import request authorizes this limited tag creation; do not ask for separate approval. Preserve explicit user choices, including a request for no tags.
3. Choose the route by source: create Markdown content (including a drafted document or supplied `.md` file) with `POST /knowledge-bases/:id/knowledge/manual`; upload other local file formats with `POST /knowledge-bases/:id/knowledge/file`; import web sources with `POST /knowledge-bases/:id/knowledge/url`. Honor an explicit request to preserve the original Markdown file instead of converting it.
4. Prepare `custom_metadata` from evidence: source URL or supplied filename, document type, language, and author/date/version only when stated in the source. Omit unknown fields. Do not infer confidentiality or department, expose absolute local paths, or store signed URLs, credentials, or secrets. Upload time is not publication time.
5. When source text is available, prepare an objective summary: Chinese **80–150 characters**, or other languages **40–80 words**, in 1–3 sentences covering subject, key conclusion, and scope. Shorter is fine for sparse content. Read enough of the source to justify the summary; label an excerpt-only summary. A filename or URL alone is not evidence for a summary.

## Automatic topic tags

Read enough document content to support the topics. Use concise, reusable subject names; avoid whole titles, filenames, upload dates, speculative department/confidentiality labels, and synonymous duplicates. A filename or URL alone is not evidence. If content cannot be read or tag preparation fails, stop before uploading and explain the limitation; never silently send empty `tag_ids` unless the user explicitly requested an untagged import.

Validate each created tag's real ID and use IDs belonging to the target knowledge base. On a duplicate/conflicting creation or uncertain network outcome, re-read tags and reuse a matching entry before any retry; do not blindly create duplicates. On permission or unsupported-field errors, stop before upload and report any tags already created; do not broaden scope or delete them automatically.

Server automatic tagging may continue in the background but is not a substitute for the Skill's selected tags. Do not wait for it or change server tagging settings.

## Choose the summary strategy

- **Source available, supported deployment:** default to a Skill-written short summary. Send `process_config.summary_enabled:false` on this import, then save the summary as `description` after metadata. Explain that this replaces automatic summary generation for this document, including its automatic structured profile; it does not disable Wiki or graph.
- **Source unavailable, automatic profile requested, or support unverified:** retain automatic summary generation. Do not invent a summary or promise a short one. Return immediately and report the automatic summary as pending. Shortening an existing automatic summary is a separate requested operation, after its generation/refresh has finished.

These fields were checked against upstream revision `e7aaf8ae02608d1d9e0f84aa864106a5f1ae78a3`. Confirm support from the deployment's version/documentation before relying on `summary_enabled` or manual `description` semantics; a 2xx can silently ignore an unknown field. `GET /system/info` is a version probe, not a guarantee of feature support. If support is unknown, use automatic mode and disclose the limitation. Do not upload test documents or change server settings to probe support.

## Request shapes

**Prefer manual creation for Markdown.** This creates an editable manual knowledge entry and accepts `title`, `content`, `status`, `tag_ids`, and `process_config`. Use file upload for other source file formats; use URL import for web sources. A `.md` file is read as Markdown content and created as a manual entry unless the user asks to preserve it as an uploaded file.

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

A successful creation response must include the new entry ID. Apply the updates above, then read `GET /knowledge/:id` once to check saved fields. Compare the saved tag IDs with the selected IDs; a missing tag is decoration incomplete, not successful tagging. If tag fields are absent or verification fails, distinguish saved-but-unverified from confirmed saved; do not claim the decorations succeeded. Stop on validation, permission, or unsupported-field errors and report partial completion, retaining the ID.

Report:

- Entry ID and target knowledge base.
- Selected topic tags and which were reused or created; tags confirmed saved, explicitly omitted by the user, or decoration incomplete/unverified. Distinguish any extra server-generated tags still pending.
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
