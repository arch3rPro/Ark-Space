/**
 * Read-only data access for the workbench. Everything here re-reads disk and
 * never writes, probes, or logs secret material (ADR 0016 boundary).
 */
import { loadCredentialStore, validateCredentialValue } from "../config/credentials.js";
import { getSetupSnapshot } from "../config/manage.js";
import type { ArkSpacePaths } from "../config/paths.js";
import type { PreviewSource } from "./controller.js";

export { getSetupSnapshot };

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
