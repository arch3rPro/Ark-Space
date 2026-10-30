import { createHash, randomUUID } from "node:crypto";
import { constants, chmodSync, closeSync, createReadStream, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, unlinkSync, writeFileSync, writeSync, type ReadStream } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { migrateHubSchema } from "./hub-schema.js";

export interface HubProject { id: string; name: string; description: string; status: string; createdAt: string; updatedAt: string; }
export interface HubTask { id: string; projectId: string; title: string; request: string; status: string; createdAt: string; updatedAt: string; }
export interface HubArtifact { id: string; artifactId: string; projectId: string; taskId?: string; name: string; kind: string; mediaType: string; revision: number; sha256: string; sizeBytes: number; createdAt: string; availability: string; }
export interface HubStoreOptions { maxInlineBytes?: number; maxFileBytes?: number; maxProjectBytes?: number; maxTaskBytes?: number; maxStorageBytes?: number; }
export interface PublishStreamInput { projectId: string; taskId?: string; artifactId?: string; name: string; kind?: string; mediaType?: string; idempotencyKey?: string; declaredSize?: number; }
export interface ExportArtifactInput { artifactId: string; revision?: number; projectId?: string; taskId?: string; }
export interface ArtifactExport { artifact: Record<string, unknown>; stream: ReadStream; }
type ByteSource = AsyncIterable<Uint8Array>;
type Row = Record<string, unknown>;
type Ref = { artifactId: string; revision: number };
const ACTIVE_HANDOFF = "('pending','claimed','running','unknown')";
const MAX_INLINE = 1_048_576;
const now = () => new Date().toISOString();
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export class HubStoreError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "HubStoreError"; }
}
function fail(code: string, message?: string): never { throw new HubStoreError(code, message); }
function text(input: Row, key: string, max = 255, fallback?: string): string {
  const value = input[key] ?? fallback;
  if (typeof value !== "string" || value.length > max || value.includes("\0") || (!value.length && fallback === undefined)) fail("invalid_input", `Invalid ${key}.`);
  return value;
}
function integer(input: Row, key: string, fallback: number, min: number, max: number): number {
  const value = input[key] ?? fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("invalid_input", `Invalid ${key}.`);
  return value;
}
function id(input: Row, key: string, prefix: string): string {
  const value = text(input, key, 80);
  if (!new RegExp(`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, "i").test(value)) fail("invalid_input", `Invalid ${key}.`);
  return value;
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 12) fail("invalid_input", "Input nesting exceeds limit.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) { if (value.length > 100) fail("invalid_input"); return `[${value.map(v => canonical(v, depth + 1)).join(",")}]`; }
  if (typeof value !== "object" || !value || Object.getPrototypeOf(value) !== Object.prototype) fail("invalid_input");
  const entries = Object.entries(value).filter(([k]) => k !== "requestId" && k !== "idempotencyKey").sort(([a], [b]) => a.localeCompare(b));
  if (entries.length > 50) fail("invalid_input");
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v, depth + 1)}`).join(",")}}`;
}

/** Local-owner storage. Every operation holds SQLite's writer lock through bounded file I/O.
 * No await occurs inside a transaction, so independent connections cannot deadlock the event loop.
 * The adapter must enforce caller authentication/project allowlists before invoking this API.
 */
export class UseGptHubStore {
  readonly database: DatabaseSync;
  readonly blobDir: string;
  readonly dataDir: string;
  private readonly stagingDir: string;
  private readonly limits: Required<HubStoreOptions>;
  private closed = false;
  private publishedPaths: string[] = [];

  static async open(dataDir: string, options: HubStoreOptions = {}): Promise<UseGptHubStore> { return new UseGptHubStore(dataDir, options); }

  constructor(dataDir: string, options: HubStoreOptions = {}) {
    this.dataDir = resolve(dataDir);
    this.blobDir = join(this.dataDir, "objects", "sha256");
    this.stagingDir = join(this.dataDir, "staging");
    this.limits = { maxInlineBytes: MAX_INLINE, maxFileBytes: 67_108_864, maxProjectBytes: 1_073_741_824, maxTaskBytes: 268_435_456, maxStorageBytes: 10_737_418_240, ...options };
    for (const value of Object.values(this.limits)) if (!Number.isSafeInteger(value) || value < 1) fail("invalid_input", "Quota must be a positive safe integer.");
    if (this.limits.maxInlineBytes > MAX_INLINE) fail("invalid_input", "Inline limit cannot exceed 1 MiB.");
    this.directory(this.dataDir);
    this.directory(this.blobDir);
    this.directory(this.stagingDir);
    const path = join(this.dataDir, "index.sqlite");
    for (const suffix of ["", "-wal", "-shm", "-journal"]) this.safeFile(path + suffix, true);
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); closeSync(fd);
    chmodSync(path, 0o600);
    this.database = new DatabaseSync(path);
    try {
      this.database.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;");
      this.transaction(() => {
        migrateHubSchema(this.database);
        this.expireUploads();
        const directory = opendirSync(this.stagingDir);
        try {
          for (let scanned = 0; scanned < 100; scanned++) {
            const entry = directory.readSync(); if (!entry) break;
            if (!/^[0-9a-f-]{36}\.partial$/.test(entry.name)) continue;
            const uploadId = entry.name.slice(0, -".partial".length);
            if (this.get("SELECT 1 FROM uploads WHERE id=?", uploadId)) continue;
            const partial = join(this.stagingDir, entry.name), stat = lstatSync(partial);
            if (!stat.isFile() || stat.isSymbolicLink() || typeof process.getuid === "function" && stat.uid !== process.getuid()) continue;
            unlinkSync(partial);
          }
        } finally { directory.closeSync(); }
      });
      for (const suffix of ["-wal", "-shm"]) if (existsSync(path + suffix)) chmodSync(path + suffix, 0o600);
    } catch (error) { this.database.close(); throw error; }
  }

  async close(): Promise<void> { if (!this.closed) { this.database.close(); this.closed = true; } }
  private get(sql: string, ...args: SQLInputValue[]): Row | undefined { return this.database.prepare(sql).get(...args) as Row | undefined; }
  private all(sql: string, ...args: SQLInputValue[]): Row[] { return this.database.prepare(sql).all(...args) as Row[]; }
  private run(sql: string, ...args: SQLInputValue[]): void { this.database.prepare(sql).run(...args); }
  private transaction<T>(fn: () => T): T {
    if (this.closed) fail("store_closed");
    this.database.exec("BEGIN IMMEDIATE");
    this.publishedPaths = [];
    try { const result = fn(); this.database.exec("COMMIT"); this.publishedPaths = []; return result; }
    catch (error) {
      // Keep the writer lock until cleanup finishes; another publisher may reuse this hash.
      for (const path of this.publishedPaths) {
        try { this.safeFile(path); unlinkSync(path); } catch { /* crash recovery may leave an unindexed object; never expose it */ }
      }
      this.publishedPaths = [];
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  private event(type: string, projectId: string, objectId: string, taskId?: string): void {
    this.run("INSERT INTO outbox_events(id,project_id,task_id,type,object_id,created_at) VALUES(?,?,?,?,?,?)", `event_${randomUUID()}`, projectId, taskId ?? null, type, objectId, now());
  }
  private project(projectId: string, deleted = false): Row {
    const row = this.get("SELECT id,name,description,status,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE id=?", projectId);
    if (!row) fail("project_not_found");
    if (!deleted && row.status === "deleted") fail("project_deleted");
    return row;
  }
  private task(taskId: string, deleted = false): Row {
    const row = this.get("SELECT id,project_id AS projectId,title,request,status,created_at AS createdAt,updated_at AS updatedAt FROM tasks WHERE id=?", taskId);
    if (!row) fail("task_not_found");
    this.project(String(row.projectId), deleted);
    if (!deleted && row.status === "deleted") fail("task_deleted");
    return row;
  }
  private writableTask(taskId: string, projectId: string): Row {
    const task = this.task(taskId);
    if (task.projectId !== projectId) fail("project_mismatch");
    if (!["queued", "active", "waiting"].includes(String(task.status))) fail("task_terminal");
    return task;
  }
  private writableProject(projectId: string): void { if (this.project(projectId).status !== "active") fail("project_archived"); }

  createProject(name: string, description = ""): HubProject {
    // SAFETY: explicit project projection returns the HubProject field set.
    return this.transaction(() => this.createProjectRow({ name, description })) as unknown as HubProject;
  }
  private createProjectRow(input: Row): Row {
    const name = text(input, "name"), description = text(input, "description", 8_000, "");
    const projectId = `project_${randomUUID()}`, stamp = now();
    this.run("INSERT INTO projects(id,name,description,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)", projectId, name, description, stamp, stamp);
    this.event("project.created", projectId, projectId);
    return this.project(projectId);
  }
  createTask(projectId: string, title: string, request: string): HubTask {
    // SAFETY: explicit task projection returns the HubTask field set.
    return this.transaction(() => this.createTaskRow({ projectId, title, request })) as unknown as HubTask;
  }
  private createTaskRow(input: Row): Row {
    const projectId = id(input, "projectId", "project"); this.writableProject(projectId);
    const title = text(input, "title"), request = text(input, "request", 64_000, "");
    const refs = this.refs(input, projectId);
    const retainedBytes = refs.reduce((total, ref) => total + Number(this.artifact(ref).sizeBytes), 0);
    if (retainedBytes > this.limits.maxTaskBytes) fail("quota_exceeded");
    const taskId = `task_${randomUUID()}`, stamp = now();
    this.run("INSERT INTO tasks(id,project_id,title,request,status,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)", taskId, projectId, title, request, stamp, stamp);
    for (const ref of refs) this.run("INSERT OR IGNORE INTO task_artifacts VALUES(?,?,?)", taskId, ref.artifactId, ref.revision);
    this.event("task.created", projectId, taskId, taskId);
    return this.task(taskId);
  }
  listTasks(projectId: string): HubTask[] {
    // SAFETY: taskList projects the task metadata fields; request is loaded for compatibility.
    return this.transaction(() => { this.project(projectId); return (this.taskList({ projectId }).tasks as Row[]).map(row => this.task(String(row.id))); }) as unknown as HubTask[];
  }
  private taskList(input: Row): Row {
    const projectId = input.projectId === undefined ? undefined : id(input, "projectId", "project");
    if (projectId) this.project(projectId);
    const limit = integer(input, "limit", 50, 1, 100), offset = integer(input, "offset", 0, 0, 1_000_000);
    const tasks = projectId
      ? this.all("SELECT id,project_id AS projectId,title,status,created_at AS createdAt,updated_at AS updatedAt FROM tasks WHERE project_id=? AND (? OR status<>'deleted') ORDER BY created_at,id LIMIT ? OFFSET ?", projectId, input.includeDeleted === true ? 1 : 0, limit, offset)
      : this.all("SELECT id,project_id AS projectId,title,status,created_at AS createdAt,updated_at AS updatedAt FROM tasks WHERE (? OR status<>'deleted') ORDER BY created_at,id LIMIT ? OFFSET ?", input.includeDeleted === true ? 1 : 0, limit, offset);
    return { tasks, nextOffset: tasks.length === limit ? offset + limit : null };
  }

  /** Streams to managed staging with a quota reservation; source idle timeout is 60s, total 5min. */
  async publishStream(input: PublishStreamInput, source: ByteSource): Promise<Row> {
    const value = { ...input }, projectId = id(value, "projectId", "project");
    text(value, "name"); text(value, "kind", 80, "document"); text(value, "mediaType", 128, "application/octet-stream");
    const taskId = input.taskId === undefined ? null : id(value, "taskId", "task");
    const key = input.idempotencyKey === undefined ? null : text(value, "idempotencyKey", 200);
    const declaredSize = input.declaredSize;
    if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 0)) fail("invalid_input");
    const reserved = declaredSize ?? this.limits.maxFileBytes;
    if (reserved > this.limits.maxFileBytes) fail("quota_exceeded");
    if (!source || typeof source[Symbol.asyncIterator] !== "function") fail("invalid_input");
    const uploadId = randomUUID(), partial = join(this.stagingDir, `${uploadId}.partial`);
    this.transaction(() => {
      this.expireUploads();
      this.writableProject(projectId); if (taskId) this.writableTask(taskId, projectId);
      if (Number(this.get("SELECT count(*) AS n FROM uploads")!.n) >= 16) fail("upload_busy");
      this.checkQuota(projectId, taskId, reserved);
      this.run("INSERT INTO uploads VALUES(?,?,?,?,?,?)", uploadId, projectId, taskId, reserved, key, new Date(Date.now() + 360_000).toISOString());
      this.directory(this.stagingDir);
    });
    let fd: number | undefined, iterator: AsyncIterator<Uint8Array> | undefined, done = false;
    const deadline = Date.now() + 300_000;
    try {
      fd = openSync(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      iterator = source[Symbol.asyncIterator]();
      const digest = createHash("sha256"); let size = 0;
      while (true) {
        const remaining = Math.min(60_000, deadline - Date.now()); if (remaining <= 0) fail("upload_timeout");
        let timer: ReturnType<typeof setTimeout> | undefined;
        let next: IteratorResult<Uint8Array>;
        try {
          next = await Promise.race([iterator.next(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new HubStoreError("upload_timeout")), remaining); })]);
        } finally { if (timer) clearTimeout(timer); }
        if (next.done) { done = true; break; }
        const chunk = next.value;
        if (!(chunk instanceof Uint8Array)) fail("invalid_input", "Byte source must yield Uint8Array chunks.");
        if (size > reserved - chunk.byteLength) fail(declaredSize === undefined ? "quota_exceeded" : "size_mismatch");
        let offset = 0;
        while (offset < chunk.byteLength) { const written = writeSync(fd, chunk, offset, Math.min(65_536, chunk.byteLength - offset)); if (!written) fail("storage_write_failed"); offset += written; }
        digest.update(chunk); size += chunk.byteLength;
      }
      fsyncSync(fd); closeSync(fd); fd = undefined;
      if (declaredSize !== undefined && declaredSize !== size) fail("size_mismatch");
      const sha256 = digest.digest("hex"), operation = "artifact.publish_stream";
      const fingerprint = hash(canonical({ projectId, taskId, artifactId: input.artifactId ?? null, name: input.name, kind: input.kind ?? "document", mediaType: input.mediaType ?? "application/octet-stream", sha256, sizeBytes: size }));
      return this.transaction(() => {
        this.writableProject(projectId); if (taskId) this.writableTask(taskId, projectId);
        if (!this.get("SELECT 1 FROM uploads WHERE id=? AND expires_at>?", uploadId, now())) fail("upload_expired");
        this.run("DELETE FROM uploads WHERE id=?", uploadId);
        if (key) {
          const old = this.get("SELECT fingerprint,result FROM idempotency WHERE scope=? AND operation=? AND key=?", projectId, operation, key);
          if (old) {
            if (old.fingerprint !== fingerprint) fail("idempotency_conflict");
            const receipt = this.receipt(old); this.artifact({ artifactId: receipt.id, revision: receipt.revision, projectId });
            return receipt;
          }
        }
        const published = this.publishStored(value, sha256, size, partial);
        if (key) this.run("INSERT INTO idempotency VALUES(?,?,?,?,?,?,?)", projectId, operation, key, fingerprint, JSON.stringify(published), projectId, taskId);
        return published;
      });
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (!done && iterator?.return) {
        try { void Promise.resolve(iterator.return()).catch(() => undefined); } catch { /* source cleanup cannot prevent staging cleanup */ }
      }
      try { this.transaction(() => this.run("DELETE FROM uploads WHERE id=?", uploadId)); } finally {
        try { unlinkSync(partial); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
  }

  async publishBytes(input: PublishStreamInput, bytes: Uint8Array): Promise<Row> {
    return this.publishStream({ ...input, declaredSize: input.declaredSize ?? bytes.byteLength }, (async function* () { yield bytes; })());
  }

  /** Open descriptor survives unlink by purge. Caller must consume or destroy stream. */
  async exportArtifact(input: ExportArtifactInput): Promise<ArtifactExport> {
    let stream: ReadStream | undefined;
    try {
      return this.transaction(() => {
        const artifact = this.artifact({ ...input }), fd = this.openVerifiedBlob(String(artifact.sha256), Number(artifact.sizeBytes));
        try { stream = createReadStream("", { fd, start: 0, autoClose: true, highWaterMark: 65_536 }); }
        catch (error) { closeSync(fd); throw error; }
        return { artifact, stream };
      });
    } catch (error) { stream?.destroy(); throw error; }
  }

  /** Bounded binary page. Larger exports use exportArtifact(). */
  async getBinary(input: ExportArtifactInput & { offset?: number; limit?: number }): Promise<Uint8Array> {
    return this.transaction(() => {
      const value = { ...input }, artifact = this.artifact(value);
      const offset = integer(value, "offset", 0, 0, Number(artifact.sizeBytes)), limit = integer(value, "limit", 100_000, 1, 100_000);
      const fd = this.openVerifiedBlob(String(artifact.sha256), Number(artifact.sizeBytes));
      try { return this.readPage(fd, offset, Math.min(limit, Number(artifact.sizeBytes) - offset)); } finally { closeSync(fd); }
    });
  }

  async publishText(input: { projectId: string; taskId?: string; name: string; kind?: string; mediaType?: string; content: string }): Promise<HubArtifact> {
    // SAFETY: publish_inline returns the artifact revision projection.
    return await this.execute("artifact.publish_inline", input) as unknown as HubArtifact;
  }
  async readArtifact(artifactId: string, scope: Omit<ExportArtifactInput, "artifactId"> = {}): Promise<string> {
    const result = await this.execute("artifact.read", { ...scope, artifactId, limit: 100_000 });
    if (!result.eof) fail("read_limit_exceeded", "Use paginated artifact.read for content above 100000 bytes.");
    return String(result.content);
  }

  /** Logical operation names; usegpt. prefix is also accepted. Lists use limit <=100 and offset.
   * task.get/project.get include up to 100 events after eventCursor. task.wait is a nonblocking poll.
   * Purge requires prior soft deletion; delete.preview returns a version-bound planToken, optional on purge.
   */
  async execute(operation: string, input: Row): Promise<Row> {
    operation = operation.replace(/^usegpt\./, "");
    const serialized = canonical(input);
    if (Buffer.byteLength(serialized) > MAX_INLINE * 6 + 100_000) fail("invalid_input", "Input exceeds limit.");
    const result = this.transaction(() => {
      this.expireUploads();
      const mutating = !["project.list", "project.get", "project.history", "task.list", "task.get", "task.wait", "task.history", "artifact.list", "artifact.describe", "artifact.read", "artifact.export", "artifact.history", "artifact.publish_status", "handoff.list", "handoff.get", "storage.usage", "delete.preview"].includes(operation);
      const key = input.idempotencyKey === undefined ? undefined : text(input, "idempotencyKey", 200);
      const scope = input.projectId !== undefined ? id(input, "projectId", "project") : "owner";
      if (key && mutating) {
        const old = this.get("SELECT fingerprint,result,project_id AS projectId,task_id AS taskId FROM idempotency WHERE scope=? AND operation=? AND key=?", scope, operation, key);
        if (old) {
          if (old.fingerprint !== hash(serialized)) fail("idempotency_conflict");
          if (old.projectId) this.project(String(old.projectId));
          if (old.taskId) this.task(String(old.taskId));
          const receipt = this.receipt(old);
          if (operation.startsWith("artifact.publish")) this.artifact({ ...input, artifactId: receipt.id, revision: receipt.revision });
          return receipt;
        }
      }
      const result = this.dispatch(operation, input);
      if (key && mutating && !operation.endsWith(".purge")) {
        const projectId = result.projectId ?? (operation.startsWith("project.") ? result.id : undefined);
        const taskId = result.taskId ?? (operation.startsWith("task.") ? result.id : undefined);
        this.run("INSERT INTO idempotency VALUES(?,?,?,?,?,?,?)", scope, operation, key, hash(serialized), JSON.stringify(result), typeof projectId === "string" ? projectId : null, typeof taskId === "string" ? taskId : null);
      }
      return result;
    });
    if (operation.endsWith(".purge") || operation === "storage.usage") {
      this.transaction(() => this.reclaim());
      if (operation.endsWith(".purge")) result.pendingReclamation = !!this.get("SELECT 1 FROM delete_jobs LIMIT 1");
    }
    return result;
  }

  private dispatch(operation: string, input: Row): Row {
    switch (operation) {
      case "project.create": return this.createProjectRow(input);
      case "task.create": return this.createTaskRow(input);
      case "project.list": {
        const limit = integer(input, "limit", 50, 1, 100), offset = integer(input, "offset", 0, 0, 1_000_000);
        const projects = this.all("SELECT id,name,description,status,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE (? OR status<>'deleted') ORDER BY created_at,id LIMIT ? OFFSET ?", input.includeDeleted === true ? 1 : 0, limit, offset);
        return { projects, nextOffset: projects.length === limit ? offset + limit : null };
      }
      case "task.list": return this.taskList(input);
      case "project.history": return this.history(input, "project");
      case "task.history": return this.history(input, "task");
      case "project.get": case "task.get": case "task.wait": {
        const taskId = operation.startsWith("task.") ? id(input, "taskId", "task") : undefined;
        const object = taskId ? this.task(taskId) : this.project(id(input, "projectId", "project"));
        this.checkScope(input, String(taskId ? object.projectId : object.id));
        const cursor = integer(input, "eventCursor", 0, 0, Number.MAX_SAFE_INTEGER);
        const events = this.all(`SELECT cursor,id,type,object_id AS objectId,created_at AS createdAt FROM outbox_events WHERE ${taskId ? "task_id" : "project_id"}=? AND cursor>? ORDER BY cursor LIMIT 100`, String(object.id), cursor);
        return { ...object, events, eventCursor: events.at(-1)?.cursor ?? cursor, ...(operation === "task.wait" ? { pending: ["queued", "active", "waiting"].includes(String(object.status)) } : {}) };
      }
      case "project.archive": case "project.delete": case "project.restore": case "task.complete": case "task.waiting": case "task.cancel": case "task.delete": case "task.restore": return this.changeStatus(operation, input);
      case "project.purge": case "task.purge": return this.purge(operation, input);
      case "artifact.publish_inline": return this.publish(input);
      case "artifact.publish_status": return this.publishStatus(input);
      case "artifact.publish_stream": return fail("unsupported_operation", "Use publishStream() for byte sources.");
      case "artifact.export": return this.exportDescriptor(input);
      case "artifact.history": return this.history(input, "artifact");
      case "artifact.describe": return this.artifact(input);
      case "artifact.read": return this.read(input);
      case "artifact.list": return this.artifactList(input);
      case "artifact.delete": {
        const artifact = this.artifact(input);
        if (this.get(`SELECT 1 FROM handoff_artifacts r JOIN handoffs h ON h.id=r.handoff_id WHERE r.artifact_id=? AND h.status IN ${ACTIVE_HANDOFF} LIMIT 1`, String(artifact.id))) fail("handoff_busy");
        this.run("UPDATE artifacts SET status='deleted' WHERE id=?", String(artifact.id));
        this.event("artifact.deleted", String(artifact.projectId), String(artifact.id), typeof artifact.taskId === "string" ? artifact.taskId : undefined);
        return { ...artifact, availability: "deleted" };
      }
      case "handoff.create": return this.createHandoff(input);
      case "handoff.list": return this.handoffList(input);
      case "handoff.get": return this.handoff(input);
      case "handoff.claim": case "handoff.complete": case "handoff.fail": case "handoff.cancel": return this.changeHandoff(operation, input);
      case "storage.usage": return this.usage(input);
      case "delete.preview": return this.preview(input);
      default: return fail("unsupported_operation", `Unsupported hub operation: ${operation.slice(0, 100)}`);
    }
  }
  private checkScope(input: Row, projectId: string): void { if (input.projectId !== undefined && id(input, "projectId", "project") !== projectId) fail("project_mismatch"); }

  private changeStatus(operation: string, input: Row): Row {
    const isTask = operation.startsWith("task."), restoring = operation.endsWith(".restore"), deleting = operation.endsWith(".delete");
    const objectId = id(input, isTask ? "taskId" : "projectId", isTask ? "task" : "project");
    const object = isTask ? this.task(objectId, restoring || deleting) : this.project(objectId, restoring || deleting);
    const projectId = String(isTask ? object.projectId : object.id); this.checkScope(input, projectId);
    if (isTask) this.project(projectId);
    const table = isTask ? "tasks" : "projects";
    if (restoring) {
      if (object.status !== "deleted") fail("invalid_transition");
      this.run(`UPDATE ${table} SET status=COALESCE(previous_status,?),previous_status=NULL,updated_at=? WHERE id=?`, isTask ? "queued" : "active", now(), objectId);
    } else if (deleting) {
      if (object.status !== "deleted") this.run(`UPDATE ${table} SET previous_status=status,status='deleted',updated_at=? WHERE id=?`, now(), objectId);
    } else {
      if (object.status === "deleted") fail(isTask ? "task_deleted" : "project_deleted");
      const status = operation.endsWith(".archive") ? "archived" : operation.endsWith(".complete") ? "completed" : operation.endsWith(".cancel") ? "cancelled" : "waiting";
      if (isTask && !["queued", "active", "waiting", status].includes(String(object.status))) fail("invalid_transition");
      if (status === "completed" && this.get("SELECT 1 FROM uploads WHERE task_id=? LIMIT 1", objectId)) fail("upload_busy");
      if (status === "completed" && this.get(`SELECT 1 FROM handoffs WHERE task_id=? AND status IN ${ACTIVE_HANDOFF} LIMIT 1`, objectId)) fail("handoff_busy");
      const completionRefs = status === "completed" && isTask ? this.refs(input, projectId) : [];
      this.run(`UPDATE ${table} SET status=?,updated_at=? WHERE id=?`, status, now(), objectId);
      for (const ref of completionRefs) this.run("INSERT OR IGNORE INTO task_artifacts VALUES(?,?,?)", objectId, ref.artifactId, ref.revision);
    }
    this.event(operation.replace(/\.restore$/, ".restored").replace(/\.delete$/, ".deleted").replace(/\.complete$/, ".completed").replace(/\.cancel$/, ".cancelled"), projectId, objectId, isTask ? objectId : undefined);
    return isTask ? this.task(objectId, true) : this.project(objectId, true);
  }

  private artifact(input: Row, requireVisible = true): Row {
    const artifactId = id(input, "artifactId", "artifact");
    const revision = input.revision === undefined ? null : integer(input, "revision", 1, 1, 1_000_000);
    const row = this.get(`SELECT a.id,a.id AS artifactId,a.project_id AS projectId,a.owner_task_id AS taskId,a.name,a.kind,a.media_type AS mediaType,a.status AS availability,r.revision,r.sha256,r.size_bytes AS sizeBytes,r.created_at AS createdAt FROM artifacts a JOIN artifact_revisions r ON r.artifact_id=a.id WHERE a.id=? AND (? IS NULL OR r.revision=?) ORDER BY r.revision DESC LIMIT 1`, artifactId, revision, revision);
    if (!row) fail("artifact_not_found");
    this.checkScope(input, String(row.projectId));
    this.project(String(row.projectId));
    if (input.taskId !== undefined) {
      const taskId = id(input, "taskId", "task"); const task = this.task(taskId);
      if (task.projectId !== row.projectId) fail("project_mismatch");
      if (!this.get("SELECT 1 FROM task_artifacts WHERE task_id=? AND artifact_id=? AND revision=?", taskId, artifactId, Number(row.revision))) fail("artifact_not_found");
    }
    if (requireVisible && (row.availability === "deleted" || !this.visible(artifactId, Number(row.revision)))) fail("artifact_not_found");
    return row;
  }
  private visible(artifactId: string, revision: number): boolean {
    return !!this.get(`SELECT 1 FROM project_artifacts WHERE artifact_id=? AND revision=? UNION ALL SELECT 1 FROM task_artifacts r JOIN tasks t ON t.id=r.task_id WHERE r.artifact_id=? AND r.revision=? AND t.status<>'deleted' UNION ALL SELECT 1 FROM handoff_artifacts r JOIN handoffs h ON h.id=r.handoff_id JOIN tasks t ON t.id=h.task_id WHERE r.artifact_id=? AND r.revision=? AND t.status<>'deleted' AND h.status IN ${ACTIVE_HANDOFF} LIMIT 1`, artifactId, revision, artifactId, revision, artifactId, revision);
  }
  private refs(input: Row, projectId: string): Ref[] {
    if (input.artifactRefs === undefined) return [];
    if (!Array.isArray(input.artifactRefs) || input.artifactRefs.length > 100) fail("invalid_input");
    return input.artifactRefs.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_input");
      const r = value as Row;
      if (r.revision === undefined) fail("invalid_input", "Handoff and retained inputs require a fixed revision.");
      const artifact = this.artifact({ ...r, projectId });
      return { artifactId: String(artifact.id), revision: Number(artifact.revision) };
    });
  }
  private publish(input: Row): Row {
    const bytes = Buffer.from(text(input, "content", MAX_INLINE, ""), "utf8");
    if (bytes.length > this.limits.maxInlineBytes) fail("quota_exceeded");
    return this.publishStored({ ...input, mediaType: text(input, "mediaType", 128, "text/plain") }, hash(bytes), bytes.length, undefined, bytes);
  }

  private checkQuota(projectId: string, taskId: string | null, size: number, existingBlob = false): void {
    const projectBytes = Number(this.get("SELECT COALESCE(sum(r.size_bytes),0) AS n FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE a.project_id=?", projectId)!.n);
    const taskBytes = taskId ? Number(this.get("SELECT COALESCE(sum(r.size_bytes),0) AS n FROM task_artifacts t JOIN artifact_revisions r ON r.artifact_id=t.artifact_id AND r.revision=t.revision WHERE t.task_id=?", taskId)!.n) : 0;
    const physical = Number(this.get("SELECT COALESCE(sum(size_bytes),0) AS n FROM blobs")!.n);
    const reserved = this.get("SELECT COALESCE(sum(reserved_bytes),0) AS physical,COALESCE(sum(CASE WHEN project_id=? THEN reserved_bytes ELSE 0 END),0) AS project,COALESCE(sum(CASE WHEN task_id=? THEN reserved_bytes ELSE 0 END),0) AS task FROM uploads", projectId, taskId)!;
    if (projectBytes + Number(reserved.project) + size > this.limits.maxProjectBytes || taskId && taskBytes + Number(reserved.task) + size > this.limits.maxTaskBytes || physical + Number(reserved.physical) + (existingBlob ? 0 : size) > this.limits.maxStorageBytes) fail("quota_exceeded");
  }

  private publishStored(input: Row, sha256: string, size: number, stagedPath?: string, bytes?: Buffer): Row {
    const projectId = id(input, "projectId", "project"); this.writableProject(projectId);
    const taskId = input.taskId === undefined ? undefined : id(input, "taskId", "task");
    if (taskId) this.writableTask(taskId, projectId);
    const name = text(input, "name"), kind = text(input, "kind", 80, "document"), mediaType = text(input, "mediaType", 128, "application/octet-stream");
    if (kind === "link") fail("unsupported_operation", "External link artifacts are not implemented.");
    if (size > this.limits.maxFileBytes) fail("quota_exceeded");
    const stamp = now(); let artifactId: string, revision = 1;
    if (input.artifactId !== undefined) {
      const previous = this.artifact(input); artifactId = String(previous.id); revision = Number(this.get("SELECT max(revision) AS revision FROM artifact_revisions WHERE artifact_id=?", artifactId)!.revision) + 1;
      if (previous.name !== name || previous.kind !== kind || previous.mediaType !== mediaType) fail("artifact_metadata_conflict");
    } else artifactId = `artifact_${randomUUID()}`;
    const existing = this.get("SELECT size_bytes FROM blobs WHERE sha256=?", sha256);
    this.checkQuota(projectId, taskId ?? null, size, !!existing);
    if (existing && Number(existing.size_bytes) !== size) fail("artifact_content_corrupt");
    if (stagedPath !== undefined) this.publishStagedBlob(sha256, size, stagedPath);
    else if (bytes !== undefined) this.publishBlob(sha256, bytes);
    else fail("invalid_input");
    this.writableProject(projectId); if (taskId) this.writableTask(taskId, projectId);
    if (revision === 1) this.run("INSERT INTO artifacts(id,project_id,owner_task_id,name,kind,media_type,created_at) VALUES(?,?,?,?,?,?,?)", artifactId, projectId, taskId ?? null, name, kind, mediaType, stamp);
    this.run("INSERT OR IGNORE INTO blobs VALUES(?,?,?)", sha256, size, stamp);
    this.run("DELETE FROM delete_jobs WHERE sha256=?", sha256);
    this.run("INSERT INTO artifact_revisions VALUES(?,?,?,?,?)", artifactId, revision, sha256, size, stamp);
    if (taskId) this.run("INSERT INTO task_artifacts VALUES(?,?,?)", taskId, artifactId, revision); else this.run("INSERT INTO project_artifacts VALUES(?,?,?)", projectId, artifactId, revision);
    this.event(revision === 1 ? "artifact.available" : "artifact.revision_created", projectId, artifactId, taskId);
    return this.artifact({ artifactId, revision });
  }

  private receipt(row: Row): Row {
    try { const value: unknown = JSON.parse(String(row.result)); if (!value || typeof value !== "object" || Array.isArray(value)) fail("storage_corrupt"); return value as Row; }
    catch { return fail("storage_corrupt", "Invalid idempotency receipt."); }
  }

  private publishStatus(input: Row): Row {
    const key = text(input, "idempotencyKey", 200), projectId = id(input, "projectId", "project");
    this.project(projectId);
    const rows = this.all("SELECT operation,result FROM idempotency WHERE scope=? AND key=? AND operation IN ('artifact.publish_inline','artifact.publish_stream') ORDER BY rowid DESC LIMIT 1", projectId, key);
    if (!rows.length) return { status: this.get("SELECT 1 FROM uploads WHERE project_id=? AND idempotency_key=? LIMIT 1", projectId, key) ? "pending" : "unknown", idempotencyKey: key };
    const receipt = this.receipt(rows[0]!);
    const artifact = this.artifact({ ...input, artifactId: receipt.id, revision: receipt.revision });
    return { status: "available", idempotencyKey: key, artifact };
  }

  private exportDescriptor(input: Row): Row {
    const artifact = this.artifact(input);
    const offset = integer(input, "offset", 0, 0, Number(artifact.sizeBytes)), limit = integer(input, "limit", 20_000, 1, 100_000);
    const fd = this.openVerifiedBlob(String(artifact.sha256), Number(artifact.sizeBytes));
    try {
      const bytes = this.readPage(fd, offset, Math.min(limit, Number(artifact.sizeBytes) - offset));
      return { artifact, encoding: "base64", content: bytes.toString("base64"), offset, nextOffset: offset + bytes.length, eof: offset + bytes.length === Number(artifact.sizeBytes) };
    } finally { closeSync(fd); }
  }

  private history(input: Row, kind: "project" | "task" | "artifact"): Row {
    const objectId = kind === "project" ? id(input, "projectId", "project") : kind === "task" ? id(input, "taskId", "task") : id(input, "artifactId", "artifact");
    const projectId = kind === "project" ? objectId : kind === "task" ? String(this.task(objectId).projectId) : String(this.artifact(input).projectId);
    if (kind === "project") this.project(projectId); else this.checkScope(input, projectId);
    const afterCursor = integer(input, "afterCursor", 0, 0, Number.MAX_SAFE_INTEGER), limit = integer(input, "limit", 100, 1, 100);
    const eventType = input.eventType === undefined ? null : text(input, "eventType", 100);
    const rows = this.all(`SELECT cursor,id,type,object_id AS objectId,project_id AS projectId,task_id AS taskId,created_at AS createdAt FROM outbox_events WHERE cursor>? AND (? IS NULL OR type=?) AND ${kind === "project" ? "project_id=?" : kind === "task" ? "task_id=?" : "object_id=?"} ORDER BY cursor LIMIT ?`, afterCursor, eventType, eventType, objectId, limit);
    return { events: rows, nextCursor: rows.at(-1)?.cursor ?? afterCursor, hasMore: rows.length === limit };
  }

  private artifactList(input: Row): Row {
    const projectId = id(input, "projectId", "project"); this.project(projectId);
    const taskId = input.taskId === undefined ? null : id(input, "taskId", "task");
    if (taskId) { if (this.task(taskId).projectId !== projectId) fail("project_mismatch"); }
    const limit = integer(input, "limit", 50, 1, 100), offset = integer(input, "offset", 0, 0, 1_000_000);
    const rows = this.all(`SELECT a.id AS artifactId,r.revision FROM artifacts a JOIN artifact_revisions r ON r.artifact_id=a.id WHERE a.project_id=? AND a.status='available' AND r.revision=(SELECT max(r2.revision) FROM artifact_revisions r2 WHERE r2.artifact_id=a.id AND (? IS NULL OR EXISTS(SELECT 1 FROM task_artifacts tr WHERE tr.task_id=? AND tr.artifact_id=a.id AND tr.revision=r2.revision))) AND (? IS NULL OR EXISTS(SELECT 1 FROM task_artifacts tr WHERE tr.task_id=? AND tr.artifact_id=a.id AND tr.revision=r.revision)) AND (EXISTS(SELECT 1 FROM project_artifacts pr WHERE pr.artifact_id=a.id AND pr.revision=r.revision) OR EXISTS(SELECT 1 FROM task_artifacts tr JOIN tasks t ON t.id=tr.task_id WHERE tr.artifact_id=a.id AND tr.revision=r.revision AND t.status<>'deleted') OR EXISTS(SELECT 1 FROM handoff_artifacts hr JOIN handoffs h ON h.id=hr.handoff_id JOIN tasks t ON t.id=h.task_id WHERE hr.artifact_id=a.id AND hr.revision=r.revision AND t.status<>'deleted' AND h.status IN ${ACTIVE_HANDOFF})) ORDER BY a.created_at,a.id LIMIT ? OFFSET ?`, projectId, taskId, taskId, taskId, taskId, limit, offset);
    return { artifacts: rows.map(row => this.artifact(row)), nextOffset: rows.length === limit ? offset + limit : null };
  }

  private read(input: Row): Row {
    const artifact = this.artifact(input);
    const mediaType = String(artifact.mediaType).split(";", 1)[0]!.toLowerCase();
    if (!mediaType.startsWith("text/") && !/^application\/(json|.*\+json|xml|.*\+xml|javascript|x-ndjson)$/.test(mediaType)) fail("binary_artifact", "Use artifact.export or exportArtifact for binary bytes.");
    const size = Number(artifact.sizeBytes), offset = integer(input, "offset", 0, 0, size), limit = integer(input, "limit", 20_000, 4, 100_000);
    const fd = this.openVerifiedBlob(String(artifact.sha256), size);
    try {
      const bytes = this.readPage(fd, offset, Math.min(limit + 1, size - offset));
      if (offset < size && (bytes[0]! & 0xc0) === 0x80) fail("invalid_range");
      let end = Math.min(limit, bytes.length);
      while (offset + end < size && end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, end)); } catch { fail("binary_artifact", "Content is not valid UTF-8."); }
      return { artifact, content, encoding: "utf8", offset, nextOffset: offset + end, eof: offset + end === size };
    } finally { closeSync(fd); }
  }

  private createHandoff(input: Row): Row {
    const projectId = id(input, "projectId", "project"), taskId = id(input, "taskId", "task");
    this.writableProject(projectId); this.writableTask(taskId, projectId);
    const refs = this.refs(input, projectId), recipient = text(input, "to", 255), sender = text(input, "from", 255, "owner"), instruction = text(input, "instruction", 8_000);
    const handoffId = `handoff_${randomUUID()}`, stamp = now();
    this.run("INSERT INTO handoffs(id,project_id,task_id,sender,recipient,instruction,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)", handoffId, projectId, taskId, sender, recipient, instruction, stamp, stamp);
    for (const ref of refs) this.run("INSERT OR IGNORE INTO handoff_artifacts VALUES(?,?,?)", handoffId, ref.artifactId, ref.revision);
    this.event("handoff.created", projectId, handoffId, taskId);
    return this.handoff({ handoffId });
  }
  private handoff(input: Row, includeToken = false, deleted = false): Row {
    const handoffId = id(input, "handoffId", "handoff");
    const row = this.get("SELECT id,project_id AS projectId,task_id AS taskId,sender AS 'from',recipient AS 'to',instruction,status,generation,claim_token AS claimToken,created_at AS createdAt,updated_at AS updatedAt FROM handoffs WHERE id=?", handoffId);
    if (!row) fail("handoff_not_found");
    this.checkScope(input, String(row.projectId)); this.task(String(row.taskId), deleted);
    if (!includeToken) delete row.claimToken;
    return { ...row, artifactRefs: this.all("SELECT artifact_id AS artifactId,revision FROM handoff_artifacts WHERE handoff_id=? ORDER BY artifact_id,revision LIMIT 100", handoffId) };
  }
  private handoffList(input: Row): Row {
    const limit = integer(input, "limit", 50, 1, 100), offset = integer(input, "offset", 0, 0, 1_000_000);
    const projectId = input.projectId === undefined ? null : id(input, "projectId", "project");
    if (projectId) this.project(projectId);
    const recipient = input.to === undefined ? null : text(input, "to");
    const status = input.status === undefined ? null : text(input, "status", 30);
    const rows = this.all("SELECT h.id FROM handoffs h JOIN tasks t ON t.id=h.task_id JOIN projects p ON p.id=h.project_id WHERE t.status<>'deleted' AND p.status<>'deleted' AND (? IS NULL OR h.project_id=?) AND (? IS NULL OR h.recipient=?) AND (? IS NULL OR h.status=?) ORDER BY h.created_at,h.id LIMIT ? OFFSET ?", projectId, projectId, recipient, recipient, status, status, limit, offset);
    return { handoffs: rows.map(r => this.handoff({ handoffId: r.id })), nextOffset: rows.length === limit ? offset + limit : null };
  }
  private changeHandoff(operation: string, input: Row): Row {
    // Owner cancellation remains available through deleted parents, but a claimed consumer must acknowledge it with its fence.
    const h = this.handoff(input, true, operation === "handoff.cancel");
    if (operation === "handoff.claim") {
      this.writableProject(String(h.projectId)); this.writableTask(String(h.taskId), String(h.projectId));
      if (h.status !== "pending") fail("handoff_busy");
      if (text(input, "to") !== h.to) fail("handoff_recipient_mismatch");
      this.run("UPDATE handoffs SET status='claimed',claim_token=?,generation=generation+1,updated_at=? WHERE id=?", randomUUID(), now(), String(h.id));
    } else {
      const target = operation.slice("handoff.".length) === "complete" ? "completed" : operation.endsWith(".fail") ? "failed" : "cancelled";
      if (h.status === "pending" && target === "cancelled") { /* no consumer has claimed this work */ }
      else {
        if (h.status !== "claimed" || input.claimToken !== h.claimToken || input.generation !== h.generation) fail("handoff_fenced");
      }
      this.run("UPDATE handoffs SET status=?,claim_token=NULL,updated_at=? WHERE id=?", target, now(), String(h.id));
    }
    this.event(operation === "handoff.claim" ? "handoff.claimed" : operation === "handoff.complete" ? "handoff.completed" : operation === "handoff.fail" ? "handoff.failed" : "handoff.cancelled", String(h.projectId), String(h.id), String(h.taskId));
    return this.handoff({ handoffId: h.id }, operation === "handoff.claim", operation === "handoff.cancel");
  }

  private usage(input: Row): Row {
    const projectId = input.projectId === undefined ? null : id(input, "projectId", "project");
    const taskId = input.taskId === undefined ? null : id(input, "taskId", "task");
    if (projectId) this.project(projectId, true);
    if (taskId) { const t = this.task(taskId, true); if (projectId && t.projectId !== projectId) fail("project_mismatch"); }
    const logical = this.get("SELECT count(*) AS revisions,COALESCE(sum(r.size_bytes),0) AS logicalBytes FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id WHERE (? IS NULL OR a.project_id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM task_artifacts t WHERE t.task_id=? AND t.artifact_id=r.artifact_id AND t.revision=r.revision))", projectId, projectId, taskId, taskId)!;
    return { ...logical, ...this.get("SELECT count(*) AS blobs,COALESCE(sum(size_bytes),0) AS physicalBytes FROM blobs"), ...this.get("SELECT count(*) AS activeUploads,COALESCE(sum(reserved_bytes),0) AS reservedBytes FROM uploads"), limits: { ...this.limits }, physicalScope: "store" };
  }
  private deleteTarget(input: Row): { projectId: string; taskId: string | null; object: Row } {
    const taskId = input.taskId === undefined ? null : id(input, "taskId", "task");
    const object = taskId ? this.task(taskId, true) : this.project(id(input, "projectId", "project"), true);
    const projectId = String(taskId ? object.projectId : object.id); this.checkScope(input, projectId);
    return { projectId, taskId, object };
  }
  private preview(input: Row): Row {
    const { projectId, taskId, object } = this.deleteTarget(input);
    const blockers = this.all(`SELECT id,status FROM handoffs WHERE project_id=? AND (? IS NULL OR task_id=?) AND status IN ${ACTIVE_HANDOFF} ORDER BY id LIMIT 100`, projectId, taskId, taskId);
    const uploads = this.all("SELECT id,reserved_bytes AS reservedBytes FROM uploads WHERE project_id=? AND (? IS NULL OR task_id=?) ORDER BY id LIMIT 16", projectId, taskId, taskId);
    const counts = this.get("SELECT count(*) AS artifacts FROM artifacts WHERE project_id=? AND (? IS NULL OR owner_task_id=?)", projectId, taskId, taskId)!;
    const totals = this.usage({ projectId, ...(taskId ? { taskId } : {}) });
    const retained = this.get("SELECT count(DISTINCT ta.task_id) AS otherTaskReferences FROM task_artifacts ta JOIN artifacts a ON a.id=ta.artifact_id WHERE a.project_id=? AND a.owner_task_id=? AND ta.task_id<>?", projectId, taskId, taskId)!;
    const reclaimable = this.get(`
      SELECT COALESCE(sum(b.size_bytes),0) AS reclaimableBytes FROM blobs b
      WHERE EXISTS (
        SELECT 1 FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id
        WHERE r.sha256=b.sha256 AND a.project_id=?
      ) AND NOT EXISTS (
        SELECT 1 FROM artifact_revisions r JOIN artifacts a ON a.id=r.artifact_id
        WHERE r.sha256=b.sha256 AND (
          a.project_id<>? OR (? IS NOT NULL AND (
            EXISTS (SELECT 1 FROM task_artifacts ta WHERE ta.artifact_id=a.id AND ta.task_id<>?)
            OR EXISTS (SELECT 1 FROM project_artifacts pa WHERE pa.artifact_id=a.id)
            OR EXISTS (
              SELECT 1 FROM handoff_artifacts ha JOIN handoffs h ON h.id=ha.handoff_id
              WHERE ha.artifact_id=a.id AND h.task_id<>? AND h.status IN ${ACTIVE_HANDOFF}
            )
          ))
        )
      )`, projectId, projectId, taskId, taskId, taskId)!;
    const state = this.get("SELECT COALESCE(max(cursor),0) AS cursor FROM outbox_events")!;
    return { projectId, taskId, status: object.status, ...counts, ...retained, ...reclaimable, logicalBytes: totals.logicalBytes, blockers, uploads, planToken: hash(canonical({ projectId, taskId, status: object.status, cursor: state.cursor })), requiresSoftDelete: object.status !== "deleted" };
  }
  private purge(operation: string, input: Row): Row {
    if (operation === "project.purge" && input.taskId !== undefined) fail("invalid_input");
    if (operation === "task.purge" && input.taskId === undefined) fail("invalid_input");
    const { projectId, taskId, object } = this.deleteTarget(input);
    if (object.status !== "deleted") fail("purge_requires_delete");
    const preview = this.preview(input);
    if (input.planToken !== undefined && input.planToken !== preview.planToken) fail("delete_plan_stale");
    if (this.get("SELECT 1 FROM uploads WHERE project_id=? AND (? IS NULL OR task_id=?) LIMIT 1", projectId, taskId, taskId)) fail("upload_busy");
    if ((preview.blockers as Row[]).length) fail("handoff_busy");
    if (taskId) {
      this.run("DELETE FROM tasks WHERE id=?", taskId);
      this.run("DELETE FROM artifacts WHERE project_id=? AND NOT EXISTS(SELECT 1 FROM task_artifacts t WHERE t.artifact_id=artifacts.id) AND NOT EXISTS(SELECT 1 FROM project_artifacts p WHERE p.artifact_id=artifacts.id) AND NOT EXISTS(SELECT 1 FROM handoff_artifacts r JOIN handoffs h ON h.id=r.handoff_id WHERE r.artifact_id=artifacts.id AND h.status IN " + ACTIVE_HANDOFF + ")", projectId);
      this.event("task.purged", projectId, taskId);
    } else {
      this.run("DELETE FROM handoffs WHERE project_id=?", projectId);
      this.run("DELETE FROM artifacts WHERE project_id=?", projectId);
      this.run("DELETE FROM tasks WHERE project_id=?", projectId);
      this.run("DELETE FROM projects WHERE id=?", projectId);
    }
    this.run("INSERT OR IGNORE INTO delete_jobs SELECT sha256,? FROM blobs b WHERE NOT EXISTS(SELECT 1 FROM artifact_revisions r WHERE r.sha256=b.sha256)", now());
    return { projectId, taskId, purged: true, pendingReclamation: true };
  }

  /** Reclamation runs in its own transaction after logical purge is committed. Retry with storage.usage. */
  private reclaim(): void {
    for (const job of this.all("SELECT sha256 FROM delete_jobs ORDER BY created_at LIMIT 100")) {
      const sha256 = String(job.sha256);
      if (this.get("SELECT 1 FROM artifact_revisions WHERE sha256=? LIMIT 1", sha256)) { this.run("DELETE FROM delete_jobs WHERE sha256=?", sha256); continue; }
      const path = this.blobPath(sha256);
      try {
        this.safeFile(path, true);
        try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        this.run("DELETE FROM blobs WHERE sha256=?", sha256);
      } catch { /* durable delete job is retained for a later retry */ }
    }
  }
  private directory(path: string): void {
    const absolute = resolve(path), root = parse(absolute).root;
    let current = root;
    for (const part of absolute.slice(root.length).split(/[\\/]/).filter(Boolean)) {
      current = join(current, part);
      try { mkdirSync(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail("unsafe_path");
      if (current === this.dataDir || current.startsWith(this.dataDir + "/")) {
        if (typeof process.getuid === "function" && stat.uid !== process.getuid()) fail("unsafe_path");
        chmodSync(current, 0o700);
      }
    }
  }
  private safeFile(path: string, missing = false): void {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || typeof process.getuid === "function" && stat.uid !== process.getuid()) fail("unsafe_path");
    } catch (error) { if (missing && (error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  }
  private blobPath(sha256: string): string {
    if (!/^[a-f0-9]{64}$/.test(sha256)) fail("artifact_content_corrupt");
    const parent = join(this.blobDir, sha256.slice(0, 2), sha256.slice(2, 4));
    this.directory(parent);
    return join(parent, sha256);
  }
  private expireUploads(): void {
    for (const row of this.all("SELECT id FROM uploads WHERE expires_at<=? ORDER BY expires_at LIMIT 100", now())) {
      const uploadId = String(row.id);
      if (!/^[0-9a-f-]{36}$/.test(uploadId)) fail("storage_corrupt");
      const path = join(this.stagingDir, `${uploadId}.partial`);
      this.directory(this.stagingDir);
      try { this.safeFile(path, true); unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue; }
      this.run("DELETE FROM uploads WHERE id=?", uploadId);
    }
  }

  private readPage(fd: number, offset: number, size: number): Buffer {
    const bytes = Buffer.alloc(size); let read = 0;
    while (read < size) { const count = readSync(fd, bytes, read, size - read, offset + read); if (!count) fail("artifact_content_corrupt"); read += count; }
    return bytes;
  }

  private openVerifiedBlob(sha256: string, size: number): number {
    const path = this.blobPath(sha256);
    if (!Number.isSafeInteger(size) || size < 0) fail("artifact_content_corrupt");
    let fd: number;
    try { this.safeFile(path); fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("artifact_content_missing"); throw error; }
    try {
      if (fstatSync(fd).size !== size) fail("artifact_content_corrupt");
      const digest = createHash("sha256"), buffer = Buffer.alloc(65_536); let offset = 0;
      while (offset < size) {
        const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (!count) fail("artifact_content_corrupt"); digest.update(buffer.subarray(0, count)); offset += count;
      }
      if (digest.digest("hex") !== sha256) fail("artifact_content_corrupt");
      return fd;
    } catch (error) { closeSync(fd); throw error; }
  }

  private verifyBlob(sha256: string, size: number): void { closeSync(this.openVerifiedBlob(sha256, size)); }
  private publishStagedBlob(sha256: string, size: number, stagedPath: string): void {
    const target = this.blobPath(sha256);
    if (existsSync(target)) { this.verifyBlob(sha256, size); return; }
    this.safeFile(stagedPath);
    if (lstatSync(stagedPath).size !== size) fail("size_mismatch");
    try { linkSync(stagedPath, target); this.publishedPaths.push(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    unlinkSync(stagedPath);
    this.verifyBlob(sha256, size);
    if (process.platform !== "win32") { const dir = openSync(dirname(target), constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(dir); } finally { closeSync(dir); } }
  }

  private publishBlob(sha256: string, bytes: Buffer): void {
    const target = this.blobPath(sha256);
    if (existsSync(target)) { this.verifyBlob(sha256, bytes.length); return; }
    this.directory(this.stagingDir);
    const partial = join(this.stagingDir, `${randomUUID()}.partial`);
    const fd = openSync(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      // Hard-link publication is atomic and never overwrites an existing shared object.
      try { linkSync(partial, target); this.publishedPaths.push(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { unlinkSync(partial); }
    this.verifyBlob(sha256, bytes.length);
    if (process.platform !== "win32") { const dir = openSync(dirname(target), constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(dir); } finally { closeSync(dir); } }
  }
}
