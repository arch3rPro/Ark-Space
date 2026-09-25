import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeWebSearch } from "../src/capabilities/web-search.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { resolveWebSearchInput } from "../src/protocol/schema.js";
import type { WebSearchProvider } from "../src/providers/contracts.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("web.search capability", () => {
  it("falls back from a network failure and preserves attempt evidence", async () => {
    const statePath = await temporaryStatePath();
    const exa: WebSearchProvider = {
      id: "exa",
      async search() {
        throw new ProviderError("Exa request failed before receiving a response.", { kind: "network" });
      },
    };
    const tavily: WebSearchProvider = {
      id: "tavily",
      async search(request) {
        return { query: request.input.query, results: [{ title: "Result", url: "https://example.com", snippet: "ok" }] };
      },
    };

    const result = await executeWebSearch(resolveWebSearchInput({ query: "agent skills" }), {
      config: defaultConfig(),
      statePath,
      providers: new Map([
        ["exa", exa],
        ["tavily", tavily],
      ]),
      environment: { EXA_API_KEY: "exa-secret", TAVILY_API_KEY: "tavily-secret" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.provider).toBe("tavily");
    expect(result.attempts).toEqual([
      expect.objectContaining({ provider: "exa", ok: false, errorKind: "network" }),
      expect.objectContaining({ provider: "tavily", ok: true }),
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rotates to the second key after a rate limit", async () => {
    const statePath = await temporaryStatePath();
    const config = defaultConfig();
    config.providerOrder = ["exa"];
    config.providers.exa!.keyRefs = ["env:EXA_API_KEY_1", "env:EXA_API_KEY_2"];
    const seen: string[] = [];
    const exa: WebSearchProvider = {
      id: "exa",
      async search(request) {
        seen.push(request.apiKey);
        if (request.apiKey === "first") {
          throw new ProviderError("Exa request failed with HTTP 429.", { kind: "rate-limit", status: 429 });
        }
        return { query: request.input.query, results: [] };
      },
    };

    const result = await executeWebSearch(resolveWebSearchInput({ query: "agent skills" }), {
      config,
      statePath,
      providers: new Map([["exa", exa]]),
      environment: { EXA_API_KEY_1: "first", EXA_API_KEY_2: "second" },
    });

    expect(result.ok).toBe(true);
    expect(seen).toEqual(["first", "second"]);
    expect(result.attempts).toHaveLength(2);
  });

  it.each([
    ["network", true],
    ["quota", true],
    ["invalid-request", false],
    ["invalid-response", false],
  ] as const)("uses explicit fallbackOn policy for %s", async (kind, shouldFallback) => {
    const statePath = await temporaryStatePath();
    const config = defaultConfig();
    config.providers.exa!.fallbackOn = shouldFallback ? [kind] : ["network"];
    let tavilyCalled = false;
    const exa: WebSearchProvider = {
      id: "exa",
      async search() {
        throw new ProviderError(`fixture ${kind}`, { kind });
      },
    };
    const tavily: WebSearchProvider = {
      id: "tavily",
      async search(request) {
        tavilyCalled = true;
        return { query: request.input.query, results: [] };
      },
    };

    const result = await executeWebSearch(resolveWebSearchInput({ query: "agent skills" }), {
      config,
      statePath,
      providers: new Map([["exa", exa], ["tavily", tavily]]),
      environment: { EXA_API_KEY: "exa-secret", TAVILY_API_KEY: "tavily-secret" },
    });

    expect(tavilyCalled).toBe(shouldFallback);
    expect(result.ok).toBe(shouldFallback);
    expect(result.attempts[0]).toMatchObject({ provider: "exa", errorKind: kind });
  });

  it("does not fall back for an invalid request", async () => {
    const statePath = await temporaryStatePath();
    let tavilyCalled = false;
    const exa: WebSearchProvider = {
      id: "exa",
      async search() {
        throw new ProviderError("Bad request.", { kind: "invalid-request", status: 400 });
      },
    };
    const tavily: WebSearchProvider = {
      id: "tavily",
      async search() {
        tavilyCalled = true;
        return { query: "", results: [] };
      },
    };

    const result = await executeWebSearch(resolveWebSearchInput({ query: "agent skills" }), {
      config: defaultConfig(),
      statePath,
      providers: new Map([
        ["exa", exa],
        ["tavily", tavily],
      ]),
      environment: { EXA_API_KEY: "exa-secret", TAVILY_API_KEY: "tavily-secret" },
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
    expect(tavilyCalled).toBe(false);
  });

  it("strictly fails an explicitly selected provider", async () => {
    const statePath = await temporaryStatePath();
    let tavilyCalled = false;
    const exa: WebSearchProvider = {
      id: "exa",
      async search() {
        throw new ProviderError("Exa is unavailable.", { kind: "network" });
      },
    };
    const tavily: WebSearchProvider = {
      id: "tavily",
      async search() {
        tavilyCalled = true;
        return { query: "agent skills", results: [] };
      },
    };

    const result = await executeWebSearch(resolveWebSearchInput({ query: "agent skills", provider: "exa" }), {
      config: defaultConfig(),
      statePath,
      providers: new Map([["exa", exa], ["tavily", tavily]]),
      environment: { EXA_API_KEY: "exa-secret", TAVILY_API_KEY: "tavily-secret" },
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
    expect(tavilyCalled).toBe(false);
    expect(result.attempts).toHaveLength(1);
  });
});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-web-search-"));
  directories.push(directory);
  return join(directory, "state.json");
}
