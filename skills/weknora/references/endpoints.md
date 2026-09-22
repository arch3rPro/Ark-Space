# Endpoints

Every route this Skill uses, grouped as WeKnora documents it. `cap` is the API-key requirement; a `full_access` key satisfies all of them. Paths omit the `/api/v1` prefix that `$WEKNORA_BASE_URL` supplies.

Routes not listed here are out of scope — see [Out of scope](#out-of-scope).

## Conventions

- Auth: `X-API-Key: $WEKNORA_API_KEY`. A workspace key also rejects a foreign `X-Tenant-ID` with `403`.
- Success shape: `{ "success": true, "data": … }`, with `total` / `page` / `page_size` on lists.
- `page` defaults to 1 and `page_size` to 20 (range 1–100). Out of range returns error `1010`.

## Identity probes

| Method | Path | Cap | Use |
| --- | --- | --- | --- |
| GET | `/auth/me` | any key | Confirm the key works. |
| GET | `/system/info` | — | Version probe. Returns `{"code":0,"msg":"success","data":…}`, **not** the `success` envelope. |

## Knowledge bases and knowledge

| Method | Path | Cap |
| --- | --- | --- |
| GET | `/knowledge-bases` | `retrieve` |
| GET | `/knowledge-bases/:id` | `retrieve` |
| POST | `/knowledge-bases` | `manage_kbs` |
| PUT | `/knowledge-bases/:id` | `manage_kbs` |
| DELETE | `/knowledge-bases/:id` | `manage_kbs` |
| PUT | `/knowledge-bases/:id/pin` | — |
| POST | `/knowledge-bases/:id/hybrid-search` (GET compatible) | `retrieve` |
| POST | `/knowledge-bases/copy` | `manage_kbs` |
| POST | `/knowledge-bases/:id/duplicate` | `manage_kbs` |
| GET | `/knowledge-bases/copy/progress/:task_id` | `retrieve` |
| GET | `/knowledge-bases/:id/move-targets` | — |
| GET | `/knowledge-bases/:id/files` | — |
| POST | `/knowledge-bases/:id/knowledge/file` | `ingest` |
| POST | `/knowledge-bases/:id/knowledge/url` | `ingest` |
| POST | `/knowledge-bases/:id/knowledge/manual` | `ingest` |
| GET | `/knowledge-bases/:id/knowledge` | `retrieve` |
| GET | `/knowledge-bases/:id/knowledge/folders` | — |
| PUT | `/knowledge-bases/:id/knowledge/folders` | — |
| DELETE | `/knowledge-bases/:id/knowledge` | full access only |
| GET | `/knowledge/batch` | `retrieve` |
| GET | `/knowledge/:id` | `retrieve` |
| GET | `/knowledge/:id/stages` | — |
| PUT | `/knowledge/:id` | `ingest` |
| PUT | `/knowledge/manual/:id` | `ingest` |
| DELETE | `/knowledge/:id` | `ingest` |
| POST | `/knowledge/:id/reparse` | `ingest` |
| POST | `/knowledge/:id/cancel-parse` | `ingest` |
| POST | `/knowledge/:id/regenerate-summary` | — |
| GET | `/knowledge/:id/download` | `retrieve` |
| GET | `/knowledge/:id/preview` | — |
| PUT | `/knowledge/image/:id/:chunk_id` | `ingest` |
| GET | `/knowledge/search` | `retrieve` |
| GET | `/knowledge/move/progress/:task_id` | `retrieve` |
| PUT | `/knowledge/tags` | `ingest` |
| POST | `/knowledge/batch-reparse` | `ingest` |
| POST | `/knowledge/batch-delete` | `ingest` |
| POST | `/knowledge/folder` | `ingest` |
| POST | `/knowledge/move` | `ingest` (source and target both in allow-list) |

## Chunks and tags

Note the prefix: chunks are **not** nested under `/knowledge`. `/knowledge/:id/chunks` is a common wrong guess and returns `404`.

| Method | Path | Cap |
| --- | --- | --- |
| GET | `/chunks/:knowledge_id` | `retrieve` |
| GET | `/chunks/by-id/:id` | `retrieve` |
| PUT | `/chunks/:knowledge_id/:id` | `ingest` |
| DELETE | `/chunks/:knowledge_id/:id` | `ingest` |
| DELETE | `/chunks/:knowledge_id` | `ingest` |
| GET | `/chunks/:knowledge_id/:id/revisions` | `retrieve` |
| POST | `/chunks/:knowledge_id/:id/revert` | `ingest` |
| DELETE | `/chunks/by-id/:id/questions` | `ingest` |
| PUT | `/chunks/by-id/:id/questions` | `ingest` |
| POST | `/chunks/by-id/:id/questions/regenerate` | `ingest` |
| GET | `/knowledge-bases/:id/tags` | `retrieve` |
| POST | `/knowledge-bases/:id/tags` | `ingest` |
| PUT | `/knowledge-bases/:id/tags/:tag_id` | `ingest` |
| DELETE | `/knowledge-bases/:id/tags/:tag_id` | `ingest` |
| POST | `/chunker/preview` | `retrieve`, `ingest`, or full |

`POST /chunker/preview` is the only documented way to see how a document would be split without writing to the database.

## Sessions, messages, and chat

| Method | Path | Cap |
| --- | --- | --- |
| POST | `/sessions` | `chat` |
| GET | `/sessions` | `chat` |
| GET | `/sessions/:id` | `chat` |
| PUT | `/sessions/:id` | `chat` |
| DELETE | `/sessions/:id` | `chat` |
| DELETE | `/sessions/batch` | `chat` |
| DELETE | `/sessions/:id/messages` | `chat` |
| POST | `/sessions/:session_id/generate_title` | `chat` |
| POST | `/sessions/:session_id/stop` | `chat` |
| POST | `/sessions/:session_id/pin` | `chat` |
| GET | `/sessions/continue-stream/:session_id` | `chat` (SSE resume; `?message_id=` required) |
| POST | `/sessions/:session_id/attachments` | `chat` |
| GET | `/sessions/:id/attachments` | `chat` |
| GET | `/sessions/:id/attachments/:attachment_id` | `chat` |
| GET | `/sessions/:id/attachments/:attachment_id/preview` | `chat` |
| DELETE | `/sessions/:id/attachments/:attachment_id` | `chat` |
| GET | `/sessions/:id/messages/:message_id/suggestions` | `chat` |
| POST | `/sessions/:session_id/messages/:message_id/suggestions` | `chat` |
| POST | `/sessions/:session_id/suggestion-events` | `chat` |
| POST | `/knowledge-chat/:session_id` | `chat` (SSE) |
| POST | `/agent-chat/:session_id` | `chat` (SSE) |
| GET | `/messages/:session_id/load` | `chat` |
| DELETE | `/messages/:session_id/:id` | `chat` |
| POST | `/knowledge-search` | `retrieve` |
| POST | `/messages/search` | `message_history` |
| GET | `/messages/chat-history-stats` | `message_history` |

`/knowledge-search` needs `retrieve`, not `chat`. History search needs `message_history`, which is a separate capability from `chat`.

The two chat routes differ in pipeline, not in transport: `knowledge-chat` retrieves chunks and then summarises, while `agent-chat` runs the agentic pipeline and can emit tool, reflection, and approval events. Read [SSE chat](sse.md) before consuming either.

## FAQ and Wiki

Both are knowledge-base-type dependent. Read `capabilities.faq` and `capabilities.wiki` on the knowledge base first.

FAQ, under `/knowledge-bases/:id/faq` and `/faq`:

- Entries: list, export, get, create, update, delete on `.../faq/entries`; create on the singular `.../faq/entry`.
- Entry fields and tags: `PUT .../faq/entries/fields`, `PUT .../faq/entries/tags`.
- Similar questions: `POST .../faq/entries/:entry_id/similar-questions`.
- Search: `POST .../faq/search`. Import progress: `GET /faq/import/progress/:task_id`.

Wiki, under `/knowledgebase/:kb_id/wiki`:

- Pages: list, create, move, get-by-slug, update, revisions, revert, delete.
- Folders: list, create, update, delete.
- `index`, `graph`, `stats`, `search`, `rebuild-links`, `lint`, `auto-fix`, `issues`, and `PUT .../issues/:issue_id/status`.

Wiki reads need read access to the knowledge base; wiki revert additionally needs write access.

## Out of scope

Deliberately excluded from this Skill. Do not reach for them without the user asking for the specific capability by name.

| Group | Prefixes | Why excluded |
| --- | --- | --- |
| Tenant and members | `/tenants`, `/tenants/:id/{members,invitations,api-keys}` | Administrative lifecycle. Key-management routes reject API keys outright. |
| Organizations and sharing | `/organizations`, `/shared-*`, `/knowledge-bases/:id/shares` | Cross-space governance; a machine key is not the intended principal. |
| Models and initialization | `/models`, `/initialization`, `/evaluation` | Deployment setup, not knowledge operations. |
| System and platform | `/system`, `/system/admin` | Platform keys, high blast radius. |
| Infrastructure and data sources | `/vector-stores`, `/storage-backends`, `/web-search-providers`, `/datasource` | Deployment setup. |
| Agent and MCP management | `/agents`, `/mcp-services`, `/agent`, `/user/favorites` | Only agent **chat** is in scope; CRUD and OAuth approval are not. |
| Channels, IM, Embed, files | `/im`, `/im-channels`, `/wechat`, `/embed-channels`, `/embed`, `/files` | Except to explain `resource://` handling in [SSE chat](sse.md). |
| Sandbox, skills, personal variables | `/sandbox-configs`, `/skills`, `/me/env-vars` | Unrelated. |
| Long-term memory | `/memory`, `/tenants/kv/memory-config` | Caller-scoped memory, conceptually distinct from knowledge-base content. |

## Capability reference

A key is either `full_access` or carries a subset of these constants. The ones relevant here:

| Capability | Grants (this Skill's subset) |
| --- | --- |
| `retrieve` | Knowledge base list and detail, knowledge detail and list, `hybrid-search`, `knowledge-search`, replication preview, download and preview, chunk reads, tag reads |
| `ingest` | File, URL, and manual import; chunk, FAQ, tag, and Wiki edits; batch reparse, delete, and move; folder creation |
| `chat` | Session create, `knowledge-chat`, `agent-chat`, message load and delete |
| `message_history` | Cross-session history search and stats — **not** part of `chat` |
| `manage_kbs` | Knowledge base create, update, delete, copy, duplicate |
| `read_agents` | List and view agents |

A scoped key may additionally be limited to a `knowledge_base_ids` allow-list, and capabilities never widen that list.
