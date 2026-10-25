import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "../src/io/json-store.js";
import { UseGptTaskSchema, type UseGptEnvelope } from "../src/protocol/usegpt-schema.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { saveUseGptConfig } from "../src/config/usegpt.js";
import { executeUseGpt } from "../src/capabilities/usegpt.js";
import { startUseGptServer } from "../src/usegpt/server.js";
import type { ChatGptCdpDriver } from "../src/providers/usegpt-cdp.js";

const environment = { ARKSPACE_USEGPT_TOKEN: "test-token-012345678901234567890123456789" };
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const request = (capability: string, input: unknown = {}) => ({ protocolVersion: 1, capability, input });
const start = (requestId = "request_0001", prompt = "private prompt") => request("usegpt.task.start", { requestId, prompt, confirmed: true });
async function fixture(driver: Pick<ChatGptCdpDriver, "verify" | "run">) {
  const home = await mkdtemp(join(tmpdir(), "usegpt-test-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home });
  await saveUseGptConfig(paths, { enabled: true, cdpUrl: "http://127.0.0.1:9222", serviceUrl: "http://127.0.0.1:47832", tokenRef: "env:ARKSPACE_USEGPT_TOKEN" });
  const server = await startUseGptServer(paths, { environment, port: 0, driver });
  cleanup.push(() => server.close());
  await saveUseGptConfig(paths, { enabled: true, cdpUrl: "http://127.0.0.1:9222", serviceUrl: server.address, tokenRef: "env:ARKSPACE_USEGPT_TOKEN" });
  return { paths, server, invoke: (r: unknown, signal?: AbortSignal) => executeUseGpt(r, paths, environment, signal) };
}
const verify = async () => ({ connected: true, authenticated: true, composerAvailable: true });
const successDriver: Pick<ChatGptCdpDriver, "verify" | "run"> = { verify, run: async (_input, hooks) => { await hooks.onSubmitted(); return { output: "A你好😀Z", targetId: "owned", conversationUrl: "https://chatgpt.com/c/example", warnings: [] }; } };
function http(address: string, body: unknown, headers: Record<string, string> = {}, method = "POST"): Promise<{ status: number; body: UseGptEnvelope }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${address}/invoke`, { method, headers: { authorization: `Bearer ${environment.ARKSPACE_USEGPT_TOKEN}`, ...headers } }, res => {
      let text = ""; res.setEncoding("utf8"); res.on("data", chunk => { text += chunk; });
      res.on("end", () => { try { resolve({ status: res.statusCode!, body: JSON.parse(text) as UseGptEnvelope }); } catch (e) { reject(e); } });
    });
    req.on("error", reject); req.end(typeof body === "string" ? body : JSON.stringify(body));
  });
}
async function completed(f: Awaited<ReturnType<typeof fixture>>, initial = start()) {
  const result = await f.invoke(initial);
  expect(result.ok).toBe(true);
  const taskId = result.data!.taskId as string;
  const done = await f.invoke(request("usegpt.task.wait", { taskId, timeoutMs: 1000 }));
  expect(done.data?.status).toBe("completed");
  return UseGptTaskSchema.parse(done.data);
}

it("acknowledges a persisted queue, deduplicates requests and completes independently of the start client", async () => {
  const finish = deferred<void>();
  const submitted = deferred<void>();
  let calls = 0;
  const f = await fixture({ verify, run: async (_input, hooks) => { calls++; await hooks.onSubmitted(); submitted.resolve(); await finish.promise; return { output: "answer", targetId: "owned", conversationUrl: "https://chatgpt.com/c/example", warnings: [] }; } });
  cleanup.push(async () => { finish.resolve(); });
  const accepted = await f.invoke(start());
  expect(accepted.ok).toBe(true);
  expect(accepted.data?.status).toBe("queued");
  const taskId = accepted.data!.taskId;
  await submitted.promise;
  expect((await f.invoke(start())).data?.taskId).toBe(taskId);
  expect((await f.invoke(start("request_0001", "changed"))).error?.kind).toBe("conflict");
  expect((await f.invoke(request("usegpt.task.wait", { taskId, timeoutMs: 5 }))).data?.status).toBe("possibly_running");
  expect(await readFile(join(f.paths.home, "usegpt", "tasks.json"), "utf8")).not.toContain("private prompt");
  finish.resolve();
  const completed = await f.invoke(request("usegpt.task.wait", { taskId, timeoutMs: 1000 }));
  expect(completed.data).toMatchObject({ status: "completed", output: "answer" });
  expect(calls).toBe(1);
});

it("serializes execution and cancels queued work without dispatching it", async () => {
  const submitted = deferred<void>(); const finish = deferred<void>(); let calls = 0;
  const f = await fixture({ verify, run: async (_input, hooks) => { calls++; await hooks.onSubmitted(); submitted.resolve(); await finish.promise; return { output: "done", targetId: "owned", warnings: [] }; } });
  cleanup.push(async () => finish.resolve());
  const first = await f.invoke(start()); await submitted.promise;
  const second = await f.invoke(start("request_0002"));
  expect(second.data?.status).toBe("queued");
  expect(calls).toBe(1);
  const taskId = second.data!.taskId;
  expect((await f.invoke(request("usegpt.task.cancel", { taskId, confirmed: true }))).data?.status).toBe("cancelled");
  finish.resolve();
  await f.invoke(request("usegpt.task.wait", { taskId: first.data!.taskId, timeoutMs: 1000 }));
  expect(calls).toBe(1);
});

it("keeps cancellation_requested until driver settlement and never claims guaranteed remote stop", async () => {
  const submitted = deferred<void>(); const finish = deferred<void>(); let signal: AbortSignal | undefined;
  const f = await fixture({ verify, run: async (_input, hooks, abort) => { signal = abort; await hooks.onSubmitted(); submitted.resolve(); await finish.promise; throw new Error("private driver error with credentials"); } });
  cleanup.push(async () => finish.resolve());
  const initial = await f.invoke(start()); const taskId = initial.data!.taskId; await submitted.promise;
  const cancel = await f.invoke(request("usegpt.task.cancel", { taskId, confirmed: true }));
  expect(cancel.data?.status).toBe("cancellation_requested");
  expect(cancel.data?.warnings).toContain("Cancellation requested; remote execution is not guaranteed to stop.");
  expect(signal?.aborted).toBe(true);
  expect((await f.invoke(request("usegpt.task.get", { taskId }))).data?.status).toBe("cancellation_requested");
  finish.resolve();
  const settled = await f.invoke(request("usegpt.task.wait", { taskId, timeoutMs: 30 }));
  expect(settled.data?.status).toBe("possibly_running");
  expect(JSON.stringify(settled)).not.toContain("private driver error");
});

it("does not cancel a task when a wait client disconnects", async () => {
  const submitted = deferred<void>(); const finish = deferred<void>(); let taskSignal: AbortSignal | undefined;
  const f = await fixture({ verify, run: async (_input, hooks, signal) => { taskSignal = signal; await hooks.onSubmitted(); submitted.resolve(); await finish.promise; return { output: "survived", targetId: "owned", warnings: [] }; } });
  cleanup.push(async () => finish.resolve());
  const first = await f.invoke(start()); const taskId = first.data!.taskId; await submitted.promise;
  const controller = new AbortController();
  const waiting = f.invoke(request("usegpt.task.wait", { taskId, timeoutMs: 60_000 }), controller.signal);
  controller.abort(); await waiting;
  expect(taskSignal?.aborted).toBe(false);
  finish.resolve();
  expect((await f.invoke(request("usegpt.task.wait", { taskId, timeoutMs: 1000 }))).data?.output).toBe("survived");
});

it("binds follow-ups to a completed validated conversation and returns a new deduplicated task", async () => {
  const conversations: Array<string | undefined> = [];
  const f = await fixture({ verify, run: async (input, hooks, signal) => { conversations.push(input.conversationId); return successDriver.run(input, hooks, signal); } });
  const first = await completed(f);
  const follow = request("usegpt.task.follow_up", { taskId: first.taskId, requestId: "follow_0001", prompt: "continue", confirmed: true });
  const accepted = await f.invoke(follow);
  expect(accepted.data?.taskId).not.toBe(first.taskId);
  expect((await f.invoke(follow)).data?.taskId).toBe(accepted.data?.taskId);
  await f.invoke(request("usegpt.task.wait", { taskId: accepted.data!.taskId, timeoutMs: 1000 }));
  expect(conversations).toEqual([undefined, "example"]);
  expect((await f.invoke({ ...follow, input: { ...follow.input as object, prompt: "conflict" } })).error?.kind).toBe("conflict");
});

it("returns bounded UTF-8 result.txt transfers with metadata, and explicitly refuses binary artifacts", async () => {
  const f = await fixture(successDriver); const task = await completed(f);
  const get = (offset: number, limit: number, artifactId = "result") => f.invoke(request("usegpt.artifact.get", { taskId: task.taskId, artifactId, offset, limit }));
  const first = await get(0, 4);
  expect(first.data).toMatchObject({ content: "A你", nextOffset: 4, eof: false, encoding: "utf8", artifact: { id: "result", name: "result.txt", sizeBytes: 12 } });
  const second = await get(4, 100);
  expect(second.data).toMatchObject({ content: "好😀Z", nextOffset: 12, eof: true });
  expect((await get(2, 20)).error?.kind).toBe("range");
  expect((await get(1, 1)).error?.kind).toBe("range");
  expect((await get(0, 100, "image")).error?.kind).toBe("unsupported");
  expect(task.warnings.join(" ")).toContain("Binary artifact downloads are unsupported");
  expect(task.artifacts[0]?.sha256).toBe("9e3de153e002e924eaed090d247947889e2691da44c57017a2373569acb8568e");
});

it("authenticates every route and rejects wrong Host, browser Origin, malformed and excessive requests", async () => {
  const f = await fixture(successDriver);
  for (const headers of [{ authorization: "" }, { authorization: "Bearer invalid" }, { host: "evil.example" }, { host: "127.0.0.1:1" }, { origin: "null" }, { origin: "" }, { "sec-fetch-mode": "cors" }]) {
    expect((await http(f.server.address, request("usegpt.connection.status"), headers)).status).toBe(401);
  }
  expect((await http(f.server.address, request("usegpt.connection.status"))).body.data).toEqual(await verify());
  const unauthHealth = await fetch(`${f.server.address}/health`);
  expect(unauthHealth.status).toBe(401);
  expect((await http(f.server.address, "{")).status).toBe(400);
  expect((await http(f.server.address, request("usegpt.task.wait", { taskId: `ugpt_${randomUUID()}`, timeoutMs: 60_001 }))).body.ok).toBe(false);
  expect((await http(f.server.address, "x".repeat(1_300_001))).status).toBe(400);
});

it("protects daemon ownership and persists private state without prompt, files or token", async () => {
  const f = await fixture(successDriver);
  await expect(startUseGptServer(f.paths, { environment, port: 0, driver: successDriver })).rejects.toThrow(/owns/);
  await completed(f, request("usegpt.task.start", { requestId: "privacy_0001", prompt: "SECRET_PROMPT", files: [{ name: "secret.txt", content: "SECRET_FILE_CONTENT" }], confirmed: true }));
  const state = await readFile(join(f.paths.home, "usegpt", "tasks.json"), "utf8");
  for (const secret of ["SECRET_PROMPT", "SECRET_FILE_CONTENT", "secret.txt", environment.ARKSPACE_USEGPT_TOKEN]) expect(state).not.toContain(secret);
  expect((await stat(join(f.paths.home, "usegpt", "tasks.json"))).mode & 0o777).toBe(0o600);
  await f.server.close();
  const second = await startUseGptServer(f.paths, { environment, port: 0, driver: successDriver }); cleanup.push(() => second.close());
  expect(second.address).toMatch(/^http:\/\/127\.0\.0\.1:/);
});

it("recovers uncertain tasks, fails lost queues, preserves dedupe and never automatically replays", async () => {
  let calls = 0;
  const f = await fixture({ verify, run: async (input, hooks, signal) => { calls++; return successDriver.run(input, hooks, signal); } });
  const done = await completed(f);
  await f.server.close();
  const path = join(f.paths.home, "usegpt", "tasks.json");
  const persisted = JSON.parse(await readFile(path, "utf8")) as { records: Array<{ task: typeof done; fingerprint: string; implementation: string }> };
  const original = persisted.records[0]!;
  for (const status of ["running", "possibly_running", "cancellation_requested", "queued"] as const) {
    persisted.records.push({ ...original, task: { ...done, taskId: `ugpt_${randomUUID()}`, requestId: `recover_${status}`, status } });
  }
  await writeJsonAtomic(path, persisted);
  const server = await startUseGptServer(f.paths, { environment, port: 0, driver: successDriver }); cleanup.push(() => server.close());
  await saveUseGptConfig(f.paths, { enabled: true, cdpUrl: "http://127.0.0.1:9222", serviceUrl: server.address, tokenRef: "env:ARKSPACE_USEGPT_TOKEN" });
  const tasks = (await f.invoke(request("usegpt.task.list"))).data!.tasks as Array<typeof done>;
  for (const task of tasks.filter(t => t.requestId.startsWith("recover_"))) {
    expect(task.status).toBe(task.requestId === "recover_queued" ? "failed" : "possibly_running");
    if (task.status === "possibly_running") expect(task.warnings.join(" ")).toContain("Service restarted");
  }
  expect((await f.invoke(start())).data?.taskId).toBe(done.taskId);
  expect(calls).toBe(1);
});

it("distinguishes failures before submission from uncertain failures after submission without retries", async () => {
  let calls = 0;
  const f = await fixture({ verify, run: async (input, hooks) => { calls++; if (input.prompt === "after") await hooks.onSubmitted(); throw new Error(`raw credential ${environment.ARKSPACE_USEGPT_TOKEN}`); } });
  const first = await f.invoke(start("before_001", "before"));
  expect((await f.invoke(request("usegpt.task.wait", { taskId: first.data!.taskId, timeoutMs: 1000 }))).data?.status).toBe("failed");
  const second = await f.invoke(start("after_0001", "after"));
  const uncertain = await f.invoke(request("usegpt.task.wait", { taskId: second.data!.taskId, timeoutMs: 20 }));
  expect(uncertain.data?.status).toBe("possibly_running");
  expect(JSON.stringify(uncertain)).not.toContain(environment.ARKSPACE_USEGPT_TOKEN);
  expect((await f.invoke(start("after_0001", "after"))).data?.taskId).toBe(second.data!.taskId);
  expect(calls).toBe(2);
});

it("rejects invalid config/token boundaries and corrupted state without overwriting it", async () => {
  const f = await fixture(successDriver); await f.server.close();
  for (const token of [undefined, "short", "x".repeat(32) + " ", "你".repeat(32)]) {
    const env = token === undefined ? {} : { ARKSPACE_USEGPT_TOKEN: token };
    await expect(startUseGptServer(f.paths, { environment: env, port: 0, driver: successDriver })).rejects.toThrow(/TOKEN/);
    expect((await executeUseGpt(start(), f.paths, env)).error?.kind).toBe("config");
  }
  const path = join(f.paths.home, "usegpt", "tasks.json");
  await writeJsonAtomic(path, { records: [{ task: { status: "unknown" } }] });
  const original = await readFile(path, "utf8");
  await expect(startUseGptServer(f.paths, { environment, port: 0, driver: successDriver })).rejects.toThrow(/state/);
  expect(await readFile(path, "utf8")).toBe(original);
  for (const serviceUrl of ["http://example.com", "http://user:pass@127.0.0.1", "http://127.0.0.1/path", "https://127.0.0.1"]) {
    await expect(saveUseGptConfig(f.paths, { enabled: true, cdpUrl: "http://127.0.0.1:9222", serviceUrl, tokenRef: "env:ARKSPACE_USEGPT_TOKEN" })).rejects.toThrow();
  }
});

it("does not expose raw driver diagnostics in persisted task warnings", async () => {
  const f = await fixture({ verify, run: async (input, hooks, signal) => ({ ...await successDriver.run(input, hooks, signal), warnings: [`private diagnostic ${environment.ARKSPACE_USEGPT_TOKEN}`] }) });
  const task = await completed(f);
  expect(JSON.stringify(task)).not.toContain(environment.ARKSPACE_USEGPT_TOKEN);
});

it("times out submitted work conservatively and does not release concurrency before driver settlement", async () => {
  const submitted = deferred<void>(); const abortSeen = deferred<void>(); const settle = deferred<void>(); let calls = 0;
  const f = await fixture({ verify, run: async (_input, hooks, signal) => {
    calls++; await hooks.onSubmitted(); submitted.resolve();
    await new Promise<void>(resolve => signal!.addEventListener("abort", () => { abortSeen.resolve(); resolve(); }, { once: true }));
    await settle.promise; throw new Error("timeout");
  } });
  cleanup.push(async () => settle.resolve());
  const first = await f.invoke(request("usegpt.task.start", { requestId: "timeout_001", prompt: "wait", timeoutMs: 10_000, confirmed: true }));
  await submitted.promise;
  await abortSeen.promise;
  const next = await f.invoke(start("timeout_002"));
  expect(next.data?.status).toBe("queued");
  expect(calls).toBe(1);
  await f.invoke(request("usegpt.task.cancel", { taskId: next.data!.taskId, confirmed: true }));
  settle.resolve();
  const result = await f.invoke(request("usegpt.task.wait", { taskId: first.data!.taskId, timeoutMs: 30 }));
  expect(result.data?.status).toBe("possibly_running");
  expect(calls).toBe(1);
}, 15_000);

it("deduplicates simultaneous starts and persists onSubmitted before the driver dispatches", async () => {
  const dispatched = deferred<void>(); const finish = deferred<void>(); let calls = 0;
  let paths: ReturnType<typeof resolveArkSpacePaths>;
  const f = await fixture({ verify, run: async (_input, hooks) => {
    calls++; await hooks.onSubmitted();
    const state = await readFile(join(paths.home, "usegpt", "tasks.json"), "utf8");
    expect(state).toContain('"status": "possibly_running"');
    dispatched.resolve(); await finish.promise; return { output: "done", targetId: "owned", warnings: [] };
  } });
  paths = f.paths; cleanup.push(async () => finish.resolve());
  const accepted = await Promise.all(Array.from({ length: 6 }, () => f.invoke(start())));
  expect(new Set(accepted.map(r => r.data?.taskId)).size).toBe(1);
  await dispatched.promise; expect(calls).toBe(1);
  finish.resolve();
});

it("rejects follow-up on unfinished tasks and invalid conversation URLs", async () => {
  const finish = deferred<void>();
  const f = await fixture({ verify, run: async (_input, hooks) => { await hooks.onSubmitted(); await finish.promise; return { output: "text", targetId: "owned", conversationUrl: "https://evil.example/c/id", warnings: [] }; } });
  cleanup.push(async () => finish.resolve());
  const initial = await f.invoke(start());
  const follow = () => f.invoke(request("usegpt.task.follow_up", { taskId: initial.data!.taskId, requestId: "follow_bad01", prompt: "continue", confirmed: true }));
  expect((await follow()).error?.kind).toBe("state");
  finish.resolve();
  expect((await f.invoke(request("usegpt.task.wait", { taskId: initial.data!.taskId, timeoutMs: 20 }))).data?.status).toBe("possibly_running");
  expect((await follow()).ok).toBe(false);
});

it("validates per-capability client responses, refuses redirects, reports uncertain starts and bypasses proxy env", async () => {
  const f = await fixture(successDriver); await f.server.close();
  let calls = 0; let mode = "task";
  const stub = createServer((req, res) => {
    calls++; req.resume();
    if (mode === "redirect") { res.writeHead(302, { location: "http://127.0.0.1:9/" }); res.end(); return; }
    if (mode === "large") { res.end("x".repeat(16_000_001)); return; }
    if (mode === "disconnect") { req.socket.destroy(); return; }
    const capability = mode === "task" ? "usegpt.task.start" : mode === "artifact" ? "usegpt.artifact.get" : "usegpt.connection.status";
    res.end(JSON.stringify({ protocolVersion: 1, ok: true, connection: "usegpt", capability, warnings: [], data: mode === "valid" ? { connected: true, authenticated: true, composerAvailable: true } : {} }));
  });
  await new Promise<void>(resolve => stub.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => { stub.close(() => resolve()); stub.closeAllConnections(); }));
  const port = (stub.address() as { port: number }).port;
  await saveUseGptConfig(f.paths, { enabled: true, cdpUrl: "http://127.0.0.1:1", serviceUrl: `http://127.0.0.1:${port}`, tokenRef: "env:ARKSPACE_USEGPT_TOKEN" });
  expect((await f.invoke(start())).error?.kind).toBe("uncertain");
  mode = "artifact";
  expect((await f.invoke(request("usegpt.artifact.get", { taskId: `ugpt_${randomUUID()}`, artifactId: "result" }))).ok).toBe(false);
  for (mode of ["redirect", "large", "disconnect"]) {
    const result = await f.invoke(start());
    expect(result.error).toMatchObject({ kind: "uncertain", retryable: false });
    expect(result.error?.message).toContain("same requestId");
  }
  expect(calls).toBe(5);
  mode = "valid";
  expect((await executeUseGpt(request("usegpt.connection.status"), f.paths, { ...environment, HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1" })).ok).toBe(true);
});


