# ADR 0008: MCP Stdio Transport over Protocol v1

- Status: Proposed
- Date: 2026-04-01
- Classification: Architecture, integration

## Context

ArkSpace already has versioned capability inputs, stable result envelopes, and provider execution logic used by `arks invoke`. Agent hosts increasingly discover and call tools through the Model Context Protocol (MCP). A separate MCP implementation of each provider would duplicate validation, fallback, lifecycle, and redaction behavior.

MCP stdio servers also share standard output with the transport. Human logs on standard output would corrupt the message stream.

## Decision

ArkSpace will ship `arks mcp serve` as an MCP stdio server implemented with the official TypeScript SDK.

Each MCP tool maps to one existing ArkSpace capability. Tool input schemas are derived from the committed Protocol v1 request schemas, with the outer protocol envelope removed. Calls pass through the same request parser and capability dispatcher as `arks invoke`; provider adapters and business logic are not reimplemented in the transport.

MCP tool results include:

- `structuredContent`: the complete ArkSpace Protocol v1 result envelope;
- one JSON text content item for hosts that do not consume structured content;
- `isError: true` when the ArkSpace envelope has `ok: false`.

Tool names replace capability dots with underscores, for example `web_search` and `research_run`. Descriptions identify cost, confirmation, and persistent-resource behavior where applicable.

The MCP process writes protocol frames only to standard output. Diagnostics use standard error. It handles termination by aborting active capability calls, allowing their existing cleanup rules to run, then closing the MCP transport.

## Alternatives Considered

### Implement provider-specific MCP tools

Rejected. This would fork validation, key handling, fallback, and lifecycle guarantees from the CLI.

### Launch `arks invoke` as a subprocess for each tool call

Rejected. It adds startup overhead, complicates cancellation, and obscures typed error handling. The in-process dispatcher is the canonical seam.

### Return only prose content

Rejected. Agents and host applications need the complete, versioned evidence envelope.

### Use HTTP transport first

Rejected for the first release. Stdio has a smaller deployment and authentication surface for local Claude Code and Codex installations. A remote transport can be added later without changing capabilities.

## Consequences

- CLI and MCP behavior remain aligned by construction.
- The MCP dependency is runtime production code and must be pinned and tested.
- Standard-output discipline becomes a server invariant.
- Capability additions require schema generation and a transport registration entry, but no provider duplication.
