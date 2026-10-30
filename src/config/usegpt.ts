import { loadConfig, initializeConfig } from "./store.js";
import { withFileLock, writeJsonAtomic } from "../io/json-store.js";
import type { ArkSpacePaths } from "./paths.js";

import { UseGptConfigSchema, type UseGptConfig } from "./schema.js";
export { UseGptConfigSchema } from "./schema.js";
export type { UseGptConfig } from "./schema.js";

export async function loadUseGptConfig(paths: ArkSpacePaths): Promise<UseGptConfig> {
  const connection = (await loadConfig(paths.config)).connections?.usegpt;
  if (!connection?.enabled) throw new Error("UseGPT is not configured. Run arks setup usegpt in a trusted terminal.");
  return connection;
}

export async function saveUseGptConfig(paths: ArkSpacePaths, value: UseGptConfig): Promise<void> {
  const parsed = UseGptConfigSchema.parse(value);
  await initializeConfig(paths.config);
  await withFileLock(paths.config, async () => {
    const config = await loadConfig(paths.config);
    config.connections = { ...config.connections, usegpt: parsed };
    await writeJsonAtomic(paths.config, config);
  });
}

export async function removeUseGptConfig(paths: ArkSpacePaths): Promise<void> {
  await withFileLock(paths.config, async () => {
    const config = await loadConfig(paths.config);
    if (config.connections) delete config.connections.usegpt;
    await writeJsonAtomic(paths.config, config);
  });
}
