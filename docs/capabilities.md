# Skill, Capability, and Provider Reference

This reference maps each canonical Skill to its public `arks` capabilities and Provider implementations. Use it to decide which Skill to activate and which Provider credentials an operation can require. Execution and failure semantics are defined in [Architecture](architecture.md#capability-handlers); request and result fields are defined by [`schemas/protocol/v1/`](../schemas/protocol/v1/).

## Skill abilities

| Skill | User-facing abilities |
| --- | --- |
| [`web`](../skills/web/SKILL.md) | Find public sources, retrieve exact pages, discover or crawl sites, extract schema-bound data, and collect implementation examples. |
| [`research`](../skills/research/SKILL.md) | Synthesize public evidence into a bounded, cited comparison, landscape, or decision-ready report. |
| [`browser`](../skills/browser/SKILL.md) | Open an owned remote browser session, inspect page state, perform confirmed structured interactions, verify results, and close the session. |
| [`monitor`](../skills/monitor/SKILL.md) | Create and manage persistent recurring searches or site-change checks, including lifecycle operations and run history. |
| [`weknora`](../skills/weknora/SKILL.md) | Search, ingest, inspect, and answer questions over a user's own WeKnora knowledge base through its REST API. |

`gh-repo` is an unreleased checkout addition for revision-pinned GitHub project analysis and supporting issue/PR inspection. It uses host tools and native GitHub CLI/API reads, not an `arks` capability or Provider. See its [canonical instructions](../skills/gh-repo/SKILL.md).

`weknora` is an external-tool Skill: it calls a user-managed WeKnora instance directly and declares **no** `arks` capability or Provider dependency. It therefore does not appear in the operation tables below.

## Stateless operations and bounded jobs

| Skill | Capability | Ability | Providers | Provider behavior |
| --- | --- | --- | --- | --- |
| `web` | `web.search` | Search the public Web for ranked sources. | Exa, Tavily, Firecrawl, SearXNG (explicit instances) | Configured order and classified fallback; SearXNG uses instance rotation/failover without keys and is not added to the default order. |
| `web` | `web.related` | Find pages related to a known URL. | Exa | Single Provider. |
| `web` | `web.fetch` | Retrieve content from exact URLs and return bounded response IDs for later reads. | Exa, Tavily, Firecrawl, Local (explicit and disabled by default) | Remote Providers use configured order, key rotation, and classified fallback. Response bodies are held in a private bounded TTL cache; `web.content.get` reads them by opaque response ID. |
| `web` | `web.content.get` | Read cached fetch content with offset/limit and exact case-sensitive or case-insensitive text lookup. | Local cache | IDs expire and are bounded by configured count and bytes; search response IDs are not accepted. Case-insensitive literal lookup is Unicode-aware and preserves original UTF-16 offsets. |
| `web` | `web.map` | Discover URLs within a site. | Tavily, Firecrawl | Configured order, key rotation, and classified fallback. |
| `web` | `web.crawl` | Traverse and retrieve a bounded site area. | Tavily, Firecrawl | Fallback only after the prior remote outcome is safely settled. |
| `web` | `web.extract` | Extract schema-bound structured data from pages. | Firecrawl | Single Provider; model-backed remote job. |
| `web` | `code.context` | Retrieve current implementation examples and supporting context. | Exa | Single Provider. |
| `research` | `research.run` | Run a bounded multi-source research synthesis. | Exa, Tavily | Fallback only after the prior Research Job is safely settled. |

## SearXNG search

SearXNG and the rebuilt human Setup workbench are included in [0.1.3](../release/0.1.3.md); the release notes record verification evidence and qualification limits. Keyless Exa MCP access and Tavily/Firecrawl OAuth are research topics only, not implemented Providers or authentication backends.

Run `arks setup` in a trusted local terminal to append user-chosen instances and their individual CIDR exceptions. There is no public default endpoint. The earlier `arks provider configure searxng --base-url https://search.example.com` command explicitly replaces the list with a single instance. For private self-hosting, explicitly permit only the required IP CIDR (for example `127.0.0.1/32`); permissions belong to each `providers.searxng.instances` entry independently of `localFetch` and other instances. Legacy single-instance config remains readable.

Select it strictly with `arks web search "query" --provider searxng` or machine input `provider: "searxng"`. Configuration does not add it to `providerOrder`; operators may manually place `"searxng"` in that array to opt into ordered fallback governed by its `fallbackOn`. Explicit selection never switches Provider.

A persisted SearXNG instance list takes precedence over `SEARXNG_URL`, then `SEARXNG_BASE_URL` (each environment variable supplies one instance). Environment endpoints are resolved only at runtime and are never written to config. Endpoints must be credential-free HTTP(S) base URLs without a query or fragment; path prefixes are retained. No API key, authentication header, proxy, or automatic endpoint discovery is supported. `provider list` and `doctor` report configuration readiness only; they do not probe connectivity or JSON availability.

`web.search` accepts optional `options.searxng` fields: `categories` and `engines` (arrays), `language` (string), `page` (1–100), `safesearch` (0, 1, 2), and `timeRange` (`day`, `month`, `year`). Supply these through `arks invoke`; there are no dedicated human search flags for them. Categories are strict: empty results never trigger a general-category retry. Date ranges are instance/engine-dependent, not locally verified. Common domain filters are enforced locally on hostname boundaries before `maxResults` truncation. Publication strings are preserved, not interpreted as verified dates. Source engine/category metadata is returned when available.

Every request and redirect uses the bounded DNS-pinned local transport; nonpublic addresses are blocked without an explicit SearXNG CIDR exception. The instance must enable JSON search output. Invalid JSON, malformed results, unsafe source URLs, and oversized responses fail closed. Empty arrays are successful searches. Multiple instances use transactionally advanced persistent round-robin selection, classified safe failover, and independent cooldowns. Attempts omit `keyId`, may carry an anonymous `instanceId`, and never select or update key-pool state. Instance-state metadata contains anonymous IDs rather than private endpoint URLs. Explicit SearXNG selection can switch instances but never Provider; cancellation and the operation deadline bound the whole invocation. Other capabilities reject SearXNG selection. See [ADR 0013](adr/accepted/0013-searxng-keyless-self-hosted-search.md) and [ADR 0014](adr/accepted/0014-searxng-instance-rotation.md).

## Owned resources

Owned resources remain pinned to the Provider and credential key that created them. ArkSpace does not use cross-Provider fallback for later resource operations.

| Skill | Capabilities | Ability | Provider |
| --- | --- | --- | --- |
| `browser` | `browser.open`, `browser.snapshot`, `browser.interact`, `browser.status`, `browser.close` | Create, inspect, operate, query, and close an owned remote browser session. | Firecrawl |
| `monitor` | `monitor.create`, `monitor.list`, `monitor.status`, `monitor.update`, `monitor.pause`, `monitor.resume`, `monitor.trigger`, `monitor.delete`, `monitor.runs`, `monitor.run.get` | Manage Exa recurring-search monitors and inspect their runs. | Exa |
| `monitor` | `monitor.site.create`, `monitor.site.list`, `monitor.site.status`, `monitor.site.update`, `monitor.site.pause`, `monitor.site.resume`, `monitor.site.trigger`, `monitor.site.delete`, `monitor.site.checks`, `monitor.site.check.get` | Manage Firecrawl site-change monitors and inspect their checks. | Firecrawl |

## Provider behavior

- **Configured order** follows local ArkSpace configuration rather than Skill wording.
- **Key rotation** can try another configured key for the same Provider after a classified retryable failure, only when retry safety permits. Asynchronous creation does not retry or fall back while remote acceptance is uncertain.
- **Fallback** can try another Provider only when retry safety and remote completion state permit it.
- **Single Provider** means the capability has one current implementation; the Skill still invokes the provider-neutral `arks` capability.
- **Owned resource** operations resolve the locally stored owner record and use its creating Provider and key.
