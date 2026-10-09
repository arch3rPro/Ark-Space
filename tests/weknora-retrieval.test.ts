import { spawn } from "node:child_process";
import { Ajv } from "ajv";
import { WeknoraRetrievalEnvelopeSchemas, WeknoraRetrievalRequestSchemas } from "../src/protocol/weknora-retrieval-schema.js";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { defaultConfig } from "../src/config/schema.js";
import { storeCredential } from "../src/config/credentials.js";
import { writeJsonAtomic } from "../src/io/json-store.js";
import { invokeCapability } from "../src/protocol/invoke.js";
import type { Capability } from "../src/protocol/types.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); });
const kb = { id: "kb-default", name: "Docs", capabilities: { vector: true, keyword: false, wiki: false, graph: false, faq: false } };
async function fixture(options: { apiKey?: string; detail?: unknown; results?: unknown; status?: number; searchStatus?: number; slow?: boolean; searchSlow?: boolean; list?: unknown; success?: boolean } = {}) {
  const calls: { method: string | undefined; url: string | undefined; body: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, url: req.url, body });
    expect(req.headers["x-api-key"]).toBe(options.apiKey ?? "fixture-retrieval-secret");
    const search = req.url?.includes("hybrid-search");
    if (options.slow || search && options.searchSlow) return;
    const data = search ? (Object.hasOwn(options, "results") ? options.results : []) : req.url?.includes("?") ? (Object.hasOwn(options, "list") ? options.list : [kb]) : options.detail ?? kb;
    res.writeHead(search ? options.searchStatus ?? options.status ?? 200 : options.status ?? 200, { "content-type": "application/json" }); res.end(JSON.stringify({ success: options.success ?? true, data }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const home = await mkdtemp(join(tmpdir(), "arks-retrieve-")); cleanups.push(() => rm(home, { recursive: true, force: true }));
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home });
  const config = defaultConfig();
  config.connections = { weknora: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/prefix/api/v1`, apiKeyRef: "env:ARKSPACE_WEKNORA_API_KEY", allowRanges: [], defaultKnowledgeBaseId: "kb-default" } };
  await writeJsonAtomic(paths.config, config); await storeCredential(paths.credentials, "ARKSPACE_WEKNORA_API_KEY", "fixture-retrieval-secret");
  const run = (capability: string = "weknora.search", input: object = {}, originalEnvironment: NodeJS.ProcessEnv | undefined = {}, signal?: AbortSignal) => invokeCapability(capability as Capability, { protocolVersion: 1, capability, input: { confirmed: true, ...(capability === "weknora.search" ? { query: "refund" } : {}), ...input } }, { paths, ...(originalEnvironment ? { originalEnvironment } : {}), ...(signal ? { signal } : {}) });
  return { run, paths, calls, config };
}
it("preflights the chosen KB then posts the exact documented search body; null is empty success", async () => {
  const f = await fixture({ results: null });
  expect(await f.run()).toMatchObject({ ok: true, source: "managed", data: { knowledgeBaseId: "kb-default", results: [] } });
  expect(f.calls).toEqual([{ method: "GET", url: "/prefix/api/v1/knowledge-bases/kb-default", body: "" }, { method: "POST", url: "/prefix/api/v1/knowledge-bases/kb-default/hybrid-search?resource_urls=handle", body: JSON.stringify({ query_text: "refund", match_count: 5 }) }]);
  await expect(readFile(f.paths.state)).rejects.toMatchObject({ code: "ENOENT" });
});
it("supports list and detail, and explicit IDs override the default", async () => {
  const f = await fixture({ detail: { ...kb, id: "kb-other" } });
  expect(await f.run("weknora.knowledge-bases.list")).toMatchObject({ ok: true, data: { knowledgeBases: [kb] } });
  expect(await f.run("weknora.knowledge-bases.get", { knowledgeBaseId: "kb-other" })).toMatchObject({ ok: true, data: { knowledgeBase: { id: "kb-other" } } });
  expect(f.calls.map(call => call.url)).toEqual(["/prefix/api/v1/knowledge-bases?page=1&page_size=20", "/prefix/api/v1/knowledge-bases/kb-other"]);
});
it.each([undefined, false, true])("accepts HTTP retrieval without a transport gate (legacy allowHttp=%s)", async allowHttp => {
  const f = await fixture();
  for (const capability of ["weknora.knowledge-bases.list", "weknora.knowledge-bases.get", "weknora.search"]) {
    expect(await f.run(capability, allowHttp === undefined ? {} : { allowHttp })).toMatchObject({ ok: true });
  }
  expect(f.calls).toHaveLength(4);
});
it("distinguishes no-index from empty results and refuses malformed capability flags", async () => {
  const f = await fixture({ detail: { ...kb, capabilities: { ...kb.capabilities, vector: false, wiki: true } } });
  expect(await f.run()).toMatchObject({ ok: false, error: { kind: "no-index", retryable: false } }); expect(f.calls).toHaveLength(1);
  const malformed = await fixture({ detail: { ...kb, capabilities: { vector: "true" } } });
  expect(await malformed.run()).toMatchObject({ ok: false, error: { kind: "invalid-response" } }); expect(malformed.calls).toHaveLength(1);
});
it("returns source-backed document and chunk citations without invented offsets or parse status", async () => {
  const f = await fixture({ results: [{ id: "chunk-1", knowledge_id: "doc-1", knowledge_title: "Refunds", content: "Refund within 30 days", score: 0.8, match_type: 0, metadata: { section: "Policy" }, start_at: 12, end_at: 99, password: "private" }] });
  const result = await f.run();
  expect(result).toMatchObject({ ok: true, data: { results: [{ id: "chunk-1", knowledge_id: "doc-1", knowledge_title: "Refunds", content: "Refund within 30 days", score: 0.8, metadata: { section: "Policy" } }] } });
  expect(JSON.stringify(result)).not.toMatch(/start_at|end_at|parse_status|password|fixture-retrieval-secret/);
});
it("rejects untrusted inputs, missing provenance and incomplete external pairs before HTTP", async () => {
  const f = await fixture();
  for (const input of [{ confirmed: false }, { knowledgeBaseId: "../auth/me" }, { query: "" }, { query: "x".repeat(4001) }, { route: "/auth/me" }, { apiKey: "key" }, { limit: 101 }, { limit: 0 }, { timeoutMs: 30001 }]) expect(await f.run(undefined, input)).toMatchObject({ ok: false });
  expect(await invokeCapability("weknora.search" as Capability, { protocolVersion: 1, capability: "weknora.search", input: { confirmed: true, allowHttp: true, query: "refund" } }, { paths: f.paths })).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(await f.run(undefined, {}, { WEKNORA_API_KEY: "external" })).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(f.calls).toHaveLength(0);
});
it.each([[403, "permission"], [401, "auth"], [429, "rate-limit"]])("stops at preflight HTTP %s without fallback", async (status, kind) => {
  const f = await fixture({ status: status as number }); expect(await f.run()).toMatchObject({ ok: false, error: { kind, retryable: false } }); expect(f.calls).toHaveLength(1);
});
it("enforces a whole-operation deadline and pre-abort without requests", async () => {
  const f = await fixture({ slow: true }); const controller = new AbortController(); controller.abort();
  expect(await f.run(undefined, {}, {}, controller.signal)).toMatchObject({ ok: false, error: { kind: "cancelled" } }); expect(f.calls).toHaveLength(0);
  expect(await f.run(undefined, { timeoutMs: 100 })).toMatchObject({ ok: false, error: { kind: "timeout" } }); expect(f.calls).toHaveLength(1);
});
it("uses default for detail, requires target when absent, and accepts private external pairs without preferences", async () => {
  const f = await fixture(); expect(await f.run("weknora.knowledge-bases.get")).toMatchObject({ ok: true, data: { knowledgeBase: kb } });
  delete f.config.connections!.weknora!.defaultKnowledgeBaseId; await writeJsonAtomic(f.paths.config, f.config);
  for (const capability of ["weknora.knowledge-bases.get", "weknora.search"]) expect(await f.run(capability)).toMatchObject({ ok: false, error: { kind: "knowledge-base-required" } });
  const external = await fixture({ apiKey: "fixture-external-secret" });
  await writeJsonAtomic(external.paths.config, defaultConfig()); await rm(external.paths.credentials);
  const environment = { WEKNORA_BASE_URL: external.config.connections!.weknora!.baseUrl, WEKNORA_API_KEY: "fixture-external-secret" };
  expect(await external.run()).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(await external.run(undefined, {}, environment)).toMatchObject({ ok: false, source: "environment", error: { kind: "knowledge-base-required" } });
  expect(await external.run(undefined, { knowledgeBaseId: "kb-default" }, environment)).toMatchObject({ ok: true, source: "environment", data: { knowledgeBaseId: "kb-default", results: [] } });
  expect(external.calls).toHaveLength(2); expect(f.calls).toHaveLength(1);
});
it("supports null lists, rejects oversized pages and disabled tools without requests", async () => {
  const f = await fixture({ list: null }); expect(await f.run("weknora.knowledge-bases.list")).toMatchObject({ ok: true, data: { knowledgeBases: [] } });
  expect(await f.run("weknora.knowledge-bases.list", { pageSize: 101 })).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
  f.config.tools["weknora.search"] = { enabled: false }; await writeJsonAtomic(f.paths.config, f.config);
  expect(await f.run()).toMatchObject({ ok: false, error: { kind: "invalid-request" } }); expect(f.calls).toHaveLength(1);
});
it.each([403, 302, 500])("stops after search HTTP %s with exactly two requests", async status => {
  const f = await fixture({ searchStatus: status }); const result = await f.run();
  expect(result).toMatchObject({ ok: false, error: { kind: status === 403 ? "permission" : status === 302 ? "redirect" : "http-status", retryable: false } }); expect(f.calls).toHaveLength(2);
});
it.each([{ wrong: "shape" }, [{ id: "bad" }], Array.from({ length: 6 }, () => ({ id: "chunk", knowledge_id: "doc", knowledge_title: "title", content: "body" })), [{ id: "chunk", knowledge_id: "doc", knowledge_title: "title", content: "fixture-retrieval-secret" }], [{ id: "chunk", knowledge_id: "doc", knowledge_title: "title", content: "body", knowledge_base_id: "outside" }]])("rejects malformed, oversized, cross-KB or secret-echoed results", async results => {
  const f = await fixture({ results }); const result = await f.run(); expect(result).toMatchObject({ ok: false, error: { kind: "invalid-response" } }); expect(JSON.stringify(result)).not.toContain("fixture-retrieval-secret"); expect(f.calls).toHaveLength(2);
});
it("classifies business failure without raw error and interrupts an in-flight search", async () => {
  const failed = await fixture({ success: false }); expect(await failed.run()).toMatchObject({ ok: false, error: { kind: "business-failure" } }); expect(failed.calls).toHaveLength(1);
  const f = await fixture({ searchSlow: true }); const controller = new AbortController(); const pending = f.run(undefined, {}, {}, controller.signal);
  const deadline = Date.now() + 1000; while (f.calls.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort(); expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } }); expect(f.calls).toHaveLength(2);
  const timed = await fixture({ searchSlow: true }); expect(await timed.run(undefined, { timeoutMs: 100 })).toMatchObject({ ok: false, error: { kind: "timeout" } }); expect(timed.calls).toHaveLength(2);
});
it("validates all generated retrieval request and response schemas", async () => {
  const ajv = new Ajv(); const f = await fixture();
  for (const capability of Object.keys(WeknoraRetrievalRequestSchemas) as (keyof typeof WeknoraRetrievalRequestSchemas)[]) {
    const input = { confirmed: true, allowHttp: true, ...(capability === "weknora.search" ? { query: "refund", limit: 5 } : {}) };
    const request = { protocolVersion: 1, capability, input };
    const validateRequest = ajv.compile(JSON.parse(await readFile(`schemas/protocol/v1/${capability.replaceAll(".", "-")}-request.schema.json`, "utf8")));
    expect(validateRequest.schema).toMatchObject({ properties: { input: { properties: { allowHttp: { description: expect.stringContaining("Ignored compatibility field; not required for HTTP.") } } } } });
    expect(validateRequest(request)).toBe(true); expect(WeknoraRetrievalRequestSchemas[capability].safeParse(request).success).toBe(true);
    const validateResponse = ajv.compile(JSON.parse(await readFile(`schemas/protocol/v1/${capability.replaceAll(".", "-")}-response.schema.json`, "utf8")));
    for (const result of [await f.run(capability), await f.run(capability, { confirmed: false })]) {
      expect(validateResponse(result), JSON.stringify(validateResponse.errors)).toBe(true); expect(WeknoraRetrievalEnvelopeSchemas[capability].safeParse(result).success).toBe(true);
      expect(validateResponse({ ...result, provider: "local", attempts: [] })).toBe(false);
    }
  }
});

const entry = process.env.ARKSPACE_RETRIEVAL_ENTRY ?? resolve("dist/cli/main.js");
function environment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ARKSPACE_HOME: home }; delete env.WEKNORA_BASE_URL; delete env.WEKNORA_API_KEY; delete env.ARKSPACE_WEKNORA_API_KEY; return env;
}
it("executes all retrieval operations through the isolated real entry with original provenance", async () => {
  const f = await fixture(); await storeCredential(f.paths.credentials, "WEKNORA_API_KEY", "fixture-unrelated-secret"); const before = await readFile(f.paths.config, "utf8");
  for (const capability of ["weknora.knowledge-bases.list", "weknora.knowledge-bases.get", "weknora.search"]) {
    const child = spawn(process.execPath, [entry, "invoke", capability, "--input", "-"], { cwd: tmpdir(), env: environment(f.paths.home), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdin.end(JSON.stringify({ protocolVersion: 1, capability, input: { confirmed: true, ...(capability === "weknora.search" ? { query: "refund", limit: 5 } : {}) } }));
    expect(await new Promise(resolve => child.once("close", resolve)), stderr).toBe(0); expect(JSON.parse(stdout)).toMatchObject({ ok: true, source: "managed", capability }); expect(stdout + stderr).not.toMatch(/fixture-retrieval-secret|fixture-unrelated-secret/);
  }
  expect(f.calls).toHaveLength(4); expect(await readFile(f.paths.config, "utf8")).toBe(before); await expect(readFile(f.paths.state)).rejects.toMatchObject({ code: "ENOENT" });
});
it("keeps external retrieval independent of a broken stored credential and emits non-Web input failures", async () => {
  const f = await fixture({ apiKey: "fixture-external-secret" });
  await writeFile(f.paths.credentials, "invalid fixture-broken-store");
  for (const input of [JSON.stringify({ protocolVersion: 1, capability: "weknora.search", input: { confirmed: true, allowHttp: true, query: "refund", knowledgeBaseId: "kb-default" } }), "invalid JSON"]) {
    const child = spawn(process.execPath, [entry, "invoke", "weknora.search", "--input", "-"], { cwd: tmpdir(), env: { ...environment(f.paths.home), WEKNORA_BASE_URL: f.config.connections!.weknora!.baseUrl, WEKNORA_API_KEY: "fixture-external-secret" }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; }); child.stdin.end(input);
    expect(await new Promise(resolve => child.once("close", resolve))).toBe(input === "invalid JSON" ? 1 : 0);
    const result = JSON.parse(stdout);
    expect(WeknoraRetrievalEnvelopeSchemas["weknora.search"].safeParse(result).success).toBe(true);
    expect(result).toMatchObject(input === "invalid JSON" ? { ok: false, connection: "weknora", error: { kind: "invalid-request" } } : { ok: true, connection: "weknora", source: "environment" });
    expect(stdout + stderr).not.toMatch(/fixture-broken-store|fixture-external-secret/);
  }
  expect(f.calls).toHaveLength(2);
});
it("exposes compatible MCP retrieval tools and returns the same validated envelope", async () => {
  const f = await fixture(); const child = spawn(process.execPath, [entry, "mcp", "serve"], { cwd: tmpdir(), env: environment(f.paths.home), stdio: ["pipe", "pipe", "pipe"] });
  const messages: Record<string, any>[] = []; let buffer = "", stderr = "";
  child.stdout.on("data", chunk => { buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop()!; for (const line of lines) if (line.trim()) messages.push(JSON.parse(line)); }); child.stderr.on("data", chunk => { stderr += chunk; });
  const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const wait = async (id: number) => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const message = messages.find(row => row.id === id); if (message) return message; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error("MCP retrieval fixture deadline"); };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "retrieval-test", version: "1" } } }); await wait(1); send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }); const tools = (await wait(2)).result.tools;
    for (const name of ["weknora_knowledge-bases_list", "weknora_knowledge-bases_get", "weknora_search"]) expect(tools.find((tool: any) => tool.name === name)).toMatchObject({ annotations: { readOnlyHint: true } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "weknora_search", arguments: { confirmed: true, query: "refund", limit: 5 } } }); const result = (await wait(3)).result;
    expect(result.isError).toBe(false); expect(result.structuredContent).toMatchObject({ ok: true, capability: "weknora.search", data: { results: [] } }); expect(WeknoraRetrievalEnvelopeSchemas["weknora.search"].safeParse(result.structuredContent).success).toBe(true);
    expect(JSON.stringify(messages) + stderr).not.toContain("fixture-retrieval-secret"); expect(f.calls).toHaveLength(2);
  } finally { child.kill("SIGTERM"); await new Promise(resolve => child.once("close", resolve)); }
});
