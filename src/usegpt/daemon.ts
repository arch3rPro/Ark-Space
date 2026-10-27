import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { executeUseGpt } from "../capabilities/usegpt.js";
import { defaultConfig } from "../config/schema.js";
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } from "./contracts.js";

const DEFAULT_DATA_DIR = join(homedir(), ".arkspace", "usegpt");
interface LockRecord { pid: number; token: string; }
export interface DaemonStatus { running: boolean; dataDir: string; pid?: number; }
export interface UseGptDaemon { close(): Promise<void>; closed: Promise<void>; endpoint: string; }

export function defaultDaemonDataDir(): string { return DEFAULT_DATA_DIR; }
export function normalizeDaemonDataDir(value: string): string {
  if (!isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Use an absolute local --data-dir.");
  return resolve(value);
}
function filesFor(dataDir: string) {
  if (process.platform === "win32") throw new Error("This Artifact Hub daemon slice requires Unix sockets.");
  const root = normalizeDaemonDataDir(dataDir), runtime = join(root, ".daemon");
  const socket = join(runtime, "hub.sock");
  if (Buffer.byteLength(socket) > 100) throw new Error("Daemon socket path is too long; use a shorter --data-dir.");
  return { root, runtime, socket, lock: join(runtime, "owner.json"), guard: join(runtime, "startup.lock"), config: join(runtime, "config.json") };
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === "ENOENT"; }
function privateDirectory(path: string, create: boolean): void {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/")) {
    current = join(current, part);
    if (create) { try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe daemon directory.");
  }
  const stat = lstatSync(path);
  if (process.getuid && stat.uid !== process.getuid()) throw new Error("Daemon directory must belong to the current user.");
  if (create) chmodSync(path, 0o700);
  else if (stat.mode & 0o077) throw new Error("Daemon directory must be private.");
}
function readLock(path: string): LockRecord | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw new Error("Unsafe daemon lock.");
    const value = JSON.parse(readFileSync(path, "utf8")) as LockRecord;
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.token !== "string" || !/^[0-9a-f-]{36}$/.test(value.token)) throw new Error("Invalid daemon lock; inspect it before recovery.");
    return value;
  } catch (error) { if (missing(error)) return undefined; throw error; }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
function remove(path: string): void { try { unlinkSync(path); } catch (error) { if (!missing(error)) throw error; } }
function acquire(files: ReturnType<typeof filesFor>, owner: LockRecord): void {
  // Serialize stale-owner recovery too: two starters must never unlink a new owner's lock.
  try { mkdirSync(files.guard, { mode: 0o700 }); }
  catch { throw new Error("Daemon startup is busy; retry or inspect .daemon/startup.lock after a crash."); }
  try {
    const previous = readLock(files.lock);
    if (previous && alive(previous.pid)) throw new Error("UseGPT daemon is already running.");
    if (previous) remove(files.lock);
    const fd = openSync(files.lock, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(owner)); } finally { closeSync(fd); }
  } finally { rmdirSync(files.guard); }
}

export async function createUseGptDaemon(dataDir = DEFAULT_DATA_DIR): Promise<UseGptDaemon> {
  const files = filesFor(dataDir);
  privateDirectory(files.root, true); privateDirectory(files.runtime, true);
  const owner = { pid: process.pid, token: randomUUID() };
  acquire(files, owner);
  const sockets = new Set<Socket>(), controllers = new Set<AbortController>(), operations = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(done => { resolveClosed = done; });
  const paths = { home: files.runtime, config: files.config, credentials: join(files.runtime, "credentials.json"), state: join(files.runtime, "state.json") };
  const server = createServer(socket => {
    sockets.add(socket); socket.on("error", () => undefined);
    const controller = new AbortController(); controllers.add(controller);
    socket.once("close", () => { sockets.delete(socket); controllers.delete(controller); controller.abort(); });
    socket.setTimeout(5_000, () => socket.destroy());
    let buffer = Buffer.alloc(0), handled = false;
    socket.on("data", (chunk: Buffer) => {
      if (handled) return;
      if (buffer.length + chunk.length > MAX_REQUEST_BYTES) { socket.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(10); if (newline < 0) return;
      handled = true;
      socket.setTimeout(65_000);
      const operation = (async () => {
        try {
          const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, newline)));
          let result: unknown;
          if (value && typeof value === "object" && "type" in value && value.type === "status") {
            result = { running: true, pid: process.pid, token: owner.token, dataDir: files.root };
          } else if (value && typeof value === "object" && "type" in value && value.type === "shutdown") {
            result = { ok: true };
            socket.end(`${JSON.stringify(result)}\n`, () => { void close().catch(reportShutdownError); });
            return;
          } else result = await executeUseGpt(value, paths, process.env, controller.signal);
          const response = JSON.stringify(result);
          if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) throw new Error("Daemon response exceeds limit.");
          if (!socket.destroyed) socket.end(`${response}\n`);
        } catch { if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: false, error: { message: "Invalid daemon request." } })}\n`); }
      })();
      operations.add(operation); void operation.finally(() => operations.delete(operation));
    });
  });
  const onSignal = (): void => { void close().catch(reportShutdownError); };
  function reportShutdownError(): void { process.stderr.write("arks usegpt daemon: shutdown cleanup failed.\n"); process.exitCode = 1; }
  function close(): Promise<void> {
    return closing ??= (async () => {
      process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
      const stopped = new Promise<void>(done => { if (server.listening) server.close(() => done()); else done(); });
      for (const controller of controllers) controller.abort();
      for (const socket of sockets) socket.destroy();
      await Promise.allSettled([...operations]); await stopped;
      if (readLock(files.lock)?.token === owner.token) { remove(files.socket); remove(files.config); remove(files.lock); }
      resolveClosed();
    })();
  }
  try {
    // A crash may leave a socket/config, but only the exclusive owner may replace it.
    remove(files.socket); remove(files.config);
    const config = defaultConfig(); config.connections = { usegpt: { enabled: true, dataDir: files.root } };
    writeFileSync(files.config, JSON.stringify(config), { mode: 0o600, flag: "wx" });
    const readiness = await executeUseGpt({ protocolVersion: 1, capability: "usegpt.connection.status", input: {} }, paths, process.env);
    if (!readiness.ok) throw new Error("Artifact Hub storage is not ready; Node.js 22.13+ and a writable data directory are required.");
    await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(files.socket, () => { server.removeListener("error", reject); done(); }); });
    chmodSync(files.socket, 0o600);
    process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
    return { close, closed, endpoint: files.socket };
  } catch (error) { await close(); throw error; }
}

export async function daemonRequest(dataDir: string, request: unknown, timeoutMs = 65_000): Promise<unknown> {
  const files = filesFor(dataDir);
  privateDirectory(files.runtime, false);
  const lock = readLock(files.lock);
  if (!lock || !alive(lock.pid)) throw new Error("UseGPT daemon is not running.");
  const payload = `${JSON.stringify(request)}\n`;
  if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) throw new Error("Daemon request exceeds limit.");
  return new Promise((done, reject) => {
    const socket = createConnection(files.socket);
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => socket.destroy(new Error("Daemon request timed out; its outcome may be unknown.")), timeoutMs);
    socket.once("close", () => clearTimeout(timer));
    socket.once("error", reject);
    socket.once("connect", () => socket.write(payload));
    socket.on("data", (chunk: Buffer) => {
      if (buffer.length + chunk.length > MAX_RESPONSE_BYTES) { socket.destroy(new Error("Daemon response exceeds limit.")); return; }
      buffer = Buffer.concat([buffer, chunk]);
    });
    socket.once("end", () => {
      try { done(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer))); }
      catch { reject(new Error("Daemon returned invalid JSON; request outcome may be unknown.")); }
      finally { socket.destroy(); }
    });
  });
}

export async function daemonStatus(dataDir = DEFAULT_DATA_DIR): Promise<DaemonStatus> {
  const files = filesFor(dataDir);
  try {
    privateDirectory(files.runtime, false);
    const lock = readLock(files.lock);
    if (!lock || !alive(lock.pid)) return { running: false, dataDir: files.root };
    const result = await daemonRequest(files.root, { type: "status" }, 1_000) as { running?: boolean; token?: string; pid?: number };
    return { running: result.running === true && result.token === lock.token && result.pid === lock.pid, pid: lock.pid, dataDir: files.root };
  } catch (error) {
    if (missing(error) || ["ECONNREFUSED", "ECONNRESET"].includes((error as NodeJS.ErrnoException).code ?? "")) return { running: false, dataDir: files.root };
    throw error;
  }
}

export async function stopUseGptDaemon(dataDir = DEFAULT_DATA_DIR): Promise<DaemonStatus> {
  const status = await daemonStatus(dataDir);
  if (!status.running) return status;
  await daemonRequest(dataDir, { type: "shutdown" }, 5_000);
  const files = filesFor(dataDir), deadline = Date.now() + 5_000;
  while (readLock(files.lock) && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
  if (readLock(files.lock)) throw new Error("Daemon shutdown has not finished.");
  return { running: false, dataDir: files.root };
}

export async function serveUseGptDaemon(dataDir = DEFAULT_DATA_DIR): Promise<void> {
  const daemon = await createUseGptDaemon(dataDir);
  await daemon.closed;
}
