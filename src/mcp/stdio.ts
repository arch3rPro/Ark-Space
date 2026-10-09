import process from "node:process";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { resolveArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { createMcpServer } from "./server.js";
import type { InvokeOptions } from "../protocol/invoke.js";

export function serveArkSpaceStdio(options: InvokeOptions = {}): StdioServerHandle {
  // CLI passes its pre-hydration snapshot; direct startup captures at entry.
  const originalEnvironment = { ...(options.originalEnvironment ?? process.env) };
  const paths = options.paths ?? resolveArkSpacePaths(originalEnvironment);
  const handle = serveStdio(async () => createMcpServer(await loadConfig(paths.config), { ...options, paths, originalEnvironment }), {
    onerror(error) {
      process.stderr.write(`arks mcp: ${error.message}\n`);
    },
  });
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    void handle.close().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown shutdown failure";
      process.stderr.write(`arks mcp: ${message}\n`);
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return handle;
}
