import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { hasStoredCredential, loadCredentialEnvironment, storeCredential } from "../src/config/credentials.js";
import { ProviderError } from "../src/errors/provider-error.js";
import { defaultConfig } from "../src/config/schema.js";
import { selectCredential } from "../src/key-pool/key-pool.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local credential store", () => {
  it("stores keys outside configuration and loads them as environment fallbacks", async () => {
    const path = await credentialPath();

    await storeCredential(path, "EXA_API_KEY", "stored-secret");

    expect(await hasStoredCredential(path, "EXA_API_KEY")).toBe(true);
    expect(await loadCredentialEnvironment(path, {})).toMatchObject({ EXA_API_KEY: "stored-secret" });
    expect(await readFile(path, "utf8")).not.toContain("env:EXA_API_KEY");
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("lets an explicit process environment value override the local store", async () => {
    const path = await credentialPath();
    await storeCredential(path, "TAVILY_API_KEY", "stored-secret");

    const environment = await loadCredentialEnvironment(path, { TAVILY_API_KEY: "environment-secret" });

    expect(environment.TAVILY_API_KEY).toBe("environment-secret");
    const unsafeOverride = await loadCredentialEnvironment(path, { TAVILY_API_KEY: "placeholder" });
    expect(unsafeOverride.TAVILY_API_KEY).toBe("placeholder");
    await expect(
      selectCredential(join(path, "..", "state.json"), "tavily", defaultConfig().providers.tavily!, unsafeOverride),
    ).rejects.toMatchObject({ kind: "config" });
  });

  it("rejects malformed credential files at the untrusted file boundary", async () => {
    const path = await credentialPath();
    await writeFile(path, JSON.stringify({ version: 1, values: { "not valid": "secret" } }));

    await expect(loadCredentialEnvironment(path, {})).rejects.toThrow(/Invalid ArkSpace credential store/);
  });

  it.each(["  ", "change_me", "YOUR_API_KEY", "placeholder", "key_here", "secret\nheader", "\u007fsecret"]) (
    "rejects unsafe input without persisting it: %j",
    async (secret) => {
      const path = await credentialPath();
      await expect(storeCredential(path, "EXA_API_KEY", secret)).rejects.toMatchObject({ kind: "invalid-request" });
      expect(await hasStoredCredential(path, "EXA_API_KEY")).toBe(false);
    },
  );

  it.each(["  ", "placeholder", "secret\rheader", "\u0085secret"]) (
    "rejects unsafe stored values as config without leaking them: %j",
    async (secret) => {
      const path = await credentialPath();
      await writeFile(path, JSON.stringify({ version: 1, values: { EXA_API_KEY: secret } }));
      try {
        await loadCredentialEnvironment(path, {});
        throw new Error("Expected invalid credential store");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect(error).toMatchObject({ kind: "config" });
        if (secret.trim()) expect(String(error)).not.toContain(secret);
      }
    },
  );
});

async function credentialPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "arkspace-credentials-"));
  directories.push(directory);
  return join(directory, "credentials.json");
}
