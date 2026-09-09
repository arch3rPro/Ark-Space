import { z } from "zod";

import { ProviderError } from "../errors/provider-error.js";
import type { ConfirmedSiteMonitorResourceInput, SiteMonitorCheckData, SiteMonitorCheckGetInput, SiteMonitorCheckId, SiteMonitorChecksInput, SiteMonitorCreateInput, SiteMonitorData, SiteMonitorId, SiteMonitorSummary, SiteMonitorUpdateInput } from "../protocol/types.js";
import { postJson, requestJson, type FetchLike } from "./http.js";

const SummarySchema = z.object({ totalPages: z.number().int().optional(), same: z.number().int().optional(), changed: z.number().int().optional(), new: z.number().int().optional(), removed: z.number().int().optional(), error: z.number().int().optional() }).passthrough();
const MonitorSchema = z.object({
  id: z.string().min(1), name: z.string().optional(), status: z.string(),
  schedule: z.object({ cron: z.string(), timezone: z.string().optional() }).passthrough().optional(),
  targets: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  retentionDays: z.number().int().optional(), estimatedCreditsPerMonth: z.number().int().nullable().optional(),
  goal: z.string().nullable().optional(), judgeEnabled: z.boolean().optional(), nextRunAt: z.string().nullable().optional(), lastRunAt: z.string().nullable().optional(), currentCheckId: z.string().nullable().optional(), createdAt: z.string().optional(), updatedAt: z.string().optional(),
  lastCheckSummary: SummarySchema.nullable().optional(),
}).passthrough();
const MonitorResponseSchema = z.object({ success: z.literal(true), data: MonitorSchema }).passthrough();
const CheckSchema = z.object({
  id: z.string().min(1), monitorId: z.string().min(1), status: z.string(), trigger: z.string().optional(),
  estimatedCredits: z.number().int().nullable().optional(), actualCredits: z.number().int().nullable().optional(), billingStatus: z.string().optional(), summary: SummarySchema.nullable().optional(), error: z.string().nullable().optional(), startedAt: z.string().nullable().optional(), finishedAt: z.string().nullable().optional(),
  pages: z.array(z.object({ url: z.string().url(), status: z.string(), statusCode: z.number().int().nullable().optional(), error: z.string().nullable().optional(), diff: z.object({ text: z.string().optional() }).passthrough().nullable().optional() }).passthrough()).optional(),
}).passthrough();
const CheckResponseSchema = z.object({ success: z.literal(true), data: CheckSchema }).passthrough();
const ChecksResponseSchema = z.object({ success: z.literal(true), data: z.array(CheckSchema) }).passthrough();
const TriggerResponseSchema = z.object({ success: z.literal(true), id: z.string().optional(), data: CheckSchema.optional() }).passthrough();

export interface FirecrawlMonitorProviderContract {
  readonly id: "firecrawl";
  create(key: string, input: SiteMonitorCreateInput, signal?: AbortSignal): Promise<SiteMonitorData>;
  get(key: string, monitorId: SiteMonitorId, timeoutMs: number, signal?: AbortSignal): Promise<SiteMonitorData>;
  update(key: string, input: SiteMonitorUpdateInput | (ConfirmedSiteMonitorResourceInput & { status: "active" | "paused" }), signal?: AbortSignal): Promise<SiteMonitorData>;
  trigger(key: string, monitorId: SiteMonitorId, timeoutMs: number, signal?: AbortSignal): Promise<SiteMonitorCheckData>;
  delete(key: string, monitorId: SiteMonitorId, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  checks(key: string, input: SiteMonitorChecksInput, signal?: AbortSignal): Promise<SiteMonitorCheckData[]>;
  check(key: string, input: SiteMonitorCheckGetInput, signal?: AbortSignal): Promise<SiteMonitorCheckData>;
}

export class FirecrawlMonitorProvider implements FirecrawlMonitorProviderContract {
  readonly id = "firecrawl" as const;
  constructor(private readonly fetcher: FetchLike = fetch, private readonly baseUrl = "https://api.firecrawl.dev") {}

  async create(key: string, input: SiteMonitorCreateInput, signal?: AbortSignal): Promise<SiteMonitorData> {
    const value = await timed(input.timeoutMs, signal, (requestSignal) => postJson(this.fetcher, this.id, `${this.baseUrl}/v2/monitor`, auth(key), createBody(input), requestSignal));
    return parseMonitor(value, "create");
  }

  async get(key: string, monitorId: SiteMonitorId, timeoutMs: number, signal?: AbortSignal): Promise<SiteMonitorData> {
    const value = await timed(timeoutMs, signal, (requestSignal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/v2/monitor/${encodeURIComponent(monitorId)}`, { method: "GET", headers: auth(key), signal: requestSignal }));
    return parseMonitor(value, "get");
  }

  async update(key: string, input: SiteMonitorUpdateInput | (ConfirmedSiteMonitorResourceInput & { status: "active" | "paused" }), signal?: AbortSignal): Promise<SiteMonitorData> {
    const body = "status" in input ? { status: input.status } : updateBody(input);
    const value = await timed(input.timeoutMs, signal, (requestSignal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/v2/monitor/${encodeURIComponent(input.monitorId)}`, { method: "PATCH", headers: { "content-type": "application/json", ...auth(key) }, body: JSON.stringify(body), signal: requestSignal }));
    return parseMonitor(value, "update");
  }

  async trigger(key: string, monitorId: SiteMonitorId, timeoutMs: number, signal?: AbortSignal): Promise<SiteMonitorCheckData> {
    const value = await timed(timeoutMs, signal, (requestSignal) => postJson(this.fetcher, this.id, `${this.baseUrl}/v2/monitor/${encodeURIComponent(monitorId)}/run`, auth(key), {}, requestSignal));
    const parsed = TriggerResponseSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("trigger");
    if (parsed.data.data) return normalizeCheck(parsed.data.data);
    if (parsed.data.id) return { checkId: parsed.data.id as SiteMonitorCheckData["checkId"], monitorId, status: "queued", trigger: "manual", pages: [] };
    throw invalidResponse("trigger");
  }

  async delete(key: string, monitorId: SiteMonitorId, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    try {
      await timed(timeoutMs, signal, (requestSignal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/v2/monitor/${encodeURIComponent(monitorId)}`, { method: "DELETE", headers: auth(key), signal: requestSignal }));
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return;
      throw error;
    }
  }

  async checks(key: string, input: SiteMonitorChecksInput, signal?: AbortSignal): Promise<SiteMonitorCheckData[]> {
    const value = await timed(input.timeoutMs, signal, (requestSignal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/v2/monitor/${encodeURIComponent(input.monitorId)}/checks?limit=${input.limit}&offset=0`, { method: "GET", headers: auth(key), signal: requestSignal }));
    const parsed = ChecksResponseSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("checks");
    return parsed.data.data.map(normalizeCheck);
  }

  async check(key: string, input: SiteMonitorCheckGetInput, signal?: AbortSignal): Promise<SiteMonitorCheckData> {
    const value = await timed(input.timeoutMs, signal, (requestSignal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/v2/monitor/${encodeURIComponent(input.monitorId)}/checks/${encodeURIComponent(input.checkId)}?limit=${input.limit}&skip=0`, { method: "GET", headers: auth(key), signal: requestSignal }));
    const parsed = CheckResponseSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("check");
    return normalizeCheck(parsed.data.data);
  }
}

function createBody(input: SiteMonitorCreateInput): Record<string, unknown> {
  return { name: input.name, schedule: scheduleBody(input.schedule), targets: input.targets.map(targetBody), retentionDays: input.retentionDays, ...(input.goal ? { goal: input.goal } : {}), judgeEnabled: input.judgeEnabled, ...(input.webhookUrl ? { webhook: { url: input.webhookUrl, events: input.webhookEvents } } : {}) };
}
function updateBody(input: SiteMonitorUpdateInput): Record<string, unknown> {
  return { ...(input.name ? { name: input.name } : {}), ...(input.schedule ? { schedule: scheduleBody(input.schedule) } : {}), ...(input.targets ? { targets: input.targets.map(targetBody) } : {}), ...(input.retentionDays === undefined ? {} : { retentionDays: input.retentionDays }), ...(input.goal ? { goal: input.goal } : {}), ...(input.judgeEnabled === undefined ? {} : { judgeEnabled: input.judgeEnabled }), ...(input.webhookUrl ? { webhook: { url: input.webhookUrl, events: input.webhookEvents ?? ["monitor.page", "monitor.check.completed"] } } : {}) };
}
function scheduleBody(schedule: SiteMonitorCreateInput["schedule"]): Record<string, string> { return { [schedule.type]: schedule.value, timezone: schedule.timezone }; }
function targetBody(target: SiteMonitorCreateInput["targets"][number]): Record<string, unknown> {
  switch (target.type) {
    case "scrape": return { type: "scrape", urls: target.urls, scrapeOptions: { formats: ["markdown"], maxAge: 0, onlyMainContent: target.onlyMainContent } };
    case "crawl": return { type: "crawl", url: target.url, crawlOptions: { limit: target.limit, maxDepth: target.maxDepth, includePaths: target.includePaths, excludePaths: target.excludePaths }, scrapeOptions: { formats: ["markdown"], maxAge: 0, onlyMainContent: target.onlyMainContent } };
    case "search": return { type: "search", queries: target.queries, searchWindow: target.searchWindow, maxResults: target.maxResults, includeDomains: target.includeDomains, excludeDomains: target.excludeDomains };
  }
}
function parseMonitor(value: unknown, operation: string): SiteMonitorData {
  const parsed = MonitorResponseSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse(operation);
  return normalizeMonitor(parsed.data.data);
}
function normalizeMonitor(value: z.infer<typeof MonitorSchema>): SiteMonitorData {
  const targetTypes: SiteMonitorData["targetTypes"] = (value.targets ?? []).flatMap((target) => target.type === "scrape" || target.type === "crawl" || target.type === "search" ? [target.type] : []);
  return { monitorId: value.id as SiteMonitorId, ...(value.name ? { name: value.name } : {}), status: value.status === "active" || value.status === "paused" || value.status === "deleted" ? value.status : "unknown", ...(value.schedule ? { schedule: { cron: value.schedule.cron, timezone: value.schedule.timezone ?? "UTC" } } : {}), targetTypes, ...(value.retentionDays === undefined ? {} : { retentionDays: value.retentionDays }), ...(value.goal ? { goal: value.goal } : {}), ...(value.judgeEnabled === undefined ? {} : { judgeEnabled: value.judgeEnabled }), ...(value.nextRunAt ? { nextRunAt: value.nextRunAt } : {}), ...(value.lastRunAt ? { lastRunAt: value.lastRunAt } : {}), ...(value.currentCheckId ? { currentCheckId: value.currentCheckId as SiteMonitorCheckId } : {}), ...(value.estimatedCreditsPerMonth === undefined || value.estimatedCreditsPerMonth === null ? {} : { estimatedCreditsPerMonth: value.estimatedCreditsPerMonth }), ...(value.lastCheckSummary ? { lastCheckSummary: normalizeSummary(value.lastCheckSummary) } : {}), ...(value.createdAt ? { createdAt: value.createdAt } : {}), ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}) };
}
function normalizeCheck(value: z.infer<typeof CheckSchema>): SiteMonitorCheckData {
  return { checkId: value.id as SiteMonitorCheckData["checkId"], monitorId: value.monitorId as SiteMonitorId, status: checkStatus(value.status), ...(value.trigger === "manual" || value.trigger === "scheduled" ? { trigger: value.trigger } : {}), ...(value.estimatedCredits === undefined || value.estimatedCredits === null ? {} : { estimatedCredits: value.estimatedCredits }), ...(value.actualCredits === undefined || value.actualCredits === null ? {} : { actualCredits: value.actualCredits }), ...(value.billingStatus ? { billingStatus: value.billingStatus } : {}), ...(value.summary ? { summary: normalizeSummary(value.summary) } : {}), ...(value.error ? { error: value.error } : {}), ...(value.startedAt ? { startedAt: value.startedAt } : {}), ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}), pages: (value.pages ?? []).map((page) => ({ url: page.url, status: page.status === "same" || page.status === "new" || page.status === "changed" || page.status === "removed" || page.status === "error" ? page.status : "unknown", ...(page.statusCode === undefined || page.statusCode === null ? {} : { statusCode: page.statusCode }), ...(page.error ? { error: page.error } : {}), ...(page.diff?.text ? { diffText: page.diff.text.slice(0, 100_000) } : {}) })) };
}
function normalizeSummary(value: z.infer<typeof SummarySchema>): SiteMonitorSummary { return { totalPages: value.totalPages ?? 0, same: value.same ?? 0, changed: value.changed ?? 0, new: value.new ?? 0, removed: value.removed ?? 0, error: value.error ?? 0 }; }
function checkStatus(value: string): SiteMonitorCheckData["status"] { return value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "partial" || value === "skipped_overlap" || value === "skipped_no_credits" ? value : "unknown"; }
function auth(key: string): Record<string, string> { return { authorization: `Bearer ${key}` }; }
function invalidResponse(operation: string): ProviderError { return new ProviderError(`firecrawl returned an invalid site Monitor ${operation} response.`, { kind: "invalid-response" }); }
async function timed<T>(timeoutMs: number, externalSignal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); const onAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onAbort(); else externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Site Monitor request timed out.")), timeoutMs);
  try { return await action(controller.signal); } finally { clearTimeout(timer); externalSignal?.removeEventListener("abort", onAbort); }
}
