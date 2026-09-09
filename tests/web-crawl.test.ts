import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeWebCrawl } from "../src/capabilities/web-crawl.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { resolveWebCrawlInput } from "../src/protocol/schema.js";
import type { WebCrawlProvider } from "../src/providers/contracts.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("web.crawl capability", () => {
  it("reports unconfirmed cleanup and suppresses duplicate fallback", async () => {
    const statePath = await temporaryStatePath();
    const firecrawl: WebCrawlProvider = {
      id: "firecrawl",
      async crawl() {
        throw new ProviderError("Firecrawl crawl status failed.", {
          kind: "transient",
          cleanup: { resource: "crawl-job", attempted: true, ok: false },
        });
      },
    };
    const tavily: WebCrawlProvider = {
      id: "tavily",
      async crawl() {
        return {
          baseUrl: "https://docs.example.com",
          pages: [{ url: "https://docs.example.com/start", content: "Start" }],
          failedUrls: ["https://docs.example.com/broken"],
        };
      },
    };
    const config = defaultConfig();
    config.providerOrder = ["firecrawl", "exa", "tavily"];

    const result = await executeWebCrawl(resolveWebCrawlInput({ url: "https://docs.example.com" }), {
      config,
      statePath,
      providers: new Map([
        ["firecrawl", firecrawl],
        ["tavily", tavily],
      ]),
      environment: {
        FIRECRAWL_API_KEY: "firecrawl-secret",
        EXA_API_KEY: "unused-exa-secret",
        TAVILY_API_KEY: "tavily-secret",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      capability: "web.crawl",
      error: { kind: "transient", retryable: false },
      attempts: [
        {
          provider: "firecrawl",
          ok: false,
          errorKind: "transient",
          safeToRetry: false,
          cleanup: { resource: "crawl-job", attempted: true, ok: false },
        },
      ],
      warnings: ["Remote crawl job cancellation could not be confirmed."],
    });
    expect(result.attempts.some((attempt) => attempt.provider === "tavily" || attempt.provider === "exa")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-web-crawl-"));
  directories.push(directory);
  return join(directory, "state.json");
}
