import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const npmrc = await readFile(resolve(root, ".npmrc"), "utf8");
const failures = [];

if (npmrc !== "ignore-scripts=true\nfund=false\n") failures.push(".npmrc must deny dependency lifecycle scripts by default.");
const lifecyclePackages = Object.entries(lock.packages).flatMap(([path, entry]) => entry.hasInstallScript ? [`${entry.name ?? path.replace(/^node_modules\//, "")}@${entry.version}`] : []);
const reviewedDeniedScripts = ["esbuild@0.28.2", "fsevents@2.3.3"];
if (JSON.stringify(lifecyclePackages.sort()) !== JSON.stringify(reviewedDeniedScripts.sort())) failures.push(`Lockfile lifecycle-script set changed: ${lifecyclePackages.join(", ") || "none"}. Review it before updating the deny list.`);
for (const [path, entry] of Object.entries(lock.packages)) if (entry.hasInstallScript && entry.dev !== true) failures.push(`Runtime dependency ${path} has an install script.`);

let report;
try {
  report = JSON.parse(execFileSync(npmCommand(), ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }))[0];
} catch (error) {
  failures.push(`npm pack dry run failed: ${error instanceof Error ? error.message : String(error)}`);
}
if (report) {
  const names = report.files.map((file) => file.path);
  for (const required of ["dist/cli/main.js", "skills/web/SKILL.md", "skills/research/SKILL.md", "skills/browser/SKILL.md", "skills/monitor/SKILL.md", "skills/weknora/SKILL.md", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "README.md", "LICENSE", "NOTICE.md"]) if (!names.includes(required)) failures.push(`Packed artifact is missing ${required}.`);
  for (const name of names) if (/^(?:src|tests|scripts|docs\/research|overlays|node_modules|\.git)(?:\/|$)/.test(name) || /(?:^|\/)(?:\.env(?:\.|$)|.*\.state\.json$|.*\.(?:pem|key)$)/.test(name)) failures.push(`Forbidden packed path: ${name}.`);
  if (report.size > 5_000_000 || report.unpackedSize > 10_000_000) failures.push(`Packed artifact exceeds the release budget (${report.size}/${report.unpackedSize} bytes).`);
  for (const file of report.files) if (file.size > 1_000_000) failures.push(`Packed file ${file.path} exceeds 1 MB.`);
  for (const file of report.files) {
    if (!/\.(?:js|json|md)$/.test(file.path)) continue;
    const content = await readFile(resolve(root, file.path), "utf8");
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) || /\b(?:sk|fc|tvly|exa)[_-][A-Za-z0-9_-]{24,}\b/.test(content)) failures.push(`Packed file ${file.path} contains a credential-like literal.`);
  }
}
const cli = await readFile(resolve(root, packageJson.bin.arks), "utf8");
if (!cli.startsWith("#!/usr/bin/env node\n")) failures.push("The packed arks entry must retain its Node shebang.");
if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Package verification passed: ${report.files.length} files, ${report.size} packed bytes, no runtime install scripts.\n`);
}
function npmCommand() { return process.platform === "win32" ? "npm.cmd" : "npm"; }
