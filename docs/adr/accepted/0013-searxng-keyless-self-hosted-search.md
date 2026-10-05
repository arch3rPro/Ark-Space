# Keyless, explicitly configured SearXNG search

- **Status:** accepted; implemented in 0.1.3
- **Class:** security
- **Extended by:** [ADR 0014](0014-searxng-instance-rotation.md) for multi-instance setup, state, rotation, and failover

## Decision

SearXNG implements only `web.search`. Users choose the instance through `arks provider configure searxng --base-url <url>`. There is no default public endpoint and configuration does not add SearXNG to the default fallback order. Explicit Provider selection remains strict; an operator may manually add SearXNG to `providerOrder` to opt into classified fallback.

Only the known SearXNG ID uses the keyless execution branch. Empty credential lists do not authorize other Providers as keyless. SearXNG never selects a credential, writes key-pool state, or invents a `keyId`. Existing paid Provider interfaces and key registration remain unchanged.

Persisted endpoint configuration wins over `SEARXNG_URL`, then `SEARXNG_BASE_URL`. Environment resolution is transient and cannot override a disabled persisted entry. Base URLs must use HTTP(S), preserve any path prefix, and contain neither credentials, query nor fragment. Authentication and proxies are not supported.

The adapter reuses `localHttpGet` for DNS pinning, all-address validation, per-hop redirect checks, cancellation, and header/body/time limits. Private self-hosting requires explicit `providers.searxng.allowRanges` CIDRs, configured through repeatable `--allow-range`. This authority is independent of local fetch settings. Prefer a single host `/32` or `/128` exception to a broad subnet. Diagnostics report configuration readiness, not network reachability.

Search options live only under `options.searxng`. Categories are strict: zero results do not broaden the category or switch Provider. Common domain filtering is applied locally. Time-range semantics depend on the configured instance's engines. Source dates are preserved without verification. JSON output must be enabled by the instance; invalid or oversized responses fail closed.

## Alternatives considered

A default public instance would send queries to an unchosen third party and make availability an implicit runtime dependency. Fake credential references would contaminate key-pool state and diagnostics. Inferring keylessness from empty credential lists would bypass missing-key failures on paid Providers. Reusing the local-fetch enable switch would couple unrelated network permissions. All are rejected.

## Evidence and limits

`tests/searxng.test.ts` covers keyless execution, strict/manual fallback, endpoint precedence, classified failures, malformed and empty JSON, source normalization, domain filtering, CIDR authorization, cancellation, and CLI entry. Existing local HTTP tests cover DNS, redirects and transport limits. No SearXNG server implementation or Pi architecture is copied. Live-instance and hosted cross-platform qualification remain unclaimed. Features, verification evidence, and qualification limits are recorded in [release notes](../../../release/0.1.3.md).
