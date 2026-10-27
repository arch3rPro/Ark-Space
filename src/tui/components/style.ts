/**
 * Shared terminal styling + width-safe text helpers.
 * Colors are raw SGR on purpose: engine styleText requires parseColor() named
 * colors, which adds no value here (prototype finding, see .scratch/tui-prototype/README.md).
 */
import { visibleWidth } from "../port.js";

export const noColor = () => Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;
export const c = (code: string | number, s: string) => (noColor() ? s : `\u001b[${code}m${s}\u001b[0m`);
export const DIM = (s: string) => c(2, s);
export const FG = (n: string | number, s: string) => c(n, s);
export const SEL = (s: string) => c("30;46;1", s);

/** ANSI/CJK-aware right padding. padEnd() miscounts both escape bytes and wide chars. */
export function padV(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - visibleWidth(s)));
}
