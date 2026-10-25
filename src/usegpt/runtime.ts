import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ArkSpacePaths } from "../config/paths.js";
import { withFileLock, writeJsonAtomic } from "../io/json-store.js";
import type { ChatGptCdpDriver } from "../providers/usegpt-cdp.js";
import { UseGptTaskSchema, UseGptInputSchemas, useGptFailure, useGptSuccess, type UseGptTask, type UseGptEnvelope, type UseGptCapability, type UseGptTaskStartInput } from "../protocol/usegpt-schema.js";
import { parseRequest, StatusSchema } from "./contracts.js";

export type UseGptDriver = Pick<ChatGptCdpDriver, "verify" | "run">;
const IMPLEMENTATION = "chatgpt-cdp-v1";
const DriverResultSchema = z.object({
  output: UseGptTaskSchema.shape.output.unwrap(), targetId: z.string().min(1).max(256),
  conversationUrl: UseGptTaskSchema.shape.conversationUrl,
  warnings: z.array(z.string().max(1000)).max(30),
  artifacts: z.array(z.object({ name: z.string().max(255), mimeType: z.string().max(128), contentBase64: z.string().max(28_000_000) }).strict()).max(100).optional(),
}).strict();
const RecordSchema = z.object({ task: UseGptTaskSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), implementation: z.literal(IMPLEMENTATION) }).strict();
const StateSchema = z.object({ records: z.array(RecordSchema) }).strict().superRefine((v, ctx) => {
  if (new Set(v.records.map(r => r.task.taskId)).size !== v.records.length || new Set(v.records.map(r => r.task.requestId)).size !== v.records.length) ctx.addIssue({ code: "custom", message: "Duplicate tasks." });
});
type State = z.infer<typeof StateSchema>;
type Pending = { input: UseGptTaskStartInput; conversationId?: string };
const active = new Set<UseGptTask["status"]>(["queued", "running", "cancellation_requested", "possibly_running"]);
const now = () => new Date().toISOString();
const binaryWarning = "Binary artifact downloads are unsupported; only local assistant text is available as result.txt.";
class RuntimeFailure extends Error { constructor(readonly kind: string, message: string) { super(message); } }

export class UseGptRuntime {
  private state: State = { records: [] };
  private readonly pending = new Map<string, Pending>();
  private readonly statePath: string;
  private serial: Promise<unknown> = Promise.resolve();
  private worker: Promise<void> | undefined;
  private current: { taskId: string; controller: AbortController } | undefined;
  private closed = false;
  private fatal = false;
  private readonly waiters = new Set<() => void>();

  constructor(paths: ArkSpacePaths, private readonly driver: UseGptDriver) {
    this.statePath = join(paths.home, "usegpt", "tasks.json");
  }
  async initialize(): Promise<void> {
    await withFileLock(this.statePath, async () => {
      let raw: string;
      try { raw = await readFile(this.statePath, "utf8"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Unable to read UseGPT state."); raw = '{"records":[]}'; }
      try { this.state = StateSchema.parse(JSON.parse(raw)); }
      catch { throw new Error("UseGPT state is invalid; it has not been overwritten."); }
      for (const { task } of this.state.records) {
        if (task.status === "queued") {
          task.status = "failed";
          task.error = { kind: "recovery", message: "Service restarted; queued prompt was held only in memory and cannot be recovered." };
          task.updatedAt = now();
        } else if (active.has(task.status)) {
          task.status = "possibly_running";
          task.warnings = [...task.warnings.slice(0, 28), "Service restarted; remote execution may still be running. No retry was attempted."];
          task.updatedAt = now();
        }
      }
      await writeJsonAtomic(this.statePath, StateSchema.parse(this.state));
    });
  }
  private transaction<T>(action: () => Promise<T>): Promise<T> {
    const next = this.serial.then(action);
    this.serial = next.catch(() => undefined);
    return next;
  }
  private async persist(): Promise<void> {
    try { await withFileLock(this.statePath, () => writeJsonAtomic(this.statePath, StateSchema.parse(this.state))); }
    catch { this.fatal = true; throw new RuntimeFailure("state", "UseGPT state could not be persisted; service must restart."); }
    for (const wake of this.waiters) wake();
  }
  private find(taskId: string) {
    const record = this.state.records.find(r => r.task.taskId === taskId);
    if (!record) throw new RuntimeFailure("not_found", "UseGPT task not found.");
    return record;
  }
  private taskData(task: UseGptTask): Record<string, unknown> { return { ...UseGptTaskSchema.parse(task) }; }

  async invoke(request: unknown, disconnect?: AbortSignal): Promise<UseGptEnvelope> {
    let capability: UseGptCapability = "usegpt.connection.status";
    try {
      const parsed = parseRequest(request); capability = parsed.capability;
      if (this.closed || this.fatal) throw new RuntimeFailure("service", "UseGPT service is unavailable.");
      const input = parsed.input;
      switch (capability) {
        case "usegpt.connection.status": {
          try { return useGptSuccess(capability, StatusSchema.parse(await this.driver.verify(disconnect))); }
          catch { return useGptSuccess(capability, { connected: false, authenticated: false, composerAvailable: false }); }
        }
        case "usegpt.task.start":
        case "usegpt.task.follow_up": {
          const value = capability === "usegpt.task.start" ? UseGptInputSchemas[capability].parse(input) : UseGptInputSchemas["usegpt.task.follow_up"].parse(input);
          const task = await this.transaction(async () => {
            const fingerprint = createHash("sha256").update(JSON.stringify({ capability, ...value })).digest("hex");
            const existing = this.state.records.find(r => r.task.requestId === value.requestId);
            if (existing) {
              if (existing.fingerprint !== fingerprint) throw new RuntimeFailure("conflict", "requestId already exists with different input.");
              return this.taskData(existing.task);
            }
            let conversationId: string | undefined;
            if ("taskId" in value && typeof value.taskId === "string") {
              const parent = this.find(value.taskId);
              if (parent.implementation !== IMPLEMENTATION || parent.task.status !== "completed" || !parent.task.conversationUrl) throw new RuntimeFailure("state", "Follow-up requires a completed task from the same implementation with a valid conversation URL.");
              conversationId = UseGptTaskSchema.parse(parent.task).conversationUrl!.split("/").at(-1)!;
            }
            const stamp = now();
            const task: UseGptTask = { taskId: `ugpt_${randomUUID()}`, requestId: value.requestId, status: "queued", mode: value.mode, createdAt: stamp, updatedAt: stamp, artifacts: [], warnings: [] };
            this.state.records.push({ task, fingerprint, implementation: IMPLEMENTATION });
            await this.persist();
            this.pending.set(task.taskId, { input: value, ...(conversationId ? { conversationId } : {}) });
            return this.taskData(task);
          });
          this.kick();
          return useGptSuccess(capability, task);
        }
        case "usegpt.task.list": {
          const value = UseGptInputSchemas[capability].parse(input);
          return useGptSuccess(capability, { tasks: this.state.records.slice(-value.limit).reverse().map(r => this.taskData(r.task)) });
        }
        case "usegpt.artifact.get": {
          const value = UseGptInputSchemas[capability].parse(input);
          const task = this.find(value.taskId).task;
          const metadata = task.artifacts.find(a => a.id === value.artifactId);
          if (!metadata || value.artifactId !== "result" || task.output === undefined) throw new RuntimeFailure("unsupported", binaryWarning);
          const bytes = Buffer.from(task.output, "utf8");
          if (value.offset > bytes.length || value.offset < bytes.length && (bytes[value.offset]! & 0xc0) === 0x80) throw new RuntimeFailure("range", "Offset must be a UTF-8 byte boundary within the artifact.");
          let end = Math.min(bytes.length, value.offset + value.limit);
          while (end < bytes.length && end > value.offset && (bytes[end]! & 0xc0) === 0x80) end--;
          if (end === value.offset && end < bytes.length) throw new RuntimeFailure("range", "Limit is too small for the next UTF-8 character.");
          return useGptSuccess(capability, { artifact: metadata, encoding: "utf8", content: bytes.subarray(value.offset, end).toString("utf8"), offset: value.offset, nextOffset: end, eof: end === bytes.length });
        }
        case "usegpt.task.wait": {
          const value = UseGptInputSchemas[capability].parse(input);
          const deadline = Date.now() + value.timeoutMs;
          while (active.has(this.find(value.taskId).task.status) && Date.now() < deadline && !this.closed && !disconnect?.aborted) {
            await new Promise<void>(resolve => {
              const wake = () => { clearTimeout(timer); this.waiters.delete(wake); disconnect?.removeEventListener("abort", wake); resolve(); };
              const timer = setTimeout(wake, Math.max(1, deadline - Date.now()));
              this.waiters.add(wake); disconnect?.addEventListener("abort", wake, { once: true });
            });
          }
          return useGptSuccess(capability, this.taskData(this.find(value.taskId).task));
        }
        case "usegpt.task.cancel": {
          const value = UseGptInputSchemas[capability].parse(input);
          const task = await this.transaction(async () => {
            const task = this.find(value.taskId).task;
            if (task.status === "queued") {
              task.status = "cancelled"; this.pending.delete(task.taskId); task.updatedAt = now(); await this.persist();
            } else if (active.has(task.status)) {
              task.status = "cancellation_requested";
              task.warnings = [...task.warnings.slice(0, 28), "Cancellation requested; remote execution is not guaranteed to stop."];
              task.updatedAt = now(); await this.persist();
              if (this.current?.taskId === task.taskId) this.current.controller.abort();
              else { task.status = "possibly_running"; await this.persist(); }
            }
            return this.taskData(task);
          });
          return useGptSuccess(capability, task);
        }
        case "usegpt.task.get": {
          const value = UseGptInputSchemas[capability].parse(input);
          return useGptSuccess(capability, this.taskData(this.find(value.taskId).task));
        }
      }
    } catch (e) {
      return useGptFailure(capability, e instanceof RuntimeFailure ? e.kind : "request", e instanceof RuntimeFailure ? e.message : "Invalid UseGPT request or result.");
    }
  }
  private kick(): void {
    if (this.worker || this.closed || this.fatal) return;
    this.worker = this.drain().catch(() => { this.fatal = true; }).finally(() => {
      this.worker = undefined;
      if (this.pending.size && !this.closed && !this.fatal) this.kick();
    });
  }
  private async drain(): Promise<void> {
    while (!this.closed && !this.fatal && this.pending.size) {
      const next = await this.transaction(async () => {
        const entry = this.pending.entries().next().value;
        if (!entry) return undefined;
        const [taskId, job] = entry;
        this.pending.delete(taskId);
        const task = this.find(taskId).task;
        if (task.status !== "queued") return undefined;
        task.status = "running"; task.updatedAt = now(); await this.persist();
        const controller = new AbortController();
        this.current = { taskId, controller };
        return { taskId, job, controller };
      });
      if (!next) continue;
      const { taskId, job, controller } = next;
      let submitted = false;
      const timer = setTimeout(() => controller.abort(), job.input.timeoutMs);
      try {
        const result = DriverResultSchema.parse(await this.driver.run({ prompt: job.input.prompt, mode: job.input.mode, timeoutMs: job.input.timeoutMs, files: job.input.files, ...(job.conversationId ? { conversationId: job.conversationId } : {}) }, {
          onSubmitted: async () => {
            await this.transaction(async () => {
              if (controller.signal.aborted || this.closed) throw new RuntimeFailure("cancelled", "Task cancelled before dispatch.");
              const task = this.find(taskId).task;
              task.status = "possibly_running"; task.updatedAt = now();
              await this.persist();
              submitted = true;
            });
          },
        }, controller.signal));
        if (!submitted) throw new RuntimeFailure("driver", "Driver returned without recording submission.");
        await this.transaction(async () => {
          const task = this.find(taskId).task;
          const bytes = Buffer.from(result.output, "utf8");
          const completed = UseGptTaskSchema.parse({ ...task, status: "completed", output: result.output,
            ...(result.conversationUrl ? { conversationUrl: result.conversationUrl } : {}),
            artifacts: [{ id: "result", name: "result.txt", mimeType: "text/plain; charset=utf-8", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }],
            warnings: [...task.warnings, ...(result.warnings.length ? ["Driver reported limitations; binary uploads and downloads are unsupported."] : []), binaryWarning].slice(0, 30), updatedAt: now(),
          });
          this.find(taskId).task = completed; await this.persist();
        });
      } catch {
        await this.transaction(async () => {
          const task = this.find(taskId).task;
          task.status = submitted || task.status === "possibly_running" ? "possibly_running" : controller.signal.aborted ? "cancelled" : "failed";
          task.error = { kind: controller.signal.aborted ? "interrupted" : "driver", message: submitted ? "Remote outcome is uncertain; no retry was attempted." : "Task ended before confirmed submission." };
          if (submitted) task.warnings = [...task.warnings.slice(0, 28), "Remote execution may still be running. No retry was attempted."];
          task.updatedAt = now(); await this.persist();
        });
      } finally { clearTimeout(timer); this.current = undefined; }
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.current?.controller.abort();
    this.pending.clear();
    for (const wake of this.waiters) wake();
    // Retain ownership until the driver settles; abort does not promise remote cancellation.
    await this.worker;
    await this.serial;
  }
}
