/** Single-row component for status/footer: never wraps, so layout height is constant. */
import { truncateToWidth, type Component } from "../port.js";

export class Line implements Component {
  private s = "";
  set(text: string): void { this.s = text; }
  invalidate(): void {}
  render(width: number): string[] {
    return [truncateToWidth(this.s, width)];
  }
}
