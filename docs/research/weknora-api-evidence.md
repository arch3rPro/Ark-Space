# WeKnora API evidence for an ArkSpace knowledge Skill

Checked against first-party documentation and upstream source on 2026-09-22. This note evaluates the contract surface of WeKnora, a Tencent open-source RAG / knowledge-base service, so ArkSpace can decide whether and how to build a Skill around it. It is evidence-only: **no reachable WeKnora instance was available for this investigation**, so every statement below is either a documented contract, an upstream-source fact, or a clearly labelled carried-forward field observation. Nothing here is a fresh ArkSpace 实测 result.

Primary first-party sources:

- Documentation site: `https://weknora.weixin.qq.com/docs` (VitePress build; footer states "基于 WeKnora v0.8.0 源码整理").
- Upstream repository: `https://github.com/Tencent/WeKnora`. Evidence base is the `main` branch at `33c0333ec9474a6d090bab346e1d631a842bafaf` (2026-09-22), plus the release tag `v0.8.0` (`1edcd54b`, 2026-09-03) for drift checks.
- Vendor Skill marketplace page: `https://clawhub.ai/lyingbug/weknora` (`@lyingbug/weknora`, MIT-0).
- A prior operator's critique of that vendor Skill, written against a real v0.8.0 instance (`commit 1edcd54`, Go 1.26.0, `postgres` keyword and vector engines, `minio_enabled: true`, `db_version: 90`). Its HTTP observations are quoted below as **carried-forward field evidence**, never as reproduced-by-us.

Evidence tags used throughout: **[docs]**, **[source]**, **[vendor]**, **[clawhub-scanner]**, **[field v0.8.0, carried forward]**.

## Decision summary

- **WeKnora is an external domain application with its own credential system.** A Skill wrapping it should follow the "Guidance only" (or, at most, "Skill-local script" for SSE) execution model from `docs/adding-skills.md`. It must **not** use `arks` and must not import ArkSpace internals: WeKnora's API Key is the credential, and no ArkSpace Provider/fallback/quota machinery is involved.
- **Machine auth is `X-API-Key`, and it is a separate authority from user JWT/RBAC.** A workspace key is bound to one tenant and rejects another `X-Tenant-ID` with 403. A platform key (issued from `/system/admin/api-keys`) must send `X-Tenant-ID` or it gets 409 `TENANT_REQUIRED`. API-key authorization is **default-deny**: a route with no declared policy is 403 for any API key **[source]**.
- **A key is either full-access or carries an explicit capability set**, and it may additionally be restricted to a KB allow-list. This is the single most important thing a Skill must surface: the caller's capabilities determine whether ingest, retrieve, chat, or management calls will even be reachable.
- **The useful skill surface is small and mostly read/ingest.** In scope: knowledge-base read/search, document import (file/URL/manual), knowledge detail and parse control, chunks, FAQ/Wiki, and the chat/session SSE flow. Out of scope for a first Skill: tenant/org/member lifecycle, platform system admin, models and initialization, vector stores, storage backends, data sources, IM/Embed channels, sandbox/skills inventory, long-term memory, and evaluations.
- **SSE is implementable from the documented contract plus source.** Every chat route emits `event: message` frames whose `data:` is a `StreamResponse` JSON; the answer is the concatenation of `response_type: "answer"` `content` deltas, and the stream terminates on `response_type: "complete"` (`done: true`) or `response_type: "error"` (`done: true`). The docs' `response_type` list is **incomplete** versus source (source adds `install_output`, `command_output`, `artifacts_pending`, `memory_recalled`, `steer`, `user_message_injected`, `context_compacted`, `install_prompt`, and a non-documented `"stop"` type) **[source]**.
- **The vendor `@lyingbug/weknora` Skill is structurally usable but has several confirmed hard errors**, most seriously a manual-import example that omits `status`, leaving the entry as a permanent `draft`, and a wrong `tag_id` parameter name. It covers ~11 endpoints and 5 capability classes, versus ~31 MCP tools and ~400 documented REST endpoints.
- **Do not copy the vendor Skill's safety posture.** It instructs the user to paste a long-lived plaintext API key into `~/.zshrc`/`~/.bashrc`, passes `DELETE` endpoints with no confirmation requirement, and never tells the operator that content leaves the environment. ClawHub's own scanner labels the package `suspicious` **[clawhub-scanner]**.

## 1. Evidence base, versions, and drift

| Artifact | Identity | Notes |
| --- | --- | --- |
| Docs site | `weknora.weixin.qq.com/docs` | 59 routes in `hashmap.json`; footer credits v0.8.0 source **[docs]** |
| Upstream `main` | `33c0333`, 2026-09-22 | `VERSION=0.8.0`; used as source-of-truth for source evidence |
| Upstream tag `v0.8.0` | `1edcd54b`, 2026-09-03 | Two weeks older than deployed docs |
| Deployed API pages | 14 group pages | File list matches `main`'s `website-docs/04-api/` |

**Version drift found and resolved.** The `v0.8.0` tag's `website-docs/04-api/` directory is missing `02-api-memory.md` and `02-api-sandbox-skills.md`, which the deployed docs and `main` both contain. The API group nav in the deployed overview lists 14 groups including 长期记忆 (long-term memory) and 沙箱、技能与个人变量 (sandbox, skills, personal variables) **[docs]**; the tag simply predates them. This note therefore uses `main` for source claims and the deployed URLs for the documented contract, and flags that anyone reading the `v0.8.0` tag will not find those two groups.

The deployed docs are the authoritative endpoint contract. The upstream router is the authoritative implementation surface and is stricter than the prose: the API-key gate fails closed, so a route that appears in docs but lacks a declared policy is 403 for machine callers **[source]**.

Sources: [API overview](https://weknora.weixin.qq.com/docs/04-api/01-api-overview), [tenant/auth feature](https://weknora.weixin.qq.com/docs/03-features/01-tenant-auth), upstream `main` `VERSION`, `website-docs/`.

## 2. Authentication and authorization for a machine client

### 2.1 Credential selection

Authentication order in `internal/middleware/auth.go` is JWT Bearer → `X-API-Key` → Embed token **[docs]**; the Embed path is irrelevant to a machine Skill. Base path is `/api/v1`. Health check `GET /health` needs no auth.

| Credential | Issued at | Binding | `X-Tenant-ID` rule |
| --- | --- | --- | --- |
| Workspace key | `POST /api/v1/tenants/:id/api-keys` | One tenant | Optional; pointing at another tenant → **403** |
| Platform key | `POST /api/v1/system/admin/api-keys` | Not tenant-bound | **Required** on ordinary routes; missing → **409 `TENANT_REQUIRED`** (excepted: `/system/admin/*`, `/tenants/all`, `/tenants/search`, `POST /tenants`) |
| JWT Bearer | login / OIDC | user identity | Optional switch; 400 on malformed/zero |

Both key lists are **JWT-only**: an API key calling the key-management routes is denied. The plaintext secret is returned only once, at creation; list responses are masked **[docs]**.

### 2.2 The capability model

An API key is either `full_access` or carries a set of capability constants. The enforced constants are (`internal/types/tenant_api_key.go`) **[source]**:

`retrieve`, `ingest`, `chat`, `read_agents`, `manage_kbs`, `manage_agents`, `message_history`, `manage_models`, `manage_mcp_services`, `manage_datasources`, `manage_channels`, `manage_vector_stores`, `manage_storage_backends`, `manage_web_search`, `run_evaluations`, `manage_members`, `manage_spaces`, `manage_tenant_settings`, and platform-level `system_tenants_read`, `system_tenants_manage`, `system_settings_read`, `system_settings_manage`, `system_runtime_read`, `system_runtime_manage`, `system_audit_read`.

Documented mapping to the skill-relevant operations **[docs]**:

| Capability | Grants (skill-relevant subset) |
| --- | --- |
| `retrieve` | KB list/detail, knowledge detail, list, `hybrid-search`, `knowledge-search`, chunker preview, download/preview |
| `ingest` | upload file/URL, manual create/update, chunk/FAQ/tag/Wiki edits, batch reparse/delete/move, folder create |
| `chat` | create session, `knowledge-chat`, `agent-chat`, message load/delete |
| `read_agents` | list/view agents |
| `manage_kbs` | KB create/update/delete/copy/duplicate and initialization config |
| `message_history` | tenant-scoped chat history search/stats (not part of `chat`) |

### 2.3 Default-deny route policy

`internal/middleware/api_key_gate.go` defines `APIKeyRoutePolicy{PlatformOnly, RequireFullAccess, Capabilities}`. Every API-key-reachable route is registered explicitly; **an absent policy returns 403** with body `{"error":"Forbidden: API key scope does not allow this operation"}` **[source]**. Router helpers are `apiKeyAny()`, `apiKeyFullAccess()`, `apiKeyPlatform(caps...)`, `apiKeyRetrieve`, `apiKeyChat`, `apiKeyIngest`, `apiKeyReadAgents`. A startup self-check (`assertAPIKeyPoliciesMatchRoutes`) panics if a declared policy has no matching route, so policy surface and route surface cannot silently drift **[source]**.

**Practical consequence for a Skill:** when a call fails with 403, the Skill cannot reliably distinguish "capability missing", "KB outside allow-list", and "route has no policy for API keys". It should instruct the operator to inspect the key's capabilities rather than retrying.

### 2.4 KB allow-list

`TenantAPIKeyScope.KnowledgeBaseIDs` non-empty means the key may only touch listed KBs; a single out-of-list KB is 403, and a batch operation where any KB is out of list is rejected as a whole (no partial overlap) **[docs]**, **[source]**. Capabilities never widen the KB set.

A separate, Skill-relevant wrinkle: a **KB-scoped key cannot use `resource_urls=public`** (403) and cannot use the generic `/files` proxy. Such a key must stay in `handle` mode and resolve `resource://` references through a KB-scoped proxy **[docs]**.

### 2.5 Ownership vs. machine principal

Human RBAC has four role guards (Viewer/Contributor/Admin/Owner) and two ownership guards (created-by-OR-Admin). Resources with a `creator_id` (KB, Agent, Knowledge doc, Chunk, Wiki page, FAQ entry, KB tag) use ownership guards on mutation; tenant-wide infrastructure (models, vector stores, IM/Embed channels, web-search providers, data sources, MCP services, cloud credentials) uses `Admin()`. Entry points `POST /knowledge-bases` and `POST /agents` require `Contributor()`. **API-key principals never satisfy an ownership check** — a synthetic system user has no matching `creator_id`, so machine authorization is entirely the capability gate **[source]**.

Sources: [API overview](https://weknora.weixin.qq.com/docs/04-api/01-api-overview), [tenant/auth feature](https://weknora.weixin.qq.com/docs/03-features/01-tenant-auth), [file access feature](https://weknora.weixin.qq.com/docs/03-features/21-file-access), upstream `internal/types/tenant_api_key.go`, `internal/middleware/api_key_gate.go`, `internal/middleware/auth.go`, `internal/router/rbac.go`.

## 3. Endpoint inventory by group

The documentation publishes 14 API groups. Counting endpoint headings (`### METHOD /path`) and table rows gives roughly **402 documented endpoints**; group totals overlap where pages cross-list routes (e.g. `/knowledge-bases/:id/files` appears in both knowledge and channels). The upstream `main` router registers more routes than this because it includes internal/worker endpoints not documented; the documented set is the correct contract for a Skill.

Group summary and include/exclude decision:

| # | Group (docs page) | Prefixes | Endpoints | Include in Skill? |
| --- | --- | --- | --- | --- |
| 1 | Auth and user (`02-api-auth`) | `/auth`, `/me/invitations` | 22 | Partly: `GET /auth/me`, `GET /auth/validate` as cheap identity/health probes; exclude register/login/OIDC/password |
| 2 | Tenant and members (`02-api-tenant`) | `/tenants`, `/tenants/:id/{members,invitations,api-keys}`, `/knowledge-bases/:id/activity` | 27 | Exclude (admin lifecycle). Knowledge-base activity read is optional |
| 3 | Organizations and sharing (`02-api-org`) | `/organizations`, `/shared-*`, `/knowledge-bases/:id/shares` | 35 | Exclude |
| 4 | Knowledge bases and knowledge (`02-api-knowledge`) | `/knowledge-bases`, `/knowledge` | 38 | **Core** |
| 5 | Chunks and tags (`02-api-chunks`) | `/chunks`, `/knowledge-bases/:id/tags`, `/chunker/preview` | 15 | **Core** (read/edit chunks, preview) |
| 6 | FAQ and Wiki (`02-api-faq-wiki`) | `/knowledge-bases/:id/faq`, `/faq`, `/knowledgebase/:kb_id/wiki` | 34 | Include (KB-type dependent) |
| 7 | Sessions, messages, chat (`02-api-chat`) | `/sessions`, `/messages`, `/knowledge-chat`, `/agent-chat`, `/knowledge-search` | 26 | **Core** (chat SSE) |
| 8 | Models and initialization (`02-api-model-system`) | `/models`, `/initialization`, `/evaluation`, `/weknoracloud` | 26 | Exclude (setup/admin) |
| 9 | System and platform (`02-api-system`) | `/system`, `/system/admin` | 24 | Exclude; only `GET /system/info` as a version probe, noting its envelope |
| 10 | Infrastructure and data sources (`02-api-infra`) | `/vector-stores`, `/storage-backends`, `/web-search-providers`, `/datasource` | 44 | Exclude |
| 11 | Agent and MCP (`02-api-agent-mcp`) | `/agents`, `/mcp-services`, `/agent`, `/user/favorites` | 32 | Exclude management; `read_agents` only if a chat Skill uses agents |
| 12 | Channels / IM / Embed / files (`02-api-channels`) | `/im`, `/im-channels`, `/wechat`, `/embed-channels`, `/embed`, `/files` | 31 | Exclude (but note `/files` for `handle` resolution) |
| 13 | Sandbox, skills, personal vars (`02-api-sandbox-skills`) | `/sandbox-configs`, `/skills`, `/me/env-vars` | 32 | Exclude |
| 14 | Long-term memory (`02-api-memory`) | `/memory`, `/tenants/kv/memory-config` | 16 (+2 space config) | Exclude (personal memory; not KB knowledge) |

### 3.1 In-scope group details

Roles are human-JWT roles; "cap" is the API-key requirement where documented.

**Knowledge bases and knowledge (`02-api-knowledge`) — 38 endpoints [docs]**

| Method | Path | Role | API-key cap |
| --- | --- | --- | --- |
| POST | `/api/v1/knowledge-bases` | Contributor+ | `manage_kbs`/full |
| GET | `/api/v1/knowledge-bases` | Viewer+ | `retrieve`/full |
| GET | `/api/v1/knowledge-bases/:id` | Viewer+, KB read | `retrieve`/full |
| PUT | `/api/v1/knowledge-bases/:id` | creator OR Admin+, KB write | `manage_kbs`/full |
| DELETE | `/api/v1/knowledge-bases/:id` | creator OR Admin+, KB write | `manage_kbs`/full |
| PUT | `/api/v1/knowledge-bases/:id/pin` | Viewer+, KB read | — |
| POST | `/api/v1/knowledge-bases/:id/hybrid-search` (GET compatible) | Viewer+, KB read | `retrieve`/full |
| POST | `/api/v1/knowledge-bases/copy` | Contributor+ | `manage_kbs`/full |
| POST | `/api/v1/knowledge-bases/:id/duplicate` | Contributor+, source KB read | `manage_kbs`/full |
| GET | `/api/v1/knowledge-bases/copy/progress/:task_id` | Viewer+ | `retrieve`/`manage_kbs`/full |
| GET | `/api/v1/knowledge-bases/:id/move-targets` | Viewer+, KB read | — |
| GET | `/api/v1/knowledge-bases/:id/files` | Viewer+, KB read | — |
| POST | `/api/v1/knowledge-bases/:id/knowledge/file` | creator OR Admin+, KB write | `ingest`/full |
| POST | `/api/v1/knowledge-bases/:id/knowledge/url` | creator OR Admin+, KB write | `ingest`/full |
| POST | `/api/v1/knowledge-bases/:id/knowledge/manual` | creator OR Admin+, KB write | `ingest`/full |
| GET | `/api/v1/knowledge-bases/:id/knowledge` | Viewer+, KB read | `retrieve`/full |
| GET | `/api/v1/knowledge-bases/:id/knowledge/folders` | Viewer+ + KBAccessRead | — |
| PUT | `/api/v1/knowledge-bases/:id/knowledge/folders` | owner OR Admin+ + KBAccessWrite | — |
| DELETE | `/api/v1/knowledge-bases/:id/knowledge` | Admin+, KB write | full only |
| GET | `/api/v1/knowledge/batch` | Viewer+ | `retrieve`/full |
| GET | `/api/v1/knowledge/:id` | Viewer+, parent KB read | `retrieve`/full |
| GET | `/api/v1/knowledge/:id/stages` | Viewer+, parent KB read | — |
| PUT | `/api/v1/knowledge/:id` | creator OR Admin+ | `ingest`/full |
| DELETE | `/api/v1/knowledge/:id` | creator OR Admin+, KB write | `ingest`/full |
| PUT | `/api/v1/knowledge/manual/:id` | creator OR Admin+ | `ingest`/full |
| POST | `/api/v1/knowledge/:id/regenerate-summary` | owner/Admin+, KB write | — |
| POST | `/api/v1/knowledge/:id/reparse` | creator OR Admin+ | `ingest`/full |
| POST | `/api/v1/knowledge/:id/cancel-parse` | creator OR Admin+ | `ingest`/full |
| GET | `/api/v1/knowledge/:id/download` | Viewer+, KB read | `retrieve`/full |
| GET | `/api/v1/knowledge/:id/preview` | Viewer+, KB read | — |
| PUT | `/api/v1/knowledge/image/:id/:chunk_id` | creator OR Admin+ | `ingest`/full |
| GET | `/api/v1/knowledge/search` | Viewer+ | `retrieve`/full |
| GET | `/api/v1/knowledge/move/progress/:task_id` | Viewer+ | `retrieve`/full |
| PUT | `/api/v1/knowledge/tags` | Contributor+ | `ingest`/full |
| POST | `/api/v1/knowledge/batch-reparse` | Contributor+ | `ingest`/full |
| POST | `/api/v1/knowledge/batch-delete` | Contributor+ | `ingest`/full |
| POST | `/api/v1/knowledge/folder` | Contributor+ | `ingest` |
| POST | `/api/v1/knowledge/move` | Contributor+ | `ingest`/full (source+target in allow-list) |

**Chunks and tags (`02-api-chunks`) — 15 endpoints [docs]**

| Method | Path | Cap |
| --- | --- | --- |
| GET | `/api/v1/chunks/:knowledge_id` | `retrieve` |
| GET | `/api/v1/chunks/by-id/:id` | `retrieve` |
| PUT | `/api/v1/chunks/:knowledge_id/:id` | `ingest` |
| DELETE | `/api/v1/chunks/:knowledge_id/:id` | `ingest` |
| DELETE | `/api/v1/chunks/:knowledge_id` | `ingest` |
| GET | `/api/v1/chunks/:knowledge_id/:id/revisions` | `retrieve` |
| POST | `/api/v1/chunks/:knowledge_id/:id/revert` | `ingest` |
| DELETE | `/api/v1/chunks/by-id/:id/questions` | `ingest` |
| PUT | `/api/v1/chunks/by-id/:id/questions` | `ingest` |
| POST | `/api/v1/chunks/by-id/:id/questions/regenerate` | `ingest` |
| GET | `/api/v1/knowledge-bases/:id/tags` | `retrieve` |
| POST | `/api/v1/knowledge-bases/:id/tags` | `ingest` |
| PUT | `/api/v1/knowledge-bases/:id/tags/:tag_id` | `ingest` |
| DELETE | `/api/v1/knowledge-bases/:id/tags/:tag_id` | `ingest` |
| POST | `/api/v1/chunker/preview` | `retrieve`/`ingest`/full |

Note the chunks prefix is `/api/v1/chunks/:knowledge_id`, **not** nested under `/knowledge`. `POST /chunker/preview` is the only documented way to preview chunking without writing to the database, which makes it the preferred preflight for validation.

**Sessions, messages and chat (`02-api-chat`) — 26 endpoints [docs]**

| Method | Path | Cap |
| --- | --- | --- |
| POST | `/api/v1/sessions` | `chat` |
| GET | `/api/v1/sessions` | `chat` |
| GET | `/api/v1/sessions/:id` | `chat` |
| PUT | `/api/v1/sessions/:id` | `chat` |
| DELETE | `/api/v1/sessions/:id` | `chat` |
| DELETE | `/api/v1/sessions/batch` | `chat` |
| DELETE | `/api/v1/sessions/:id/messages` | `chat` |
| POST | `/api/v1/sessions/:session_id/generate_title` | `chat` |
| POST | `/api/v1/sessions/:session_id/stop` | `chat` |
| POST | `/api/v1/sessions/:session_id/pin` | `chat` |
| GET | `/api/v1/sessions/continue-stream/:session_id` | `chat` (SSE resume; `?message_id=` required) |
| POST | `/api/v1/sessions/:session_id/attachments` | `chat` |
| GET | `/api/v1/sessions/:id/attachments` | `chat` |
| GET | `/api/v1/sessions/:id/attachments/:attachment_id` | `chat` |
| GET | `/api/v1/sessions/:id/attachments/:attachment_id/preview` | `chat` |
| DELETE | `/api/v1/sessions/:id/attachments/:attachment_id` | `chat` |
| GET | `/api/v1/sessions/:id/messages/:message_id/suggestions` | `chat` |
| POST | `/api/v1/sessions/:session_id/messages/:message_id/suggestions` | `chat` |
| POST | `/api/v1/sessions/:session_id/suggestion-events` | `chat` |
| POST | `/api/v1/knowledge-chat/:session_id` | `chat` (SSE) |
| POST | `/api/v1/agent-chat/:session_id` | `chat` (SSE) |
| POST | `/api/v1/knowledge-search` | `retrieve` |
| POST | `/api/v1/messages/search` | `message_history` |
| GET | `/api/v1/messages/chat-history-stats` | `message_history` |
| GET | `/api/v1/messages/:session_id/load` | `chat` |
| DELETE | `/api/v1/messages/:session_id/:id` | `chat` |

**FAQ and Wiki (`02-api-faq-wiki`) — 34 endpoints [docs]**

FAQ routes: `/knowledge-bases/:id/faq/entries` (list/export/get/create/update/delete), singular `POST /knowledge-bases/:id/faq/entry`, `POST .../faq/entries/:entry_id/similar-questions`, `PUT .../faq/entries/fields`, `PUT .../faq/entries/tags`, `POST .../faq/search`, `PUT .../faq/import/last-result/display`, `GET /faq/import/progress/:task_id`. Wiki routes under `/knowledgebase/:kb_id/wiki`: pages (list/create/move/get-by-slug/update/revisions/revert/delete), folders (list/create/update/delete), `index`, `graph`, `stats`, `search`, `rebuild-links`, `lint`, `auto-fix`, `issues`, `PUT .../issues/:issue_id/status`. Wiki read requires Viewer+ + KBAccessRead; wiki revert requires owner/Admin+ + KBAccessWrite.

**Auth probes (`02-api-auth`) — 22 endpoints, only 2 in scope [docs]**

`GET /api/v1/auth/me` is the documented identity probe; the API-key policy is `apiKeyAny()` (any valid key), and it is one of the whitelisted routes that accepts a JWT with no active space. `GET /api/v1/system/info` is a version/health probe but uses `{"code":0,"msg":"success","data":...}`, not `{"success":true,...}`.

### 3.2 Out-of-scope groups (exclude, with reason)

- **Tenant/members (27)** — key issuance, roles, invitations, audit log: administrative, JWT-oriented, and key-management routes reject API keys.
- **Organizations/sharing (35)** — cross-space governance; a scoped machine key is explicitly not the intended principal.
- **Models/initialization (26)** — embedding/LLM/VLM setup and Ollama management; belongs to deployment setup, not knowledge operations.
- **System/platform (24)** — platform keys and `system_*` capabilities; wrong principal and high blast radius.
- **Infrastructure (44)** — vector stores, storage backends, web-search providers, data sources.
- **Agent/MCP management (32)** — agent CRUD, MCP services, OAuth/tool approval, favorites; only relevant if the Skill also drives agent chat.
- **Channels/IM/Embed/files (31)** — IM bots, embed widgets, channel file proxies; `GET /files` is useful only to explain `handle` resolution.
- **Sandbox/skills/personal vars (32)** — managing code-execution sandboxes and skill catalogs; unrelated.
- **Long-term memory (16+2)** — caller-scoped memory items/topics/document preferences; conceptually distinct from KB knowledge.

Sources: [API overview group nav](https://weknora.weixin.qq.com/docs/04-api/01-api-overview), and the 14 sibling pages `https://weknora.weixin.qq.com/docs/04-api/02-api-{auth,tenant,org,knowledge,chunks,faq-wiki,chat,model-system,system,infra,agent-mcp,sandbox-skills,memory,channels}`.

## 4. Response, error, and pagination contract

### 4.1 Success envelopes

The default is `{ "success": true, "data": ... }`. List responses add `total`, `page`, `page_size`. Documented exceptions **[docs]**:

- Some `/system/admin/*` reads return raw rows/arrays without the wrapper.
- `/system/info` and similar return `{"code":0,"msg":"success","data":...}`.

### 4.2 Error envelopes

Business errors are rendered by `internal/middleware/error_handler.go` as:

```json
{ "success": false, "error": { "code": 1003, "message": "...", "details": null } }
```

**The `code` is a number, not a string.** The numeric table (`internal/errors/errors.go`) **[source]**:

| Code | Constant | HTTP |
| --- | --- | --- |
| 1000 | ErrBadRequest | 400 |
| 1001 | ErrUnauthorized | 401 |
| 1002 | ErrForbidden | 403 |
| 1003 | ErrNotFound | 404 |
| 1004 | ErrMethodNotAllowed | 405 |
| 1005 | ErrConflict | 409 |
| 1006 | ErrTooManyRequests | 429 |
| 1007 | ErrInternalServer | 500 |
| 1008 | ErrServiceUnavailable | 503 |
| 1009 | ErrTimeout | 504 |
| 1010 | ErrValidation | 400 |
| 2000–2005 | tenant not found / exists / inactive / name required / invalid status / creation disabled | varies |
| 2100–2103 | agent missing thinking model / allowed tools / invalid max-iterations / invalid temperature | varies |
| 2200–2201 | vector-store binding invalid / unavailable | 400 |
| 2300 | ErrModelInUse | 409 |

The docs table stops at 1010 and lists only the common group plus a prose note about 2000–2005, 2100–2103, 2200–2201; the source additionally defines **1004, 1008, 1009, and 2300**, which the docs omit.

**Two shapes coexist.** Middleware-layer failures (auth/RBAC/API-key gate) return `{"error": "..."}`, sometimes with a string `code` such as `TENANT_REQUIRED`; they are not wrapped in the AppError shape. A Skill must branch on HTTP status and presence of `error.code` (number) vs `error` (string).

Two non-coded error types also matter **[docs]**:

- `types.DuplicateKnowledgeError` — duplicate file/URL upload returns **409** and `data` carries the already-existing Knowledge. This is not a failure to retry blindly.
- `types.StorageQuotaExceededError` — storage quota exceeded.

### 4.3 Pagination

`internal/handler/list_pagination.go` **[docs]**, **[source]**:

| Param | Default | Bounds |
| --- | --- | --- |
| `page` | 1 | ≥ 1 |
| `page_size` | 20 | 1–100 |

Out-of-range values return validation error `1010`. Cursor pagination is used for audit logs (`after_id`+`limit`, response `next_cursor`), system runtime tasks (`cursor`+`page_size`, response `next_cursor`/`has_more`), and Wiki index/log (`cursor`+`limit`).

Sources: [API overview](https://weknora.weixin.qq.com/docs/04-api/01-api-overview), upstream `internal/middleware/error_handler.go`, `internal/errors/errors.go`, `internal/handler/list_pagination.go`.

## 5. SSE streaming protocol

The documented streaming routes are `POST /api/v1/knowledge-chat/:session_id`, `POST /api/v1/agent-chat/:session_id`, `GET /api/v1/sessions/continue-stream/:session_id`, plus the embed equivalents **[docs]**. Headers set by `setSSEHeaders` **[source]**:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Frame format.** Every event is emitted via gin's `c.SSEvent("message", payload)`, so each frame is:

```
event: message
data: {"id":"<request-id>","response_type":"answer","content":"...","done":false,...}

```

There is no custom `event:` name. Clients parse `data:` as `types.StreamResponse` **[source]**.

**Response fields** (documented) **[docs]**:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | request ID |
| `response_type` | string | event category |
| `content` | string | incremental text |
| `done` | bool | whether this event type is finished |
| `knowledge_references` | []SearchResult | carried by `references` |
| `tool_calls` | []LLMToolCall | tool-call events |
| `session_id` / `assistant_message_id` | string | carried by `agent_query` |
| `usage` | TokenUsage | prompt/completion/total/cache tokens |
| `finish_reason` | string | stop reason |

**Termination and assembly.** Concatenate the `content` of `response_type: "answer"` events to build the visible answer. The stream ends on `response_type: "complete"` with `done: true`, or on `response_type: "error"` with `done: true`. Source marks only `complete` and `error` as terminal for the purpose of flushing buffered reference tails **[source]**. `continue-stream` replays persisted events and then polls for increments every 100 ms; `?message_id=` is required. `POST /sessions/:session_id/stop` yields a `response_type: "stop"` event (`done: true`) that the docs do not list.

**Response-type coverage.** Documentation lists: `answer`, `references`, `thinking`, `tool_call`, `tool_result`, `reflection`, `session_title`, `agent_query`, `tool_approval_required`, `tool_approval_resolved`, `mcp_oauth_required`, `mcp_oauth_resolved`, `error`, `complete` **[docs]**. Source additionally defines `install_output`, `command_output`, `artifacts_pending`, `memory_recalled`, `steer`, `user_message_injected`, `context_compacted`, `install_prompt`, and emits `"stop"` **[source]**. A robust client should treat unknown `response_type` values as ignorable rather than fatal.

**Known implementation detail:** `sendCompletionEvent` is intentionally a no-op because completion is already signalled by the `complete` event **[source]**. A title-generation event may follow completion; clients should not assume `complete` is the last bytes on the wire.

**`resource_urls`.** On streaming and search routes, `?resource_urls=public` rewrites `resource://` handles into storage short links (grant 2 h) or MinIO presigned URLs (24 h); unsupported values return 400; KB-scoped API keys get 403. Embed channels are forced back to `handle` **[docs]**.

Sources: [API overview SSE](https://weknora.weixin.qq.com/docs/04-api/01-api-overview), [chat API](https://weknora.weixin.qq.com/docs/04-api/02-api-chat), upstream `internal/types/chat.go`, `internal/handler/session/helpers.go`, `internal/handler/session/stream.go`, `internal/handler/session/resource_urls.go`, `internal/handler/session/qa.go`.

## 6. Vendor Claw Skill surface and defect verification

**Artifact:** `@lyingbug/weknora`, MIT-0, ClawHub `clawhub.ai/lyingbug/weknora`. Package metadata **[vendor]**, **[clawhub-scanner]**: `createdAt` 1782811384052, 2 versions (latest `k973dvtz8se129ww6jbpm9vgs989mrm8`), downloads 2139, installs 46, stars 13; `SKILL.md` sha256 `a41fa279…`, 6913 bytes; skill-card sha256 `6d3b233e…`, 1869 bytes.

### 6.1 Actual surface

Frontmatter requires env `WEKNORA_API_KEY` and `WEKNORA_BASE_URL` (example: `https://your-server.com/api/v1`). A `wk_api()` shell helper wraps `curl`. The decision table declares these endpoints **[vendor]**:

`GET /knowledge-bases`, `GET /knowledge-bases/:id`, `POST /knowledge-bases/:id/knowledge/file`, `POST /knowledge-bases/:id/knowledge/url`, `POST /knowledge-bases/:id/knowledge/manual`, `GET /knowledge/:id`, `GET /knowledge-bases/:id/knowledge`, `PUT /knowledge/manual/:id`, `DELETE /knowledge/:id`, `GET /knowledge-bases/:id/hybrid-search`, `POST /knowledge-search`, plus `POST /knowledge/:id/reparse` in the Notes. That is ~11 table endpoints + 1 note endpoint = **12 distinct endpoints**, consistent with the docs page's "能力范围 导入、检索、浏览（5 类）" claim **[docs]**. The Skill has **no** chat/session/SSE, chunk, tag, folder, batch-operation, FAQ, or Wiki coverage.

### 6.2 Seven carried-forward defect claims, verified or refuted

The claims come from the prior operator's critique and were re-checked against docs + `main` source. "Carried-forward field evidence" is the operator's real v0.8.0 observation and is not independently reproduced here.

| # | Claim | Verdict | Evidence |
| --- | --- | --- | --- |
| a | Skill exposes only ~10 endpoints / 5 capability classes, missing chat/QA/chunks | **Confirmed** | 12 distinct endpoints; docs claim 5 classes; no chat/chunks routes **[vendor]**, **[docs]** |
| b | `ManualKnowledgePayload` omits `status`; without `status:"publish"` the entry stays a draft forever | **Confirmed** | `ManualKnowledgePayload` has `Status`; `IsDraft()` returns true when empty or `"draft"`; constants `ManualKnowledgeStatusDraft`/`Publish`; vendor example omits it **[source]**, **[vendor]**. Field evidence: omitted status → `parse_status="draft"`, `enable_status="disabled"`, no progress after 90 s; with `publish` → `pending`→`finalizing`→`completed` (~57 s) **[field v0.8.0, carried forward]** |
| c | Wrong parameter name `tag_id`; real names are `tag_ids` (array in JSON body, comma-separated string in query) | **Confirmed** | `ManualKnowledgePayload.TagIDs []string json:"tag_ids"` **[source]**; docs manual field table `tag_ids`/`[]string`, list query `tag_ids`/string OR **[docs]**; vendor uses `tag_id` in both the manual body and the list query **[vendor]** |
| d | "Pre-search premise" — Skill calls `hybrid-search` without first checking KB indexing capabilities, and assumes `data[]` | **Confirmed** | KB JSON has a computed `capabilities` object `{vector,keyword,wiki,graph,faq}` (`internal/types/knowledgebase.go` `MarshalJSON`/`Capabilities`) **[source]**, so a preflight exists and the Skill does not use it. `hybrid-search` passes the service's slice straight to `data`; a nil slice serialises as `null`, whereas `knowledge-search` observed `[]` **[carried forward]**. Docs only promise `data:[SearchResult]`, so the `null` shape is an undocumented edge. The Skill's L135 "Search Result ... `data[]`" assumption is therefore unsafe **[vendor]** |
| e | Skill lacks Q&A/SSE, chunk operations, tags, folders, and batch operations | **Confirmed** | Absent from the decision table and all workflows **[vendor]**; endpoints exist per §3 **[docs]** |
| f | Skill lacks the numeric error-code table and the SSE protocol | **Confirmed** | Vendor's "Error Handling" shows `"code": "ERROR_CODE"` (a string) and an HTTP-only table (400/401/403/404/413/500); no 409 duplicate handling, no 429, no numeric codes; no SSE section **[vendor]**, **[source]** |
| g | Safety posture is inadequate | **Confirmed** | Vendor instructs writing the key into `~/.zshrc`/`~/.bashrc`; `DELETE /knowledge/:id` listed with no confirmation rule; no statement that content leaves the environment; no capability/KB-scope guidance **[vendor]**. ClawHub's scanner labels the package `suspicious` and reports "Plaintext API Key Persistence and Missing HTTPS Enforcement"; its LLM review flags `instruction_scope` (DELETE without confirm/ownership/irreversibility) and `persistence_privilege` (long-lived plaintext key in shell profile) **[clawhub-scanner]** |

Three further errors in the vendor Skill, from the same critique, are also confirmed:

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Recommends `GET .../hybrid-search`, but POST is the documented, recommended form; GET-with-body is backward compatibility (issue #1727) | **Confirmed** | Docs heading reads "POST …/hybrid-search（兼容 GET）" and the text recommends POST **[docs]**; vendor L69/L111/L156 use GET **[vendor]** |
| `parse_status` enum incomplete (`pending→processing→completed\|failed`); missing `draft` and `finalizing` | **Confirmed** | `ManualKnowledgeStatusDraft = "draft"`; quickstart documents `pending → processing → finalizing → completed` **[docs]**, **[source]**; field evidence shows `finalizing` with `summary_status` already `completed` **[carried forward]**; vendor enum omits both **[vendor]** |
| No chunk-endpoint hint, and `/knowledge/:id/chunks` is a common wrong guess (404) | **Confirmed** | Real route is `GET /api/v1/chunks/:knowledge_id` **[docs]**; field evidence: `/knowledge/:id/chunks` → 404, `/chunks/:knowledge_id` → 200 **[carried forward]** |

### 6.3 Biggest correction

The single most consequential fix is **manual knowledge creation must send `status: "publish"`**. A Skill copied from the vendor's example creates a draft that is silently never parsed or indexed, and every downstream "search finds nothing / no chunks" symptom then looks like a retrieval problem when it is an ingestion problem. `status` is a real field on `ManualKnowledgePayload`, and `IsDraft()` is true for empty or `"draft"` **[source]**. The related `tag_ids` array-vs-string mismatch makes the second example fail or drop tags.

Sources: [Claw Skill docs page](https://weknora.weixin.qq.com/docs/05-clients/07-claw-skill), [ClawHub package page](https://clawhub.ai/lyingbug/weknora), [knowledge API](https://weknora.weixin.qq.com/docs/04-api/02-api-knowledge), upstream `internal/types/knowledge.go`, `internal/types/knowledgebase.go`, `internal/handler/knowledgebase.go`, `internal/handler/session/qa.go`.

## 7. MCP server boundary comparison

WeKnora ships a first-party MCP server (`mcp-server/weknora_mcp_server.py`, install `pip install tencent-weknora-mcp`, entry `weknora-mcp-server`, transports stdio / SSE / Streamable HTTP). The authoritative tool count in `main` is **31** **[source]**:

`agent_chat`, `chat`, `create_knowledge_base`, `create_knowledge_from_file`, `create_knowledge_from_text`, `create_knowledge_from_url`, `create_model`, `create_session`, `create_tenant`, `delete_chunk`, `delete_knowledge`, `delete_knowledge_base`, `delete_session`, `get_agent`, `get_knowledge`, `get_knowledge_base`, `get_model`, `get_session`, `hybrid_search`, `list_agents`, `list_chunks`, `list_knowledge`, `list_knowledge_bases`, `list_models`, `list_sessions`, `list_shared_knowledge_bases`, `list_tenants`, `update_knowledge_from_text`, `wiki_index_view`, `wiki_read_page`, `wiki_search`.

Notable docstrings **[source]**: `chat` — "RAG pipeline chat: retrieve relevant chunks from knowledge bases, then summarise with LLM"; `agent_chat` — "Agentic pipeline chat"; `create_knowledge_from_text` — "Create a knowledge entry from raw Markdown text".

Comparison points for Skill design:

- The MCP server deliberately **exposes chat and sessions**, which the vendor Claw Skill omits, and it reaches tenant/model management, which this Skill should not.
- The MCP server **does not expose** chunk editing/revisions, tags, folders, batch reparse/delete/move, FAQ, or wiki authoring; those exist only in REST.
- WeKnora as an MCP **client** supports SSE / Streamable HTTP only (stdio disabled for security), with API Key / Bearer / OAuth2 (DCR+PKCE) and per-tool human approval. That is a useful safety precedent: human confirmation on mutating tools is a first-party pattern, not an ArkSpace invention.
- A "31 tools" inventory is a boundary signal: a focused ArkSpace Skill does not need to replicate tenant/model/session management to be useful. Its natural scope is the read/ingest/chat subset.

Sources: [MCP feature](https://weknora.weixin.qq.com/docs/03-features/08-mcp), upstream `mcp-server/weknora_mcp_server.py`.

## 8. Skill design implications

Using the vocabulary and decision table in `docs/adding-skills.md`:

- **Execution model: Guidance only, plus an optional skill-local script for SSE.** The host has shell/network; there are no ArkSpace credentials, Provider fallback, quotas, or durable state to share. WeKnora is a domain application that already owns the operation, so the "External tool" model fits conceptually but there is no installed `weknora` binary to detect. The pragmatic shape is a `SKILL.md` that teaches the contract, with a small deterministic `scripts/` SSE consumer if reliable stream assembly is needed. **No `arks` invocation.**
- **Boundary (the five prompts to write down):**
  1. *Should activate:* "import this PDF into the `产品文档` knowledge base"; "what does the KB say about refunds"; "search my knowledge bases for X"; "why is this document stuck in draft / failed to parse"; "show me the chunks for this document".
  2. *Should activate a neighboring Skill instead:* generic web research (not a KB), file management for files not in WeKnora, agent/MCP administration, tenant/member administration.
  3. *Output and completion:* a citation-bearing answer assembled from `answer` deltas; or an ingest result that explicitly reaches `parse_status == "completed"` and `enable_status == "enabled"`.
  4. *External side effects and confirmation:* uploads, manual create/update, chunk edits, and every `DELETE`/batch delete/move are irreversible or billable; require explicit confirmation and never auto-create test data in a user's instance.
  5. *Required tools:* `curl` (or the host's HTTP tool) and network access to `$WEKNORA_BASE_URL`. Note honestly in `compatibility` that hosts without shell/network cannot run the workflows.
- **Preflight is mandatory, not optional.** Before any retrieval: `GET /knowledge-bases/:id` and inspect `capabilities.{vector,keyword,wiki,graph,faq}`; before treating any entry as searchable: `GET /knowledge/:id` and require `parse_status == "completed"` and `enable_status == "enabled"`. Explain that retrieval with all indexes off returns empty silently rather than erroring, and that `data` may be `null` or `[]`.
- **Handle both error shapes and the numeric table.** Branch on HTTP status, on numeric `error.code` (AppError), and on string `error` (middleware). Treat 409 duplicate-knowledge specially: it returns the existing Knowledge in `data`.
- **Use `POST /chunker/preview` for validation** instead of writing test documents; reserve create/delete for explicit user intent; list destructive endpoints in the Skill and require a second confirmation.
- **Do not persist the key in shell profiles.** Recommend the key be supplied per-invocation via environment, and support plain-HTTP internal base URLs (do not hard-code HTTPS assumptions).
- **Reference files** (`references/`) are the natural home for the full endpoint inventory, the SSE protocol, the numeric error table, and the pitfall list, keeping `SKILL.md` as the decision table plus workflows.
- **Verification** should include at least three activation prompts and three neighbouring non-activation prompts in `tests/fixtures/skill-activation.json`, an isolated host layout with sibling Skills and the source repo removed, and a check of the external result (parsed/completed entry, citation-bearing answer) rather than command exit status.

Sources: `docs/adding-skills.md`; [API overview](https://weknora.weixin.qq.com/docs/04-api/01-api-overview); [knowledge API](https://weknora.weixin.qq.com/docs/04-api/02-api-knowledge); [chunks API](https://weknora.weixin.qq.com/docs/04-api/02-api-chunks); [chat API](https://weknora.weixin.qq.com/docs/04-api/02-api-chat).

## 9. Gaps and unresolved questions

- **No live instance.** Nothing in this note was executed against a running WeKnora. The `data: null` vs `data: []` asymmetry, the 90-second draft stall, the `finalizing` duration, and the 404 on `/knowledge/:id/chunks` are all **carried-forward field observations**, not reproduced here. They are consistent with source but not proven by this investigation.
- **Documented-vs-source drift in enums and codes.** The docs' `response_type` list omits eight source constants plus `"stop"`; the docs' error table omits 1004/1008/1009/2300; the docs' `parse_status` enum appears only in quickstart and manual field tables, not in a single canonical schema. There is no published OpenAPI/JSON-schema artifact to settle these.
- **Per-endpoint capability is not uniformly documented.** The router is the ground truth, but its `apiKeyRoute` policy is spread across router files and partially inferred from helper names. The §3.1 capability column reflects documented statements; a few rows are marked `—` where no API-key policy is documented.
- **Exact endpoint count is approximate (~402).** Group totals overlap on cross-listed routes, and internal router registrations outnumber documented routes. The 31 MCP tools are exact; the REST count is not.
- **`v0.8.0` tag is incomplete.** It lacks the memory and sandbox-skills API pages present in both deployed docs and `main`. Anyone pinning the tag for offline reading will miss them.
- **The vendor Skill was not executed.** Defects were verified against docs, source, and ClawHub's own scanner, but no live behaviour of the downloaded Skill was reproduced.
- **The carried-forward critique's provenance is a prior operator session**, not a first-party artifact. It is the only field evidence available and is labelled as such throughout.

Sources: upstream `main`/`v0.8.0`, `https://weknora.weixin.qq.com/docs`, `https://clawhub.ai/lyingbug/weknora`.
