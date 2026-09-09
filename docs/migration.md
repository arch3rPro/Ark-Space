# Migration Plan

## Goal

Build a new ArkSpace project at `~/Documents/Vibe-Coding/code/Ark-Space` without modifying the existing implementation in place. The existing repository remains a read-only source of behavioral evidence until the replacement satisfies its acceptance gates.

Migration means re-establishing valuable behavior behind the new architecture. It does not mean copying the old module layout or preserving obsolete commands.

## Source-use rules

Use the existing project for:

- provider request and response details;
- tests and fixtures that describe real edge cases;
- multi-key rotation, cooldown, fallback, redaction, and readiness behavior;
- supported provider/capability facts;
- upstream source attribution and license obligations.

Do not carry forward:

- `scripts/arkspace.py`;
- repository-relative command resolution;
- cross-skill imports from `provider-manager`;
- the old registry hierarchy as runtime architecture;
- generated plugin mirrors;
- agent, role, or workflow layers without a new concrete use case;
- deprecated design and refactor plans.

## Capability migration matrix

| Existing capability | New owner | Treatment |
| --- | --- | --- |
| Public search | `web.search` | Reimplement against narrow provider contracts; port provider fixtures |
| Related pages | `web.related` | Reimplement as a web operation, not an Exa-specific public type |
| URL content fetch | `web.fetch` | Normalize readable content and source metadata |
| Site map | `web.map` | Preserve provider limits and bounded output |
| Site crawl | `web.crawl` | Define job/polling semantics explicitly |
| Structured extraction | `web.extract` | Validate schemas at the CLI boundary |
| Code context | `web.code-context` | Treat as specialized retrieval inside the `web` skill |
| Deep research | `research.*` | Preserve citations, job status, polling, timeout, and cancellation |
| Browser interaction | `browser.*` | Rebuild with explicit session ownership and side-effect confirmation |
| Recurring monitoring | `monitor.*` | Defer until durable ownership, cost, and deletion guarantees pass |
| Provider setup/readiness | `arks setup/provider/doctor` | Rebuild as CLI infrastructure, not a skill |
| Multiple API keys | key pool | Reimplement transactionally; do not port raw secret storage |
| Cooldown/fallback | capability execution | Preserve behavior through classified errors and attempt evidence |

## Source asset disposition

| Existing asset | Disposition |
| --- | --- |
| Provider HTTP helpers | Adapt request/response knowledge; rewrite in TypeScript |
| Provider response fixtures | Copy with provenance where license permits; otherwise recreate equivalent fixtures |
| Provider tests | Port behavioral assertions, not Python implementation details |
| `provider_config.py` | Extract requirements for key refs, cooldown, redaction, and errors; do not translate file-for-file |
| Provider registries | Use as factual inventory during implementation; encode only facts consumed by new code |
| Existing `SKILL.md` files | Rewrite around new user intents and `arks invoke` protocol |
| `arkspace.py` CLI | Discard |
| Generated integrations and package mirror | Discard from initial architecture |
| Obsidian, product, project, and other skills | Outside the first slice, not rejected from ArkSpace's future scope |

## Delivery phases

### Phase 0: freeze behavior evidence

Deliverables:

- capability and provider matrix;
- golden request/response fixtures with secrets removed;
- error taxonomy;
- multi-key selection scenarios;
- upstream source and license ledger.

Exit criteria:

- every retained first-slice behavior has a testable example;
- no acceptance requirement depends only on reading old implementation code;
- unsupported or intentionally changed behavior is named.

### Phase 1: validate Node distribution

Build a minimal `arks` executable with `version`, `doctor`, and one fake capability.

Test:

- npm local/global installation;
- `npx` invocation;
- Windows, macOS, and Linux CI;
- config path resolution;
- JSON stdin/stdout behavior;
- candidate state stores;
- optional standalone executable tooling.

Exit criteria:

- one installation path works reliably on all three operating systems;
- stdout remains machine-readable;
- state writes are atomic under concurrent processes;
- the minimum Node support policy is documented.

### Phase 2: protocol, credentials, and key pool

Implement:

- versioned request/result envelopes;
- configuration validation;
- environment-variable key references;
- round-robin key selection;
- cooldown and disable states;
- error classification and redaction;
- attempt evidence without secret exposure.

Exit criteria:

- concurrent selection tests pass;
- `401`, `403`, `429`, quota, `5xx`, network, and invalid-request cases have separate tests;
- no raw key appears in config state, stdout, stderr, snapshots, or fixtures.

### Phase 3: first vertical slice

Implement `web.search` with Exa and Tavily, followed by `web.fetch`.

Deliver:

- human commands;
- machine `arks invoke` commands;
- `web` Skill draft;
- setup and doctor flow;
- fallback and multiple-key tests.

Exit criteria:

- a clean machine can install ArkSpace, configure two keys, invoke the skill, and observe rotation/fallback;
- the Skill never resolves repository-relative paths;
- the same contract passes with both providers.

### Phase 4: complete Web and Research

Add:

- Firecrawl;
- related pages;
- map, crawl, extract, and code context;
- attached deep research runs with internal polling and cancellation evidence;
- remaining search providers only where they add a distinct supported path.

Exit criteria:

- every capability has provider-neutral contract tests;
- provider-specific options are namespaced;
- long-running commands support timeout, documented cancellation where available, and honest uncertain or partial outcomes;
- `web` and `research` Skills pass isolated install tests.

### Phase 5: Browser

Implement browser sessions only after session lifecycle is explicit.

Exit criteria:

- open, inspect, interact, and close have one owner;
- cleanup reaches quiescence;
- external side effects require confirmation and are verified afterward;
- one failed action does not leave an undisclosed active session.

### Phase 6: Monitor decision

Implement Monitor only if the selected providers can satisfy:

- durable ownership;
- list/status/pause/resume/remove;
- cost disclosure;
- retention policy;
- explicit creation and deletion confirmation.

If these cannot be proven, defer the feature and do not publish a `monitor` Skill.

### Phase 7: direct-source plugin installation

Implement native plugin installation without a build or source mirror:

- canonical Claude Code and Codex manifests reference the shared `skills/` directory;
- the Codex marketplace entry points to the repository root;
- routine development installs or loads the repository source directly;
- an explicitly requested release updates plugin version metadata and tests installation from the selected tag or source revision;
- CLI artifacts are built separately from plugin metadata.

Exit criteria:

- both supported hosts can install the intended Skills through a documented plugin path;
- changing a canonical Skill requires no Codex plugin compilation or mirror refresh;
- manifest paths resolve correctly from a clean checkout;
- tagged-source installation identifies the intended version and contains no private state.

### Phase 8: broader ArkSpace expansion

Evaluate additional skill families against the four execution models in the architecture document. Do not require them to use the Provider CLI architecture. Add roles, workflows, registries, or host adapters only when a concrete consumer requires them.

## Validation strategy

### Contract tests

Run every provider implementation against the same operation contract. Validate normalized success, empty results, partial results, authentication failure, rate limiting, timeout, cancellation, and malformed response handling.

### Real-entry tests

Invoke the installed `arks` binary exactly as a Skill does. Tests must not call capability handlers directly as their only evidence.

### Isolated Skill tests

Copy one Skill directory into a temporary host layout, remove access to the source repository, and execute its documented path. This detects hidden repository and sibling-skill dependencies.

### Cross-platform tests

The qualification matrix covers Windows, macOS, and Linux. Path handling, executable discovery, config permissions, process cancellation, signal behavior, and line endings are verified per platform. For the initial 0.1.0 publication, hosted-matrix evidence is deferred until after publication and remains mandatory before replacement cutover.

### Live-provider tests

Credential-free checks use fixtures. Opt-in live tests verify retained providers without treating live-provider success as a substitute for contract tests. Credentialed E2E is deferred until after the initial 0.1.0 publication and remains mandatory before replacement cutover.

## Cutover gates

The new project is ready to replace the existing project only when:

1. all first-release capabilities have accepted contracts and real-entry tests;
2. multiple API key rotation and cooldown work across concurrent CLI processes;
3. installation and upgrade pass on Windows, macOS, and Linux;
4. published Skills comply with the Agent Skills directory and frontmatter requirements;
5. Skills detect missing or incompatible `arks` versions and provide an actionable installation path;
6. no new Skill or CLI command references the old repository;
7. retained upstream code and behavior have license and attribution records;
8. secrets are absent from state, logs, errors, fixtures, and telemetry;
9. Claude Code and Codex plugin installation pass directly from the selected repository source or release tag;
10. routine source development has no generated Codex package output;
11. the old project is archived or tagged before deletion;
12. a rollback installation path is documented.

## Post-release 0.1 qualification backlog

1. Run the hosted Windows, macOS, Linux, and Node LTS matrix against the published version.
2. Run credentialed live tests for every retained Exa, Tavily, and Firecrawl capability.
3. Validate Claude Code and Codex installation from the exact published tag and npm package.
4. Review Skill activation and Research source-verification behavior with real tasks.
5. Complete the atomic-state-store durability spike before replacement cutover.
