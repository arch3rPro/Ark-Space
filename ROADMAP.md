# Roadmap

This is the single entry point for current implementation progress, evidence boundaries, and the next acceptance gates. It is a status snapshot, not a delivery schedule. No dates or additional platform commitments are implied. See [0.2.0 release details](release/0.2.0.md) for the release-specific record; the [CHANGELOG](CHANGELOG.md) remains the change ledger.

## Current state

### Implemented in the repository

- Ten canonical Skills: `askme`, `notes`, `web`, `research`, `browser`, `monitor`, `weknora`, `usegpt`, `gh-repo`, and `x-search`.
- Shared `arks` CLI / protocol boundaries for web retrieval, research, owned browser and monitor resources, managed WeKnora operations, UseGPT Artifact Hub, and X reads through a user-owned Nitter endpoint.
- Setup has six menu items (Search, Social media, Knowledge, Tools, Settings, Exit) and seven service contexts (four Web providers, WeKnora, UseGPT, Nitter). Search Order is a pseudo-context, not another service. See [INSTALL](INSTALL.md).
- Version 0.2.0 was released on 2026-11-06. Version 0.1.7 is the historical npm/source comparison baseline.

## Progress by area

| Area | Repository implementation and evidence | Next acceptance gate / limit |
| --- | --- | --- |
| Web retrieval | `web` and `code.context` operations are implemented; use capability contracts and release evidence as scoped evidence. | Credentialed live checks and host/platform qualification remain separate; no blanket live-service claim. |
| Research | `research.run` is implemented with bounded evidence handling. | Validate source-verification and skill activation with real tasks; no host-wide activation claim. |
| Browser | Owned browser operations are implemented. | Real-host workflow and cross-platform qualification remain; implementation is not end-to-end acceptance. |
| Monitor | Monitor operations are implemented. | Verify host workflows, provider lifecycle and platform behavior; do not describe it as unimplemented based on the historical migration phase. |
| Skills: `notes`, `askme`, `gh-repo` | Canonical Skills are present; `notes` has its local lint check, while `askme` is conversational guidance and `gh-repo` is bounded source research. | Verify discovery/activation on target hosts; availability in the repository is not activation evidence. |
| UseGPT | Artifact Hub and native-file flow are implemented. CSV/PNG persisted bytes were independently checked across repeated daemon boots: [acceptance evidence](docs/usegpt-native-file-acceptance.md). | Does not prove every format, host activation, installed-agent execution, or Windows support; those require separate evidence. |
| X / Nitter | Four read capabilities implemented. Targeted report records 105 tests and five live calls including thread page 2; HTTP plaintext warning retained: [report](.scratch/x-search/report.md). | Live polls (投票), exhaustive pagination, further account-limit/recovery cases, HTTPS deployment and platform qualification are not established by this run. |
| Setup | Seven service contexts under six menu items; Linux source/offline-entry PTY automation exists. | Human usability, actual external service interaction and hosted Windows/macOS terminals remain unqualified. |
| Installation / platforms | Node.js minimum is `>=22.19.0`. Release checks include 706 tests across 60 files, 113 source + 113 offline-installed Linux PTY checks, and exact-artifact CLI/MCP 0.2.0 verification with 77 tools; see [release evidence](release/0.2.0.md#release-verification). | Hosted OS and Claude Code/Codex installed-host evidence remain incomplete. No extra platform is promised. |

## Next acceptance gates

1. Publication of 0.2.0 was separately authorized; its clean-commit release gate passed on preparation commit `65867ea`. Remaining qualification gates are independent and are not evidence of publication readiness or broader acceptance.
2. Establish hosted cross-platform and installed-host evidence needed for support claims. The prior 0.1 release's post-publication qualification arrangement does not automatically waive 0.2.0 gates.
3. Perform credentialed real-service checks where applicable and report exact services and limits.
4. Verify Skill discovery/activation with real target hosts; native-file storage is not host activation evidence.
5. Keep replacement/cutover blocked until every [migration cutover gate](docs/migration.md#cutover-gates) is met, including concurrent durable state, platform installation/upgrade, exact-source plugin installation, and rollback.

## Future, non-committed exploration

Additional capabilities, providers, host/platform expansion, and broader Skill families are ideas only until separately scoped and accepted. Nothing in this section is a delivery promise.

## Ownership

This file owns the current progress summary and next gates. [Migration](docs/migration.md) owns historical migration context and replacement cutover criteria; [Architecture](docs/architecture.md) owns current system boundaries; [Maintenance](docs/maintenance.md) records document ownership. Release notes own release detail; CHANGELOG owns the chronological change ledger.
