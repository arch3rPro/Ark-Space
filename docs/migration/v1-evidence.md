# Version 0.1 migration evidence

## Scope

Version 0.1 is the first executable vertical slice:

- Node.js 20+ TypeScript CLI exposed as `arks`;
- protocol version 1 request and response envelopes;
- `web.search`, `web.related`, `web.fetch`, `web.map`, bounded `web.crawl`, schema-bound `web.extract`, `code.context`, cited `research.run`, owned Browser sessions, and recurring Monitor lifecycles through Exa, Tavily, and Firecrawl;
- environment-variable credential references;
- transactional round-robin selection with cooldown and disable states;
- same-provider key rotation and cross-provider fallback;
- direct-source `web`, `research`, `browser`, and `monitor` Skills and host plugin manifests;
- MCP stdio tools over the same Protocol v1 dispatcher.

Live package publication, OS keychains, SQLite, standalone binaries, Firecrawl Monitor, and remote MCP transports remain deferred.

## Behavior retained

| Behavior | Evidence |
| --- | --- |
| Exa uses `POST /search` and `x-api-key` | Exa official Search API reference and adapter test |
| Tavily uses `POST /search` and bearer authentication | Tavily official Search API reference and adapter test |
| Search Providers normalize title, URL, snippet, score, and publication date | Sanitized response fixtures and adapter tests |
| Exa `/contents`, Tavily `/extract`, and Firecrawl `/v2/scrape` normalize URL content | Sanitized response fixtures and adapter tests |
| Fetch preserves successful pages while reporting Provider-declared per-URL failures | Capability integration tests |
| Firecrawl uses the official bearer-authenticated v2 REST API | Firecrawl official API references and adapter tests |
| Tavily `/map` and Firecrawl `/v2/map` normalize site links under one `web.map` contract | Official Map API references, sanitized fixtures, adapter tests, and capability fallback test |
| `web.map` and `web.crawl` skip unsupported Providers rather than consuming their keys | Capability integration tests |
| Tavily `/crawl` normalizes multi-page Markdown in one synchronous request | Tavily Crawl fixture and adapter test |
| Firecrawl `/v2/crawl` is polled to a terminal state and cancelled after non-terminal failure or timeout | Lifecycle adapter tests |
| Firecrawl pagination cannot send credentials to another origin or job path | Hostile-pagination adapter test |
| Cleanup success or failure remains independent attempt evidence; unconfirmed cleanup suppresses fallback and emits a warning | Capability lifecycle test |
| Exa `/findSimilar` normalizes pages related to an exact source URL | Exa OpenAPI, sanitized fixture, and adapter test |
| Exa `/context` uses Bearer authentication and preserves bounded implementation context metadata | Exa Context reference, sanitized fixture, and adapter test |
| Firecrawl `/v2/extract` polls structured jobs and validates completed data against the caller schema | Firecrawl Extract references, schema-policy tests, lifecycle tests, and Ajv validation test |
| Extract failures after a Job receipt are unsafe to retry and expose possibly-running Job evidence | Capability integration test |
| Exa Agent Research uses asynchronous create/poll and authoritative field-level grounding | Exa Agent references, sanitized fixtures, and adapter tests |
| Exa Research interruption awaits cancellation before fallback; unconfirmed cancellation suppresses fallback | Provider lifecycle and capability tests |
| Tavily Research uses asynchronous create/poll and normalizes its report, sources, and credit usage | Tavily Research references, sanitized fixtures, and adapter tests |
| Tavily post-receipt failures preserve possibly-running Job evidence and suppress retry | Provider lifecycle and capability tests |
| Ambiguous Research submission failures expose acceptance-unknown evidence and suppress duplicate POST retries | Provider and capability tests |
| Firecrawl Browser uses explicit create, bounded structured action, status, and close operations | Browser provider and capability tests |
| Browser ownership pins the creating anonymous key ID; failed initial navigation performs independently reported cleanup | Browser lifecycle tests |
| Browser results omit CDP and live-view authority URLs; uncertain interactions are unsafe to retry | Browser redaction and lifecycle tests |
| Exa Monitor create stores the one-time webhook secret in a new `0600` file and omits it from Protocol output | Monitor secret-storage and redaction tests |
| Monitor update, pause, resume, trigger, deletion, and run history use the creating key and require confirmation for mutations | Monitor lifecycle and Protocol tests |
| MCP registers every capability from its Protocol input schema and returns the complete result envelope as structured content | MCP in-process and built-entry stdio tests |
| Multiple environment-variable keys rotate round-robin | Concurrent key-pool test |
| `401` disables a key | Key-pool state test |
| `429` cools or exhausts a key | Error-taxonomy and key-pool tests |
| Network, quota, rate-limit, and transient failures can fall back | Capability integration tests |
| Invalid requests remain terminal | Capability integration test |
| Machine output contains one JSON envelope and no raw key | Built-entry test and redaction assertions |

## Error taxonomy

| Kind | Meaning | Key state | Default fallback |
| --- | --- | --- | --- |
| `auth` | `401` or confirmed invalid credential | disabled | no; try another key first |
| `permission` | `403` account, policy, or endpoint denial | unchanged | no |
| `rate-limit` | temporary `429` | cooldown | yes |
| `quota` | exhausted credits, usage, plan, or billing allowance | exhausted until long cooldown | yes |
| `transient` | provider `5xx` | unchanged | yes |
| `network` | connection, DNS, timeout, or transport failure | unchanged | yes |
| `invalid-request` | caller-controlled `4xx` other than auth/rate cases | unchanged | no |
| `invalid-response` | successful HTTP response that violates the adapter contract | unchanged | no |
| `config` | missing or invalid local configuration | unchanged | skip unconfigured providers |
| `unknown` | unclassified internal or provider failure | unchanged | no |

Operation-level safety overrides this default table. Acceptance-unknown submissions, possibly-running Jobs, and failed cleanup set `safeToRetry: false` even when the underlying error kind is normally retryable.

## Sources and provenance

| Source | Use | Migration mode |
| --- | --- | --- |
| [Exa Search API](https://docs.exa.ai/reference/search) | Endpoint, authentication, request fields, response vocabulary | reference-only |
| [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) | Endpoint, authentication, request fields, response vocabulary | reference-only |
| [Exa Contents API](https://docs.exa.ai/reference/get-contents) | Fetch endpoint, request fields, and response vocabulary | reference-only |
| [Tavily Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract) | Fetch endpoint, request fields, partial failures, and response vocabulary | reference-only |
| [Firecrawl Search API](https://docs.firecrawl.dev/api-reference/endpoint/search) | v2 Search endpoint and response vocabulary | reference-only |
| [Firecrawl Scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape) | v2 Scrape endpoint and response vocabulary | reference-only |
| [Tavily Map API](https://docs.tavily.com/documentation/api-reference/endpoint/map) | Synchronous site mapping request and response contract | reference-only |
| [Firecrawl Map API](https://docs.firecrawl.dev/api-reference/endpoint/map) | v2 site mapping request and response contract | reference-only |
| [Tavily Crawl API](https://docs.tavily.com/documentation/api-reference/endpoint/crawl) | Synchronous crawl controls and result contract | reference-only |
| [Firecrawl Crawl API](https://docs.firecrawl.dev/api-reference/endpoint/crawl-post) | Remote crawl job creation and bounded crawl controls | reference-only |
| [Firecrawl Crawl Status API](https://docs.firecrawl.dev/api-reference/endpoint/crawl-get) | Polling states, pages, and pagination | reference-only |
| [Firecrawl Cancel Crawl API](https://docs.firecrawl.dev/api-reference/endpoint/crawl-delete) | Remote cleanup contract | reference-only |
| [Exa Public API OpenAPI](https://api.exa.ai/openapi.json) | `/findSimilar` request and response contract | reference-only |
| [Exa Context API](https://docs.exa.ai/reference/context) | Code Context authentication, token budget, and response contract | reference-only |
| [Firecrawl Extract API](https://docs.firecrawl.dev/api-reference/endpoint/extract) | Structured extraction job creation | reference-only |
| [Firecrawl Extract Status API](https://docs.firecrawl.dev/api-reference/endpoint/extract-get) | Extract polling states and completed data | reference-only |
| [Exa Agent create](https://exa.ai/docs/reference/agent-api/create-a-run) | Research run creation, effort controls, and output contract | reference-only |
| [Exa Agent status](https://exa.ai/docs/reference/agent-api/get-a-run) | Research states, grounding, usage, and costs | reference-only |
| [Exa Agent cancellation](https://exa.ai/docs/reference/agent-api/cancel-a-run) | Confirmed Research cleanup contract | reference-only |
| [Tavily Research create](https://docs.tavily.com/documentation/api-reference/endpoint/research) | Research task creation and report controls | reference-only |
| [Tavily Research status](https://docs.tavily.com/documentation/api-reference/endpoint/research-get) | Polling states, report, sources, and usage | reference-only |
| [Research Provider API evidence](../research/research-provider-api-evidence.md) | Current API comparison, deprecations, and lifecycle evidence | reference-only |
| [Browser, Monitor, and MCP API evidence](../research/browser-monitor-mcp-api-evidence.md) | Firecrawl Browser, Exa and Firecrawl Monitor, and stable MCP v2 contracts | reference-only |
| [Firecrawl Browser Sandbox](https://docs.firecrawl.dev/features/browser) | Session lifecycle, TTL, execution, billing, and cleanup | reference-only |
| [Exa Monitors API](https://exa.ai/docs/reference/monitors-api-guide-for-coding-agents) | Monitor lifecycle, schedule, webhook secret, runs, and pricing | reference-only |
| [MCP TypeScript server SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Stable v2 server, stdio, schema, and tool contracts | reference-only |
| Existing ArkSpace Provider tests and fixtures | Behavioral edge-case inventory | reference-only |
| Existing ArkSpace Provider runtime | Rotation, cooldown, fallback, and redaction requirements | reference-only |

The TypeScript implementation and sanitized fixtures were written independently for the new architecture. No Python implementation file was translated or copied. Version 0.1 intentionally replaces the old Firecrawl CLI wrapper with the official REST API so all three Providers share credential rotation, error classification, and fallback behavior.

## Release blockers

- Confirm ownership of `@arkspace/cli` before removing `private: true`.
- Confirm the new project's copyright holder and replace the inherited `LICENSE` copyright line before publication.
- Run npm installation and file-lock tests on Windows and Linux in addition to macOS.
- Decide whether atomic locked JSON remains the state store after the cross-platform spike.
