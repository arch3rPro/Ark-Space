import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { UseGptHubStore as UseGptHubStoreType } from "../src/usegpt/hub-store.js";

const hubSupported = (() => { const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number); return major > 22 || major === 22 && (minor > 13 || minor === 13 && patch >= 0); })();
const hubIt = it.skipIf(!hubSupported);
const { UseGptHubStore } = hubSupported ? await import("../src/usegpt/hub-store.js") : { UseGptHubStore: undefined as unknown as typeof UseGptHubStoreType };

const homes: string[] = [];
const stores: UseGptHubStoreType[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.close()));
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })));
});
async function fixture(options = {}) {
  const home = await mkdtemp(join(tmpdir(), "arks-hub-store-")); homes.push(home);
  const dataDir = join(home, "data"); await mkdir(dataDir, { recursive: true });
  const store = new UseGptHubStore(dataDir, options); stores.push(store);
  const call = (op: string, input: Record<string, unknown> = {}) => store.execute(op, input);
  return { home, dataDir, store, call };
}
async function objects() {
  const f = await fixture();
  const project = await f.call("project.create", { name: "Launch" });
  const task = await f.call("task.create", { projectId: project.id, title: "Research", request: "Prepare report" });
  const artifact = await f.call("artifact.publish_inline", { projectId: project.id, taskId: task.id, name: "report.md", content: "first" });
  return { ...f, project, task, artifact };
}

hubIt("persists compatibility methods and immutable revisions across restart", async () => {
  const { store, dataDir, call } = await fixture();
  const project = store.createProject("Launch", "Launch materials");
  const task = store.createTask(project.id, "Research", "Prepare a report");
  const artifact = await store.publishText({ projectId: project.id, taskId: task.id, name: "report.md", content: "first" });
  const second = await call("artifact.publish_inline", { projectId: project.id, taskId: task.id, artifactId: artifact.id, name: "report.md", content: "second" });
  expect(second).toMatchObject({ id: artifact.id, revision: 2, availability: "available" });
  await store.close();
  const restored = await UseGptHubStore.open(dataDir); stores.push(restored);
  expect(restored.listTasks(project.id)).toHaveLength(1);
  expect(await restored.readArtifact(artifact.id)).toBe("second");
  expect(await restored.execute("artifact.read", { artifactId: artifact.id, revision: 1 })).toMatchObject({ content: "first" });
  const history = await restored.execute("task.get", { taskId: task.id });
  expect(history.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "artifact.revision_created" })]));
});

hubIt("deduplicates bytes, preserves shared references, and collects only the final reference", async () => {
  const { call, store, project, task, artifact } = await objects();
  const other = await call("task.create", { projectId: project.id, title: "Consumer", request: "Use report", artifactRefs: [{ artifactId: artifact.id, revision: 1 }] });
  const copy = await call("artifact.publish_inline", { projectId: project.id, name: "shared.md", content: "first" });
  expect(store.database.prepare("SELECT count(*) AS n FROM blobs").get()).toMatchObject({ n: 1 });
  await call("task.delete", { taskId: task.id });
  expect(await call("artifact.read", { artifactId: artifact.id, taskId: other.id })).toMatchObject({ content: "first" });
  await expect(call("artifact.read", { artifactId: artifact.id, taskId: task.id })).rejects.toMatchObject({ code: "task_deleted" });
  await call("task.purge", { taskId: task.id });
  expect(await call("artifact.read", { artifactId: artifact.id })).toMatchObject({ content: "first" });
  await call("task.delete", { taskId: other.id }); await call("task.purge", { taskId: other.id });
  expect(await call("artifact.read", { artifactId: copy.id })).toMatchObject({ content: "first" });
  await call("project.delete", { projectId: project.id }); await call("project.purge", { projectId: project.id });
  expect(store.database.prepare("SELECT count(*) AS n FROM blobs").get()).toMatchObject({ n: 0 });
});

hubIt("serializes concurrent publishes and enforces idempotency across restart", async () => {
  const { call, dataDir, project, artifact, task } = await objects();
  const second = new UseGptHubStore(dataDir); stores.push(second);
  const input = { projectId: project.id, taskId: task.id, artifactId: artifact.id, name: "report.md", content: "updated" };
  const results = await Promise.all([call("artifact.publish_inline", input), second.execute("artifact.publish_inline", input)]);
  expect(results.map(r => r.revision).sort()).toEqual([2, 3]);
  const a = await call("artifact.publish_inline", { ...input, idempotencyKey: "publish-1" });
  expect(await second.execute("artifact.publish_inline", { ...input, idempotencyKey: "publish-1" })).toEqual(a);
  await expect(call("artifact.publish_inline", { ...input, content: "different", idempotencyKey: "publish-1" })).rejects.toMatchObject({ code: "idempotency_conflict" });
});

hubIt("rejects invalid ownership, missing references, and publication to terminal tasks", async () => {
  const { call, project, task, artifact } = await objects();
  const other = await call("project.create", { name: "Other" });
  await expect(call("artifact.publish_inline", { projectId: other.id, taskId: task.id, name: "x", content: "x" })).rejects.toMatchObject({ code: "project_mismatch" });
  await expect(call("handoff.create", { projectId: project.id, taskId: task.id, to: "agent:a", instruction: "Work", artifactRefs: [{ artifactId: artifact.id, revision: 99 }] })).rejects.toMatchObject({ code: "artifact_not_found" });
  const completionArtifact = await call("artifact.publish_inline", { projectId: project.id, name: "completion.md", content: "delivered" });
  await call("task.complete", { taskId: task.id, artifactRefs: [{ artifactId: completionArtifact.id, revision: completionArtifact.revision }] });
  expect(await call("artifact.read", { artifactId: completionArtifact.id, taskId: task.id })).toMatchObject({ content: "delivered" });
  await expect(call("artifact.publish_inline", { projectId: project.id, taskId: task.id, name: "late", content: "x" })).rejects.toMatchObject({ code: "task_terminal" });
});

hubIt("restores a project without reviving previously deleted tasks or artifacts", async () => {
  const { call, project, task, artifact } = await objects();
  const live = await call("task.create", { projectId: project.id, title: "Live", request: "Continue" });
  await call("task.delete", { taskId: task.id });
  await call("project.delete", { projectId: project.id });
  await expect(call("artifact.read", { artifactId: artifact.id })).rejects.toMatchObject({ code: "project_deleted" });
  await call("project.restore", { projectId: project.id });
  expect(await call("task.list", { projectId: project.id })).toMatchObject({ tasks: [expect.objectContaining({ id: live.id })] });
  await expect(call("task.get", { taskId: task.id })).rejects.toMatchObject({ code: "task_deleted" });
  await call("task.restore", { taskId: task.id });
  expect(await call("artifact.read", { artifactId: artifact.id })).toMatchObject({ content: "first" });
});

hubIt("pins handoff revisions, fences completion, and blocks purge while work is active", async () => {
  const { call, project, task, artifact } = await objects();
  const h = await call("handoff.create", { projectId: project.id, taskId: task.id, to: "agent:a", instruction: "Use report", artifactRefs: [{ artifactId: artifact.id, revision: 1 }] });
  const claim = await call("handoff.claim", { handoffId: h.id, to: "agent:a" });
  expect(claim).toMatchObject({ generation: 1, status: "claimed" });
  await expect(call("handoff.claim", { handoffId: h.id, to: "agent:b" })).rejects.toThrow();
  await expect(call("handoff.complete", { handoffId: h.id, claimToken: "stale", generation: 1 })).rejects.toMatchObject({ code: "handoff_fenced" });
  await expect(call("task.complete", { taskId: task.id })).rejects.toMatchObject({ code: "handoff_busy" });
  await call("task.delete", { taskId: task.id });
  await expect(call("task.purge", { taskId: task.id })).rejects.toMatchObject({ code: "handoff_busy" });
  await call("task.restore", { taskId: task.id });
  await call("artifact.publish_inline", { projectId: project.id, taskId: task.id, artifactId: artifact.id, name: "report.md", content: "new" });
  expect(await call("handoff.get", { handoffId: h.id })).toMatchObject({ artifactRefs: [{ artifactId: artifact.id, revision: 1 }] });
  await call("handoff.complete", { handoffId: h.id, claimToken: claim.claimToken, generation: claim.generation });
  await call("task.complete", { taskId: task.id });
});

hubIt("bounds reads on UTF-8 byte boundaries and rejects corruption instead of overwriting it", async () => {
  const { call, store, project } = await objects();
  const a = await call("artifact.publish_inline", { projectId: project.id, name: "unicode", content: "A你B" });
  expect(await call("artifact.read", { artifactId: a.id, limit: 4 })).toMatchObject({ content: "A你", nextOffset: 4, eof: false });
  await expect(call("artifact.read", { artifactId: a.id, offset: 2 })).rejects.toMatchObject({ code: "invalid_range" });
  const hash = String(a.sha256); const path = join(store.blobDir, hash.slice(0, 2), hash.slice(2, 4), hash);
  await writeFile(path, "broken");
  await expect(call("artifact.read", { artifactId: a.id })).rejects.toMatchObject({ code: "artifact_content_corrupt" });
  await expect(call("artifact.publish_inline", { projectId: project.id, name: "copy", content: "A你B" })).rejects.toMatchObject({ code: "artifact_content_corrupt" });
});

hubIt("enforces quota and input bounds without leaking failed staging files", async () => {
  const { call, store } = await fixture({ maxInlineBytes: 10, maxProjectBytes: 6, maxTaskBytes: 5, maxStorageBytes: 20 });
  const p = await call("project.create", { name: "Quota" });
  const t = await call("task.create", { projectId: p.id, title: "Task", request: "Work" });
  await call("artifact.publish_inline", { projectId: p.id, taskId: t.id, name: "a", content: "12345" });
  await expect(call("artifact.publish_inline", { projectId: p.id, taskId: t.id, name: "b", content: "1" })).rejects.toMatchObject({ code: "quota_exceeded" });
  await expect(call("artifact.publish_inline", { projectId: p.id, name: "c", content: "12345678901" })).rejects.toMatchObject({ code: "quota_exceeded" });
  await expect(call("task.list", { projectId: p.id, limit: 1000 })).rejects.toMatchObject({ code: "invalid_input" });
  expect(store.database.prepare("SELECT count(*) AS n FROM artifact_revisions").get()).toMatchObject({ n: 1 });
});

hubIt("rejects managed-directory and blob symlinks", async () => {
  const { call, store, project, artifact, home } = await objects();
  const hash = String(artifact.sha256); const target = join(store.blobDir, hash.slice(0, 2), hash.slice(2, 4), hash);
  const outside = join(home, "outside"); await writeFile(outside, "first");
  await rm(target); await symlink(outside, target);
  await expect(call("artifact.read", { artifactId: artifact.id })).rejects.toMatchObject({ code: "unsafe_path" });
  await expect(call("artifact.publish_inline", { projectId: project.id, name: "copy", content: "first" })).rejects.toMatchObject({ code: "unsafe_path" });
});
