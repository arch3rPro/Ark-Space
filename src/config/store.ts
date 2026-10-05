import { ProviderError } from "../errors/provider-error.js";
import { readJsonFile, withFileLock, writeJsonAtomic } from "../io/json-store.js";
import type { ProviderId } from "../protocol/types.js";
import { ArkSpaceConfigSchema, SearxngConfigSchema, SearxngInstanceSchema, defaultConfig, type ArkSpaceConfig } from "./schema.js";

export async function loadConfig(path: string): Promise<ArkSpaceConfig> {
  const value = await readJsonFile(path);
  if (value === undefined) {
    throw new ProviderError(`ArkSpace configuration not found at ${path}`, { kind: "config" });
  }
  const parsed = ArkSpaceConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderError(`Invalid ArkSpace configuration at ${path}: ${parsed.error.message}`, {
      kind: "config",
    });
  }
  return parsed.data;
}

export async function initializeConfig(path: string): Promise<ArkSpaceConfig> {
  return withFileLock(path, async () => {
    const current = await readJsonFile(path);
    if (current !== undefined) return ArkSpaceConfigSchema.parse(current);
    const config = defaultConfig();
    await writeJsonAtomic(path, config);
    return config;
  });
}

export async function addEnvironmentKey(path: string, provider: ProviderId, variable: string): Promise<ArkSpaceConfig> {
  if (provider === "searxng") throw new ProviderError("SearXNG is keyless; configure its base URL instead.", { kind: "invalid-request" });
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
    throw new ProviderError("Environment variable names must contain only letters, digits, and underscores.", {
      kind: "invalid-request",
    });
  }
  return withFileLock(path, async () => {
    const value = await readJsonFile(path);
    const config =
      value === undefined ? defaultConfig() : ArkSpaceConfigSchema.parse(value);
    const entry = (config.providers[provider] ??= defaultConfig().providers[provider]);
    if (!entry) throw new ProviderError(`Provider ${provider} has no default configuration.`, { kind: "config" });
    const keyRef = `env:${variable}`;
    if (!entry.keyRefs.includes(keyRef)) entry.keyRefs.push(keyRef);
    await writeJsonAtomic(path, config);
    return config;
  });
}

export async function configureSearxng(path: string, baseUrl: string, allowRanges: string[]): Promise<ArkSpaceConfig> {
  const parsed = SearxngConfigSchema.safeParse({ baseUrl, allowRanges });
  if (!parsed.success) throw new ProviderError("Invalid SearXNG endpoint or CIDR configuration.", { kind: "invalid-request" });
  return withFileLock(path, async () => {
    const value = await readJsonFile(path);
    const config = value === undefined ? defaultConfig() : ArkSpaceConfigSchema.parse(value);
    config.providers.searxng = parsed.data;
    await writeJsonAtomic(path, config);
    return config;
  });
}

export async function addSearxngInstance(path: string, baseUrl: string, allowRanges: string[]): Promise<ArkSpaceConfig> {
  const parsed = SearxngInstanceSchema.safeParse({ baseUrl, allowRanges });
  if (!parsed.success) throw new ProviderError("Invalid SearXNG endpoint or CIDR configuration.", { kind: "invalid-request" });
  return withFileLock(path, async () => {
    const value = await readJsonFile(path);
    const config = value === undefined ? defaultConfig() : ArkSpaceConfigSchema.parse(value);
    const existing = config.providers.searxng;
    if (existing?.instances.some(instance => instance.baseUrl === parsed.data.baseUrl)) {
      throw new ProviderError("SearXNG instance is already configured; permissions were not changed.", { kind: "invalid-request" });
    }
    config.providers.searxng = SearxngConfigSchema.parse({
      ...existing, enabled: existing?.enabled ?? true, instances: [...(existing?.instances ?? []), parsed.data],
    });
    await writeJsonAtomic(path, config);
    return config;
  });
}
