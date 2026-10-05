# cc-switch-inspired setup TUI

## Task and completion

User authorizes refactoring ArkSpace setup using the interaction, layout, colors, and operations of the read-only `reference/cc-switch-cli`. Complete means a real native renderer/controller through `arks setup`, preserving backend/security behavior, passing current tests and owned Linux PTY checks through source and an offline installation. Human usability, actual Windows/macOS terminals, and real services remain separate qualification.

## Reference evidence

Upstream https://github.com/SaladDay/cc-switch-cli; revision `b563ce17fdcc5316701ee8ba00368bdeb24b929a`; MIT, copyright 2025 Jason Young and 2025 saladday. Source and screenshots only; application not executed. Imported source/assets: none. See ../../NOTICE.md.

Actual source landmarks under `src-tauri/src/cli/tui/`:

- `ui.rs:77`: bordered three-line header, fixed left navigation, right routed content, global footer.
- `ui/shared.rs:4,14,473,1023`: focus borders, full-row selection, page frame with compact key bar, whole-item shortcut fitting.
- `ui/providers.rs:143`: full-width Provider table, separate current marker and selected row; not a permanent right details pane.
- `ui/forms/provider.rs:363`: field/value form occupying content; generic JSON preview is not needed in ArkSpace.
- `app/menu.rs:733,930,1079`: contextual navigation, route return, help, guards. Its main-pane directional aliases and navigation activation are not copied because ArkSpace retains distinct list/button/field axes.
- `ui/overlay/basic.rs:41` and `app/overlay_handlers/dialogs.rs:77`: reference Enter/Y confirmation differs from ArkSpace; do not adopt unsafe Enter-default acceptance.

## Adopted concrete changes

- Unified fine-line bordered header/navigation/content, highlighted active pane, clean spacing; retain Exa/Tavily/Firecrawl/SearXNG/Search order/Language only, no new dashboard or intermediate Manage page.
- Right page has title, compact contextual action/keycap bar, separate supplier control area, full-width object table with actual columns (reference or URL, source, state). Do not parse translated row text into columns.
- Full-row selection distinct from enabled status. Unfocused remembered selections do not masquerade as active controls. States retain textual labels and semantic colors; unavailable actions stay gray without `×` and keep reasons.
- Fit whole action/keycap items rather than clipping the active action label; include a compact more/help indication and contextual `?` help. Keep `!` retained diagnostics.
- Reference-inspired field/value forms and single-line border/modal styling; preserve direct secure editing and default-Cancel action-button confirmations rather than the reference's Y/N or raw key previews.
- Navigation arrows select a sidebar cursor without immediately replacing the open content; Enter opens the selected destination. Keep the opened-page marker distinct from the cursor. Esc from content returns the cursor to its open destination. Keep current Tab region cycle, vertical lists, horizontal button/caret axes, Esc modal→navigation→root exit, Home/End/PageUp/PageDown and Ctrl-C. Add only genuinely useful contextual shortcuts/help, guarded at dispatch. Never use q as text-field exit.
- Keep 80×24 wide / 60×16 compact / smaller blocked-action behavior, cursor-cell geometry and metadata sanitization. No dependencies, theme configuration, schema/protocol/state/backend change, version bump or global install.

## Security regressions to retain

Live star/grapheme counts and caret; no raw entry echo. Existing-key preview defaults masked, has explicit Show/Hide/Close, resets disclosure after tiny resize, labels stored/effective environment values and writes nothing. Owned/shared/environment guards, independent Provider enabled/order, narrow CIDR consent, offline opening, explicit bounded live tests, partial-save honesty, cancellation and terminal restoration remain mandatory.

## Evidence

All earlier 344-test/143-PTY results describe the previous layout, not this refactor. Fresh checks must record table/headings, pane borders and active selection, full visible focused actions on narrow screens, contextual help and return behavior, existing safety scenarios, and independent column-width assertions. No captured real credentials.
