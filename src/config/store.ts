import { ProviderError } from "../errors/provider-error.js";
import { readJsonFile, withFileLock, writeJsonAtomic } from "../io/json-store.js";
import type { ProviderId } from "../protocol/types.js";
import { ArkSpaceConfigSchema, defaultConfig, type ArkSpaceConfig } from "./schema.js";

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
    const config = current === undefined ? defaultConfig() : reconcileProviderDefaults(ArkSpaceConfigSchema.parse(current));
    await writeJsonAtomic(path, config);
    return config;
  });
}

export async function addEnvironmentKey(path: string, provider: ProviderId, variable: string): Promise<ArkSpaceConfig> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
    throw new ProviderError("Environment variable names must contain only letters, digits, and underscores.", {
      kind: "invalid-request",
    });
  }
  return withFileLock(path, async () => {
    const value = await readJsonFile(path);
    const config =
      value === undefined ? defaultConfig() : reconcileProviderDefaults(ArkSpaceConfigSchema.parse(value));
    const entry = config.providers[provider];
    if (!entry) throw new ProviderError(`Provider ${provider} has no default configuration.`, { kind: "config" });
    const keyRef = `env:${variable}`;
    if (!entry.keyRefs.includes(keyRef)) entry.keyRefs.push(keyRef);
    await writeJsonAtomic(path, config);
    return config;
  });
}

function reconcileProviderDefaults(config: ArkSpaceConfig): ArkSpaceConfig {
  const defaults = defaultConfig();
  for (const provider of defaults.providerOrder) {
    if (!config.providers[provider]) config.providers[provider] = defaults.providers[provider];
    if (!config.providerOrder.includes(provider)) config.providerOrder.push(provider);
  }
  return config;
}
