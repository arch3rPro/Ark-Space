import { ProviderError, classifyHttpFailure } from "../errors/provider-error.js";
import type { WebFetchData, WebFetchResult } from "../protocol/types.js";
import type { FetchLike } from "./http.js";
import { LocalHttpError } from "./local-http.js";

/** The two intentionally local modes. `answer` is not part of this provider. */
export type LocalFetchMode = "raw" | "readable";

export interface LocalFetchInput {
  url: string;
  mode: LocalFetchMode;
  maxCharacters: number;
  timeoutMs: number;
}

export interface LocalFetchRequest {
  input: LocalFetchInput;
  signal?: AbortSignal;
}

export interface LocalFetchOptions {
  /** Must be a security-gated transport. This provider never calls global fetch. */
  transport: FetchLike;
  /** Maximum bytes accepted from a response (before text extraction). */
  maxResponseBytes?: number;
}

/**
 * Minimal local-fetch provider pending integration into the protocol provider union.
 *
 * The transport is deliberately mandatory: the caller owns DNS/IP checks,
 * redirect policy, proxy policy, and any other SSRF boundary.
 */
export class LocalFetchProvider {
  readonly id = "local-fetch" as const;
  readonly modes = ["raw", "readable"] as const;

  private readonly transport: FetchLike;
  private readonly maxResponseBytes: number;

  constructor(options: LocalFetchOptions) {
    this.transport = options.transport;
    this.maxResponseBytes = options.maxResponseBytes ?? 10 * 1024 * 1024;
  }

  async fetch(request: LocalFetchRequest): Promise<WebFetchData> {
    const { input } = request;
    if (!Number.isSafeInteger(input.maxCharacters) || input.maxCharacters < 0) {
      throw new ProviderError("Local fetch maxCharacters must be a non-negative integer.", { kind: "invalid-request" });
    }
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new ProviderError("Local fetch timeoutMs must be positive.", { kind: "invalid-request" });
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Local fetch timed out.")), input.timeoutMs);

    try {
      const response = await this.transport(input.url, { method: "GET", signal: controller.signal });
      if (!response.ok) {
        throw new ProviderError(`Local fetch failed with HTTP ${response.status}.`, {
          kind: classifyHttpFailure(response.status, ""),
          status: response.status,
        });
      }

      const declaredLength = response.headers.get("content-length");
      if (declaredLength && Number(declaredLength) > this.maxResponseBytes) {
        throw new ProviderError("Local fetch response exceeds the configured size limit.", { kind: "invalid-response" });
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "text/plain";
      if (!isTextContentType(contentType)) {
        throw new ProviderError("Local fetch returned a non-text response.", { kind: "invalid-response" });
      }
      const body = await readLimitedText(response, this.maxResponseBytes, controller.signal);
      const content = input.mode === "raw" || !isHtmlContentType(contentType) ? body : toReadableText(body);
      const result: WebFetchResult = { url: input.url, content: content.slice(0, input.maxCharacters) };
      const title = input.mode === "readable" && isHtmlContentType(contentType) ? extractTitle(body) : undefined;
      if (title) result.title = title;
      return { results: [result], failedUrls: [] };
    } catch (error) {
      if (error instanceof ProviderError || error instanceof LocalHttpError) throw error;
      throw new ProviderError("Local fetch request or response failed.", { kind: "network" });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

async function readLimitedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let output = "";
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new ProviderError("Local fetch response exceeds the configured size limit.", { kind: "invalid-response" });
      }
      output += decoder.decode(value, { stream: true });
    }
    signal.throwIfAborted();
    return output + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function isTextContentType(contentType: string): boolean {
  return contentType.startsWith("text/") || /(?:xhtml|xml|json|javascript|svg)/.test(contentType);
}

function isHtmlContentType(contentType: string): boolean {
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

function extractTitle(html: string): string | undefined {
  const match = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1] ? decodeEntities(stripTags(match[1])).replace(/\s+/g, " ").trim() : "";
  return title || undefined;
}

/** Small dependency-free fallback, intentionally conservative rather than a full DOM parser. */
function toReadableText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  return decodeEntities(
    stripTags(
      withoutNoise
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/(?:title|p|div|article|section|main|h[1-6]|li|tr)>/gi, "\n"),
    )
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}
