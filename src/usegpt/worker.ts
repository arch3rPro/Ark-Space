import { spawn } from "node:child_process";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { daemonRequest } from "./daemon.js";

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f-]{36}$`));
const absolute = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !/[\u0000-\u001f]/.test(value));
const Config = z.object({
  executable: absolute, args: z.array(z.string().max(4096).refine(value => !value.includes("\0"))).max(100),
  cwd: absolute, projectId: identifier("project"), recipient: z.string().min(1).max(255), dataDir: absolute,
  agentConfigDir: absolute.optional(),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(300_000),
  pollMs: z.number().int().min(100).max(60_000).default(1000),
}).strict();
type WorkerConfig = z.infer<typeof Config>;
const Ref = z.object({ artifactId: identifier("artifact"), revision: z.number().int().positive() }).strict();
const Claim = z.object({ id: identifier("handoff"), projectId: identifier("project"), taskId: identifier("task"), to: z.string(), claimToken: z.string().uuid(), generation: z.number().int().positive(), artifactRefs: z.array(Ref).max(100) }).passthrough();
const Result = z.object({
  protocolVersion: z.literal(1), handoffId: identifier("handoff"), generation: z.number().int().positive(),
  outcome: z.enum(["completed", "failed", "partial", "cancelled"]),
  artifacts: z.array(z.object({ name: z.string().min(1).max(255), content: z.string().max(1_048_576), mediaType: z.string().min(1).max(128).default("text/plain") }).strict()).max(20).default([]),
}).strict();
export interface WorkerReceipt { ok: boolean; command: string; data: { status: string; handoffId?: string; recoveryDir?: string }; }
function receipt(status: string, handoffId?: string, recoveryDir?: string): WorkerReceipt {
  return { ok: ["completed", "empty"].includes(status), command: "usegpt.worker", data: { status, ...(handoffId ? { handoffId } : {}), ...(recoveryDir ? { recoveryDir } : {}) } };
}
function privateDirectory(path: string, create = false): void {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/")) {
    current = join(current, part);
    if (create) { try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe worker directory.");
  }
  const stat = lstatSync(path);
  if (stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw new Error("Worker directory must be private and owner controlled.");
}
function readJson<T>(path: string, max: number, schema: z.ZodType<T>): T {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > max || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) throw new Error("Unsafe worker file.");
    const bytes = Buffer.alloc(max + 1); let length = 0;
    for (;;) { const count = readSync(fd, bytes, length, bytes.length - length, null); length += count; if (!count || length > max) break; }
    if (length > max) throw new Error("Worker file exceeds limit.");
    return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))));
  } finally { closeSync(fd); }
}
function syncDirectory(path: string): void { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function save(directory: string, name: string, value: unknown): void {
  const path = join(directory, name), fd = openSync(`${path}.partial`, "wx", 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(`${path}.partial`, path); syncDirectory(directory);
}
function agentConfigDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o022 || process.getuid && stat.uid !== process.getuid()) throw new Error("Agent configuration directory must be owner controlled.");
}
export function loadWorkerConfig(path: string): WorkerConfig {
  if (process.platform === "win32") throw new Error("Worker requires POSIX process groups and permissions.");
  const config = readJson(resolve(path), 65_536, Config);
  privateDirectory(config.dataDir); privateDirectory(config.cwd);
  if (config.agentConfigDir) agentConfigDirectory(config.agentConfigDir);
  const executable = lstatSync(config.executable);
  if (!executable.isFile() || executable.isSymbolicLink() || executable.mode & 0o022) throw new Error("Use a fixed regular executable without group/world write access.");
  return config;
}
async function call(config: WorkerConfig, operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const scoped = ["handoff.list", "artifact.read", "artifact.publish_inline"].includes(operation) ? { ...input, projectId: config.projectId } : input;
  const response = await daemonRequest(config.dataDir, { protocolVersion: 1, capability: `usegpt.${operation}`, input: scoped }) as { ok?: boolean; data?: Record<string, unknown> };
  if (!response.ok || !response.data) throw new Error("Worker hub operation failed; inspect durable state.");
  return response.data;
}
async function executeChild(config: WorkerConfig, directory: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) return "cancelled";
  return new Promise(done => {
    let reason: string | undefined, settled = false;
    const logs = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    const child = spawn(config.executable, config.args, { cwd: config.cwd, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME, LANG: process.env.LANG, ...(config.agentConfigDir ? { PI_CODING_AGENT_DIR: config.agentConfigDir } : {}), ARKS_USEGPT_INPUT_FILE: join(directory, "input.json"), ARKS_USEGPT_RESULT_FILE: join(directory, "result.json") } });
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* only this newly owned process group */ } } };
    const stop = (status: string) => { reason ??= status; kill(); };
    const abort = () => stop("cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("timeout"), config.timeoutMs);
    // A descendant may inherit pipes; never wait indefinitely for its close event.
    const finish = (status: string) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      kill(); child.stdout.destroy(); child.stderr.destroy();
      try { save(directory, "logs.json", { stdout: logs.stdout.toString("utf8"), stderr: logs.stderr.toString("utf8") }); }
      catch { status = "unknown"; }
      done(status);
    };
    for (const stream of ["stdout", "stderr"] as const) child[stream].on("data", (chunk: Buffer) => {
      const remaining = 65_536 - logs[stream].length;
      logs[stream] = Buffer.concat([logs[stream], chunk.subarray(0, remaining)]);
      if (chunk.length > remaining) stop("output_limit");
    });
    child.once("error", () => finish("unknown"));
    child.once("exit", code => finish(reason ?? (code === 0 ? "exited" : "unknown")));
    if (signal?.aborted) abort();
  });
}

/** Existing claims/attempts are never replayed, including a lost claim response or pre-spawn crash. */
export async function workerOnce(config: WorkerConfig, signal?: AbortSignal): Promise<WorkerReceipt> {
  const root = join(config.dataDir, ".worker"); privateDirectory(root, true);
  const listed: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await call(config, "handoff.list", { to: config.recipient, limit: 100, offset });
    const rows = z.array(z.object({ id: identifier("handoff"), status: z.string() }).passthrough()).parse(page.handoffs);
    listed.push(...rows);
    if (page.nextOffset === null) break;
    if (offset >= 1_000_000) throw new Error("Worker listing exceeds limit.");
  }
  let recovery: WorkerReceipt | undefined;
  for (const h of listed) {
    if (!["pending", "claimed", "running", "unknown"].includes(String(h.status))) continue;
    const directory = join(root, String(h.id));
    if (h.status !== "pending") { recovery ??= receipt("unknown", String(h.id), directory); continue; }
    if (signal?.aborted) return receipt("cancelled");
    try { mkdirSync(directory, { mode: 0o700 }); syncDirectory(root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; recovery ??= receipt("unknown", String(h.id), directory); continue; }
    try {
      // This durable intent also covers a claim accepted by the daemon whose response is lost.
      save(directory, "attempt.json", { handoffId: h.id, projectId: config.projectId, recipient: config.recipient, status: "unknown", createdAt: new Date().toISOString() });
      const claim = Claim.parse(await call(config, "handoff.claim", { handoffId: h.id, to: config.recipient }));
      if (claim.projectId !== config.projectId || claim.to !== config.recipient || claim.id !== h.id) throw new Error("Invalid claim.");
      save(directory, "claim.json", claim);
      const task = await call(config, "task.get", { taskId: claim.taskId });
      if (task.projectId !== config.projectId) throw new Error("Task scope mismatch.");
      const artifacts = []; let bytes = 0;
      for (const ref of claim.artifactRefs) {
        let content = "", offset = 0;
        for (;;) {
          const page = await call(config, "artifact.read", { ...ref, offset, limit: 100_000 });
          if (typeof page.content !== "string" || typeof page.nextOffset !== "number" || typeof page.eof !== "boolean") throw new Error("Invalid input page.");
          bytes += Buffer.byteLength(page.content); if (bytes > 16 * 1_048_576) throw new Error("Input package exceeds limit.");
          content += page.content;
          if (page.eof) break;
          if (page.nextOffset <= offset) throw new Error("Invalid input offset."); offset = page.nextOffset;
        }
        artifacts.push({ ...ref, content, encoding: "utf8" });
      }
      save(directory, "input.json", { protocolVersion: 1, handoff: claim, task, artifacts });
      save(directory, "execution.json", { handoffId: claim.id, claimToken: claim.claimToken, generation: claim.generation, executable: config.executable, args: config.args, cwd: config.cwd, status: "unknown", createdAt: new Date().toISOString() });
      const exit = await executeChild(config, directory, signal);
      if (exit !== "exited") { save(directory, "settlement.json", { status: exit }); return receipt(exit, claim.id, directory); }
      const result = readJson(join(directory, "result.json"), 1_048_576, Result);
      if (result.handoffId !== claim.id || result.generation !== claim.generation) throw new Error("Invalid result fence.");
      if (result.outcome === "completed" && !result.artifacts.length) throw new Error("Completion requires a delivered artifact.");
      const current = await call(config, "handoff.get", { handoffId: claim.id });
      if (current.status !== "claimed" || current.generation !== claim.generation) throw new Error("Stale child result.");
      const artifactRefs = [];
      for (const [index, artifact] of result.artifacts.entries()) {
        const published = await call(config, "artifact.publish_inline", { ...artifact, taskId: claim.taskId, idempotencyKey: `worker_${claim.id}_${claim.generation}_${index}` });
        artifactRefs.push({ artifactId: published.id, revision: published.revision });
      }
      const fence = { handoffId: claim.id, claimToken: claim.claimToken, generation: claim.generation };
      if (result.outcome === "completed") await call(config, "handoff.complete", fence);
      else if (result.outcome === "failed") await call(config, "handoff.fail", { ...fence, reason: "Child reported failure." });
      else if (result.outcome === "cancelled") await call(config, "handoff.cancel", { ...fence, confirmed: true });
      save(directory, "settlement.json", { status: result.outcome, artifactRefs });
      return receipt(result.outcome, claim.id, directory);
    } catch { return receipt("unknown", String(h.id), directory); }
  }
  return recovery ?? receipt("empty");
}
export async function runWorker(path: string, mode: "once" | "run", signal: AbortSignal, output: (result: WorkerReceipt) => void): Promise<void> {
  const config = loadWorkerConfig(path);
  do {
    const result = await workerOnce(config, signal); output(result);
    if (mode === "once" || signal.aborted) return;
    try { await delay(config.pollMs, undefined, { signal }); } catch { return; }
  } while (!signal.aborted);
}
