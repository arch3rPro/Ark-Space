import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface CodexPlugin {
  name: string;
  version: string;
  skills: string;
  homepage: string;
  repository: string;
  interface: {
    composerIcon: string;
    logo: string;
    brandColor: string;
    displayName: string;
    shortDescription: string;
    longDescription: string;
    defaultPrompt: string[];
    websiteURL: string;
    capabilities: string[];
  };
}

interface Marketplace {
  plugins: Array<{ name: string; source: { source: string; path: string } }>;
}

describe("direct-source plugin metadata", () => {
  it("points Codex at the canonical root Skill tree", async () => {
    const plugin = await jsonFile<CodexPlugin>(".codex-plugin/plugin.json");
    const marketplace = await jsonFile<Marketplace>(".agents/plugins/marketplace.json");

    expect(plugin.name).toBe("arkspace");
    expect(plugin.skills).toBe("./skills/");
    expect((await stat(resolve(plugin.skills))).isDirectory()).toBe(true);
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({ name: "arkspace", source: { source: "local", path: "./" } }),
    );
  });

  it("preserves the legacy Codex listing copy and bounded starter prompts", async () => {
    const { interface: listing } = await jsonFile<CodexPlugin>(".codex-plugin/plugin.json");
    expect(listing.displayName.trim().length).toBeGreaterThan(0);
    expect(listing.displayName.length).toBeLessThanOrEqual(30);
    expect(listing.shortDescription.trim().length).toBeGreaterThan(0);
    expect(listing.shortDescription).toBe("Reusable provider-aware agent skills");
    expect(listing.longDescription).toBe("Use ArkSpace for provider-aware Web retrieval, structured extraction, cited Research, and implementation context through a stable local CLI contract.");
    expect(listing.longDescription.trim().length).toBeGreaterThan(0);
    expect(listing.longDescription.length).toBeLessThanOrEqual(4000);
    expect(listing.defaultPrompt.length).toBe(3);
    expect(new Set(listing.defaultPrompt).size).toBe(listing.defaultPrompt.length);
    for (const prompt of listing.defaultPrompt) {
      expect(prompt.trim().length).toBeGreaterThan(0);
      expect(prompt.length).toBeLessThanOrEqual(128);
    }
  });

  it("exposes a project website and concrete capability labels in Codex", async () => {
    const plugin = await jsonFile<CodexPlugin>(".codex-plugin/plugin.json");
    const website = "https://github.com/arch3rPro/Ark-Space";
    expect(plugin.interface.websiteURL).toBe(website);
    expect(plugin.homepage).toBe(website);
    expect(plugin.repository).toBe(website);
    expect(plugin.interface.capabilities).toEqual([
      "Web search and extraction",
      "Cited research",
      "Browser interaction",
      "Recurring monitoring",
      "WeKnora knowledge bases",
      "GitHub repository analysis",
    ]);
  });

  it("provides a square, self-contained Codex icon for both display surfaces", async () => {
    const plugin = await jsonFile<CodexPlugin>(".codex-plugin/plugin.json");
    expect(plugin.interface.composerIcon).toBe("./assets/plugin/icon.svg");
    expect(plugin.interface.logo).toBe(plugin.interface.composerIcon);
    const icon = await readFile(resolve(plugin.interface.logo), "utf8");
    expect(icon).toContain('width="256" height="256" viewBox="0 0 256 256"');
    expect(icon).toContain(`<title id="title">${plugin.interface.displayName}</title>`);
    expect(icon).toContain(`fill="${plugin.interface.brandColor}"`);
    expect(icon).not.toMatch(/<script|<foreignObject|\b(?:href|on\w+)\s*=/i);
    expect(Buffer.byteLength(icon)).toBeLessThan(5 * 1024 * 1024);
  });

  it.each([
    ["browser", "chrome", false],
    ["gh-repo", "github", true],
    ["monitor", "azure-network-watcher", false],
    ["research", "azure-cognitive-search", true],
    ["web", "azure-website-staging", true],
    ["weknora", "knowledgebase", true],
  ] as const)(
    "keeps %s Codex display metadata, icons, invocation policy, and references usable outside the repository",
    async (name, slug, implicit) => {
      const isolated = await mkdtemp(resolve(tmpdir(), "arkspace-skill-icon-"));
      try {
        await cp(resolve("skills", name), isolated, { recursive: true });
        const metadata = await readFile(resolve(isolated, "agents/openai.yaml"), "utf8");
        const display = metadata.match(/^interface:\n((?:  .+\n)+)/m)?.[1] ?? "";
        for (const [field, maxLength] of [
          ["display_name", 64],
          ["short_description", 64],
          ["default_prompt", 256],
        ] as const) {
          const matches = [...display.matchAll(new RegExp(
            `^  ${field}: (?:"([^"\\n]+)"$|>-\\n((?:    [^\\n]+\\n)+))`, "gm",
          ))];
          expect(matches).toHaveLength(1);
          const value = matches[0]?.[1] ?? matches[0]?.[2]?.trim().replace(/\s+/g, " ") ?? "";
          expect(value.trim().length).toBeGreaterThan(0);
          expect(value).toBe(value.trim());
          expect(value.length).toBeLessThanOrEqual(maxLength);
          if (field === "default_prompt") {
            expect(value.match(/\$[a-z][a-z-]*/g)).toEqual([`$${name}`]);
          }
        }
        expect(metadata).toContain('  icon_small: "./assets/icon.svg"');
        expect(metadata).toContain('  icon_large: "./assets/icon.svg"');
        expect(metadata).toContain(`policy:\n  allow_implicit_invocation: ${implicit}`);
        const icon = await readFile(resolve(isolated, "assets/icon.svg"), "utf8");
        expect(icon).toMatch(/<svg\b/);
        expect(icon).toMatch(/viewBox="[^"]+"/);
        expect(icon).not.toMatch(/<script|<foreignObject|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)/i);
        const notice = await readFile(resolve(isolated, "assets/NOTICE.md"), "utf8");
        expect(notice).toContain(`https://thesvg.org/icon/${slug}`);
        expect(notice).toContain("a7c5ddd3f529accdf86519cc8fb96cb76cef4efd");
        expect(notice).toContain("License");
        if (name === "research") {
          const skill = await readFile(resolve(isolated, "SKILL.md"), "utf8");
          expect(skill).toMatch(/\[[^\]\n]+\]\((?:\.\/)?references\/evidence-review\.md\)/);
          expect((await stat(resolve(isolated, "references/evidence-review.md"))).isFile()).toBe(true);
        }
        if (name === "gh-repo") {
          expect(icon).toContain("@media (prefers-color-scheme: dark)");
          expect(icon).toContain(await readFile(resolve(isolated, "assets/github-light.svg"), "utf8"));
          expect(icon).toContain(await readFile(resolve(isolated, "assets/github-dark.svg"), "utf8"));
        }
      } finally {
        await rm(isolated, { recursive: true, force: true });
      }
    },
  );

  it("keeps package and host manifest versions aligned", async () => {
    const packageJson = await jsonFile<{ version: string }>("package.json");
    const codex = await jsonFile<{ version: string }>(".codex-plugin/plugin.json");
    const claude = await jsonFile<{ version: string }>(".claude-plugin/plugin.json");
    const claudeMarketplace = await jsonFile<{ plugins: Array<{ version: string }> }>(
      ".claude-plugin/marketplace.json",
    );

    expect(codex.version).toBe(packageJson.version);
    expect(claude.version).toBe(packageJson.version);
    expect(claudeMarketplace.plugins[0]?.version).toBe(packageJson.version);
  });

  it("keeps the web Skill and disclosed references on the installed CLI boundary", async () => {
    const paths = [
      "skills/web/SKILL.md",
      "skills/web/references/search.md",
      "skills/web/references/fetch.md",
      "skills/web/references/site.md",
      "skills/web/references/extract.md",
      "skills/web/references/code-context.md",
      "skills/research/SKILL.md",
    ];
    const documents = await Promise.all(paths.map((path) => readFile(resolve(path), "utf8")));
    const combined = documents.join("\n");

    expect(documents[0]).toContain("references/search.md");
    for (const capability of [
      "web.search",
      "web.related",
      "web.fetch",
      "web.map",
      "web.crawl",
      "web.extract",
      "code.context",
      "research.run",
    ]) {
      expect(combined).toContain(`arks invoke ${capability}`);
    }
    expect(combined).not.toMatch(/\.\.\/|provider-manager|arkspace_runtime|scripts\/arkspace/);
  });
});

async function jsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as T;
}
