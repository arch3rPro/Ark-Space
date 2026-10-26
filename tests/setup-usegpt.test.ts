import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { initializeConfig, loadConfig } from "../src/config/store.js";
import { loadUseGptConfig } from "../src/config/usegpt.js";
import { loadCredentialStore, storeCredential } from "../src/config/credentials.js";
import { SetupUseGpt } from "../src/cli/setup-usegpt.js";
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
  expect(f.form.mock.calls[0]![1].fields.map(field => field.value)).toEqual(["", join(homedir(), ".arkspace", "usegpt")]);
  expect(await loadUseGptConfig(f.paths)).toEqual({ enabled: true, tunnelId: "tunnel_6adf656e25b0819193d9b98204ac4ced", apiKeyRef: "env:CONTROL_PLANE_API_KEY", dataDir: "/tmp/arkspace-usegpt" });
  const config = await readFile(f.paths.config, "utf8");
  expect(config).not.toContain("fixture-private-key");
  expect(config).not.toContain("CONTROL_PLANE_API_KEY\": \"fixture");
});

it("shows API key readiness without displaying or editing the secret", async () => {
  const f = await fixture({ CONTROL_PLANE_API_KEY: "fixture-private-key" });
  await f.run();
  expect(f.views[0]!.cells[2]![1]).toContain("CONTROL_PLANE_API_KEY");
  expect(f.views[0]!.cells[2]![1]).toContain("environment override");
  expect(f.form.mock.calls[0]![1].notes).toContain("API key is entered hidden");
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

it("saves a key with a masked field and private permissions without placing it in config", async () => {
  const f = await fixture();
  f.commands.splice(0, f.commands.length, "right", "down", "down", "e", "escape", "escape");
  f.form.mockResolvedValueOnce(["local-private-key"]);
  await f.run();
  expect(f.form.mock.calls[0]![1].fields[0]).toEqual({ label: "*API key", value: "", secret: true });
  expect((await loadCredentialStore(f.paths.credentials)).values.CONTROL_PLANE_API_KEY).toBe("local-private-key");
  expect(await readFile(f.paths.config, "utf8")).not.toContain("local-private-key");
  if (process.platform !== "win32") expect((await stat(f.paths.credentials)).mode & 0o777).toBe(0o600);
  expect(JSON.stringify([f.views, f.notice.mock.calls])).not.toContain("local-private-key");
});

it("preloads the saved key masked, preserves it on cancel, and confirms replacement", async () => {
  const f = await fixture();
  await storeCredential(f.paths.credentials, "CONTROL_PLANE_API_KEY", "original-private-key");
  f.commands.splice(0, f.commands.length, "right", "down", "down", "e", "escape", "escape");
  await f.run();
  expect(f.form.mock.calls[0]![1].fields[0]).toEqual({ label: "*API key", value: "original-private-key", secret: true });
  expect((await loadCredentialStore(f.paths.credentials)).values.CONTROL_PLANE_API_KEY).toBe("original-private-key");
  const page = new SetupUseGpt(f.paths, f.terminal, {}, () => "en");
  f.form.mockResolvedValueOnce(["replacement-private-key"]);
  f.confirm.mockResolvedValueOnce(false);
  await page.act("edit", () => f.views[0]!, 2);
  expect(f.confirm.mock.calls.at(-1)?.[1]).toBe("Replace saved API key");
  expect((await loadCredentialStore(f.paths.credentials)).values.CONTROL_PLANE_API_KEY).toBe("original-private-key");
  f.form.mockResolvedValueOnce(["replacement-private-key"]);
  await page.act("edit", () => f.views[0]!, 2);
  expect((await loadCredentialStore(f.paths.credentials)).values.CONTROL_PLANE_API_KEY).toBe("replacement-private-key");
});

it("retries invalid key input without exposing it in errors", async () => {
  const f = await fixture();
  f.commands.splice(0, f.commands.length, "right", "down", "down", "e", "escape", "escape");
  f.form.mockResolvedValueOnce(["bad\u0000key"]).mockResolvedValueOnce(undefined);
  await f.run();
  expect(f.form.mock.calls[1]![1].error).toContain("control characters");
  expect(f.form.mock.calls[1]![1].fields[0]!.value).toBe("");
  expect((await loadCredentialStore(f.paths.credentials)).values).toEqual({});
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
