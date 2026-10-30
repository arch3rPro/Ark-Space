import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection } from "node:net";
import { afterEach, expect, it } from "vitest";
import { createUseGptDaemon, daemonRequest, daemonStatus, stopUseGptDaemon } from "../src/usegpt/daemon.js";

const supported = (() => {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split(".").map(Number);
  return major > 22 || major === 22 && (minor > 13 || minor === 13 && patch >= 0);
})();
const daemonIt = it.skipIf(!supported || process.platform === "win32");
const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });

daemonIt("serves executeUseGpt over a durable local IPC endpoint and releases its lock", async () => {
  const home = await mkdtemp(join(tmpdir(), "arks-usegpt-daemon-")); homes.push(home);
  const daemon = await createUseGptDaemon(home);
  try {
    expect((await daemonStatus(home)).running).toBe(true);
    const project = await daemonRequest(home, { protocolVersion: 1, capability: "usegpt.project.create", input: { name: "IPC project" } });
    expect(project).toMatchObject({ ok: true, data: { name: "IPC project" } });
    expect((await lstat(daemon.endpoint)).mode & 0o777).toBe(0o600);
  } finally { await daemon.close(); }
  expect((await daemonStatus(home)).running).toBe(false);
  await stopUseGptDaemon(home);
});

daemonIt("rejects a second daemon for the same data directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "arks-usegpt-daemon-lock-")); homes.push(home);
  const first = await createUseGptDaemon(home);
  try { await expect(createUseGptDaemon(home)).rejects.toThrow(/already running/); }
  finally { await first.close(); }
});

function cli(args: string[], cwd: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const environment: NodeJS.ProcessEnv = { ...process.env, ARKSPACE_HOME: join(cwd, "missing-config") };
    delete environment.NODE_PATH;
    const child = spawn(process.execPath, [resolve("dist/cli/main.js"), ...args], { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject); child.once("close", code => done({ code, stdout, stderr }));
  });
}

daemonIt("starts outside the repo, persists task and artifact across restart, and stops idempotently", async () => {
  const home = await mkdtemp(join(tmpdir(), "arks-daemon-cli-")); homes.push(home);
  const dataDir = join(home, "hub data");
  const run = (operation: string, ...args: string[]) => cli(["usegpt", "daemon", operation, "--data-dir", dataDir, ...args], home);
  const invoke = async (capability: string, input: Record<string, unknown>) => {
    const path = join(home, "request.json"); await writeFile(path, JSON.stringify({ protocolVersion: 1, capability, input }));
    const result = await run("invoke", "--input", path);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return JSON.parse(result.stdout).data;
  };
  try {
    const starts = await Promise.all([run("start"), run("start")]);
    for (const started of starts) expect(started.code, started.stderr + started.stdout).toBe(0);
    const first = JSON.parse(starts[0]!.stdout); expect(first).toMatchObject({ ok: true, running: true, dataDir });
    expect(JSON.parse(starts[1]!.stdout).pid).toBe(first.pid);
    expect(JSON.parse((await run("start")).stdout).pid).toBe(first.pid);
    const project = await invoke("usegpt.project.create", { name: "Persistent" });
    const task = await invoke("usegpt.task.create", { projectId: project.id, title: "Task", request: "Work" });
    const artifact = await invoke("usegpt.artifact.publish_inline", { projectId: project.id, taskId: task.id, name: "report.md", content: "durable 你好" });
    expect(JSON.parse((await run("status")).stdout)).toMatchObject({ running: true, pid: first.pid });
    process.kill(first.pid, "SIGTERM");
    const deadline = Date.now() + 5_000;
    while ((await daemonStatus(dataDir)).running && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    expect((await daemonStatus(dataDir)).running).toBe(false);
    expect((await run("start")).code).toBe(0);
    expect(await invoke("usegpt.task.get", { taskId: task.id })).toMatchObject({ title: "Task" });
    expect(await invoke("usegpt.artifact.read", { artifactId: artifact.id, revision: 1 })).toMatchObject({ content: "durable 你好" });
    expect(JSON.parse((await run("stop")).stdout)).toMatchObject({ ok: true, running: false });
    expect(JSON.parse((await run("stop")).stdout)).toMatchObject({ ok: true, running: false });
  } finally { await stopUseGptDaemon(dataDir); }
}, 20_000);

daemonIt("closes idle clients on shutdown and rejects malformed or oversized IPC frames", async () => {
  const home = await mkdtemp(join(tmpdir(), "arks-daemon-frame-")); homes.push(home);
  const daemon = await createUseGptDaemon(home);
  try {
    const invalid = await daemonRequest(home, { protocolVersion: 1, capability: "usegpt.project.create", input: { name: "" } });
    expect(invalid).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
    await expect(daemonRequest(home, { content: "x".repeat(1_300_000) })).rejects.toThrow(/exceeds/);
    const idle = createConnection(daemon.endpoint); idle.on("error", () => undefined);
    await once(idle, "connect");
    const disconnected = once(idle, "close");
    await stopUseGptDaemon(home); await disconnected; await daemon.closed;
    expect((await daemonStatus(home)).running).toBe(false);
  } finally { await daemon.close(); }
});

daemonIt("refuses symlink data directories and leaves their targets untouched", async () => {
  const home = await mkdtemp(join(tmpdir(), "arks-daemon-path-")); homes.push(home);
  const linked = `${home}-link`;
  await symlink(home, linked);
  try { await expect(createUseGptDaemon(linked)).rejects.toThrow(/Unsafe/); }
  finally { await rm(linked); }
  await expect(readFile(join(home, ".daemon", "owner.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

daemonIt("reports command failures as JSON on stdout", async () => {
  const home = await mkdtemp(join(tmpdir(), "arks-daemon-error-")); homes.push(home);
  const path = join(home, "request.json"); await writeFile(path, "{}");
  const result = await cli(["usegpt", "daemon", "invoke", "--data-dir", home, "--input", path], home);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, command: "usegpt.daemon.invoke" });
  const invalid = await cli(["usegpt", "daemon", "start", "--data-dir", "relative"], home);
  expect(invalid.code).toBe(1);
  expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, command: "usegpt.daemon.start" });
});
