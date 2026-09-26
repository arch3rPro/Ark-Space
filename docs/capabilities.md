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

`weknora` is an external-tool Skill: it calls a user-managed WeKnora instance directly and declares **no** `arks` capability or Provider dependency. It therefore does not appear in the operation tables below.

## Stateless operations and bounded jobs

| Skill | Capability | Ability | Providers | Provider behavior |
| --- | --- | --- | --- | --- |
| `web` | `web.search` | Search the public Web for ranked sources. | Exa, Tavily, Firecrawl | Configured order, key rotation, and classified fallback. |
| `web` | `web.related` | Find pages related to a known URL. | Exa | Single Provider. |
| `web` | `web.fetch` | Retrieve content from exact URLs and return bounded response IDs for later reads. | Exa, Tavily, Firecrawl, Local (explicit and disabled by default) | Remote Providers use configured order, key rotation, and classified fallback. Response bodies are held in a private bounded TTL cache; `web.content.get` reads them by opaque response ID. |
| `web` | `web.content.get` | Read cached fetch content with offset/limit and exact case-sensitive or case-insensitive text lookup. | Local cache | IDs expire and are bounded by configured count and bytes; search response IDs are not accepted. |
| `web` | `web.map` | Discover URLs within a site. | Tavily, Firecrawl | Configured order, key rotation, and classified fallback. |
| `web` | `web.crawl` | Traverse and retrieve a bounded site area. | Tavily, Firecrawl | Fallback only after the prior remote outcome is safely settled. |
| `web` | `web.extract` | Extract schema-bound structured data from pages. | Firecrawl | Single Provider; model-backed remote job. |
| `web` | `code.context` | Retrieve current implementation examples and supporting context. | Exa | Single Provider. |
| `research` | `research.run` | Run a bounded multi-source research synthesis. | Exa, Tavily | Fallback only after the prior Research Job is safely settled. |

## Owned resources

Owned resources remain pinned to the Provider and credential key that created them. ArkSpace does not use cross-Provider fallback for later resource operations.

| Skill | Capabilities | Ability | Provider |
| --- | --- | --- | --- |
| `browser` | `browser.open`, `browser.snapshot`, `browser.interact`, `browser.status`, `browser.close` | Create, inspect, operate, query, and close an owned remote browser session. | Firecrawl |
| `monitor` | `monitor.create`, `monitor.list`, `monitor.status`, `monitor.update`, `monitor.pause`, `monitor.resume`, `monitor.trigger`, `monitor.delete`, `monitor.runs`, `monitor.run.get` | Manage Exa recurring-search monitors and inspect their runs. | Exa |
| `monitor` | `monitor.site.create`, `monitor.site.list`, `monitor.site.status`, `monitor.site.update`, `monitor.site.pause`, `monitor.site.resume`, `monitor.site.trigger`, `monitor.site.delete`, `monitor.site.checks`, `monitor.site.check.get` | Manage Firecrawl site-change monitors and inspect their checks. | Firecrawl |

## Provider behavior

- **Configured order** follows local ArkSpace configuration rather than Skill wording.
- **Key rotation** can try another configured key for the same Provider after a classified retryable failure.
- **Fallback** can try another Provider only when retry safety and remote completion state permit it.
- **Single Provider** means the capability has one current implementation; the Skill still invokes the provider-neutral `arks` capability.
- **Owned resource** operations resolve the locally stored owner record and use its creating Provider and key.
