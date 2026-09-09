import { z } from "zod";

import { FAILURE_KINDS, PROVIDER_IDS, type ProviderId } from "../protocol/types.js";

const KeyReferenceSchema = z.string().regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/);

export const ProviderConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    baseUrl: z.string().url(),
    keyRefs: z.array(KeyReferenceSchema).default([]),
    fallbackOn: z
      .array(z.enum(FAILURE_KINDS))
      .default(["rate-limit", "quota", "network", "transient"]),
    cooldownSeconds: z.number().int().positive().default(300),
    quotaCooldownSeconds: z.number().int().positive().default(86_400),
  })
  .strict();

export const ExecutionConfigSchema = z
  .object({
    crawlPollIntervalMs: z.number().int().min(100).max(10_000).default(1_000),
    extractPollIntervalMs: z.number().int().min(100).max(10_000).default(1_000),
    researchPollIntervalMs: z.number().int().min(500).max(30_000).default(2_000),
    cleanupTimeoutMs: z.number().int().min(1_000).max(30_000).default(5_000),
  })
  .strict();

export const ArkSpaceConfigSchema = z
  .object({
    version: z.literal(1),
    providerOrder: z.array(z.enum(PROVIDER_IDS)).min(1),
    execution: ExecutionConfigSchema.default({
      crawlPollIntervalMs: 1_000,
      extractPollIntervalMs: 1_000,
      researchPollIntervalMs: 2_000,
      cleanupTimeoutMs: 5_000,
    }),
    providers: z.object({
      exa: ProviderConfigSchema.optional(),
      tavily: ProviderConfigSchema.optional(),
      firecrawl: ProviderConfigSchema.optional(),
    }),
  })
  .strict();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>;
export type ArkSpaceConfig = z.infer<typeof ArkSpaceConfigSchema>;

export function defaultConfig(): ArkSpaceConfig {
  return ArkSpaceConfigSchema.parse({
    version: 1,
    providerOrder: ["exa", "tavily", "firecrawl"],
    execution: {
      crawlPollIntervalMs: 1_000,
      extractPollIntervalMs: 1_000,
      researchPollIntervalMs: 2_000,
      cleanupTimeoutMs: 5_000,
    },
    providers: {
      exa: {
        baseUrl: "https://api.exa.ai",
        keyRefs: ["env:EXA_API_KEY"],
      },
      tavily: {
        baseUrl: "https://api.tavily.com",
        keyRefs: ["env:TAVILY_API_KEY"],
      },
      firecrawl: {
        baseUrl: "https://api.firecrawl.dev",
        keyRefs: ["env:FIRECRAWL_API_KEY"],
      },
    },
  });
}

export function getProviderConfig(config: ArkSpaceConfig, provider: ProviderId): ProviderConfig | undefined {
  return config.providers[provider];
}
