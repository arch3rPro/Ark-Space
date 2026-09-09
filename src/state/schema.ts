import { z } from "zod";

const KeyStateSchema = z
  .object({
    status: z.enum(["enabled", "disabled", "cooldown", "exhausted"]),
    cooldownUntil: z.number().int().nonnegative().optional(),
    lastFailure: z.string().optional(),
    consecutiveFailures: z.number().int().nonnegative(),
  })
  .strict();

const ProviderStateSchema = z
  .object({
    cursor: z.number().int().nonnegative(),
    keys: z.record(z.string(), KeyStateSchema),
  })
  .strict();

const BrowserSessionOwnerSchema = z
  .object({
    provider: z.literal("firecrawl"),
    keyId: z.string().min(1),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();

const MonitorOwnerSchema = z
  .object({
    provider: z.literal("exa"),
    keyId: z.string().min(1),
    createdAt: z.iso.datetime(),
    secretPath: z.string().min(1),
  })
  .strict();

const FirecrawlMonitorOwnerSchema = z
  .object({
    provider: z.literal("firecrawl"),
    keyId: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict();

const OwnedResourcesSchema = z
  .object({
    browserSessions: z.record(z.string(), BrowserSessionOwnerSchema),
    monitors: z.record(z.string(), MonitorOwnerSchema),
    siteMonitors: z.record(z.string(), FirecrawlMonitorOwnerSchema).default({}),
  })
  .strict();

export const ArkSpaceStateSchema = z
  .object({
    version: z.literal(1),
    providers: z.record(z.string(), ProviderStateSchema),
    resources: OwnedResourcesSchema.default({ browserSessions: {}, monitors: {}, siteMonitors: {} }),
  })
  .strict();

export type KeyState = z.infer<typeof KeyStateSchema>;
export type ProviderState = z.infer<typeof ProviderStateSchema>;
export type ArkSpaceState = z.infer<typeof ArkSpaceStateSchema>;
export type BrowserSessionOwner = z.infer<typeof BrowserSessionOwnerSchema>;
export type MonitorOwner = z.infer<typeof MonitorOwnerSchema>;
export type FirecrawlMonitorOwner = z.infer<typeof FirecrawlMonitorOwnerSchema>;

export function emptyState(): ArkSpaceState {
  return { version: 1, providers: {}, resources: { browserSessions: {}, monitors: {}, siteMonitors: {} } };
}
