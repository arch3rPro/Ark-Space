import { readFileSync } from "node:fs";

function readVersion(): string {
  try {
    const metadata: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    if (metadata && typeof metadata === "object" && "name" in metadata && metadata.name === "@arkspace/cli" &&
        "version" in metadata && typeof metadata.version === "string" && metadata.version.length <= 50 &&
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(metadata.version) &&
        metadata.version.split(/[+-]/, 1)[0]?.split(".").every(part => Number.isSafeInteger(Number(part)))) return metadata.version;
  } catch { /* Report only a fixed message, never raw package metadata. */ }
  throw new Error("ArkSpace package metadata is missing or invalid; reinstall @arkspace/cli.");
}

export const VERSION = readVersion();
