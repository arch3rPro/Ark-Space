import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const fixture = pathToFileURL(resolve("tests/fixtures/github-record-boundary.mjs")).href;
const directories: string[] = [];
const item = { number: 42, title: "Fix it", state: "open", html_url: "https://github.com/acme/widgets/issues/42", user: { login: "octocat" }, body: "details", labels: [{ name: "bug" }] };
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function scenario(overrides: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "gh-repo access "));
  directories.push(dir);
  const skill = join(dir, "isolated-skill");
  await cp(resolve("skills/gh-repo"), skill, { recursive: true });
  const log = join(dir, "events.jsonl");
  const state = join(dir, "state.json");
  const ghScript = join(dir, "fake-gh.mjs");
  await writeFile(log, "");
  await writeFile(state, JSON.stringify({ log, ghScript, item, ...overrides }));
  await writeFile(ghScript, `import {readFileSync,appendFileSync} from 'node:fs';
const s=JSON.parse(readFileSync(process.env.GITHUB_RECORD_TEST_STATE,'utf8'));
appendFileSync(s.log,JSON.stringify({pid:process.pid})+'\\n');
if(s.hang){if(s.ignoreTerm)process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}else{
  if(s.authRequired){console.error('To get started with GitHub CLI, please run: gh auth login. token=private-boundary-secret');process.exit(1)}
  const status=s.status??200;
  process.stdout.write('HTTP/2.0 '+status+' Status\\r\\nContent-Type: application/json\\r\\n');
  for(const [k,v] of Object.entries(s.headers??{}))process.stdout.write(k+': '+v+'\\r\\n');
  process.stdout.write('\\r\\n'+(s.body??JSON.stringify(s.item)));
  process.exitCode=status>=400?1:0;
}`);
  return { dir, skill, log, state, entry: join(skill, "scripts/view-issue-pr.mjs") };
}

function invoke(s: Awaited<ReturnType<typeof scenario>>, extra: string[] = [], environment: Record<string, string> = {}, base = ["--repo", "acme/widgets", "--number", "42"]) {
  const child = spawn(process.execPath, ["--import", fixture, s.entry, ...base, ...extra], {
    cwd: s.skill, env: { ...process.env, ...environment, GITHUB_RECORD_TEST_STATE: s.state }, stdio: ["ignore", "pipe", "pipe"],
  });
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Public helper did not settle.")); }, 15000);
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
  return { child, result };
}

async function events(s: Awaited<ReturnType<typeof scenario>>) {
  return (await readFile(s.log, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
}

describe("installed gh-repo record access", () => {
  it("reads an explicitly public record anonymously without gh or credential headers", async () => {
    const s = await scenario();
    const result = await invoke(s, ["--anonymous"], { GH_TOKEN: "private-boundary-secret", GITHUB_TOKEN: "private-boundary-secret" }).result;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, data: expect.objectContaining({ repository: "acme/widgets", number: 42, title: "Fix it" }) });
    expect(result.stderr).toBe("");
    const calls = await events(s);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ transport: "https", url: "https://api.github.com/repos/acme/widgets/issues/42", redirect: "error", credentials: "omit" });
    expect(JSON.stringify(calls)).not.toContain("private-boundary-secret");
  });

  it("keeps the same normalized view through existing gh authentication", async () => {
    const s = await scenario();
    const result = await invoke(s).result;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, data: expect.objectContaining({ kind: "issue", number: 42, author: "octocat", body: "details" }) });
    const calls = await events(s);
    expect(calls[0]).toMatchObject({ transport: "gh", shell: false, stdin: "ignore" });
    expect(calls[0]!.args).toEqual(expect.arrayContaining(["api", "--hostname", "github.com", "--method", "GET", "--include", "repos/acme/widgets/issues/42"]));
    expect(calls.some(event => event.transport === "https")).toBe(false);
  });

  it.each([undefined, "--anonymous"])("distinguishes primary/secondary limits on %s without retry or fallback", async (mode) => {
    const s = await scenario({ status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000", "retry-after": "60", "x-ratelimit-resource": "core", "x-private-secret": "private-boundary-secret" }, body: JSON.stringify({ message: "API rate limit exceeded token=private-boundary-secret" }) });
    const result = await invoke(s, mode ? [mode] : []).result;
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, error: { kind: "rate-limited", status: 403, rateLimit: { remaining: 0, resetAt: 1893456000, retryAfterSeconds: 60, resource: "core" } } });
    expect(result.stderr).not.toContain("private-boundary-secret");
    expect((await events(s)).filter(event => event.transport)).toHaveLength(1);
  });

  it.each([
    ["../widgets", "42"], ["acme/..", "42"], ["acme/widgets", "1/../../user"],
    ["acme/widgets", "1.5"], ["acme/widgets", "1e2"], ["acme/widgets", "0"],
    ["acme/widgets", "2147483648"],
  ])("rejects unsafe repo/number %s %s before either transport", async (repo, number) => {
    const s = await scenario();
    const result = await invoke(s, ["--anonymous"], {}, ["--repo", repo!, "--number", number!]).result;
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind: "invalid-input" } });
    expect(await events(s)).toEqual([]);
  });

  it.each([undefined, "--anonymous"])("classifies HTTP failures on %s without leaking body or retrying", async (mode) => {
    for (const [status, kind] of [[401, mode ? "auth-required" : "auth-invalid"], [403, "access-denied"], [404, "not-found-or-inaccessible"], [429, "rate-limited"]] as const) {
      const s = await scenario({ status, body: JSON.stringify({ message: "token=private-boundary-secret https://private.example" }) });
      const result = await invoke(s, mode ? [mode] : []).result;
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind, status } });
      expect(result.stderr).not.toMatch(/private-boundary-secret|private.example/);
      expect((await events(s)).filter(event => event.transport)).toHaveLength(1);
    }
  });

  it("reports missing CLI or authentication without silently going anonymous", async () => {
    for (const state of [{ missingGh: join(tmpdir(), "nonexistent-gh-record-test") }, { authRequired: true }]) {
      const s = await scenario(state);
      const result = await invoke(s).result;
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind: "missingGh" in state ? "tool-unavailable" : "auth-required" } });
      expect((await events(s)).some(event => event.transport === "https")).toBe(false);
      expect(result.stderr).not.toContain("private-boundary-secret");
    }
  });

  it.each([undefined, "--anonymous"])("rejects wrong identity and oversized/malformed records on %s", async (mode) => {
    for (const state of [{ item: { ...item, number: 43 } }, { body: "not JSON: private-boundary-secret" }, { body: "x".repeat(256 * 1024 + 1) }]) {
      const s = await scenario(state);
      const result = await invoke(s, mode ? [mode] : []).result;
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind: "body" in state && state.body.length > 256 * 1024 ? "response-too-large" : "invalid-response" } });
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("private-boundary-secret");
    }
  });

  it("refuses disabled TLS and redirect responses without following a different host", async () => {
    const s = await scenario();
    const disabled = await invoke(s, ["--anonymous"], { NODE_TLS_REJECT_UNAUTHORIZED: "0" }).result;
    expect(disabled.code).toBe(1);
    expect(disabled.stdout).toBe("");
    expect(await events(s)).toEqual([]);
    const redirected = await scenario({ status: 302, headers: { location: "https://private.example" } });
    const result = await invoke(redirected, ["--anonymous"]).result;
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("private.example");
    expect((await events(redirected)).filter(event => event.transport)).toHaveLength(1);
  });

  it.each([".github", "foo..bar", "-widgets"])("accepts legal repository name %s and canonical URL casing", async (name) => {
    const s = await scenario({ item: { ...item, html_url: `https://github.com/acme/${name}/issues/42` } });
    const result = await invoke(s, ["--anonymous"], {}, ["--repo", `Acme/${name}`, "--number", "042"]).result;
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ data: { repository: `Acme/${name}`, number: 42 } });
  });

  it("recognizes secondary limits without exhausted primary quota and omits invalid hints", async () => {
    const s = await scenario({ status: 403, headers: { "x-ratelimit-remaining": "10", "x-ratelimit-reset": "private-boundary-secret", "retry-after": "-1", "x-ratelimit-resource": "private-boundary-secret" }, body: JSON.stringify({ message: "You have exceeded a secondary rate limit." }) });
    const result = await invoke(s, ["--anonymous"]).result;
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind: "rate-limited", rateLimit: { remaining: 10 } } });
    expect(JSON.parse(result.stderr).error.rateLimit).toEqual({ remaining: 10 });
    expect(result.stderr).not.toContain("private-boundary-secret");
  });

  it("does not leak network errors or accept foreign success URLs", async () => {
    for (const state of [{ networkError: true }, { item: { ...item, html_url: "https://private.example/42" } }]) {
      const s = await scenario(state);
      const result = await invoke(s, ["--anonymous"]).result;
      expect(result.code).toBe(1);
      expect(result.stderr).not.toMatch(/private-boundary-secret|private.example/);
      expect(result.stdout).toBe("");
    }
  });

  it.skipIf(process.platform === "win32").each([undefined, "--anonymous"])("settles cancellation of %s and the owned child before reporting", async (mode) => {
    const s = await scenario({ hang: true, ignoreTerm: true });
    const { child, result } = invoke(s, mode ? [mode] : []);
    let pid: number | undefined;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const calls = await events(s);
      pid = calls.find(event => typeof event.pid === "number")?.pid as number | undefined;
      if (mode ? calls.some(event => event.transport === "https") : pid) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    child.kill("SIGINT");
    const cancelled = await result;
    expect(cancelled.code).toBe(130);
    expect(JSON.parse(cancelled.stderr)).toMatchObject({ error: { kind: "cancelled" } });
    expect(cancelled.stdout).toBe("");
    if (!mode) {
      expect(pid).toBeDefined();
      expect(() => process.kill(pid!, 0)).toThrow();
    }
  });

  it("rejects invalid UTF-8 before normalizing a public record", async () => {
    const s = await scenario({ rawBytes: [123, 34, 120, 34, 58, 34, 255, 34, 125] });
    const result = await invoke(s, ["--anonymous"]).result;
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind: "invalid-response" } });
    expect(result.stdout).toBe("");
  });

  it("keeps the deadline active after headers while reading an unfinished body", async () => {
    const s = await scenario({ hangBody: true });
    const result = await invoke(s, ["--anonymous"]).result;
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind: "timeout" } });
    expect(result.stdout).toBe("");
  }, 15000);

  it("ships optional user-controlled login and partial-evidence recovery in an isolated Skill", async () => {
    const s = await scenario();
    const skill = await readFile(join(s.skill, "SKILL.md"), "utf8");
    const acquisition = await readFile(join(s.skill, "references/acquisition.md"), "utf8");
    const discussion = await readFile(join(s.skill, "references/discussions.md"), "utf8");
    expect(skill).toContain("Public analysis does not require login");
    expect(skill).toContain("qualified partial report");
    expect(acquisition).toContain("gh auth login --hostname github.com --web");
    expect(acquisition).toContain("at most once per task");
    expect(acquisition).toContain("trusted terminal");
    expect(acquisition).toContain("A failed private-access path stops, not falls back to anonymous");
    expect(acquisition).toContain("20 remote requests");
    expect(acquisition).toContain("Count metadata, discussions, failed attempts");
    expect(acquisition).toContain("raw.githubusercontent.com/OWNER/REPO/FULL_COMMIT_SHA");
    expect(discussion).toContain("--number NUMBER --anonymous");
    expect(discussion).toContain("not a fallback");
    expect(discussion).toContain("epoch-seconds `resetAt`");
  });

  it.each([undefined, "--anonymous"])("applies the real 10-second deadline to %s", async (mode) => {
    const s = await scenario({ hang: true });
    const result = await invoke(s, mode ? [mode] : []).result;
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { kind: "timeout" } });
    expect(result.stdout).toBe("");
  }, 15000);
});
