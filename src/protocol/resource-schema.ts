import { z } from "zod";

import {
  PROTOCOL_VERSION,
  type BrowserInteractInput,
  type BrowserOpenInput,
  type BrowserResourceInput,
  type BrowserSessionId,
  type BrowserSnapshotInput,
  type ConfirmedMonitorResourceInput,
  type MonitorCreateInput,
  type MonitorId,
  type MonitorListInput,
  type MonitorResourceInput,
  type MonitorRunGetInput,
  type MonitorRunId,
  type MonitorRunsInput,
  type MonitorUpdateInput,
} from "./types.js";

const HttpUrlSchema = z
  .string()
  .url()
  .max(4_096)
  .refine((value) => {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  }, "URLs must use HTTP(S) and must not contain credentials");
const HttpsUrlSchema = HttpUrlSchema
  .refine((value) => new URL(value).protocol === "https:", "Webhook URLs must use HTTPS")
  .refine((value) => isPublicWebhookHost(new URL(value).hostname), "Webhook URLs must not target localhost or a private IP address");
const IdSchema = z.string().trim().min(1).max(256);
const TimeoutSchema = z.number().int().min(1_000).max(120_000).default(30_000);
const ConfirmedSchema = z.literal(true);
const PeriodSchema = z.string().regex(/^(?:[1-9]\d*)(?:h|d)$/, "Period must be one duration unit such as 1h, 1d, or 1w").max(16);

const BrowserOpenInputSchema = z.object({
  url: HttpUrlSchema,
  ttlSeconds: z.number().int().min(30).max(3_600).default(600),
  activityTtlSeconds: z.number().int().min(10).max(3_600).default(300),
  timeoutMs: TimeoutSchema,
}).strict().refine((input) => input.activityTtlSeconds <= input.ttlSeconds, "activityTtlSeconds must not exceed ttlSeconds");

const BrowserSnapshotInputSchema = z.object({
  sessionId: IdSchema,
  interactiveOnly: z.boolean().default(true),
  timeoutMs: TimeoutSchema,
}).strict();

const BrowserActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: HttpUrlSchema }).strict(),
  z.object({ type: z.literal("click"), ref: z.string().regex(/^@e[1-9]\d{0,5}$/) }).strict(),
  z.object({ type: z.literal("fill"), ref: z.string().regex(/^@e[1-9]\d{0,5}$/), text: z.string().max(8_000) }).strict(),
  z.object({ type: z.literal("press"), key: z.enum(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Space"]) }).strict(),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]), pixels: z.number().int().min(1).max(10_000).default(500) }).strict(),
  z.object({ type: z.literal("scrape") }).strict(),
]);

const BrowserInteractInputSchema = z.object({
  sessionId: IdSchema,
  action: BrowserActionSchema,
  confirmed: ConfirmedSchema,
  timeoutMs: TimeoutSchema,
}).strict();

const BrowserResourceInputSchema = z.object({ sessionId: IdSchema, timeoutMs: TimeoutSchema }).strict();

const MonitorCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  query: z.string().trim().min(1).max(2_000),
  numResults: z.number().int().min(1).max(100).default(10),
  period: PeriodSchema,
  webhookUrl: HttpsUrlSchema,
  webhookSecretPath: z.string().trim().min(1).max(4_096),
  confirmed: ConfirmedSchema,
  timeoutMs: TimeoutSchema,
}).strict();

const MonitorResourceInputSchema = z.object({ monitorId: IdSchema, timeoutMs: TimeoutSchema }).strict();
const ConfirmedMonitorResourceInputSchema = z.object({ monitorId: IdSchema, confirmed: ConfirmedSchema, timeoutMs: TimeoutSchema }).strict();
const MonitorUpdateInputSchema = ConfirmedMonitorResourceInputSchema.extend({
  name: z.string().trim().min(1).max(200).optional(),
  query: z.string().trim().min(1).max(2_000).optional(),
  numResults: z.number().int().min(1).max(100).optional(),
  period: PeriodSchema.optional(),
}).strict().refine((input) => input.name !== undefined || input.query !== undefined || input.numResults !== undefined || input.period !== undefined, "At least one monitor field must be updated");
const MonitorListInputSchema = z.object({ limit: z.number().int().min(1).max(100).default(50) }).strict();
const MonitorRunsInputSchema = MonitorResourceInputSchema.extend({ limit: z.number().int().min(1).max(100).default(20) }).strict();
const MonitorRunGetInputSchema = MonitorResourceInputSchema.extend({ runId: IdSchema }).strict();

export const BrowserOpenRequestSchema = requestSchema("browser.open", BrowserOpenInputSchema);
export const BrowserSnapshotRequestSchema = requestSchema("browser.snapshot", BrowserSnapshotInputSchema);
export const BrowserInteractRequestSchema = requestSchema("browser.interact", BrowserInteractInputSchema);
export const BrowserStatusRequestSchema = requestSchema("browser.status", BrowserResourceInputSchema);
export const BrowserCloseRequestSchema = requestSchema("browser.close", BrowserResourceInputSchema);
export const MonitorCreateRequestSchema = requestSchema("monitor.create", MonitorCreateInputSchema);
export const MonitorListRequestSchema = requestSchema("monitor.list", MonitorListInputSchema);
export const MonitorStatusRequestSchema = requestSchema("monitor.status", MonitorResourceInputSchema);
export const MonitorUpdateRequestSchema = requestSchema("monitor.update", MonitorUpdateInputSchema);
export const MonitorPauseRequestSchema = requestSchema("monitor.pause", ConfirmedMonitorResourceInputSchema);
export const MonitorResumeRequestSchema = requestSchema("monitor.resume", ConfirmedMonitorResourceInputSchema);
export const MonitorTriggerRequestSchema = requestSchema("monitor.trigger", ConfirmedMonitorResourceInputSchema);
export const MonitorDeleteRequestSchema = requestSchema("monitor.delete", ConfirmedMonitorResourceInputSchema);
export const MonitorRunsRequestSchema = requestSchema("monitor.runs", MonitorRunsInputSchema);
export const MonitorRunGetRequestSchema = requestSchema("monitor.run.get", MonitorRunGetInputSchema);

export const ResourceInputSchemas = {
  "browser.open": BrowserOpenInputSchema,
  "browser.snapshot": BrowserSnapshotInputSchema,
  "browser.interact": BrowserInteractInputSchema,
  "browser.status": BrowserResourceInputSchema,
  "browser.close": BrowserResourceInputSchema,
  "monitor.create": MonitorCreateInputSchema,
  "monitor.list": MonitorListInputSchema,
  "monitor.status": MonitorResourceInputSchema,
  "monitor.update": MonitorUpdateInputSchema,
  "monitor.pause": ConfirmedMonitorResourceInputSchema,
  "monitor.resume": ConfirmedMonitorResourceInputSchema,
  "monitor.trigger": ConfirmedMonitorResourceInputSchema,
  "monitor.delete": ConfirmedMonitorResourceInputSchema,
  "monitor.runs": MonitorRunsInputSchema,
  "monitor.run.get": MonitorRunGetInputSchema,
} as const;

export const ResourceRequestSchemas = {
  "browser.open": BrowserOpenRequestSchema,
  "browser.snapshot": BrowserSnapshotRequestSchema,
  "browser.interact": BrowserInteractRequestSchema,
  "browser.status": BrowserStatusRequestSchema,
  "browser.close": BrowserCloseRequestSchema,
  "monitor.create": MonitorCreateRequestSchema,
  "monitor.list": MonitorListRequestSchema,
  "monitor.status": MonitorStatusRequestSchema,
  "monitor.update": MonitorUpdateRequestSchema,
  "monitor.pause": MonitorPauseRequestSchema,
  "monitor.resume": MonitorResumeRequestSchema,
  "monitor.trigger": MonitorTriggerRequestSchema,
  "monitor.delete": MonitorDeleteRequestSchema,
  "monitor.runs": MonitorRunsRequestSchema,
  "monitor.run.get": MonitorRunGetRequestSchema,
} as const;

export function parseBrowserOpenRequest(value: unknown): BrowserOpenInput { return BrowserOpenInputSchema.parse(extract(value, "browser.open")); }
export function parseBrowserSnapshotRequest(value: unknown): BrowserSnapshotInput { const input = BrowserSnapshotInputSchema.parse(extract(value, "browser.snapshot")); return { ...input, sessionId: input.sessionId as BrowserSessionId }; }
export function parseBrowserInteractRequest(value: unknown): BrowserInteractInput { const input = BrowserInteractInputSchema.parse(extract(value, "browser.interact")); return { ...input, sessionId: input.sessionId as BrowserSessionId }; }
export function parseBrowserStatusRequest(value: unknown): BrowserResourceInput { return parseBrowserResource(value, "browser.status"); }
export function parseBrowserCloseRequest(value: unknown): BrowserResourceInput { return parseBrowserResource(value, "browser.close"); }
export function parseMonitorCreateRequest(value: unknown): MonitorCreateInput {
  const input = MonitorCreateInputSchema.parse(extract(value, "monitor.create"));
  return { query: input.query, numResults: input.numResults, period: input.period, webhookUrl: input.webhookUrl, webhookSecretPath: input.webhookSecretPath, confirmed: true, timeoutMs: input.timeoutMs, ...(input.name ? { name: input.name } : {}) };
}
export function parseMonitorListRequest(value: unknown): MonitorListInput { return MonitorListInputSchema.parse(extract(value, "monitor.list")); }
export function parseMonitorStatusRequest(value: unknown): MonitorResourceInput { return parseMonitorResource(value, "monitor.status"); }
export function parseMonitorUpdateRequest(value: unknown): MonitorUpdateInput {
  const input = MonitorUpdateInputSchema.parse(extract(value, "monitor.update"));
  return { monitorId: input.monitorId as MonitorId, confirmed: true, timeoutMs: input.timeoutMs, ...(input.name ? { name: input.name } : {}), ...(input.query ? { query: input.query } : {}), ...(input.numResults === undefined ? {} : { numResults: input.numResults }), ...(input.period ? { period: input.period } : {}) };
}
export function parseMonitorPauseRequest(value: unknown): ConfirmedMonitorResourceInput { return parseConfirmedMonitorResource(value, "monitor.pause"); }
export function parseMonitorResumeRequest(value: unknown): ConfirmedMonitorResourceInput { return parseConfirmedMonitorResource(value, "monitor.resume"); }
export function parseMonitorTriggerRequest(value: unknown): ConfirmedMonitorResourceInput { return parseConfirmedMonitorResource(value, "monitor.trigger"); }
export function parseMonitorDeleteRequest(value: unknown): ConfirmedMonitorResourceInput { return parseConfirmedMonitorResource(value, "monitor.delete"); }
export function parseMonitorRunsRequest(value: unknown): MonitorRunsInput { const input = MonitorRunsInputSchema.parse(extract(value, "monitor.runs")); return { ...input, monitorId: input.monitorId as MonitorId }; }
export function parseMonitorRunGetRequest(value: unknown): MonitorRunGetInput { const input = MonitorRunGetInputSchema.parse(extract(value, "monitor.run.get")); return { ...input, monitorId: input.monitorId as MonitorId, runId: input.runId as MonitorRunId }; }

function isPublicWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return false;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = 0, second = 0] = octets;
  return !(first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168));
}

function requestSchema<C extends string, S extends z.ZodType>(capability: C, input: S) {
  return z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), capability: z.literal(capability), input }).strict();
}

function extract(value: unknown, capability: keyof typeof ResourceRequestSchemas): unknown {
  return ResourceRequestSchemas[capability].parse(value).input;
}

function parseBrowserResource(value: unknown, capability: "browser.status" | "browser.close"): BrowserResourceInput {
  const input = BrowserResourceInputSchema.parse(extract(value, capability));
  return { ...input, sessionId: input.sessionId as BrowserSessionId };
}

function parseMonitorResource(value: unknown, capability: "monitor.status"): MonitorResourceInput {
  const input = MonitorResourceInputSchema.parse(extract(value, capability));
  return { ...input, monitorId: input.monitorId as MonitorId };
}

function parseConfirmedMonitorResource(value: unknown, capability: "monitor.pause" | "monitor.resume" | "monitor.trigger" | "monitor.delete"): ConfirmedMonitorResourceInput {
  const input = ConfirmedMonitorResourceInputSchema.parse(extract(value, capability));
  return { ...input, monitorId: input.monitorId as MonitorId };
}
