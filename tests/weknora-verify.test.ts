import { mkdtemp, rm, readFile, realpath, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Ajv } from "ajv";
import { WeknoraVerifyEnvelopeSchema, WeknoraVerifyRequestSchema } from "../src/protocol/weknora-schema.js";
import { localHttpGet, localHttpWeknoraVerify } from "../src/providers/local-http.js";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { defaultConfig } from "../src/config/schema.js";
import { storeCredential } from "../src/config/credentials.js";
import { writeJsonAtomic } from "../src/io/json-store.js";
import { invokeCapability, isCapability } from "../src/protocol/invoke.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });
async function fixture(status = 200, body = '{"success":true,"data":{"email":"private-identity"}}', apiKey = "fixture-managed-secret") {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    expect(req.url).toBe("/prefix/api/v1/auth/me");
    expect(req.headers["x-api-key"]).toBe(apiKey);
    res.writeHead(status, { "content-type": "application/json", ...(status === 302 ? { location: "/leak" } : {}) }); res.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const home = await mkdtemp(join(tmpdir(), "arks-verify-")); cleanups.push(() => rm(home, { recursive: true, force: true }));
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home });
  const config = defaultConfig();
  config.connections = { weknora: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/prefix/api/v1`, apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", allowRanges: [] } };
  await writeJsonAtomic(paths.config, config);
  await storeCredential(paths.credentials, "ARKSPACE_WEKNORA_API_KEY", "fixture-managed-secret");
  const run = (input: object = { confirmed: true }, originalEnvironment: NodeJS.ProcessEnv | undefined = {}) => invokeCapability("weknora.connection.verify", { protocolVersion: 1, capability: "weknora.connection.verify", input }, { paths, ...(originalEnvironment === undefined ? {} : { originalEnvironment }) });
  return { run, calls: () => calls, paths };
}
it("registers a non-Web verification capability and returns no identity, provider or attempts", async () => {
  expect(isCapability("weknora.connection.verify")).toBe(true);
  const f = await fixture(); const result = await f.run();
  expect(result).toMatchObject({ ok: true, connection: "weknora", source: "managed", data: { outcome: "accepted", status: 200 } });
  expect(result).not.toHaveProperty("provider"); expect(result).not.toHaveProperty("attempts");
  expect(JSON.stringify(result)).not.toMatch(/fixture-managed-secret|private-identity/); expect(f.calls()).toBe(1);
});
it.each([undefined, false, true])("accepts HTTP without a transport gate (legacy allowHttp=%s)", async allowHttp => {
  const f = await fixture();
  expect(await f.run({ confirmed: true, ...(allowHttp === undefined ? {} : { allowHttp }) })).toMatchObject({ ok: true });
  expect(f.calls()).toBe(1);
});
it("rejects absent network consent, arbitrary forwarding and missing original provenance offline", async () => {
  const f = await fixture();
  for (const input of [{}, { confirmed: false }, { confirmed: true, allowHttp: true, headers: { secret: "value" } }, { confirmed: true, timeoutMs: 5001 }]) expect(await f.run(input)).toMatchObject({ ok: false });
  expect(await invokeCapability("weknora.connection.verify", { protocolVersion: 1, capability: "weknora.connection.verify", input: { confirmed: true, allowHttp: true } }, { paths: f.paths })).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(f.calls()).toBe(0);
});
it.each([[401, "auth"], [403, "permission"], [429, "rate-limit"], [500, "http-status"], [302, "redirect"]])("classifies HTTP %s without payloads or retry", async (status, kind) => {
  const f = await fixture(status as number, '{"secret":"fixture-managed-secret"}');
  const result = await f.run(); expect(result).toMatchObject({ ok: false, error: { kind, retryable: false } });
  expect(JSON.stringify(result)).not.toContain("fixture-managed-secret"); expect(f.calls()).toBe(1);
});
it.each([['{"success":false,"error":"fixture-managed-secret"}', "business-failure"], ['not json fixture-managed-secret', "invalid-response"], ['{"data":{}}', "invalid-response"]])("checks business and JSON shape", async (body, kind) => {
  const f = await fixture(200, body); expect(await f.run()).toMatchObject({ ok: false, error: { kind } });
});
it("never completes an external pair with a stored value or accepts an external managed-reference override", async () => {
  const f = await fixture();
  for (const environment of [{ WEKNORA_API_KEY: "fixture-external-secret" }, { WEKNORA_BASE_URL: "https://external.example/api/v1" }, { ARKSPACE_WEKNORA_API_KEY: "fixture-override" }]) expect(await f.run(undefined, environment)).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(f.calls()).toBe(0);
});

it("validates generated request and non-Web response schemas", async () => {
  const ajv = new Ajv();
  const request = ajv.compile(JSON.parse(await readFile("schemas/protocol/v1/weknora-connection-verify-request.schema.json", "utf8")));
  expect(request.schema).toMatchObject({ properties: { input: { properties: { allowHttp: { description: expect.stringContaining("Ignored compatibility field; not required for HTTP.") } } } } });
  const response = ajv.compile(JSON.parse(await readFile("schemas/protocol/v1/weknora-connection-verify-response.schema.json", "utf8")));
  const input = { protocolVersion: 1, capability: "weknora.connection.verify", input: { confirmed: true, allowHttp: true } };
  expect(request(input)).toBe(true); expect(WeknoraVerifyRequestSchema.safeParse(input).success).toBe(true);
  const f = await fixture();
  for (const result of [await f.run(), await f.run({})]) {
    expect(response(result), JSON.stringify(response.errors)).toBe(true);
    expect(WeknoraVerifyEnvelopeSchema.safeParse(result).success).toBe(true);
    expect(response({ ...result, provider: "local", attempts: [] })).toBe(false);
  }
});
it("allows the configured private WeKnora endpoint without CIDRs but keeps generic local HTTP blocked", async () => {
  const f = await fixture();
  const config = JSON.parse(await readFile(f.paths.config, "utf8"));
  config.connections.weknora.allowRanges = [];
  await writeJsonAtomic(f.paths.config, config);
  const credentials = await readFile(f.paths.credentials, "utf8");
  await expect(localHttpGet(`${config.connections.weknora.baseUrl}/auth/me`)).rejects.toMatchObject({ kind: "blocked-address" });
  expect(f.calls()).toBe(0);
  expect(await f.run()).toMatchObject({ ok: true, data: { outcome: "accepted" } });
  expect(f.calls()).toBe(1);
  config.connections.weknora.allowRanges = ["192.168.1.0/24"];
  await writeJsonAtomic(f.paths.config, config);
  expect(await f.run()).toMatchObject({ ok: true }); expect(f.calls()).toBe(2);
  expect(await readFile(f.paths.credentials, "utf8")).toBe(credentials);
});
it("forces authenticated redirect refusal even when options request redirects", async () => {
  const f = await fixture(302);
  const config = JSON.parse(await readFile(f.paths.config, "utf8"));
  await expect(localHttpWeknoraVerify(config.connections.weknora.baseUrl, "fixture-managed-secret", { allowRanges: ["127.0.0.1/32"], maxRedirects: 20 })).rejects.toMatchObject({ kind: "redirect" });
  expect(f.calls()).toBe(1);
});
it("validates all DNS answers, pins one lookup and enforces authenticated header/body limits", async () => {
  const f = await fixture();
  const config = JSON.parse(await readFile(f.paths.config, "utf8"));
  const root = config.connections.weknora.baseUrl.replace("127.0.0.1", "fixture.test");
  expect((await localHttpWeknoraVerify(root, "fixture-managed-secret", { lookup: async () => [{ address: "127.0.0.1", family: 4 }, { address: "10.0.0.1", family: 4 }, { address: "::1", family: 6 }] })).status).toBe(200);
  expect(f.calls()).toBe(1);
  for (const answers of [[], [{ address: "invalid", family: 4 }], [{ address: "127.0.0.1", family: 6 }], [{ address: "::1", family: 4 }], [{ address: "127.0.0.1", family: 4 }, { address: "invalid", family: 4 }]]) {
    await expect(localHttpWeknoraVerify(root, "fixture-managed-secret", { lookup: async () => answers })).rejects.toMatchObject({ kind: "dns" });
  }
  expect(f.calls()).toBe(1);
  let lookups = 0;
  expect((await localHttpWeknoraVerify(root, "fixture-managed-secret", { allowRanges: ["127.0.0.1/32"], lookup: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; } })).status).toBe(200);
  expect(lookups).toBe(1);
  expect((await localHttpWeknoraVerify(root, "fixture-managed-secret", { lookup: async () => [{ address: "::ffff:7f00:1", family: 6 }] })).status).toBe(200);
  const large = await fixture(200, JSON.stringify({ success: true, data: "x".repeat(65536) }));
  const largeConfig = JSON.parse(await readFile(large.paths.config, "utf8"));
  await expect(localHttpWeknoraVerify(largeConfig.connections.weknora.baseUrl, "fixture-managed-secret", { allowRanges: ["127.0.0.1/32"], maxBodyBytes: 16 * 1024 * 1024 })).rejects.toMatchObject({ kind: "body" });
  await expect(localHttpWeknoraVerify(root, "x".repeat(4097))).rejects.toMatchObject({ kind: "configuration" });
  await expect(localHttpWeknoraVerify(root, "header\r\ninjection")).rejects.toMatchObject({ kind: "configuration" });
});
it("enforces the authenticated response header cap even if caller options raise it", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(200, { "content-type": "application/json", "x-synthetic-large": "x".repeat(20 * 1024) });
    res.end('{"success":true}');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  await expect(localHttpWeknoraVerify(root, "fixture-header-key", { allowRanges: ["127.0.0.1/32"], maxHeaderBytes: 64 * 1024 })).rejects.toMatchObject({ kind: "headers", message: "Local HTTP request failed (headers)." });
  expect(calls).toBe(1);
});
it("rejects authenticated trustEnvProxy=true before DNS or any request", async () => {
  const f = await fixture();
  const config = JSON.parse(await readFile(f.paths.config, "utf8"));
  const root = config.connections.weknora.baseUrl.replace("127.0.0.1", "fixture.test");
  let lookups = 0;
  await expect(localHttpWeknoraVerify(root, "fixture-managed-secret", {
    allowRanges: ["127.0.0.1/32"], trustEnvProxy: true,
    lookup: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; },
  })).rejects.toMatchObject({ kind: "configuration", message: "Local HTTP request failed (configuration)." });
  expect(lookups).toBe(0); expect(f.calls()).toBe(0);
});
it("rejects an untrusted TLS certificate despite ambient TLS-disable in an isolated Node child", async () => {
  const pem = await readFile(new URL("./fixtures/weknora-synthetic-self-signed.txt", import.meta.url), "utf8");
  let authenticatedRequests = 0, controlRequests = 0;
  const server = createHttpsServer({ key: pem, cert: pem }, (req, res) => {
    if (req.headers["x-api-key"]) authenticatedRequests++; else controlRequests++;
    res.writeHead(200, { "content-type": "application/json" }); res.end('{"success":true}');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const root = `https://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const transport = pathToFileURL(resolve(dirname(await realpath(entry)), "../providers/local-http.js")).href;
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  delete environment.NODE_OPTIONS; delete environment.NODE_EXTRA_CA_CERTS;
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { get } from "node:https";
    import { localHttpWeknoraVerify } from ${JSON.stringify(transport)};
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0");
    await assert.rejects(localHttpWeknoraVerify(${JSON.stringify(root)}, "fixture-tls-key", { allowRanges: ["127.0.0.1/32"] }),
      error => error.kind === "network" && error.message === "Local HTTP request failed (network).");
    // Positive control: same cert/URL works when Node's ambient TLS-disable is honored.
    await new Promise((resolve, reject) => {
      const request = get(${JSON.stringify(root + "/auth/me")}, response => { assert.equal(response.statusCode, 200); response.resume(); response.on("end", resolve); });
      request.on("error", reject); request.setTimeout(1000, () => request.destroy(new Error("TLS control deadline")));
    });
    console.log("synthetic TLS rejection and permissive control passed");
  `], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
    expect(code, stderr).toBe(0); expect(stdout).toContain("synthetic TLS rejection and permissive control passed");
    expect(stdout + stderr).not.toContain("fixture-tls-key");
    expect(authenticatedRequests).toBe(0); expect(controlRequests).toBe(1);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(previous);
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});
it("accepts a complete private external pair without stored config, credentials or preferences", async () => {
  const f = await fixture(200, undefined, "fixture-external-secret");
  const config = JSON.parse(await readFile(f.paths.config, "utf8"));
  await writeJsonAtomic(f.paths.config, defaultConfig()); await rm(f.paths.credentials);
  expect(await f.run(undefined, { WEKNORA_BASE_URL: config.connections.weknora.baseUrl, WEKNORA_API_KEY: "fixture-external-secret" })).toMatchObject({ ok: true, source: "environment", data: { outcome: "accepted" } });
  expect(f.calls()).toBe(1);
});
it("bounds the entire probe and handles cancellation without requests on pre-abort", async () => {
  const f = await fixture();
  const controller = new AbortController(); controller.abort();
  expect(await invokeCapability("weknora.connection.verify", { protocolVersion: 1, capability: "weknora.connection.verify", input: { confirmed: true, allowHttp: true } }, { paths: f.paths, originalEnvironment: {}, signal: controller.signal })).toMatchObject({ ok: false, error: { kind: "cancelled" } });
  expect(f.calls()).toBe(0);
  let closed: () => void = () => {};
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const slow = createServer((_req, res) => { res.on("close", closed); });
  await new Promise<void>(resolve => slow.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => slow.close(() => resolve())));
  const config = JSON.parse(await readFile(f.paths.config, "utf8"));
  config.connections.weknora.baseUrl = `http://127.0.0.1:${(slow.address() as { port: number }).port}/api/v1`;
  await writeJsonAtomic(f.paths.config, config);
  const started = Date.now();
  expect(await f.run({ confirmed: true, allowHttp: true, timeoutMs: 100 })).toMatchObject({ ok: false, error: { kind: "timeout" } });
  expect(Date.now() - started).toBeLessThan(1000); await disconnected;
  const cancelling = new AbortController();
  const pending = invokeCapability("weknora.connection.verify", { protocolVersion: 1, capability: "weknora.connection.verify", input: { confirmed: true, allowHttp: true } }, { paths: f.paths, originalEnvironment: {}, signal: cancelling.signal });
  setTimeout(() => cancelling.abort(), 30);
  expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } });
});

const entry = process.env.ARKSPACE_VERIFY_ENTRY ?? resolve("dist/cli/main.js");
function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, ARKSPACE_HOME: home };
  delete environment.WEKNORA_BASE_URL; delete environment.WEKNORA_API_KEY; delete environment.ARKSPACE_WEKNORA_API_KEY;
  return environment;
}
async function invokeEntry(home: string, input: object, environment: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [entry, "invoke", "weknora.connection.verify", "--input", "-"], { cwd: tmpdir(), env: { ...isolatedEnvironment(home), ...environment }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ protocolVersion: 1, capability: "weknora.connection.verify", input }));
  const code = await new Promise<number | null>(resolve => child.on("close", resolve));
  expect(stdout + stderr).not.toMatch(/fixture-managed-secret|fixture-unrelated-secret|fixture-broken-store-secret|fixture-external-secret|private-identity/);
  expect(stdout.trim(), `Entry must return a JSON envelope, not a bootstrap failure: ${stderr}`).not.toBe("");
  return { result: JSON.parse(stdout), code };
}
it("executes the real entry with original provenance despite hydration, with no state writes", async () => {
  const f = await fixture();
  await storeCredential(f.paths.credentials, "WEKNORA_API_KEY", "fixture-unrelated-secret");
  const before = await readFile(f.paths.config, "utf8");
  expect(await invokeEntry(f.paths.home, { confirmed: true })).toMatchObject({ code: 0, result: { ok: true, source: "managed" } });
  for (const environment of [{ WEKNORA_BASE_URL: "https://external.example/api/v1" }, { ARKSPACE_WEKNORA_API_KEY: "fixture-override" }]) expect(await invokeEntry(f.paths.home, { confirmed: true, allowHttp: true }, environment)).toMatchObject({ code: 1, result: { ok: false, error: { kind: "config" } } });
  expect(f.calls()).toBe(1); expect(await readFile(f.paths.config, "utf8")).toBe(before);
  await expect(readFile(f.paths.state)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["external", "managed"] as const)("returns entry JSON for %s with a broken credential store instead of bootstrapping", async source => {
  const f = await fixture(200, undefined, source === "external" ? "fixture-external-secret" : "fixture-managed-secret");
  const config = JSON.parse(await readFile(f.paths.config, "utf8"));
  await writeFile(f.paths.credentials, "invalid fixture-broken-store-secret");
  const environment = source === "external" ? { WEKNORA_BASE_URL: config.connections.weknora.baseUrl, WEKNORA_API_KEY: "fixture-external-secret" } : {};
  const expected = source === "external" ? { code: 0, result: { ok: true, source: "environment" } } : { code: 1, result: { ok: false, error: { kind: "config" } } };
  expect(await invokeEntry(f.paths.home, { confirmed: true, allowHttp: true }, environment)).toMatchObject(expected);
  expect(f.calls()).toBe(source === "external" ? 1 : 0);
});
it("propagates original provenance across MCP startup and returns the same non-Web envelope", async () => {
  const f = await fixture();
  await storeCredential(f.paths.credentials, "WEKNORA_API_KEY", "fixture-unrelated-secret");
  for (const extra of [{}, { WEKNORA_BASE_URL: "https://external.example/api/v1" }]) {
    const child = spawn(process.execPath, [entry, "mcp", "serve"], { cwd: tmpdir(), env: { ...isolatedEnvironment(f.paths.home), ...extra }, stdio: ["pipe", "pipe", "pipe"] });
    const messages: Record<string, any>[] = []; let buffer = "", stderr = "";
    child.stdout.on("data", chunk => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop()!; for (const line of lines) if (line.trim()) messages.push(JSON.parse(line)); });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const wait = async (id: number) => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const message = messages.find(m => m.id === id); if (message) return message; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error("MCP fixture response deadline"); };
    try {
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-test", version: "1" } } }); await wait(1);
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      expect((await wait(2)).result.tools.some((tool: { name: string }) => tool.name === "weknora_connection_verify")).toBe(true);
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "weknora_connection_verify", arguments: { confirmed: true } } });
      const result = (await wait(3)).result;
      expect(result.isError).toBe(Boolean(extra.WEKNORA_BASE_URL));
      expect(WeknoraVerifyEnvelopeSchema.safeParse(result.structuredContent).success).toBe(true);
      expect(result.structuredContent).toMatchObject(extra.WEKNORA_BASE_URL ? { ok: false, error: { kind: "config" } } : { ok: true, source: "managed" });
      expect(JSON.stringify(messages) + stderr).not.toMatch(/fixture-managed-secret|fixture-unrelated-secret|private-identity/);
    } finally { child.kill("SIGTERM"); await new Promise(resolve => child.once("close", resolve)); }
  }
  expect(f.calls()).toBe(1);
});
