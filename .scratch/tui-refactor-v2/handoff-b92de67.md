# UseGPT Artifact Hub — continuation handoff

## Current focus
The next session should continue implementation and integration of the UseGPT Artifact Hub workflow. The intended user-facing flow is:

```text
arks setup usegpt
→ configure Tunnel ID, data directory, and protected API-key reference
→ start Hub + Secure MCP Tunnel from setup (background)
→ ChatGPT publishes Project/Task Artifacts through native MCP/App + Secure MCP Tunnel
→ Agent Skill discovers and reads a fixed Artifact revision
→ optional Agent Handoff/worker creates a new Artifact
→ diagnose configuration/services when something fails
```

The user specifically wants ordinary users and Agents to have an obvious setup flow, not manual terminal babysitting.

## Repository and branch
- Working repository: `/root/Code/Ark-Space-usegpt-artifact-hub`
- Active branch: `experiment/usegpt-artifact-hub`
- Current HEAD: `b92de67 fix: expose UseGPT service controls in setup`
- The current worktree has only two untracked user scratch directories; do not delete or modify them:
  - `.scratch/tui-prototype/`
  - `.scratch/tui-refactor-v2/`
- Remaining Git branches are `experiment/usegpt-artifact-hub` and `main`.
- Intermediate branches `experiment/usegpt-secure-mcp` and `feat/usegpt-cdp` were deleted.
- The old `/root/Code/Ark-Space` worktree was reset to its committed detached HEAD and its untracked/modified CDP experiment files were deliberately cleaned. The old committed CDP snapshot remains only as a detached worktree because its shared `.git` directory is used by all worktrees.
- The global `/usr/bin/arks` still points to `/root/Code/Ark-Space/dist/cli/main.js`, not this Artifact Hub worktree. Do not replace it or publish/install globally without explicit user approval.

## Implemented work
The main implementation is already recorded in the recent commits; inspect those commits instead of duplicating their details:

- `3fe55bb` — complete Artifact exchange loop
- `15d36d1` — fenced worker and fixed-file verification
- `58b365a` — native ChatGPT file acceptance evidence
- `ce76616` — real Pi worker adapter and handoff execution path
- `9d0e769` — background Tunnel start/status/stop and package-safe Tunnel service
- `91fb971` — UseGPT workflow documentation and diagnostics
- `b92de67` — visible Setup controls for service status/start/stop

Important source/reference paths:

- `skills/UseGPT/SKILL.md`
- `skills/UseGPT/references/operations.md`
- `src/usegpt/services.ts`
- `src/cli/setup-usegpt.ts`
- `src/cli/setup-workbench.ts`
- `src/cli/main.ts`
- `docs/usegpt-worker.md`
- `docs/usegpt-native-file-acceptance.md`
- `docs/usegpt-artifact-hub.md`
- `docs/usegpt-artifact-hub-implementation.md`
- `docs/architecture.md`
- `README.md`, `INSTALL.md`

## User-facing commands now intended
After the current branch is built/used directly:

```bash
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js setup usegpt --lang zh
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js setup usegpt --start
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js usegpt diagnose --json
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js usegpt daemon status
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js usegpt tunnel status
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js usegpt tunnel stop
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js usegpt artifact read <artifact-id> --revision <revision> --json
node /root/Code/Ark-Space-usegpt-artifact-hub/dist/cli/main.js usegpt artifact export <artifact-id> --revision <revision> --output-dir /tmp/usegpt-export --json
```

The Setup UseGPT page now displays separate rows for service status, start services, and stop services. It uses confirmation for start/stop and keeps services detached so the terminal can close.

## Verification already performed
- Full suite passed after the Setup controls were added: **58 test files, 774 tests**.
- `npm run validate` passed.
- `npm run typecheck` passed.
- `npm run verify:package` passed.
- `arks usegpt diagnose --json` was tested against the real local configuration and reported configuration, Hub, and Tunnel running. No credentials were printed.
- Built `usegpt artifact export` successfully exported and independently verified a real PNG fixed revision (size and SHA-256 matched metadata).
- Real ChatGPT acceptance evidence for Markdown, CSV, and PNG is documented in `docs/usegpt-native-file-acceptance.md`; do not claim fixtures alone prove ChatGPT behavior.

## Known incomplete / follow-up work
1. **Real Pi Worker Handoff needs repair and re-verification.**
   - A real Handoff created during the latest user test was claimed but the Pi adapter returned only `Pi adapter failed.`
   - The worker correctly recorded the result as `unknown` and did not automatically replay it. Do not replay that claimed Handoff without explicit reconciliation.
   - An independent Pi one-shot connectivity probe succeeded, so the failure is likely in the worker/adapter execution path or its isolated environment, not basic Pi availability.
   - Inspect the protected recovery directory only locally; never print credentials or full private artifact contents.
   - Existing adapter: `scripts/usegpt-pi-adapter.mjs`; worker: `src/usegpt/worker.ts`; recovery records are under the configured Hub data directory `.worker/<handoff-id>/`.

2. **Global installation/main integration is not done.**
   - The current branch has the implementation, but `/usr/bin/arks` still resolves to the old `/root/Code/Ark-Space` checkout.
   - Do not change global installation, versions, or MCP registration unless the user explicitly asks.
   - A future release/integration task should decide whether to merge this branch into `main` or install from this branch, then update docs consistently.

3. **Automatic boot restart is not implemented.**
   - Hub and Tunnel are background processes after `start`, but they are not registered with systemd/launchd/Windows Service and will not automatically restart after reboot.

4. **Binary Artifact input to worker is still limited.**
   - The worker input package currently supports text Artifact contents; binary Artifacts are stored/exportable but are not yet automatically included as Agent input files.

5. **Task completion is intentionally explicit.**
   - Completing a Handoff does not automatically mark the business Task completed. Keep this safety behavior unless the user requests a different policy.

6. **Platform scope remains POSIX-oriented.**
   - Daemon/worker transport and private-permission checks are not fully implemented/validated for Windows.

## Safety constraints
- Never expose API keys, cookies, tunnel tokens, signed URLs, private artifact bodies, or Pi provider credentials.
- Do not use Chrome/CDP/browser automation; the CDP route is abandoned.
- Do not automatically retry an uncertain/claimed Handoff or worker result.
- Use fixed Artifact `artifactId + revision`; never silently substitute latest.
- Preserve user-created scratch files and unrelated worktrees.
- Follow `/root/Code/Ark-Space/AGENTS.md`, especially `docs/architecture.md`, `docs/migration.md`, and the relevant ADRs before structural changes.

## Suggested skills
The next agent should call the Skill tool for:

- `implement` — continue implementation from this handoff with tests.
- `diagnosing-bugs` — diagnose the real Pi Worker/adapter failure and its durable recovery state.
- `writing-for-agents` — modify `skills/UseGPT/SKILL.md` or its references.
- `code-review` — review the branch before merging or installing it.
- `tdd` — use if adding regression coverage for worker/Setup service controls.
- `pi-lens-lsp-navigation` — run LSP navigation/diagnostics on changed TypeScript files.

## First actions for the next session
1. Read this handoff and inspect `git status` in `/root/Code/Ark-Space-usegpt-artifact-hub`.
2. Read the latest commits and the linked UseGPT docs rather than recreating the design.
3. Diagnose the real Pi worker failure without replaying the claimed Handoff.
4. Add a focused regression test if the root cause is reproducible.
5. Run `npm run validate`, `npm run typecheck`, `npm test`, and `npm run verify:package` before claiming completion.
