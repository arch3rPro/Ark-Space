# WeKnora optional managed configuration — completion evidence

Status: implemented; automated Linux qualification and authorized actual-instance list/detail checks passed in unreleased source

## Delivered user path

The human runs `arks setup weknora` in a trusted terminal. The primary WeKnora configuration list has three fields: required API address/key and optional default knowledge-base ID. Required/optional markers appear first so narrow screens do not clip them; form labels fit the existing eight-cell label budget. Enter always edits one selected field, even in empty setup; no configure-all form exists. Incomplete address/key values stay in this session only, visibly pending, and ordinary exit asks before discarding them. Completing the valid pair saves it atomically. The key row has the same masked-default, explicitly revealable preview as provider keys, including clearly labeled unsaved drafts. Source and current/local address metadata live in details. The user explicitly removed WeKnora IP authorization and the private-access action. Configured public, private and loopback endpoints now work without CIDRs; valid legacy ranges are ignored and cleared on new saves. The same Top/Menu/Content workbench retains offline save, guarded replacement/reuse, local removal, and separately consented connection testing. Opening/saving does not send a request. The header shows all five service labels at normal width, windowing only when its available width is insufficient, without moving summary/body panes.

The canonical Skill selects complete independent environment credentials without requiring the CLI; with neither public variable supplied, it can use supported managed operations. Incomplete/empty external pairs and externally overridden dedicated references stop rather than mix sources. Configuration/credentials remain private; the Skill neither reads them nor receives exported keys.

The runtime exposes verification, knowledge-base list/detail, and single-base search through installed `arks invoke` and MCP. Search performs knowledge-base detail/index preflight, sends documented `{query_text,match_count}` to POST hybrid-search with handle-mode resources, and returns bounded validated document/chunk evidence. Defaults are selection preferences, not authorization or broader search. No Web Provider registration, rotation, fallback, persistent health, or server configuration is introduced.

Independent environment operations continue to cover imports, document/chunk reads and edits, multi-base search, parsing checks, and SSE chat. These are not claimed as managed operations.

## Verification

- `npm run check`: project validation, typecheck, build, **602 tests in 41 files passed**.
- `npm run test:setup`: **84 source-entry and 84 offline installed-entry Linux real-PTY logical checks passed**. Three consecutive final reruns passed; an initial preview-wait timeout was not reproduced, and bounded synthetic-secret-redacted screen context was added to future timeout diagnostics. The latest checks verify the normal-width five-service header, required/optional markers, three field-specific editors, and a default-only edit preserving the endpoint and credential-file bytes. The added WeKnora scenario saves the API prefix/default and a masked dedicated key, confirms no Web-order change or network on save, tests unchanged save and Cancel-default probe/removal, removes local configuration, and verifies canonical/echo, cursor/alternate-screen restoration, and no secret in terminal history. Existing Web/resize/cancellation regressions remain covered.
- Latest IP-policy correction: a fresh offline temporary npm installation, with lifecycle scripts denied and isolated home/config/cache, passed **48 verification/retrieval tests in 2 files** using installed CLI/MCP entries. Initial delivery also passed **59 installed-entry/independent-Skill/guidance tests in 4 files**. CLI and MCP run from isolated working directories and synthetic homes, including original-vs-hydrated provenance, malformed stores, invalid requests, limits, source selection, index preflight, null results, scoped permission denial, and no state/config mutation.
- The independent SSE test copies only `skills/weknora` outside the repository, sets a complete environment pair with empty PATH and absent ArkSpace configuration, and receives a streamed answer without the CLI or sibling files. Self-contained reference links are checked for every installed Skill.
- `npm run verify:package`: **passed**, 210 packed files, no runtime install scripts; no synthetic TLS private key fixture is packaged.
- `npm run validate`: passed after documentation integration.
- Initial primary LSP checks covered 18 changed paths. The UX follow-up actively probed six source/test/script paths: no primary errors or warnings, one existing async-conversion hint, and auxiliary style advisories. Two push-only server outcomes could not independently confirm cleanliness; the full compiler typecheck passed.
- Security regressions include authenticated redirect/proxy refusal, all-answer DNS validation and pinning, response/header limits, strict input/body projection, echoed-key rejection, timeouts/cancellation, HTTP execution without a protocol-specific permission gate, and untrusted TLS rejection even under ambient TLS-disable. The TLS check has a positive control and a documented synthetic fixture, with no OpenSSL test-runtime prerequisite.
- After the user's correction, shared layout again uses the original 19-cell menu and full Configuration label. Three-column resource tables allocate approximately 50% to URL/reference and 25% each to source/status, rather than giving URL all unused space; resized form/caret coordinates remain correct. WeKnora details are concise, field notes show the credential-file path and concrete API example, and HTTP plaintext information does not introduce another confirmation.
- Real isolated HTTP regressions now prove managed and complete-environment WeKnora connections succeed on loopback without grants or borrowed local settings, while generic public-web HTTP still rejects the same unallowed destination before sending a request. Mixed DNS records retain IP/family validation and pinning. Only the WeKnora-only address policy changed. These policy regressions used synthetic fixtures; actual-instance list/detail evidence is recorded below.
- Final local-link and whitespace checks are recorded by the parent session.

## Authorized installation alignment and actual-instance read

The user reported that Setup succeeded but the loaded Skill still demanded environment credentials. Inspection confirmed two stale consumers: the installed environment-only Skill explicitly forbade `arks`, and the default global CLI rejected the new `connections` configuration. Matching `0.1.3` version strings did not establish matching feature availability.

After explicit permission, the old CLI and Skill were backed up outside active Skill discovery paths. The reviewed checkout was rebuilt and packed, then its local tarball installed globally with lifecycle scripts disabled. Only the three differing WeKnora Skill files were synchronized; unrelated Skills, Agent settings, MCP registration, and connection/credential files were not changed. The installed Skill matches the canonical directory, and protected connection/credential file metadata remained unchanged. `arks --version` and `arks setup --help` now succeed and advertise WeKnora.

The actual global CLI passed **48 installed-entry verification/retrieval tests in 2 files**. With neither public environment variable supplied, the authorized real-instance knowledge-base list and explicit-ID detail requests both succeeded with `source: managed`. The user expressly accepted plaintext HTTP credential transport before execution. Requests were read-only; no remote content, deployment, or credentials were changed, and no key was exported to the Agent. Private instance addresses, identifiers, names, and response bodies are intentionally omitted from this report. See [installation alignment issue](issues/07-installed-consumer-alignment.md).

## User correction: no extra HTTP permission

The user removed the HTTP-specific runtime permission gate and Setup's second HTTP confirmation. HTTP verification, list/detail and search now execute without `allowHttp`; that existing field remains accepted and explicitly described as ignored for compatibility. The plaintext warning is informational. An explicit user request supplies network consent for that operation; the existing `confirmed: true` machine boundary and unrelated safeguards remain unchanged. No remembered grants, additional settings, fee claims, or new confirmation flows were introduced. See [HTTP correction issue](issues/08-remove-http-consent.md).

- `npm run check`: validation, typecheck, build and **608 tests in 41 files passed**. An initial unrelated SearXNG subprocess timeout passed on isolated rerun and subsequent full qualification.
- Focused WeKnora runtime/Setup tests: **142 passed**; canonical Skill guidance: **4 passed**.
- `npm run test:setup`: **84 source + 84 offline installed Linux real-PTY checks passed**.
- Updated the already authorized global CLI and only the changed WeKnora managed reference. The actual global CLI/MCP entry passed **54 verification/retrieval tests in 2 files** with synthetic services, including HTTP without `allowHttp`.
- Active primary LSP probes: **9 paths, zero errors**.
- Connection/credential files remained unchanged by metadata checks. No additional live-instance request was made for this correction.

## Qualification limits

Automated qualification used synthetic and isolated credentials/services. The subsequent authorized actual-instance qualification covers managed knowledge-base list/detail only, not actual-instance search, imports, entry parsing, document/chunk reads, or chat. Human UX acceptance and hosted Windows/macOS terminal qualification remain unverified. Skips and synthetic native-stream tests are not represented as those qualifications.

The implementation and installation-alignment phases did not change versions, plugin metadata, tags, publications, commits, or releases. The published 0.1.3 package does not include this feature.

## Authorized 0.1.4 release preparation

The user subsequently requested commit/push and chose version `0.1.4`. CLI, MCP, package/lockfile and all three plugin metadata versions are aligned. Installation documents and [candidate release notes](../../release/0.1.4.md) identify publication as a separate pending operation.

`npm run check` passed again with **608 tests in 41 files**; package verification passed with **210 files** and no runtime install scripts. Candidate PTY qualification passed twice with **84 source + 84 offline-installed checks** after correcting the fixture's `Setting` header wait, which had incorrectly matched the `Settings` sidebar and raced an atomic configuration write. This changes only fixture synchronization, not runtime behavior. The clean-commit release verifier is run before push; no npm publication or release tag is part of this preparation.

## References

- [Spec](spec.md)
- [Runtime request/result projection and API evidence](runtime-contract.md)
- [ADR 0019](../../docs/adr/accepted/0019-optional-weknora-managed-connection.md)
- [Setup issue](issues/03-setup-connection.md)
- [Managed retrieval issue](issues/04-managed-retrieval.md)
- [Latest user correction: no extra WeKnora IP policy](issues/06-remove-extra-ip-policy.md)
