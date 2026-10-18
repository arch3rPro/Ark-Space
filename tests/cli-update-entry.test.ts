import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const fixture = pathToFileURL(resolve("tests/fixtures/cli-update-boundary.mjs")).href;
const version = (JSON.parse(await readFile(resolve("package.json"), "utf8")) as { version: string }).version;
const nativePty = process.platform === "linux" && spawnSync("python3", ["--version"]).status === 0;
const npmPack = process.env.npm_execpath;
const packedEntry = npmPack?.endsWith("npm-cli.js") && spawnSync("tar", ["--version"]).status === 0;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("manual CLI updates through the built entry", () => {
  it("exposes only explicit check and interactive update options", async () => {
    const scenario = await createScenario();
    const result = await runCli(scenario, ["update", "--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--check");
    expect(result.stdout).not.toContain("--confirm");
    expect(result.stdout).toContain("--json");
    expect(await events(scenario)).toEqual([]);
  });

  it("rejects a confirmation flag without fetching or installing", async () => {
    const scenario = await createScenario();
    const result = await runCli(scenario, ["update", "--confirm", "--json"], ["Y"]);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(await events(scenario)).toEqual([]);
  });

  it.each([["--version"], ["--help"]])("keeps ordinary %s startup offline", async (argument) => {
    const scenario = await createScenario();
    const result = await runCli(scenario, [argument]);
    expect(result.code).toBe(0);
    expect(await events(scenario)).toEqual([]);
  });

  it("checks the official registry without npm, config, credential bootstrap, or state writes", async () => {
    const scenario = await createScenario();
    const credentials = '{"version":1,"values":{"ARKSPACE_STORED_UPDATE_TEST_KEY":"local-only-secret"}}';
    await writeFile(join(scenario.home, "credentials.json"), credentials);
    await writeFile(join(scenario.home, "config.json"), "invalid-config");
    const result = await runCli(scenario, ["update", "--check", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, currentVersion: version, latestVersion: "99.0.0", updateAvailable: true, status: "update-available" });
    const log = await events(scenario);
    expect(log).toHaveLength(1);
    const url = new URL(log[0]!.url as string);
    expect(url.origin).toBe("https://registry.npmjs.org");
    expect(decodeURIComponent(url.pathname)).toBe("/@arkspace/cli/latest");
    expect(log[0]!.headers).not.toHaveProperty("authorization");
    expect(log[0]!.headers).not.toHaveProperty("X-API-Key");
    expect(log[0]).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(await readFile(join(scenario.home, "credentials.json"), "utf8")).toBe(credentials);
    expect(await readFile(join(scenario.home, "config.json"), "utf8")).toBe("invalid-config");
    expect(result.stdout + result.stderr).not.toContain("local-only-secret");
  });

  it.each([
    [version, "up-to-date", false],
    ["0.0.1", "newer-than-registry", false],
    ["0.1.10", "update-available", true],
  ] as const)("compares %s numerically without reinstalling or downgrading", async (latest, status, available) => {
    const scenario = await createScenario({ metadata: { name: "@arkspace/cli", version: latest } });
    const result = await runCli(scenario, ["update", "--check", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, latestVersion: latest, status, updateAvailable: available });
    expect((await events(scenario)).some((event) => event.kind === "npm")).toBe(false);
  });

  it.each([
    { body: "not JSON: private-registry-detail" },
    { metadata: { name: "another-package", version: "99.0.0" } },
    { metadata: { name: "@arkspace/cli", version: "99.0.0;echo unsafe" } },
    { metadata: { name: "@arkspace/cli", version: "99.0.0-beta.1" } },
    { metadata: { name: "@arkspace/cli", version: "99.0.0\n" } },
    { metadata: { name: "@arkspace/cli", version: "9007199254740992.0.0" } },
    { oversized: true },
    { status: 302, location: "https://elsewhere.example/latest" },
    { status: 500, body: "private-registry-detail" },
    { networkError: true },
    { contentType: "text/html" },
  ])("fails closed on untrusted registry evidence %j", async (state) => {
    const scenario = await createScenario(state);
    const result = await runCli(scenario, ["update", "--check", "--json"]);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(result.stdout + result.stderr).not.toContain("private-registry-detail");
    expect((await events(scenario)).some((event) => event.kind === "npm")).toBe(false);
  });

  it("refuses disabled TLS verification before fetching", async () => {
    const scenario = await createScenario();
    const result = await runCli(scenario, ["update", "--check", "--json"], [], { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(await events(scenario)).toEqual([]);
  });

  it("never treats piped Y as interactive consent", async () => {
    const scenario = await createScenario();
    const result = await runCli(scenario, ["update", "--json"], ["Y"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: "confirmation-required", installPrefix: scenario.prefix });
    expect((await events(scenario)).some((event) => (event.args as string[] | undefined)?.includes("install"))).toBe(false);
  });

  it.each(["n", "N", ""])("declines interactive %j without modifying the installed package", async (answer) => {
    const scenario = await createScenario({ interactive: true });
    const result = await runCli(scenario, ["update", "--json"], [answer]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: "declined" });
    expect(await installedVersion(scenario)).toBe(version);
    expect((await events(scenario)).some((event) => (event.args as string[] | undefined)?.includes("install"))).toBe(false);
  });

  it.each([["y"], ["Y"], ["invalid", "Y"]])("updates only after interactive consent %j", async (...answer: string[]) => {
    const scenario = await createScenario({ interactive: true });
    await writeFile(join(scenario.home, "credentials.json"), JSON.stringify({ version: 1, values: { ARKSPACE_STORED_UPDATE_TEST_KEY: "local-only-secret" } }));
    await writeFile(join(scenario.home, "config.json"), "invalid-config");
    const result = await runCli(scenario, ["update", "--json"], answer);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, latestVersion: "99.0.0", status: "updated", installPrefix: scenario.prefix });
    const install = (await events(scenario)).find((event) => (event.args as string[] | undefined)?.includes("install"));
    expect(install?.args).toEqual(expect.arrayContaining([
      "install", "--global", "--prefix", scenario.prefix, "@arkspace/cli@99.0.0",
      "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund", "--strict-ssl=true",
    ]));
    const args = install!.args as string[];
    expect(args.join(" ")).toMatch(/--registry(?:=| )https:\/\/registry\.npmjs\.org\/?/);
    expect(args.join(" ")).toMatch(/--@arkspace:registry(?:=| )https:\/\/registry\.npmjs\.org\/?/);
    expect(install).not.toHaveProperty("storedProvider");
    expect(await installedVersion(scenario)).toBe("99.0.0");
    expect(result.stdout + result.stderr).not.toContain("private-npm-detail");
  });

  it("cancels terminal Ctrl-C before installation", async () => {
    const scenario = await createScenario({ interactive: true });
    const result = await runCli(scenario, ["update", "--json"], ["\u0003"]);
    expect(result.code).toBe(130);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(await installedVersion(scenario)).toBe(version);
    expect((await events(scenario)).some((event) => (event.args as string[] | undefined)?.includes("install"))).toBe(false);
  });

  it("treats terminal EOF as declining, not approval or a missing result", async () => {
    const scenario = await createScenario({ interactive: true });
    const result = await runCli(scenario, ["update", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: "declined" });
    expect(await installedVersion(scenario)).toBe(version);
  });

  it.skipIf(!nativePty).each([
    ["y\n", "updated", 0], ["Y\n", "updated", 0], ["n\n", "declined", 0],
    ["N\n", "declined", 0], ["\n", "declined", 0], ["\u0004", "declined", 0], ["\u0003", "cancelled", 130],
  ] as const)("handles native Linux terminal input %j and restores terminal modes", async (answer, status, code) => {
    const scenario = await createScenario();
    const command = [process.execPath, "--import", fixture, scenario.entry, "update", "--json"];
    const run = spawnSync("python3", [resolve("tests/fixtures/cli-update-pty.py"), JSON.stringify(command), Buffer.from(answer).toString("hex")], {
      env: { ...process.env, NODE_OPTIONS: "", NODE_TLS_REJECT_UNAUTHORIZED: "1", ARKSPACE_HOME: scenario.home,
        ARKS_UPDATE_TEST_STATE: scenario.state, PATH: `${scenario.bin}${delimiter}${process.env.PATH ?? ""}` },
      encoding: "utf8", timeout: 15000,
    });
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout) as { code: number; stdout: string; restored: boolean };
    expect(result.code).toBe(code);
    expect(JSON.parse(result.stdout)).toMatchObject({ status });
    expect(result.restored).toBe(true);
    expect(await installedVersion(scenario)).toBe(status === "updated" ? "99.0.0" : version);
  }, 20000);

  it.skipIf(!packedEntry)("checks updates through the exact packed artifact in an isolated prefix", async () => {
    const scenario = await createScenario();
    const destination = dirname(scenario.log);
    const pack = spawnSync(process.execPath, [npmPack!, "pack", "--json", "--offline", "--ignore-scripts", "--pack-destination", destination], {
      cwd: resolve("."), env: { ...process.env, NODE_OPTIONS: "", npm_config_cache: join(destination, "cache"), npm_config_update_notifier: "false" },
      encoding: "utf8", timeout: 20000,
    });
    expect(pack.status, pack.stderr).toBe(0);
    const report = JSON.parse(pack.stdout) as Array<{ filename: string }>;
    const archive = join(destination, report[0]!.filename);
    const extract = spawnSync("tar", ["-xf", archive, "-C", scenario.root, "--strip-components=1"], { encoding: "utf8", timeout: 10000 });
    expect(extract.status, extract.stderr).toBe(0);
    const result = await runCli(scenario, ["update", "--check", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, currentVersion: version, status: "update-available" });
    expect((await events(scenario)).some((event) => event.kind === "npm")).toBe(false);
  }, 30000);

  it("honors a user-configured npm global prefix without redirecting installation", async () => {
    const scenario = await createScenario({ interactive: true, requirePrefixEnv: true });
    const result = await runCli(scenario, ["update", "--json"], ["Y"], { npm_config_prefix: scenario.prefix });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "updated", installPrefix: scenario.prefix });
  });

  it("refuses a linked global package", async () => {
    const scenario = await createScenario({ interactive: true });
    const linked = join(scenario.prefix, "linked source");
    await rename(scenario.root, linked);
    await symlink(linked, scenario.root, process.platform === "win32" ? "junction" : "dir");
    const result = await runCli(scenario, ["update", "--json"], ["Y"]);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect((await events(scenario)).some((event) => (event.args as string[] | undefined)?.includes("install"))).toBe(false);
  });

  it("never approves a buffered Y terminated by EOF instead of Enter", async () => {
    const scenario = await createScenario({ interactive: true });
    const result = await runCli(scenario, ["update", "--json"], ["Y"], {}, undefined, true);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "declined" });
    expect(await installedVersion(scenario)).toBe(version);
  });

  it("refuses to mutate a source checkout even with interactive approval available", async () => {
    const scenario = await createScenario({ interactive: true }, false);
    const result = await runCli(scenario, ["update", "--json"], ["Y"]);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect((await events(scenario)).some((event) => (event.args as string[] | undefined)?.includes("install"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("cancels an in-flight registry read without installation", async () => {
    const scenario = await createScenario({ waitForSignal: true });
    const result = await runCli(scenario, ["update", "--check", "--json"], [], {}, "registry");
    expect(result.code).toBe(130);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect((await events(scenario)).some((event) => event.kind === "npm")).toBe(false);
  });

  it.skipIf(process.platform === "win32")("settles the owned npm child after install cancellation", async () => {
    const scenario = await createScenario({ interactive: true, installWait: true });
    try {
      const result = await runCli(scenario, ["update", "--json"], ["Y"], {}, "install");
      expect(result.code).toBe(130);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
      const install = (await events(scenario)).find((event) => (event.args as string[] | undefined)?.includes("install"));
      expect(install?.pid).toBeTypeOf("number");
      expect(() => process.kill(install!.pid as number, 0)).toThrow();
    } finally {
      for (const event of await events(scenario)) {
        if (event.kind === "npm" && typeof event.pid === "number") {
          try { process.kill(event.pid, "SIGKILL"); } catch { /* The child normally already settled. */ }
        }
      }
    }
  });

  it.each([{ installFailure: true }, { wrongInstalledVersion: true }])("reports npm failure or incomplete verification without leaking output %j", async (state) => {
    const scenario = await createScenario({ ...state, interactive: true });
    const result = await runCli(scenario, ["update", "--json"], ["Y"]);
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
    expect(result.stdout + result.stderr).not.toContain("private-npm-detail");
  });
});

interface Scenario { home: string; prefix: string; root: string; entry: string; state: string; log: string; bin: string }

async function createScenario(state: Record<string, unknown> = {}, isolated = true): Promise<Scenario> {
  const base = await mkdtemp(join(tmpdir(), "arkspace update "));
  directories.push(base);
  const home = join(base, "home");
  let prefix = join(base, "npm prefix");
  await mkdir(prefix, { recursive: true });
  prefix = await realpath(prefix);
  const modules = process.platform === "win32" ? join(prefix, "node_modules") : join(prefix, "lib/node_modules");
  const root = join(modules, "@arkspace/cli");
  const bin = join(base, "bin");
  const log = join(base, "events.jsonl");
  const statePath = join(base, "state.json");
  await mkdir(home, { recursive: true });
  await mkdir(root, { recursive: true });
  await mkdir(bin, { recursive: true });
  if (isolated) {
    await cp(resolve("dist"), join(root, "dist"), { recursive: true });
    await cp(resolve("package.json"), join(root, "package.json"));
    await symlink(resolve("node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  }
  const scenario = { home, prefix, root, bin, log, state: statePath, entry: isolated ? join(root, "dist/cli/main.js") : resolve("dist/cli/main.js") };
  await writeFile(log, "");
  await writeFile(statePath, JSON.stringify({ ...state, log }));
  const npmPath = join(bin, "node_modules/npm/bin/npm-cli.js");
  await mkdir(dirname(npmPath), { recursive: true });
  await writeFile(npmPath, `#!/usr/bin/env node
const fs = require("node:fs");
const s = ${JSON.stringify({ ...state, prefix, modules, root, log })};
const args = process.argv.slice(2);
fs.appendFileSync(s.log, JSON.stringify({kind:"npm", args, pid:process.pid, storedProvider:process.env.ARKSPACE_STORED_UPDATE_TEST_KEY})+"\\n");
if (args[0] === "prefix") {
  if(s.requirePrefixEnv && !process.env.npm_config_prefix && !process.env.NPM_CONFIG_PREFIX) process.exit(1);
  console.log(s.prefix);
}
else if (args[0] === "root") console.log(s.modules);
else if (args[0] === "install") {
  if(s.installFailure) { console.error("private-npm-detail"); process.exit(1); }
  if(s.installWait) setInterval(()=>{},1000);
  else {
    const p = s.root + "/package.json";
    const metadata = JSON.parse(fs.readFileSync(p,"utf8"));
    metadata.version = s.wrongInstalledVersion ? "98.0.0" : "99.0.0";
    fs.writeFileSync(p,JSON.stringify(metadata));
  }
} else { console.error("unexpected npm command"); process.exit(1); }
`, { mode: 0o755 });
  if (process.platform === "win32") await writeFile(join(bin, "npm.cmd"), "@echo This wrapper must not execute\r\nexit /b 99\r\n");
  else await symlink(npmPath, join(bin, "npm"));
  return scenario;
}

async function events(scenario: Scenario): Promise<Array<Record<string, unknown>>> {
  return (await readFile(scenario.log, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}
async function installedVersion(scenario: Scenario): Promise<string> {
  return (JSON.parse(await readFile(join(scenario.root, "package.json"), "utf8")) as { version: string }).version;
}

function runCli(scenario: Scenario, args: string[], answers: string[] = [], environment: Record<string, string> = {}, cancelPhase?: "registry" | "install", endAfterAnswer = false): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["--import", fixture, scenario.entry, ...args], {
      env: { ...process.env, NODE_OPTIONS: "", NODE_TLS_REJECT_UNAUTHORIZED: "1", ARKSPACE_HOME: scenario.home,
        ARKS_UPDATE_TEST_STATE: scenario.state, PATH: `${scenario.bin}${delimiter}${process.env.PATH ?? ""}`, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let prompts = 0;
    const cancellation = cancelPhase ? setInterval(() => {
      void events(scenario).then((log) => {
        if (log.some((event) => cancelPhase === "registry" ? event.kind === "registry" : (event.args as string[] | undefined)?.includes("install"))) {
          clearInterval(cancellation);
          child.kill("SIGINT");
        }
      });
    }, 25) : undefined;
    const timer = setTimeout(() => { clearInterval(cancellation); child.kill(); reject(new Error("Update CLI fixture timed out.")); }, 15000);
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      const count = [...stderr.matchAll(/\[[yY]\/[nN]\]/g)].length;
      while (prompts < count) {
        const answer = answers[prompts++];
        if (answer === undefined) child.stdin.end();
        else if (endAfterAnswer) child.stdin.end(answer);
        else child.stdin.write(`${answer}\n`);
      }
    });
    // Piped input must not be mistaken for approval; interactive fixtures wait for the prompt.
    if (!args.includes("--check")) void readFile(scenario.state, "utf8").then((text) => {
      if (!(JSON.parse(text) as { interactive?: boolean }).interactive) child.stdin.end(`${answers.join("\n")}\n`);
    });
    child.once("error", (error) => { clearInterval(cancellation); clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearInterval(cancellation); clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
  });
}
