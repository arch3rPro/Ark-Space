import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeMonitorCreate, executeMonitorDelete, executeMonitorList, executeMonitorPause, executeMonitorRuns, executeMonitorStatus, executeMonitorTrigger } from "../src/capabilities/monitor.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import type { MonitorData, MonitorId, MonitorRunId } from "../src/protocol/types.js";
import type { MonitorProvider } from "../src/providers/exa-monitor.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

const monitorId = "monitor-1" as MonitorId;
function monitor(status: MonitorData["status"] = "active"): MonitorData { return { monitorId, name: "Tracker", status, query: "new agent tools", numResults: 10, period: "1d", createdAt: "2026-01-01T00:00:00.000Z" }; }
function provider(overrides: Partial<MonitorProvider> = {}): MonitorProvider {
  return {
    id: "exa",
    async create() { return { monitor: monitor(), webhookSecret: "whsec-never-log" }; },
    async get() { return monitor(); },
    async update(_key, input) { return monitor("status" in input ? input.status : "active"); },
    async trigger() { return true; },
    async delete() {},
    async runs() { return [{ runId: "run-1" as MonitorRunId, monitorId, status: "completed", results: [] }]; },
    async run() { return { runId: "run-1" as MonitorRunId, monitorId, status: "completed", results: [] }; },
    ...overrides,
  };
}
async function context(testProvider: MonitorProvider) {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-monitor-"));
  directories.push(directory);
  return { directory, execution: { config: defaultConfig(), statePath: join(directory, "state.json"), provider: testProvider, environment: { EXA_API_KEY: "exa-secret" } } };
}

describe("monitor capability", () => {
  it("stores the one-time webhook secret privately and returns only redacted evidence", async () => {
    const { directory, execution } = await context(provider());
    const secretPath = join(directory, "monitor.secret");
    const result = await executeMonitorCreate({ query: "new agent tools", numResults: 10, period: "1d", webhookUrl: "https://example.com/hook", webhookSecretPath: secretPath, confirmed: true, timeoutMs: 30_000 }, execution);
    expect(result).toMatchObject({ ok: true, data: { monitorId, webhookSecretStored: true } });
    expect(JSON.stringify(result)).not.toContain("whsec-never-log");
    expect(await readFile(secretPath, "utf8")).toBe("whsec-never-log\n");
    if (process.platform !== "win32") expect((await stat(secretPath)).mode & 0o777).toBe(0o600);
    const listed = await executeMonitorList({ limit: 10 }, execution);
    expect(listed).toMatchObject({ ok: true, data: { monitors: [{ monitorId }] } });
  });

  it("uses the creating key for status, pause, trigger, runs, and delete", async () => {
    const keys: string[] = [];
    const testProvider = provider({
      async get(key) { keys.push(key); return monitor(); },
      async update(key, input) { keys.push(key); return monitor("status" in input ? input.status : "active"); },
      async trigger(key) { keys.push(key); return true; },
      async runs(key) { keys.push(key); return []; },
      async delete(key) { keys.push(key); },
    });
    const { directory, execution } = await context(testProvider);
    await executeMonitorCreate({ query: "new agent tools", numResults: 10, period: "1d", webhookUrl: "https://example.com/hook", webhookSecretPath: join(directory, "secret"), confirmed: true, timeoutMs: 30_000 }, execution);
    await executeMonitorStatus({ monitorId, timeoutMs: 30_000 }, execution);
    await executeMonitorPause({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution);
    await executeMonitorTrigger({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution);
    await executeMonitorRuns({ monitorId, limit: 10, timeoutMs: 30_000 }, execution);
    const deleted = await executeMonitorDelete({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution);
    expect(deleted).toMatchObject({ ok: true, data: { status: "disabled" } });
    expect(keys).toEqual(["exa-secret", "exa-secret", "exa-secret", "exa-secret", "exa-secret"]);
    expect(JSON.stringify(deleted)).not.toContain("exa-secret");
  });

  it("propagates cancellation and does not retry a mutating operation after a lost response", async () => {
    let calls = 0;
    let receivedSignal: AbortSignal | undefined;
    const testProvider = provider({ async trigger(_key, _id, _timeout, signal) {
      calls += 1;
      receivedSignal = signal;
      throw new ProviderError("lost response", { kind: "network" });
    } });
    const { directory, execution: baseExecution } = await context(testProvider);
    const controller = new AbortController();
    const execution = { ...baseExecution, signal: controller.signal };
    await executeMonitorCreate({ query: "new agent tools", numResults: 10, period: "1d", webhookUrl: "https://example.com/hook", webhookSecretPath: join(directory, "secret"), confirmed: true, timeoutMs: 30_000 }, execution);
    controller.abort(new Error("cancelled"));
    const result = await executeMonitorTrigger({ monitorId, confirmed: true, timeoutMs: 30_000 }, execution);
    expect(receivedSignal).toBe(controller.signal);
    expect(receivedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { retryable: false }, attempts: [{ safeToRetry: false }] });
    expect(calls).toBe(1);
  });

  it("removes a reserved secret file when creation fails before a receipt", async () => {
    const { directory, execution } = await context(provider({ async create() { throw new ProviderError("bad request", { kind: "invalid-request" }); } }));
    const secretPath = join(directory, "secret");
    const result = await executeMonitorCreate({ query: "new agent tools", numResults: 10, period: "1d", webhookUrl: "https://example.com/hook", webhookSecretPath: secretPath, confirmed: true, timeoutMs: 30_000 }, execution);
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid-request" } });
    await expect(stat(secretPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
