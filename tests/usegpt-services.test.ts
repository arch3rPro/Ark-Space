import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { daemonStatus } from "../src/usegpt/daemon.js";
import { startUseGptService, stopUseGptService } from "../src/usegpt/services.js";
import { initializeConfig } from "../src/config/store.js";
import { saveUseGptConfig } from "../src/config/usegpt.js";
import { resolveArkSpacePaths } from "../src/config/paths.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../src/usegpt/daemon.js", () => ({ defaultDaemonDataDir: () => "/unused-fixture-default", daemonStatus: vi.fn() }));
const homes: string[] = [];
afterEach(async () => { vi.resetAllMocks(); await Promise.all(homes.splice(0).map(h => rm(h, { recursive: true, force: true }))); });
async function fixture(configured: boolean) {
  const home = await mkdtemp(join(tmpdir(), "arks-services-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home }); await initializeConfig(paths.config);
  await saveUseGptConfig(paths, { enabled: configured, tunnelId: "tunnel_fixture_12345678", dataDir: join(home, "data"), apiKeyRef: "env:CONTROL_PLANE_API_KEY" });
  vi.mocked(daemonStatus).mockResolvedValue({ running: false, dataDir: join(home, "data") });
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    queueMicrotask(() => child.emit("close", 0));
    return child as unknown as ReturnType<typeof spawn>;
  });
  return { environment: { ARKSPACE_HOME: home, CONTROL_PLANE_API_KEY: "fixture-key-secret" }, dataDir: join(home, "data") };
}

it.each(["daemon", "tunnel"] as const)("unconfigured %s start never spawns a process", async service => {
  const { environment } = await fixture(false);
  await expect(startUseGptService(service, environment)).rejects.toThrow(/incomplete/);
  expect(spawn).not.toHaveBeenCalled();
});

it.each(["daemon", "tunnel"] as const)("starting %s spawns only that service and returns independent statuses", async service => {
  const { environment, dataDir } = await fixture(true);
  if (service === "daemon") vi.mocked(daemonStatus).mockResolvedValueOnce({ running: false, dataDir }).mockResolvedValue({ running: true, dataDir });
  else {
    await mkdir(join(dataDir, ".tunnel"), { recursive: true });
    await writeFile(join(dataDir, ".tunnel", "tunnel.json"), JSON.stringify({ pid: process.pid }));
  }
  const result = await startUseGptService(service, environment);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([expect.any(String), "usegpt", service, "start", "--data-dir", dataDir]);
  expect(result.daemonRunning).toBe(service === "daemon");
  expect(result.tunnelRunning).toBe(service === "tunnel");
});

it.each(["daemon", "tunnel"] as const)("stopping %s needs no complete configuration and never stops the other service", async service => {
  const { environment, dataDir } = await fixture(false);
  const result = await stopUseGptService(service, environment);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual([expect.any(String), "usegpt", service, "stop", "--data-dir", dataDir]);
  expect(result.configured).toBe(false);
});
