# SSE chat

The streamed-answer protocol. Read this before writing any consumer; several rules are not obvious from the documented summary.

## Request

```text
POST /knowledge-chat/:session_id                          # retrieve, then summarise
POST /agent-chat/:session_id                              # agentic pipeline: tools, reflection, approvals
GET  /sessions/continue-stream/:session_id?message_id=…   # resume an interrupted stream
```

The two chat routes differ in pipeline, not transport. Create the session first with `POST /sessions` and pass a JSON body carrying the query.

Optional query parameter `resource_urls` — see [Resource URLs](#resource-urls).

## Transport

The server sets:

```text
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

## Frame format

Every event uses the SSE name `message`. There is no custom event name, so a frame is:

```text
event: message
data: {"id":"…","response_type":"answer","content":"…","done":false}

```

Parse `data:` as a `StreamResponse` object. A frame's `data:` may be split across multiple TCP reads, so buffer on blank-line boundaries rather than assuming one read equals one frame.

## Response fields

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | request ID |
| `response_type` | string | event category |
| `content` | string | incremental text |
| `done` | boolean | whether this event type has finished |
| `knowledge_references` | `SearchResult[]` | carried by `references` |
| `tool_calls` | `LLMToolCall[]` | carried by tool-call events |
| `session_id`, `assistant_message_id` | string | carried by `agent_query` |
| `usage` | `TokenUsage` | prompt, completion, total, and cache token counts |
| `finish_reason` | string | why generation stopped |

## `response_type` values

Documented:

`answer`, `references`, `thinking`, `tool_call`, `tool_result`, `reflection`, `session_title`, `agent_query`, `tool_approval_required`, `tool_approval_resolved`, `mcp_oauth_required`, `mcp_oauth_resolved`, `error`, `complete`

Present in the server implementation but absent from the docs:

`install_output`, `command_output`, `artifacts_pending`, `memory_recalled`, `steer`, `user_message_injected`, `context_compacted`, `install_prompt`, and `stop`

**Treat an unrecognised `response_type` as ignorable, never as fatal.** The documented list is incomplete and the server can add categories; a consumer that throws on an unknown type breaks on a server upgrade it should have survived.

Consume only what you need:

| Type | Use |
| --- | --- |
| `answer` | Concatenate `content` to build the visible answer. |
| `references` | Collect `knowledge_references` for citation. |
| `complete` | Terminal success. |
| `error` | Terminal failure. Report `content`. |
| `stop` | Terminal: the user or client called `POST /sessions/:session_id/stop`. Distinct from `complete`. |
| `thinking`, `tool_call`, `tool_result`, `reflection` | Optional progress. Do not include in the answer text. |
| `session_title` | A generated title. Ignore for answer purposes. |

## Assembly and termination

- The visible answer is the **concatenation of `content` from `answer` events only**. Other event types carry their own text and must not be appended.
- The stream terminates on `response_type: "complete"` with `done: true`, or on `response_type: "error"` with `done: true`.
- **`complete` is not necessarily the last bytes on the wire.** A `session_title` event can follow it. Stop reading on the terminal event rather than on connection close, and do not treat a connection that closes after `complete` as truncation.
- A stream that ends without a terminal event is an **incomplete** result. Report it as such; never present a partial concatenation as an answer.
- Frames are buffered server-side so that a `resource://` reference split across chunks is rewritten whole. Client-side, references arrive complete — but only the `references` event carries them, so do not attempt to parse citation markers out of `answer` text.

## `continue-stream`

`GET /sessions/continue-stream/:session_id?message_id=…` resumes a stream that was interrupted. `message_id` is required. It replays already-persisted events and then polls for increments every 100 ms, so it can emit frames you have already seen; deduplicate by event if you assemble from it.

## Resource URLs

Answers and search results refer to images and attachments by an internal handle, `resource://<handle>`, which requires a second authenticated call against the `/files` proxy to resolve.

Pass `?resource_urls=public` for a directly renderable link. The only accepted values are `handle` (the default) and `public`; anything else returns `400`. The parameter is accepted on the chat routes, `continue-stream`, `GET /messages/:session_id/load`, `POST /knowledge-search`, and `POST /knowledge-bases/:id/hybrid-search`.

Before using it, know that:

- It needs outbound link capability. With a local storage backend and no `APP_EXTERNAL_URL` configured, handles are returned unchanged and you should still fall back to `/files`.
- **Public links are anonymous and time-limited.** A WeKnora grant lasts 2 hours; a MinIO presigned URL lasts 24 hours. Anyone holding the link can read it until it expires. Do not log it, and do not forward it beyond the user who asked.
- Embed channels are forced back to `handle`.
- **A knowledge-base-scoped API key gets `403`.** Such a key is barred from the `/files` proxy, and an anonymous link would bypass that same restriction. Stay in `handle` mode with a scoped key.

## Consumer

`scripts/consume-sse.mjs` implements all of the above and prints one JSON object:

```bash
node scripts/consume-sse.mjs --session <session_id> --query "…"
```

Add `--resource-urls public` to request direct links. Diagnostics go to stderr; stdout carries only the JSON envelope.
