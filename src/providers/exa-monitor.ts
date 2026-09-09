import { z } from "zod";

import { ProviderError } from "../errors/provider-error.js";
import type { MonitorCreateInput, MonitorData, MonitorId, MonitorRunData, MonitorRunId, MonitorUpdateInput, WebSearchResult } from "../protocol/types.js";
import { postJson, requestJson, type FetchLike } from "./http.js";

const MonitorSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable().optional(),
  status: z.string(),
  search: z.object({ query: z.string(), numResults: z.number().int().optional() }).passthrough().optional(),
  trigger: z.object({ type: z.string(), period: z.string() }).nullable().optional(),
  nextRunAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  webhookSecret: z.string().min(1).optional(),
}).passthrough();
const TriggerSchema = z.object({ triggered: z.boolean() }).passthrough();
const RunSchema = z.object({
  id: z.string().min(1),
  monitorId: z.string().min(1),
  status: z.string(),
  output: z.object({
    results: z.array(z.object({ title: z.string().optional(), url: z.string().url(), text: z.string().optional(), highlights: z.array(z.string()).optional(), publishedDate: z.string().optional() }).passthrough()).optional(),
    content: z.unknown().optional(),
  }).passthrough().nullable().optional(),
  failReason: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
}).passthrough();
const RunsSchema = z.object({ data: z.array(RunSchema) }).passthrough();

export interface CreatedMonitor {
  monitor: MonitorData;
  webhookSecret: string;
}

export interface MonitorProvider {
  readonly id: "exa";
  create(key: string, input: MonitorCreateInput, signal?: AbortSignal): Promise<CreatedMonitor>;
  get(key: string, monitorId: MonitorId, timeoutMs: number, signal?: AbortSignal): Promise<MonitorData>;
  update(key: string, input: MonitorUpdateInput | { monitorId: MonitorId; confirmed: true; timeoutMs: number; status: "active" | "paused" }, signal?: AbortSignal): Promise<MonitorData>;
  trigger(key: string, monitorId: MonitorId, timeoutMs: number, signal?: AbortSignal): Promise<boolean>;
  delete(key: string, monitorId: MonitorId, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  runs(key: string, monitorId: MonitorId, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<MonitorRunData[]>;
  run(key: string, monitorId: MonitorId, runId: MonitorRunId, timeoutMs: number, signal?: AbortSignal): Promise<MonitorRunData>;
}

export class ExaMonitorProvider implements MonitorProvider {
  readonly id = "exa" as const;

  constructor(private readonly fetcher: FetchLike = fetch, private readonly baseUrl = "https://api.exa.ai") {}

  async create(key: string, input: MonitorCreateInput, externalSignal?: AbortSignal): Promise<CreatedMonitor> {
    const value = await timed(input.timeoutMs, externalSignal, (signal) => postJson(this.fetcher, this.id, `${this.baseUrl}/monitors`, auth(key), {
      ...(input.name ? { name: input.name } : {}),
      search: { query: input.query, numResults: input.numResults },
      trigger: { type: "interval", period: input.period },
      webhook: { url: input.webhookUrl, events: ["monitor.run.completed"] },
    }, signal));
    const parsed = MonitorSchema.safeParse(value);
    if (!parsed.success || !parsed.data.webhookSecret) throw invalidResponse("create");
    return { monitor: normalizeMonitor(parsed.data), webhookSecret: parsed.data.webhookSecret };
  }

  async get(key: string, monitorId: MonitorId, timeoutMs: number, externalSignal?: AbortSignal): Promise<MonitorData> {
    const value = await timed(timeoutMs, externalSignal, (signal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/monitors/${encodeURIComponent(monitorId)}`, { method: "GET", headers: auth(key), signal }));
    const parsed = MonitorSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("get");
    return normalizeMonitor(parsed.data);
  }

  async update(key: string, input: MonitorUpdateInput | { monitorId: MonitorId; confirmed: true; timeoutMs: number; status: "active" | "paused" }, externalSignal?: AbortSignal): Promise<MonitorData> {
    const body = "status" in input ? { status: input.status } : {
      ...(input.name ? { name: input.name } : {}),
      ...(input.query !== undefined || input.numResults !== undefined ? { search: { ...(input.query ? { query: input.query } : {}), ...(input.numResults === undefined ? {} : { numResults: input.numResults }) } } : {}),
      ...(input.period ? { trigger: { type: "interval", period: input.period } } : {}),
    };
    const value = await timed(input.timeoutMs, externalSignal, (signal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/monitors/${encodeURIComponent(input.monitorId)}`, { method: "PATCH", headers: { "content-type": "application/json", ...auth(key) }, body: JSON.stringify(body), signal }));
    const parsed = MonitorSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("update");
    return normalizeMonitor(parsed.data);
  }

  async trigger(key: string, monitorId: MonitorId, timeoutMs: number, externalSignal?: AbortSignal): Promise<boolean> {
    const value = await timed(timeoutMs, externalSignal, (signal) => postJson(this.fetcher, this.id, `${this.baseUrl}/monitors/${encodeURIComponent(monitorId)}/trigger`, auth(key), {}, signal));
    const parsed = TriggerSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("trigger");
    return parsed.data.triggered;
  }

  async delete(key: string, monitorId: MonitorId, timeoutMs: number, externalSignal?: AbortSignal): Promise<void> {
    try {
      await timed(timeoutMs, externalSignal, (signal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/monitors/${encodeURIComponent(monitorId)}`, { method: "DELETE", headers: auth(key), signal }));
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return;
      throw error;
    }
  }

  async runs(key: string, monitorId: MonitorId, limit: number, timeoutMs: number, externalSignal?: AbortSignal): Promise<MonitorRunData[]> {
    const value = await timed(timeoutMs, externalSignal, (signal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/monitors/${encodeURIComponent(monitorId)}/runs?limit=${limit}`, { method: "GET", headers: auth(key), signal }));
    const parsed = RunsSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("runs");
    return parsed.data.data.map(normalizeRun);
  }

  async run(key: string, monitorId: MonitorId, runId: MonitorRunId, timeoutMs: number, externalSignal?: AbortSignal): Promise<MonitorRunData> {
    const value = await timed(timeoutMs, externalSignal, (signal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/monitors/${encodeURIComponent(monitorId)}/runs/${encodeURIComponent(runId)}`, { method: "GET", headers: auth(key), signal }));
    const parsed = RunSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("run");
    return normalizeRun(parsed.data);
  }
}

function normalizeMonitor(value: z.infer<typeof MonitorSchema>): MonitorData {
  return {
    monitorId: value.id as MonitorId,
    status: value.status === "active" || value.status === "paused" || value.status === "disabled" ? value.status : "unknown",
    ...(value.name ? { name: value.name } : {}),
    ...(value.search?.query ? { query: value.search.query } : {}),
    ...(value.search?.numResults === undefined ? {} : { numResults: value.search.numResults }),
    ...(value.trigger?.period ? { period: value.trigger.period } : {}),
    ...(value.nextRunAt ? { nextRunAt: value.nextRunAt } : {}),
    ...(value.createdAt ? { createdAt: value.createdAt } : {}),
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
  };
}

function normalizeRun(value: z.infer<typeof RunSchema>): MonitorRunData {
  const results: WebSearchResult[] = (value.output?.results ?? []).map((result) => ({
    title: result.title ?? result.url,
    url: result.url,
    snippet: (result.text ?? result.highlights?.join("\n") ?? "").slice(0, 20_000),
    ...(result.publishedDate ? { published: result.publishedDate } : {}),
  }));
  return {
    runId: value.id as MonitorRunId,
    monitorId: value.monitorId as MonitorId,
    status: value.status === "pending" || value.status === "running" || value.status === "completed" || value.status === "failed" || value.status === "cancelled" ? value.status : "unknown",
    results,
    ...(value.output?.content === undefined ? {} : { summary: stringify(value.output.content).slice(0, 100_000) }),
    ...(value.failReason ? { failReason: value.failReason } : {}),
    ...(value.startedAt ? { startedAt: value.startedAt } : {}),
    ...(value.completedAt ? { completedAt: value.completedAt } : {}),
    ...(value.durationMs === undefined || value.durationMs === null ? {} : { durationMs: value.durationMs }),
  };
}

function stringify(value: unknown): string { return typeof value === "string" ? value : JSON.stringify(value); }
function auth(key: string): Record<string, string> { return { authorization: `Bearer ${key}` }; }
function invalidResponse(operation: string): ProviderError { return new ProviderError(`exa returned an invalid Monitor ${operation} response.`, { kind: "invalid-response" }); }
async function timed<T>(timeoutMs: number, externalSignal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Monitor request timed out.")), timeoutMs);
  try { return await action(controller.signal); } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}
