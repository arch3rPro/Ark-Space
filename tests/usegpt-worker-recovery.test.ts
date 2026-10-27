import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createUseGptDaemon, daemonRequest } from "../src/usegpt/daemon.js";
import { loadWorkerConfig, workerOnce } from "../src/usegpt/worker.js";

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
it.skipIf(process.platform === "win32" || major < 22 || major === 22 && minor < 13)("does not treat exit zero as delivery or replay an uncertain execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "uw-unknown-"));
  const dataDir = join(root, "data");
  const daemon = await createUseGptDaemon(dataDir);
  try {
    const call = async (operation: string, input: object) => {
      const result = await daemonRequest(dataDir, { protocolVersion: 1, capability: `usegpt.${operation}`, input }) as { ok: boolean; data: Record<string, unknown> };
      expect(result.ok).toBe(true); return result.data;
    };
    const project = await call("project.create", { name: "Unknown" });
    const task = await call("task.create", { projectId: project.id, title: "No result", request: "Do not retry" });
    const handoff = await call("handoff.create", { projectId: project.id, taskId: task.id, to: "agent:test", instruction: "Test result handling" });
    const script = join(root, "child.mjs"), count = join(root, "starts");
    await writeFile(script, `import fs from 'node:fs'; if(process.env.CONTROL_PLANE_API_KEY || process.env.TEST_PRIVATE_KEY) process.exit(2); fs.appendFileSync(${JSON.stringify(count)}, 'start\\n');`);
    const configPath = join(root, "worker.json");
    await writeFile(configPath, JSON.stringify({ executable: process.execPath, args: [script], cwd: root, projectId: project.id, recipient: "agent:test", dataDir, timeoutMs: 2000 }), { mode: 0o600 });
    const config = loadWorkerConfig(configPath);
    const previous = process.env.TEST_PRIVATE_KEY;
    process.env.TEST_PRIVATE_KEY = "must-not-inherit";
    try {
      expect(await workerOnce(config)).toMatchObject({ ok: false, data: { status: "unknown" } });
      expect(await workerOnce(config)).toMatchObject({ ok: false, data: { status: "unknown" } });
    } finally { if (previous === undefined) delete process.env.TEST_PRIVATE_KEY; else process.env.TEST_PRIVATE_KEY = previous; }
    expect(await readFile(count, "utf8")).toBe("start\n");
    expect(await call("handoff.get", { handoffId: handoff.id })).toMatchObject({ status: "claimed" });
  } finally { await daemon.close(); await rm(root, { recursive: true, force: true }); }
}, 10000);
