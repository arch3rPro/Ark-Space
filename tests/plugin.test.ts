import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface CodexPlugin {
  name: string;
  version: string;
  skills: string;
  interface: {
    composerIcon: string;
    logo: string;
    brandColor: string;
    displayName: string;
    shortDescription: string;
    longDescription: string;
    defaultPrompt: string[];
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

  it("keeps Codex listing text and starter prompts within official limits", async () => {
    const { interface: listing } = await jsonFile<CodexPlugin>(".codex-plugin/plugin.json");
    expect(listing.displayName.trim().length).toBeGreaterThan(0);
    expect(listing.displayName.length).toBeLessThanOrEqual(30);
    expect(listing.shortDescription.trim().length).toBeGreaterThan(0);
    expect(listing.shortDescription.length).toBeLessThanOrEqual(30);
    expect(listing.longDescription.trim().length).toBeGreaterThan(0);
    expect(listing.longDescription.length).toBeLessThanOrEqual(4000);
    expect(listing.defaultPrompt.length).toBe(3);
    expect(new Set(listing.defaultPrompt).size).toBe(listing.defaultPrompt.length);
    for (const prompt of listing.defaultPrompt) {
      expect(prompt.trim().length).toBeGreaterThan(0);
      expect(prompt.length).toBeLessThanOrEqual(128);
    }
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
