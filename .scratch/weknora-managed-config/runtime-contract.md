# Runtime retrieval contract

Integrated config/runtime/Skill capability IDs: `weknora.knowledge-bases.list`, `weknora.knowledge-bases.get`, `weknora.search`.

All requests: `{protocolVersion:1, capability:<ID>, input:{...}}`, strict objects. Common input: `confirmed:true` (authorization to read the configured instance), `timeoutMs?:integer=5000` (1–30000ms retrieval). HTTP is supported with an informational plaintext warning; legacy `allowHttp` input is accepted but ignored.

- list: `page?:integer=1` (1–10000), `pageSize?:integer=20` (1–100).
- get: `knowledgeBaseId?:string` (safe opaque identifier, 1–128); omitted uses managed default, absent default fails before HTTP.
- search: `knowledgeBaseId?:string` same default rule; `query:string` (1–4000). `limit?:integer=5` (1–100). Exact pinned first-party evidence: `website-docs/04-api/02-api-knowledge.md` at revision `33c0333ec9474a6d090bab346e1d631a842bafaf` documents POST JSON `{query_text,match_count}`. Runtime maps query→query_text and limit→match_count; uses `resource_urls=handle`. IDs/shapes are integrated in config, runtime, generated schemas, and Skill guidance. Single-KB only, detail preflight then POST hybrid-search, no per-entry fetch, no parse-completed claim.

No arbitrary paths/origin/keys; complete original external env pair overrides managed configuration, incomplete fails. No fallback/retries/state writes. Runtime errors nonretryable/redacted. Issue04 is resolved with integrated Skill/docs and automated acceptance; see the [completion report](report.md).

## Exact result projection

All envelopes: `protocolVersion:1`, capability, `connection:"weknora"`, ok, source (`managed`/`environment` when resolved), warnings. No provider/attempts.

- list `data:{knowledgeBases:[{id,name,description?,type?,capabilities:{vector,keyword,wiki,graph,faq}}],total?,page?,pageSize?}`; upstream `data:null` normalizes to empty.
- get `data:{knowledgeBase:<same projection>}`.
- search `data:{knowledgeBaseId,query,results:[{id,knowledge_id,knowledge_title,content,score?,knowledge_base_id?,chunk_index?,match_type?,metadata?,knowledge_filename?,knowledge_source?,knowledge_description?,knowledge_custom_metadata?}]}`. Native source field names deliberately retained; `id` is chunk reference, `knowledge_id` is document reference. No invented URL, offset, parse/enable status, answer, or per-document fetch. Null/[] is success after a usable vector/keyword preflight. No-index is a distinct failure even when wiki/graph/faq is enabled.
- failure `error:{kind,message,retryable:false,status?}`; permission 403 stops without fallback. Echoed credentials invalidate a response rather than leaking raw payload/error.

Identifier grammar: `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. Retrieval timeout 1–30000ms differs intentionally from preserved verify's 1–5000ms.

Upstream exact response field evidence: pinned `internal/types/search.go` (`SearchResult`), `internal/types/embedding.go` (`MatchType` is numeric 0–9), `internal/types/knowledgebase.go` (computed capabilities). Source coordinates omitted because search context enrichment can rewrite content and coordinate trust flags are internal/non-serialized.

## Verification

- Red: `npx vitest run tests/weknora-retrieval.test.ts` → 9 expected failures, unsupported capability.
- `npm run generate:schemas` and `npm run build` → pass.
- `npx vitest run tests/weknora-retrieval.test.ts tests/weknora-verify.test.ts` → 46 pass.
- `npx vitest run tests/local-http.test.ts tests/local-fetch.test.ts tests/weknora-config.test.ts tests/weknora-verify.test.ts tests/weknora-retrieval.test.ts` → 93 pass.
- `npm run typecheck` → pass. Active LSP probe of eight changed TypeScript paths → zero diagnostics.
- Actual temporary packed npm install (`npm pack --ignore-scripts --pack-destination <temp>` then `npm install --prefix <temp>/install --ignore-scripts --no-audit --no-fund <tgz>`), then `ARKSPACE_RETRIEVAL_ENTRY=<temp>/install/node_modules/@arkspace/cli/dist/cli/main.js npx vitest run tests/weknora-retrieval.test.ts` → 23 pass, including isolated-cwd installed invoke and MCP. Evidence logs: `/tmp/arks-retrieval-installed-LC0W1w/`.

Tests assert exact GET/POST path/body/header, pre-/post-request call counts, defaults/override, disabled tools, index flags, malformed/oversized/cross-KB results, null lists/results, scoped 403, secret echo rejection, original provenance, absent/incomplete/complete external paths, pre-abort/in-flight cancellation, whole-operation deadlines, no config/state changes, generated schemas, and compatible MCP annotations/results.

The [completion report](report.md) records the final 556-test suite, installed-entry qualification, independent copied-Skill execution, and WeKnora real-PTY checks. No live WeKnora service, human UX, or hosted macOS/Windows qualification is claimed. Managed ingestion/chat remain outside this contract.
