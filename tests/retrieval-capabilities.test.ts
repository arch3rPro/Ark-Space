import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeCodeContext } from "../src/capabilities/code-context.js";
import { executeWebExtract } from "../src/capabilities/web-extract.js";
import { executeWebRelated } from "../src/capabilities/web-related.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { resolveCodeContextInput, resolveWebExtractInput, resolveWebRelatedInput } from "../src/protocol/schema.js";
import type { ExtractJobId } from "../src/protocol/types.js";
import type { CodeContextProvider, WebExtractProvider, WebRelatedProvider } from "../src/providers/contracts.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("related, context, and extract capabilities", () => {
  it("rotates Exa credentials for web.related without exposing either key", async () => {
    const statePath = await temporaryStatePath();
    const seenKeys: string[] = [];
    const provider: WebRelatedProvider = {
      id: "exa",
      async related(request) {
        seenKeys.push(request.apiKey);
        if (request.apiKey === "bad-key") throw new ProviderError("Exa request failed with HTTP 401.", { kind: "auth" });
        return { url: request.input.url, results: [] };
      },
    };
    const config = defaultConfig();
    config.providers.exa!.keyRefs = ["env:EXA_BAD", "env:EXA_GOOD"];

    const result = await executeWebRelated(resolveWebRelatedInput({ url: "https://example.com" }), {
      config,
      statePath,
      providers: new Map([["exa", provider]]),
      environment: { EXA_BAD: "bad-key", EXA_GOOD: "good-key" },
    });

    expect(result.ok).toBe(true);
    expect(seenKeys).toEqual(["bad-key", "good-key"]);
    expect(JSON.stringify(result)).not.toMatch(/bad-key|good-key/);
  });

  it("returns Exa Code Context through the shared execution envelope", async () => {
    const statePath = await temporaryStatePath();
    const provider: CodeContextProvider = {
      id: "exa",
      async context(request) {
        return { query: request.input.query, response: "context with https://example.com/source" };
      },
    };

    const result = await executeCodeContext(resolveCodeContextInput({ query: "SDK usage" }), {
      config: defaultConfig(),
      statePath,
      providers: new Map([["exa", provider]]),
      environment: { EXA_API_KEY: "exa-secret" },
    });

    expect(result).toMatchObject({ ok: true, capability: "code.context", provider: "exa" });
    expect(JSON.stringify(result)).not.toContain("exa-secret");
  });

  it("does not duplicate a possibly-running Firecrawl extract job", async () => {
    const statePath = await temporaryStatePath();
    let calls = 0;
    const provider: WebExtractProvider = {
      id: "firecrawl",
      async extract() {
        calls += 1;
        throw new ProviderError("Firecrawl status request failed.", {
          kind: "transient",
          safeToRetry: false,
          remoteJob: {
            resource: "extract-job",
            jobId: "job-existing" as ExtractJobId,
            state: "possibly-running",
          },
        });
      },
    };
    const config = defaultConfig();
    config.providers.firecrawl!.keyRefs = ["env:FIRECRAWL_ONE", "env:FIRECRAWL_TWO"];

    const result = await executeWebExtract(
      resolveWebExtractInput({
        urls: ["https://example.com/pricing"],
        prompt: "Extract plans",
        schema: { type: "object" },
      }),
      {
        config,
        statePath,
        providers: new Map([["firecrawl", provider]]),
        environment: { FIRECRAWL_ONE: "first-secret", FIRECRAWL_TWO: "second-secret" },
      },
    );

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: { retryable: false },
      attempts: [{ retryable: false, safeToRetry: false, remoteJob: { jobId: "job-existing" } }],
      warnings: ["Remote extract job job-existing may still be running; do not submit a duplicate request."],
    });
    expect(JSON.stringify(result)).not.toMatch(/first-secret|second-secret/);
  });
});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-retrieval-"));
  directories.push(directory);
  return join(directory, "state.json");
}
