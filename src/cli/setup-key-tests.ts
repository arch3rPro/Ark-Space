import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeWebSearch } from "../capabilities/web-search.js";
import { validateCredentialValue } from "../config/credentials.js";
import type { ArkSpaceConfig } from "../config/schema.js";
import { ProviderError } from "../errors/provider-error.js";
import { resolveWebSearchInput } from "../protocol/schema.js";
import type { FailureKind } from "../protocol/types.js";
import { createSearchProviderRegistry, type SearchProviderRegistry } from "../providers/registry.js";

export interface SetupKeyTestResult {
  reference: string;
  status: "success" | "failure" | "skipped" | "cancelled" | "not-tested";
  errorKind?: FailureKind;
  attemptCount: number;
  durationMs?: number;
  completedAt?: number;
}
const safeTime = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(8_640_000_000_000_000, value)) : 0;

/** Caller must obtain explicit network consent, including testing disabled/cooling keys. */
export async function testSetupKeys(options: {
  config: ArkSpaceConfig;
  provider: "exa" | "tavily" | "firecrawl";
  environment: NodeJS.ProcessEnv;
  providers?: SearchProviderRegistry;
  signal?: AbortSignal;
  /** 1-based reference position, before dispatch; unavailable or disabled targets do not start. */
  onStart?: (reference: string, index: number, total: number) => void;
  onResult?: (row: SetupKeyTestResult, completed: number, total: number) => void;
}): Promise<{ results: SetupKeyTestResult[]; cancelled: boolean }> {
  const { provider, signal } = options;
  const config = structuredClone(options.config);
  const environment = { ...options.environment };
  const entry = config.providers[provider];
  const results: SetupKeyTestResult[] = [];
  if (!entry) return { results, cancelled: signal?.aborted ?? false };
  const references = [...entry.keyRefs];
  const providers = options.providers ?? createSearchProviderRegistry();
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "arkspace-setup-key-tests-"));
    try {
      for (const reference of references) {
        const startedAt = safeTime(Date.now());
        const value = environment[reference.slice(4)];
        let row: SetupKeyTestResult;
        if (signal?.aborted) {
          row = { reference, status: "not-tested", attemptCount: 0 };
        } else if (typeof value !== "string" || !validateCredentialValue(value)) {
          row = { reference, status: "skipped", errorKind: "config", attemptCount: 0 };
        } else {
          if (entry.enabled) options.onStart?.(reference, results.length + 1, references.length);
          const result = await executeWebSearch(resolveWebSearchInput({
            query: "Agent Skills documentation", provider, maxResults: 1, timeoutMs: 5_000,
          }), {
            config: { ...config, providers: { ...config.providers, [provider]: { ...entry, keyRefs: [reference], fallbackOn: [] } } },
            statePath: join(directory, "state.json"), providers, environment,
            ...(signal ? { signal } : {}),
          });
          row = { reference, status: signal?.aborted ? "cancelled" : result.ok ? "success" : "failure", attemptCount: result.attempts.length,
            ...(result.ok ? {} : { errorKind: result.error.kind }),
          };
        }
        row.completedAt = safeTime(Date.now());
        row.durationMs = safeTime(row.completedAt - startedAt);
        results.push(row);
        options.onResult?.({ ...row }, results.length, references.length);
      }
      return { results, cancelled: signal?.aborted ?? false };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch {
    // Infrastructure/callback errors must not expose raw errors or secret-bearing causes.
    throw new ProviderError("Unable to complete or clean up isolated key diagnostics.", { kind: "config", safeToRetry: false });
  }
}
