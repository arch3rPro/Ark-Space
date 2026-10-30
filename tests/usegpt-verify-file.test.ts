import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { defaultConfig } from "../src/config/schema.js";

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const hubIt = it.skipIf(major < 22 || major === 22 && minor < 13);

hubIt("exports binary fixed revisions and independently verifies bytes from outside the repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "usegpt-export-test-"));
  try {
    const { UseGptHubStore } = await import("../src/usegpt/hub-store.js");
    const dataDir = join(root, "data");
    const store = await UseGptHubStore.open(dataDir);
    let artifact: Record<string, unknown>;
    const bytes = Buffer.from([0, 255, 137, 80, 78, 71, 13, 10]);
    try {
      const project = await store.execute("project.create", { name: "Binary export" });
      artifact = await store.publishBytes({ projectId: String(project.id), name: "../../private.png", mediaType: "image/png" }, bytes);
    } finally { await store.close(); }
    const config = defaultConfig();
    config.connections = { usegpt: { enabled: true, dataDir } };
    await writeFile(join(root, "config.json"), JSON.stringify(config));
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
      const child = spawn(process.execPath, [resolve("scripts/usegpt-verify-file.mjs"), "--artifact-id", String(artifact.id), "--revision", "1", "--output-dir", root], {
        cwd: tmpdir(), env: { ...process.env, ARKSPACE_HOME: root }, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.once("error", reject); child.once("close", code => done({ code, stdout, stderr }));
    });
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const exported = JSON.parse(result.stdout);
    expect(exported).toMatchObject({ ok: true, revision: 1, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), verified: true });
    expect(await readFile(exported.outputPath)).toEqual(bytes);
    expect(exported.outputPath).toMatch(/usegpt-export-[^/]+\/content\.bin$/);
    if (process.platform !== "win32") expect((await stat(exported.outputPath)).mode & 0o777).toBe(0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});
