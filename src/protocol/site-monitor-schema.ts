import { z } from "zod";

import { PROTOCOL_VERSION, type ConfirmedSiteMonitorResourceInput, type SiteMonitorCheckGetInput, type SiteMonitorCheckId, type SiteMonitorChecksInput, type SiteMonitorCreateInput, type SiteMonitorId, type SiteMonitorListInput, type SiteMonitorResourceInput, type SiteMonitorUpdateInput } from "./types.js";

const IdSchema = z.string().trim().min(1).max(256);
const TimeoutSchema = z.number().int().min(1_000).max(120_000).default(30_000);
const HttpUrlSchema = z.string().url().max(4_096).refine((value) => {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
}, "URLs must use HTTP(S) and must not contain credentials");
const PublicHttpsUrlSchema = HttpUrlSchema.refine((value) => new URL(value).protocol === "https:", "Webhook URLs must use HTTPS").refine((value) => isPublicHost(new URL(value).hostname), "Webhook URLs must not target localhost or a private IP address");
const TimezoneSchema = z.string().trim().min(1).max(100).default("UTC");
const ScheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), value: z.string().trim().min(9).max(100).refine((value) => value.split(/\s+/).length === 5, "Cron schedules must contain five fields"), timezone: TimezoneSchema }).strict(),
  z.object({ type: z.literal("text"), value: z.string().trim().min(1).max(100), timezone: TimezoneSchema }).strict(),
]);
const DomainSchema = z.string().trim().min(1).max(253);
const PathSchema = z.string().trim().min(1).max(500);
const TargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scrape"), urls: z.array(HttpUrlSchema).min(1).max(50), onlyMainContent: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal("crawl"), url: HttpUrlSchema, limit: z.number().int().min(1).max(100).default(20), maxDepth: z.number().int().min(1).max(5).default(2), includePaths: z.array(PathSchema).max(50).default([]), excludePaths: z.array(PathSchema).max(50).default([]), onlyMainContent: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal("search"), queries: z.array(z.string().trim().min(1).max(256)).min(1).max(12), searchWindow: z.enum(["5m", "15m", "1h", "6h", "24h", "7d"]).default("24h"), maxResults: z.number().int().min(1).max(50).default(10), includeDomains: z.array(DomainSchema).max(50).default([]), excludeDomains: z.array(DomainSchema).max(50).default([]) }).strict(),
]);
const EventsSchema = z.array(z.enum(["monitor.page", "monitor.check.completed"])).max(2).default(["monitor.page", "monitor.check.completed"]);

const CreateInputSchema = z.object({
  name: z.string().trim().min(1).max(256),
  schedule: ScheduleSchema,
  targets: z.array(TargetSchema).min(1).max(50),
  retentionDays: z.number().int().min(1).max(365).default(30),
  goal: z.string().trim().min(1).max(2_000).optional(),
  judgeEnabled: z.boolean().default(false),
  webhookUrl: PublicHttpsUrlSchema.optional(),
  webhookEvents: EventsSchema,
  confirmed: z.literal(true),
  timeoutMs: TimeoutSchema,
}).strict().superRefine((input, context) => {
  if (input.targets.some((target) => target.type === "search") && input.judgeEnabled !== false && !input.goal) context.addIssue({ code: "custom", message: "Search targets require goal unless judgeEnabled is false" });
});
const ResourceInputSchema = z.object({ monitorId: IdSchema, timeoutMs: TimeoutSchema }).strict();
const ConfirmedResourceInputSchema = ResourceInputSchema.extend({ confirmed: z.literal(true) }).strict();
const UpdateInputSchema = ConfirmedResourceInputSchema.extend({
  name: z.string().trim().min(1).max(256).optional(),
  schedule: ScheduleSchema.optional(),
  targets: z.array(TargetSchema).min(1).max(50).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  goal: z.string().trim().min(1).max(2_000).optional(),
  judgeEnabled: z.boolean().optional(),
  webhookUrl: PublicHttpsUrlSchema.optional(),
  webhookEvents: EventsSchema.optional(),
}).strict().refine((input) => input.name !== undefined || input.schedule !== undefined || input.targets !== undefined || input.retentionDays !== undefined || input.goal !== undefined || input.judgeEnabled !== undefined || input.webhookUrl !== undefined || input.webhookEvents !== undefined, "At least one site monitor field must be updated").superRefine((input, context) => {
  if (input.targets?.some((target) => target.type === "search") && input.judgeEnabled !== false && !input.goal) context.addIssue({ code: "custom", message: "Updating to a search target requires goal unless judgeEnabled is false" });
});
const ListInputSchema = z.object({ limit: z.number().int().min(1).max(100).default(25) }).strict();
const ChecksInputSchema = ResourceInputSchema.extend({ limit: z.number().int().min(1).max(100).default(25) }).strict();
const CheckGetInputSchema = ResourceInputSchema.extend({ checkId: IdSchema, limit: z.number().int().min(1).max(100).default(25) }).strict();

export const SiteMonitorInputSchemas = {
  "monitor.site.create": CreateInputSchema,
  "monitor.site.list": ListInputSchema,
  "monitor.site.status": ResourceInputSchema,
  "monitor.site.update": UpdateInputSchema,
  "monitor.site.pause": ConfirmedResourceInputSchema,
  "monitor.site.resume": ConfirmedResourceInputSchema,
  "monitor.site.trigger": ConfirmedResourceInputSchema,
  "monitor.site.delete": ConfirmedResourceInputSchema,
  "monitor.site.checks": ChecksInputSchema,
  "monitor.site.check.get": CheckGetInputSchema,
} as const;

export const SiteMonitorRequestSchemas = Object.fromEntries(Object.entries(SiteMonitorInputSchemas).map(([capability, input]) => [capability, requestSchema(capability, input)])) as { [C in keyof typeof SiteMonitorInputSchemas]: ReturnType<typeof requestSchema> };

export function parseSiteMonitorCreateRequest(value: unknown): SiteMonitorCreateInput { const input = CreateInputSchema.parse(extract(value, "monitor.site.create")); return { ...requiredCreate(input), ...(input.goal ? { goal: input.goal } : {}), ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}) }; }
export function parseSiteMonitorListRequest(value: unknown): SiteMonitorListInput { return ListInputSchema.parse(extract(value, "monitor.site.list")); }
export function parseSiteMonitorStatusRequest(value: unknown): SiteMonitorResourceInput { return resource(value, "monitor.site.status"); }
export function parseSiteMonitorUpdateRequest(value: unknown): SiteMonitorUpdateInput {
  const input = UpdateInputSchema.parse(extract(value, "monitor.site.update"));
  return { monitorId: input.monitorId as SiteMonitorId, confirmed: true, timeoutMs: input.timeoutMs, ...(input.name ? { name: input.name } : {}), ...(input.schedule ? { schedule: input.schedule } : {}), ...(input.targets ? { targets: input.targets } : {}), ...(input.retentionDays === undefined ? {} : { retentionDays: input.retentionDays }), ...(input.goal ? { goal: input.goal } : {}), ...(input.judgeEnabled === undefined ? {} : { judgeEnabled: input.judgeEnabled }), ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}), ...(input.webhookEvents ? { webhookEvents: input.webhookEvents } : {}) };
}
export function parseSiteMonitorPauseRequest(value: unknown): ConfirmedSiteMonitorResourceInput { return confirmedResource(value, "monitor.site.pause"); }
export function parseSiteMonitorResumeRequest(value: unknown): ConfirmedSiteMonitorResourceInput { return confirmedResource(value, "monitor.site.resume"); }
export function parseSiteMonitorTriggerRequest(value: unknown): ConfirmedSiteMonitorResourceInput { return confirmedResource(value, "monitor.site.trigger"); }
export function parseSiteMonitorDeleteRequest(value: unknown): ConfirmedSiteMonitorResourceInput { return confirmedResource(value, "monitor.site.delete"); }
export function parseSiteMonitorChecksRequest(value: unknown): SiteMonitorChecksInput { const input = ChecksInputSchema.parse(extract(value, "monitor.site.checks")); return { monitorId: input.monitorId as SiteMonitorId, timeoutMs: input.timeoutMs, limit: input.limit }; }
export function parseSiteMonitorCheckGetRequest(value: unknown): SiteMonitorCheckGetInput { const input = CheckGetInputSchema.parse(extract(value, "monitor.site.check.get")); return { monitorId: input.monitorId as SiteMonitorId, checkId: input.checkId as SiteMonitorCheckId, timeoutMs: input.timeoutMs, limit: input.limit }; }

function requiredCreate(input: z.infer<typeof CreateInputSchema>): Omit<SiteMonitorCreateInput, "goal" | "webhookUrl"> { return { name: input.name, schedule: input.schedule, targets: input.targets, retentionDays: input.retentionDays, judgeEnabled: input.judgeEnabled, webhookEvents: input.webhookEvents, confirmed: true, timeoutMs: input.timeoutMs }; }
function resource(value: unknown, capability: "monitor.site.status"): SiteMonitorResourceInput { const input = ResourceInputSchema.parse(extract(value, capability)); return { monitorId: input.monitorId as SiteMonitorId, timeoutMs: input.timeoutMs }; }
function confirmedResource(value: unknown, capability: "monitor.site.pause" | "monitor.site.resume" | "monitor.site.trigger" | "monitor.site.delete"): ConfirmedSiteMonitorResourceInput { const input = ConfirmedResourceInputSchema.parse(extract(value, capability)); return { monitorId: input.monitorId as SiteMonitorId, confirmed: true, timeoutMs: input.timeoutMs }; }
function extract(value: unknown, capability: keyof typeof SiteMonitorInputSchemas): unknown { return SiteMonitorRequestSchemas[capability].parse(value).input; }
function requestSchema(capability: string, input: z.ZodType) { return z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), capability: z.literal(capability), input }).strict(); }
function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return false;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = 0, second = 0] = octets;
  return !(first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168));
}
