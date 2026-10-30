import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createUseGptDaemon } from "../src/usegpt/daemon.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
function cli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve("dist/cli/main.js"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("close", code => done({ code, stdout, stderr }));
  });
}
it("runs a deterministic local child, publishes its validated output, and completes only once", async () => {
  const home = await mkdtemp(join(tmpdir(), "uw-")); homes.push(home);
  const { daemonRequest } = await import("../src/usegpt/daemon.js");
  const dataDir = join(home, "hub"), daemon = await createUseGptDaemon(dataDir);
  const call = async (op: string, input: object) => {
    const result = await daemonRequest(dataDir, { protocolVersion: 1, capability: `usegpt.${op}`, input }) as { ok: boolean; data: Record<string, any> };
    expect(result.ok).toBe(true); return result.data;
  };
  try {
    const project = await call("project.create", { name: "Worker contract" });
    const task = await call("task.create", { projectId: project.id, title: "Deterministic", request: "private body" });
    const artifact = await call("artifact.publish_inline", { projectId: project.id, taskId: task.id, name: "input.txt", content: "pinned" });
    const handoff = await call("handoff.create", { projectId: project.id, taskId: task.id, to: "agent:test", instruction: "private instruction", artifactRefs: [{ artifactId: artifact.id, revision: 1 }] });
    const childPath = join(home, "child.mjs");
    await writeFile(childPath, `import fs from 'node:fs';\nconst input = JSON.parse(fs.readFileSync(process.env.ARKS_USEGPT_INPUT_FILE, 'utf8'));\nif (process.argv.join(' ').includes('private')) throw Error('body in argv');\nfs.appendFileSync(${JSON.stringify(join(home, "starts"))}, 'start\\n');\nfs.writeFileSync(process.env.ARKS_USEGPT_RESULT_FILE, JSON.stringify({protocolVersion:1,handoffId:input.handoff.id,generation:input.handoff.generation,outcome:'completed',artifacts:[{name:'output.txt',content:'derived '+input.artifacts[0].content,mediaType:'text/plain'}]}), {mode:0o600});\nconsole.log('child output must not enter worker stdout');`);
    const configPath = join(home, "worker.json");
    await writeFile(configPath, JSON.stringify({ executable: process.execPath, args: [childPath], cwd: home, projectId: project.id, recipient: "agent:test", dataDir, timeoutMs: 3000 }), { mode: 0o600 });
    const run = await cli(["usegpt", "worker", "once", "--config", configPath]);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, data: { status: "completed", handoffId: handoff.id } });
    expect(await call("handoff.get", { handoffId: handoff.id })).toMatchObject({ status: "completed" });
    const outputs = await call("artifact.list", { projectId: project.id, taskId: task.id });
    const output = outputs.artifacts.find((a: any) => a.name === "output.txt");
    expect(await call("artifact.read", { artifactId: output.id, revision: 1 })).toMatchObject({ content: "derived pinned" });
    expect(JSON.parse((await cli(["usegpt", "worker", "once", "--config", configPath])).stdout)).toMatchObject({ data: { status: "empty" } });
    expect(await readFile(join(home, "starts"), "utf8")).toBe("start\n");
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    await chmod(configPath, 0o644);
    expect((await cli(["usegpt", "worker", "once", "--config", configPath])).code).toBe(1);
  } finally { await daemon.close(); }
}, 15000);
