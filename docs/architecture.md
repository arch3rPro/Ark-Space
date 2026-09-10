# Architecture

## Purpose

ArkSpace is a creative workspace for reusable Agent Skills. A skill may be pure guidance, carry self-contained scripts, depend on an external tool, or use a shared ArkSpace capability when the task needs centralized credentials or durable state. The architecture must support all four forms without forcing every skill through one runtime.

The first delivery slice focuses on provider-backed web capabilities because they exercise the hardest shared concerns: multiple providers, multiple API keys, fallback, rate limits, long-running jobs, and cross-platform installation. Other skill families may be added later without inheriting the web implementation model.

## Design constraints

1. The new project is implemented independently of the existing ArkSpace architecture.
2. Existing source code is evidence for behavior, provider API details, fixtures, and attribution—not a module layout to preserve.
3. The public CLI command is `arks`.
4. The CLI is implemented in Node.js and TypeScript unless the packaging spike disproves cross-platform viability.
5. Skills depend only on documented commands and versioned data contracts, never repository paths or TypeScript imports.
6. A skill that does not need centralized execution does not depend on `arks`.
7. MCP is an optional stdio transport over the same Protocol v1 dispatcher. Local coding agents can still execute `arks` directly.
8. Native plugin installation is supported through manifests that reference canonical Skill sources directly.
9. Plugins do not require compilation or mirrored source directories; version metadata changes only during an explicit release.
10. New extension points are introduced only for capabilities with multiple real implementations or consumers.

## Product layers

```text
Agent host
  -> Agent Skill
       -> host tools or skill-local scripts
       -> arks invoke or MCP stdio, when shared execution is required
            -> shared capability dispatcher
                 -> capability handler
                 -> provider adapter
                 -> key pool / credentials / state
```

### Skills

Skills own task recognition, operation selection, safety instructions, and result interpretation. They do not own provider credentials, key rotation, HTTP clients, or persistent job state.

A future ArkSpace skill may use one of four execution models:

| Model | Use when | `arks` required |
| --- | --- | --- |
| Guidance only | The host can perform the task using ordinary reasoning and tools | No |
| Skill-local script | Deterministic behavior is self-contained and has no shared state | No |
| ArkSpace capability | Credentials, provider fallback, quotas, or durable state are shared | Yes |
| External tool | A domain application already owns the operation | No; the external dependency is declared |

### `arks` CLI

`arks` is both a human-facing CLI and a machine-facing execution boundary.

Human commands optimize for discoverability:

```bash
arks setup
arks doctor
arks provider list
arks key add exa --env EXA_API_KEY_1
arks web search "agent skills"
arks web related "https://example.com/reference"
arks web fetch "https://example.com/docs"
arks web map "https://docs.example.com" --query "API reference"
arks web crawl "https://docs.example.com" --max-pages 20 --max-depth 2
arks web extract "https://example.com/pricing" --prompt "Extract plans" --schema schema.json
arks code context "current TypeScript SDK usage"
arks research run "provider landscape"
arks browser open "https://example.com"
arks browser snapshot <session-id>
arks browser close <session-id>
arks monitor create --query "agent releases" --period 1d --webhook https://example.com/hook --secret-file ./monitor.secret --confirm
arks monitor pause <monitor-id> --confirm
arks monitor delete <monitor-id> --confirm
arks mcp serve
```

Skills use a stable machine interface:

```bash
arks invoke web.search --input search-request.json
arks invoke web.related --input related-request.json
arks invoke web.fetch --input fetch-request.json
arks invoke web.map --input map-request.json
arks invoke web.crawl --input crawl-request.json
arks invoke web.extract --input extract-request.json
arks invoke code.context --input code-context-request.json
arks invoke research.run --input research-request.json
arks invoke browser.open --input browser-open-request.json
arks invoke browser.interact --input browser-action-request.json
arks invoke monitor.create --input monitor-create-request.json
arks invoke monitor.runs --input monitor-runs-request.json
```

The machine interface writes one versioned JSON result to stdout. Logs and progress go to stderr. Skills must not parse decorated human output.

`web.crawl` is synchronous from the caller's perspective. Tavily completes in one request. After Firecrawl returns a job receipt, `arks` owns that remote job until it reaches a terminal state or an awaited cancellation succeeds. A timeout or non-terminal polling failure triggers `DELETE /v2/crawl/{id}` with an independent cleanup deadline. Attempt evidence reports cancellation separately from the primary failure; an unconfirmed cancellation is never represented as clean teardown. Detached Crawl jobs and resume commands are not part of protocol version 1.

`web.extract` uses Firecrawl's asynchronous Extract API for exact supplied URLs. ArkSpace bounds and validates the caller's JSON Schema, then validates completed data locally before returning success. Firecrawl documents status polling but no Extract cancellation endpoint. After a job receipt, a polling failure is marked unsafe to retry and carries the remote Job ID as independent attempt evidence so fallback cannot start a duplicate paid job.

`research.run` is also synchronous from the caller's perspective. Exa Agent and Tavily Research are polled to a terminal state. Exa cancellation is awaited after interruption or polling failure; fallback is allowed only after terminal settlement is confirmed. Tavily documents no Research cancellation endpoint, so uncertain post-receipt failures retain a possibly-running Job ID and suppress retry. A lost submission response is also unsafe to retry because neither Provider documents create idempotency. Protocol version 1 has no detached Research status or resume command.

Browser sessions and monitors are owned resources. State records the Provider, anonymous key ID, remote resource ID, and non-secret lifecycle metadata. Later operations resolve the same configured credential; they never rotate keys or fall back. Browser Protocol v1 accepts structured actions rather than arbitrary remote code, requires confirmation for interaction, omits authority-bearing CDP and live-view URLs, and retains cleanup evidence when initial navigation fails. Monitor mutations require confirmation. The one-time Exa webhook secret is written directly to a new restrictive local file and never enters the Protocol envelope.

`arks mcp serve` uses the stable v2 official MCP TypeScript server SDK. MCP tool input schemas come from the Protocol v1 schemas and calls use the same in-process dispatcher as `arks invoke`. Standard output is reserved for MCP frames; diagnostics use standard error.

Example response:

```json
{
  "protocolVersion": 1,
  "ok": true,
  "capability": "web.search",
  "provider": "exa",
  "data": {},
  "attempts": [],
  "warnings": []
}
```

Failures use the same envelope and include a stable error kind, retryability, and actionable correction. Raw credentials never appear in output.

### Capability handlers

A capability handler owns provider-neutral request resolution, provider selection, fallback order, result normalization, and completion semantics. Defaults are resolved before provider execution.

Initial capability vocabulary:

- `web.search`
- `web.related`
- `web.fetch`
- `web.map`
- `web.crawl`
- `web.extract`
- `code.context`
- `research.run`
- `browser.open`, `browser.snapshot`, `browser.interact`, `browser.status`, `browser.close`
- `monitor.create`, `monitor.list`, `monitor.status`, `monitor.update`, `monitor.pause`, `monitor.resume`, `monitor.trigger`, `monitor.delete`, `monitor.runs`, `monitor.run.get`

Capability names are public protocol identifiers. Provider names and SDK types do not leak into provider-neutral request or result fields. Provider-specific options are carried only in an explicitly namespaced extension object.

### Provider adapters

Provider adapters implement narrow operation contracts rather than one universal provider interface:

```ts
interface SearchProvider {
  search(request: SearchRequest, context: ExecutionContext): Promise<SearchResult>;
}

interface FetchProvider {
  fetch(request: FetchRequest, context: ExecutionContext): Promise<FetchResult>;
}
```

An adapter implements only operations its provider actually supports. Initial adapters are compiled into the CLI; a dynamic third-party plugin system is deferred until an external provider implementation exists.

Each registration identifies:

- provider ID;
- supported capabilities;
- adapter factory;
- required credential references;
- endpoint and feature constraints.

Registration is reversible in tests and long-running processes.

## Initial skill boundaries

The initial catalog is proposed as four skills. The count follows execution lifecycle and safety boundaries rather than the old directory layout.

### `web`

Covers stateless or bounded web-data acquisition:

- search and related-page discovery;
- supplied-URL fetching;
- site mapping and crawling;
- schema-based extraction;
- code and API context retrieval.

Its `SKILL.md` selects an operation. Detailed instructions live in operation-specific references so activation does not load every provider option.

### `research`

Covers long-running synthesis that produces conclusions and citations. It owns attached polling, cancellation evidence, source handling, and completion checks. Protocol version 1 does not expose detached status or cancel commands. Lightweight search-and-summarize remains possible through `web`; the `research` Skill is selected when synthesis itself is the requested outcome.

### `browser`

Covers interaction within a bounded browser session. It owns session identity, user-visible side effects, confirmation, post-action verification, timeout, and close semantics.

### `monitor`

Covers durable recurring Exa searches that survive the current agent session. It remains separate because creation causes webhook delivery and may cause ongoing cost. ArkSpace implements explicit ownership, update, pause, resume, manual trigger, history, and API-resource deletion semantics. Firecrawl Monitor remains a separate future adapter because its targets, schedules, notifications, retention, checks, and pricing do not match Exa's run model.

Provider configuration is not a skill. `arks setup`, `arks provider`, `arks key`, and `arks doctor` supply configuration and diagnostics. Any skill that encounters missing setup explains the blocker and directs the user to those commands.

## Credentials and multiple API keys

Configuration stores credential references, not secret values. `arks setup` may store raw keys in the dedicated user-level `credentials.json` file after hidden terminal entry; explicit environment variables override that file for CI and externally managed credentials. State contains only key metadata. Operating-system keychains may replace local-file storage after cross-platform validation. See [ADR 0009](adr/accepted/0009-local-credential-setup.md).

A provider key pool records:

- stable key ID or non-reversible fingerprint;
- round-robin cursor;
- enabled/disabled state;
- cooldown deadline;
- last classified failure;
- consecutive failure count.

Selection and result recording are transactional. Concurrent commands cannot select and advance the same cursor as if they were isolated.

Failure policy:

| Failure | Key-pool effect |
| --- | --- |
| `401` or provider-confirmed invalid key | Disable the key pending operator action |
| `403` | Classify before disabling; permission and account policy errors are not always key corruption |
| `429` | Cool down according to `Retry-After` or provider policy |
| Provider quota exhausted | Long cooldown or explicit exhausted state |
| `5xx` | Retry or provider fallback; do not automatically invalidate the key |
| Network failure | Retry/fallback without poisoning credential state |
| Invalid request | Fail without rotating keys |

State never contains raw keys. Files containing configuration or state use owner-only permissions where supported. Any subprocess receives only the minimum required environment.

The persistence implementation is an explicit design gate. SQLite offers transactions but may complicate Node binary packaging; an atomic locked file is easier to distribute but harder to make concurrent. Both must be tested on Windows, macOS, and Linux before acceptance.

## Installation and compatibility

The npm package identity is provisionally `@arkspace/cli`; ownership must be confirmed before publication. It exposes one binary, `arks`.

ArkSpace supports two distribution surfaces:

- portable Skill installation for compatible filesystem-based hosts;
- native Claude Code and Codex plugin installation when the host benefits from plugin discovery or packaging.

Both surfaces consume the same canonical `skills/` tree. Claude Code and Codex manifests live in the repository and point to those sources directly. A marketplace entry points to the repository root rather than to a generated package copy.

Normal installation installs the CLI and selected Skills together. Skills also include a missing-tool fallback:

1. run `arks --version`;
2. verify the required capability;
3. if unavailable, explain the dependency and request permission before modifying the environment;
4. use the documented installation path;
5. direct the human to run `arks setup` in a trusted local terminal when credentials are missing; never request a key in conversation;
6. run `arks doctor` and resume the original task.

A Skill may guide installation, but cannot assume every host permits it. Local coding-agent hosts are the first supported environment. Hosted skill containers without shell, network, or package-install access require a future remote transport and are not claimed by the first release.

## Node/TypeScript shape

The first implementation should remain one package until an independently versioned consumer requires a split:

```text
src/
├── cli/
├── protocol/
├── capabilities/
├── providers/
├── credentials/
├── key-pool/
├── state/
└── errors/
```

Runtime validation occurs at untrusted boundaries: CLI arguments, JSON input, configuration files, persisted state, provider responses, and network errors. Typed same-process calls rely on TypeScript types.

Routine development loads the repository plugin directly, so Skill and manifest changes require no plugin build. During an explicit release, version metadata is updated and installation is tested from the exact tag or source revision selected for publication. The Node/TypeScript CLI retains its own compile/package step because it is executable software rather than Skill metadata.

A packaging spike must verify:

- npm local and global installation;
- `npx` execution;
- supported Node LTS versions;
- Windows, macOS, and Linux path/config behavior;
- SQLite or file-lock distribution;
- optional standalone executable production through Node SEA or Bun;
- direct repository plugin loading for Claude Code and Codex;
- marketplace manifests that resolve the repository root and canonical `skills/` path;
- release-time plugin version and tagged-source installation checks;
- identical CLI protocol behavior across distribution forms.

## Extension policy

ArkSpace remains open to new skill families, but the first web slice does not justify universal role, workflow, registry, or plugin abstractions. Add a seam only when at least two real implementations or consumers need to vary independently.

Stable extension points in the first release are limited to:

- capability protocol versions;
- narrow provider operation contracts;
- credential source resolution;
- state persistence, if two supported implementations survive the packaging spike.

Everything else stays ordinary code until variation is demonstrated.
