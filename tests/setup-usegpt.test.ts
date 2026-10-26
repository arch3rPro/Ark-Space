import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { initializeConfig, loadConfig } from "../src/config/store.js";
import { loadUseGptConfig } from "../src/config/usegpt.js";
import { SetupTerminal, type WorkbenchView } from "../src/cli/setup-terminal.js";
import { runSetupWorkbench } from "../src/cli/setup-workbench.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });

async function fixture(environment: NodeJS.ProcessEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), "arks-setup-usegpt-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home }); await initializeConfig(paths.config);
  const terminal = new SetupTerminal(); const views: WorkbenchView[] = [];
  const commands = ["right", "e", "escape", "escape"];
  vi.spyOn(terminal, "workbench").mockImplementation(async get => { views.push(get()); return { name: commands.shift() ?? "escape" }; });
  const form = vi.spyOn(terminal, "form").mockResolvedValue(undefined);
  const confirm = vi.spyOn(terminal, "confirm").mockResolvedValue(true);
  const notice = vi.spyOn(terminal, "notice").mockResolvedValue();
  const run = () => runSetupWorkbench(paths, terminal, "en", { provider: "usegpt", environment });
  return { paths, terminal, views, commands, form, confirm, notice, run, environment };
}

it("stores the Tunnel ID and data directory without storing the API key", async () => {
  const f = await fixture({ CONTROL_PLANE_API_KEY: "fixture-private-key" });
  f.form.mockResolvedValueOnce(["tunnel_6adf656e25b0819193d9b98204ac4ced", "/tmp/arkspace-usegpt"]);
  await f.run();
  expect(f.views[0]!.title).toBe("UseGPT Artifact Hub");
  expect(f.form.mock.calls[0]![1].fields.map(field => field.value)).toEqual(["", "/root/.arkspace/usegpt"]);
  expect(await loadUseGptConfig(f.paths)).toEqual({ enabled: true, tunnelId: "tunnel_6adf656e25b0819193d9b98204ac4ced", apiKeyRef: "env:CONTROL_PLANE_API_KEY", dataDir: "/tmp/arkspace-usegpt" });
  const config = await readFile(f.paths.config, "utf8");
  expect(config).not.toContain("fixture-private-key");
  expect(config).not.toContain("CONTROL_PLANE_API_KEY\": \"fixture");
});

it("shows API key readiness without displaying or editing the secret", async () => {
  const f = await fixture({ CONTROL_PLANE_API_KEY: "fixture-private-key" });
  await f.run();
  expect(f.views[0]!.cells[2]![1]).toContain("CONTROL_PLANE_API_KEY");
  expect(f.views[0]!.cells[2]![1]).toContain("configured");
  expect(f.form.mock.calls[0]![1].notes).toContain("API key is read from the environment");
  expect(vi.spyOn(f.terminal, "previewSecret")).not.toHaveBeenCalled();
});

it("rejects invalid Tunnel IDs and paths without writing configuration", async () => {
  const f = await fixture();
  const before = await readFile(f.paths.config, "utf8");
  f.form.mockResolvedValueOnce(["wrong-id", "relative/path"]).mockResolvedValueOnce(undefined);
  await f.run();
  expect(f.form.mock.calls[1]![1].error).toContain("tunnel");
  expect(await readFile(f.paths.config, "utf8")).toBe(before);
});

it("unlinks only the binding and keeps the configured data directory untouched", async () => {
  const f = await fixture();
  f.form.mockResolvedValueOnce(["tunnel_6adf656e25b0819193d9b98204ac4ced", "/tmp/arkspace-usegpt"]);
  await f.run();
  f.commands.push("right", "d", "escape", "escape");
  await f.run();
  expect((await loadConfig(f.paths.config)).connections?.usegpt).toBeUndefined();
  expect(f.confirm.mock.calls.some(call => call[1] === "Unlink UseGPT configuration" && call[2].includes("Stored task data"))).toBe(true);
});
