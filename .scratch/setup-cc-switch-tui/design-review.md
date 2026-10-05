# Setup TUI — approved three-axis redesign

## Status

**Historical baseline, superseded:** following the user's explicit rejection of incremental changes, the whole browse/render/controller model was rewritten. Current Top/Menu/Content focus, row-intent contract and evidence are recorded in [ADR 0017](../../docs/adr/accepted/0017-workbench-modal-setup.md) and [the whole-rebuild report](../setup-tui-rebuild/report.md). The old two-focus/presentation-only top strip below is not the current design.

The user rejected the previous refactor's layout and operation model, then approved this redesigned structure and operation flow with “同意 继续”. Implementation is authorized and now verified in unreleased source; see [report.md](report.md) for fresh 379-test and source/installed 106-assertion evidence. The two unfinished edits made before that pause were precisely removed, retaining all preceding uncommitted work; type checking passed after cleanup. The previously built UI is not claimed to satisfy this design.

Reference: read-only `reference/cc-switch-cli`, upstream https://github.com/SaladDay/cc-switch-cli, revision `b563ce17fdcc5316701ee8ba00368bdeb24b929a`, MIT. This review uses actual source and repository screenshots, not an executed/human-qualified reference application. No imported code/assets.

## 1. Root misunderstanding

The previous UI merged two independent choices into one six-item sidebar. That was structurally wrong even after adding borders and tables.

Correct model:

- Top: working context — ArkSpace provider Exa/Tavily/Firecrawl/SearXNG.
- Left: functional menu, independent of provider.
- Right: the selected function's route and interaction mode, in the current provider context when applicable.

The reference's top labels are application types, not its provider records. ArkSpace borrows the layout/context relationship, rather than copying those domain objects. Search order and language remain global; changing top provider must never create provider-specific copies of them.

## 2. Verified reference behavior

Paths below are relative to `reference/cc-switch-cli/src-tauri/src/cli/tui/`.

| Evidence | Actual behavior |
| --- | --- |
| `ui.rs:render`, `ui/chrome.rs:render_header`, `render_nav` | Header/context strip, functional navigation, right content; independent application type, nav cursor and route. |
| `ui.rs:render_content` | Editor/form replaces right content before the route body; editing is not just another old toolbar focus. |
| `app/menu.rs:on_nav_key` | Up/Down selects menu cursor; Enter opens its route. |
| `app/menu.rs:on_key_after_clamp` | Browse Left/Right changes Menu/Content focus; `[`/`]` changes upper context. Generic Tab is not a four-region main loop. |
| Same function | Overlay → editor → form → filter takes priority over normal globals; context switching cannot steal text/edit input. |
| `keymap.rs:providers::BINDINGS`, `app/content_entities.rs:on_providers_key` | Current source Enter/e edits an editable selected row. README switch screenshot's Enter-details label is historical and cannot override source. |
| `app/form_handlers/provider.rs:handle_provider_field_editing` | Field Enter commits to the in-memory draft; Esc restores that field's pre-edit value. Neither is disk save. |
| `app/form_handlers/mod.rs:on_form_key` | Ctrl-S commits active field then validates/saves the whole draft. |
| `app/menu.rs:on_back_key` | Route-history return differs from moving focus left. Root exit is an explicit operation. |
| `ui/shared.rs:pane_border_style`, `selection_style` | Focused pane border, full-row selection and current/effective markers have separate meanings. |

The reference's Y/N and Enter-accept confirmations are intentionally not adopted. ArkSpace retains action-specific confirmations initially focused on Cancel.

## 3. Menu decision

User selected candidate A: Provider management / Configuration / Settings / Exit. The complete design was subsequently approved for implementation.

**A — reference-like functional grouping:** Provider management / Configuration / Settings / Exit.

- Provider management: selected top provider's existing keys or SearXNG instances, state controls and confirmed live test.
- Configuration: existing global search-order draft, no invented additional configuration.
- Settings: existing global setup language, no speculative themes/dashboard.
- Exit: an action, never a blank page.

**B — directly named functions:** Provider management / Search order / Language / Exit.

Same scope, less grouping. No Home or copied statistics dashboard is proposed because no concrete ArkSpace consumer/content has been established.

## 4. Proposed interaction model

### Browse

Only two main focus regions: Menu and Content. The top strip displays current provider but is not another mandatory Tab stop.

- `[`/`]`: switch provider outside modal/editor/input/busy states. Preserve per-provider object selection and the chosen functional menu. Do not enable, change routing or send requests.
- Up/Down: select menu item or resource row in the active pane.
- Left: Content → Menu; Right: Menu → Content where the page has usable content. This is pane movement, not an alias for row movement.
- Enter in Menu opens the function.
- Page-local keycaps advertise real, applicable operations: a Add, e Edit/Replace, p Preview, d Remove, t Test, ? Help. Do not reproduce reference operations whose domain meaning does not exist in ArkSpace.
- Unavailable operations are gray, keep their reason and revalidate through existing guards.
- A pending menu cursor, the opened menu, selected provider, selected row and enabled state remain distinct.

### Two candidate row-entry policies

1. **Reference-first:** row Enter/e opens an edit draft; i opens metadata/details; p opens the existing secure preview. Enter alone never persists. Read-only rows refuse edit with a reason. Empty lists offer explicit Add rather than importing unrelated live configuration.
2. **Details-first:** row Enter opens metadata/details; e explicitly edits. This is an intentional ArkSpace deviation, not a claim about reference source.

User selected policy 1, reference-first Enter/e editing. It is the approved implementation baseline.

### Edit

The form takes the right content area; top and menu remain visible but cannot switch context while editing. It is not a centered one-line prompt sitting on the old navigation model.

- Selected field → Enter starts field editing.
- Text and Left/Right edit the field. `[`, `]`, `?`, q and Y/N are literal text while editing.
- Field Enter commits only to the in-memory form draft; field Esc restores that field's pre-edit value.
- Ctrl-S validates the whole draft and starts its existing save/confirmation path. It does not bypass replacement, private-CIDR or routing consent.
- Explicit Save/Cancel controls remain discoverable; horizontal arrows apply only when the button group owns focus.
- Form exit with changes asks Cancel/Discard (default Cancel), rather than silently destroying input.
- Add/Replace key values remain masked with live grapheme count and caret. Replacing a key never auto-loads/reveals its old value into the editable field.
- SearXNG uses URL/CIDR fields, no key or per-instance enable switch.

### Confirm, preview and busy

- Confirm: default Cancel; Enter executes only the selected button, Left/Right selects actions, Esc cancels. Y/N does nothing.
- Preview: default masked/source/length; explicit Show full/Hide/Close. It is read-only and ephemeral. Close/back/tiny resize clear disclosure as already required.
- Busy: only cancellation/help as applicable; no provider/menu mutation. Existing deadline/signal/cleanup semantics remain unchanged.

## 5. Layout sketches

These are structural sketches, not screenshots or pixel/font qualification. Menu names are candidate A.

### Main

```text
┌ ArkSpace ───── [Exa]  Tavily  Firecrawl  SearXNG ──────────┐
├ Menu ───────────┬ Exa / Provider management ──────────────┤
│ >*Providers     │ a Add  e Edit  p Preview  d Remove  ?   │
│   Configuration │ Reference          Source       State  │
│   Settings      │ > EXA_API_KEY_1    Local        Enabled│
│   Exit          │   EXA_API_KEY_2    Environment  Disabled│
│                 │                                        │
│                 │ [Provider On]    [Test connection]      │
├─────────────────┴────────────────────────────────────────┤
│ ←/→ Menu/Content · ↑/↓ select · [ and ] provider · Esc back│
└──────────────────────────────────────────────────────────┘
```

The actual top-context key bindings are `[` and `]`; no slash-filter operation is proposed.

### Right-content edit mode

```text
┌ ArkSpace ───── [Exa]  Tavily  Firecrawl  SearXNG ──────────┐
├ Menu ───────────┬ Exa / Replace key · unsaved ────────────┤
│  *Providers     │ Target: EXA_API_KEY_1                    │
│   Configuration │ Field              Draft value         │
│   Settings      │ > API key          ******** · 8 chars  │
│   Exit          │                                        │
│ (context locked)│ Plaintext warning / path / official URL│
│                 │ [Cancel]                  [Save]        │
├─────────────────┴────────────────────────────────────────┤
│ Enter edit/commit field · Esc undo field · Ctrl-S save     │
└──────────────────────────────────────────────────────────┘
```

### Action-specific confirmation

```text
┌ Replace Exa key ─────────────────────────────────────────┐
│ Replace the local credential referenced by EXA_API_KEY_1?│
│ No key value is shown. Ownership/shared guards apply.    │
│                                                        │
│                 >[Cancel]<          [Replace]           │
└────────────────────────────────────────────────────────┘
```

Reference-style focused borders/rows and compact keycaps do not change any of these operation meanings. Actual dimensions, compact-mode layout and palette must be reviewed with these flows, not decided independently and then bolted onto old code.

## 6. Approved acceptance scenarios

The user settled the two choices and approved the complete design for implementation: reference-like functional grouping and reference-first Enter/e draft editing. The following scenarios govern verification:

1. Open Exa management; select an existing key.
2. Switch Tavily with top-context keys; return Exa and recover the selected key.
3. Start replacement; edit a field; cancel just that edit; save or cancel the form; confirm initially Cancel.
4. Preview with masked default; reveal only explicitly; leave without mutation/disclosure retention.
5. Enter global order; modify draft; change top context without duplicating/resetting the global draft; explicitly save with routing consent.
6. Test connection only after network consent; interrupt and verify cleanup.
7. Repeat at compact/undersized dimensions with no invisible action or accidental save.

Implementation may proceed under the user's approval, preserving the stated safety boundaries. The earlier 355 tests/168 PTY assertions qualify the previous code's tested behavior, not this proposal or user satisfaction.
