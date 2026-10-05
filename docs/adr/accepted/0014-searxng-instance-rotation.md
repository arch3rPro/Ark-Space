# SearXNG instance rotation and human setup

- **Status:** accepted; implemented in 0.1.3
- **Class:** security
- **Extends:** [ADR 0013](../accepted/0013-searxng-keyless-self-hosted-search.md)

## Decision

`arks setup` may append multiple user-chosen SearXNG instances, each with its own explicit CIDR exceptions. The wizard preserves existing instances and keyed Provider credentials; no public-instance discovery, deployment, authentication headers, or proxy is added. Single-endpoint configuration and environment-only setup remain compatible. Duplicate endpoints must not silently expand network permissions.

The canonical configuration is `providers.searxng.instances`, an ordered list of `{ baseUrl, allowRanges }` entries. Legacy `baseUrl`/`allowRanges` configuration is read as a singleton and normalized on write. `provider configure searxng` replaces the list with one instance; `--append` and setup append without modifying existing instances. The original affirmative setup append explicitly enabled the Provider. Menu management in [ADR 0015](0015-menu-based-provider-setup.md) separates append from enabling and preserves an existing disabled status; environment values never override a disabled persisted entry.

Multiple instances use a persistent, transactionally advanced round-robin cursor. Instance health is separate from API-key health: state stores anonymous instance identifiers, cooldowns, and cursor metadata, never fake keys or private endpoint URLs. Selection and result recording reuse the existing locked atomic state store. Singleton execution retains the earlier no-state-write behavior. Old invocation snapshots do not prune newer instance metadata, and a late concurrent success does not clear an unexpired cooldown. Lock waits observe cancellation; no file lock spans terminal input. A successful empty search is success, not a reason to retry.

Within-Provider failover may try each eligible instance at most once after a classified safe failure such as connection failure, rate limiting, or server failure. Private-address denial, invalid configuration, invalid requests, authentication/permission failures, and invalid responses are terminal by default. Instance-specific permissions never transfer to another instance. Explicit `provider: "searxng"` allows this instance failover but never hosted-Provider fallback.

All instance attempts share the operation deadline and caller cancellation. A per-instance budget divides the remaining time among eligible, untried instances, reserving time for another if the first one hangs without reserving time for cooling instances. Cancellation or exhaustion of the total budget stops the operation. Attempts identify anonymous instance IDs, not credentials or private endpoints.

## Trade-off

A process-local cursor would restart with every CLI invocation and race across processes. Reusing credential IDs would misrepresent keyless instance health. A narrow SearXNG pool and separate state metadata support the concrete requested behavior without introducing a universal endpoint framework.

## Evidence and limits

`tests/setup.test.ts`, `tests/searxng.test.ts`, and `tests/searxng-pool.test.ts` cover legacy/environment configuration, additive setup, duplicate permission preservation, concurrent rotation, failover/cooldown/recovery, terminal safety failures, cancellation/time budgets, stale success/config snapshots, and built CLI entry. An isolated npm-installed `arks invoke` fixture check verified cross-process balancing and prompt exit during an aborted state-lock wait. Real-instance and hosted Windows/macOS qualification remain unclaimed. See [release notes](../../../release/0.1.3.md) for verification evidence and qualification limits.
