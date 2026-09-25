# T1 provider execution and tool surface decisions

- **Status:** proposed
- **Class:** architecture

## Context

The T1 implementation batch adopted several patterns from `pi-web-access`. Most of W1 and W4 are test and evidence practices rather than architectural decisions, but W2, W3, and W5 affect ArkSpace's execution, output, and public tool surfaces. Without a recorded decision, the reasons for these boundaries are easy to lose during later provider or host integration.

## Decisions

### Provider failure classification remains explicit and controls fallback

Provider failures are normalized into ArkSpace's existing `FailureKind` set. Fallback is allowed only when the configured `fallbackOn` list contains the normalized kind. An explicitly selected provider is strict: the request does not silently switch to another provider.

W1 fixes this behavior with table-driven status/text/provider fixtures and explicit-provider tests. It does not introduce a new failure taxonomy or change Protocol v1 envelopes.

### Waiting is independently abortable from provider cleanup

Provider execution must return at the operation deadline even when the underlying promise does not observe `AbortSignal`. Waiting for a provider is therefore bounded independently from any provider cleanup. Cleanup evidence is reported separately and an unconfirmed cleanup must not be represented as successful cleanup.

This keeps timeout, cancellation, partial output, retry safety, and resource or billing uncertainty distinct. It uses the existing attempts evidence rather than introducing a new runtime dependency or detached-job protocol.

### Machine results and human diagnostics have separate renderers

Protocol JSON remains machine-readable output on stdout. Human diagnostics are planned by pure, host-independent functions and written to stderr by a thin CLI adapter. The plan functions do not depend on ANSI styling, Pi TUI components, or a particular host.

This preserves the stable `arks invoke <capability>` boundary while allowing CLI presentation to evolve independently of protocol consumers.

### Tool exposure is configurable per capability, without host-specific activation

MCP tools and CLI subcommands may be enabled or disabled independently and may receive validated aliases. The default configuration preserves the existing tool set and names. The stable capability name used by `arks invoke <capability>` is not renamed by a CLI or MCP alias, and disabled capabilities are rejected rather than hidden only at presentation time.

ArkSpace does not adopt Pi-specific delayed activation, transcript reconstruction, or host credential reuse. Tool registration remains a configuration concern, not a new host-coupling layer.

## Consequences

Provider fallback behavior is predictable and testable, but adding a new failure kind requires updating classification, fallback policy, and fixtures together. A provider that cannot stop after cancellation may continue running outside the caller's wait; the result must expose that uncertainty instead of hiding it.

CLI and MCP names can be customized without breaking machine callers, but aliases must not be treated as new capability identifiers. Configuration defaults remain backward-compatible, while operators can reduce exposed surface area for a particular host.

W1 and W4 remain documented primarily in their issue files because they describe verification and evidence methods, not independently costly architectural choices.

## Alternatives considered

**Fallback whenever a provider fails.** Rejected because authentication, invalid-request, uncertain-submission, and cleanup-uncertain failures can make retrying unsafe or misleading.

**Let provider promises determine the CLI deadline.** Rejected because a provider may ignore cancellation and hold the process open after the caller's deadline.

**Write human errors into stdout alongside protocol JSON.** Rejected because scripts would no longer have a stable machine-readable stream.

**Rename the capability when a CLI or MCP alias is configured.** Rejected because aliases are presentation-layer names and `arks invoke <capability>` is the stable machine boundary.

**Import Pi's delayed tool activation model.** Rejected because ArkSpace does not control the host transcript or Pi model registry and has no evidence that the coupling is needed.

## Acceptance criteria

1. Failure classification and fallback tests cover the existing failure kinds and explicit-provider strictness.
2. A non-settling provider call cannot hold provider execution past its wait deadline.
3. Cleanup evidence distinguishes confirmed cleanup from unconfirmed cleanup.
4. Real CLI invocation keeps the protocol envelope on stdout and diagnostics on stderr.
5. Disabled tools are absent from MCP registration and CLI exposure, while disabled capabilities cannot be invoked through the stable capability boundary.
6. Valid aliases are accepted, invalid aliases fail loudly, and default tool names remain unchanged.
7. No new runtime dependency or Pi-host-specific activation mechanism is required.
