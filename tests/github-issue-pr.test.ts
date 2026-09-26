import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = resolve("skills/github/scripts/view-issue-pr.mjs");

describe("GitHub Skill issue/PR viewer", () => {
  it.skipIf(process.platform === "win32")("returns a bounded structured view using an injected gh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arkspace-fake-gh-"));
    const fake = join(dir, "gh");
    await writeFile(fake, `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") !== "api repos/acme/widgets/issues/42") process.exit(3);
console.log(JSON.stringify({number:42,title:"Fix it",state:"open",html_url:"https://github.com/acme/widgets/issues/42",user:{login:"octocat"},body:"details",labels:[{name:"bug"}],assignees:[{login:"dev"}],pull_request:{url:"x"},created_at:"2025-01-01T00:00:00Z"}));
`);
    await chmod(fake, 0o700);
    try {
      const result = await run(["--repo", "acme/widgets", "--number", "42"], { GH_BIN: fake });
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, data: expect.objectContaining({ kind: "pull_request", repository: "acme/widgets", number: 42, title: "Fix it", labels: ["bug"] }) });
      expect(result.stderr).toBe("");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("rejects unsafe arguments without invoking gh", async () => {
    const result = await run(["--repo", "acme/widgets;bad", "--number", "1"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("invalid-input");
  });

  it.skipIf(process.platform === "win32")("redacts CLI failures and does not expose gh stderr", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arkspace-fake-gh-"));
    const fake = join(dir, "gh");
    await writeFile(fake, "#!/usr/bin/env node\nconsole.error('token=super-secret https://secret.example'); process.exit(1);\n");
    await chmod(fake, 0o700);
    try {
      const result = await run(["--repo", "acme/widgets", "--number", "1"], { GH_BIN: fake });
      expect(result.code).toBe(1);
      expect(result.stderr).not.toContain("super-secret");
      expect(result.stderr).not.toContain("secret.example");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

function run(args: string[], environment: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}
