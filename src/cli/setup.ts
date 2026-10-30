import process from "node:process";
import { initializeConfig } from "../config/store.js";
import { ProviderError } from "../errors/provider-error.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { initialSetupLanguage, setupMessage, setupSafeError, type SetupLanguage } from "./setup-language.js";

const PROVIDERS = ["exa", "tavily", "firecrawl", "searxng"] as const;
export interface SetupOptions { provider?: string; language?: string; environment?: NodeJS.ProcessEnv; signal?: AbortSignal }

function reportInitial(error: unknown, language: SetupLanguage) {
  if (error instanceof ProviderError) {
    process.stdout.write(`${setupSafeError(language, error.message) ?? setupMessage(language, "notSaved", { kind: setupMessage(language, error.kind) })}\n`);
  } else process.stdout.write(`${setupMessage(language, "operationFailed")}\n`);
}

export async function runSetup(paths: ArkSpacePaths, options: SetupOptions = {}): Promise<void> {
  if (options.language !== undefined && options.language !== "en" && options.language !== "zh") {
    throw new ProviderError("--lang must be en or zh / --lang 必须为 en 或 zh.", { kind: "invalid-request" });
  }
  const environment = options.environment ?? { ...process.env };
  let language = initialSetupLanguage(options.language, undefined, environment);
  if (options.provider !== undefined && options.provider !== "weknora" && options.provider !== "usegpt" && !PROVIDERS.includes(options.provider as typeof PROVIDERS[number])) {
    throw new ProviderError(setupMessage(language, "unsupportedProvider"), { kind: "invalid-request" });
  }
  try {
    const config = await initializeConfig(paths.config);
    language = initialSetupLanguage(options.language, config.setupLanguage, environment);
  } catch (error) { reportInitial(error, language); process.exitCode = 1; return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // machine contract: one plain line, never the alt-screen (ADR 0016).
    process.stdout.write(`${setupMessage(language, "ready", { path: paths.config })}\n`);
    return;
  }
  const { runSetupTui } = await import("../tui/index.js");
  let failure: unknown; let cancelled = false;
  try {
    await runSetupTui({ paths, environment, language: () => language, provider: options.provider, onLanguageChange: (next) => { language = next; }, ...(options.signal ? { signal: options.signal } : {}) });
  } catch (error) {
    cancelled = error instanceof Error && error.message === "Setup cancelled.";
    if (!cancelled) { failure = error; process.exitCode = 1; }
  }
  if (cancelled) process.stdout.write(`${setupMessage(language, "cancelled")}\n`);
  else if (failure) reportInitial(failure, language);
}
