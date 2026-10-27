/**
 * Anti-corruption layer over the TUI engine (ADR 0023).
 *
 * This is the ONLY module in the repository allowed to import
 * `@earendil-works/pi-tui`. Everything else consumes engine primitives,
 * key matching, and width measurement through these named re-exports, so a
 * future engine swap or version bump touches exactly one file.
 */
export {
  Box,
  HStack,
  Input,
  Key,
  matchesKey,
  ProcessTerminal,
  SelectList,
  Text,
  TruncatedText,
  TuiAltScreen,
  VStack,
  truncateToWidth,
  visibleWidth,
  type Component,
  type KeyId,
  type OverlayHandle,
  type SelectItem,
  type SelectListTheme,
  type StackEntry,
  type TuiAltScreenOptions,
  type TuiInputListener,
  type TuiInputListenerResult,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

/**
 * Width-safety rule (ADR 0024 item 2): self-drawn UI strings must not contain
 * East-Asian-Ambiguous symbols, because CJK-locale terminals may render them
 * double-width while the engine counts them single-width, breaking column
 * alignment. Box-drawing borders and full-width CJK punctuation are whitelisted
 * (the engine measures them the same way mainstream terminals draw them).
 */
export const FORBIDDEN_GLYPHS = /[✓✗•…⋯⏸→·—]/u;

/** Throws with the offending character so tests and dev builds fail fast. */
export function assertWidthSafe(text: string, source: string): void {
  const match = FORBIDDEN_GLYPHS.exec(text);
  if (match) throw new Error(`Width-ambiguous glyph ${JSON.stringify(match[0])} in ${source} (ADR 0024: use ASCII symbols)`);
}
