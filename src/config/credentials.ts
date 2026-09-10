import { z } from "zod";

import { ProviderError } from "../errors/provider-error.js";
import { readJsonFile, withFileLock, writeJsonAtomic } from "../io/json-store.js";

const CredentialStoreSchema = z
  .object({
    version: z.literal(1),
    values: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().min(1)),
  })
  .strict();

type CredentialStore = z.infer<typeof CredentialStoreSchema>;

export async function loadCredentialEnvironment(
  path: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const store = await loadCredentialStore(path);
  return { ...store.values, ...environment };
}

export async function hasStoredCredential(path: string, variable: string): Promise<boolean> {
  const store = await loadCredentialStore(path);
  return Boolean(store.values[variable]);
}

export async function storeCredential(path: string, variable: string, secret: string): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
    throw new ProviderError("Credential names must contain only letters, digits, and underscores.", {
      kind: "invalid-request",
    });
  }
  const value = secret.trim();
  if (!value) throw new ProviderError("Credential values cannot be empty.", { kind: "invalid-request" });

  await withFileLock(path, async () => {
    const store = await loadCredentialStore(path);
    store.values[variable] = value;
    await writeJsonAtomic(path, store);
  });
}

async function loadCredentialStore(path: string): Promise<CredentialStore> {
  const value = await readJsonFile(path);
  if (value === undefined) return { version: 1, values: {} };
  const parsed = CredentialStoreSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderError(`Invalid ArkSpace credential store at ${path}: ${parsed.error.message}`, {
      kind: "config",
    });
  }
  return parsed.data;
}
