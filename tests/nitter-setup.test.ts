import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyNitter } from "../src/capabilities/x-verify.js";
import { getNitterConnectionSnapshot, removeNitterConnection, saveNitterConnection } from "../src/config/manage.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { loadConfig } from "../src/config/store.js";

const TOKEN = "setup-nitter-secret";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(c => c())); });

async function setup(handler: (url: string, auth?: string) => { status: number; body: unknown }) {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url!);
    const r = handler(req.url!, req.headers.authorization);
    res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.body));
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  const home = await mkdtemp(join(tmpdir(), "arks-nit-")); cleanups.push(() => rm(home, { recursive: true, force: true }));
  return { seen, paths: resolveArkSpacePaths({ ARKSPACE_HOME: home }), url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
const ok = (url: string, auth?: string) => url === "/api/v1/health" ? { status: 200, body: { status: "ok" } }
  : auth === `Bearer ${TOKEN}` ? { status: 200, body: { data: [] } } : { status: 401, body: { error: { code: "unauthorized" } } };

it("saves, snapshots, verifies and removes a managed Nitter connection without leaking the token", async () => {
  const { paths, url, seen } = await setup(ok);
  await saveNitterConnection(paths, url, TOKEN, {}, {});
  expect((await loadConfig(paths.config)).connections?.nitter?.baseUrl).toBe(url);
  expect(await readFile(paths.config, "utf8")).not.toContain(TOKEN);
  const snap = await getNitterConnectionSnapshot(paths, {});
  expect(snap).toMatchObject({ source: "managed", hasLocal: true, status: "configured (not tested)", warnings: ["HTTP transport is plaintext."] });
  expect(JSON.stringify(snap)).not.toContain(TOKEN);
  expect(await verifyNitter(paths, {})).toEqual({ ok: true, detail: "tools/200" });
  expect(seen).toEqual(["/api/v1/health", "/api/v1/tools"]);
  await expect(saveNitterConnection(paths, `${url}/x`, undefined, {}, {})).rejects.toThrow(/explicit consent/);
  await saveNitterConnection(paths, `${url}/x`, undefined, { reuseSavedKey: true }, {});
  await removeNitterConnection(paths);
  expect(await getNitterConnectionSnapshot(paths, {})).toBeUndefined();
});

it("reports a bad token without searching and refuses edits under an external pair", async () => {
  const { paths, url, seen } = await setup(ok);
  await saveNitterConnection(paths, url, "wrong-token", {}, {});
  expect(await verifyNitter(paths, {})).toEqual({ ok: false, detail: "tools/401" });
  expect(seen.every(p => p === "/api/v1/health" || p === "/api/v1/tools")).toBe(true);
  const external = { NITTER_BASE_URL: url, NITTER_API_TOKEN: TOKEN };
  await expect(saveNitterConnection(paths, url, TOKEN, {}, external)).rejects.toThrow(/environment-managed/);
  expect(await getNitterConnectionSnapshot(paths, external)).toMatchObject({ source: "environment", baseUrl: url });
  expect(await verifyNitter(paths, external)).toEqual({ ok: true, detail: "tools/200" });
});

it("saves the address and the token independently, in either order, without chaining", async () => {
  const { paths, url } = await setup(ok);
  await saveNitterConnection(paths, url, undefined, {}, {});
  expect((await loadConfig(paths.config)).connections?.nitter?.baseUrl).toBe(url);
  expect(await getNitterConnectionSnapshot(paths, {})).toMatchObject({ baseUrl: url, hasLocal: false, available: false, status: "missing" });
  expect(await verifyNitter(paths, {})).toEqual({ ok: false, detail: "config" });
  await saveNitterConnection(paths, undefined, TOKEN, {}, {});
  expect(await getNitterConnectionSnapshot(paths, {})).toMatchObject({ baseUrl: url, hasLocal: true, available: true });
  expect(await verifyNitter(paths, {})).toEqual({ ok: true, detail: "tools/200" });
  await expect(saveNitterConnection(paths, undefined, undefined, {}, {})).rejects.toThrow(/Nothing to save/);
});

it("keeps a token saved before any address and removes it with the connection", async () => {
  const { paths, url } = await setup(ok);
  await saveNitterConnection(paths, undefined, TOKEN, {}, {});
  expect(await getNitterConnectionSnapshot(paths, {})).toMatchObject({ baseUrl: "", hasLocal: true, available: false, status: "missing" });
  await saveNitterConnection(paths, url, undefined, {}, {});
  expect((await getNitterConnectionSnapshot(paths, {}))?.available).toBe(true);
  await removeNitterConnection(paths);
  expect(await getNitterConnectionSnapshot(paths, {})).toBeUndefined();
  await saveNitterConnection(paths, undefined, TOKEN, {}, {});
  await removeNitterConnection(paths); // token-only state is removable too
  expect(await getNitterConnectionSnapshot(paths, {})).toBeUndefined();
});
