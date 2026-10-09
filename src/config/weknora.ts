import { ProviderError } from "../errors/provider-error.js";
import { loadCredentialStore, validateCredentialValue } from "./credentials.js";
import { WeknoraConnectionSchema, WEKNORA_MANAGED_KEY_REF, type ArkSpaceConfig, type WeknoraConnection } from "./schema.js";

export interface ResolvedWeknoraConnection extends Omit<WeknoraConnection, "apiKeyRef"> {
  source: "environment" | "managed";
  /** Internal execution value only; never serialize this result into snapshots or protocol output. */
  apiKey: string;
  warnings: string[];
}
function fail(message: string): never { throw new ProviderError(`WeKnora: ${message}`, { kind: "config" }); }
export function weknoraTransportWarnings(baseUrl: string): string[] {
  return /^http:/i.test(baseUrl) ? ["HTTP transport is plaintext."] : [];
}

/** Caller must capture this environment BEFORE loadCredentialEnvironment/process.env hydration.
 * No default process.env: hydrated values cannot establish external ownership. No dispatcher exists yet.
 */
export async function resolveWeknoraConnection(
  config: ArkSpaceConfig, credentialPath: string, originalEnvironment: NodeJS.ProcessEnv,
): Promise<ResolvedWeknoraConnection | undefined> {
  const hasUrl = Object.hasOwn(originalEnvironment, "WEKNORA_BASE_URL");
  const hasKey = Object.hasOwn(originalEnvironment, "WEKNORA_API_KEY");
  if (hasUrl || hasKey) {
    if (!hasUrl || !hasKey) fail("Supply both external environment variables together; no managed fallback is allowed.");
    const parsed = WeknoraConnectionSchema.safeParse({ baseUrl: originalEnvironment.WEKNORA_BASE_URL, apiKeyRef: WEKNORA_MANAGED_KEY_REF });
    const apiKey = validateCredentialValue(originalEnvironment.WEKNORA_API_KEY ?? "");
    if (!parsed.success || !apiKey) fail("Invalid external connection pair; no managed fallback is allowed.");
    return { source: "environment", baseUrl: parsed.data.baseUrl, apiKey, allowRanges: [], warnings: weknoraTransportWarnings(parsed.data.baseUrl) };
  }
  const connection = config.connections?.weknora;
  if (!connection) return undefined;
  const parsed = WeknoraConnectionSchema.safeParse(connection);
  if (!parsed.success) fail("Invalid managed connection configuration.");
  const variable = parsed.data.apiKeyRef.slice(4);
  if (Object.hasOwn(originalEnvironment, variable)) fail("Managed credential reference is externally overridden; supply the complete external pair instead.");
  const store = await loadCredentialStore(credentialPath);
  const apiKey = validateCredentialValue(store.values[variable] ?? "");
  if (!apiKey) fail("Managed credential is missing or invalid; no external fallback is allowed.");
  const { apiKeyRef: _, ...settings } = parsed.data;
  return { ...settings, source: "managed", apiKey, warnings: weknoraTransportWarnings(settings.baseUrl) };
}
