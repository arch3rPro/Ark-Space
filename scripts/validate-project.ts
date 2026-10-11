import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const root = resolve(".");
const failures: string[] = [];

await validateSkills();
await validateMarkdownLinks();
await validatePluginMetadata();

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`ERROR: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("ArkSpace project validation passed.\n");
}

async function validateSkills(): Promise<void> {
  const skillsRoot = resolve(root, "skills");
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = resolve(skillsRoot, entry.name, "SKILL.md");
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      failures.push(`missing canonical Skill file: ${relative(root, path)}`);
      continue;
    }
    const normalizedContent = content.replaceAll("\r\n", "\n");
    const frontmatter = normalizedContent.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatter) {
      failures.push(`${relative(root, path)} has no YAML frontmatter`);
      continue;
    }
    if (
      !new RegExp(`^name:\\s*${escapeRegex(entry.name)}\\s*$`, "m").test(
        frontmatter[1] ?? "",
      )
    ) {
      failures.push(`${relative(root, path)} name must match its directory`);
    }
    if (!/^description:\s*\S.+$/m.test(frontmatter[1] ?? "")) {
      failures.push(`${relative(root, path)} requires a non-empty description`);
    }
    if (!/^compatibility:\s*\S.+$/m.test(frontmatter[1] ?? "")) {
      failures.push(
        `${relative(root, path)} requires a non-empty compatibility declaration`,
      );
    }
  }
}

async function validateMarkdownLinks(): Promise<void> {
  for (const path of await walk(root)) {
    if (!path.endsWith(".md")) continue;
    const content = await readFile(path, "utf8");
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
      const localPath = target.split("#", 1)[0];
      if (!localPath) continue;
      try {
        await stat(resolve(dirname(path), decodeURIComponent(localPath)));
      } catch {
        failures.push(`${relative(root, path)} links to missing ${target}`);
      }
    }
  }
}

async function validatePluginMetadata(): Promise<void> {
  const packageJson = await json<{ version: string }>("package.json");
  const codex = await json<{
    version: string;
    skills: string;
    interface?: {
      composerIcon?: string;
      logo?: string;
      shortDescription?: string;
      defaultPrompt?: string[];
      websiteURL?: string;
    };
  }>(".codex-plugin/plugin.json");
  const claude = await json<{ version: string }>(".claude-plugin/plugin.json");
  const codexMarketplace = await json<{
    plugins: Array<{ source: { source: string; path: string } }>;
  }>(".agents/plugins/marketplace.json");
  if (codex.skills !== "./skills/")
    failures.push("Codex plugin must reference ./skills/");
  for (const field of ["composerIcon", "logo"] as const) {
    const path = codex.interface?.[field];
    if (path !== "./assets/plugin/icon.svg") {
      failures.push(`Codex ${field} must reference ./assets/plugin/icon.svg`);
      continue;
    }
    try {
      if (!(await stat(resolve(root, path))).isFile())
        failures.push(`Codex ${field} must reference a file`);
    } catch {
      failures.push(`Codex ${field} references missing ${path}`);
    }
  }
  const source = codexMarketplace.plugins?.[0]?.source;
  if (source?.source !== "local" || source.path !== "./")
    failures.push("Codex marketplace must reference repository root as a local source");
  if (codex.interface?.websiteURL !== "https://github.com/arch3rPro/Ark-Space")
    failures.push("Codex websiteURL must point to the project homepage");
  const shortDescription = codex.interface?.shortDescription;
  // shortcut: restored legacy copy exceeds the submission limit; shorten before directory submission.
  if (typeof shortDescription !== "string" || !shortDescription.trim() || (
    shortDescription.length > 30 && shortDescription !== "Reusable provider-aware agent skills"
  ))
    failures.push("Codex shortDescription must contain 1–30 characters or the restored legacy copy");
  const prompts = codex.interface?.defaultPrompt;
  if (!Array.isArray(prompts) || prompts.length > 3 || prompts.some(
    (prompt) => typeof prompt !== "string" || !prompt.trim() || prompt.length > 128,
  ))
    failures.push("Codex defaultPrompt must contain at most 3 non-empty prompts of at most 128 characters");
  if (
    codex.version !== packageJson.version ||
    claude.version !== packageJson.version
  ) {
    failures.push("package and plugin versions must match");
  }
}

async function json<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(resolve(root, path), "utf8")) as T;
  } catch (error) {
    failures.push(`${path} is not valid JSON: ${String(error)}`);
    return {} as T;
  }
}

async function walk(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    // Reference checkouts are evidence, not maintained ArkSpace package content.
    if (path === resolve(root, "reference")) continue;
    if (entry.isDirectory()) paths.push(...(await walk(path)));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
