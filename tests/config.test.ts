import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { addEnvironmentKey, initializeConfig } from "../src/config/store.js";
import { ArkSpaceConfigSchema } from "../src/config/schema.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("configuration evolution", () => {
  it("accepts per-capability enablement and distinct MCP/CLI names", () => {
    const config = ArkSpaceConfigSchema.parse({
      version: 1,
      providerOrder: ["exa"],
      providers: { exa: { baseUrl: "https://api.exa.ai", keyRefs: [] } },
      tools: { "web.search": { enabled: false, mcpName: "search_web", cliName: "search" } },
    });
    expect(config.tools["web.search"]).toEqual({ enabled: false, mcpName: "search_web", cliName: "search" });
  });

  it("rejects invalid tool names", () => {
    expect(() => ArkSpaceConfigSchema.parse({
      version: 1,
      providerOrder: ["exa"],
      providers: { exa: { baseUrl: "https://api.exa.ai", keyRefs: [] } },
      tools: { "web.search": { mcpName: "not valid" } },
    })).toThrow();
  });
  it("adds new Provider defaults without replacing existing key references", async () => {
    const path = await configPath();
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        providerOrder: ["exa", "tavily"],
        providers: {
          exa: { baseUrl: "https://api.exa.ai", keyRefs: ["env:EXA_CUSTOM"] },
          tavily: { baseUrl: "https://api.tavily.com", keyRefs: ["env:TAVILY_API_KEY"] },
        },
      }),
    );

    const config = await initializeConfig(path);

    expect(config.providers.exa?.keyRefs).toEqual(["env:EXA_CUSTOM"]);
    expect(config.providers.firecrawl?.keyRefs).toEqual(["env:FIRECRAWL_API_KEY"]);
    expect(config.providerOrder).toEqual(["exa", "tavily", "firecrawl"]);
    expect(config.execution).toEqual({
      crawlPollIntervalMs: 1_000,
      extractPollIntervalMs: 1_000,
      researchPollIntervalMs: 2_000,
      cleanupTimeoutMs: 5_000,
    });
    expect(await readFile(path, "utf8")).not.toContain("secret");
  });

  it("can add a Firecrawl key reference to an older configuration", async () => {
    const path = await configPath();
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        providerOrder: ["exa"],
        providers: { exa: { baseUrl: "https://api.exa.ai", keyRefs: ["env:EXA_API_KEY"] } },
      }),
    );

    const config = await addEnvironmentKey(path, "firecrawl", "FIRECRAWL_API_KEY_2");

    expect(config.providers.firecrawl?.keyRefs).toEqual(["env:FIRECRAWL_API_KEY", "env:FIRECRAWL_API_KEY_2"]);
  });
});

async function configPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-config-"));
  directories.push(directory);
  return join(directory, "config.json");
}
