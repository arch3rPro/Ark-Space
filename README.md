# ArkSpace

<p>
  <a href="README.zh-CN.md">中文</a> ·
  <a href="INSTALL.md">Install</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

![ArkSpace as a futuristic ark-like workspace containing research, knowledge, workflow, toolbox, planning, and engineering capabilities.](./assets/readme/hero.png)

[![npm](https://img.shields.io/npm/v/%40arkspace%2Fcli?label=%40arkspace%2Fcli)](https://www.npmjs.com/package/@arkspace/cli)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Reusable Agent Skills for web evidence, cited research, browser work, and monitoring—backed by one secure local execution boundary when shared Provider access is required.**

ArkSpace gives coding Agents focused operating instructions instead of one oversized prompt. The first release includes five canonical Skills and the `arks` CLI, which coordinates Provider credentials, multiple-key rotation, fallback, owned remote resources, and machine-readable results.

## Start in two minutes

### Ask an Agent to install it

Paste this into your coding Agent:

```text
Install ArkSpace from https://github.com/arch3rPro/Ark-Space by following the repository's INSTALL.md. Ask before changing my global packages, Agent configuration, or MCP configuration. Never ask me to paste an API key into this conversation. When credentials are required, stop and ask me to run `arks setup` myself in a trusted local terminal. Verify the CLI, installed Skills, and Provider readiness before declaring success.
```

### Or install it yourself

See the [0.1.5 release notes](release/0.1.5.md) for features, verification evidence, and qualification limits.

```bash
npm install --global @arkspace/cli@latest
npx skills@latest add arch3rPro/Ark-Space
```

Then run the credential wizard yourself in a trusted local terminal:

```bash
arks setup
arks doctor
arks web search "agent skills"
```

> **Keep API keys out of Agent chats.** `arks setup` uses hidden terminal input and stores local credentials separately from configuration and state. Environment variables remain available for CI and externally managed secrets.

See [INSTALL.md](INSTALL.md) for host-specific installation, verification, update, uninstall, MCP, and credential details. The 0.1.5 release-candidate source adds manual npm CLI update checks and installation; published 0.1.4 does not include the updater, and availability of the candidate package on npm is not implied. Install the CLI with `@latest` and update Skills separately.

### Check and update installed Skills

For Skills installed through the Skills CLI:

```bash
npx skills@latest check   # Check for available Skill updates
npx skills@latest update  # Manually update installed Skills
```

These commands apply to Skills tracked by the installer, not just ArkSpace. Back up local edits before updating; `npx` may download the tool and write its cache. CLI updates are separate, and native Codex/Claude plugins use their host's plugin update mechanism.

## Choose the Skill by outcome

| Skill | Use it to… |
| --- | --- |
| [`askme`](skills/askme/SKILL.md) | Clarify consequential requirements, preserve agreed constraints, and correct execution drift. |
| [`web`](skills/web/SKILL.md) | Find, retrieve, map, crawl, or extract public Web and implementation evidence. |
| [`research`](skills/research/SKILL.md) | Produce a bounded, cited synthesis across public sources. |
| [`browser`](skills/browser/SKILL.md) | Inspect or change dynamic page state in an owned remote browser session. |
| [`monitor`](skills/monitor/SKILL.md) | Manage recurring searches and site-change checks beyond the current session. |
| [`weknora`](skills/weknora/SKILL.md) | Search, import, and answer questions over a WeKnora knowledge base through its REST API. |
| [`gh-repo`](skills/gh-repo/SKILL.md) | Analyze GitHub project architecture, maturity, and borrowing tradeoffs with revision-pinned source evidence; inspect supporting issues/PRs. |

`askme` is guidance-only: it needs conversational follow-up, with no CLI, network, credentials, or sibling Skills. It can be invoked explicitly or selected by the Agent when a consequential ambiguity or execution mismatch needs resolution. Clear tasks proceed directly; alignment does not add a universal approval step.

See the [Skill, Capability, and Provider reference](docs/capabilities.md) for operation identifiers, Provider coverage, fallback behavior, and resource ownership.

### Optional managed WeKnora configuration (0.1.4)

Run `arks setup weknora` in your trusted terminal to manage its API root, masked key, and optional default knowledge base. Authenticated managed verification, list/detail, and search may target a valid localhost, private, or public address without a CIDR exception. They retain URL and address validation, DNS pinning, TLS verification, redirect refusal, no-proxy transport, deadlines, and response bounds. An explicit request to read the configured instance authorizes that network access; HTTP is supported with an informational plaintext-transport warning. The managed path does not join Web search order or fallback.

A manually supplied `WEKNORA_BASE_URL` / `WEKNORA_API_KEY` pair remains independent and needs no CLI. Imports, document/chunk operations, multi-base search, and streamed chat continue using that environment path. See [installation](INSTALL.md) and the [managed guide](skills/weknora/references/managed.md).

## What the runtime adds

A Skill can remain pure guidance, carry a self-contained script, use an external application, or call a shared ArkSpace capability. `arks` is required only for the last case.

```text
Agent host
  └─ Agent Skill
      ├─ host tools / Skill-local scripts / external tools
      └─ arks invoke <capability> --input <file>
          ├─ Provider-neutral capability handler
          ├─ Exa / Tavily / Firecrawl / SearXNG adapter
          └─ credentials, key pool, fallback, and owned state
```

The shared runtime provides:

- **Stable machine output:** one Protocol v1 JSON envelope on stdout; diagnostics stay on stderr.
- **Credential isolation:** setup happens in a human-controlled terminal, while config and state retain references and non-secret metadata.
- **Multiple-key handling:** transactional round-robin selection, cooldown, disable states, and classified fallback.
- **Honest remote lifecycle:** timeout, cancellation, uncertain acceptance, partial output, and cleanup remain distinct outcomes.
- **Owned resources:** browser sessions and monitors stay bound to the credential that created them and require confirmation for material side effects.
- **One MCP adapter:** `arks mcp serve` exposes the same dispatcher instead of duplicating Provider logic.

## Human and machine entry points

Human-facing commands optimize for discovery:

```bash
arks provider list
arks web fetch "https://example.com/docs"
arks web crawl "https://docs.example.com" --max-pages 20 --max-depth 2
arks code context "current TypeScript SDK usage"
arks research run "compare current agent research APIs" --depth standard
arks browser open "https://example.com"
arks monitor status <monitor-id>
```

Skills use the stable machine boundary:

```bash
arks invoke web.search --input search-request.json
arks invoke research.run --input research-request.json
arks invoke browser.open --input browser-open-request.json
arks invoke monitor.create --input monitor-create-request.json
```

Protocol schemas are published under [`schemas/protocol/v1/`](schemas/protocol/v1/).

## Installation surfaces

- **Portable Skills:** compatible filesystem-based hosts can install the canonical `skills/` tree with the Agent Skills installer.
- **Claude Code plugin:** the repository marketplace manifest references canonical Skills directly.
- **Codex plugin metadata:** `.codex-plugin/plugin.json` points to the same canonical directory.
- **MCP stdio:** Claude Code, Codex, and other MCP hosts can register `arks mcp serve` when tool discovery is useful.

There are no generated plugin mirrors. Routine Skill changes update the canonical source; plugin version metadata changes only during an explicit release.

## Security model

- Never enter API keys in an Agent question, chat message, command argument, fixture, or tracked file.
- `arks setup` writes local keys to the user-level `credentials.json` file with restrictive permissions where supported.
- Explicit environment variables override locally stored values.
- `config.json` stores credential references; `state.json` stores anonymous key IDs and lifecycle metadata.
- Browser and monitor mutations require explicit confirmation; cleanup and uncertain remote outcomes remain visible.

The local credential file contains plaintext secrets and is not an operating-system keychain. Read [ADR 0009](docs/adr/accepted/0009-local-credential-setup.md) and [Security Policy](SECURITY.md) before choosing a credential strategy for a managed environment.

## Release status and limits

**0.1.5 release-candidate changes since 0.1.4** include manual npm CLI updates, improved bounded research evidence review, and Skill icons and invocation policies. See [release notes](release/0.1.5.md) for evidence and qualification limits. The 0.1.4 release added optional managed WeKnora verification and retrieval; see [0.1.4 release notes](release/0.1.4.md).

Version 0.1.3 shipped keyless SearXNG with a rebuilt Setup TUI. In 0.1.5 that workbench runs on a differential-rendering engine with the same three-axis contract: Top/Menu/Content focus regions cycled with Tab/Shift-Tab, and the menu spans six pages (Search, Knowledge, Tools, Settings, Diagnostics, Exit) that switch live with the menu arrows, and the Top strip follows the page—[Exa] [Tavily] [Firecrawl] [SearXNG] [Order] tabs on Search (order settings ride the strip beside the engines), single tabs on Knowledge/Tools, full page names elsewhere—with `arks setup <context>` deep-linking into any provider page. Security semantics are unchanged: masked key drafts with explicit overwrite consent (Cancel default), provider and key enablement toggles, a Cancel-default test chooser between one round-robin pool test and isolated per-key tests (one request per reference, Esc stops), per-instance private-CIDR consent for SearXNG that never migrates between endpoints, WeKnora endpoint/key/knowledge-base rows with consented live verify, UseGPT status/start/stop/diagnose plus offline Tunnel ID, data-directory, key, and unlink management, reorder-only search routing with per-engine enable/disable and a once-per-save privacy confirmation, and session-only diagnostics. Opening setup never issues a network request; non-TTY streams print one plain line and never enter the alternate screen; the terminal is always restored on exit. Automated Linux PTY qualification covers every page through `npm run test:setup` against both the source build and an offline-installed entry; human usability, real services, and hosted Windows/macOS terminals remain unqualified. See [ADR 0016](docs/adr/accepted/0016-tui-provider-setup.md) and [ADR 0017](docs/adr/accepted/0017-workbench-modal-setup.md) for interaction and security contracts, [ADR 0023](docs/adr/accepted/0023-pi-tui-setup-engine.md) and [ADR 0024](docs/adr/accepted/0024-workbench-presentation-contract.md) for the engine and presentation decisions, and [NOTICE.md](NOTICE.md) for reference provenance.

Build the checkout as described in [INSTALL.md](INSTALL.md#source-development), then run `node dist/cli/main.js setup` (or append `exa`, `tavily`, `firecrawl`, or `searxng`) without replacing your global installation. Existing credential preview, environment precedence, ownership guards, narrow per-instance CIDR consent, live-test consent, cancellation, and terminal restoration remain as specified in the setup contract.

Current limits:

- Node.js 20 or newer and a local host with shell, network, and persistent user storage are required. The optional UseGPT Artifact Hub requires Node.js 22.13.0 or newer because it uses unflagged `node:sqlite`.
- Exa, Tavily, and Firecrawl operations require the applicable account and may incur Provider charges; SearXNG search instead requires an explicitly configured instance.
- Keyless Exa MCP access and Tavily/Firecrawl OAuth are research topics, not implemented authentication backends.
- Hosted cross-platform and credentialed live-Provider qualification remains part of the [post-release backlog](docs/migration.md#post-release-01-qualification-backlog).
- This release does not declare replacement cutover of the existing ArkSpace project.

## Project guide

| Need | Read |
| --- | --- |
| Install, verify, update, or uninstall | [Installation](INSTALL.md) |
| Understand boundaries and execution models | [Architecture](docs/architecture.md) |
| Review migration and cutover gates | [Migration plan](docs/migration.md) |
| Inspect 0.1 evidence and blockers | [Version 0.1 evidence](docs/migration/v1-evidence.md) |
| Record real-use friction and improvement evidence | [Field Testing Log](docs/field-testing.md) |
| Add or design a Skill | [Adding Skills](docs/adding-skills.md) |
| Configure MCP stdio | [MCP transport](docs/mcp.md) |
| Check intended host and OS support | [Platform Support](docs/platform-support.md) |
| Understand maintenance and release rules | [Maintenance](docs/maintenance.md) |

## Development

```bash
git clone https://github.com/arch3rPro/Ark-Space.git
cd Ark-Space
npm install
npm run check
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before changing the project. Security reports follow [SECURITY.md](SECURITY.md).

## License

ArkSpace is available under the [MIT License](LICENSE). External source and attribution notices are recorded in [NOTICE.md](NOTICE.md).
