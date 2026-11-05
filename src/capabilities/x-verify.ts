import { resolveNitterConnection } from "../config/nitter.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { LocalHttpError, localHttpNitterGet } from "../providers/local-http.js";

/** Setup-only check (ADR 0026): /health proves reachability, /tools proves the token. No search, no quota. */
export async function verifyNitter(paths: ArkSpacePaths, originalEnvironment: NodeJS.ProcessEnv, timeoutMs = 5000): Promise<{ ok: boolean; detail: string }> {
  let connection;
  try { connection = await resolveNitterConnection(await loadConfig(paths.config), paths.credentials, originalEnvironment); }
  catch { return { ok: false, detail: "config" }; }
  if (!connection) return { ok: false, detail: "config" };
  try {
    const health = await localHttpNitterGet(connection.baseUrl, connection.token, "/api/v1/health", { timeoutMs });
    if (health.status < 200 || health.status >= 300) {
      let state = "";
      try { const s = (JSON.parse(health.text) as { status?: unknown }).status; if (typeof s === "string" && /^[a-z_]{1,20}$/.test(s)) state = `/${s}`; } catch { /* non-JSON health body */ }
      return { ok: false, detail: `health/${health.status}${state}` };
    }
    const tools = await localHttpNitterGet(connection.baseUrl, connection.token, "/api/v1/tools", { timeoutMs });
    if (tools.text.includes(connection.token)) return { ok: false, detail: "invalid-response" };
    return tools.status >= 200 && tools.status < 300 ? { ok: true, detail: `tools/${tools.status}` } : { ok: false, detail: `tools/${tools.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof LocalHttpError ? error.kind : "network" };
  }
}
