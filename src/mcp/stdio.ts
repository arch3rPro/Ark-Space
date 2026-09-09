import process from "node:process";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { createMcpServer } from "./server.js";

export function serveArkSpaceStdio(): StdioServerHandle {
  const handle = serveStdio(createMcpServer, {
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
