import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const entry = resolve("dist/usegpt/secure-mcp-probe.js");
const resourceUri = "ui://usegpt-secure-mcp/probe.html";
const directories: string[] = [];
const processes: Array<{ child: ReturnType<typeof spawn>; closed: Promise<number | null> }> = [];

function launch(path: string | undefined, args: string[] = []) {
  const env = { ...process.env };
  delete env.ARKSPACE_USEGPT_PROBE_TASK_FILE;
  if (path !== undefined) env.ARKSPACE_USEGPT_PROBE_TASK_FILE = path;
  const child = spawn(process.execPath, [entry, ...args], { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", buffer = "", nextId = 0;
  const pending = new Map<number, (message: any) => void>();
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const closed = new Promise<number | null>((accept, reject) => { child.once("error", reject); child.once("close", accept); });
  const process_ = {
    child, closed,
    output: () => ({ stdout, stderr }),
    async request(method: string, params: unknown = {}) {
      const id = ++nextId;
      const reply = new Promise<any>((accept) => pending.set(id, accept));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      try {
        const message = await within(reply, 5_000, `MCP ${method}: ${stderr}`);
        if (message.error) throw new Error(JSON.stringify(message.error));
        return message.result;
      } finally { pending.delete(id); }
    },
    call(name: string, arguments_: unknown = {}) { return this.request("tools/call", { name: `usegpt_probe_${name}`, arguments: arguments_ }); },
  };
  processes.push(process_);
  return process_;
}

async function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_accept, reject) => { timer = setTimeout(() => reject(new Error(`Deadline exceeded: ${message}`)), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

afterEach(async () => {
  await Promise.all(processes.splice(0).map(async ({ child, closed }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    try { await within(closed, 2_000, "child cleanup"); }
    catch { child.kill("SIGKILL"); await within(closed, 2_000, "forced child cleanup"); }
  }));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-secure-probe-"));
  directories.push(directory);
  return join(directory, "task.json");
}
async function cli(path: string | undefined, args: string[]) {
  const process_ = launch(path, args);
  const code = await within(process_.closed, 5_000, "CLI exit");
  return { code, ...process_.output() };
}
async function connect(path: string) {
  const process_ = launch(path);
  await process_.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "probe-test", version: "1" } });
  process_.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return process_;
}
async function seed(path: string, prompt = "Explain this task and include the exact marker.") {
  const seeded = await cli(path, ["seed", prompt]);
  expect(seeded.code, seeded.stderr).toBe(0);
  return JSON.parse(seeded.stdout);
}
function expectError(result: any) { expect(result.isError).toBe(true); }

describe("single-task secure MCP probe over real stdio", () => {
  it("presents the App, binds claims, fences dispatch and completes idempotently", async () => {
    const path = await fixture();
    const task = await seed(path);
    const mcp = await connect(path);
    const tools = (await mcp.request("tools/list")).tools;
    expect(tools.find((tool: any) => tool.name === "usegpt_probe_claim")._meta).toMatchObject({
      "openai/widgetAccessible": true, ui: { visibility: ["app"] },
    });
    expect(tools.find((tool: any) => tool.name === "usegpt_probe_prepare")._meta).toMatchObject({ "openai/widgetAccessible": true, ui: { visibility: ["app"] } });
    expect((await mcp.call("present"))._meta["openai/outputTemplate"]).toBe(resourceUri);
    const resource = (await mcp.request("resources/read", { uri: resourceUri })).contents[0];
    expect(resource._meta).toMatchObject({ "openai/widgetCSP": { connect_domains: [], resource_domains: [] } });
    expect(resource.mimeType).toBe("text/html;profile=mcp-app");

    const claim = (await mcp.call("claim", { workerId: "owner" })).structuredContent;
    expect(claim).toMatchObject({ taskId: task.taskId, marker: task.marker, prompt: task.prompt, workerId: "owner", status: "claimed" });
    expect(claim.leaseToken).toEqual(expect.any(String));
    expect((await mcp.call("claim", { workerId: "owner" })).structuredContent).toEqual(claim);
    const busy = (await mcp.call("claim", { workerId: "other" })).structuredContent;
    expect(busy).toEqual({ status: "busy" });
    const identity = { taskId: claim.taskId, workerId: claim.workerId, leaseToken: claim.leaseToken };
    expectError(await mcp.call("prepare", { ...identity, workerId: "other" }));
    expectError(await mcp.call("prepare", { ...identity, leaseToken: "00000000-0000-4000-8000-000000000000" }));
    expect((await mcp.call("prepare", identity)).structuredContent).toMatchObject({ ...claim, status: "dispatch_prepared", dispatch: true });
    expect((await mcp.call("prepare", identity)).structuredContent).toEqual({ status: "dispatch_prepared", dispatch: false });
    expect((await (await connect(path)).call("claim", { workerId: "reload" })).structuredContent).toEqual({ status: "busy" });
    const complete = { ...identity, marker: task.marker, output: `Result: ${task.marker}` };
    expectError(await mcp.call("complete", { ...complete, workerId: "other" }));
    expectError(await mcp.call("complete", { ...complete, leaseToken: "00000000-0000-4000-8000-000000000000" }));
    expectError(await mcp.call("complete", { ...complete, marker: "wrong" }));
    expectError(await mcp.call("complete", { ...complete, output: "Missing marker" }));
    const completed = await mcp.call("complete", complete);
    expect(completed.structuredContent).toEqual({ taskId: task.taskId, status: "completed" });
    const stored = await readFile(path, "utf8");
    expect((await mcp.call("complete", complete)).structuredContent).toEqual(completed.structuredContent);
    expect(await readFile(path, "utf8")).toBe(stored);
    expectError(await mcp.call("complete", { ...complete, output: `Changed ${task.marker}` }));
    expectError(await mcp.call("complete", { ...complete, workerId: "other" }));
    expect((await mcp.call("status", { taskId: task.taskId })).structuredContent).toEqual({ taskId: task.taskId, status: "completed", output: complete.output });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("waits on empty state and allows exactly one owner across concurrent servers", async () => {
    const path = await fixture();
    const servers = await Promise.all([connect(path), connect(path), connect(path), connect(path)]);
    expect((await servers[0]!.call("claim", { workerId: "empty" })).structuredContent).toEqual({ status: "empty" });
    await seed(path);
    const claims = await Promise.all(servers.map((mcp, index) => mcp.call("claim", { workerId: `worker-${index}` })));
    expect(claims.filter((result) => result.structuredContent.status === "claimed")).toHaveLength(1);
    expect(claims.filter((result) => result.structuredContent.status === "busy")).toHaveLength(3);
  });

  it("requires an absolute state path and validates seed prompts without echoing input", async () => {
    for (const path of [undefined, "relative/task.json"]) {
      const result = await cli(path, ["seed", "test"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("ARKSPACE_USEGPT_PROBE_TASK_FILE");
      expect(result.stdout).toBe("");
    }
    const path = await fixture();
    for (const prompt of ["   ", "s".repeat(20_001)]) {
      const result = await cli(path, ["seed", prompt]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain(prompt);
    }
    expect((await cli(path, ["status"])).stdout.trim()).toBe('{"status":"empty"}');
  });

  it("refuses to overwrite active state and rejects invalid persisted state", async () => {
    const path = await fixture();
    const task = await seed(path);
    const original = await readFile(path, "utf8");
    expect((await cli(path, ["seed", "replacement"])).code).toBe(1);
    expect(await readFile(path, "utf8")).toBe(original);
    const mcp = await connect(path);
    const claim = (await mcp.call("claim", { workerId: "owner" })).structuredContent;
    expectError(await mcp.call("complete", { taskId: task.taskId, workerId: "owner", leaseToken: claim.leaseToken, marker: task.marker, output: task.marker }));
    expect((await cli(path, ["seed", "replacement"])).code).toBe(1);
    await writeFile(path, JSON.stringify({ ...task, status: "claimed" }));
    expectError(await mcp.call("claim", { workerId: "owner" }));
    expect((await cli(path, ["status"])).code).toBe(1);
  });

  it("serializes concurrent seed and prepare requests", async () => {
    const path = await fixture();
    const results = await Promise.all([cli(path, ["seed", "first"]), cli(path, ["seed", "second"])]);
    expect(results.map((result) => result.code).sort()).toEqual([0, 1]);
    const servers = await Promise.all([connect(path), connect(path)]);
    const claim = (await servers[0]!.call("claim", { workerId: "owner" })).structuredContent;
    const args = { taskId: claim.taskId, workerId: claim.workerId, leaseToken: claim.leaseToken };
    const prepared = await Promise.all(servers.map((mcp) => mcp.call("prepare", args)));
    expect(prepared.filter((result) => result.structuredContent.dispatch)).toHaveLength(1);
  });

  it("waits for the Host bridge, sends full claim data once, and reports deadline/errors", async () => {
    const mcp = await connect(await fixture());
    const html = (await mcp.request("resources/read", { uri: resourceUri })).contents[0].text as string;
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1]!;
    const claim = { status: "claimed", taskId: "task-1", workerId: "owner", leaseToken: "lease", marker: "MARKER", prompt: "Actual task prompt" };
    let clock = 0;
    const state = { textContent: "" };
    const timers: Array<() => void> = [];
    const followups: string[] = [];
    const calls: string[] = [];
    const window: { openai?: unknown } = {};
    const execution = runInNewContext(script, {
      window, document: { getElementById: () => state }, crypto: { randomUUID: () => "owner" },
      Date: { now: () => clock },
      setTimeout: (callback: () => void) => { timers.push(callback); }, clearTimeout: () => {},
    }) as Promise<void>;
    expect(calls).toHaveLength(0);
    window.openai = {
      async callTool(name: string) { calls.push(name); return { structuredContent: name.endsWith("prepare") ? { ...claim, status: "dispatch_prepared", dispatch: true } : claim }; },
      async sendFollowUpMessage({ prompt }: { prompt: string }) { followups.push(prompt); },
    };
    timers.shift()!();
    await within(execution, 1_000, "App bridge");
    expect(calls).toEqual(["usegpt_probe_claim", "usegpt_probe_prepare"]);
    for (const value of [claim.taskId, claim.marker, claim.workerId, claim.leaseToken, claim.prompt, "usegpt_probe_complete"]) expect(followups[0]).toContain(value);

    const timeoutState = { textContent: "" };
    const timeoutRun = runInNewContext(script, {
      window: {}, document: { getElementById: () => timeoutState }, crypto: { randomUUID: () => "reload" },
      Date: { now: () => clock }, setTimeout: (callback: () => void) => { clock += 300_001; queueMicrotask(callback); }, clearTimeout: () => {},
    }) as Promise<void>;
    await within(timeoutRun, 1_000, "App timeout");
    expect(timeoutState.textContent).toMatch(/timed out/i);
    const errorState = { textContent: "" };
    await runInNewContext(script, {
      window: { openai: { callTool: async () => ({ isError: true, content: [{ type: "text", text: "claim rejected" }] }), sendFollowUpMessage: async () => {} } },
      document: { getElementById: () => errorState }, crypto: { randomUUID: () => "owner" }, Date,
      setTimeout, clearTimeout,
    });
    expect(errorState.textContent).toMatch(/failed/i);

    const reloadCalls: string[] = [];
    await runInNewContext(script, {
      window: { openai: {
        callTool: async (name: string) => { reloadCalls.push(name); return { structuredContent: { status: "busy" } }; },
        sendFollowUpMessage: async () => { throw new Error("Reload must not resend"); },
      } },
      document: { getElementById: () => state }, crypto: { randomUUID: () => "reload" }, Date, setTimeout, clearTimeout,
    });
    expect(reloadCalls).toEqual(["usegpt_probe_claim"]);
    expect(state.textContent).toContain("No automatic resend");

    const hangingState = { textContent: "" };
    const hangingTimers: Array<() => void> = [];
    const hanging = runInNewContext(script, {
      window: { openai: { callTool: () => new Promise(() => {}), sendFollowUpMessage: async () => {} } },
      document: { getElementById: () => hangingState }, crypto: { randomUUID: () => "owner" }, Date,
      setTimeout: (callback: () => void, milliseconds: number) => {
        expect(milliseconds).toBeGreaterThan(0);
        expect(milliseconds).toBeLessThanOrEqual(300_000);
        hangingTimers.push(callback);
      }, clearTimeout: () => {},
    }) as Promise<void>;
    hangingTimers.shift()!();
    await within(hanging, 1_000, "hanging Host call timeout");
    expect(hangingState.textContent).toMatch(/timed out/i);
  });
});
