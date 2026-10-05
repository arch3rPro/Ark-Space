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
| [SearXNG Search API](https://docs.searxng.org/dev/search_api.html) | Search parameter vocabulary; documentation pointer, live retrieval unavailable in this environment | reference-only; no documentation/source copied |
| [Existing ArkSpace SearXNG adapter](https://github.com/arch3rPro/Ark-Space/blob/280cbf0efa7c7b511f24e9c701bb30f51c519992/skills/web-search/scripts/searxng_search.py) | Endpoint suffix, JSON output, categories/engines/language/page/safesearch/time-range and source metadata vocabulary | Behavioral reference at `280cbf0efa7c7b511f24e9c701bb30f51c519992`, MIT per reference LICENSE; no code imported or translated |
| [pi-web-access SearXNG adapter](https://github.com/nicobailon/pi-web-access/blob/4c61056cec03c247bdfe725e9bc255eb1756ea81/searxng.ts) | Comparison of self-hosted configuration, local domain filtering, cancellation, and SSRF boundaries | Reference-only at `4c61056cec03c247bdfe725e9bc255eb1756ea81`, MIT (Nico Bailon); no source imported or adapted |
| Existing ArkSpace Provider tests and fixtures | Behavioral edge-case inventory | reference-only |
| Existing ArkSpace Provider runtime | Rotation, cooldown, fallback, and redaction requirements | reference-only |

The TypeScript implementation and sanitized fixtures were written independently for the new architecture. No Python implementation file was translated or copied. Version 0.1 intentionally replaces the old Firecrawl CLI wrapper with the official REST API so all three Providers share credential rotation, error classification, and fallback behavior.

### SearXNG migration evidence

The independent TypeScript SearXNG slice retains bounded search and optional source metadata, not the legacy CLI or Provider-manager architecture. The imported source surface is **none**: locally authored fixtures and tests exercise `GET <base-path>/search`, keyless execution, malformed/empty responses, local domain filtering, strict categories, classified errors, cancellation, explicit CIDRs, and built CLI configuration/invocation. Environment resolution deliberately changes legacy precedence: persisted configuration wins. Category broadening, automatic network retries, auth headers and proxies are unsupported. See [ADR 0013](../adr/accepted/0013-searxng-keyless-self-hosted-search.md). No live-instance success or hosted cross-platform qualification is claimed.

The initial single-instance source verification passed `npm run check` (31 files, 197 tests) and `npm run verify:package`. An offline npm artifact was installed into a temporary isolated prefix; its absolute installed `arks` command configured a loopback fixture with an explicit `/32` exception and executed `arks invoke web.search --input <file>` successfully. The check verified no fake key ID, no key-pool state, and no automatic order insertion. It does not substitute for a real SearXNG instance or Windows/macOS qualification. Regression tests also reject uppercase and expanded mapped-IPv6 CIDRs before persistence and preserve unrelated fetch execution when SearXNG leads the configured order.

Multi-key terminal setup is covered by `tests/setup.test.ts` and `tests/credentials.test.ts`, including repeat setup, numbered appends, environment precedence, cancellation, registration failure recovery, and concurrent creation-only writes. Only synthetic credential values are used.

### Multi-instance SearXNG extension

The current source extends the initial slice with additive SearXNG setup, canonical per-instance configuration, persistent anonymous instance-state metadata, round-robin selection, classified failover, independent cooldowns, and eligible-instance time budgets. Legacy single-endpoint/environment configuration remains compatible; singleton execution still does not write health state. See [ADR 0014](../adr/accepted/0014-searxng-instance-rotation.md).

`npm run check` passed 32 test files and 232 tests, and `npm run verify:package` passed. Additional isolated npm-installed fixture checks balanced six concurrent `arks invoke web.search` processes 3/3 across two instances and exited a held-lock operation timeout in under two seconds without state mutation. Tests cover terminal SSRF failures, per-instance CIDRs, empty-result success, all-failed/cooling behavior, timeout/cancellation, stale config snapshots, and late concurrent success preserving cooldown. A separate isolated installed-entry check drove 14 synthetic prompts through a real local pseudo-terminal: setup stored two hidden fixture keys and two SearXNG instances, then separate installed CLI processes verified A/B rotation, A `503` to B failover, and subsequent cooldown skipping. Instance state contained no endpoint URLs or fake keys, and fixture key input was not echoed. This is local fixture evidence, not live SearXNG or hosted Windows/macOS qualification. Reference projects, credential stores outside temporary test homes, and release versions were not changed.

### Menu-based setup extension

The current source replaces sequential onboarding with numbered `arks setup [provider]` menus. `tests/setup.test.ts`, `tests/setup-management.test.ts`, and built-entry tests cover targeted management, original environment precedence, explicit ownership guards, manual key disabling, order preservation, confirmation, and local-versus-live checks. See [ADR 0015](../adr/accepted/0015-menu-based-provider-setup.md).

`npm run check` passed 33 files and 258 tests; `npm run verify:package` passed with 176 files and no runtime install scripts. Active LSP probes reported no diagnostics in eleven changed TypeScript files. Source-entry Linux pseudo-terminal checks used synthetic keys to verify continuous hidden CRLF input, selected-key disable, back/exit, cancellation without saving pending input, and rejection of multiline paste without echo or persistence.

A separately packed artifact was installed offline into an isolated prefix and temporary ArkSpace home. Its installed `arks` entry stored two hidden fixture keys, retried an invalid URL in place, added two individually consented loopback instances, and preserved CIDRs on an unchanged URL edit. Configuration made no network request. Three explicitly confirmed tests through the shared search dispatcher verified A success, B `503` to A failover, and B cooldown skipping; state retained anonymous instance IDs without URLs or secrets. Non-TTY setup left existing configuration byte-for-byte unchanged and made no requests. Final installed-entry regression checks also kept SearXNG disabled while appending an instance, sent zero requests for a confirmed test while disabled, and required explicit re-enabling before a successful request; invalid edited URLs retried at the same prompt. This remains synthetic local-fixture evidence, not real-service or hosted Windows/macOS qualification; no user credentials, reference projects, versions, or global installations were changed.

### Bilingual setup and dashboard lists

The source dashboard now separates references, locally validated credential values, effective sources, pool eligibility and cached health in multiline Provider lists. SearXNG uses keyless instance statistics. Snapshot rendering revives expired key cooldowns only in its view, ignores old multi-instance cooldown for a singleton like runtime selection does, and never writes health state. The dashboard does not claim real-time service validation.

Setup supports English/Chinese with session-only `--lang en|zh` and explicitly saved menu selection in optional `setupLanguage`. Precedence, direct-Provider switching, invalid flags before mutation, translated safety/errors, partial-write recovery and default-no English/Chinese confirmation are covered by setup and built-entry tests. `npm run check` passed 33 files and 274 tests; `npm run verify:package` passed with 179 files and no runtime install scripts. Active LSP probes reported zero diagnostics in eight changed TypeScript files.

A freshly packed artifact was installed offline in an isolated prefix and temporary home. Real Linux pseudo-terminal checks switched the dashboard and direct-Provider menus in both directions, verified remembered choices versus ephemeral flags and environment locales, and displayed two local sources, one environment source, one missing reference and a disabled key without echoing synthetic credentials. Chinese `否` granted no private permission and sent no request; `是` confirmed fixture-instance removal; `确认` granted only a single-IP CIDR and authorized exactly one explicitly selected fixture search. Setup language did not change the fixed test query. No real service, user credentials, global installation, version, reference repository or hosted Windows/macOS qualification was involved.

### Native setup TUI revision

User feedback superseded the verbose dashboard and intermediate management pickers. The new native Node TUI uses a minimal Provider list, directly selectable keys/instances inside each Provider page, arrow/Enter navigation, Esc return, and an owned alternate-screen session that clears old pages/forms and restores the terminal. See [ADR 0016](../adr/accepted/0016-tui-provider-setup.md). No dependency, version, storage or machine-protocol change was introduced.

`npm run check` passed 34 files and 283 tests. Package verification passed with 182 files and no runtime install scripts; active LSP probes found zero diagnostics in five changed TypeScript files. Real Linux pseudo-terminal source-entry checks verified shallow key selection, removal of previous page content, hidden synthetic key entry, Chinese direct-Provider access, Esc/Ctrl-C exit and canonical terminal-mode restoration. A separately packed, offline-installed artifact verified arrow-based language switching, saved Chinese preference and clean terminal restoration. The first language smoke-test wait matched an intermediate repaint before persistence finished; waiting for the resulting Chinese dashboard verified the completed operation. These are isolated local fixture checks, not real-service or hosted Windows/macOS qualification; no user configuration, global installation or reference project was modified.

## Release blockers

- Confirm ownership of `@arkspace/cli` before removing `private: true`.
- Confirm the new project's copyright holder and replace the inherited `LICENSE` copyright line before publication.
- Run npm installation and file-lock tests on Windows and Linux in addition to macOS.
- Decide whether atomic locked JSON remains the state store after the cross-platform spike.
