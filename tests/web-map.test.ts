import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeWebMap } from "../src/capabilities/web-map.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { resolveWebMapInput } from "../src/protocol/schema.js";
import type { WebMapProvider } from "../src/providers/contracts.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("web.map capability", () => {
  it("skips unsupported Providers and falls back between mapping Providers", async () => {
    const statePath = await temporaryStatePath();
    const tavily: WebMapProvider = {
      id: "tavily",
      async map() {
        throw new ProviderError("Tavily request failed before receiving a response.", { kind: "network" });
      },
    };
    const firecrawl: WebMapProvider = {
      id: "firecrawl",
      async map() {
        return {
          baseUrl: "https://docs.example.com",
          links: [{ url: "https://docs.example.com/start" }],
        };
      },
    };

    const result = await executeWebMap(resolveWebMapInput({ url: "https://docs.example.com" }), {
      config: defaultConfig(),
      statePath,
      providers: new Map([
        ["tavily", tavily],
        ["firecrawl", firecrawl],
      ]),
      environment: {
        EXA_API_KEY: "unused-exa-secret",
        TAVILY_API_KEY: "tavily-secret",
        FIRECRAWL_API_KEY: "firecrawl-secret",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      capability: "web.map",
      provider: "firecrawl",
      data: { links: [{ url: "https://docs.example.com/start" }] },
      attempts: [
        { provider: "tavily", ok: false, errorKind: "network" },
        { provider: "firecrawl", ok: true },
      ],
    });
    expect(result.attempts.some((attempt) => attempt.provider === "exa")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-web-map-"));
  directories.push(directory);
  return join(directory, "state.json");
}
