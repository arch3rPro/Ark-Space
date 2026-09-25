// Offline replay of the documented Tavily search request/response contract through arks invoke.
// No real Provider endpoint is contacted and no paid API key is required.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const home = await mkdtemp(join(tmpdir(), "arkspace-tavily-contract-"));
const fixture = await readFile(resolve(root, "tests/fixtures/tavily-search-response.json"), "utf8");
let received;
const server = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    received = {
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(body),
    };
    response.setHeader("content-type", "application/json");
    response.end(fixture);
  });
});
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = {
    version: 1,
    providerOrder: ["tavily"],
    providers: { tavily: { baseUrl: `http://127.0.0.1:${address.port}`, keyRefs: ["env:TAVILY_API_KEY"] } },
  };
  const input = {
    protocolVersion: 1,
    capability: "web.search",
    input: { query: "agent skills", provider: "tavily", maxResults: 3, includeDomains: ["example.com"] },
  };
  await writeFile(join(home, "config.json"), JSON.stringify(config));
  await writeFile(join(home, "request.json"), JSON.stringify(input));
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(root, "dist/cli/main.js"), "invoke", "web.search", "--input", join(home, "request.json")], {
      env: { ...process.env, ARKSPACE_HOME: home, TAVILY_API_KEY: "offline-probe-placeholder" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => done({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(received, {
    method: "POST",
    path: "/search",
    authorization: "Bearer offline-probe-placeholder",
    body: {
      query: "agent skills",
      max_results: 3,
      search_depth: "basic",
      include_answer: false,
      include_domains: ["example.com"],
    },
  });
  const envelope = JSON.parse(result.stdout);
  assert.match(envelope.attempts[0].keyId, /^[a-f0-9]{16}$/);
  assert.deepEqual(envelope, {
    protocolVersion: 1,
    ok: true,
    capability: "web.search",
    provider: "tavily",
    data: {
      query: "agent skills",
      requestId: "tavily-fixture-request",
      results: [{
        title: "ArkSpace", url: "https://example.com/arkspace",
        snippet: "A reusable agent skills workspace.", score: 0.87, published: "2026-01-01",
      }],
    },
    attempts: [{ provider: "tavily", keyId: envelope.attempts[0].keyId, ok: true }],
    warnings: [],
  });
  assert.ok(!result.stdout.includes("offline-probe-placeholder"));
  console.log("Tavily search offline contract replay passed (POST /search, bearer, mapping, Protocol v1).");
} finally {
  await new Promise((done) => server.close(done));
  await rm(home, { recursive: true, force: true });
}
