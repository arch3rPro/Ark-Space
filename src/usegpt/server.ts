import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ArkSpacePaths } from "../config/paths.js";
import { loadUseGptConfig } from "../config/usegpt.js";
import { withFileLock, writeJsonAtomic } from "../io/json-store.js";
import { ChatGptCdpDriver } from "../providers/usegpt-cdp.js";
import { useGptFailure, type UseGptEnvelope } from "../protocol/usegpt-schema.js";
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, parseResponse, tokenFrom } from "./contracts.js";
import { UseGptRuntime, type UseGptDriver } from "./runtime.js";

const OwnerSchema = z.object({ pid: z.number().int().positive(), instance: z.uuid() }).strict();
async function claim(paths: ArkSpacePaths): Promise<() => Promise<void>> {
  const path = join(paths.home, "usegpt", "daemon.json");
  const owner = { pid: process.pid, instance: randomUUID() };
  // The shared lock is held only for short filesystem transactions, never for daemon lifetime.
  await withFileLock(path, async () => {
    let raw: string | undefined;
    try { raw = await readFile(path, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("UseGPT ownership cannot be read."); }
    if (raw !== undefined) {
      let prior: z.infer<typeof OwnerSchema>;
      try { prior = OwnerSchema.parse(JSON.parse(raw)); } catch { throw new Error("UseGPT ownership is invalid."); }
      let alive = true;
      try { process.kill(prior.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
      if (alive) throw new Error("A UseGPT daemon already owns this state directory.");
    }
    await writeJsonAtomic(path, owner);
  });
  return async () => {
    await withFileLock(path, async () => {
      let current: z.infer<typeof OwnerSchema>;
      try { current = OwnerSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
      catch { throw new Error("UseGPT ownership could not be released."); }
      if (current.instance === owner.instance) await rm(path);
    });
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_REQUEST_BYTES) throw new Error("Request exceeds size limit.");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Invalid UseGPT JSON request."); }
}
function respond(res: ServerResponse, value: UseGptEnvelope, status = 200): void {
  let body: string;
  try {
    parseResponse(value, value.capability);
    body = JSON.stringify(value);
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error();
  } catch {
    body = JSON.stringify(useGptFailure(value.capability, "response", "UseGPT response is invalid or exceeds the response limit."));
  }
  if (res.destroyed) return;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

export async function startUseGptServer(paths: ArkSpacePaths, options: {
  environment: NodeJS.ProcessEnv; signal?: AbortSignal; port?: number; driver?: UseGptDriver;
}): Promise<{ address: string; close: () => Promise<void> }> {
  options.signal?.throwIfAborted();
  const config = await loadUseGptConfig(paths);
  const tokenHash = createHash("sha256").update(tokenFrom(options.environment)).digest();
  let endpoint: URL;
  try { endpoint = new URL(config.serviceUrl); }
  catch { throw new Error("Invalid UseGPT service configuration."); }
  const port = options.port ?? Number(endpoint.port || 80);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid UseGPT service port.");
  const release = await claim(paths);
  const runtime = new UseGptRuntime(paths, options.driver ?? new ChatGptCdpDriver(config.cdpUrl));
  let boundPort = 0;
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    void (async () => {
      const authorized = req.headers.authorization ?? "";
      const hostCount = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i]!.toLowerCase() === "host").length;
      const suppliedHash = createHash("sha256").update(authorized.startsWith("Bearer ") ? authorized.slice(7) : "").digest();
      const validHost = req.headers.host === `127.0.0.1:${boundPort}` || req.headers.host === `[::1]:${boundPort}`;
      if (!timingSafeEqual(suppliedHash, tokenHash) || !authorized.startsWith("Bearer ") || !validHost || hostCount !== 1 || req.headers.origin !== undefined || req.headers["sec-fetch-mode"] !== undefined || req.headers["sec-fetch-site"] !== undefined) {
        req.resume(); respond(res, useGptFailure("usegpt.connection.status", "auth", "Unauthorized UseGPT request."), 401); return;
      }
      if (req.method !== "POST" || req.url !== "/invoke") {
        req.resume(); respond(res, useGptFailure("usegpt.connection.status", "http", "Use POST /invoke."), 404); return;
      }
      const controller = new AbortController();
      const disconnected = () => controller.abort();
      res.once("close", disconnected);
      try {
        const request = await readBody(req);
        respond(res, await runtime.invoke(request, controller.signal));
      } catch { respond(res, useGptFailure("usegpt.connection.status", "request", "Invalid or oversized UseGPT request."), 400); }
      finally { res.removeListener("close", disconnected); }
    })().catch(() => respond(res, useGptFailure("usegpt.connection.status", "service", "UseGPT service request failed."), 500));
  });
  try {
    await runtime.initialize();
    options.signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, endpoint.hostname.replace(/^\[|\]$/g, ""), () => { server.removeListener("error", reject); resolve(); });
    });
  } catch { await runtime.close(); await release(); throw new Error("UseGPT service could not start; check ownership, configuration and state."); }
  const address = server.address();
  if (!address || typeof address === "string") { await release(); throw new Error("UseGPT service did not bind."); }
  boundPort = address.port;
  let closing: Promise<void> | undefined;
  const abort = () => { void close().catch(() => undefined); };
  function close(): Promise<void> {
    if (closing) return closing;
    options.signal?.removeEventListener("abort", abort);
    closing = (async () => {
      const httpClosed = new Promise<void>((resolve) => { server.close(() => resolve()); server.closeIdleConnections(); });
      await runtime.close();
      server.closeAllConnections();
      await httpClosed;
      await release();
    })();
    return closing;
  }
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) await close();
  return { address: `http://${endpoint.hostname}:${boundPort}`, close };
}
