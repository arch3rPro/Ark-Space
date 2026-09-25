import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { TextDecoder } from "node:util";

/** Internal transport only. Not registered with the public provider registry. */
export type LocalHttpErrorKind = "invalid-url" | "blocked-address" | "dns" | "redirect" | "timeout" | "cancelled" | "network" | "headers" | "body" | "content-type" | "encoding" | "http-status" | "configuration";
export class LocalHttpError extends Error {
  constructor(readonly kind: LocalHttpErrorKind) {
    super(`Local HTTP request failed (${kind}).`);
    this.name = "LocalHttpError";
  }
}

export interface LocalHttpOptions {
  /** Exact CIDRs, not hostnames. Exceptions to the default nonpublic-address deny list. */
  allowRanges?: readonly string[];
  /** Proxying is deliberately unsupported: true is an error, not a silent direct connection. */
  trustEnvProxy?: boolean;
  maxRedirects?: number;
  maxHeaderBytes?: number;
  maxBodyBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Test seam; production uses node:dns lookup(all:true). */
  lookup?: (hostname: string) => Promise<readonly { address: string; family: number }[]>;
}

export interface LocalHttpResponse {
  status: number;
  contentType: string;
  text: string;
}

const denied4 = new BlockList();
const denied6 = new BlockList();
for (const cidr of ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"]) {
  const [ip, bits] = cidr.split("/") as [string, string];
  denied4.addSubnet(ip, Number(bits), "ipv4");
}
for (const cidr of ["2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"]) {
  const [ip, bits] = cidr.split("/") as [string, string];
  denied6.addSubnet(ip, Number(bits), "ipv6");
}
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const mapped6 = new BlockList();
mapped6.addSubnet("::ffff:0:0", 96, "ipv6");

function addressInfo(address: string): { address: string; family: 4 | 6 } | undefined {
  const family = isIP(address);
  if (family === 4) return { address, family };
  if (family !== 6) return undefined;
  if (mapped6.check(address, "ipv6")) {
    // Node may print the low 32 bits as either hex groups or dotted decimal.
    const expanded = address.includes(".") ? address.slice(address.lastIndexOf(":") + 1) : undefined;
    if (expanded && isIP(expanded) === 4) return { address: expanded, family: 4 };
    const groups = address.split(":");
    const last = groups.slice(-2).map((part) => Number.parseInt(part, 16));
    if (last.length !== 2 || last.some((n) => !Number.isInteger(n))) return undefined;
    return { address: `${last[0]! >> 8}.${last[0]! & 255}.${last[1]! >> 8}.${last[1]! & 255}`, family: 4 };
  }
  return { address, family: 6 };
}

function ranges(values: readonly string[]): BlockList {
  const allowed = new BlockList();
  for (const cidr of values) {
    const match = /^([^/]+)\/(\d{1,3})$/.exec(cidr);
    if (!match) throw new LocalHttpError("configuration");
    const ip = addressInfo(match[1]!);
    const prefix = Number(match[2]);
    // Mapped CIDRs are intentionally not accepted: spell exceptions in IPv4 form.
    if (!ip || ip.address !== match[1] || prefix > (ip.family === 4 ? 32 : 128)) throw new LocalHttpError("configuration");
    allowed.addSubnet(ip.address, prefix, ip.family === 4 ? "ipv4" : "ipv6");
  }
  return allowed;
}

function positiveInteger(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= max;
}

function parseUrl(value: string): URL {
  if (typeof value !== "string" || /[\\\u0000-\u0020\u007f]/.test(value)) throw new LocalHttpError("invalid-url");
  let url: URL;
  try { url = new URL(value); } catch { throw new LocalHttpError("invalid-url"); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || !url.hostname || url.hash ||
      (!url.hostname.startsWith("[") && (!/^[a-z0-9.-]+$/i.test(url.hostname) || url.hostname.endsWith(".") || url.hostname.split(".").some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))))) {
    throw new LocalHttpError("invalid-url");
  }
  return url;
}

function checkAddress(value: string, allowed: BlockList): { address: string; family: 4 | 6 } {
  const ip = addressInfo(value);
  if (!ip) throw new LocalHttpError("dns");
  const kind = ip.family === 4 ? "ipv4" : "ipv6";
  if (!allowed.check(ip.address, kind) && (ip.family === 4 ? denied4.check(ip.address, kind) : !global6.check(ip.address, kind) || denied6.check(ip.address, kind))) {
    throw new LocalHttpError("blocked-address");
  }
  return ip;
}

/** Performs one pinned DNS resolution per hop; no proxy, cookies, credentials, or automatic redirects. */
export async function localHttpGet(input: string, options: LocalHttpOptions = {}): Promise<LocalHttpResponse> {
  if (options.trustEnvProxy) throw new LocalHttpError("configuration");
  const redirects = options.maxRedirects ?? 5;
  const headerLimit = options.maxHeaderBytes ?? 16 * 1024;
  const bodyLimit = options.maxBodyBytes ?? 2 * 1024 * 1024;
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(redirects) || redirects < 0 || redirects > 20 || !positiveInteger(headerLimit, 64 * 1024) || !positiveInteger(bodyLimit, 16 * 1024 * 1024) || !positiveInteger(timeout, 120_000)) throw new LocalHttpError("configuration");
  const allowed = ranges(options.allowRanges ?? []);
  let url = parseUrl(input);
  const deadline = Date.now() + timeout;
  const resolve = options.lookup ?? (async (hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));
  for (let hop = 0; ; hop++) {
    if (options.signal?.aborted) throw new LocalHttpError("cancelled");
    if (Date.now() >= deadline) throw new LocalHttpError("timeout");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: readonly { address: string; family: number }[];
    try {
      if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
      else addresses = await new Promise<readonly { address: string; family: number }[]>((resolveResult, reject) => {
        let done = false;
        const finish = (error?: LocalHttpError, result?: readonly { address: string; family: number }[]) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolveResult(result!);
        };
        const abort = () => finish(new LocalHttpError("cancelled"));
        const timer = setTimeout(() => finish(new LocalHttpError("timeout")), Math.max(1, deadline - Date.now()));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        Promise.resolve().then(() => resolve(hostname)).then((result) => finish(undefined, result), () => finish(new LocalHttpError("dns")));
      });
    } catch (error) { throw error instanceof LocalHttpError ? error : new LocalHttpError("dns"); }
    if (!addresses.length || addresses.length > 256) throw new LocalHttpError("dns");
    const validated = addresses.map((entry) => {
      if (entry.family !== isIP(entry.address)) throw new LocalHttpError("dns");
      const ip = checkAddress(entry.address, allowed);
      if (entry.family !== ip.family && !(entry.family === 6 && ip.family === 4)) throw new LocalHttpError("dns");
      return ip;
    });
    const pinned = validated[0]!;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new LocalHttpError("timeout");
    const result = await new Promise<{ status: number; location?: string; contentType: string; text: string }>((resolveResult, reject) => {
      let settled = false;
      const fail = (kind: LocalHttpErrorKind) => { if (!settled) { settled = true; reject(new LocalHttpError(kind)); request.destroy(); } };
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: "GET", agent: false, maxHeaderSize: headerLimit,
        headers: { accept: "text/*, application/json, application/xml", "accept-encoding": "identity" },
        // Node requests all addresses by default (autoSelectFamily). Honour the
        // lookup callback's `all` contract while returning only the vetted IP.
        lookup: (_host, opts, cb) => {
          if (opts.all) cb(null, [{ address: pinned.address, family: pinned.family }]);
          else cb(null, pinned.address, pinned.family);
        },
      }, (response) => {
        if (settled) { response.destroy(); return; }
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          settled = true;
          resolveResult({ status, location, contentType: "", text: "" });
          response.destroy();
          return;
        }
        if (status < 200 || status >= 300) { fail("http-status"); return; }
        const contentType = response.headers["content-type"];
        const match = typeof contentType === "string" && /^\s*(text\/[a-z0-9!#$&^_.+-]+|application\/(?:json|xml|[a-z0-9!#$&^_.+-]+\+(?:json|xml)))(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i.exec(contentType);
        if (!match || response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { fail("content-type"); return; }
        const parts: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > bodyLimit) { fail("body"); return; }
          parts.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
            settled = true;
            resolveResult({ status, contentType: match[1]!, text });
          } catch { fail("encoding"); }
        });
        response.on("error", () => fail("network"));
        response.on("close", () => { if (!response.complete) fail("network"); });
      });
      const timer = setTimeout(() => fail("timeout"), remaining);
      const abort = () => fail("cancelled");
      options.signal?.addEventListener("abort", abort, { once: true });
      request.on("error", (error: NodeJS.ErrnoException) => fail(error.code === "HPE_HEADER_OVERFLOW" ? "headers" : "network"));
      request.on("close", () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); });
      request.end();
      if (options.signal?.aborted) abort();
    });
    if (result.location !== undefined) {
      if (hop >= redirects) throw new LocalHttpError("redirect");
      let next: URL;
      try { next = new URL(result.location, url); } catch { throw new LocalHttpError("invalid-url"); }
      url = parseUrl(next.href);
      continue;
    }
    return { status: result.status, contentType: result.contentType, text: result.text };
  }
}
