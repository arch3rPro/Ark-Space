import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});

afterEach(async () => {
  for (const call of vi.mocked(mkdtemp).mock.results) {
    if (call.type === "return") await rm(await call.value, { recursive: true, force: true });
  }
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

import { testSetupKeys } from "../src/cli/setup-key-tests.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { keyIdFor } from "../src/key-pool/key-pool.js";
import { emptyState } from "../src/state/schema.js";
import type { ProviderSearchRequest, WebSearchProvider } from "../src/providers/contracts.js";

function twoKeyConfig() {
  const config = defaultConfig();
  config.providers.exa!.keyRefs = ["env:KEY_A", "env:KEY_B"];
  return config;
}

function registry(search: WebSearchProvider["search"]) {
  return new Map([["exa" as const, { id: "exa" as const, search }]]);
}

const environment = { KEY_A: "synthetic-alpha", KEY_B: "synthetic-beta" };

describe("setup individual-key diagnostics", () => {
  it("tests B even when A succeeds, sequentially with the fixed bounded public request", async () => {
    const config = twoKeyConfig();
    const original = structuredClone(config);
    const requests: ProviderSearchRequest[] = [];
    let active = 0;
    const result = await testSetupKeys({ config, provider: "exa", environment,
      providers: registry(async request => {
        expect(active++).toBe(0);
        requests.push(request);
        await Promise.resolve();
        active--;
        return { query: request.input.query, results: [{ title: "raw response must not escape", url: "https://example.com", snippet: "private provider text" }] };
      }),
    });

    expect(requests.map(request => request.apiKey)).toEqual(["synthetic-alpha", "synthetic-beta"]);
    for (const request of requests) {
      expect(request.input).toMatchObject({ query: "Agent Skills documentation", provider: "exa", maxResults: 1, timeoutMs: 5_000 });
    }
    expect(result).toMatchObject({ cancelled: false, results: [
      { reference: "env:KEY_A", status: "success", attemptCount: 1 },
      { reference: "env:KEY_B", status: "success", attemptCount: 1 },
    ] });
    expect(config).toEqual(original);
    await expectTemporaryCleanup();
  });

  it.each(["auth", "rate-limit", "quota", "network"] as const)("records %s for A without retrying it or attributing B's response to A", async kind => {
    const seen: string[] = [];
    const result = await testSetupKeys({ config: twoKeyConfig(), provider: "exa", environment,
      providers: new Map([
        ["exa", { id: "exa", async search(request: ProviderSearchRequest) {
          seen.push(request.apiKey);
          if (request.apiKey === environment.KEY_A) throw new ProviderError(`unsafe message ${environment.KEY_A}`, { kind });
          return { query: "raw query", results: [] };
        } }],
        ["tavily", { id: "tavily", async search() { throw new Error("must not use another provider"); } }],
      ]),
    });
    expect(seen).toEqual(["synthetic-alpha", "synthetic-beta"]);
    expect(result).toMatchObject({ cancelled: false, results: [
      { reference: "env:KEY_A", status: "failure", errorKind: kind, attemptCount: 1 },
      { reference: "env:KEY_B", status: "success", attemptCount: 1 },
    ] });
    await expectTemporaryCleanup();
  });

  it("skips missing and unsafe effective values without network, then tests the usable reference", async () => {
    const config = twoKeyConfig();
    config.providers.exa!.keyRefs = ["env:MISSING", "env:BLANK", "env:PLACEHOLDER", "env:CONTROL", "env:KEY_A"];
    const seen: string[] = [];
    const result = await testSetupKeys({ config, provider: "exa",
      environment: { ...environment, BLANK: " ", PLACEHOLDER: "placeholder", CONTROL: "synthetic\ncontrol" },
      providers: registry(async request => { seen.push(request.apiKey); return { query: request.input.query, results: [] }; }),
    });
    expect(seen).toEqual(["synthetic-alpha"]);
    expect(result).toMatchObject({ cancelled: false, results: [
      { reference: "env:MISSING", status: "skipped", errorKind: "config", attemptCount: 0 },
      { reference: "env:BLANK", status: "skipped", errorKind: "config", attemptCount: 0 },
      { reference: "env:PLACEHOLDER", status: "skipped", errorKind: "config", attemptCount: 0 },
      { reference: "env:CONTROL", status: "skipped", errorKind: "config", attemptCount: 0 },
      { reference: "env:KEY_A", status: "success", attemptCount: 1 },
    ] });
  });

  it("never overrides a disabled provider to send diagnostic requests", async () => {
    const config = twoKeyConfig(); config.providers.exa!.enabled = false;
    const search = vi.fn(async request => ({ query: request.input.query, results: [] }));
    const result = await testSetupKeys({ config, provider: "exa", environment, providers: registry(search) });
    expect(search).not.toHaveBeenCalled(); expect(result.results).toHaveLength(2);
    expect(result.results.every(row => row.status === "failure" && row.attemptCount === 0)).toBe(true);
    expect(config.providers.exa!.enabled).toBe(false);
  });
  it("tests disabled/cooling references with diagnostic consent without changing user state or persisting values", async () => {
    const home = await mkdtemp(join(tmpdir(), "arkspace-user-state-"));
    vi.stubEnv("ARKSPACE_HOME", home);
    const config = twoKeyConfig();
    config.providers.exa!.enabled = true;
    const state = emptyState();
    state.providers.exa = { cursor: 37, keys: {
      [keyIdFor("exa", "env:KEY_A")]: { status: "disabled", lastFailure: "operator-disabled", consecutiveFailures: 3 },
      [keyIdFor("exa", "env:KEY_B")]: { status: "cooldown", cooldownUntil: Date.now() + 60_000, consecutiveFailures: 2 },
    } };
    const before = JSON.stringify(state);
    await writeFile(join(home, "state.json"), before);
    const seen: string[] = [];
    const result = await testSetupKeys({ config, provider: "exa", environment,
      providers: registry(async request => {
        seen.push(request.apiKey);
        const directory = await latestTemporaryDirectory();
        expect(await readdir(directory)).toEqual(["state.json"]);
        const diagnosticState = await readFile(join(directory, "state.json"), "utf8");
        expect(diagnosticState).not.toContain("synthetic");
        expect(diagnosticState).not.toContain("KEY_A");
        throw new ProviderError("raw failure must not escape", { kind: "auth" });
      }),
    });
    expect(seen).toEqual(["synthetic-alpha", "synthetic-beta"]);
    expect(result.results.map(row => row.status)).toEqual(["failure", "failure"]);
    expect(await readFile(join(home, "state.json"), "utf8")).toBe(before);
    expect(await readdir(home)).toEqual(["state.json"]);
    expect(config.providers.exa!.enabled).toBe(true);
    await expectTemporaryCleanup();
  });

  it("retains partial rows on cancellation and never starts the remaining reference", async () => {
    const config = twoKeyConfig();
    config.providers.exa!.keyRefs.push("env:KEY_C");
    const controller = new AbortController();
    const seen: string[] = [];
    const result = await testSetupKeys({ config, provider: "exa", environment: { ...environment, KEY_C: "synthetic-gamma" }, signal: controller.signal,
      providers: registry(async request => {
        seen.push(request.apiKey);
        if (request.apiKey === environment.KEY_B) {
          controller.abort(new Error("private abort reason"));
          return new Promise(() => {}); // Deliberately uncooperative external provider.
        }
        return { query: request.input.query, results: [] };
      }),
    });
    expect(seen).toEqual(["synthetic-alpha", "synthetic-beta"]);
    expect(result).toMatchObject({ cancelled: true, results: [
      { reference: "env:KEY_A", status: "success", attemptCount: 1 },
      { reference: "env:KEY_B", status: "cancelled", errorKind: "transient", attemptCount: 1 },
      { reference: "env:KEY_C", status: "not-tested", attemptCount: 0 },
    ] });
    await expectTemporaryCleanup();
  });

  it("announces only usable enabled targets before requests and completes all cancellation rows with numeric timing", async () => {
    const config = twoKeyConfig(); config.providers.exa!.keyRefs.unshift("env:MISSING");
    const controller = new AbortController(); const events: string[] = [];
    const result = await testSetupKeys({ config, provider: "exa", environment, signal: controller.signal,
      onStart(reference, index, total) { events.push(`start:${reference}:${index}/${total}`); },
      onResult(row, completed, total) { events.push(`done:${row.reference}:${completed}/${total}`); },
      providers: registry(async request => { events.push(`request:${request.apiKey === environment.KEY_A ? "A" : "B"}`); controller.abort(); return { query: "unsafe text", results: [] }; }),
    });
    expect(events).toEqual(["done:env:MISSING:1/3", "start:env:KEY_A:2/3", "request:A", "done:env:KEY_A:2/3", "done:env:KEY_B:3/3"]);
    expect(result.results.map(row => row.status)).toEqual(["skipped", "cancelled", "not-tested"]);
    for (const row of result.results) { expect(Number.isFinite(row.completedAt)).toBe(true); expect(row.durationMs).toBeGreaterThanOrEqual(0); }
    expect(JSON.stringify(result)).not.toMatch(/synthetic|unsafe/);
  });

  it("reports safe progress and uses a stable reference snapshot even if the caller changes its config", async () => {
    const config = twoKeyConfig();
    const progress: unknown[] = [];
    const result = await testSetupKeys({ config, provider: "exa", environment,
      providers: registry(async request => ({ query: request.input.query, results: [] })),
      onResult(row, completed, total) {
        progress.push({ ...row, completed, total });
        config.providers.exa!.keyRefs.length = 0;
        row.status = "failure";
      },
    });
    expect(progress).toMatchObject([
      { reference: "env:KEY_A", status: "success", attemptCount: 1, completed: 1, total: 2 },
      { reference: "env:KEY_B", status: "success", attemptCount: 1, completed: 2, total: 2 },
    ]);
    expect(result.results.map(row => row.status)).toEqual(["success", "success"]);
  });

  it("bounds an uncooperative provider to five seconds per reference and continues to the next key", async () => {
    const seen: ProviderSearchRequest[] = [];
    const result = await testSetupKeys({ config: twoKeyConfig(), provider: "exa", environment,
      providers: registry(async request => {
        seen.push(request);
        if (request.apiKey === environment.KEY_A) return new Promise(() => {});
        return { query: request.input.query, results: [] };
      }),
    });
    expect(seen.map(request => request.apiKey)).toEqual(["synthetic-alpha", "synthetic-beta"]);
    expect(seen[0]!.signal!.aborted).toBe(true);
    expect(result).toMatchObject({ cancelled: false, results: [
      { reference: "env:KEY_A", status: "failure", errorKind: "transient", attemptCount: 1 },
      { reference: "env:KEY_B", status: "success", attemptCount: 1 },
    ] });
    await expectTemporaryCleanup();
  }, 10_000);

  it("does not start any request when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const search = vi.fn<WebSearchProvider["search"]>();
    const result = await testSetupKeys({ config: twoKeyConfig(), provider: "exa", environment, providers: registry(search), signal: controller.signal });
    expect(search).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cancelled: true, results: [
      { reference: "env:KEY_A", status: "not-tested", attemptCount: 0 },
      { reference: "env:KEY_B", status: "not-tested", attemptCount: 0 },
    ] });
    await expectTemporaryCleanup();
  });
});

async function latestTemporaryDirectory(): Promise<string> {
  return vi.mocked(mkdtemp).mock.results.at(-1)!.value;
}

async function expectTemporaryCleanup() {
  await expect(access(await latestTemporaryDirectory())).rejects.toMatchObject({ code: "ENOENT" });
}
