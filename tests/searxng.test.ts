import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { executeWebSearch } from "../src/capabilities/web-search.js";
import { defaultConfig, getProviderConfig } from "../src/config/schema.js";
import { addEnvironmentKey, addSearxngInstance, configureSearxng } from "../src/config/store.js";
import { resolveWebSearchInput, WebFetchRequestSchema } from "../src/protocol/schema.js";
import { WebSearchSuccessEnvelopeSchema } from "../src/protocol/envelope-schema.js";
import { createSearchProviderRegistry } from "../src/providers/registry.js";
import { recordInstanceResult, selectSearxngInstance } from "../src/providers/searxng-pool.js";

const servers: Server[] = [];
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => s.close(() => resolve()))));
  await Promise.all(homes.splice(0).map(h => rm(h, { recursive: true, force: true })));
});
async function home() { const h = await mkdtemp(join(tmpdir(), "arks-searxng-")); homes.push(h); return h; }
async function fixture(body: unknown, status = 200) {
  const requests: URL[] = [];
  const server = createServer((req, res) => {
    requests.push(new URL(req.url!, "http://fixture"));
    expect(req.headers.authorization).toBeUndefined();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("TCP address required");
  return { baseUrl: `http://127.0.0.1:${address.port}/instance`, requests };
}
async function search(body: unknown, status = 200, allowRanges = ["127.0.0.1/32"], options = {}) {
  const h = await home(); const f = await fixture(body, status);
  const config = await configureSearxng(join(h, "config.json"), f.baseUrl, allowRanges);
  const result = await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng", ...options }), {
    config, statePath: join(h, "state.json"), providers: createSearchProviderRegistry(), environment: {},
  });
  await expect(access(join(h, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.stringify(result)).not.toContain("keyId");
  return { result, ...f };
}
it("searches keylessly, bounds and filters sources, maps namespaced options", async () => {
  const { result, requests } = await search({ results: [
    { url: "https://docs.example.com/a", title: "Docs", content: "evidence", engine: "bing", category: "general", publishedDate: "2025-01-02", score: 1 },
    { url: "https://other.test/", title: "Other" },
  ] }, 200, undefined, { maxResults: 1, includeDomains: ["example.com"], options: { searxng: { categories: ["science", "social media"], engines: ["bing"], language: "en", page: 2, safesearch: 1, timeRange: "month" } } });
  expect(result).toMatchObject({ ok: true, provider: "searxng", data: { results: [{ title: "Docs", snippet: "evidence", published: "2025-01-02", source: { engine: "bing", category: "general" } }] } });
  expect(WebSearchSuccessEnvelopeSchema.safeParse(result).success).toBe(true);
  expect(requests[0]!.pathname).toBe("/instance/search");
  expect(Object.fromEntries(requests[0]!.searchParams)).toMatchObject({ q: "skills", format: "json", categories: "science,social media", engines: "bing", pageno: "2", safesearch: "1", time_range: "month" });
});
it("accepts empty results without category broadening", async () => {
  const { result, requests } = await search({ results: [] });
  expect(result).toMatchObject({ ok: true, data: { results: [] } }); expect(requests).toHaveLength(1);
});
it.each(["not json", { results: [{ url: "javascript:alert(1)" }] }, { results: [{ url: "https://user:password@example.com" }] }, { results: null }, {}])("rejects malformed response %j", async body => {
  expect((await search(body)).result).toMatchObject({ ok: false, error: { kind: "invalid-response" } });
});
it.each([[429, "rate-limit"], [403, "permission"], [503, "transient"], [400, "invalid-request"]])("classifies HTTP %s strictly", async (status, kind) => {
  expect((await search({}, Number(status))).result).toMatchObject({ ok: false, error: { kind } });
});
it("denies private endpoints unless SearXNG CIDR explicitly permits them", async () => {
  const { result, requests } = await search({ results: [] }, 200, []);
  expect(result).toMatchObject({ ok: false, error: { kind: "config" } }); expect(requests).toHaveLength(0);
});
it("rejects unrelated capabilities and unsafe configuration", async () => {
  expect(() => resolveWebSearchInput({ query: "skills", options: { searxng: { page: 1 } } })).toThrow();
  expect(() => resolveWebSearchInput({ query: "skills", provider: "exa", options: { searxng: {} } })).toThrow();
  expect(WebFetchRequestSchema.safeParse({ protocolVersion: 1, capability: "web.fetch", input: { urls: ["https://example.com"], provider: "searxng" } }).success).toBe(false);
  const path = join(await home(), "config.json");
  await expect(configureSearxng(path, "https://user:secret@example.com", [])).rejects.toThrow();
  await expect(configureSearxng(path, "https://example.com", ["127.0.0.1/99"])).rejects.toThrow();
  expect(defaultConfig().providerOrder).not.toContain("searxng");
});
it.each(["::FFFF:127.0.0.1/128", "0:0:0:0:0:ffff:7f00:1/128", "::ffff:7f00:1/128"])("rejects mapped IPv6 CIDR %s before persistence", async range => {
  const path = join(await home(), "config.json");
  await expect(configureSearxng(path, "https://search.example.org", [range])).rejects.toThrow();
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});
it("resolves endpoint environment without persisting it; config wins and disabled stays disabled", () => {
  const config = defaultConfig();
  expect(getProviderConfig(config, "searxng", { SEARXNG_URL: "https://one.test", SEARXNG_BASE_URL: "https://two.test" })?.baseUrl).toBe("https://one.test");
  expect(getProviderConfig(config, "searxng", { SEARXNG_BASE_URL: "https://two.test" })?.baseUrl).toBe("https://two.test");
  expect(getProviderConfig(config, "searxng", { SEARXNG_URL: "https://user:secret@one.test" })).toBeUndefined();
});
it("never adds fake keys and does not infer keyless paid Providers", async () => {
  const h = await home();
  await expect(addEnvironmentKey(join(h, "config.json"), "searxng", "FAKE_KEY")).rejects.toThrow("keyless");
  const config = defaultConfig(); config.providers.exa!.keyRefs = [];
  const result = await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "exa" }), { config, statePath: join(h, "state.json"), providers: createSearchProviderRegistry(), environment: {} });
  expect(result).toMatchObject({ ok: false, error: { kind: "config" } });
});
it("filters exclusions on hostname boundaries rather than substrings", async () => {
  const { result } = await search({ results: [ { url: "https://docs.example.com/a" }, { url: "https://notexample.com/a" }, { url: "https://example.com/b" } ] }, 200, undefined, { excludeDomains: ["EXAMPLE.COM"] });
  expect(result).toMatchObject({ ok: true, data: { results: [{ url: "https://notexample.com/a" }] } });
});
it("cancels keyless dispatcher waiting and never touches key-pool state", async () => {
  const h = await home(); const f = await fixture({ results: [] });
  const config = await configureSearxng(join(h, "config.json"), f.baseUrl, ["127.0.0.1/32"]);
  const controller = new AbortController(); controller.abort();
  const result = await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng" }), { config, statePath: join(h, "state.json"), providers: createSearchProviderRegistry(), signal: controller.signal });
  expect(result.ok).toBe(false); expect(f.requests).toHaveLength(0);
  await expect(access(join(h, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("uses manual fallback only when not explicitly selected", async () => {
  const h = await home(); const f = await fixture({}, 503);
  const config = await configureSearxng(join(h, "config.json"), f.baseUrl, ["127.0.0.1/32"]); config.providerOrder = ["searxng", "tavily"];
  let calls = 0;
  const providers = new Map(createSearchProviderRegistry());
  providers.set("tavily", { id: "tavily", async search() { calls++; return { query: "skills", results: [] }; } });
  const context = { config, statePath: join(h, "state.json"), providers, environment: { TAVILY_API_KEY: "fixture" } };
  expect((await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng" }), context)).ok).toBe(false); expect(calls).toBe(0);
  expect((await executeWebSearch(resolveWebSearchInput({ query: "skills" }), context)).ok).toBe(true); expect(calls).toBe(1);
});
async function multi(firstStatus = 503, secondStatus = 200) {
  const h = await home(); const a = await fixture({ results: [] }, firstStatus);
  const b = await fixture({ results: [{ url: "https://example.com/b", title: "B" }] }, secondStatus);
  const config = await configureSearxng(join(h, "config.json"), a.baseUrl, ["127.0.0.1/32"]);
  config.providers.searxng = (await addSearxngInstance(join(h, "config.json"), b.baseUrl, ["127.0.0.1/32"])).providers.searxng;
  const context = { config, statePath: join(h, "state.json"), providers: createSearchProviderRegistry(), environment: {} };
  const run = () => executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng" }), context);
  return { h, a, b, context, run };
}
it("fails over within explicitly selected SearXNG and cools down the failing endpoint", async () => {
  const { a, b, context, run } = await multi();
  context.config.providerOrder = ["searxng", "tavily"];
  const result = await run();
  expect(result).toMatchObject({ ok: true, provider: "searxng", attempts: [
    { provider: "searxng", ok: false, errorKind: "transient" }, { provider: "searxng", ok: true },
  ] });
  expect(WebSearchSuccessEnvelopeSchema.safeParse(result).success).toBe(true);
  expect(result.attempts[0]!.instanceId).not.toBe(result.attempts[1]!.instanceId);
  expect(await run()).toMatchObject({ ok: true, attempts: [{ ok: true }] });
  expect(a.requests).toHaveLength(1); expect(b.requests).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain(a.baseUrl); expect(JSON.stringify(result)).not.toContain("keyId");
});
it.each([400, 401, 403, 200])("does not fail over terminal HTTP/invalid JSON %s", async status => {
  const { a, b, context, run } = await multi(status);
  if (status === 200) {
    const bad = await fixture("bad json");
    context.config.providers.searxng!.instances[0]!.baseUrl = bad.baseUrl;
  }
  expect((await run()).ok).toBe(false); expect(b.requests).toHaveLength(0);
  if (status !== 200) expect(a.requests).toHaveLength(1);
});
it("tries both once, never hosted fallback when explicit, and reports unavailable cooldown without fake attempts", async () => {
  const { a, b, context, run } = await multi(429, 503);
  context.config.providerOrder = ["searxng", "tavily"];
  const result = await run(); expect(result.ok).toBe(false); expect(result.attempts).toHaveLength(2);
  const unavailable = await run(); expect(unavailable).toMatchObject({ ok: false, error: { kind: "rate-limit", retryable: true }, attempts: [] });
  expect(a.requests).toHaveLength(1); expect(b.requests).toHaveLength(1);
});
it("keeps private CIDR authority separate and fails closed even if config errors are opted into fallback", async () => {
  const { a, b, context, run } = await multi();
  context.config.providers.searxng!.instances[1]!.allowRanges = [];
  const result = await run(); expect(result).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(a.requests).toHaveLength(1); expect(b.requests).toHaveLength(0);
  context.config.providers.searxng!.fallbackOn.push("config");
  expect((await run()).ok).toBe(false); expect(b.requests).toHaveLength(0);
});
it("empty success never switches instances", async () => {
  const { a, b, run } = await multi(200);
  expect(await run()).toMatchObject({ ok: true, data: { results: [] }, attempts: [{ ok: true }] });
  expect(a.requests).toHaveLength(1); expect(b.requests).toHaveLength(0);
});
it("reserves a sub-second share for the second endpoint and destroys a hung first socket", async () => {
  const { context } = await multi(200);
  let closed = false; let accepted = false;
  const server = createServer((req, _res) => { accepted = true; req.socket.on("close", () => { closed = true; }); });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("TCP address required");
  context.config.providers.searxng!.instances[0]!.baseUrl = `http://127.0.0.1:${address.port}`;
  const started = Date.now();
  const result = await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng", timeoutMs: 1000 }), context);
  expect(result.ok).toBe(true); expect(result.attempts).toHaveLength(2); expect(Date.now() - started).toBeLessThan(1000);
  await new Promise(resolve => setTimeout(resolve, 30)); expect(accepted).toBe(true); expect(closed).toBe(true);
});
it("caller cancellation stops all instance attempts and cleans up the active socket", async () => {
  const { b, context } = await multi(200);
  let closed = false;
  const controller = new AbortController();
  const server = createServer(req => { req.socket.on("close", () => { closed = true; }); setTimeout(() => controller.abort(), 30); });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("TCP address required");
  context.config.providers.searxng!.instances[0]!.baseUrl = `http://127.0.0.1:${address.port}`;
  const result = await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng", timeoutMs: 1000 }), { ...context, signal: controller.signal });
  expect(result.ok).toBe(false); expect(result.attempts).toHaveLength(1); expect(b.requests).toHaveLength(0);
  await new Promise(resolve => setTimeout(resolve, 30)); expect(closed).toBe(true);
});
it("gives the only eligible instance the entire remaining budget", async () => {
  const { a, context } = await multi(200);
  const server = createServer((_req, res) => setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"results":[]}'); }, 650));
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("TCP address required");
  const entry = context.config.providers.searxng!;
  entry.instances[1]!.baseUrl = `http://127.0.0.1:${address.port}`;
  const lease = (await selectSearxngInstance(context.statePath, entry, new Set()))!;
  await recordInstanceResult(context.statePath, entry, lease.instanceId, { ok: false, kind: "transient" });
  const result = await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng", timeoutMs: 1000 }), context);
  expect(result).toMatchObject({ ok: true, attempts: [{ ok: true }] }); expect(result.attempts).toHaveLength(1); expect(a.requests).toHaveLength(0);
});
it("bounds the total deadline across two hung endpoints", async () => {
  const { context } = await multi(200); let closed = 0;
  for (const instance of context.config.providers.searxng!.instances) {
    const server = createServer(req => req.socket.on("close", () => { closed++; }));
    servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw Error("TCP address required");
    instance.baseUrl = `http://127.0.0.1:${address.port}`;
  }
  const started = Date.now();
  const result = await executeWebSearch(resolveWebSearchInput({ query: "skills", provider: "searxng", timeoutMs: 1000 }), context);
  expect(result.ok).toBe(false); expect(result.attempts).toHaveLength(2); expect(Date.now() - started).toBeLessThan(1250);
  await new Promise(resolve => setTimeout(resolve, 30)); expect(closed).toBe(2);
});
it("rotates through concurrent built CLI invoke processes and reports config-only instance counts", async () => {
  const { h, a, b } = await multi(200);
  const env = { ARKSPACE_HOME: h };
  const request = join(h, "request.json");
  await writeFile(request, JSON.stringify({ protocolVersion: 1, capability: "web.search", input: { query: "skills", provider: "searxng" } }));
  const runs = await Promise.all(Array.from({ length: 6 }, () => cli(["invoke", "web.search", "--input", request], env)));
  for (const run of runs) { expect(run.code).toBe(0); expect(JSON.parse(run.stdout).ok).toBe(true); }
  expect(a.requests).toHaveLength(3); expect(b.requests).toHaveLength(3);
  const list = await cli(["provider", "list", "--json"], env);
  expect(JSON.parse(list.stdout)).toContainEqual(expect.objectContaining({ provider: "searxng", configuredInstances: 2, ready: true }));
  const doctor = await cli(["doctor", "--json"], env);
  expect(JSON.parse(doctor.stdout).checks).toContainEqual(expect.objectContaining({ name: "provider:searxng", ok: true, detail: "2 keyless instances configured (not probed)" }));
  expect(list.stdout + doctor.stdout).not.toContain(a.baseUrl); expect(list.stdout + doctor.stdout).not.toContain(b.baseUrl);
  const third = await fixture({ results: [] });
  const append = await cli(["provider", "configure", "searxng", "--append", "--base-url", third.baseUrl, "--allow-range", "127.0.0.1/32", "--allow-range", "::1/128"], env);
  expect(append.code).toBe(0);
  const persisted = JSON.parse(await readFile(join(h, "config.json"), "utf8"));
  expect(persisted.providers.searxng.instances).toHaveLength(3);
  expect(persisted.providers.searxng.instances[2].allowRanges).toEqual(["127.0.0.1/32", "::1/128"]);
}, 20_000); // Nine CLI startups need a test budget beyond one provider request.
function cli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    const child = spawn(process.execPath, ["dist/cli/main.js", ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", b => stdout += b); child.stderr.on("data", b => stderr += b);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
it("configures and invokes built CLI without keys or changing default fallback", async () => {
  const h = await home(); const { baseUrl } = await fixture({ results: [{ url: "https://example.com", title: "Entry" }] });
  const env = { ARKSPACE_HOME: h, SEARXNG_URL: "https://ignored.invalid" };
  expect((await cli(["provider", "configure", "searxng", "--base-url", baseUrl, "--allow-range", "127.0.0.1/32", "--allow-range", "::1/128"], env)).code).toBe(0);
  const config = JSON.parse(await readFile(join(h, "config.json"), "utf8"));
  expect(config.providerOrder).toEqual(defaultConfig().providerOrder); expect(config.providers.searxng.keyRefs).toEqual([]);
  expect(config.providers.searxng.instances[0].allowRanges).toEqual(["127.0.0.1/32", "::1/128"]);
  const run = await cli(["web", "search", "skills", "--provider", "searxng", "--json"], env);
  expect(run.code).toBe(0); expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, provider: "searxng" });
  expect((await cli(["doctor", "--json"], env)).stdout).toContain('"name": "provider:searxng"');
  await expect(access(join(h, "state.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
