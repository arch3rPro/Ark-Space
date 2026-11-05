import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { storeCredential } from "../src/config/credentials.js";
import { defaultConfig } from "../src/config/schema.js";
import { writeJsonAtomic } from "../src/io/json-store.js";
import { invokeCapability, isCapability } from "../src/protocol/invoke.js";
import { XEnvelopeSchemas } from "../src/protocol/x-schema.js";

const TOKEN = "fixture-nitter-secret";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())); });

const tweetDto = { id: "20", url: "https://x.com/jack/status/20", available: true, author: { username: "jack", name: "jack", verified: false }, text: "just setting up my twttr", created_at: "2006-03-21T20:50:14Z", stats: { replies: 1, reposts: 2, likes: 3, views: null } };
type Reply = { status?: number; body?: unknown; raw?: string; type?: string; delay?: number };
async function fixture(reply: (url: URL) => Reply = () => ({ body: { data: { items: [tweetDto], next_cursor: "c2", has_more: true }, meta: {} } })) {
  const seen: { url: string; auth: string | undefined }[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url!, auth: req.headers.authorization });
    const r = reply(new URL(req.url!, "http://x"));
    setTimeout(() => {
      res.writeHead(r.status ?? 200, { "content-type": r.type ?? "application/json" });
      res.end(r.raw ?? JSON.stringify(r.body));
    }, r.delay ?? 0);
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  const home = await mkdtemp(join(tmpdir(), "arks-x-")); cleanups.push(() => rm(home, { recursive: true, force: true }));
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home });
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/prefix`;
  const config = defaultConfig();
  config.connections = { nitter: { baseUrl, apiKeyRef: "env:ARKSPACE_NITTER_API_TOKEN" } };
  await writeJsonAtomic(paths.config, config);
  await storeCredential(paths.credentials, "ARKSPACE_NITTER_API_TOKEN", TOKEN);
  const run = (capability: string, input: object = {}, env: NodeJS.ProcessEnv | undefined = {}, signal?: AbortSignal) =>
    invokeCapability(capability as never, { protocolVersion: 1, capability, input: { confirmed: true, ...input } }, { paths, ...(env === undefined ? {} : { originalEnvironment: env }), ...(signal ? { signal } : {}) });
  return { run, seen, paths, baseUrl, config };
}

it("registers the four X capabilities and maps search to the upstream route with a Bearer token", async () => {
  for (const c of ["x.search", "x.thread", "x.user", "x.timeline"]) expect(isCapability(c)).toBe(true);
  const f = await fixture();
  const result = await f.run("x.search", { query: "nim lang", from: ["@jack"], since: "2025-01-01", minLikes: 5, limit: 10 });
  expect(XEnvelopeSchemas["x.search"].safeParse(result).success).toBe(true);
  expect(result).toMatchObject({ ok: true, connection: "nitter", source: "managed", contentTrust: "untrusted", data: { nextCursor: "c2", hasMore: true, items: [{ id: "20", text: "just setting up my twttr", stats: { views: null } }] } });
  expect(f.seen).toHaveLength(1);
  const u = new URL(f.seen[0]!.url, "http://x");
  expect(u.pathname).toBe("/prefix/api/v1/search/tweets");
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ format: "json", query: "nim lang", from: "jack", since: "2025-01-01", min_likes: "5", limit: "10", mode: "latest" });
  expect(f.seen[0]!.auth).toBe(`Bearer ${TOKEN}`);
  expect(JSON.stringify(result)).not.toContain(TOKEN);
});

it("maps thread, user and timeline routes", async () => {
  const f = await fixture(url => url.pathname.endsWith("/thread")
    ? { body: { data: { tweet: tweetDto, ancestors: [], continuation: [tweetDto], replies: [[tweetDto]], replies_omitted: 2, next_cursor: null, has_more: false } } }
    : url.pathname.endsWith("/tweets")
      ? { body: { data: { user: { username: "jack", name: "jack" }, tab: "media", items: [tweetDto], next_cursor: null, has_more: false } } }
      : { body: { data: { id: "12", username: "jack", name: "jack", url: "https://x.com/jack", bio: "", location: "", website: "", verified: null, protected: false, joined: "2006-03-21T20:50:14Z", stats: { followers: 1, following: 2, tweets: 3, likes: null, media: null } } } });
  expect(await f.run("x.thread", { tweet: "https://x.com/jack/status/20", includeReplies: true, maxReplies: 5, sort: "likes" })).toMatchObject({ ok: true, data: { repliesOmitted: 2, replies: [[{ id: "20" }]], hasMore: false } });
  expect(await f.run("x.timeline", { username: "jack", tab: "media" })).toMatchObject({ ok: true, data: { tab: "media" } });
  expect(await f.run("x.user", { username: "@jack" })).toMatchObject({ ok: true, data: { user: { username: "jack", stats: { followers: 1, likes: null } } } });
  expect(f.seen.map(s => new URL(s.url, "http://x").pathname)).toEqual([
    "/prefix/api/v1/tweets/https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20/thread", "/prefix/api/v1/users/jack/tweets", "/prefix/api/v1/users/jack"]);
});

it.each([
  [429, { error: { code: "rate_limited", message: "m", retryable: true, retry_after_s: 60 } }, "rate-limit", true],
  [401, { error: { code: "unauthorized", message: "m", retryable: false } }, "auth", false],
  [403, { error: { code: "forbidden_origin", message: "m", retryable: false } }, "permission", false],
  [403, { error: { code: "protected_account", message: "m", retryable: false } }, "protected-account", false],
  [404, { error: { code: "user_suspended", message: "m", retryable: false } }, "user-suspended", false],
  [404, { error: { code: "not_found", message: "m", retryable: false } }, "not-found", false],
  [503, { error: { code: "upstream_unavailable", message: "m", retryable: true } }, "transient", true],
  [502, { error: { code: "upstream_error", message: "m", retryable: false } }, "upstream-error", false],
  [400, { error: { code: "invalid_argument", message: "m", retryable: false } }, "invalid-request", false],
])("classifies upstream HTTP %s %j as %s without retry", async (status, body, kind, retryable) => {
  const f = await fixture(() => ({ status, body }));
  const result = await f.run("x.user", { username: "jack" });
  expect(result).toMatchObject({ ok: false, error: { kind, retryable, status } });
  if (kind === "rate-limit") expect(result).toMatchObject({ error: { retryAfterSeconds: 60 } });
  expect(f.seen).toHaveLength(1);
});

it("rejects malformed, non-JSON, wrong-shape and token-echoing responses", async () => {
  expect(await (await fixture(() => ({ raw: "not json" }))).run("x.user", { username: "jack" })).toMatchObject({ ok: false, error: { kind: "invalid-response" } });
  expect(await (await fixture(() => ({ raw: "<html>", type: "text/html" }))).run("x.user", { username: "jack" })).toMatchObject({ ok: false, error: { kind: "invalid-response" } });
  expect(await (await fixture(() => ({ body: { data: { items: "nope" } } }))).run("x.search", { query: "a" })).toMatchObject({ ok: false, error: { kind: "invalid-response" } });
  const echo = await (await fixture(() => ({ body: { data: { items: [{ ...tweetDto, text: TOKEN }], next_cursor: null, has_more: false } } }))).run("x.search", { query: "a" });
  expect(echo).toMatchObject({ ok: false, error: { kind: "invalid-response" } }); expect(JSON.stringify(echo)).not.toContain(TOKEN);
});

it("keeps text bounded and quote nesting to one level", async () => {
  const nested = { ...tweetDto, text: "x".repeat(20_000), quote: { ...tweetDto, id: "21", quote: { ...tweetDto, id: "22" } } };
  const result: any = await (await fixture(() => ({ body: { data: { items: [nested], next_cursor: null, has_more: false } } }))).run("x.search", { query: "a" });
  expect(result.ok).toBe(true); expect(result.data.items[0].text).toHaveLength(10_000); expect(result.data.items[0].quote.id).toBe("21"); expect(result.data.items[0].quote.quote).toBeUndefined();
});

it("rejects absent consent, unknown fields, empty search and missing provenance offline", async () => {
  const f = await fixture();
  for (const [cap, input] of [["x.search", { confirmed: false, query: "a" }], ["x.search", { query: "" }], ["x.user", { username: "bad name!" }], ["x.user", { username: "jack", headers: { a: "b" } }], ["x.thread", { tweet: "not-a-tweet" }]] as const) {
    expect(await invokeCapability(cap, { protocolVersion: 1, capability: cap, input }, { paths: f.paths, originalEnvironment: {} })).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
  }
  expect(await invokeCapability("x.user", { protocolVersion: 1, capability: "x.user", input: { confirmed: true, username: "jack" } }, { paths: f.paths })).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(f.seen).toHaveLength(0);
});

it("resolves connections: external pair wins, partial pair and override conflict are config errors, disabled tool refuses", async () => {
  const f = await fixture();
  expect(await f.run("x.user", { username: "jack" }, { NITTER_BASE_URL: f.baseUrl })).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(await f.run("x.user", { username: "jack" }, { ARKSPACE_NITTER_API_TOKEN: "other" })).toMatchObject({ ok: false, error: { kind: "config" } });
  expect(f.seen).toHaveLength(0);
  const ok = await f.run("x.user", { username: "jack" }, { NITTER_BASE_URL: f.baseUrl, NITTER_API_TOKEN: "fixture-external-secret" });
  expect(ok).toMatchObject({ source: "environment" }); expect(f.seen[0]!.auth).toBe("Bearer fixture-external-secret");
  f.config.tools["x.user"] = { enabled: false }; await writeJsonAtomic(f.paths.config, f.config);
  expect(await f.run("x.user", { username: "jack" })).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
});

it("separates timeout from caller cancellation and makes one request", async () => {
  const slow = await fixture(() => ({ delay: 1_500, body: { data: {} } }));
  expect(await slow.run("x.user", { username: "jack", timeoutMs: 100 })).toMatchObject({ ok: false, error: { kind: "timeout" } });
  const controller = new AbortController(); const pending = slow.run("x.user", { username: "jack" }, {}, controller.signal);
  setTimeout(() => controller.abort(), 100);
  expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } });
});

it("does not follow redirects and reports connection failure as network", async () => {
  const redirect = await fixture(() => ({ status: 302, body: {} }));
  expect(await redirect.run("x.user", { username: "jack" })).toMatchObject({ ok: false, error: { kind: "invalid-response" } });
  const down = await fixture(); down.config.connections!.nitter!.baseUrl = "http://127.0.0.1:1"; await writeJsonAtomic(down.paths.config, down.config);
  expect(await down.run("x.user", { username: "jack" })).toMatchObject({ ok: false, error: { kind: "network" } });
});

it("executes through the real entry without leaking the token", async () => {
  const f = await fixture();
  const entry = resolve("dist/cli/main.js");
  const env: NodeJS.ProcessEnv = { ...process.env, ARKSPACE_HOME: f.paths.home }; delete env.NITTER_BASE_URL; delete env.NITTER_API_TOKEN; delete env.ARKSPACE_NITTER_API_TOKEN;
  const child = spawn(process.execPath, [entry, "invoke", "x.search", "--input", "-"], { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.on("data", c => { stdout += c; }); child.stderr.on("data", c => { stderr += c; });
  child.stdin.end(JSON.stringify({ protocolVersion: 1, capability: "x.search", input: { confirmed: true, query: "nim" } }));
  expect(await new Promise(done => child.once("close", done)), stderr).toBe(0);
  expect(XEnvelopeSchemas["x.search"].safeParse(JSON.parse(stdout)).success).toBe(true);
  expect(stdout + stderr).not.toContain(TOKEN);
});
