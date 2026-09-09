import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeBrowserClose, executeBrowserInteract, executeBrowserOpen, executeBrowserSnapshot } from "../src/capabilities/browser.js";
import { defaultConfig } from "../src/config/schema.js";
import { ProviderError } from "../src/errors/provider-error.js";
import type { BrowserSessionId } from "../src/protocol/types.js";
import type { BrowserProvider } from "../src/providers/firecrawl-browser.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

function provider(overrides: Partial<BrowserProvider> = {}): BrowserProvider {
  return {
    id: "firecrawl",
    async create() { return { id: "session-1" as BrowserSessionId, status: "active", createdAt: "2026-01-01T00:00:00.000Z" }; },
    async execute() { return { output: "ok", exitCode: 0, killed: false }; },
    async status(_key, sessionId) { return { id: sessionId, status: "active" }; },
    async close() {},
    ...overrides,
  };
}

async function context(browserProvider: BrowserProvider) {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-browser-"));
  directories.push(directory);
  return { config: defaultConfig(), statePath: join(directory, "state.json"), provider: browserProvider, environment: { FIRECRAWL_API_KEY: "fc-secret" } };
}

describe("browser capability", () => {
  it("pins the creating credential and closes the owned session", async () => {
    const seenKeys: string[] = [];
    const testProvider = provider({
      async execute(key) { seenKeys.push(key); return { output: "opened", exitCode: 0, killed: false }; },
      async close(key) { seenKeys.push(key); },
    });
    const execution = await context(testProvider);
    const opened = await executeBrowserOpen({ url: "https://example.com", ttlSeconds: 600, activityTtlSeconds: 300, timeoutMs: 30_000 }, execution);
    expect(opened).toMatchObject({ ok: true, data: { sessionId: "session-1", status: "active" } });
    const closed = await executeBrowserClose({ sessionId: "session-1" as BrowserSessionId, timeoutMs: 30_000 }, execution);
    expect(closed).toMatchObject({ ok: true, data: { status: "closed" } });
    expect(seenKeys).toEqual(["fc-secret", "fc-secret"]);
    expect(JSON.stringify([opened, closed])).not.toContain("fc-secret");
  });

  it("closes a session when initial navigation fails", async () => {
    let closed = false;
    const execution = await context(provider({
      async execute() { throw new ProviderError("navigation failed", { kind: "network" }); },
      async close() { closed = true; },
    }));
    const result = await executeBrowserOpen({ url: "https://example.com", ttlSeconds: 600, activityTtlSeconds: 300, timeoutMs: 30_000 }, execution);
    expect(result).toMatchObject({ ok: false, attempts: [{ cleanup: { resource: "browser-session", ok: true } }] });
    expect(closed).toBe(true);
  });

  it("uses bounded structured commands for snapshots and confirmed actions", async () => {
    const commands: string[] = [];
    const execution = await context(provider({ async execute(_key, _id, command) { commands.push(command); return { output: "snapshot", exitCode: 0, killed: false }; } }));
    await executeBrowserOpen({ url: "https://example.com", ttlSeconds: 600, activityTtlSeconds: 300, timeoutMs: 30_000 }, execution);
    const snapshot = await executeBrowserSnapshot({ sessionId: "session-1" as BrowserSessionId, interactiveOnly: true, timeoutMs: 30_000 }, execution);
    const action = await executeBrowserInteract({ sessionId: "session-1" as BrowserSessionId, action: { type: "fill", ref: "@e2", text: "O'Reilly" }, confirmed: true, timeoutMs: 30_000 }, execution);
    expect(snapshot).toMatchObject({ ok: true, data: { snapshot: "snapshot" } });
    expect(action).toMatchObject({ ok: true, data: { output: "snapshot" } });
    expect(commands).toEqual([
      "agent-browser open 'https://example.com'",
      "agent-browser snapshot -i",
      "agent-browser fill @e2 'O'\"'\"'Reilly'",
    ]);
  });

  it("propagates cancellation and marks interrupted side-effectful actions unsafe to retry", async () => {
    let calls = 0;
    let receivedSignal: AbortSignal | undefined;
    const baseContext = await context(provider({ async execute(_key, _id, _command, _timeout, signal) {
      calls += 1;
      if (calls > 1) {
        receivedSignal = signal;
        throw new ProviderError("lost response", { kind: "network" });
      }
      return { output: "opened", exitCode: 0, killed: false };
    } }));
    const controller = new AbortController();
    const execution = { ...baseContext, signal: controller.signal };
    await executeBrowserOpen({ url: "https://example.com", ttlSeconds: 600, activityTtlSeconds: 300, timeoutMs: 30_000 }, execution);
    controller.abort(new Error("cancelled"));
    const result = await executeBrowserInteract({ sessionId: "session-1" as BrowserSessionId, action: { type: "click", ref: "@e1" }, confirmed: true, timeoutMs: 30_000 }, execution);
    expect(receivedSignal).toBe(controller.signal);
    expect(receivedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { retryable: false }, attempts: [{ safeToRetry: false }] });
  });
});
