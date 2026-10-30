# pi-tui as the Setup TUI rendering engine

- **Status:** accepted (2026-10-27)
- **Class:** dependency and architecture
- **Supersedes:** only the "no new dependency or general-purpose UI framework" clause of [ADR 0016](0016-tui-provider-setup.md). Every security, credential, confirmation, non-TTY, and terminal-restoration clause of ADR 0016 remains in force and is unchanged by this decision.

## Context and decision

ADR 0016 banned new UI dependencies on the grounds that a hand-written renderer kept
the trust surface small. Three evaluated rewrites (a zero-dependency differential
workbench, a @clack wizard, and an ink variant) were demonstrated and rejected: the
hand-rolled differential path reproduced the flicker and alignment defects it was meant
to cure, while consuming more code than it saved.

The project adopts `@earendil-works/pi-tui` (exact-pinned, MIT, three pure-JS
dependencies, Node >= 22.19) as the rendering engine for `arks setup`:

- It provides differential rendering, focus/mouse routing, overlay compositing, and
  list/input primitives that were the measured failure points of hand-written code.
- It is the engine of the pi host product already in the ArkSpace ecosystem, so
  terminal-behaviour bugs are upstream-owned and exercised daily.
- `package.json` engines rises to `>=22.19.0`. This is a breaking support change for
  Node 20/early-22 users and must be stated in release notes and `INSTALL.md`.

Containment rules (non-negotiable):

1. `src/tui/port.ts` is the only module permitted to import `@earendil-works/pi-tui`.
   All other TUI code consumes the port's re-exports and abstractions.
2. The dependency is exact-pinned with lockfile; upgrades are explicit changes.
3. Machine-readable CLI behavior (`--json`, pipes, non-TTY) must not change: the TUI
   entry stays behind a trusted-TTY guard outside `port.ts`.

## Consequences

- Rendering bugs migrate upstream; ArkSpace keeps only the layout controller and
  security semantics, which is the intended ownership split.
- A new breaking engines floor requires a documented minimum Node before release.
- Any future replacement (e.g. OpenTUI once its runtime requirements fit) touches
  only `port.ts`.
