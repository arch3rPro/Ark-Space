# MCP stdio transport

ArkSpace exposes every Protocol v1 capability as an MCP tool through:

```bash
arks mcp serve
```

The server uses the stable v2 `@modelcontextprotocol/server` package and newline-delimited stdio transport. Standard output contains only MCP frames. Diagnostics use standard error.

## Host configuration

Build and link the CLI before local development:

```bash
npm install
npm run build
npm link
arks setup
```

Then register the command with the host. Claude Code accepts:

```bash
claude mcp add arkspace -- arks mcp serve
```

Codex can use this project entry in `~/.codex/config.toml`:

```toml
[mcp_servers.arkspace]
command = "arks"
args = ["mcp", "serve"]
```

Use an absolute `arks` executable path when the host does not inherit the shell `PATH`. Provider keys remain environment-variable references in ArkSpace configuration; the MCP child process must inherit those variables from the host's secret-management environment. Never place raw keys in repository configuration.

Run `npm run test:hosts` before a release candidate. It packs and installs the package into a temporary prefix, validates and installs the Claude Code plugin in an isolated configuration directory, registers the installed absolute MCP command with Claude Code and Codex, verifies discovery and a tool call, cancels in-flight Provider I/O, checks post-cancellation responsiveness, and verifies clean process exit. The check requires locally installed `claude` and `codex` commands and does not use Provider credentials.

## Tool contract

Tool names replace capability dots with underscores: `web_search`, `research_run`, `browser_interact`, and so on. Inputs are the `input` object from the corresponding committed Protocol v1 request schema. The MCP handler adds `protocolVersion` and `capability`, validates the complete request, and passes it to the same dispatcher as `arks invoke`.

Every call returns:

- a JSON text content item for general MCP hosts;
- the complete ArkSpace envelope as `structuredContent`;
- `isError: true` when the envelope has `ok: false`.

MCP annotations are descriptive hints, not authorization. ArkSpace independently requires `confirmed: true` for Browser interaction, Monitor mutations, and managed WeKnora calls. An explicit user request to read the configured WeKnora instance authorizes that network access; no separate HTTP permission is required.

`weknora_connection_verify` makes one bounded `GET /auth/me` to the configured connection (at most five seconds); HTTP is supported with an informational plaintext-transport warning. Its additive non-Web Protocol v1 envelope uses `connection: "weknora"`, not `provider` or Web `attempts`. Success reports only route acceptance, not identity or retrieval permission. Failure reports a fixed non-secret classification; 403 means ambiguous permission, not an invalid key. CLI startup passes the pre-hydration environment snapshot through MCP to the dispatcher, so stored keys never establish external ownership. See the [verification contract](../.scratch/weknora-managed-config/spec.md#implemented-verification-contract-issue-02). `arks setup weknora` manages the optional connection; the independent environment-based Skill path remains available without the CLI.

Managed retrieval tools are `weknora_knowledge-bases_list`, `weknora_knowledge-bases_get`, and `weknora_search`. They require `confirmed: true` and use the same non-Web envelope with validated knowledge-base/result projections. Search sends query content to the selected instance after knowledge-base index preflight; obtain consent before submission. Detail/search support the managed default ID when omitted. Requests default to five seconds and accept up to thirty seconds; there is no key/connection fallback, state mutation, or credential export. See the [retrieval contract](capabilities.md#optional-weknora-retrieval).

## Lifecycle

MCP has no implicit ArkSpace resource session. `browser_open` and `monitor_create` return opaque IDs that later tools must supply. Ownership is persisted in ArkSpace state and pinned to the anonymous key ID that created the resource.

MCP cancellation is connected to the matching tool request and aborts in-flight Provider I/O. SIGINT and SIGTERM close the stdio server without writing diagnostics to stdout.

Stopping the MCP process does not prove that a Browser session closed or a Monitor stopped. Call `browser_close` explicitly and pause or delete monitors when their work is no longer required.
