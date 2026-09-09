import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeWebFetch } from "../src/capabilities/web-fetch.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { resolveWebFetchInput } from "../src/protocol/schema.js";
import type { WebFetchProvider } from "../src/providers/contracts.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("web.fetch capability", () => {
  it("falls back and reports failed URLs as warnings without discarding successful content", async () => {
    const statePath = await temporaryStatePath();
    const exa: WebFetchProvider = {
      id: "exa",
      async fetch() {
        throw new ProviderError("Exa request failed before receiving a response.", { kind: "network" });
      },
    };
    const tavily: WebFetchProvider = {
      id: "tavily",
      async fetch() {
        return {
          results: [{ url: "https://example.com", content: "content" }],
          failedUrls: ["https://example.com/missing"],
        };
      },
    };

    const result = await executeWebFetch(resolveWebFetchInput({ urls: ["https://example.com"] }), {
      config: defaultConfig(),
      statePath,
      providers: new Map([
        ["exa", exa],
        ["tavily", tavily],
      ]),
      environment: { EXA_API_KEY: "exa-secret", TAVILY_API_KEY: "tavily-secret" },
    });

    expect(result).toMatchObject({
      ok: true,
      capability: "web.fetch",
      provider: "tavily",
      warnings: ["Provider could not fetch https://example.com/missing"],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-web-fetch-"));
  directories.push(directory);
  return join(directory, "state.json");
}
