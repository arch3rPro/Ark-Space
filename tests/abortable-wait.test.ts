import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { awaitWithAbort } from "../src/capabilities/abortable.js";
import { executeWithProviders } from "../src/capabilities/provider-execution.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { defaultConfig } from "../src/config/schema.js";

async function statePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "arkspace-abortable-")), "state.json");
}

describe("abortable provider waits", () => {
  it("returns at the execution deadline when a provider never settles", async () => {
    const started = Date.now();
    const result = await executeWithProviders({
      providerIds: ["exa"],
      timeoutMs: 25,
      context: {
        config: defaultConfig(),
        statePath: await statePath(),
        environment: { EXA_API_KEY: "test-secret" },
      },
      invoke: async () => new Promise<never>(() => undefined),
    });

    expect(Date.now() - started).toBeLessThan(250);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("transient");
      expect(result.error.safeToRetry).toBe(false);
      expect(result.attempts[0]).toMatchObject({
        provider: "exa",
        ok: false,
        errorKind: "transient",
        safeToRetry: false,
      });
      // The detached operation has not confirmed teardown. Absence of cleanup
      // evidence is intentional; it must not be reported as successful cleanup.
      expect(result.attempts[0]?.cleanup).toBeUndefined();
    }
  });

  it("preserves cleanup evidence when cancellation settles the provider", async () => {
    const result = await executeWithProviders({
      providerIds: ["firecrawl"],
      timeoutMs: 25,
      context: {
        config: defaultConfig(),
        statePath: await statePath(),
        environment: { FIRECRAWL_API_KEY: "test-secret" },
      },
      invoke: (_provider, _key, _baseUrl, signal) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new ProviderError("cancelled", {
          kind: "transient",
          safeToRetry: false,
          cleanup: { resource: "crawl-job", attempted: true, ok: false },
        })), { once: true });
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.attempts[0]?.cleanup).toEqual({ resource: "crawl-job", attempted: true, ok: false });
  });

  it("preserves independently reported cleanup evidence", async () => {
    const controller = new AbortController();
    const operation = new Promise<string>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve("finished"), { once: true });
    });
    controller.abort();

    await expect(awaitWithAbort(operation, controller.signal)).rejects.toMatchObject({
      kind: "transient",
    });
    await expect(operation).resolves.toBe("finished");
  });
});
