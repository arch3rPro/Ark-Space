import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/schema.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { invokeCapability } from "../src/protocol/invoke.js";
import { UseGptInputSchemas } from "../src/protocol/usegpt-schema.js";

// These synthetic transport contracts are not real ChatGPT Host acceptance evidence.
const hubIt = it.skipIf(Number(process.versions.node.split(".")[0]) < 22);
const homes: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.useRealTimers(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-host-files-")); homes.push(home);
  const config = defaultConfig(); config.connections = { usegpt: { enabled: true, dataDir: join(home, "hub") } };
  await writeFile(join(home, "config.json"), JSON.stringify(config));
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home });
  const call = (capability: keyof typeof UseGptInputSchemas, input: Record<string, unknown>) => invokeCapability(capability, { protocolVersion: 1, capability, input }, { paths }) as Promise<{ ok: boolean; data?: Record<string, unknown>; error?: { kind: string } }>;
  const project = await call("usegpt.project.create", { name: "Host files" });
  const publish = (file: unknown, extra = {}) => call("usegpt.artifact.publish_file", { projectId: project.data!.id, name: "report.csv", file, ...extra });
  return { home, paths, call, project, publish };
}
const reference = { file_id: "file_native", download_url: "https://files.oaiusercontent.com/report?sig=private-signature" };

it("requires native object shapes and rejects URL strings, credentials, local paths and oversized declarations", () => {
  const schema = UseGptInputSchemas["usegpt.artifact.publish_file"];
  for (const file of [reference.download_url, { download_url: reference.download_url }, { ...reference, cookie: "secret" }, { ...reference, size: 67_108_865 }]) {
    expect(schema.safeParse({ projectId: "project_test", name: "report.csv", file }).success).toBe(false);
  }
  expect(schema.safeParse({ projectId: "project_test", name: "report.csv", file: { type: "resource_link", uri: reference.download_url, name: "report.csv" } }).success).toBe(true);
});

hubIt("streams native and resource-link bytes through the capability, retaining a stable receipt after reopen", async () => {
  const f = await fixture(), bytes = Buffer.from("x,y\n1,2\n");
  const transport = vi.fn(async () => new Response(bytes, { headers: { "content-length": String(bytes.length) } })); vi.stubGlobal("fetch", transport);
  const published = await f.publish({ ...reference, size: bytes.length, mime_type: "text/csv" }, { idempotencyKey: "native_1" });
  expect(published).toMatchObject({ ok: true, data: { revision: 1, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "text/csv" } });
  expect(await f.publish(reference, { mediaType: "text/csv", idempotencyKey: "native_1" })).toEqual(published);
  expect(await f.call("usegpt.artifact.read", { artifactId: published.data!.id })).toMatchObject({ ok: true, data: { content: "x,y\n1,2\n" } });
  expect(await f.publish({ type: "resource_link", uri: reference.download_url, name: "data.csv", mimeType: "text/csv" })).toMatchObject({ ok: true });
  expect(JSON.stringify(published)).not.toContain("private-signature");
  expect(transport).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: "manual", credentials: "omit" }));
});

hubIt("rejects unsupported ids and unsafe hosts before network access, including redirected hosts", async () => {
  const f = await fixture(), transport = vi.fn(); vi.stubGlobal("fetch", transport);
  expect(await f.publish({ file_id: "file_native" })).toMatchObject({ ok: false, error: { kind: "unsupported" } });
  for (const download_url of ["http://files.oaiusercontent.com/file", "https://127.0.0.1/file", "https://files.oaiusercontent.com.evil.test/file", "https://arbitrary.blob.core.windows.net/file", "https://user:secret@files.oaiusercontent.com/file", "file:///etc/passwd", "https://files.oaiusercontent.com:444/file"]) {
    expect(await f.publish({ ...reference, download_url })).toMatchObject({ ok: false, error: { kind: "invalid-file-reference" } });
  }
  expect(transport).not.toHaveBeenCalled();
  transport.mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private?key=secret" } }));
  const result = await f.publish(reference);
  expect(result).toMatchObject({ ok: false, error: { kind: "invalid-file-reference" } }); expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain("secret");
});

hubIt("bounds redirects, rejects expired references and sanitizes transport errors", async () => {
  const f = await fixture(), transport = vi.fn(); vi.stubGlobal("fetch", transport);
  transport.mockResolvedValue(new Response(null, { status: 302, headers: { location: "/next" } }));
  expect(await f.publish(reference)).toMatchObject({ ok: false, error: { kind: "file-redirect" } }); expect(transport).toHaveBeenCalledTimes(4);
  for (const status of [401, 403, 404, 410]) {
    transport.mockResolvedValue(new Response(null, { status }));
    expect(await f.publish(reference)).toMatchObject({ ok: false, error: { kind: "file-reference-expired" } });
  }
  transport.mockRejectedValue(new Error("cookie=private-key https://private/"));
  const result = await f.publish(reference); expect(result).toMatchObject({ ok: false, error: { kind: "file-download" } }); expect(JSON.stringify(result)).not.toContain("private");
});

hubIt("rejects oversized and mismatched streams without publishing a revision", async () => {
  const f = await fixture(), transport = vi.fn(); vi.stubGlobal("fetch", transport);
  transport.mockImplementation(async () => new Response("abc", { headers: { "content-length": "67108865" } }));
  expect(await f.publish(reference)).toMatchObject({ ok: false, error: { kind: "file-size" } });
  transport.mockImplementation(async () => new Response("abc", { headers: { "content-length": "3" } }));
  expect(await f.publish({ ...reference, size: 4 })).toMatchObject({ ok: false, error: { kind: "file-size" } });
  transport.mockImplementation(async () => new Response("abc"));
  expect(await f.publish({ ...reference, size: 4 })).toMatchObject({ ok: false, error: { kind: "size_mismatch" } });
  transport.mockImplementation(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(67_108_864)); controller.enqueue(new Uint8Array(1)); controller.close(); } })));
  expect(await f.publish(reference)).toMatchObject({ ok: false, error: { kind: "file-size" } });
  expect(await f.call("usegpt.artifact.list", { projectId: f.project.data!.id })).toMatchObject({ ok: true, data: { artifacts: [] } });
  expect(await readdir(join(f.home, "hub", "staging"))).toEqual([]);
});

hubIt("honors cancellation with sanitized errors", async () => {
  const f = await fixture();
  const controller = new AbortController(); controller.abort(new Error("private-cookie"));
  const cancelled = await invokeCapability("usegpt.artifact.publish_file", { protocolVersion: 1, capability: "usegpt.artifact.publish_file", input: { projectId: f.project.data!.id, name: "x", file: reference } }, { paths: f.paths, signal: controller.signal });
  expect(cancelled).toMatchObject({ ok: false, error: { kind: "cancelled" } }); expect(JSON.stringify(cancelled)).not.toContain("private-cookie");
});
