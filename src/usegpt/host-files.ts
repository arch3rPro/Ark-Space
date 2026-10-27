import { z } from "zod";
import { UseGptHostFileSchema } from "../protocol/usegpt-schema.js";
import type { PublishStreamInput, UseGptHubStore } from "./hub-store.js";

const MAX_BYTES = 67_108_864;
export class HostFileError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new HostFileError(code, message); }

function downloadUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { fail("invalid-file-reference", "Invalid Host file download reference."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.hash ||
      !(url.hostname === "oaiusercontent.com" || url.hostname.endsWith(".oaiusercontent.com"))) {
    fail("invalid-file-reference", "Host file download requires HTTPS on an allowed OpenAI file host.");
  }
  return url;
}

/** Download references are ephemeral authority; never persist them or interpolate transport errors. */
export async function publishHostFile(store: UseGptHubStore, input: PublishStreamInput, file: z.infer<typeof UseGptHostFileSchema>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const reference = "file_id" in file ? file.download_url : file.uri;
  if (!reference) fail("unsupported", "Host file_id resolution is unsupported without a native download_url. Use a Host-provided downloadable file or publish inline text.");
  let url = downloadUrl(reference);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const downloadSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let response: Response | undefined;
  try {
    for (let redirects = 0; ; redirects++) {
      response = await fetch(url, { redirect: "manual", signal: downloadSignal, credentials: "omit", headers: { "Accept-Encoding": "identity" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (redirects >= 3 || !location) fail("file-redirect", "Host file redirect limit or response is invalid.");
      let next: string;
      try { next = new URL(location, url).href; } catch { return fail("file-redirect", "Invalid Host file redirect."); }
      url = downloadUrl(next);
    }
    if ([401, 403, 404, 410].includes(response.status)) fail("file-reference-expired", "Host file reference is unavailable or expired. Ask the Host to provide a fresh file reference.");
    if (!response.ok || !response.body) fail("file-download", "Host file download failed.");
    const length = response.headers.get("content-length");
    const encoding = response.headers.get("content-encoding");
    if (encoding && encoding !== "identity") fail("file-download", "Encoded Host file downloads are unsupported.");
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_BYTES)) fail("file-size", "Host file exceeds the download size limit or has an invalid size.");
    if (file.size !== undefined && length !== null && file.size !== Number(length)) fail("file-size", "Host file declared size does not match its download size.");
    const declaredSize = file.size ?? (length === null ? undefined : Number(length));
    const body = response.body;
    const source = async function* () {
      const reader = body.getReader();
      let size = 0;
      try {
        for (;;) {
          downloadSignal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) fail("file-size", "Host file exceeds the download size limit.");
          yield chunk.value;
        }
        downloadSignal.throwIfAborted();
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    };
    const mediaType = input.mediaType ?? ("file_id" in file ? file.mime_type : file.mimeType) ?? "application/octet-stream";
    return await store.publishStream({ ...input, mediaType, ...(declaredSize === undefined ? {} : { declaredSize }) }, source());
  } catch (error) {
    if (signal?.aborted) fail("cancelled", "Artifact Hub request cancelled.");
    if (controller.signal.aborted) fail("file-timeout", "Host file download timed out.");
    if (error instanceof HostFileError || error && typeof error === "object" && "code" in error && typeof error.code === "string" && !error.code.startsWith("ERR_")) throw error;
    return fail("file-download", "Host file download failed.");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
  }
}
