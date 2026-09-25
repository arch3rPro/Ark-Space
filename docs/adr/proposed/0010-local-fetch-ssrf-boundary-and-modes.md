# Local HTTP fetch security boundary and modes

- **Status:** proposed
- **Class:** architecture

## Problem

ArkSpace's remote web-fetch Providers do not define a safe boundary for fetching arbitrary caller-supplied URLs. Adding a local HTTP(S) fetch path without an explicit trust boundary could turn `arks invoke web.fetch`, CLI, or MCP into an SSRF primitive. The fetch contract also needs to distinguish raw source retrieval from local readable extraction without silently adding model calls or browser capabilities.

## Decision

Add a local `web.fetch` Provider behind an explicit, disabled-by-default configuration gate.

The public local-fetch contract is:

- `provider: "local"` selects the local path explicitly;
- `mode` is `raw | readable`, defaulting to `readable` at the protocol boundary;
- one URL is accepted per local invocation;
- `answer`, model calls, browser cookies, PDF/video handling, and automatic proxy discovery are out of scope;
- stdout remains the Protocol v1 JSON result and diagnostics remain on stderr.

All local requests pass through a dedicated HTTP(S) security transport before connection:

- resolve every A and AAAA address and reject the request if any returned address is disallowed;
- reject loopback, private, link-local, shared, reserved, unspecified, documentation, and IPv4-mapped IPv6 addresses by default;
- accept only explicitly configured IP CIDR exceptions in `allowRanges`; malformed CIDRs fail closed;
- validate the URL again for each redirect hop and do not use automatic redirect following;
- bound redirects, headers, body size, and total request time;
- use the validated address for the socket lookup so the request does not perform an unvalidated second DNS resolution;
- ignore ambient proxy environment variables; `trustEnvProxy: true` currently fails closed because a safe proxy policy is not implemented;
- accept UTF-8 text-oriented responses only and reject invalid encoding or binary content;
- propagate cancellation and do not claim cleanup beyond what the transport can confirm.

The DNS check is a pre-connection defense, not a claim of complete DNS-rebinding immunity. Connection-level pinning, proxy support, and more comprehensive platform-specific networking controls require separate evidence before being enabled.

`readable` uses a small dependency-free conservative HTML fallback that removes obvious navigation, footer, script, style, and similar noise. It is not a claim of full Readability compatibility. A dedicated extraction dependency may be added only when real consumers demonstrate that this fallback is insufficient.

## Consequences

Local fetching can be enabled only by explicit local configuration and is independently testable through an injected transport. Existing remote Provider defaults and the stable `arks invoke <capability>` boundary remain unchanged.

The current implementation deliberately supports fewer features than general-purpose browser or web extraction tools. Callers must use remote Providers for answer generation, richer extraction, and unsupported media. A local request that contains multiple URLs is rejected rather than silently changing concurrency or partial-failure semantics.

DNS preflight cannot eliminate every TOCTOU or rebinding risk on every supported operating system. The implementation must therefore retain conservative defaults and avoid describing this boundary as a complete SSRF proof.

## Alternatives considered

**Use the global `fetch` directly.** Rejected because it does not provide the required explicit DNS/address, redirect, proxy, size, and connection policy.

**Enable local fetching by default.** Rejected because arbitrary URL access is a material network trust decision and would make existing CLI/MCP callers unexpectedly able to reach local or private services.

**Allow all resolved addresses if at least one is public.** Rejected because dual-stack or multi-address DNS could route the same request to a disallowed destination.

**Follow redirects automatically.** Rejected because every redirect target is a new SSRF decision and must be validated independently.

**Add a full readability or browser dependency immediately.** Rejected until a real consumer demonstrates a need beyond the conservative local fallback.

## Acceptance criteria

1. Local fetching remains disabled unless explicitly enabled in configuration.
2. Direct, redirect, dual-stack, IPv4-mapped, private-range, malformed-CIDR, proxy-environment, timeout, cancellation, header-limit, body-limit, invalid-encoding, and non-text tests run through the real transport.
3. The transport pins the checked address and does not perform an unvalidated second DNS lookup.
4. Every redirect is parsed and checked under the same URL and address policy.
5. `raw` and `readable` results are covered through the local Provider contract, with `maxCharacters` applied after local processing.
6. `answer`, browser cookies, automatic proxies, and unsupported media are rejected or remain unavailable rather than silently falling back.
7. The implementation does not claim that DNS preflight alone eliminates DNS rebinding or TOCTOU risk.
