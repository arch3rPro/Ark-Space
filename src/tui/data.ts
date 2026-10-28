/**
 * Read-only data access for the workbench. Everything here re-reads disk and
 * never writes, probes, or logs secret material (ADR 0016 boundary).
 */
import { loadCredentialStore, loadCredentialEnvironment, validateCredentialValue } from "../config/credentials.js";
import { getSetupSnapshot, getWeknoraConnectionSnapshot } from "../config/manage.js";
import { loadConfig } from "../config/store.js";
import { diagnoseUseGpt } from "../usegpt/services.js";
import { USEGPT_API_KEY_VARIABLE } from "../config/schema.js";
import type { ArkSpacePaths } from "../config/paths.js";
import type { PreviewSource, UseGptStatus } from "./controller.js";
import type { WeknoraConnectionSnapshot } from "../config/manage.js";

export { getSetupSnapshot };

export interface ConnectionSnapshot { weknora: WeknoraConnectionSnapshot | null; usegpt: UseGptStatus }

/** Connection state for contexts 4/5. Reads disk + liveness signals only; never writes or probes the network. */
export async function getConnections(paths: ArkSpacePaths, environment: NodeJS.ProcessEnv): Promise<ConnectionSnapshot> {
  const [weknora, config, store, d] = await Promise.all([
    getWeknoraConnectionSnapshot(paths, environment),
    loadConfig(paths.config),
    loadCredentialStore(paths.credentials),
    diagnoseUseGpt(environment),
  ]);
  const ug = config.connections?.usegpt;
  const savedKey = store.values[USEGPT_API_KEY_VARIABLE] !== undefined;
  const external: unknown = environment[USEGPT_API_KEY_VARIABLE];
  const keySource = Object.hasOwn(environment, USEGPT_API_KEY_VARIABLE)
    ? (typeof external === "string" && validateCredentialValue(external) ? "environment" : "invalid")
    : savedKey ? "file" : "missing";
  return {
    weknora: weknora ?? null,
    usegpt: {
      configured: d.configured, daemonRunning: d.daemonRunning, tunnelRunning: d.tunnelRunning, issues: d.issues,
      tunnelId: ug?.tunnelId, dataDir: ug?.dataDir, keySource, savedKey,
    },
  };
}

export { loadCredentialEnvironment };

export type PreviewOutcome =
  | { kind: "ok"; variable: string; sources: PreviewSource[] }
  | { kind: "changed" }        // reference no longer configured -> refuse to show
  | { kind: "invalid-env" }    // environment credential present but malformed
  | { kind: "missing" };

/** Mirrors the retired workbench preview contract: refresh first, guard the reference, then read sources. */
export async function loadPreview(
  paths: ArkSpacePaths, providerId: string, reference: string, environment: NodeJS.ProcessEnv,
): Promise<PreviewOutcome> {
  const snapshot = await getSetupSnapshot(paths, environment);
  const provider = snapshot.providers.find(p => p.id === providerId);
  if (!provider || !provider.keys.some(key => key.reference === reference)) return { kind: "changed" };
  const variable = reference.slice(4); // keyRefs are always "env:NAME"
  const store = await loadCredentialStore(paths.credentials);
  const local = store.values[variable];
  const external: unknown = environment[variable];
  const sources: PreviewSource[] = [];
  if (local !== undefined) sources.push({ label: "local", value: local });
  if (Object.hasOwn(environment, variable)) {
    const valid = typeof external === "string" ? validateCredentialValue(external) : undefined;
    if (!valid) return { kind: "invalid-env" };
    sources.push({ label: local !== undefined ? "env-over" : "env", value: valid });
  }
  if (!sources.length) return { kind: "missing" };
  return { kind: "ok", variable, sources };
}
