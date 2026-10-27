/**
 * Command executors: the only place the workbench writes to disk. Every op
 * delegates to the audited manage.ts APIs (which take their own file locks and
 * emit only "Setup:"-prefixed safe messages). Raw secrets pass through here
 * but are never echoed into results, status, or diagnostics (ADR 0016).
 */
import {
  addSetupKey, removeSetupKey, replaceSetupKey, setSetupKeyEnabled,
  setSetupLanguage, setSetupProviderEnabled, setSetupProviderOrder,
} from "../config/manage.js";
import type { ArkSpacePaths } from "../config/paths.js";
import type { Op } from "./controller.js";

export type OpResult = { ok: true; detail?: string } | { ok: false; reason: string };

export async function runOp(paths: ArkSpacePaths, environment: NodeJS.ProcessEnv, op: Op): Promise<OpResult> {
  try {
    switch (op.kind) {
      case "addKey": return { ok: true, detail: await addSetupKey(paths, op.provider, op.secret, environment) };
      case "replaceKey": await replaceSetupKey(paths, op.provider, op.reference, op.secret, environment); return { ok: true };
      case "removeKey": await removeSetupKey(paths, op.provider, op.reference); return { ok: true };
      case "toggleKey": await setSetupKeyEnabled(paths, op.provider, op.reference, op.enabled); return { ok: true };
      case "toggleProvider": await setSetupProviderEnabled(paths, op.provider, op.enabled); return { ok: true };
      case "saveOrder": await setSetupProviderOrder(paths, op.order); return { ok: true };
      case "setLanguage": await setSetupLanguage(paths, op.lang); return { ok: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected error";
    // manage.ts guarantees Setup-prefixed bodies are safe; suppress anything else entirely.
    const reason = message.startsWith("Setup:") ? message.slice("Setup:".length).trim() : "unexpected error (details suppressed)";
    return { ok: false, reason };
  }
}
