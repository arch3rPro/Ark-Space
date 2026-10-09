import { z } from "zod";
import { BlockList, isIP } from "node:net";

import { FAILURE_KINDS, PROVIDER_IDS, type Capability, type ProviderId } from "../protocol/types.js";

const KeyReferenceSchema = z.string().regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/);
const mappedIpv6 = new BlockList();
mappedIpv6.addSubnet("::ffff:0:0", 96, "ipv6");

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

export const SearxngInstanceSchema = z.object({
  baseUrl: z.string().max(4_096).refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !/[\\\\\u0000-\u0020\u007f]/.test(value);
    } catch { return false; }
  }, "SearXNG requires a credential-free HTTP(S) base URL without query or fragment"),
  allowRanges: z.array(z.string().refine((value) => {
    const match = /^([^/]+)\/(\d{1,3})$/.exec(value);
    if (!match) return false;
    const family = isIP(match[1]!); const prefix = Number(match[2]);
    if (!family || prefix > (family === 4 ? 32 : 128) || (family === 6 && mappedIpv6.check(match[1]!, "ipv6"))) return false;
    try { new BlockList().addSubnet(match[1]!, prefix, family === 4 ? "ipv4" : "ipv6"); return true; } catch { return false; }
  }, "Expected an IP CIDR" )).max(20).default([]),
}).strict().transform((instance, context) => {
  try { return { ...instance, baseUrl: new URL(instance.baseUrl).href.replace(/\/+$/, "") }; }
  catch { context.addIssue({ code: "custom", message: "Invalid SearXNG base URL" }); return z.NEVER; }
});

export const WEKNORA_MANAGED_KEY_REF = "env:ARKSPACE_WEKNORA_API_KEY" as const;
export const WeknoraConnectionSchema = z.object({
  baseUrl: SearxngInstanceSchema.in.shape.baseUrl.refine(value => {
    try {
      const url = new URL(value);
      const authority = /^https?:\/\/([^/]+)\//i.exec(value)?.[1];
      return authority !== undefined && /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::[0-9]{1,5})?$/i.test(authority) && url.pathname.endsWith("/api/v1") &&
        !/[?#]/.test(value) && (url.hostname.startsWith("[") ||
          url.hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)));
    } catch { return false; }
  }, "WeKnora requires an explicit HTTP(S) API root ending in /api/v1"),
  apiKeyRef: z.literal(WEKNORA_MANAGED_KEY_REF),
  // Legacy metadata only: accepted unchanged on load, ignored by WeKnora transport.
  allowRanges: SearxngInstanceSchema.in.shape.allowRanges.refine(values => values.every(value => {
    const [address, bits] = value.split("/");
    return Number(bits) >= (isIP(address!) === 4 ? 24 : 64);
  }), "Use narrow endpoint-specific CIDRs (IPv4 /24 or narrower, IPv6 /64 or narrower)"),
  defaultKnowledgeBaseId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
}).strict();
export type WeknoraConnection = z.infer<typeof WeknoraConnectionSchema>;

const SearxngPolicySchema = ProviderConfigSchema.omit({ baseUrl: true }).extend({
  keyRefs: z.array(z.never()).default([]),
});
export const SearxngConfigSchema = z.union([
  SearxngPolicySchema.extend({ instances: z.array(SearxngInstanceSchema).min(1).max(100) }).strict(),
  SearxngPolicySchema.extend(SearxngInstanceSchema.in.shape).strict().transform(({ baseUrl, allowRanges, ...policy }) => ({
    ...policy, instances: [SearxngInstanceSchema.parse({ baseUrl, allowRanges })],
  })),
]).refine(config => new Set(config.instances.map(instance => instance.baseUrl)).size === config.instances.length,
  "Duplicate SearXNG instances are not allowed");
export type SearxngConfig = z.infer<typeof SearxngConfigSchema>;
export type SearxngInstance = z.infer<typeof SearxngInstanceSchema>;

export const ExecutionConfigSchema = z
  .object({
    crawlPollIntervalMs: z.number().int().min(100).max(10_000).default(1_000),
    extractPollIntervalMs: z.number().int().min(100).max(10_000).default(1_000),
    researchPollIntervalMs: z.number().int().min(500).max(30_000).default(2_000),
    cleanupTimeoutMs: z.number().int().min(1_000).max(30_000).default(5_000),
  })
  .strict();

// Keys are Protocol capability IDs; aliases affect discovery surfaces, never the invoke ID.
const CapabilitySchema = z.enum([
  "weknora.connection.verify", "weknora.knowledge-bases.list", "weknora.knowledge-bases.get", "weknora.search",
  "web.search", "web.fetch", "web.content.get", "web.map", "web.crawl", "web.related", "web.extract",
  "code.context", "research.run", "browser.open", "browser.snapshot", "browser.interact",
  "browser.status", "browser.close", "monitor.create", "monitor.list", "monitor.status",
  "monitor.update", "monitor.pause", "monitor.resume", "monitor.trigger", "monitor.delete",
  "monitor.runs", "monitor.run.get", "monitor.site.create", "monitor.site.list",
  "monitor.site.status", "monitor.site.update", "monitor.site.pause", "monitor.site.resume",
  "monitor.site.trigger", "monitor.site.delete", "monitor.site.checks", "monitor.site.check.get",
] as const satisfies readonly Capability[]);

const ToolNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const CidrSchema = z.string().regex(/^[0-9a-fA-F:.]+\/\d{1,3}$/);
export const WebResponseCacheConfigSchema = z.object({
  ttlSeconds: z.number().int().min(1).max(86_400).default(3_600),
  maxCount: z.number().int().min(1).max(10_000).default(100),
  maxBytes: z.number().int().min(1_024).max(100_000_000).default(10_000_000),
}).strict();
export const LocalFetchConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowRanges: z.array(CidrSchema).default([]),
  trustEnvProxy: z.literal(false).default(false),
}).strict();
export const ToolConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mcpName: ToolNameSchema.optional(),
  cliName: ToolNameSchema.optional(),
}).strict();

export const ArkSpaceConfigSchema = z
  .object({
    version: z.literal(1),
    setupLanguage: z.enum(["en", "zh"]).optional(),
    connections: z.object({ weknora: WeknoraConnectionSchema.optional() }).strict().optional(),
    providerOrder: z.array(z.enum(PROVIDER_IDS)).min(1),
    tools: z.partialRecord(CapabilitySchema, ToolConfigSchema).default({}),
    localFetch: LocalFetchConfigSchema.default({ enabled: false, allowRanges: [], trustEnvProxy: false }),
    webResponseCache: WebResponseCacheConfigSchema.default({ ttlSeconds: 3_600, maxCount: 100, maxBytes: 10_000_000 }),
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
      local: ProviderConfigSchema.optional(),
      searxng: SearxngConfigSchema.optional(),
    }),
  })
  .strict();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>;
export type ArkSpaceConfig = z.infer<typeof ArkSpaceConfigSchema>;
export type SetupLanguage = NonNullable<ArkSpaceConfig["setupLanguage"]>;

export function isToolEnabled(config: ArkSpaceConfig, capability: Capability): boolean {
  return config.tools[capability]?.enabled !== false;
}

export function defaultConfig(): ArkSpaceConfig {
  return ArkSpaceConfigSchema.parse({
    version: 1,
    providerOrder: ["exa", "tavily", "firecrawl"],
    webResponseCache: { ttlSeconds: 3_600, maxCount: 100, maxBytes: 10_000_000 },
    localFetch: {
      enabled: false,
      allowRanges: [],
      trustEnvProxy: false,
    },
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

export function getProviderConfig(config: ArkSpaceConfig, provider: ProviderId, environment: NodeJS.ProcessEnv = process.env): ProviderConfig | undefined {
  if (provider !== "searxng") return config.providers[provider];
  const entry = getSearxngConfig(config, environment);
  return entry ? { ...entry, baseUrl: entry.instances[0]!.baseUrl } : undefined;
}

export function getSearxngConfig(config: ArkSpaceConfig, environment: NodeJS.ProcessEnv = process.env): SearxngConfig | undefined {
  if (config.providers.searxng) return config.providers.searxng;
  const baseUrl = environment.SEARXNG_URL || environment.SEARXNG_BASE_URL;
  if (!baseUrl) return undefined;
  const parsed = SearxngConfigSchema.safeParse({ baseUrl });
  return parsed.success ? parsed.data : undefined;
}
