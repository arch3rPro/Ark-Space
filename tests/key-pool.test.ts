import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";

import { defaultConfig } from "../src/config/schema.js";
import { readPublicState, recordKeyResult, selectCredential } from "../src/key-pool/key-pool.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("key pool", () => {
  it("selects concurrent callers through one round-robin transaction", async () => {
    const statePath = await temporaryStatePath();
    const config = defaultConfig().providers.exa!;
    config.keyRefs = ["env:EXA_API_KEY_1", "env:EXA_API_KEY_2"];
    const environment = { EXA_API_KEY_1: "secret-one", EXA_API_KEY_2: "secret-two" };

    const leases = await Promise.all([
      selectCredential(statePath, "exa", config, environment),
      selectCredential(statePath, "exa", config, environment),
    ]);

    expect(new Set(leases.map((lease) => lease.value))).toEqual(new Set(["secret-one", "secret-two"]));
    const persisted = await readFile(statePath, "utf8");
    expect(persisted).not.toContain("secret-one");
    expect(persisted).not.toContain("EXA_API_KEY_1");
  });

  it("cools a rate-limited key and selects the next key", async () => {
    const statePath = await temporaryStatePath();
    const config = defaultConfig().providers.exa!;
    config.keyRefs = ["env:EXA_API_KEY_1", "env:EXA_API_KEY_2"];
    const environment = { EXA_API_KEY_1: "secret-one", EXA_API_KEY_2: "secret-two" };
    const now = 1_000_000;

    const first = await selectCredential(statePath, "exa", config, environment, now);
    await recordKeyResult(statePath, "exa", first.keyId, config, { ok: false, kind: "rate-limit" }, now);
    const second = await selectCredential(statePath, "exa", config, environment, now);

    expect(first.value).toBe("secret-one");
    expect(second.value).toBe("secret-two");
    const state = await readPublicState(statePath);
    expect(state.providers.exa?.keys[first.keyId]?.status).toBe("cooldown");
  });

  it("disables an invalid key without storing its value", async () => {
    const statePath = await temporaryStatePath();
    const config = defaultConfig().providers.tavily!;
    const lease = await selectCredential(statePath, "tavily", config, { TAVILY_API_KEY: "bad-secret" });

    await recordKeyResult(statePath, "tavily", lease.keyId, config, { ok: false, kind: "auth" });

    await expect(selectCredential(statePath, "tavily", config, { TAVILY_API_KEY: "bad-secret" })).rejects.toThrow(
      /no usable API key/,
    );
    expect(await readFile(statePath, "utf8")).not.toContain("bad-secret");
  });
});

async function temporaryStatePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-key-pool-"));
  directories.push(directory);
  return join(directory, "state.json");
}
