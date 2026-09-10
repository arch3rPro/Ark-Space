import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

interface ActivationExamples {
  positive: string[];
  negative: string[];
}

type ActivationFixtures = Record<string, ActivationExamples>;

const skillsRoot = resolve("skills");

describe("canonical Skill guidance", () => {
  it("declares compatibility and keeps activation examples complete", async () => {
    const skillNames = await canonicalSkillNames();
    const fixtures = JSON.parse(
      await readFile(resolve("tests/fixtures/skill-activation.json"), "utf8"),
    ) as ActivationFixtures;

    expect(Object.keys(fixtures).sort()).toEqual(skillNames);
    for (const skillName of skillNames) {
      const content = await readFile(
        resolve(skillsRoot, skillName, "SKILL.md"),
        "utf8",
      );
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
      expect(frontmatter, skillName).toMatch(/^compatibility:\s*\S.+$/m);

      const examples = fixtures[skillName];
      expect(
        examples?.positive.length,
        `${skillName} positive examples`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        examples?.negative.length,
        `${skillName} negative examples`,
      ).toBeGreaterThanOrEqual(3);
      const prompts = [
        ...(examples?.positive ?? []),
        ...(examples?.negative ?? []),
      ];
      expect(new Set(prompts).size, `${skillName} duplicate examples`).toBe(
        prompts.length,
      );
      for (const prompt of prompts)
        expect(prompt.trim().length, skillName).toBeGreaterThanOrEqual(20);
    }
  });

  it("keeps every published Skill self-contained when copied without siblings", async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "arkspace-isolated-skills-"),
    );
    try {
      for (const skillName of await canonicalSkillNames()) {
        const target = resolve(temporary, skillName);
        await cp(resolve(skillsRoot, skillName), target, { recursive: true });
        const markdownFiles = await walkMarkdown(target);
        expect(markdownFiles.map((path) => relative(target, path))).toContain(
          "SKILL.md",
        );

        for (const path of markdownFiles) {
          const content = await readFile(path, "utf8");
          for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
            const link = match[1];
            if (!link || /^(?:https?:|mailto:|#)/.test(link)) continue;
            const localPath = link.split("#", 1)[0];
            if (!localPath) continue;
            const resolved = resolve(
              dirname(path),
              decodeURIComponent(localPath),
            );
            expect(
              resolved === target || resolved.startsWith(`${target}${sep}`),
              `${relative(target, path)} escapes its Skill directory through ${link}`,
            ).toBe(true);
            expect(
              (await stat(resolved)).isFile(),
              `${relative(target, path)} links to ${link}`,
            ).toBe(true);
          }
        }
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});

async function canonicalSkillNames(): Promise<string[]> {
  return (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function walkMarkdown(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walkMarkdown(path)));
    else if (entry.isFile() && path.endsWith(".md")) paths.push(path);
  }
  return paths;
}
