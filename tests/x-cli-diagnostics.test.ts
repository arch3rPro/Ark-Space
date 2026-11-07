import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config/schema.js";
import { X_CAPABILITIES, XEnvelopeSchemas } from "../src/protocol/x-schema.js";

const SECRET = "fixture-x-cli-private-secret";
const TOKEN = "fixture-x-cli-private-token";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

// Block before DNS or transport so even a regression cannot spend real X quota.
const networkBoundary = `
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
const deny = () => {
  appendFileSync(process.env.ARKS_X_TEST_NETWORK_LOG, "network-attempt\\n");
  throw new Error("Fixture network access denied.");
};
dns.lookup = deny;
dnsPromises.lookup = deny;
http.request = deny;
https.request = deny;
net.Socket.prototype.connect = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
`;

const cases = [
  ["missing file", "input-unreadable"],
  ["malformed JSON", "input-json"],
  ["absent confirmed", "confirmation-required"],
  ["disabled tool", "capability-disabled"],
  ["invalid request", "request-schema"],
  ["unknown argument", "request-schema"],
  ["missing input option", "request-schema"],
] as const;

describe.each(X_CAPABILITIES)("built %s local diagnostics", capability => {
  it.each(cases)("reports %s safely without network access", async (scenario, reason) => {
    const home = await mkdtemp(join(tmpdir(), "arks-x-cli-private-path-"));
    directories.push(home);
    const inputPath = join(home, `${SECRET}-request.json`);
    const boundaryPath = join(home, "network-boundary.mjs");
    const networkLog = join(home, "network.log");
    await writeFile(boundaryPath, networkBoundary);
    await writeFile(networkLog, "");
    const config = defaultConfig();
    if (scenario === "disabled tool") config.tools[capability] = { enabled: false };
    await writeFile(join(home, "config.json"), JSON.stringify(config));
    const input = {
      ...(scenario === "absent confirmed" ? {} : { confirmed: true }),
      ...(capability === "x.search" ? { query: SECRET }
        : capability === "x.thread" ? { tweet: "1234567890123456789" }
          : { username: "fixture_user" }),
      ...(scenario === "invalid request" ? { unexpected: SECRET } : {}),
    };
    if (scenario !== "missing file") {
      await writeFile(inputPath, scenario === "malformed JSON"
        ? `{"private":"${SECRET}","path":${JSON.stringify(inputPath)},broken`
        : JSON.stringify({ protocolVersion: 1, capability, input }));
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_OPTIONS: "",
      NODE_TLS_REJECT_UNAUTHORIZED: "1",
      ARKSPACE_HOME: home,
      ARKS_X_TEST_NETWORK_LOG: networkLog,
      NITTER_BASE_URL: "https://x-cli-fixture.invalid",
      NITTER_API_TOKEN: TOKEN,
    };
    delete env.ARKSPACE_NITTER_API_TOKEN;
    const result = spawnSync(process.execPath, [
      "--import", pathToFileURL(boundaryPath).href,
      resolve("dist/cli/main.js"), "invoke", capability,
      ...(scenario === "missing input option" ? [] : ["--input", inputPath]),
      ...(scenario === "unknown argument" ? [`--unknown=${SECRET}`] : []),
    ], { cwd: tmpdir(), env, encoding: "utf8", timeout: 10_000 });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(await readFile(networkLog, "utf8")).toBe("");
    expect(result.stderr).toBe("");
    const output = result.stdout + result.stderr;
    for (const privateValue of [SECRET, TOKEN, home, inputPath, "fixture_user", "1234567890123456789"]) {
      expect(output).not.toContain(privateValue);
    }
    const envelope = JSON.parse(result.stdout);
    expect(envelope).toMatchObject({
      protocolVersion: 1, capability, connection: "nitter", ok: false,
      error: { kind: "invalid-request", reason, retryable: false },
    });
    expect(XEnvelopeSchemas[capability].safeParse(envelope).success).toBe(true);
    if (reason !== "confirmation-required") expect(output).not.toContain("confirmed=true");
  });
});

describe("built unsupported capability diagnostics", () => {
  it("keeps the requested capability name instead of relabeling it", async () => {
    const home = await mkdtemp(join(tmpdir(), "arks-x-unknown-capability-"));
    directories.push(home);
    const inputPath = join(home, "request.json");
    await writeFile(inputPath, JSON.stringify({ protocolVersion: 1, capability: "x.nope", input: {} }));
    const result = spawnSync(process.execPath, [resolve("dist/cli/main.js"), "invoke", "x.nope", "--input", inputPath], {
      cwd: home, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, ARKSPACE_HOME: home, NODE_OPTIONS: "" },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, capability: "x.nope", error: { kind: "invalid-request" } });
  });
});
