/**
 * Command executors: the only place the workbench writes to disk. Every op
 * delegates to the audited manage.ts APIs (which take their own file locks and
 * emit only "Setup:"-prefixed safe messages). Raw secrets pass through here
 * but are never echoed into results, status, or diagnostics (ADR 0016).
 */
import {
  addSetupKey, removeSetupKey, replaceSetupKey, setSetupKeyEnabled,
  setSetupLanguage, setSetupProviderEnabled, setSetupProviderOrder,
  updateSetupInstance, removeSetupInstance, saveWeknoraConnection, removeWeknoraConnection, saveUseGptKey, removeConnectionKey,
} from "../config/manage.js";
import { addSearxngInstance, loadConfig } from "../config/store.js";
import { saveUseGptConfig, removeUseGptConfig } from "../config/usegpt.js";
import { UseGptConfigSchema, USEGPT_API_KEY_VARIABLE } from "../config/schema.js";
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
          await saveWeknoraConnection(paths, { baseUrl: op.value }, op.secret, { reuseSavedKey: op.reuseSavedKey, replaceSavedKey: op.replaceSavedKey === true }, environment);
          return { ok: true };
        }
        if (!conn) return { ok: false, reason: "WeKnora is not configured yet; set the API root first." };
        if (op.field === "key") {
          await saveWeknoraConnection(paths, { baseUrl: conn.baseUrl, ...(conn.defaultKnowledgeBaseId ? { defaultKnowledgeBaseId: conn.defaultKnowledgeBaseId } : {}) }, op.value, { reuseSavedKey: true, replaceSavedKey: op.replaceSavedKey === true }, environment);
          return { ok: true };
        }
        await saveWeknoraConnection(paths, { baseUrl: conn.baseUrl, ...(op.value ? { defaultKnowledgeBaseId: op.value } : {}) }, undefined, { reuseSavedKey: true }, environment);
        return { ok: true };
      }
      case "wekRemove": await removeWeknoraConnection(paths); return { ok: true };
      case "usegptSave": {
        const config = await loadConfig(paths.config);
        const saved = config.connections?.usegpt;
        // same field set as the retired v1 shell: legacy CDP keys are dropped on save
        const parsed = UseGptConfigSchema.safeParse({
          enabled: saved?.enabled ?? true,
          tunnelId: op.field === "tunnelId" ? op.value : saved?.tunnelId,
          dataDir: op.field === "dataDir" ? op.value : saved?.dataDir,
          apiKeyRef: `env:${USEGPT_API_KEY_VARIABLE}`,
        });
        if (!parsed.success) return { ok: false, reason: "Use a tunnel_ ID and an absolute local data directory." };
        await saveUseGptConfig(paths, parsed.data);
        return { ok: true };
      }
      case "wekKeyRemove": await removeConnectionKey(paths, "weknora", environment); return { ok: true };
      case "usegptKeyRemove": await removeConnectionKey(paths, "usegpt", environment); return { ok: true };
      case "usegptKey": await saveUseGptKey(paths, op.secret, op.replaceSavedKey === true, environment); return { ok: true };
      case "usegptUnlink": await removeUseGptConfig(paths); return { ok: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected error";
    // manage.ts guarantees Setup-prefixed bodies are safe; suppress anything else entirely.
    const reason = message.startsWith("Setup:") ? message.slice("Setup:".length).trim() : "unexpected error (details suppressed)";
    return { ok: false, reason };
  }
}
