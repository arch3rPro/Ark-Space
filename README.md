# ArkSpace

[中文](README.zh-CN.md)

![ArkSpace as a futuristic ark-like workspace containing research, knowledge, workflow, toolbox, planning, and engineering capabilities.](./assets/readme/hero.png)

**ArkSpace is a creative workspace for reusable Agent Skills and the tools that make them reliable.** It gives agents focused, installable guidance while allowing each capability to use the execution model that fits it: host tools, skill-local scripts, external applications, or shared ArkSpace services.

> **Status:** Version 0.1.0 is the initial preview release. It provides Web retrieval, Code Context, cited Research, owned Firecrawl Browser sessions, separate Exa and Firecrawl monitoring, and MCP stdio. This release does not replace or retire the existing ArkSpace project; credentialed Provider and migration qualification continues after release.

## What Stays Core

ArkSpace remains broader than its first implementation slice:

- Skills are reusable product units, not wrappers around one runtime.
- A Skill can remain pure guidance, carry scripts, declare an external dependency, or call a shared capability.
- Shared execution is used when credentials, provider fallback, quotas, or durable state must be coordinated.
- Native plugin installation is supported for hosts that benefit from it, without duplicating canonical Skill bodies.
- Host-specific integration is added only when a supported host needs it.
- Sources, licenses, private configuration, and side effects remain explicit.

## First Implementation Slice

The first slice rebuilds the provider-backed capabilities that currently provide the clearest value:

- public web search, related-page discovery, fetch, map, crawl, and structured extraction;
- code and API context retrieval;
- cited and long-running research;
- browser interaction;
- recurring monitoring with durable ownership and explicit lifecycle operations;
- centralized multiple-API-key rotation, cooldown, fallback, and diagnostics.

The implemented canonical Skill boundaries are `web`, `research`, `browser`, and `monitor`.

## `arks` CLI

ArkSpace's shared execution command is **`arks`**, implemented in Node.js and TypeScript. It requires Node.js 20 or newer. Install the published release from npm:

```bash
npm install --global @arkspace/cli@0.1.0
arks setup
arks doctor
```

For a source checkout:

```bash
npm install
npm run build
npm link
```

The first slice implements:

```bash
arks setup
arks key add exa --env EXA_API_KEY_1
arks key add firecrawl --env FIRECRAWL_API_KEY_1
arks doctor
arks provider list
arks web search "agent skills"
arks web related "https://example.com/reference"
arks web fetch "https://example.com/docs"
arks web map "https://docs.example.com" --query "API reference"
arks web crawl "https://docs.example.com" --max-pages 20 --max-depth 2
arks web extract "https://example.com/pricing" --prompt "Extract plans" --schema schema.json
arks code context "current TypeScript SDK usage"
arks research run "compare current agent research APIs" --depth standard
arks browser open "https://example.com"
arks browser snapshot <session-id>
arks browser close <session-id>
arks monitor create --query "agent releases" --period 1d --webhook https://example.com/hook --secret-file ./monitor.secret --confirm
arks monitor status <monitor-id>
arks monitor pause <monitor-id> --confirm
arks monitor delete <monitor-id> --confirm
arks monitor site create --input ./site-monitor.json --confirm
arks monitor site checks <site-monitor-id>
arks monitor site delete <site-monitor-id> --confirm
arks mcp serve
```

Skills that need shared execution use a versioned machine interface instead of importing runtime code or resolving repository paths:

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
arks invoke monitor.site.create --input site-monitor-create-request.json
arks invoke monitor.site.checks --input site-monitor-checks-request.json
```

`monitor.*` represents Exa recurring searches. `monitor.site.*` is a separate Firecrawl contract for typed scrape, crawl, and web-search targets, five-field cron or natural-language schedules, 1–365 day retention, optional goal judging, Provider credit estimates, and page-level check results.

`arks mcp serve` exposes the same Protocol v1 capability dispatcher through the official MCP TypeScript SDK over stdio. MCP does not duplicate Provider logic or lifecycle rules.

## Plugin Installation

ArkSpace includes development manifests for native Claude Code and Codex plugin installation in addition to the portable canonical Skills. Canonical Skills remain in `skills/`; both hosts consume that directory directly.

The Codex marketplace points to the repository root, so the plugin does not need compilation or a mirrored package directory. Routine changes remain source changes. An explicit release updates plugin version metadata and validates installation from the tagged source; only the Node/TypeScript CLI has a software build step.

## Project Map

| Need | Read |
| --- | --- |
| Understand the new system boundaries | [Architecture](docs/architecture.md) |
| Review migration phases and cutover gates | [Migration plan](docs/migration.md) |
| Inspect the version 0.1 scope, evidence, and release blockers | [Version 0.1 evidence](docs/migration/v1-evidence.md) |
| Add or design a Skill | [Adding Skills](docs/adding-skills.md) |
| Configure the MCP stdio transport | [MCP transport](docs/mcp.md) |
| Check intended host and operating-system support | [Platform Support](docs/platform-support.md) |
| Maintain design documents and future code | [Maintenance](docs/maintenance.md) |
| Review the CLI boundary decision | [ADR 0001](docs/adr/proposed/0001-node-typescript-arks-cli.md) |
| Review the proposed initial Skill boundaries | [ADR 0002](docs/adr/proposed/0002-initial-web-skill-boundaries.md) |
| Review direct-source plugin distribution | [ADR 0004](docs/adr/proposed/0004-direct-source-plugin-distribution.md) |
| Review Browser and Monitor ownership | [ADR 0007](docs/adr/proposed/0007-owned-browser-and-monitor-resources.md) |
| Review MCP stdio transport | [ADR 0008](docs/adr/proposed/0008-mcp-stdio-transport.md) |

## Repository Contract

- Canonical Skills live in `skills/<skill-name>/SKILL.md` when implementation begins.
- Shared CLI code lives under `src/`; Skills never import it directly.
- Skill-local scripts stay inside their owning Skill.
- Private keys, endpoints, local state, and personal configuration are never committed.
- External source use is recorded with its license and adaptation status before code is imported.
- Plugin manifests reference canonical Skills directly; no generated plugin mirror is maintained.
- The existing ArkSpace repository is behavioral evidence, not the architecture source for this project.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before changing the project.
