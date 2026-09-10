import process from "node:process";
import { createInterface } from "node:readline/promises";

import { hasStoredCredential, loadCredentialEnvironment, storeCredential } from "../config/credentials.js";
import type { ArkSpacePaths } from "../config/paths.js";
import { initializeConfig } from "../config/store.js";

const PROVIDERS = [
  {
    name: "Exa",
    variable: "EXA_API_KEY",
    url: "https://dashboard.exa.ai/api-keys",
  },
  {
    name: "Tavily",
    variable: "TAVILY_API_KEY",
    url: "https://app.tavily.com/home",
  },
  {
    name: "Firecrawl",
    variable: "FIRECRAWL_API_KEY",
    url: "https://www.firecrawl.dev/app/api-keys",
  },
] as const;

export async function runSetup(paths: ArkSpacePaths): Promise<void> {
  await initializeConfig(paths.config);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(
      `ArkSpace configuration ready at ${paths.config}\n` +
        "API keys were not requested because this is not an interactive terminal.\n" +
        "Run `arks setup` in a trusted local terminal to configure credentials securely.\n",
    );
    return;
  }

  process.stdout.write(
    "\nArkSpace secure setup\n" +
      "Run this wizard only in a trusted local terminal. Never paste an API key into an Agent chat or prompt.\n" +
      `Keys are stored in ${paths.credentials}; configuration and state contain references only.\n\n`,
  );

  for (const [index, provider] of PROVIDERS.entries()) {
    const availableFromEnvironment = Boolean(process.env[provider.variable]?.trim());
    const availableFromStore = await hasStoredCredential(paths.credentials, provider.variable);
    let current = "not configured";
    if (availableFromEnvironment) current = "available from the environment";
    else if (availableFromStore) current = "stored locally";
    process.stdout.write(`[${index + 1}/${PROVIDERS.length}] ${provider.name} — ${current}\n${provider.url}\n`);

    const configure = await askYesNo(
      availableFromEnvironment || availableFromStore ? `Replace the stored ${provider.name} key?` : `Configure ${provider.name}?`,
    );
    if (!configure) {
      process.stdout.write("Skipped.\n\n");
      continue;
    }

    const secret = await askSecret(`${provider.variable} (input hidden): `);
    await storeCredential(paths.credentials, provider.variable, secret);
    process.stdout.write(`Saved ${provider.variable} without displaying it.\n\n`);
  }

  const environment = await loadCredentialEnvironment(paths.credentials);
  process.stdout.write("Setup complete.\n");
  for (const provider of PROVIDERS) {
    process.stdout.write(`  ${provider.name}: ${environment[provider.variable]?.trim() ? "ready" : "not configured"}\n`);
  }
  process.stdout.write("Run `arks doctor` for the full readiness report.\n");
}

async function askYesNo(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const response = await prompt.question(`${question} [y/N] `);
    const answer = response.trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    prompt.close();
  }
}

async function askSecret(label: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) throw new Error("Hidden input requires an interactive terminal.");

  process.stdout.write(label);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      let value = "";
      const onData = (chunk: Buffer | string) => {
        for (const character of String(chunk)) {
          if (character === "\u0003") {
            cleanup();
            reject(new Error("Setup cancelled."));
            return;
          }
          if (character === "\r" || character === "\n") {
            cleanup();
            process.stdout.write("\n");
            resolve(value);
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else if (character >= " ") value += character;
        }
      };
      const cleanup = () => input.off("data", onData);
      input.on("data", onData);
    });
  } finally {
    input.setRawMode(Boolean(wasRaw));
    if (!wasRaw) input.pause();
  }
}
