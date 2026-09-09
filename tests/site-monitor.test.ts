import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeSiteMonitorCheckGet, executeSiteMonitorCreate, executeSiteMonitorDelete, executeSiteMonitorPause, executeSiteMonitorStatus, executeSiteMonitorTrigger } from "../src/capabilities/site-monitor.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { parseSiteMonitorCreateRequest } from "../src/protocol/site-monitor-schema.js";
import { PROTOCOL_VERSION, type SiteMonitorCheckData, type SiteMonitorCheckId, type SiteMonitorCreateInput, type SiteMonitorData, type SiteMonitorId } from "../src/protocol/types.js";
import { FirecrawlMonitorProvider, type FirecrawlMonitorProviderContract } from "../src/providers/firecrawl-monitor.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));
const monitorId = "site-monitor-1" as SiteMonitorId;
const checkId = "check-1" as SiteMonitorCheckId;
const input: SiteMonitorCreateInput = { name: "Pricing", schedule: { type: "cron", value: "*/30 * * * *", timezone: "UTC" }, targets: [{ type: "scrape", urls: ["https://example.com/pricing"], onlyMainContent: true }], retentionDays: 30, goal: "Alert on pricing changes", judgeEnabled: true, webhookUrl: "https://example.com/hook", webhookEvents: ["monitor.page", "monitor.check.completed"], confirmed: true, timeoutMs: 30_000 };
function monitor(status: SiteMonitorData["status"] = "active"): SiteMonitorData { return { monitorId, name: "Pricing", status, schedule: { cron: "*/30 * * * *", timezone: "UTC" }, targetTypes: ["scrape"], retentionDays: 30, estimatedCreditsPerMonth: 1_440 }; }
function check(): SiteMonitorCheckData { return { checkId, monitorId, status: "completed", trigger: "manual", pages: [{ url: "https://example.com/pricing", status: "changed", diffText: "- $10\n+ $12" }] }; }
function provider(overrides: Partial<FirecrawlMonitorProviderContract> = {}): FirecrawlMonitorProviderContract {
  return { id: "firecrawl", async create() { return monitor(); }, async get() { return monitor(); }, async update(_key, value) { return monitor("status" in value ? value.status : "active"); }, async trigger() { return check(); }, async delete() {}, async checks() { return [check()]; }, async check() { return check(); }, ...overrides };
}
async function context(testProvider: FirecrawlMonitorProviderContract) { const directory = await mkdtemp(join(tmpdir(), "arkspace-site-monitor-")); directories.push(directory); return { config: defaultConfig(), statePath: join(directory, "state.json"), provider: testProvider, environment: { FIRECRAWL_API_KEY: "firecrawl-secret" } }; }

describe("Firecrawl site monitor", () => {
  it("keeps search targets separate and requires a goal when judging", () => {
    expect(() => parseSiteMonitorCreateRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.site.create", input: { ...input, targets: [{ type: "search", queries: ["agent releases"] }], goal: undefined } })).toThrow(/goal/);
    const parsed = parseSiteMonitorCreateRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.site.create", input: { ...input, targets: [{ type: "search", queries: ["agent releases"] }], goal: undefined, judgeEnabled: false } });
    expect(parsed.targets).toEqual([{ type: "search", queries: ["agent releases"], searchWindow: "24h", maxResults: 10, includeDomains: [], excludeDomains: [] }]);
  });

  it("creates owned monitors and reports explicit pricing evidence without secrets", async () => {
    const result = await executeSiteMonitorCreate(input, await context(provider()));
    expect(result).toMatchObject({ ok: true, data: { monitorId, estimatedCreditsPerMonth: 1_440 }, warnings: [expect.stringMatching(/1440 credits/), expect.stringMatching(/persists/)] });
    expect(JSON.stringify(result)).not.toContain("firecrawl-secret");
  });

  it("pins every follow-up operation to the creating key and removes ownership on delete", async () => {
    const keys: string[] = [];
    const execution = await context(provider({ async get(key) { keys.push(key); return monitor(); }, async update(key, value) { keys.push(key); return monitor("status" in value ? value.status : "active"); }, async trigger(key) { keys.push(key); return check(); }, async check(key) { keys.push(key); return check(); }, async delete(key) { keys.push(key); } }));
    await executeSiteMonitorCreate(input, execution);
    await executeSiteMonitorStatus({ monitorId, timeoutMs: 30_000 }, execution);
    await executeSiteMonitorPause({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution);
    await executeSiteMonitorTrigger({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution);
    await executeSiteMonitorCheckGet({ monitorId, checkId, limit: 25, timeoutMs: 30_000 }, execution);
    expect(await executeSiteMonitorDelete({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution)).toMatchObject({ ok: true, data: { status: "deleted" } });
    expect(keys).toEqual(Array(5).fill("firecrawl-secret"));
    expect(await executeSiteMonitorStatus({ monitorId, timeoutMs: 30_000 }, execution)).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
  });

  it("does not retry a mutation whose remote outcome is unknown", async () => {
    let calls = 0;
    const execution = await context(provider({ async trigger() { calls += 1; throw new ProviderError("lost response", { kind: "network" }); } }));
    await executeSiteMonitorCreate(input, execution);
    const result = await executeSiteMonitorTrigger({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution);
    expect(result).toMatchObject({ ok: false, error: { retryable: false }, attempts: [{ safeToRetry: false }] });
    expect(calls).toBe(1);
  });

  it("maps bounded targets to the official Firecrawl v2 request", async () => {
    let requestBody: unknown;
    const fetcher = async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => { requestBody = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ success: true, data: { id: monitorId, name: "Pricing", status: "active", schedule: { cron: "*/30 * * * *", timezone: "UTC" }, targets: [{ type: "scrape" }], retentionDays: 30, estimatedCreditsPerMonth: 1440 } }), { status: 200, headers: { "content-type": "application/json" } }); };
    const result = await new FirecrawlMonitorProvider(fetcher, "https://api.firecrawl.dev").create("secret", input);
    expect(result).toMatchObject({ monitorId, targetTypes: ["scrape"] });
    expect(requestBody).toMatchObject({ schedule: { cron: "*/30 * * * *", timezone: "UTC" }, targets: [{ type: "scrape", scrapeOptions: { formats: ["markdown"], maxAge: 0, onlyMainContent: true } }], webhook: { url: "https://example.com/hook", events: ["monitor.page", "monitor.check.completed"] } });
    expect(JSON.stringify(requestBody)).not.toContain("secret");
  });
});
