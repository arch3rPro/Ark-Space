import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const license = await readFile(resolve(root, "LICENSE"), "utf8");
let identity;
try { identity = JSON.parse(await readFile(resolve(root, "release", "identity.json"), "utf8")); } catch { failures.push("release/identity.json is missing; the owner must confirm npm package ownership, repository URL, and copyright holder."); }
if (packageJson.private !== false) failures.push("package.json private must be explicitly set to false only after release authorization.");
for (const field of ["repository", "homepage", "bugs", "author"]) if (!packageJson[field]) failures.push(`package.json ${field} metadata is missing.`);
if (packageJson.publishConfig?.access !== "public") failures.push("Scoped npm publication requires publishConfig.access=public.");
if (identity) {
  for (const field of ["npmPackage", "repositoryUrl", "copyrightHolder"]) if (typeof identity[field] !== "string" || !identity[field].trim()) failures.push(`release/identity.json ${field} is missing.`);
  if (identity.npmPackage !== packageJson.name) failures.push("Confirmed npm package name does not match package.json.");
  if (packageJson.repository?.url && identity.repositoryUrl !== packageJson.repository.url) failures.push("Confirmed repository URL does not match package.json.");
  if (!license.includes(identity.copyrightHolder)) failures.push("LICENSE does not name the confirmed copyright holder.");
}
if (license.includes("Steph Ango") || license.includes("@kepano")) failures.push("LICENSE still contains the legacy project's copyright identity.");
let status = "";
try { status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }); } catch { failures.push("Could not inspect Git release state."); }
if (status.trim()) failures.push("Git worktree is not clean; release only a reviewed commit.");
if (failures.length) {
  process.stderr.write(`Release gate is closed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Release identity, legal metadata, package metadata, and Git state are ready. This check does not publish or tag.\n");
}
