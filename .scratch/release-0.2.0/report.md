# ArkSpace 0.2.0 preparation

Status: local release preparation verified; publication is not authorized. A clean reviewed preparation commit must pass the final release gate. Its result and commit identity are recorded locally in `release/artifacts/0.2.0-preparation.json` after that commit, avoiding a self-referential commit hash in this report.

## Authorized scope

The user selected version **0.2.0**, a concise CHANGELOG linked to detailed version notes, and **preparation plus local commit only**. No push, tag, npm publication, GitHub Release, host CLI installation, global package replacement, credential change, or personal configuration migration is included.

## Progress and document ownership

- `ROADMAP.md`: current implementation, scoped evidence, next acceptance gates, and non-committed exploration.
- `CHANGELOG.md`: concise chronological ledger, with npm publication dates and links instead of a second detailed change list.
- `release/<version>.md`: version changes, upgrades, verification evidence and limits. Missing 0.1.6/0.1.7 history is represented by bounded factual records, not an invented change list.
- `docs/migration.md`: historical migration context and replacement cutover gates, not the current implementation backlog.
- English/Chinese README, installation, architecture and maintenance guidance now use the same inventory and release status.

The current inventory has ten canonical Skills, six Setup menu entries, and seven service contexts. Search Order remains a pseudo-context, not an eighth service.

## Published baseline verified read-only

On 2026-11-06, the official npm registry reported latest **0.1.7**; 0.1.5, 0.1.6 and 0.1.7 are all already published. Both 0.1.6 and 0.1.7 record `gitHead` `5d0f5873d9dd4809453449e8ae6a746c11dfaf11`, an ancestor of the current source. Their package engines require Node `>=20.0.0`.

GitHub's latest found Release/tag was **v0.1.5**, published 2026-10-12, with peeled commit `70c72012e6b47e904f36b7da5efd70cf08edd55b`. No corresponding 0.1.6/0.1.7 tag or GitHub Release was found. The 0.1.5 note now records publication and excludes the later pi-tui / Node 22 changes.

Version 0.2.0 requires **Node >=22.19.0**. CLI, MCP server, package, both root lockfile versions, three plugin version fields and the versioned entry-check expectations were aligned. Dependency declarations and locked dependency entries did not change.

## Validation results

Environment: Linux x64, Node.js **24.21.0**.

| Check | Result |
| --- | --- |
| `npm run check` | **60 files, 706 tests passed**; includes project validation and typecheck |
| `npm run test:setup` | **113 source + 113 offline-installed PTY checks passed**; non-TTY output byte-locked |
| `npm run generate:schemas` and schema diff | Passed, no generated-schema drift |
| `npm run verify:package` | Passed: **327 files, 422,607 packed bytes**, no runtime lifecycle scripts |
| Versioned host / PTY script syntax | Passed |
| Active LSP diagnostics | Three changed TypeScript files checked, zero diagnostics |
| Documentation and whitespace | 156 local links across 13 changed/new Markdown files resolved; no undefined footnotes; `git diff --check` passed |
| Exact artifact installation smoke | Passed offline in a temporary prefix with isolated HOME, config and empty npm cache, using local runtime dependency tarballs and denied lifecycle scripts |
| Installed CLI / MCP | Both report **0.2.0**; MCP lists **77 tools**, including Web, X and UseGPT; installed X validation returns a safe confirmation-required failure without a remote call |
| `npm run test:hosts` | Not run: Claude Code and Codex CLIs are absent; no installation was attempted |
| Clean-commit `npm run verify:release` | Run after the preparation commit; final receipt is local under `release/artifacts/` |

The initial full run found one obsolete updater-test assumption: it expected 0.1.10 to be newer than the new 0.2.0 runtime. Runtime behavior was correct. The regression now verifies refusal to downgrade to 0.1.10 and numeric comparison with a higher minor version. Four focused cases and the subsequent complete 706-test run passed; runtime updater logic was not changed.

The first ad-hoc MCP installation probe omitted the documented initialization step and used an empty home. Repeating it after isolated non-TTY `setup` established the correct precondition; the source and exact installed package then initialized MCP with version 0.2.0. This required no product-code change or user configuration access.

Prior real-service evidence is reused at its original scope: `.scratch/x-search/report.md` records four X capability reads plus one thread continuation page, all successful, without a live poll or truncation sample. `docs/usegpt-native-file-acceptance.md` records verified CSV/PNG persistence with explicit host-side and format limits. No fresh paid Provider calls were made for release preparation.

## Local candidate artifact

- File: `release/artifacts/arkspace-cli-0.2.0.tgz`
- Bytes: **422607**
- Files: **327**
- SHA-256: `9979ed557dfd94d1fcb22aecfadd02db289109465d84bd4732abd93519cf567c`
- All ten canonical Skill entry files and 0.2.0 plugin metadata are present; the packed CLI mode is `0755`.
- Development/private paths (`src`, tests, docs, `.scratch`, release records) are not packed.
- Artifact metadata, installed smoke results and checksum file are ignored local files under `release/artifacts/`; raw check logs are ignored `.log` files in this report directory. They are not published assets or public download URLs.

## Remaining gates and risks

The prepared local artifact is not a blanket platform or host qualification. Hosted Windows/macOS, additional architectures and Node-version matrices, real Claude Code/Codex discovery, human terminal usability, real registry update installation, broader Skill activation, and credentialed Provider/research lifecycle and quality acceptance remain incomplete. Earlier 0.1 post-release arrangements are not automatically treated as a 0.2.0 waiver.

The Nitter instance used in earlier live checks uses HTTP and returns a plaintext-transport warning. No endpoint or token was changed to hide that risk. Replacement cutover remains blocked by the migration gates.

Actual publication requires separate user authorization, a passing clean-commit gate on the reviewed commit, artifact identity verification, and explicit review of these remaining limits. This preparation performs none of the public release actions.
