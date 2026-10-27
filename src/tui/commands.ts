/**
 * Command executors: the only place the workbench writes to disk. Every op
 * delegates to the audited manage.ts APIs (which take their own file locks and
 * emit only "Setup:"-prefixed safe messages). Raw secrets pass through here
 * but are never echoed into results, status, or diagnostics (ADR 0016).
 */
import {
  addSetupKey, removeSetupKey, replaceSetupKey, setSetupKeyEnabled,
  setSetupLanguage, setSetupProviderEnabled, setSetupProviderOrder,
  updateSetupInstance, removeSetupInstance, saveWeknoraConnection,
} from "../config/manage.js";
import { addSearxngInstance, loadConfig } from "../config/store.js";
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
      case "addInstance": {
        // store-level add throws unprefixed safe literals; only these two pass the suppression wall
        try { await addSearxngInstance(paths.config, op.baseUrl, op.allowRanges); return { ok: true }; }
        catch (e) {
          const m = e instanceof Error ? e.message : "";
          if (m === "Invalid SearXNG endpoint or CIDR configuration." || m === "SearXNG instance is already configured; permissions were not changed.") return { ok: false, reason: m };
          throw e;
        }
      }
      case "editInstance": await updateSetupInstance(paths, op.oldBaseUrl, op.baseUrl, op.allowRanges); return { ok: true };
      case "removeInstance": await removeSetupInstance(paths, op.baseUrl); return { ok: true };
      case "wekSave": {
        const config = await loadConfig(paths.config);
        const conn = config.connections?.weknora as { baseUrl: string; defaultKnowledgeBaseId?: string } | undefined;
        if (op.field === "url") {
          await saveWeknoraConnection(paths, { baseUrl: op.value }, op.secret, { reuseSavedKey: op.reuseSavedKey, replaceSavedKey: op.secret !== undefined }, environment);
          return { ok: true };
        }
        if (!conn) return { ok: false, reason: "WeKnora is not configured yet; set the API root first." };
        if (op.field === "key") {
          await saveWeknoraConnection(paths, { baseUrl: conn.baseUrl, ...(conn.defaultKnowledgeBaseId ? { defaultKnowledgeBaseId: conn.defaultKnowledgeBaseId } : {}) }, op.value, { reuseSavedKey: true, replaceSavedKey: true }, environment);
          return { ok: true };
        }
        await saveWeknoraConnection(paths, { baseUrl: conn.baseUrl, ...(op.value ? { defaultKnowledgeBaseId: op.value } : {}) }, undefined, { reuseSavedKey: true }, environment);
        return { ok: true };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected error";
    // manage.ts guarantees Setup-prefixed bodies are safe; suppress anything else entirely.
    const reason = message.startsWith("Setup:") ? message.slice("Setup:".length).trim() : "unexpected error (details suppressed)";
    return { ok: false, reason };
  }
}
