import { ProviderError } from "../errors/provider-error.js";
import { loadCredentialStore, validateCredentialValue } from "./credentials.js";
import { NITTER_MANAGED_KEY_REF, NitterConnectionSchema, type ArkSpaceConfig } from "./schema.js";

export interface ResolvedNitterConnection {
  baseUrl: string;
  source: "environment" | "managed";
  /** Internal execution value only; never serialize this result into protocol output. */
  token: string;
  warnings: string[];
}

export function nitterTransportWarnings(baseUrl: string): string[] {
  return /^http:/i.test(baseUrl) ? ["HTTP transport is plaintext."] : [];
}

function fail(message: string): never {
  throw new ProviderError(`Nitter: ${message}`, { kind: "config" });
}

/** Caller must capture the environment BEFORE credential hydration.
 * Both external variables are required together; a partial pair never falls back to managed values.
 */
export async function resolveNitterConnection(
  config: ArkSpaceConfig, credentialPath: string, originalEnvironment: NodeJS.ProcessEnv,
): Promise<ResolvedNitterConnection | undefined> {
  const hasUrl = Object.hasOwn(originalEnvironment, "NITTER_BASE_URL");
  const hasToken = Object.hasOwn(originalEnvironment, "NITTER_API_TOKEN");
  if (hasUrl || hasToken) {
    if (!hasUrl || !hasToken) fail("Supply NITTER_BASE_URL and NITTER_API_TOKEN together; no managed fallback is allowed.");
    const parsed = NitterConnectionSchema.safeParse({ baseUrl: originalEnvironment.NITTER_BASE_URL, apiKeyRef: NITTER_MANAGED_KEY_REF });
    const token = validateCredentialValue(originalEnvironment.NITTER_API_TOKEN ?? "");
    if (!parsed.success || !token) fail("Invalid external Nitter connection pair; no managed fallback is allowed.");
    return { baseUrl: parsed.data.baseUrl, source: "environment", token, warnings: nitterTransportWarnings(parsed.data.baseUrl) };
  }
  const connection = config.connections?.nitter;
  if (!connection) return undefined;
  const parsed = NitterConnectionSchema.safeParse(connection);
  if (!parsed.success) fail("Invalid managed Nitter connection configuration.");
  const variable = parsed.data.apiKeyRef.slice(4);
  if (Object.hasOwn(originalEnvironment, variable)) fail("Managed credential reference is externally overridden; supply the complete external pair instead.");
  const store = await loadCredentialStore(credentialPath);
  const token = validateCredentialValue(store.values[variable] ?? "");
  if (!token) fail("Managed Nitter credential is missing or invalid; no external fallback is allowed.");
  return { baseUrl: parsed.data.baseUrl, source: "managed", token, warnings: nitterTransportWarnings(parsed.data.baseUrl) };
}
