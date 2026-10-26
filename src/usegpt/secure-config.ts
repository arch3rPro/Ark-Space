import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { loadConfig } from "../config/store.js";
import { validateCredentialValue } from "../config/credentials.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { USEGPT_API_KEY_VARIABLE, UseGptConfigSchema } from "../config/schema.js";

export interface UseGptHubConfig {
  tunnelId: string;
  apiKey: string;
  dataDir: string;
}

export function defaultUseGptDataDir(): string {
  return join(homedir(), ".arkspace", "usegpt");
}

export async function loadUseGptHubConfig(
  paths: ArkSpacePaths,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<UseGptHubConfig> {
  const raw = (await loadConfig(paths.config)).connections?.usegpt;
  const config = UseGptConfigSchema.safeParse(raw);
  if (!config.success || !config.data.enabled || !config.data.tunnelId || config.data.apiKeyRef !== `env:${USEGPT_API_KEY_VARIABLE}`) {
    throw new Error("UseGPT Artifact Hub is not configured. Run arks setup usegpt in a trusted terminal.");
  }
  const apiKey = environment[USEGPT_API_KEY_VARIABLE];
  if (!apiKey || !validateCredentialValue(apiKey)) {
    throw new Error(`Set ${USEGPT_API_KEY_VARIABLE} in the trusted process environment.`);
  }
  const dataDir = config.data.dataDir ?? defaultUseGptDataDir();
  if (!isAbsolute(dataDir)) throw new Error("UseGPT data directory must be absolute.");
  return { tunnelId: config.data.tunnelId, apiKey: apiKey.trim(), dataDir };
}
