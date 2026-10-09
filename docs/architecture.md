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

### Optional managed WeKnora connection

WeKnora has two execution paths. A complete manually supplied `WEKNORA_BASE_URL` / `WEKNORA_API_KEY` pair supports independent REST/script use without the CLI. Otherwise the canonical Skill can use explicitly supported `arks` operations with the managed `connections.weknora` configuration. Partial/empty external pairs stop; the runtime never pairs an external address with a stored key, exports a key, or silently switches connection source.

Unreleased source adds a WeKnora context to the same Setup workbench. It owns connection-specific editing and consent, not Provider enablement, key rotation, or search order. `arks setup weknora` accepts an exact API root, masked key, and optional default knowledge-base ID; saving is offline; an explicit request to read the configured instance authorizes network access. Authenticated managed requests may reach valid localhost, private, or public destinations without CIDR exceptions, while address validation, DNS pinning, TLS verification, redirect refusal, no-proxy transport, deadlines, and response bounds remain enforced. Existing Web contexts and global order/language remain independent.

Managed operations cover verification, knowledge-base list/detail, and single-base search through additive non-Web Protocol v1 envelopes with `connection: "weknora"`, not a fabricated `ProviderId` or Web attempt. Authenticated transport reuses the pinned/DNS-validated mechanism with fixed operation routes, an informational plaintext-transport warning for HTTP, verified TLS, response bounds, no redirects/proxies, and a whole-operation cancellation/deadline. Search requires knowledge-base index preflight. No persistent health, cross-instance fallback, upload, or chat adapter is added. Other operations remain available through the independent environment path. See [ADR 0019](adr/accepted/0019-optional-weknora-managed-connection.md) and [capabilities](capabilities.md#optional-weknora-retrieval).

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

`web.content.get` literal matching treats escaped Unicode sequences as literal text, performs Unicode simple case-insensitive matching against the original cached text (not locale-sensitive folding), and reports match positions and offsets in UTF-16 code units of that original text. Case-sensitive matching remains literal `indexOf` behavior.

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

Capability names are public protocol identifiers. Provider names and SDK types do not leak into provider-neutral request or result fields. Provider-specific options are carried only in an explicitly namespaced extension object.

The [Skill, Capability, and Provider reference](capabilities.md) owns the current capability vocabulary, Skill mapping, Provider coverage, fallback behavior, and resource ownership constraints.

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

SearXNG implements `web.search` only and is keyless. `arks setup searxng` manages user-chosen instances, each with its own explicit narrow CIDR exceptions for private deployments. Environment-only endpoints remain external/read-only until the human explicitly adds local configuration. The adapter uses the existing local HTTP security transport. Multi-instance selection advances a persistent cursor transactionally and records cooldowns separately from key-pool state, using anonymous instance IDs rather than endpoint URLs. It does not acquire a credential lease or fabricate a key ID in attempt evidence. Safe classified failures can try another instance within the operation budget; cancellation and network-authority failures stop attempts. Configuration does not add SearXNG to the default Provider order; an explicit SearXNG request can switch instances but never falls back to a hosted Provider. Readiness is configuration evidence, not a live service probe.

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

Configuration stores credential references, not secret values. The reference-driven Setup TUI is implemented in unreleased source; qualification evidence and caveats are tracked in the [priority-one workbench report](../.scratch/setup-priority-one/report.md), and human UX acceptance remains pending. Its three focus regions are Top (Exa/Tavily/Firecrawl/SearXNG context), Menu (Providers/Configuration/Settings/Exit), and Content, cycled by Tab/Shift-Tab. Top Left/Right switches provider; `[`/`]` remain advertised alternates and Down/Enter enters Content. Menu Up/Down selects functions, Enter opens one, and Right enters Content; Content Left returns to Menu. A primary resource table/list drives page-local actions, with non-focusable hints wrapped below the table. There are no legacy stacked toolbars or nested button-bar subfocus. Enter/`e` edits; `a` adds; `i` shows details; `p` previews securely; `d` removes. Editing an existing local key preloads it into a masked field; Esc restores the pre-edit value, and Ctrl-S validates the whole form before explicit overwrite consent. Add starts blank; unchanged saves close without a write or replacement consent. Space toggles selected-key enablement, `V`/`v` provider enablement, and `t` opens a Cancel-default choice: one normal shared round-robin pool test (five seconds total), or a sequential per-key test of configured local references (one request per reference, five seconds per key). The latter requires consent for possible API fees and logging, uses isolated temporary state, skips missing/unusable values without requests, and reports references plus classified outcomes only. It does not mutate global cursor/health/configuration or fall back to another key/Provider; Esc stops it. Disabled/cooling key references are included while the Provider itself must be enabled. Selected-key details identify local/environment/environment-override source, disabled state, health-failure reason, and remaining cooldown snapshot (not a live countdown while the modal is open); shared-provider use is explicit. Resource summaries give per-kind counts and actionable cleanup guidance without authority-bearing URLs or secrets. Test details show current reference diagnostics, completed count, and recent results limited to the active session, with numeric timestamps and durations. Provider-context changes retain results; cached rows are historical, not proof about the currently effective credential. History is memory-only, never persisted or used as global health/cursor/configuration. Read-only navigation/preview/details refreshes retain rows, removed references are pruned, and attempted managed writes (including other configuration operations) or a normal pool test clear the cache conservatively. Editing/removing a credential invalidates its diagnostic. No values or fingerprints are retained, so external credential-value changes cannot be detected or reliably invalidate history. Linux PTY qualification requires standard-library Python 3 for development only, not for the end-user CLI. Keyless SearXNG retains its instance-pool test, not per-key testing. Global order and language remain independent: `u`/`d` reorder, Delete removes, `I` includes with confirmation, Ctrl-S saves order; language is a plain option list applied with Enter. This layout is an ArkSpace adaptation, not pixel-identical reproduction of the visual reference. See the [priority-one workbench report](../.scratch/setup-priority-one/report.md) for current evidence, and [ADR 0017](adr/accepted/0017-workbench-modal-setup.md) for the interaction contract.

Presentation details are implementation evidence, not part of this approved layout contract. No setup-specific backend or Protocol v1 change is introduced.

Confirmations are true action-button modals with action-specific pairs, for example Cancel/Delete, Cancel/Replace, Cancel/Authorize, Cancel/Save, Cancel/Test, and Cancel/Discard; a chooser may use Cancel/Include. Cancel is initially focused; Tab traverses applicable content controls, Left/Right selects within horizontal button rows, Enter activates the focused control, and Esc cancels. Active buttons use black-on-cyan ANSI styling (30;46;1); active pane borders use bold cyan (1;36), not reverse video. No y/N prompt or affirmative-word input is used. Forms retain explicit Save and Cancel controls. Field Enter only commits to the draft; Ctrl-S validates the whole form before its save path. Normal key input never echoes raw values: one live `*` per grapheme plus a character count, with normal editing, caret movement, and horizontal scrolling. Existing local keys preload into this masked field without automatic plaintext disclosure; environment/shared/owned/missing/invalid references remain guarded and unchanged. This supersedes the permanently hidden placeholder/no-length rule. The form retains the plaintext-storage warning, actual credential-file path, and official Provider link, without Agent-chat reminders; the trusted-human-terminal-only/no-chat-credentials boundary still applies. Environment-managed key values cannot be replaced, but their references may be unlinked without modifying external values. Unlinking a shared reference preserves its credential. Local additions append independent references without overwriting external values; configured local and environment references may share a key pool. Original process-environment values retain precedence. Shared credential references and tracked Browser, Monitor, and Site Monitor ownership guards remain in force; preserve cleanup access.

Existing-key **Preview** is read-only and defaults to a masked partial value with grapheme length and source. Explicit **Show full**, **Hide**, and **Close** controls permit ephemeral disclosure only in the owned human TTY, never through status, diagnostics, logs, persisted state, or machine output. Closing/canceling/exiting clears disclosure; normal Add/Replace entry stays masked. Distinguish environment-only effective values from locally stored values overridden by the original process environment, labeling stored and effective values separately. Owned-resource/shared-reference keys may be previewed without mutation; missing or invalid values block disclosure. Preview performs no live request or file write. Cancellation, terminal restoration, input/paste parsing limits, validation, source precedence, and backend mutation guards remain intact.

SearXNG remains keyless. Environment-only endpoints are external/read-only and are not imported or combined with local instances. Retain endpoint validation and explicit narrow per-instance private-CIDR authorization. SearXNG has no per-instance enable/disable toggle. Provider enablement and automatic order are independent: first local creation defaults the backend to enabled, appending preserves existing disabled state, and neither inserts SearXNG into order. Explicit inclusion in order permits automatic routing. Local instances override rather than pool with the read-only environment endpoint. Automatic-order changes are drafted and saved/canceled with privacy authorization once per save. Language remains optional saved `setupLanguage` with session-only `--lang en|zh` precedence: flag, saved preference, first nonempty `LC_ALL`/`LC_MESSAGES`/`LANG` (`zh` prefix selects Chinese), then English. Opening setup does not authorize network activity. A live connection test requires explicit consent for fees and logging, uses only the fixed public query `Agent Skills documentation`, and routes strictly to the selected Provider through the shared dispatcher (at most one result, five-second operation timeout). Evidence covers actual attempts only; no snippets or raw Provider error bodies are rendered. Local readiness remains available through `arks doctor`; it is not an additional functional-menu destination. These setup decisions do not alter Protocol v1 or Provider execution. See [ADR 0009](adr/accepted/0009-local-credential-setup.md), retained protections in historical [ADR 0015](adr/accepted/0015-menu-based-provider-setup.md), and current interaction decisions [ADR 0016](adr/accepted/0016-tui-provider-setup.md) and [ADR 0017](adr/accepted/0017-workbench-modal-setup.md).

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
