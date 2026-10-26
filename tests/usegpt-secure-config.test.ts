import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveArkSpacePaths } from "../src/config/paths.js";
import { initializeConfig } from "../src/config/store.js";
import { saveUseGptConfig } from "../src/config/usegpt.js";
import { loadUseGptHubConfig } from "../src/usegpt/secure-config.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "arks-secure-config-")); homes.push(home);
  const paths = resolveArkSpacePaths({ ARKSPACE_HOME: home }); await initializeConfig(paths.config);
  return paths;
}

it("loads the Tunnel ID, resolves the API key from the environment, and defaults the Hub directory", async () => {
  const paths = await fixture();
  await saveUseGptConfig(paths, { enabled: true, tunnelId: "tunnel_6adf656e25b0819193d9b98204ac4ced", apiKeyRef: "env:CONTROL_PLANE_API_KEY" });
  const config = await loadUseGptHubConfig(paths, { CONTROL_PLANE_API_KEY: "fixture-private-key" });
  expect(config.tunnelId).toBe("tunnel_6adf656e25b0819193d9b98204ac4ced");
  expect(config.apiKey).toBe("fixture-private-key");
  expect(config.dataDir).toMatch(/\.arkspace[\\/]usegpt$/);
});

it("rejects a missing or invalid API key without exposing it", async () => {
  const paths = await fixture();
  await saveUseGptConfig(paths, { enabled: true, tunnelId: "tunnel_6adf656e25b0819193d9b98204ac4ced", apiKeyRef: "env:CONTROL_PLANE_API_KEY" });
  await expect(loadUseGptHubConfig(paths, {})).rejects.toThrow("CONTROL_PLANE_API_KEY");
  await expect(loadUseGptHubConfig(paths, { CONTROL_PLANE_API_KEY: "\u0000secret" })).rejects.toThrow("CONTROL_PLANE_API_KEY");
});

it("uses an explicitly configured absolute data directory", async () => {
  const paths = await fixture();
  const dataDir = join(paths.home, "hub-data");
  await saveUseGptConfig(paths, { enabled: true, tunnelId: "tunnel_6adf656e25b0819193d9b98204ac4ced", apiKeyRef: "env:CONTROL_PLANE_API_KEY", dataDir });
  await expect(loadUseGptHubConfig(paths, { CONTROL_PLANE_API_KEY: "fixture-private-key" })).resolves.toMatchObject({ dataDir });
});
