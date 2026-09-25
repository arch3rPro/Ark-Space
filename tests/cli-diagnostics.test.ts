import { describe, expect, it } from "vitest";

import { buildDiagnosticPlan, renderDiagnostic } from "../src/cli/diagnostics.js";

describe("CLI diagnostic plans", () => {
  it("renders a stable stderr diagnostic without ANSI or host dependencies", () => {
    const plan = buildDiagnosticPlan("Provider API key is invalid.");

    expect(plan).toEqual({ message: "arks: Provider API key is invalid.\n", exitCode: 1 });
    expect(renderDiagnostic(plan)).toBe("arks: Provider API key is invalid.\n");
    expect(renderDiagnostic(plan)).not.toMatch(/\u001b\[/);
  });

  it("allows a successful diagnostic plan for non-failing progress", () => {
    expect(buildDiagnosticPlan("Searching…", 0)).toEqual({ message: "arks: Searching…\n", exitCode: 0 });
  });
});
