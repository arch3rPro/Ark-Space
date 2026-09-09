# Browser, monitor, and MCP API evidence

**Evidence date:** 2026-09-09
**Scope:** first-party documentation, OpenAPI, package metadata, source, and migration guidance only. The legacy ArkSpace tree was inspected read-only to identify behavior worth comparing; its CLI-backed architecture is not treated as a target design.

## Executive findings

1. **Firecrawl has two distinct interaction contracts.** The standalone Browser Sandbox is a first-party REST/SDK lifecycle over `/v2/interact`; scrape-bound Interact is a separate lifecycle over `/v2/scrape/{scrapeId}/interact`. Firecrawl explicitly calls the hidden `firecrawl browser` CLI command legacy and recommends scrape + Interact for CLI/MCP agent workflows.[^fc-browser][^fc-interact]
2. **Both Exa and Firecrawl now have first-party monitor APIs, but they model different jobs.** Exa Monitors are recurring Exa searches with interval scheduling, cross-run deduplication, webhook delivery, and run history.[^exa-guide] Firecrawl Monitor supports scrape, crawl, and web-search targets, page-level change states/diffs, cron or natural-language schedules, email/webhook/Slack notification paths, and check history.[^fc-monitor]
3. **The current stable MCP TypeScript SDK is v2.** It uses split packages, principally `@modelcontextprotocol/server` and `@modelcontextprotocol/client`; the official server package identifies v2 as stable and as implementing MCP 2026-07-28.[^mcp-server-readme] The old monolithic `@modelcontextprotocol/sdk` is the v1 line and should not be the basis for a new ArkSpace server.[^mcp-migration]

## 1. Firecrawl Browser Sandbox and Interact

### 1.1 Choose the contract explicitly

| Need | Current first-party contract | Recommended ArkSpace interpretation |
|---|---|---|
| Create a standalone browser before navigating | Browser Sandbox: `POST https://api.firecrawl.dev/v2/interact` | Expose an explicit create/execute/list-or-status/close lifecycle. |
| Continue from a completed scrape | Scrape-bound Interact: `POST /v2/scrape/{scrapeId}/interact`; stop with `DELETE` on the same resource | Treat `scrapeId` as the externally supplied state handle. Do not masquerade it as a standalone browser session. |
| CLI/MCP agent workflow | Firecrawl recommends scrape + Interact or its `firecrawl_interact` MCP tool; the hidden Browser CLI command is legacy | Prefer the supported REST/SDK or MCP surface, not a subprocess wrapper around the legacy hidden command. |

Firecrawl documents the distinction and corresponding Node SDK methods (`browser`, `browserExecute`, `listBrowsers`, `deleteBrowser` versus `interact`, `stopInteraction`) directly.[^fc-interact]

### 1.2 Standalone Browser Sandbox lifecycle

All standalone endpoints use bearer authentication (`Authorization: Bearer <API_KEY>`) in the OpenAPI contract.[^fc-browser-create][^fc-browser-execute][^fc-browser-list][^fc-browser-delete]

| Operation | HTTP/API contract | Important bounds and response fields |
|---|---|---|
| Create | `POST /v2/interact` | Optional `ttl` defaults to 600 seconds and is bounded to 30–3600. Optional `activityTtl` defaults to 300 seconds and is bounded to 10–3600. Response includes `id`, `cdpUrl`, `liveViewUrl`, `interactiveLiveViewUrl`, and `expiresAt`.[^fc-browser-create] |
| Execute | `POST /v2/interact/{sessionId}/execute` | `code` is required, 1–100,000 characters; `language` is `node` (default), `python`, or `bash`; execution `timeout` is 1–300 seconds. The response exposes `stdout`, `result`, `stderr`, `exitCode`, `killed`, and optional `error`.[^fc-browser-execute] |
| Status/list | `GET /v2/interact?status=active|destroyed` | There is no separately documented get-one/status endpoint. The first-party status surface is list, optionally filtered, returning session `status`, URLs, `createdAt`, and `lastActivity`.[^fc-browser-list] |
| Close | `DELETE /v2/interact/{sessionId}` | Destroys the session and releases resources; the response reports success, `sessionDurationMs`, and `creditsBilled`.[^fc-browser-delete] |

**Billing and concurrency.** Browser sessions cost 7 credits per browser minute if any prompt is used and 2 credits per browser minute for code-only use, with a one-minute minimum. Firecrawl says initial launch allows up to 20 concurrent sessions, while its rate-limit page also describes per-plan active-session ceilings and `429` responses until existing sessions are destroyed.[^fc-browser][^fc-rates]

### 1.3 Scrape-bound Interact lifecycle

1. Call `POST /v2/scrape`; obtain `data.metadata.scrapeId`.
2. Call `POST /v2/scrape/{scrapeId}/interact` with exactly the desired prompt or code behavior.
3. Call `DELETE /v2/scrape/{scrapeId}/interact` when finished.[^fc-interact]

The request accepts `prompt` (maximum 10,000 characters) or `code` (maximum 100,000), with code language `node`, `python`, or `bash`, and timeout 1–300 seconds (default 30). The response can include CDP/live-view URLs, prompt `output`, raw `result`, process streams, exit code, and timeout-killed state.[^fc-interact]

Firecrawl currently permits keyless Interact for official REST clients, SDKs, and CLI at lower per-IP daily request/credit limits; adding a key raises limits. This is narrower than general keyless API access and should not be generalized to Browser Sandbox without testing the specific endpoint contract, whose OpenAPI requires bearer auth.[^fc-rates][^fc-browser-create]

### 1.4 Side effects, persistence, and cleanup

- Prompting, Playwright code, Bash, or `agent-browser` can click, type, submit forms, authenticate, navigate, download files, or execute arbitrary sandbox commands. This is an intrinsically side-effectful capability; ArkSpace should describe it as such and require deliberate invocation rather than classifying it as retrieval.[^fc-browser][^fc-interact]
- A browser profile persists cookies, local storage, and session state across runs. `profile.saveChanges` defaults to `true`; `false` loads existing state without writing it back. Multiple non-saving sessions are allowed, but only one saving session for a profile is allowed at a time.[^fc-browser-create]
- Scrape-bound Interact inherits the profile from the initial scrape; profile configuration is not sent again on the Interact call. Writable profile changes are saved when the session is stopped.[^fc-interact]
- The sandbox filesystem is ephemeral and downloads disappear when the session ends; files must be extracted and copied to caller-owned storage before close. Profiles do not persist files.[^fc-browser]
- Always close explicitly in `finally`. TTL/activity TTL are a backstop, not a normal cleanup strategy. Firecrawl warns that open sessions continue billing, prorated by the second after the one-minute minimum.[^fc-interact]

### 1.5 Legacy comparison (read-only)

The legacy `firecrawl_browser.py` wraps `firecrawl browser <instruction>` and defaults `save_changes=True`; it does not expose first-class create/list/status/close resource operations. The legacy `firecrawl_interact.py` is closer to the supported scrape-bound contract but delegates to CLI state and allows an omitted scrape ID. Preserve the user-visible capabilities—prompt/code interaction, profile write control, timeout, and stop—but replace implicit CLI state with typed IDs and explicit cleanup. Do not retain the shared CLI runtime/router as the architecture.

## 2. Exa Monitors and Firecrawl Monitor

### 2.1 Exa Monitors

**Authentication and base URL.** The base is `https://api.exa.ai/monitors`. Official OpenAPI accepts `x-api-key: <key>` or `Authorization: Bearer <key>`; the coding-agent guide illustrates bearer auth.[^exa-guide][^exa-create]

#### Lifecycle and operations

| Requested behavior | Exa contract |
|---|---|
| Create | `POST /monitors`; `search` and `webhook` are required. A schedule is optional, allowing manual-only monitors. The response is `201` and includes `webhookSecret`, returned only once.[^exa-create] |
| List | `GET /monitors?status=&cursor=&limit=`; status filters are `active`, `paused`, `disabled`; cursor pagination defaults to 50 and permits 1–100.[^exa-guide][^exa-list] |
| Get | `GET /monitors/{id}`.[^exa-get] |
| Pause/resume | `PATCH /monitors/{id}` with `status: "paused"` or `status: "active"`. All update fields are optional and `search` merges partially. `trigger: null` removes scheduling.[^exa-update] |
| Delete | `DELETE /monitors/{id}`. The endpoint says deletion cannot be undone; the batch API calls delete permanent removal.[^exa-delete][^exa-batch] |
| Check/run now | `POST /monitors/{id}/trigger`; works for active or paused monitors and returns `{ "triggered": boolean }`.[^exa-trigger] |
| Checks/history | Exa calls these **runs**: `GET /monitors/{id}/runs` and `GET /monitors/{id}/runs/{runId}`. List is reverse chronological and cursor-paginated; run states are `pending`, `running`, `completed`, `failed`, `cancelled`.[^exa-runs][^exa-run] |
| Bulk pause/resume/delete | `POST /monitors/batch` with `action: delete|pause|unpause`, at least one filter, `dry_run` defaulting to true, and 1–500 records per call; repeat while `has_more` is true.[^exa-batch] |

**Scheduling.** Only `trigger.type: "interval"` is supported. `period` is a single-unit duration such as `1h`, `6h`, `1d`, or `7d`, with a minimum interval of one hour. The schedule is anchored to creation time and can have up to 30 minutes of jitter.[^exa-guide][^exa-create]

**Status semantics.** Active monitors run on schedule and manually. Paused monitors stop scheduled runs but still allow manual trigger. Disabled is system-controlled; Exa auto-disables after 10 consecutive authentication failures, and callers cannot set disabled directly.[^exa-guide]

**Deduplication and retained state.** Date filtering limits searches to content since the previous run, and semantic deduplication uses outputs from the last five runs.[^exa-create][^exa-guide] The public monitor references reviewed here do **not** state how long run records/results are retained. Exa advertises Zero Data Retention only as an Enterprise option; therefore ArkSpace must not promise a run-retention period or immediate erasure absent a separate contractual source.[^exa-security]

**Notifications.** A public HTTPS webhook is mandatory for create and cannot target localhost/private IPs. Supported events are `monitor.created`, `monitor.updated`, `monitor.deleted`, `monitor.run.created`, and `monitor.run.completed`; omission means all events. `metadata` is echoed for routing, but Exa does not post directly to Slack. The one-time secret verifies the `Exa-Signature` HMAC-SHA256 header and must be stored at creation.[^exa-guide][^exa-create]

**Cost.** Exa is pay-as-you-go. The published `/monitors` rate is $15 per 1,000 requests including up to 10 results, plus $1 per 1,000 results above 10 and $1 per 1,000 AI page summaries. There is no subscription or minimum spend in the published pricing.[^exa-pricing]

**Deletion guarantee.** The strongest first-party statement is “cannot be undone” plus the batch description “permanently remove matching monitors.” The docs do not promise synchronous physical deletion of historical runs, dedup state, webhook records, logs, or backups. Implement the API result as resource deletion, not as a compliance-grade erasure guarantee.[^exa-delete][^exa-batch]

### 2.2 Firecrawl Monitor

**Authentication and base URL.** Monitor is under `https://api.firecrawl.dev/v2/monitor` and uses bearer auth.[^fc-monitor-create]

| Requested behavior | Firecrawl contract |
|---|---|
| Create | `POST /monitor`; required `name`, `schedule`, and `targets`. A monitor accepts 1–50 mixed `scrape`, `crawl`, and `search` targets.[^fc-monitor-create][^fc-monitor] |
| List/get | `GET /monitor`; `GET /monitor/{monitorId}`.[^fc-monitor-list][^fc-monitor-get] |
| Pause/resume | `PATCH /monitor/{monitorId}` with `status: paused|active`.[^fc-monitor-update] |
| Delete | `DELETE /monitor/{monitorId}`; response says monitor deleted.[^fc-monitor-delete] |
| Check/run now | `POST /monitor/{monitorId}/run`; queues a check, or returns `409` when a check is already running.[^fc-monitor-run] |
| Checks/history | `GET /monitor/{monitorId}/checks`, optionally filtering check status; `GET /monitor/{monitorId}/checks/{checkId}` returns details and paginated page results.[^fc-monitor-checks][^fc-monitor-check] |

**Schedules and retention.** Schedule accepts either five-field cron or supported natural-language text, with an IANA timezone defaulting to UTC. Minimum interval is five minutes; responses normalize text schedules to cron. `retentionDays` defaults to 30 and is configurable from 1 through 365.[^fc-monitor][^fc-monitor-create]

**States.** Monitor states are `active`, `paused`, and `deleted`. Check states are `queued`, `running`, `completed`, `failed`, `partial`, `skipped_overlap`, and `skipped_no_credits`; the two skip states are uncharged. Pausing retains configuration and history. Running out of credits does not pause ordinary monitors; a specific partner-credit revocation can auto-pause after three consecutive skips.[^fc-monitor]

**Notifications.** Firecrawl supports webhook events `monitor.page` and `monitor.check.completed`, email summaries, and Slack notifications. Webhooks must return 2xx within 10 seconds; failed deliveries are retried after 1, 5, and 15 minutes. Email summaries are emitted only for changed, new, removed, or errored pages.[^fc-monitor]

**Cost.** There is no separate per-monitor fee. Each check bills its underlying work: scrape monitor 1 credit per URL, crawl monitor 1 credit per discovered page, web monitor 2 credits per 10 results, web-monitor judging 1 credit per judged result, and meaningful-change judging 1 additional credit per changed page validated; format add-ons retain standalone scrape pricing.[^fc-monitor]

**Deletion guarantee.** Although the returned monitor schema includes a `deleted` status and DELETE reports success, the reviewed first-party docs do not state that check history, scrape artifacts, diffs, webhook attempts, logs, or backups are physically erased, nor provide a deletion SLA. Treat this as API-level deletion only.[^fc-monitor-delete][^fc-monitor-get]

### 2.3 Provider comparison for ArkSpace

| Concern | Exa | Firecrawl |
|---|---|---|
| Monitoring unit | Recurring search and synthesized/deduplicated output | URL scrape, site crawl, or web search target |
| Schedule floor | 1 hour, interval only | 5 minutes, cron or supported natural language |
| Pause semantics | Stops schedule; manual trigger still works | Stops schedule; configuration/history retained |
| History noun | Run | Check, with page-level results |
| Direct notifications | Webhook; metadata supports downstream Slack routing | Webhook, email, and documented Slack path |
| Explicit retention | Not documented for runs | `retentionDays` 1–365, default 30 |
| Strong deletion promise | Irreversible/permanent resource removal wording, but no physical-erasure scope/SLA | No physical-erasure scope/SLA |

ArkSpace therefore exposes two explicit Protocol v1 families rather than forcing false Provider interchangeability: `monitor.*` owns Exa recurring searches and `monitor.site.*` owns Firecrawl scrape, crawl, and search checks. The Firecrawl contract preserves schedule, retention, judging, credit estimates, typed targets, check history, and page-level results. Protocol v1 intentionally omits arbitrary scrape code, webhook headers, and direct email/Slack mutation; those surfaces require separate secret-handling and notification-governance decisions.

## 3. Stable MCP TypeScript server, stdio, tools, and host configuration

### 3.1 Stable package line

The official v2 package is `@modelcontextprotocol/server` 2.x, requires Node.js 20+, supports ESM and CommonJS builds, and uses Standard Schema-compatible authoring (the official examples use `zod/v4`). The v2 repository README lists split server/client packages and labels the monolithic v1 package as legacy.[^mcp-server-readme][^mcp-root-readme][^mcp-migration]

Install for a server:

```bash
npm install @modelcontextprotocol/server zod
```

The report intentionally does not recommend the legacy v1 imports (`@modelcontextprotocol/sdk/server/mcp.js`, `.../server/stdio.js`) or the removed variadic `.tool()` API.[^mcp-migration]

### 3.2 Current stable server and stdio API

The preferred v2 stdio entry is a server factory passed to `serveStdio`:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

function createServer(): McpServer {
  const server = new McpServer({ name: 'arkspace', version: '1.0.0' });
  server.registerTool(
    'example',
    {
      description: 'Perform one bounded example operation',
      inputSchema: z.object({ value: z.string() }),
    },
    async ({ value }) => ({
      content: [{ type: 'text', text: value }],
    }),
  );
  return server;
}

const handle = serveStdio(createServer);
process.on('SIGINT', () => void handle.close());
```

`serveStdio(factory)` owns transport creation and the pinned server instance. Its `StdioServerHandle.close()` resolves after both server and transport are shut down. Direct `new StdioServerTransport(); await server.connect(transport)` is the v1-era wiring replaced by `serveStdio` for the normal v2 server entry.[^mcp-stdio]

At the protocol level, the host launches the server as a subprocess; JSON-RPC messages are newline-delimited over stdin/stdout and must not contain embedded newlines. Stdout must contain only MCP messages. Logs belong on stderr, which a host may capture without treating it as failure. Graceful host shutdown closes child stdin and waits, then escalates from termination to kill if needed; servers should exit promptly on stdin EOF.[^mcp-stdio-spec]

### 3.3 Current stable tool API

`server.registerTool(name, config, handler)` is the stable high-level API. `inputSchema` should be an explicit Standard Schema object such as `z.object(...)`; the SDK derives advertised JSON Schema, validates calls before the handler runs, and infers handler argument types. Invalid input is returned as an ordinary tool result with `isError: true` and does not execute the handler.[^mcp-tools-sdk]

For machine-readable results, set `outputSchema` and return matching `structuredContent` plus human/model-readable `content`. The SDK validates structured output before sending it. Content may contain text, image, audio, resource links, or embedded resources.[^mcp-tools-sdk][^mcp-tools-spec]

Tool annotations are client hints, not enforcement. Hosts must treat annotations as untrusted unless the server is trusted, and the MCP specification recommends clear UI and human ability to deny invocations. ArkSpace must enforce confirmation and authorization in its own tool handlers, especially for browser actions, monitor creation/update/delete, and persistent-profile writes.[^mcp-tools-spec]

MCP 2026-07-28 has no protocol-level session on which stateful tools may rely. A stateful capability should return an explicit handle from a create tool and require it in execute/status/close calls; authorization must be checked per call, and lifetime/expiry behavior should be stated in the create tool description.[^mcp-tools-spec]

### 3.4 Host configuration

A stdio host needs a child-process launch command and arguments. The official SDK tutorial demonstrates these current forms:[^mcp-real-host]

```json
// VS Code: .vscode/mcp.json
{
  "servers": {
    "arkspace": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/dist/server.js"]
    }
  }
}
```

```json
// Cursor: .cursor/mcp.json; Claude Desktop uses the same mcpServers wrapper
{
  "mcpServers": {
    "arkspace": {
      "command": "node",
      "args": ["/absolute/path/to/dist/server.js"],
      "env": {
        "FIRECRAWL_API_KEY": "...",
        "EXA_API_KEY": "..."
      }
    }
  }
}
```

Claude Code can register the same command with `claude mcp add arkspace -- node /absolute/path/to/dist/server.js`. Host wrappers differ, but the launch contract is the same.[^mcp-real-host]

Use absolute executable/script paths where host working-directory behavior is uncertain. Environment entries are passed to the server process; they should reference host-managed secrets where supported rather than committing keys. Because the child runs with the user's OS permissions, restrict file/network scope and require approval for mutating tools.[^mcp-connect-local]

### 3.5 Legacy MCP comparison

The legacy Exa MCP helper hand-builds the 2025-03-26 Streamable HTTP JSON-RPC exchange and manually manages `initialize`, an `Mcp-Session-Id`, SSE parsing, and `tools/call`. That behavior is useful evidence of a zero-config Exa search path, but it is not an appropriate foundation for a new ArkSpace stdio server. Use the stable v2 SDK for transport, negotiation, schema validation, cancellation, shutdown, and tool registration; keep provider calls behind the tool handlers.

## Implementation implications

- Model browser resources as opaque provider-issued handles with explicit create, execute, status/list, and close tools. Put TTL and billing warnings in create/execute descriptions and run close in `finally` where a single call owns the lifecycle.
- Separate profile read-only (`saveChanges: false`) from profile write mode and make the default ArkSpace policy conservative, even though Firecrawl itself defaults `saveChanges` to true.
- Make monitor mutations explicit: create, pause/resume, manual run, and delete must not occur as a side effect of list/get. Surface provider-specific schedule floors, retention disclosures, and cost estimates before confirmation.
- Do not claim physical erasure from either provider. Report only the documented resource deletion result and any provider-stated irreversibility.
- Build the MCP process directly with stable v2 `McpServer`, `registerTool`, and `serveStdio`; keep stdout protocol-pure, log to stderr, and close on host shutdown.

## First-party sources

[^fc-browser]: Firecrawl, “Browser Sandbox,” <https://docs.firecrawl.dev/features/browser>.
[^fc-interact]: Firecrawl, “Interact after scraping,” <https://docs.firecrawl.dev/features/interact>.
[^fc-browser-create]: Firecrawl OpenAPI, “Create Interact Session,” <https://docs.firecrawl.dev/api-reference/endpoint/browser-create>.
[^fc-browser-execute]: Firecrawl OpenAPI, “Execute Code in a Session,” <https://docs.firecrawl.dev/api-reference/endpoint/browser-execute>.
[^fc-browser-list]: Firecrawl OpenAPI, “List Interact Sessions,” <https://docs.firecrawl.dev/api-reference/endpoint/browser-list>.
[^fc-browser-delete]: Firecrawl OpenAPI, “Delete Interact Session,” <https://docs.firecrawl.dev/api-reference/endpoint/browser-delete>.
[^fc-rates]: Firecrawl, “Rate Limits,” <https://docs.firecrawl.dev/rate-limits>.
[^fc-monitor]: Firecrawl, “Monitoring,” <https://docs.firecrawl.dev/features/monitoring>.
[^fc-monitor-create]: Firecrawl OpenAPI, “Create Monitor,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-create>.
[^fc-monitor-list]: Firecrawl OpenAPI, “List Monitors,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-list>.
[^fc-monitor-get]: Firecrawl OpenAPI, “Get Monitor,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-get>.
[^fc-monitor-update]: Firecrawl OpenAPI, “Update Monitor,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-update>.
[^fc-monitor-delete]: Firecrawl OpenAPI, “Delete Monitor,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-delete>.
[^fc-monitor-run]: Firecrawl OpenAPI, “Run Monitor,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-run>.
[^fc-monitor-checks]: Firecrawl OpenAPI, “List Monitor Checks,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-checks-list>.
[^fc-monitor-check]: Firecrawl OpenAPI, “Get Monitor Check,” <https://docs.firecrawl.dev/api-reference/endpoint/monitor-check-get>.
[^exa-guide]: Exa, “Monitors API Reference,” <https://exa.ai/docs/reference/monitors-api-guide-for-coding-agents>.
[^exa-create]: Exa OpenAPI, “Create a Monitor,” <https://exa.ai/docs/reference/monitors/create-a-monitor>.
[^exa-list]: Exa OpenAPI, “List Monitors,” <https://exa.ai/docs/reference/monitors/list-monitors>.
[^exa-get]: Exa OpenAPI, “Get a Monitor,” <https://exa.ai/docs/reference/monitors/get-a-monitor>.
[^exa-update]: Exa OpenAPI, “Update a Monitor,” <https://exa.ai/docs/reference/monitors/update-a-monitor>.
[^exa-delete]: Exa OpenAPI, “Delete a Monitor,” <https://exa.ai/docs/reference/monitors/delete-a-monitor>.
[^exa-trigger]: Exa OpenAPI, “Trigger a Monitor,” <https://exa.ai/docs/reference/monitors/trigger-a-monitor>.
[^exa-batch]: Exa OpenAPI, “Batch Action on Monitors,” <https://exa.ai/docs/reference/monitors/batch-monitors>.
[^exa-runs]: Exa OpenAPI, “List Runs,” <https://exa.ai/docs/reference/monitors/runs/list-runs>.
[^exa-run]: Exa OpenAPI, “Get a Run,” <https://exa.ai/docs/reference/monitors/runs/get-a-run>.
[^exa-pricing]: Exa, “Pricing,” <https://exa.ai/docs/reference/pricing>.
[^exa-security]: Exa, “Security,” <https://exa.ai/docs/reference/security>.
[^mcp-root-readme]: Model Context Protocol TypeScript SDK, repository README, <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md>.
[^mcp-server-readme]: Model Context Protocol TypeScript SDK, `@modelcontextprotocol/server` README, <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/packages/server/README.md>.
[^mcp-migration]: Model Context Protocol TypeScript SDK, “Upgrading from v1.x to v2,” <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md>.
[^mcp-stdio]: Model Context Protocol TypeScript SDK, “Serve over stdio,” <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md>.
[^mcp-tools-sdk]: Model Context Protocol TypeScript SDK, “Tools,” <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md>.
[^mcp-real-host]: Model Context Protocol TypeScript SDK, “Plug into a real host,” <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/real-host.md>.
[^mcp-stdio-spec]: Model Context Protocol specification 2026-07-28, “stdio,” <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio>.
[^mcp-tools-spec]: Model Context Protocol specification 2026-07-28, “Tools,” <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>.
[^mcp-connect-local]: Model Context Protocol documentation 2026-07-28, “Connect to local MCP servers,” <https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers>.
