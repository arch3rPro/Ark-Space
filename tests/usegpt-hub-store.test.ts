import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { UseGptHubStore } from "../src/usegpt/hub-store.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-hub-store-")); homes.push(home);
  const dataDir = join(home, "data"); await mkdir(dataDir, { recursive: true });
  return { dataDir, store: new UseGptHubStore(dataDir) };
}

it("persists projects, tasks and text artifacts across a restart", async () => {
  const { store, dataDir } = await fixture();
  const project = store.createProject("Launch", "Launch materials");
  const task = store.createTask(project.id, "Research", "Prepare a report");
  const artifact = await store.publishText({ projectId: project.id, taskId: task.id, name: "report.md", mediaType: "text/markdown", content: "# Report\n\nResult" });
  expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await store.readArtifact(artifact.id)).toBe("# Report\n\nResult");
  await store.close();
  const restored = new UseGptHubStore(dataDir);
  expect(restored.listTasks(project.id)).toHaveLength(1);
  expect(await restored.readArtifact(artifact.id)).toBe("# Report\n\nResult");
  await restored.close();
});

it("deduplicates identical bytes across separate artifacts", async () => {
  const { store } = await fixture();
  const project = store.createProject("Launch");
  const a = await store.publishText({ projectId: project.id, name: "a.md", content: "same" });
  const b = await store.publishText({ projectId: project.id, name: "b.md", content: "same" });
  expect(a.id).not.toBe(b.id); expect(a.sha256).toBe(b.sha256);
  expect(store.database.prepare("SELECT count(*) AS n FROM blobs").get()).toMatchObject({ n: 1 });
  await store.close();
});
