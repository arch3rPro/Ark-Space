/** A host-independent description of one CLI diagnostic. */
export interface DiagnosticPlan {
  message: string;
  exitCode: number;
}

/**
 * Builds the text that belongs on stderr. Keeping this separate from the
 * stream adapter makes diagnostics directly testable and prevents formatting
 * concerns from leaking into protocol result writers.
 */
export function buildDiagnosticPlan(message: string, exitCode = 1): DiagnosticPlan {
  return { message: `arks: ${message}\n`, exitCode };
}

export function renderDiagnostic(plan: DiagnosticPlan): string {
  return plan.message;
}
