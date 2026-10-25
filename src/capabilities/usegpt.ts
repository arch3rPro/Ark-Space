import { request as httpRequest } from "node:http";
import { loadUseGptConfig } from "../config/usegpt.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { useGptFailure, type UseGptEnvelope, type UseGptCapability } from "../protocol/usegpt-schema.js";
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, capabilityOf, parseRequest, parseResponse, tokenFrom } from "../usegpt/contracts.js";

export async function executeUseGpt(request: unknown, paths: ArkSpacePaths, environment: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<UseGptEnvelope> {
  let capability: UseGptCapability = "usegpt.connection.status";
  let body: string;
  try {
    capability = capabilityOf(request);
    parseRequest(request);
    body = JSON.stringify(request);
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error();
  } catch { return useGptFailure(capability, "request", "Invalid UseGPT request."); }
  let endpoint: URL;
  let token: string;
  try {
    const config = await loadUseGptConfig(paths);
    endpoint = new URL("/invoke", config.serviceUrl);
    token = tokenFrom(environment);
  } catch { return useGptFailure(capability, "config", "Configure UseGPT and supply a valid ARKSPACE_USEGPT_TOKEN."); }
  try {
    // node:http connects directly, ignores proxy environment variables, and never follows redirects.
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = httpRequest(endpoint, {
        method: "POST", signal: AbortSignal.any([AbortSignal.timeout(65_000), ...(signal ? [signal] : [])]),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      }, res => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error()); return; }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) { res.destroy(); reject(new Error()); }
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new Error()); } });
      });
      req.on("error", reject);
      req.end(body);
    });
    return parseResponse(value, capability);
  } catch {
    const mutation = capability === "usegpt.task.start" || capability === "usegpt.task.follow_up";
    return useGptFailure(capability, mutation ? "uncertain" : "service", mutation
      ? "Service response is uncertain. Reuse the same requestId to check acceptance; never resend automatically."
      : "UseGPT service request failed or returned an invalid response.");
  }
}
