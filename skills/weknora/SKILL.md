---
name: weknora
description: Work with a WeKnora knowledge base through its REST API — list and inspect knowledge bases, search one or many of them, import files, URLs, or Markdown, confirm an import finished parsing, read and edit chunks, and ask questions with a streamed answer. Use when the task targets a user's own WeKnora instance and its stored documents; use web or research instead for public sources.
compatibility: Requires a local filesystem-based host with shell and network access, plus a reachable WeKnora instance and the WEKNORA_BASE_URL and WEKNORA_API_KEY environment variables. The optional SSE consumer script requires Node.js 20+. Intended for Claude Code and Codex CLI on macOS, Linux, and Windows.
---

# WeKnora

Operate a WeKnora knowledge base over its REST API. WeKnora is an external application that owns its own credentials; this Skill never calls `arks` and never reads ArkSpace configuration or Providers.

## Readiness

1. Confirm `WEKNORA_BASE_URL` is set and is the `/api/v1` root, for example `https://weknora.example.com/api/v1`. An internal deployment may legitimately be plain **HTTP**: do not "fix" it to HTTPS, and do not add or re-append `/api/v1` yourself.
2. Confirm `WEKNORA_API_KEY` is set. Never ask the user to paste a key into the conversation, never place it in a command argument or a file, and never append it to `~/.zshrc`, `~/.bashrc`, or any shell profile. If it is missing, ask the user to set it in their own terminal and stop.
3. Probe the key once with `GET /auth/me`. A `403` means the key is invalid or that route carries no policy for API keys — it does not mean credentials are missing.

Refer to the key only as an environment expansion, never as a literal:

```bash
curl -sS "$WEKNORA_BASE_URL/knowledge-bases?page=1&page_size=20" \
  -H "X-API-Key: $WEKNORA_API_KEY"
```

## Preflight

Two checks are mandatory. Skipping them is the usual cause of a confidently wrong answer.

**Before any retrieval**, read the knowledge base and its computed capability flags:

```text
GET /knowledge-bases/:id  →  capabilities: { vector, keyword, wiki, graph, faq }
```

A knowledge base with its retrieval indexes off searches empty **without erroring**. Report that the knowledge base has no usable index rather than reporting "no results". `faq` is true only for a FAQ-type knowledge base.

**Before treating any entry as searchable**, read it and require both fields:

```text
GET /knowledge/:id  →  parse_status == "completed"  AND  enable_status == "enabled"
```

`draft`, `pending`, `processing`, and `finalizing` are not searchable yet. An entry created without `status: "publish"` stays `draft` forever — see [Pitfalls](references/pitfalls.md).

Search and list payloads may carry `data: null` as well as `data: []`. Both mean empty. Do not treat `null` as malformed or retry it.

## Route

Load exactly the reference matching the requested outcome:

- Any endpoint, its required capability, or a request shape: [Endpoints](references/endpoints.md)
- A question over a knowledge base that returns a streamed answer: [SSE chat](references/sse.md)
- A non-2xx response, an unexpected `data` shape, or `403`: [Errors and pagination](references/errors.md)
- An import that never becomes searchable, or a surprising field name: [Pitfalls](references/pitfalls.md)

Do not guess a route from a REST convention. Chunks live at `/chunks/:knowledge_id`, **not** under `/knowledge/:id`. Every route outside [Endpoints](references/endpoints.md) is out of scope for this Skill.

## Workflows

### Import a document and confirm it is searchable

1. Identify the target knowledge base and confirm it with the user.
2. Choose the operation: `POST /knowledge-bases/:id/knowledge/file` for an upload, `.../knowledge/url` for a page, `.../knowledge/manual` for Markdown written here.
3. For `manual`, send `status: "publish"`. Omitting it creates a permanent draft. Send tags as `tag_ids`, an **array**.
4. Read the returned entry id and poll `GET /knowledge/:id` until `parse_status` is `completed` or `failed`. Expect `pending → processing → finalizing → completed`. Parsing takes up to about a minute for a small document; `finalizing` is normal and is not a stall.
5. Report completion only when `parse_status == "completed"` and `enable_status == "enabled"`. On `failed`, report the failure; do not re-upload blindly.
6. A `409` on upload means the file or URL already exists and `data` carries the existing entry. Tell the user that instead of creating a duplicate.

### Answer a question over a knowledge base

1. Run both preflight checks. If either fails, report that and stop.
2. Create a session with `POST /sessions`, then stream with `POST /knowledge-chat/:session_id` or `POST /agent-chat/:session_id`.
3. Assemble the answer from `answer` deltas and terminate on `complete` or `error`. Read [SSE chat](references/sse.md) before writing this consumer; the protocol has non-obvious rules.
4. Prefer `scripts/consume-sse.mjs` over hand-rolled parsing:

   ```bash
   node scripts/consume-sse.mjs --session <session_id> --query "…"
   ```

5. Attribute the answer to the documents in `knowledge_references`. A stream that ends without reaching `complete` is an incomplete result, not an answer.

### Search and read

- One knowledge base: `POST /knowledge-bases/:id/hybrid-search` (POST is the documented form; `GET` exists only for backwards compatibility).
- Several knowledge bases: `POST /knowledge-search`.
- Read one document: `GET /knowledge/:id`. List documents: `GET /knowledge-bases/:id/knowledge`. Read its chunks: `GET /chunks/:knowledge_id`.

### Inspect or fix parsing

1. Read chunks with `GET /chunks/:knowledge_id` to see what was actually indexed, and with `GET /chunks/by-id/:id` for one chunk.
2. Use `PUT /chunks/:knowledge_id/:id` to correct a chunk; revisions are available at `GET /chunks/:knowledge_id/:id/revisions` and `POST /chunks/:knowledge_id/:id/revert`.
3. Re-run parsing with `POST /knowledge/:id/reparse` after changing process configuration. `POST /knowledge/:id/cancel-parse` stops a parse in flight.

### Validate chunking without writing

`POST /chunker/preview` returns the split a document would produce and writes nothing. Use it when the user wants to tune chunking, or when you need to check a document's shape. Prefer it over creating a throwaway knowledge base or entry.

## Safety

- **Never create a knowledge base or a knowledge entry for testing.** Validation goes through `POST /chunker/preview`. Creating content in a user's instance changes their data.
- **Confirm before every irreversible or billable call.** These include all `DELETE` routes, `POST /knowledge/batch-delete`, `POST /knowledge/batch-reparse`, `POST /knowledge/move`, chunk delete and revert, `DELETE /knowledge/:id` (which removes chunks), and session deletes. Name the exact resource and state that it cannot be undone, then wait for confirmation.
- **Tell the user that content leaves their environment.** Uploaded files, submitted URLs, and chat queries are sent to the WeKnora instance and may reach a configured model Provider. Say so before the first call that sends content.
- **Respect the key's scope.** A scoped key is limited to a capability set and often to a knowledge-base allow-list; a call outside it returns `403`. A batch operation touching one out-of-list knowledge base is rejected as a whole, with no partial application. On `403`, report the likely scope mismatch and ask the user to inspect the key; never retry in a loop or broaden the request to work around it.
- **A knowledge-base-scoped key cannot use `?resource_urls=public`** and cannot use the `/files` proxy. Such a key stays in the default `handle` mode; resolve `resource://` handles through the knowledge-base-scoped route instead.
- Never write to, edit, or remove this Skill's own files, or the user's agent configuration, without permission.

## Result handling

- Read the single JSON body. Treat `success: false` as failure and branch on the HTTP status and the numeric `error.code`; see [Errors and pagination](references/errors.md) for the two error shapes.
- Never paste a raw envelope, a session dump, or an entire chunk listing into the conversation. Answer the question, cite the documents, or write the requested artifact.
- Quote a citation as the source document plus knowledge base. WeKnora's `knowledge_references` identify documents, not passage offsets — do not imply passage-level grounding the API did not return.
- On an ingest, report the terminal `parse_status` explicitly. "Uploaded" is not "searchable".
