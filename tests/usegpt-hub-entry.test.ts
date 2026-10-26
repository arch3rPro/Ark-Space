import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultConfig } from "../src/config/schema.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { invokeCapability, isCapability } from "../src/protocol/invoke.js";
import { UseGptInputSchemas } from "../src/protocol/usegpt-schema.js";
import { createMcpServer } from "../src/mcp/server.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-hub-entry-")); homes.push(home);
  const config = defaultConfig();
  config.connections = { usegpt: { enabled: true, dataDir: join(home, "hub data") } };
  await writeFile(join(home, "config.json"), JSON.stringify(config));
  await writeFile(join(home, "credentials.json"), "malformed-private-credential");
  const environment = { ...process.env, ARKSPACE_HOME: home, CONTROL_PLANE_API_KEY: "", ARKSPACE_USEGPT_TOKEN: "" };
  return { home, environment, paths: resolveArkSpacePaths(environment) };
}
function cli(args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve("dist/cli/main.js"), ...args], { cwd: tmpdir(), env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject); child.on("close", code => done({ code, stdout, stderr }));
  });
}

it("registers hub operations with matching MCP and generated request schemas", async () => {
  const server = createMcpServer();
  for (const operation of ["project.create", "project.list", "project.archive", "project.purge", "task.create", "task.complete", "task.wait", "artifact.publish_inline", "artifact.read", "handoff.create", "handoff.claim", "handoff.fail", "storage.usage", "delete.preview"]) {
    const capability = `usegpt.${operation}`;
    expect(isCapability(capability), capability).toBe(true);
    expect(server.toolInputSchemaJson(capability.replaceAll(".", "_")), capability).toBeDefined();
    const schema = JSON.parse(await readFile(resolve(`schemas/protocol/v1/${capability.replaceAll(".", "-")}-request.schema.json`), "utf8"));
    expect(schema.properties.capability.const).toBe(capability);
  }
});

it("dispatches locally without tunnel credentials and rejects legacy browser execution", async () => {
  const f = await fixture();
  const call = (capability: string, input = {}) => invokeCapability(capability as Parameters<typeof invokeCapability>[0], { protocolVersion: 1, capability, input }, f) as Promise<{ ok: boolean; data?: Record<string, unknown>; error?: { kind: string } }>;
  const project = await call("usegpt.project.create", { name: "Launch" });
  expect(project).toMatchObject({ ok: true, data: { name: "Launch" } });
  const task = await call("usegpt.task.create", { projectId: project.data!.id, title: "Research", request: "Prepare report" });
  expect(task).toMatchObject({ ok: true, data: { status: "queued" } });
  const artifact = await call("usegpt.artifact.publish_inline", { projectId: project.data!.id, taskId: task.data!.id, name: "report.md", content: "A你B" });
  expect(await call("usegpt.artifact.read", { artifactId: artifact.data!.id, revision: 1, limit: 4 })).toMatchObject({ ok: true, data: { content: "A你", eof: false } });
  expect(await call("usegpt.task.start", { requestId: "request_123", prompt: "Work", confirmed: true })).toMatchObject({ ok: false, error: { kind: "unsupported" } });
  const invalid = await call("usegpt.project.get", { projectId: "private/path/secret" });
  expect(invalid.ok).toBe(false); expect(JSON.stringify(invalid)).not.toContain("private/path/secret");
  expect(UseGptInputSchemas["usegpt.task.wait"].safeParse({ taskId: task.data!.id, timeoutMs: 60_001 }).success).toBe(false);
});

it("uses the built CLI from outside the repository with isolated hub data", async () => {
  const f = await fixture();
  const created = await cli(["usegpt", "project", "create", "--name", "CLI project", "--json"], f.environment);
  expect(created.code, created.stderr + created.stdout).toBe(0);
  const project = JSON.parse(created.stdout).data;
  const request = join(f.home, "request.json");
  await writeFile(request, JSON.stringify({ protocolVersion: 1, capability: "usegpt.task.create", input: { projectId: project.id, title: "CLI task", request: "Work" } }));
  const taskResult = await cli(["invoke", "usegpt.task.create", "--input", request], f.environment);
  expect(taskResult.code, taskResult.stdout + taskResult.stderr).toBe(0);
  const task = JSON.parse(taskResult.stdout).data;
  const contentPath = join(f.home, "content.txt"); await writeFile(contentPath, "local file content");
  const published = await cli(["usegpt", "artifact", "publish-inline", "--project-id", project.id, "--task-id", task.id, "--name", "report.txt", "--input-file", contentPath], f.environment);
  expect(published.code, published.stdout + published.stderr).toBe(0);
  const artifact = JSON.parse(published.stdout).data;
  const read = await cli(["usegpt", "artifact", "read", artifact.id, "--revision", "1"], f.environment);
  expect(JSON.parse(read.stdout)).toMatchObject({ ok: true, data: { content: "local file content" } });
  await writeFile(contentPath, Buffer.alloc(1_048_577));
  const oversized = await cli(["usegpt", "artifact", "publish-inline", "--project-id", project.id, "--name", "too-big", "--input-file", contentPath], f.environment);
  expect(oversized.code).toBe(1); expect(oversized.stdout + oversized.stderr).not.toContain(contentPath);
});

it("dispatches hub operations over the built MCP stdio entry", async () => {
  const f = await fixture();
  const child = spawn(process.execPath, [resolve("dist/cli/main.js"), "mcp", "serve"], { cwd: tmpdir(), env: f.environment, stdio: ["pipe", "pipe", "pipe"] });
  const messages: Array<Record<string, unknown>> = []; let buffer = "", stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  child.stdout.on("data", chunk => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) if (line.trim()) messages.push(JSON.parse(line)); });
  const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const wait = async (id: number) => {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) { const message = messages.find(m => m.id === id); if (message) return message; await new Promise(r => setTimeout(r, 10)); }
    throw new Error(`No MCP response ${id}: ${stderr}`);
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "hub-test", version: "1" } } }); await wait(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "usegpt_project_create", arguments: { name: "MCP project" } } });
    expect(await wait(2)).toMatchObject({ result: { isError: false, structuredContent: { ok: true, capability: "usegpt.project.create", data: { name: "MCP project" } } } });
  } finally { child.kill("SIGTERM"); }
});
