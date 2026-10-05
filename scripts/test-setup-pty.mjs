// Linux-only real-entry qualification. No global install, inherited config, or network.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (process.platform !== "linux") {
  process.stderr.write("SKIPPED: only Linux PTY qualified; Windows/macOS real TTY UNVERIFIED.\n");
  process.stdout.write(JSON.stringify({ status: "skipped", platform: process.platform, logicalChecks: 0 }) + "\n");
} else {
  await qualify();
}

async function qualify() {
  const temporary = await mkdtemp(join(tmpdir(), "arks-setup-entry-"));
  let terminate;
  let interrupted = false;
  const interrupt = () => { interrupted = true; terminate?.(); };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const home = join(temporary, "home");
    const cache = join(temporary, "cache");
    const install = join(temporary, "install");
    await mkdir(home);
    const config = join(temporary, "npmrc");
    await writeFile(config, "");
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home,
      XDG_CONFIG_HOME: home, TMPDIR: temporary, LANG: "C.UTF-8",
      npm_config_cache: cache, npm_config_userconfig: config,
      npm_config_globalconfig: join(temporary, "global-npmrc"),
      npm_config_offline: "true", npm_config_ignore_scripts: "true",
      npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
    await writeFile(env.npm_config_globalconfig, "");
    async function run(command, args, cwd = temporary, timeout = 120_000) {
      if (interrupted) throw new Error("Setup PTY qualification interrupted.");
      return new Promise((resolvePromise, reject) => {
        let stdout = ""; let stderr = ""; let expired = false;
        const owned = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
        let hardStop;
        // Python handles TERM and restores its PTY; bound interruption as well as timeout.
        terminate = () => {
          owned.kill("SIGTERM");
          hardStop ??= setTimeout(() => owned.kill("SIGKILL"), 8_000);
        };
        const timer = setTimeout(() => { expired = true; terminate(); }, timeout);
        owned.stdout.on("data", chunk => { stdout += chunk; });
        owned.stderr.on("data", chunk => { stderr += chunk; });
        owned.on("error", error => { clearTimeout(timer); clearTimeout(hardStop); terminate = undefined; reject(error); });
        owned.on("close", code => {
          clearTimeout(timer); clearTimeout(hardStop); terminate = undefined;
          if (interrupted || expired || code !== 0) reject(new Error(`Setup PTY subprocess failed (${command}, exit ${code}${expired ? ", timeout" : ""}). ${stderr.trim()}`));
          else resolvePromise(stdout);
        });
      });
    }
    // Missing Python on Linux is a failed prerequisite, never a verified skip.
    await run("python3", ["--version"]);
    const python = join(root, "scripts/setup-pty-check.py");
    const source = parse(await run("python3", [python, "--entry", join(root, "dist/cli/main.js")]), "source PTY report");
    const packDirectory = join(temporary, "packs");
    await mkdir(packDirectory);
    const npm = ["--offline", "--ignore-scripts", "--no-audit", "--no-fund"];
    async function pack(directory) {
      const result = parse(await run("npm", ["pack", directory, "--json", "--pack-destination", packDirectory, ...npm]), "npm pack report");
      if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.filename !== "string") throw new Error("Invalid npm pack report.");
      return join(packDirectory, result[0].filename);
    }
    const artifact = await pack(root);
    // Supply every already-installed runtime dependency as a local tarball. npm
    // resolves from these explicit files, not a user cache or a registry endpoint.
    const lock = parse(await readFile(join(root, "package-lock.json"), "utf8"), "lockfile");
    const dependencies = [];
    for (const [path, metadata] of Object.entries(lock.packages)) {
      if (!path || metadata.dev) continue;
      if (metadata.hasInstallScript) throw new Error("Runtime lifecycle script prohibited.");
      dependencies.push(await pack(join(root, path)));
    }
    await run("npm", ["install", "--prefix", install, "--omit=dev", "--package-lock=false", artifact, ...dependencies, ...npm]);
    const executable = join(install, "node_modules/.bin/arks");
    if ((await run(executable, ["--version"])).trim() !== "0.1.3") throw new Error("Installed arks version changed.");
    const installed = parse(await run("python3", [python, "--entry", executable]), "installed PTY report");
    for (const report of [source, installed]) if (report.status !== "passed" || !report.logicalChecks) throw new Error("PTY seam did not qualify.");
    process.stdout.write(JSON.stringify({ status: "passed", platform: "linux", source, installed,
      installation: "offline npm, owned empty cache, local runtime tarballs, lifecycle scripts denied",
      unverified: ["Windows real TTY", "macOS real TTY", "real services", "human UX acceptance"] }) + "\n");
    process.stderr.write(`Linux real PTY: source ${source.logicalChecks}, offline installed arks ${installed.logicalChecks} logical checks passed.\n`);
  } finally {
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
    await rm(temporary, { recursive: true, force: true });
  }
}
function parse(text, description) {
  try { return JSON.parse(text); } catch { throw new Error(`Invalid ${description}.`); }
}
