# Workbench presentation contract on the pi-tui engine

- **Status:** accepted (2026-10-27)
- **Class:** interaction and presentation
- **Supersedes:** the engine and presentation clauses of [ADR 0017](0017-workbench-modal-setup.md). The three-axis focus model, key bindings, confirmation defaults, and all security semantics of ADR 0017 are retained unchanged; this ADR records how they are rendered.

## Context and decision

The validated prototype (`.scratch/tui-prototype/d-workbench.mjs`) froze the
interaction contract. This ADR records the implementation-level decisions that the
prototype proved and the engine forced:

1. **Fixed-height framed panels.** pi-tui gives ordinary components only a width in
   `render(width)`; allocated height is not exposed. The application therefore computes
   `H = terminalRows - 4` itself, pads/clips every framed panel to `H`, and keeps the
   strip/status/footer rows single-line truncated. Borders must never move between
   states (verified across 0-key, populated, overlay, and busy states).
2. **Width-safe text.** All column padding goes through `visibleWidth`-aware helpers.
   Self-drawn strings use only unambiguous-ASCII symbols (`+ ~ ! ? - * / ...`); the
   East-Asian-Ambiguous set (`✓ • — … ⋯ ⏸ → ·`) is banned by a deny-list assertion in
   tests. Full-width CJK punctuation and box-drawing borders stay, matching engine
   assumptions.
3. **Top axis = page-scoped tabs.** The strip follows the active page: Search
   tab-cycles Exa/Tavily/Firecrawl/SearXNG plus the search-order tab, Knowledge
   carries WeKnora, Tools carries UseGPT; pages without a group render their
   centered full name, and while the menu owns focus the full name follows the
   menu cursor. Menu arrows switch pages live (Enter only steps into content).
   Context switches never enable a provider or issue requests
   (`arks setup weknora|usegpt` still deep-links).
4. **Overlay key fence.** While a modal is open every global shortcut is suppressed;
   modals carry Cancel as the first/default item; Escape always means cancel.
5. **Focus follows component swaps.** Entering form/details/preview moves terminal
   focus to the new component; stale-focus key delivery to the previous table is a
   known prototype bug the contract forbids.
6. **Dynamic key bar.** The bottom bar renders `[key] label` sets for the current
   region/page/mode, including busy progress with Esc-stop, instead of static help text.
7. **Terminal restoration.** Alternate screen, cursor, mouse, and bracketed-paste modes
   are restored on every exit path (q, ctrl+c, error, busy-cancel), and non-TTY invocations
   never enter the alternate screen.

## Consequences

- Human UX acceptance of ADR 0017 is re-baselined against this rendering; the PTY
  qualification suite (phase P5) asserts items 1, 2, 4, 5, 7 mechanically.
- ScrollView remains the only engine component allowed to grow, and only if a future
  page genuinely needs scrolling beyond the fixed frame.
