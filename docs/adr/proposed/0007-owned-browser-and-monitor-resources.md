# ADR 0007: Owned Browser and Monitor Resources

- Status: Proposed
- Date: 2026-04-01
- Classification: Architecture, security, lifecycle

## Context

Browser sessions and monitors outlive one HTTP request. A browser session accrues cost until it is closed or expires. A monitor persists until it is paused or deleted. Both resources are created under one provider account and API key, so later operations must use the same account. Blind key rotation can make an owned resource appear missing and can leave billable work behind.

Browser interaction can also cause external side effects. Monitor creation, update, resume, pause, trigger, and deletion change persistent provider state or start paid work. A transport cannot infer user approval merely from receiving a request.

## Decision

ArkSpace will treat browser sessions and monitors as owned remote resources.

### Ownership

After confirmed creation, ArkSpace records only the provider, an anonymous key ID, resource ID, timestamps, and non-secret lifecycle metadata. It never stores an API key value. Every subsequent resource operation resolves the recorded key ID to the currently configured environment-variable reference and uses that exact credential. It does not rotate keys or fall back to another provider for owned resources.

If the referenced credential is unavailable, ArkSpace fails with a configuration error and preserves the ownership record.

### Browser contract

Protocol v1 exposes bounded, structured browser operations:

- `browser.open` creates a Firecrawl Browser Sandbox session and optionally performs one initial navigation.
- `browser.snapshot` returns a bounded accessibility snapshot.
- `browser.interact` accepts one structured action, not arbitrary JavaScript, Python, or shell code.
- `browser.status` reports the provider-observed state.
- `browser.close` explicitly closes the session.

Browser TTL and inactivity TTL are bounded by provider limits. ArkSpace omits CDP, live-view, and interactive-live-view URLs from normal protocol results because these URLs can carry temporary access authority.

`browser.interact` requires `confirmed: true`. The caller is responsible for confirming the exact target and intended action with the user before setting it. ArkSpace reports uncertain execution as potentially side-effecting and does not retry it automatically.

If initial navigation fails after session creation, ArkSpace attempts to close the session. It reports creation failure only when cleanup is confirmed; otherwise it preserves ownership and returns the session ID with cleanup evidence.

### Monitor contract

Protocol v1 exposes Exa monitor create, list, status, update, pause, resume, trigger, and delete operations. Mutating operations require `confirmed: true`.

Create requests require an explicit search query, cadence, result limit, and optional webhook URL. ArkSpace reports estimated cadence and warns that provider charges and notifications continue until pause or deletion. Create responses never place the one-time webhook signing secret in protocol output, logs, warnings, fixtures, or telemetry. When Exa returns a secret, ArkSpace writes it directly to a caller-specified local file using a restrictive atomic write, records the file path locally, and reports only that storage occurred.

Pause and resume use the provider's active-state update. Delete removes local ownership only after provider-confirmed deletion or a provider response that proves the resource no longer exists. List reports ArkSpace-owned resources; status refreshes one resource from the provider. Trigger starts a paid run and therefore requires confirmation.

### State and cleanup

Ownership metadata shares the existing atomic, locked state document. Expired browser records may be retained until status or close confirms terminal state; time alone is not proof of remote cleanup. Remote cleanup results are reported independently from the primary operation.

## Alternatives Considered

### Rotate keys for every resource operation

Rejected. Resource IDs are scoped to the creating account. Rotation can hide resources and strand ongoing costs.

### Expose raw browser code execution

Rejected for Protocol v1. Arbitrary code creates an unbounded remote execution and data-exfiltration surface. Structured actions cover the initial agent workflow while keeping side effects reviewable.

### Return browser authority URLs and webhook secrets in JSON

Rejected. Protocol envelopes commonly enter terminal history, agent transcripts, and logs. Capability URLs and signing secrets require a narrower handling path.

### Treat deletion or close as best effort

Rejected. A local success result without remote confirmation would misrepresent billing and lifecycle state.

### Keep ownership only in process memory

Rejected. Browser and monitor operations commonly span CLI invocations and MCP calls.

## Consequences

- Resource operations remain account-correct across processes.
- Browser automation is intentionally less flexible than direct Playwright execution in Protocol v1.
- Callers must perform an explicit confirmation step for mutations.
- Lost environment references make resources temporarily unmanageable until restored.
- State schema and tests must cover ownership migration, redaction, and cleanup evidence.
