import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

import { executeWebContentGet } from "../src/capabilities/web-content-get.js";
import { initializeConfig } from "../src/config/store.js";
import { cacheFetchResults } from "../src/state/web-response-cache.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });

async function cached(content: string) {
  const home = await mkdtemp(join(tmpdir(), "arks-content-index-")); homes.push(home);
  const statePath = join(home, "state.json");
  const data = await cacheFetchResults({ results: [{ url: "https://example.com/document", content }], failedUrls: [] }, statePath,
    { ttlSeconds: 60, maxCount: 10, maxBytes: 100_000 });
  return { statePath, responseId: data.results[0]!.responseId! };
}

it("returns the original UTF-16 index when Unicode casing expands an earlier character", async () => {
  const { statePath, responseId } = await cached("İ Hello");
  const result = await executeWebContentGet({ responseId, findText: "hello", caseSensitive: false, offset: 0, limit: 100 }, statePath);
  expect(result).toMatchObject({ ok: true, data: { matchIndex: 2, content: "İ Hello", totalLength: 7 } });
  if (!result.ok) throw new Error("Expected cached-content success.");
  const located = await executeWebContentGet({ responseId, offset: result.data.matchIndex!, limit: 5, caseSensitive: false }, statePath);
  expect(located).toMatchObject({ ok: true, data: { offset: 2, content: "Hello" } });
});

it.each([
  ["😀İ [A+B].", "[a+b].", false, 4],
  ["before a*b [A+B]. c?d (e) {f} |g| ^h$ \\i", "a*b [a+b]. c?d (e) {f} |g| ^h$ \\i", false, 7],
  ["汉字 CAFÉ", "café", false, 3],
  ["İ 𐐀", "𐐨", false, 2],
  ["x Hello hello", "hello", true, 8],
] as const)("locates literal %j in original text %j (case-sensitive=%s)", async (content, findText, caseSensitive, matchIndex) => {
  const { statePath, responseId } = await cached(content);
  const result = await executeWebContentGet({ responseId, findText, caseSensitive, offset: 0, limit: 100 }, statePath);
  expect(result).toMatchObject({ ok: true, data: { matchIndex, content } });
});

it("preserves original indexes through the built invoke boundary", async () => {
  const { statePath, responseId } = await cached("İ Hello");
  await initializeConfig(join(dirname(statePath), "config.json"));
  const request = join(dirname(statePath), "request.json");
  await writeFile(request, JSON.stringify({ protocolVersion: 1, capability: "web.content.get", input: { responseId, findText: "hello" } }));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [resolve("dist/cli/main.js"), "invoke", "web.content.get", "--input", request],
    { timeout: 5_000, env: { ...process.env, ARKSPACE_HOME: dirname(statePath) } });
  expect(JSON.parse(stdout)).toMatchObject({ ok: true, capability: "web.content.get", data: { matchIndex: 2, content: "İ Hello" } });
  expect(stdout.trim().split("\n")).toHaveLength(1); expect(stderr).toBe("");
});

it("does not interpret caller text as a regular expression or widen case-sensitive matching", async () => {
  const { statePath, responseId } = await cached("ab Hello");
  for (const [findText, caseSensitive] of [["a.*", false], ["hello", true]] as const) {
    const result = await executeWebContentGet({ responseId, findText, caseSensitive, offset: 0, limit: 100 }, statePath);
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid-request", message: "Text was not found." } });
  }
});
