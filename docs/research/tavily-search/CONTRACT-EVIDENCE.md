# Tavily Search contract evidence

- **Provider:** Tavily Search API
- **Evidence basis:** ArkSpace's existing first-party API evidence and adapter contract tests
- **Replay command:** `npm run build && node docs/research/tavily-search/contract-probe.mjs`
- **Network/cost:** offline only; the probe uses a loopback HTTP fixture and makes no paid Provider request
- **Fixture:** `tests/fixtures/tavily-search-response.json`

## Reproduced contract

The offline replay runs the built `arks invoke web.search` entry path against a loopback boundary and verifies:

1. `web.search` reaches `POST /search`.
2. Tavily authentication is sent as `Authorization: Bearer <key>`.
3. Provider-neutral `maxResults` and `includeDomains` map to `max_results` and `include_domains`.
4. The documented/default `search_depth: "basic"` and `include_answer: false` are sent.
5. The fixture response normalizes `request_id`, `content`, `score`, and `published_date` into Protocol v1 `requestId`, `snippet`, `score`, and `published`.
6. The machine envelope contains a stable protocol version and redacted key material; the generated key identifier is non-secret metadata.

The script deliberately uses a placeholder key only to exercise the authentication boundary. It does not contact Tavily and does not assert a live account, quota, or billing behavior.

## Source evidence

The Search endpoint reference is [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search). ArkSpace's existing Research-specific evidence is [`../research-provider-api-evidence.md`](../research-provider-api-evidence.md), not a Search reference. Reusable Search adapter assertions remain in [`../../../tests/providers.test.ts`](../../../tests/providers.test.ts); this directory pairs an executable boundary replay with this conclusion rather than creating a paid probe.

## Evidence/test audit

| Evidence claim | Existing coverage | Replay status / limitation |
| --- | --- | --- |
| Tavily Search request and response field mapping | `tests/providers.test.ts` (adapter), `tests/cli-entry.test.ts` (`arks invoke web.search`) | Replayed here via the built CLI, fixed response and isolated loopback HTTP boundary. |
| Tavily Research polling, credits and source deduplication | `../research-provider-api-evidence.md`, `tests/research-providers.test.ts`, `tests/fixtures/tavily-research-*.json` | Offline fixtures, not a reproduction of a live Provider response. |
| Exa Agent cancel and citation grounding | `../research-provider-api-evidence.md`, `tests/research-providers.test.ts`, `tests/fixtures/exa-agent-*.json` | Offline fixtures and entry coverage in `tests/cli-research-entry.test.ts`; live cancellation still requires credentialed qualification. |
| Firecrawl Browser and Exa Monitor API lifecycle | `../browser-monitor-mcp-api-evidence.md`, `tests/browser.test.ts`, `tests/monitor.test.ts`, `tests/fixtures/*-browser-*.json`, `tests/fixtures/exa-monitor-*.json` | Documented conclusions and fixtures, not live-cost-reproducible without explicit operator consent. |
| WeKnora field observations | `../weknora-api-evidence.md` | Carried-forward field reports; no reachable instance, so not reproducible locally. |

No live conclusions are promoted by this replay. The other notes retain their stated provenance and limitations; `npm run test:e2e` is billable and is **not** run for this issue.
