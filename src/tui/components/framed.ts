/**
 * Rounded-border panel (ADR 0024 item 1): the engine gives ordinary components
 * only a width in render(width), so framed panels must be padded/clipped to an
 * externally computed fixed height or borders jump between states.
 */
import { padV, c } from "./style.js";
import { visibleWidth, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "../port.js";

export class Framed implements Component {
  private h = 0;
  constructor(private child: Component, private title: string | (() => string), private focusFn?: () => boolean) {}

  setH(h: number): void { this.h = h; }
  invalidate(): void { this.child.invalidate?.(); }
  handleInput(data: string): void { this.child.handleInput?.(data); }
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return this.child.handleMouse?.(event.y >= 1 ? { ...event, y: event.y - 1 } : event);
  }

  render(width: number): string[] {
    const frame = this.focusFn?.() ? "36" : 90; // the border answers "where do my arrows act" (P6.2)
    const t = typeof this.title === "function" ? this.title() : this.title;
    const head = t ? `─ ${t} ` : "─";
    const out = [c(frame, "╭" + head + "─".repeat(Math.max(0, width - visibleWidth(head) - 2)) + "╮")];
    let inner = this.child.render(width - 4);
    if (this.h >= 3) {
      const need = this.h - 2;
      inner = inner.slice(0, need);
      while (inner.length < need) inner.push("");
    }
    for (const line of inner) out.push(c(frame, "│") + " " + padV(line, width - 4) + " " + c(frame, "│"));
    out.push(c(frame, "╰" + "─".repeat(width - 2) + "╯"));
    return out;
  }
}
