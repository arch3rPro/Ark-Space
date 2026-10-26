import { mkdtemp, mkdir, rm, writeFile, readdir, readFile, symlink, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { UseGptHubStore } from "../src/usegpt/hub-store.js";

const homes: string[] = [], stores: UseGptHubStore[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(stores.splice(0).map(store => store.close()));
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })));
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-hub-durable-")); homes.push(home);
  const dataDir = join(home, "data");
  const store = await UseGptHubStore.open(dataDir); stores.push(store);
  const project = store.createProject("Project");
  const task = store.createTask(project.id, "Task", "Work");
  const call = (op: string, input: Record<string, unknown> = {}) => store.execute(op, input);
  return { home, dataDir, store, project, task, call };
}

it("preserves another project's shared blob through purge and binds deletion previews to state", async () => {
  const { store, call, project, task } = await fixture();
  const a = await call("artifact.publish_inline", { projectId: project.id, taskId: task.id, name: "a", content: "same" });
  const p2 = store.createProject("Second");
  const b = await call("artifact.publish_inline", { projectId: p2.id, name: "b", content: "same" });
  await call("project.delete", { projectId: project.id });
  const plan = await call("delete.preview", { projectId: project.id });
  expect(plan.reclaimableBytes).toBe(0);
  store.createProject("Changes plan cursor");
  await expect(call("project.purge", { projectId: project.id, planToken: plan.planToken })).rejects.toMatchObject({ code: "delete_plan_stale" });
  await call("project.purge", { projectId: project.id });
  await expect(call("artifact.read", { artifactId: a.id })).rejects.toMatchObject({ code: "artifact_not_found" });
  expect(await call("artifact.read", { artifactId: b.id })).toMatchObject({ content: "same" });
  await expect(store.readArtifact(String(b.id), { projectId: project.id })).rejects.toMatchObject({ code: "project_mismatch" });
  expect(await call("storage.usage")).toMatchObject({ physicalBytes: 4, blobs: 1 });
});

it("cleans a newly published blob and staging file if the metadata transaction fails", async () => {
  const { store, call, project, dataDir } = await fixture();
  store.database.exec("CREATE TRIGGER reject_revision BEFORE INSERT ON artifact_revisions BEGIN SELECT RAISE(ABORT,'injected failure'); END");
  await expect(call("artifact.publish_inline", { projectId: project.id, name: "failure", content: "not committed" })).rejects.toThrow("injected failure");
  expect(await readdir(join(dataDir, "staging"))).toEqual([]);
  const digest = createHash("sha256").update("not committed").digest("hex");
  await expect(readFile(join(store.blobDir, digest.slice(0, 2), digest.slice(2, 4), digest))).rejects.toMatchObject({ code: "ENOENT" });
  expect(store.database.prepare("SELECT count(*) AS n FROM artifacts").get()).toMatchObject({ n: 0 });
});

it("cleans abandoned staging under the database lock and reports missing content", async () => {
  const { store, call, project, dataDir } = await fixture();
  const a = await call("artifact.publish_inline", { projectId: project.id, name: "a", content: "saved" });
  await store.close();
  const partial = join(dataDir, "staging", `${randomUUID()}.partial`); await writeFile(partial, "unfinished");
  const restored = await UseGptHubStore.open(dataDir); stores.push(restored);
  expect(await readdir(join(dataDir, "staging"))).toEqual([]);
  const digest = String(a.sha256); await rm(join(restored.blobDir, digest.slice(0, 2), digest.slice(2, 4), digest));
  await expect(restored.execute("artifact.read", { artifactId: a.id })).rejects.toMatchObject({ code: "artifact_content_missing" });
});

it("serializes publishing from independent Node processes", async () => {
  const { dataDir, project, task, call } = await fixture();
  const a = await call("artifact.publish_inline", { projectId: project.id, taskId: task.id, name: "report", content: "one" });
  const source = `import { UseGptHubStore } from ${JSON.stringify(resolve("src/usegpt/hub-store.ts"))};
const store = await UseGptHubStore.open(process.argv[1]);
try { console.log(JSON.stringify(await store.execute('artifact.publish_inline', JSON.parse(process.argv[2])))); }
finally { await store.close(); }`;
  const input = JSON.stringify({ projectId: project.id, taskId: task.id, artifactId: a.id, name: "report", content: "parallel" });
  const run = () => new Promise<Record<string, unknown>>((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, dataDir, input], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => { if (code) reject(new Error(stderr)); else { try { resolveResult(JSON.parse(stdout) as Record<string, unknown>); } catch (error) { reject(error); } } });
  });
  const revisions = (await Promise.all([run(), run()])).map(r => r.revision).sort();
  expect(revisions).toEqual([2, 3]);
}, 15_000);

it("rejects symlinked managed parent directories and restricts file permissions", async () => {
  const { store, call, project, dataDir, home } = await fixture();
  const bytes = "new bytes", digest = createHash("sha256").update(bytes).digest("hex");
  const outside = join(home, "outside"); await mkdir(outside);
  const prefix = join(store.blobDir, digest.slice(0, 2)); await symlink(outside, prefix);
  await expect(call("artifact.publish_inline", { projectId: project.id, name: "../name", content: bytes })).rejects.toMatchObject({ code: "unsafe_path" });
  expect(await readdir(outside)).toEqual([]);
  if (process.platform !== "win32") {
    expect((await stat(dataDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dataDir, "index.sqlite"))).mode & 0o777).toBe(0o600);
  }
});

it("refuses a future schema version", async () => {
  const { store, dataDir } = await fixture(); await store.close();
  const db = new DatabaseSync(join(dataDir, "index.sqlite")); db.exec("PRAGMA user_version=999"); db.close();
  await expect(UseGptHubStore.open(dataDir)).rejects.toThrow("schema_too_new");
});

it("migrates the prototype schema without losing projects, tasks, or blob bytes", async () => {
  const home = await mkdtemp(join(tmpdir(), "arks-hub-migration-")); homes.push(home);
  const dataDir = join(home, "data"); await mkdir(dataDir);
  const projectId = `project_${randomUUID()}`, taskId = `task_${randomUUID()}`, artifactId = `artifact_${randomUUID()}`;
  const digest = createHash("sha256").update("legacy").digest("hex"), stamp = new Date().toISOString();
  const db = new DatabaseSync(join(dataDir, "index.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,description TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),title TEXT,request TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE blobs(sha256 TEXT PRIMARY KEY,size_bytes INTEGER,created_at TEXT);
CREATE TABLE artifacts(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),task_id TEXT REFERENCES tasks(id),name TEXT,kind TEXT,media_type TEXT,revision INTEGER,sha256 TEXT REFERENCES blobs(sha256),size_bytes INTEGER,created_at TEXT);
CREATE INDEX tasks_project_idx ON tasks(project_id,created_at); CREATE INDEX artifacts_task_idx ON artifacts(task_id,created_at);`);
  db.prepare("INSERT INTO projects VALUES(?,?,?,?,?,?)").run(projectId, "Legacy", "", "active", stamp, stamp);
  db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?)").run(taskId, projectId, "Task", "Work", "queued", stamp, stamp);
  db.prepare("INSERT INTO blobs VALUES(?,?,?)").run(digest, 6, stamp);
  db.prepare("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?)").run(artifactId, projectId, taskId, "legacy.txt", "document", "text/plain", 1, digest, 6, stamp); db.close();
  const parent = join(dataDir, "objects", "sha256", digest.slice(0, 2), digest.slice(2, 4)); await mkdir(parent, { recursive: true }); await writeFile(join(parent, digest), "legacy");
  const store = await UseGptHubStore.open(dataDir); stores.push(store);
  expect(await store.readArtifact(artifactId)).toBe("legacy");
  expect(store.listTasks(projectId)).toHaveLength(1);
  expect(store.database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("streams binary larger than inline limits and exports verified bytes across purge", async () => {
  const { store, project, task, call } = await fixture();
  const chunk = Buffer.alloc(65_536, 0x89), count = 20;
  const input = { projectId: project.id, taskId: task.id, name: "../image.png", mediaType: "image/png", declaredSize: chunk.length * count, idempotencyKey: "binary-1" };
  const source = async function* () { for (let i = 0; i < count; i++) yield chunk; };
  const artifact = await store.publishStream(input, source());
  expect(artifact).toMatchObject({ sizeBytes: chunk.length * count, revision: 1 });
  expect(await store.publishStream(input, source())).toEqual(artifact);
  expect(await store.getBinary({ artifactId: String(artifact.id), offset: 100, limit: 20 })).toEqual(chunk.subarray(0, 20));
  expect(await call("artifact.export", { artifactId: artifact.id, offset: 100, limit: 20 })).toMatchObject({ encoding: "base64", content: chunk.subarray(0, 20).toString("base64"), nextOffset: 120, eof: false });
  const wrongProject = store.createProject("Other export scope");
  await expect(store.exportArtifact({ artifactId: String(artifact.id), projectId: wrongProject.id })).rejects.toMatchObject({ code: "project_mismatch" });
  await expect(call("artifact.read", { artifactId: artifact.id })).rejects.toMatchObject({ code: "binary_artifact" });
  const exported = await store.exportArtifact({ artifactId: String(artifact.id), taskId: task.id });
  const status = await call("artifact.publish_status", { projectId: project.id, idempotencyKey: input.idempotencyKey });
  expect(status).toMatchObject({ status: "available", artifact: { id: artifact.id } });
  await call("task.delete", { taskId: task.id }); await call("task.purge", { taskId: task.id });
  const digest = createHash("sha256"); let total = 0;
  for await (const bytes of exported.stream) { digest.update(bytes); total += bytes.length; }
  expect(total).toBe(chunk.length * count); expect(digest.digest("hex")).toBe(artifact.sha256);
  await expect(store.exportArtifact({ artifactId: String(artifact.id) })).rejects.toMatchObject({ code: "artifact_not_found" });
});

it("cleans staging and reservations on stream failure and size mismatch", async () => {
  const { store, project, dataDir } = await fixture();
  const input = { projectId: project.id, name: "binary" };
  await expect(store.publishStream(input, (async function* () { yield Buffer.from("start"); throw new Error("source failed"); })())).rejects.toThrow("source failed");
  await expect(store.publishBytes({ ...input, declaredSize: 4 }, Buffer.from("short"))).rejects.toMatchObject({ code: "size_mismatch" });
  await expect(store.publishBytes({ ...input, declaredSize: 9 }, Buffer.from("short"))).rejects.toMatchObject({ code: "size_mismatch" });
  expect(await readdir(join(dataDir, "staging"))).toEqual([]);
  expect(store.database.prepare("SELECT count(*) AS n FROM uploads").get()).toMatchObject({ n: 0 });
  expect(store.database.prepare("SELECT count(*) AS n FROM artifact_revisions").get()).toMatchObject({ n: 0 });
  store.database.exec("CREATE TRIGGER reject_binary BEFORE INSERT ON artifact_revisions BEGIN SELECT RAISE(ABORT,'binary commit failed'); END");
  await expect(store.publishBytes(input, Buffer.from("commit failure"))).rejects.toThrow("binary commit failed");
  expect(await readdir(join(dataDir, "staging"))).toEqual([]);
  expect(store.database.prepare("SELECT count(*) AS n FROM blobs").get()).toMatchObject({ n: 0 });
});

it("reserves concurrent stream quotas, survives another open, and rechecks task state before commit", async () => {
  const { project, task, dataDir, call } = await fixture();
  const other = await UseGptHubStore.open(dataDir, { maxStorageBytes: 8, maxFileBytes: 8 }); stores.push(other);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const publish = other.publishStream({ projectId: project.id, taskId: task.id, name: "reserved", declaredSize: 8 }, (async function* () { yield Buffer.from("1234"); started(); await gate; yield Buffer.from("5678"); })());
  await ready;
  const reopened = await UseGptHubStore.open(dataDir); stores.push(reopened);
  expect(await readdir(join(dataDir, "staging"))).toHaveLength(1);
  await expect(other.publishBytes({ projectId: project.id, name: "over", declaredSize: 1 }, Buffer.from("x"))).rejects.toMatchObject({ code: "quota_exceeded" });
  await call("task.complete", { taskId: task.id }).then(() => { throw new Error("completion must block during upload"); }, error => expect(error).toMatchObject({ code: "upload_busy" }));
  await call("task.cancel", { taskId: task.id }); release();
  await expect(publish).rejects.toMatchObject({ code: "task_terminal" });
  expect(await readdir(join(dataDir, "staging"))).toEqual([]);
});

it("filters paginated task/project history and scopes publish receipts", async () => {
  const { store, project, task, call } = await fixture();
  await call("artifact.publish_inline", { projectId: project.id, taskId: task.id, name: "a", content: "secret", idempotencyKey: "receipt" });
  const other = store.createProject("Other");
  await expect(call("artifact.publish_status", { projectId: other.id, idempotencyKey: "receipt" })).resolves.toMatchObject({ status: "unknown" });
  const history = await call("task.history", { taskId: task.id, eventType: "artifact.available", limit: 1 });
  expect(history.events).toEqual([expect.objectContaining({ type: "artifact.available", taskId: task.id })]);
  expect(await call("project.history", { projectId: project.id, afterCursor: history.nextCursor })).toMatchObject({ events: [] });
  const artifact = (await call("artifact.publish_status", { projectId: project.id, idempotencyKey: "receipt" })).artifact as Record<string, unknown>;
  await call("artifact.delete", { artifactId: artifact.id });
  await expect(call("artifact.publish_status", { projectId: project.id, idempotencyKey: "receipt" })).rejects.toMatchObject({ code: "artifact_not_found" });
});

it("retries binary revisions without overwriting history and detects same-size corruption", async () => {
  const { store, project, call } = await fixture();
  const input = { projectId: project.id, name: "data.bin", mediaType: "application/octet-stream", idempotencyKey: "one" };
  const a = await store.publishBytes(input, Buffer.from([0, 255, 1]));
  await expect(store.publishBytes(input, Buffer.from([0, 255, 2]))).rejects.toMatchObject({ code: "idempotency_conflict" });
  const b = await store.publishBytes({ ...input, idempotencyKey: "two", artifactId: String(a.id) }, Buffer.from([2, 255, 1]));
  expect(b).toMatchObject({ id: a.id, revision: 2 });
  expect(await store.getBinary({ artifactId: String(a.id), revision: 1 })).toEqual(Buffer.from([0, 255, 1]));
  const digest = String(b.sha256), path = join(store.blobDir, digest.slice(0, 2), digest.slice(2, 4), digest);
  await writeFile(path, Buffer.from([9, 9, 9]));
  await expect(store.exportArtifact({ artifactId: String(a.id) })).rejects.toMatchObject({ code: "artifact_content_corrupt" });
  await expect(call("artifact.export", { artifactId: a.id })).rejects.toMatchObject({ code: "artifact_content_corrupt" });
});

it("times out stalled streams, closes the iterator, and releases reservations", async () => {
  const { store, project, dataDir } = await fixture();
  vi.useFakeTimers();
  const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
  const source = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<Uint8Array>>(() => {}), return: cleanup }; } };
  const pending = store.publishStream({ projectId: project.id, name: "stalled", declaredSize: 5 }, source);
  const rejection = expect(pending).rejects.toMatchObject({ code: "upload_timeout" });
  await vi.advanceTimersByTimeAsync(60_001); await rejection;
  expect(cleanup).toHaveBeenCalledOnce();
  expect(store.database.prepare("SELECT count(*) AS n FROM uploads").get()).toMatchObject({ n: 0 });
  vi.useRealTimers();
  expect(await readdir(join(dataDir, "staging"))).toEqual([]);
});

it("upgrades schema version one while preserving scoped text and its byte offsets", async () => {
  const { store, project, dataDir, call } = await fixture();
  const a = await call("artifact.publish_inline", { projectId: project.id, name: "bom.txt", content: "\uFEFFhello" });
  store.database.exec("DROP TABLE uploads; PRAGMA user_version=1"); await store.close();
  const restored = await UseGptHubStore.open(dataDir); stores.push(restored);
  expect(await restored.readArtifact(String(a.id), { projectId: project.id })).toBe("\uFEFFhello");
  expect(await restored.execute("artifact.read", { artifactId: a.id })).toMatchObject({ nextOffset: 8, eof: true });
  expect(restored.database.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
});
