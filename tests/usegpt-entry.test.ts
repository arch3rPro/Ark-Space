import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
function cli(args: string[], home: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve("dist/cli/main.js"), ...args], { env: { ...process.env, ARKSPACE_HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => done({ code, stdout, stderr }));
  });
}
it("keeps UseGPT CLI and invoke independent of credential bootstrap and redacts file errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "usegpt-entry-")); homes.push(home);
  await writeFile(join(home, "credentials.json"), "malformed-private-credential");
  const request = join(home, "request.json");
  await writeFile(request, JSON.stringify({ protocolVersion: 1, capability: "usegpt.connection.status", input: {} }));
  for (const args of [["usegpt", "status", "--json"], ["invoke", "usegpt.connection.status", "--input", request]]) {
    const result = await cli(args, home);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, capability: "usegpt.connection.status", connection: "usegpt" });
    expect(result.stdout).not.toContain("malformed-private-credential");
  }
  const result = await cli(["usegpt", "start", "--prompt", "test", "--request-id", "request_123", "--confirm", "--file", join(home, "private-filename")], home);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, capability: "usegpt.task.start", connection: "usegpt" });
  expect(result.stdout + result.stderr).not.toContain("private-filename");
});
