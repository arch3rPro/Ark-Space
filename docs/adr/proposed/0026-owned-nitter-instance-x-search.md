# X content through a user-owned Nitter instance

- **Status:** proposed (source implemented; real instance and human acceptance unverified)
- **Class:** execution and credentials
- **Extends:** [ADR 0019](../accepted/0019-optional-weknora-managed-connection.md) for the optional managed connection; [ADR 0009](../accepted/0009-local-credential-setup.md) and [ADR 0017](../accepted/0017-workbench-modal-setup.md) for credential ownership and Setup interaction

## Problem

An Agent needs public X content: keyword and author search, a thread with its replies, an account profile, and an account timeline. Hosted Web Providers return ordinary web pages and cannot page X conversations or report X-specific fields. X's official API needs paid credentials and does not expose the same surfaces.

The user owns a Nitter fork (`https://github.com/xiaoY233/nitter`) that serves a read-only agent API over X web endpoints through X account sessions the operator supplies. Reading X content through it costs the operator's session quota and carries a real risk that X limits or suspends those accounts.

## Decision

Four new capabilities, `x.search`, `x.thread`, `x.user`, `x.timeline`, execute through one configured Nitter instance over its REST API with `format=json`. They are not a Web Provider: Nitter never joins provider order, key rotation, cross-instance fallback, or hosted fallback. A request for X content either succeeds against the configured instance or reports a classified failure.

One guidance Skill, `x-search`, owns activation, routing, paging, error handling and reporting for these capabilities. It rewrites the upstream Skills rather than copying them, and carries no curl fallback script because `arks invoke` is the single execution boundary. It is the only Skill for this surface; thread and account workflows are references inside it, not separate Skills, because they share activation, credentials and safety rules. No existing Skill changes.

The configured host may be public, private or loopback with no address authorization step, matching the policy the user chose for WeKnora. An explicit request to read X content authorizes network access to that configured instance; HTTP is allowed with a plaintext-transport warning and TLS verification is never disabled.

## Consequences

Saving a connection is not capability completion. Delivery distinguishes "connection saved", "token and reachability verified without spending X quota", and "a real read succeeded". Automated tests use synthetic tokens and a local HTTP layer; real X content, real account risk, and hosted OS behaviour stay unverified until a live run.

`GET /api/v1/tools` is the token check because `/api/v1/health` is unauthenticated and health cannot prove the token. A token check spends no X quota; every tool call does, so the Skill pages narrowly and reports how much it read.

Tweet text, bios and names are attacker-controlled third-party data. They are fenced as untrusted in output and cannot authorize command execution, credential disclosure, configuration changes, or further escalation. Private individuals get the minimum the user asked for.

The upstream is a fork the user controls, so integration gaps are fixed upstream and recorded in the spec's issue log rather than worked around silently. Reviewed revisions belong in `NOTICE.md` as API-contract provenance only; no upstream source is copied.

## Rejected alternatives

Registering Nitter as a `web.search` backend would mix X-only results into ordinary web search, inherit the Web Provider address-denial rules that the user rejected here, and cannot express thread, profile or timeline reads. Three separate Skills, mirroring the upstream layout, would fragment one activation surface and duplicate the same safety rules. Requiring the official X API would contradict the user's self-hosted setup and add a paid credential for a subset of the same data.

## Open items

Whether `/api/v1/health` should report a version, whether `/api/v1/tools` remains the supported token check, and whether stable response JSON Schemas are published. These are upstream requests, not blockers for the client contract.
