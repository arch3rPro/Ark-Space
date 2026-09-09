import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface CodexPlugin {
  name: string;
  version: string;
  skills: string;
}

interface Marketplace {
  plugins: Array<{ name: string; source: { source: string; url: string } }>;
}

describe("direct-source plugin metadata", () => {
  it("points Codex at the canonical root Skill tree", async () => {
    const plugin = await jsonFile<CodexPlugin>(".codex-plugin/plugin.json");
    const marketplace = await jsonFile<Marketplace>(".agents/plugins/marketplace.json");

    expect(plugin.name).toBe("arkspace");
    expect(plugin.skills).toBe("./skills/");
    expect((await stat(resolve(plugin.skills))).isDirectory()).toBe(true);
    expect(marketplace.plugins).toContainEqual(
      expect.objectContaining({ name: "arkspace", source: { source: "url", url: "./" } }),
    );
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
