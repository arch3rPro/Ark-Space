import { spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { TextDecoder } from "node:util";

const PACKAGE = "@arkspace/cli";
const REGISTRY = "https://registry.npmjs.org";
const CURRENT_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const MANUAL = "Self-update requires the executing, unlinked npm-global @arkspace/cli package. Update this source/local/npx/linked installation manually using its original install method.";

export class CliUpdateError extends Error {
  constructor(message: string, readonly status: "error" | "refused" | "cancelled" = "error", readonly possiblePartialChanges = false,
    readonly details: { latestVersion?: string; updateAvailable?: boolean; installPrefix?: string } = {}) {
    super(message);
  }
}

interface UpdateResult {
  ok: true;
  command: "update";
  status: "up-to-date" | "newer-than-registry" | "update-available" | "confirmation-required" | "declined" | "updated";
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  message: string;
  installPrefix?: string;
  packageRoot?: string;
}

export async function runCliUpdate(options: { check?: boolean }, currentVersion: string,
  environment: NodeJS.ProcessEnv, signal: AbortSignal, progress: (message: string) => void): Promise<UpdateResult> {
  if (Object.entries(environment).some(([key, value]) => key.toUpperCase() === "NODE_TLS_REJECT_UNAUTHORIZED" && value === "0")) throw new CliUpdateError("Update requires TLS certificate verification; remove NODE_TLS_REJECT_UNAUTHORIZED=0.");
  const current = versionParts(currentVersion);
  let metadata: unknown;
  try {
    metadata = await readReleaseMetadata(signal);
  } catch {
    if (signal.aborted) throw new CliUpdateError("Update check cancelled; no changes made.", "cancelled");
    throw new CliUpdateError("Could not read valid stable-release metadata from the official npm registry; no changes made.");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      !("name" in metadata) || metadata.name !== PACKAGE || !("version" in metadata) || typeof metadata.version !== "string") {
    throw new CliUpdateError("Invalid official npm package metadata; no changes made.");
  }
  const latestVersion = metadata.version;
  const latest = versionParts(latestVersion);
  const comparison = current.map((part, index) => Math.sign(latest[index]! - part)).find((value) => value !== 0) ?? 0;
  const base = { ok: true as const, command: "update" as const, currentVersion, latestVersion, updateAvailable: comparison > 0 };
  checkCancelled(signal);
  if (comparison <= 0) return { ...base, status: comparison === 0 ? "up-to-date" : "newer-than-registry",
    message: comparison === 0 ? `Already up to date (${currentVersion}); no changes made.` : `Current version ${currentVersion} is newer than npm stable ${latestVersion}; no downgrade performed.` };
  if (options.check) return { ...base, status: "update-available", message: `Update available: ${currentVersion} -> ${latestVersion}. Run arks update to inspect the npm-global target.` };

  const childEnvironment = { ...environment };
  // Preserve npm's configured global scope; installation flags pin registry and safety settings.
  for (const key of Object.keys(childEnvironment)) {
    if (/^npm_config_(prefix|userconfig|globalconfig)$/i.test(key)) continue;
    if (/^(node_options|node_path|node_tls_reject_unauthorized|npm_config_.*|npm_execpath|npm_node_execpath|npm_lifecycle_.*)$/i.test(key)) delete childEnvironment[key];
  }
  childEnvironment.npm_config_ignore_scripts = "true";
  childEnvironment.npm_config_strict_ssl = "true";
  childEnvironment.npm_config_node_options = "";
  let npm: string, prefix: string, npmRoot: string, packageRoot: string;
  try {
    npm = await findNpm(environment);
    prefix = await realpath(absoluteOutput(await runNpm(npm, ["prefix", "--global"], childEnvironment, signal)));
    npmRoot = absoluteOutput(await runNpm(npm, ["root", "--global", "--prefix", prefix], childEnvironment, signal));
    const expectedRoot = process.platform === "win32" ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");
    if (await realpath(npmRoot) !== expectedRoot) throw new Error("Unexpected or linked npm root");
    packageRoot = join(npmRoot, "@arkspace", "cli");
    await verifyTarget(npmRoot, packageRoot, currentVersion);
  } catch (error) {
    if (signal.aborted || error instanceof CliUpdateError && error.status === "cancelled") throw new CliUpdateError("Update cancelled; no changes made.", "cancelled");
    throw new CliUpdateError(MANUAL, "refused", false, { latestVersion, updateAvailable: true });
  }
  const identity = await lstat(packageRoot);
  const target = { installPrefix: prefix, packageRoot };
  const plan = `Current: ${currentVersion}; latest stable: ${latestVersion}; verified npm-global install prefix: ${prefix}; package: ${packageRoot}. This updates npm-package-owned files, not separate Skill/plugin installations or host registrations.`;
  if (!process.stdin.isTTY || !process.stderr.isTTY) return { ...base, ...target, status: "confirmation-required",
    message: `${plan} Run arks update in an interactive terminal to approve installation; no changes made.` };
  progress(plan);
  if (!await consent(signal)) return { ...base, ...target, status: "declined", message: "Update declined; no changes made." };
  checkCancelled(signal);
  progress(`Installing ${PACKAGE}@${latestVersion} in verified npm-global prefix ${prefix}; npm output is suppressed.`);
  let started = false;
  try {
    // Recheck ownership immediately before mutation; npm is pinned to this exact prefix and release.
    await verifyTarget(npmRoot, packageRoot, currentVersion);
    const now = await lstat(packageRoot);
    if (now.dev !== identity.dev || now.ino !== identity.ino) throw new Error("Package target changed during confirmation");
    checkCancelled(signal);
    started = true;
    await runNpm(npm, ["install", `${PACKAGE}@${latestVersion}`, "--global", "--prefix", prefix,
      "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund", "--strict-ssl=true",
      "--registry", REGISTRY, `--@arkspace:registry=${REGISTRY}`], childEnvironment, signal, 300_000);
    await verifyTarget(npmRoot, packageRoot, latestVersion);
    checkCancelled(signal);
  } catch (error) {
    const cancelled = signal.aborted || error instanceof CliUpdateError && error.status === "cancelled";
    throw new CliUpdateError(started
      ? `Update ${cancelled ? "cancelled" : "failed or could not be verified"}; possible partial changes to the npm-global package. Inspect it manually; no rollback or retry was attempted.`
      : "Update stopped before installation; no changes made.", cancelled ? "cancelled" : "error", started, { latestVersion, updateAvailable: true, installPrefix: prefix });
  }
  return { ...base, ...target, updateAvailable: false, status: "updated", message: `Updated ${PACKAGE} from ${currentVersion} to ${latestVersion}; installed package verified. Separate Skill/plugin installations and host registrations were not updated.` };
}

// Fixed TLS-authenticated identity, not caller URLs: system fake-IP DNS needs no Web SSRF exception.
async function readReleaseMetadata(signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 10_000);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    const response = await fetch(`${REGISTRY}/@arkspace%2Fcli/latest`, {
      redirect: "error", credentials: "omit", signal: controller.signal,
      headers: { accept: "application/json", "accept-encoding": "identity" },
    });
    if (!response.ok || !response.body || !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("Invalid registry response");
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) throw new Error("Registry metadata exceeds limit");
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))) as unknown;
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

async function consent(signal: AbortSignal): Promise<boolean> {
  checkCancelled(signal);
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  const lines = terminal[Symbol.asyncIterator]();
  let interrupted = false, closed = false;
  terminal.once("close", () => { closed = true; });
  const abort = () => terminal.close();
  terminal.once("SIGINT", () => { interrupted = true; terminal.close(); });
  signal.addEventListener("abort", abort, { once: true });
  try {
    process.stderr.write("Install this update? [y/N] ");
    if (signal.aborted) abort();
    for await (const line of lines) {
      checkCancelled(signal);
      if (interrupted || closed) break;
      const answer = line.trim();
      if (/^y$/i.test(answer)) return true;
      if (!answer || /^n$/i.test(answer)) return false;
      process.stderr.write("Enter y or n (empty means no).\nInstall this update? [y/N] ");
    }
    checkCancelled(signal);
    if (interrupted) throw new CliUpdateError("Update cancelled; no changes made.", "cancelled");
    return false;
  } finally {
    signal.removeEventListener("abort", abort);
    terminal.close();
  }
}

function versionParts(value: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.length > 50) throw new CliUpdateError("Invalid stable package version; no changes made.");
  const parts = value.split(".").map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new CliUpdateError("Invalid stable package version; no changes made.");
  return parts;
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CliUpdateError("Update cancelled; no changes made.", "cancelled");
}

function absoluteOutput(output: string): string {
  const path = output.trim();
  if (!path || !isAbsolute(path) || /[\u0000-\u001f\u007f]/.test(path)) throw new Error("Invalid npm path");
  return resolve(path);
}

async function findNpm(environment: NodeJS.ProcessEnv): Promise<string> {
  const path = Object.entries(environment).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  const candidates: string[] = [];
  for (const directory of path.split(delimiter).filter(isAbsolute)) {
    if (process.platform === "win32") candidates.push(join(directory, "node_modules", "npm", "bin", "npm-cli.js"));
    else {
      try { candidates.push(await realpath(join(directory, "npm"))); } catch { /* Missing PATH entry. */ }
    }
  }
  const nodeDirectory = dirname(process.execPath);
  candidates.push(join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDirectory, "..", "share", "nodejs", "npm", "bin", "npm-cli.js"));
  for (const candidate of candidates) {
    try {
      const actual = await realpath(candidate);
      if (basename(actual) === "npm-cli.js" && (await lstat(actual)).isFile()) return actual;
    } catch { /* Try the next installed npm JS entry, never a shell shim. */ }
  }
  throw new Error("npm JS entry unavailable");
}

async function verifyTarget(npmRoot: string, packageRoot: string, version: string): Promise<void> {
  const root = await realpath(npmRoot);
  if (root !== resolve(npmRoot)) throw new Error("Linked npm root or prefix");
  if (await realpath(packageRoot) !== join(root, "@arkspace", "cli") || await realpath(CURRENT_ROOT) !== await realpath(packageRoot) ||
      await realpath(fileURLToPath(import.meta.url)) !== join(root, "@arkspace", "cli", "dist", "cli", "update.js")) throw new Error("Not the executing global package");
  // Refuse npm links, scope links, and redirected entry files, including links within the package.
  if (process.platform !== "win32" && (await lstat(dirname(npmRoot))).isSymbolicLink()) throw new Error("Linked npm lib");
  for (const path of [npmRoot, join(npmRoot, "@arkspace"), packageRoot, join(packageRoot, "package.json"),
    ...["dist", "dist/cli", "dist/cli/main.js", "dist/cli/update.js"].map((part) => join(packageRoot, part))]) {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Linked package");
    const actual = await realpath(path);
    if (actual !== root && !actual.startsWith(root + sep)) throw new Error("Escaping package");
  }
  let metadata: unknown;
  try { metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as unknown; }
  catch { throw new Error("Package metadata unreadable"); }
  if (!metadata || typeof metadata !== "object" || !("name" in metadata) || metadata.name !== PACKAGE ||
      !("version" in metadata) || metadata.version !== version) throw new Error("Package identity mismatch");
}

function runNpm(npm: string, args: string[], env: NodeJS.ProcessEnv, signal: AbortSignal, timeoutMs = 10_000): Promise<string> {
  checkCancelled(signal);
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [npm, ...args], { env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let size = 0, failed = false, cancelled = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (failed) return;
      failed = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const abort = () => { cancelled = true; stop(); };
    const timer = setTimeout(stop, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    const capture = (chunk: Buffer, stdout: boolean) => {
      size += chunk.length;
      if (size > 64 * 1024) stop();
      else if (stdout) output.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
    child.once("error", () => { failed = true; });
    // close, not exit: cancellation waits until the process and its output pipes are closed.
    child.once("close", (code) => {
      clearTimeout(timer);
      if (forceKill) clearTimeout(forceKill);
      signal.removeEventListener("abort", abort);
      if (cancelled || signal.aborted) reject(new CliUpdateError("npm operation cancelled.", "cancelled"));
      else if (failed || code !== 0) reject(new CliUpdateError("npm operation failed; raw output suppressed."));
      else resolveRun(Buffer.concat(output).toString("utf8"));
    });
    if (signal.aborted) abort();
  });
}
