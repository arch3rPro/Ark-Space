import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { isToolEnabled, type ArkSpaceConfig } from "../config/schema.js";
import { ResourceInputSchemas } from "../protocol/resource-schema.js";
import { CodeContextRequestSchema, ResearchRequestSchema, WebCrawlRequestSchema, WebExtractRequestSchema, WebFetchRequestSchema, WebContentGetRequestSchema, WebMapRequestSchema, WebRelatedRequestSchema, WebSearchRequestSchema } from "../protocol/schema.js";
import { invokeCapability } from "../protocol/invoke.js";
import { SiteMonitorInputSchemas } from "../protocol/site-monitor-schema.js";
import { PROTOCOL_VERSION, type Capability } from "../protocol/types.js";

const inputSchemas = {
  "web.search": WebSearchRequestSchema.shape.input,
  "web.fetch": WebFetchRequestSchema.shape.input,
  "web.content.get": WebContentGetRequestSchema.shape.input,
  "web.map": WebMapRequestSchema.shape.input,
  "web.crawl": WebCrawlRequestSchema.shape.input,
  "web.related": WebRelatedRequestSchema.shape.input,
  "web.extract": WebExtractRequestSchema.shape.input,
  "code.context": CodeContextRequestSchema.shape.input,
  "research.run": ResearchRequestSchema.shape.input,
  ...ResourceInputSchemas,
  ...SiteMonitorInputSchemas,
} as const;

const descriptions: Record<Capability, string> = {
  "web.search": "Search the web through ArkSpace provider fallback and return a Protocol v1 evidence envelope.",
  "web.fetch": "Fetch bounded content from exact HTTP(S) URLs.",
  "web.content.get": "Read bounded cached fetch content by response ID.",
  "web.map": "Discover a bounded set of links from one site.",
  "web.crawl": "Run a bounded attached crawl; remote cleanup and retry safety are reported explicitly.",
  "web.related": "Find pages related to an exact URL.",
  "web.extract": "Extract structured data from exact URLs with a locally validated JSON Schema.",
  "code.context": "Retrieve current technical context and code examples.",
  "research.run": "Run attached cited research. This can incur provider charges and may take up to the requested timeout.",
  "browser.open": "Create an owned Firecrawl browser session, navigate once, and return an opaque session ID. The session accrues credits until close or expiry.",
  "browser.snapshot": "Read a bounded accessibility snapshot from an ArkSpace-owned browser session.",
  "browser.interact": "Perform exactly one structured browser action. Set confirmed=true only after the user approves the target and action; side effects are possible.",
  "browser.status": "Refresh one ArkSpace-owned browser session's provider status.",
  "browser.close": "Close one ArkSpace-owned browser session and stop further billing.",
  "monitor.create": "Create an owned recurring Exa monitor. Requires confirmed=true and stores the one-time webhook secret only in the requested private file.",
  "monitor.list": "List locally owned monitors without contacting the provider.",
  "monitor.status": "Refresh one owned monitor from Exa.",
  "monitor.update": "Change an owned monitor's schedule or search. Requires confirmed=true.",
  "monitor.pause": "Pause scheduled monitor runs while retaining the monitor. Requires confirmed=true.",
  "monitor.resume": "Resume scheduled monitor runs and recurring charges. Requires confirmed=true.",
  "monitor.trigger": "Start a paid monitor run immediately. Requires confirmed=true.",
  "monitor.delete": "Irreversibly delete the provider monitor resource. Requires confirmed=true.",
  "monitor.runs": "List recent runs for one owned monitor.",
  "monitor.run.get": "Get one run and its bounded results for an owned monitor.",
  "monitor.site.create": "Create an owned Firecrawl page, crawl, or web-search monitor. Requires confirmed=true and reports the Provider credit estimate.",
  "monitor.site.list": "List locally owned Firecrawl site monitors.",
  "monitor.site.status": "Refresh one owned Firecrawl site monitor.",
  "monitor.site.update": "Change site-monitor targets, schedule, retention, judging, or webhook. Requires confirmed=true.",
  "monitor.site.pause": "Pause Firecrawl site checks while retaining configuration and history. Requires confirmed=true.",
  "monitor.site.resume": "Resume scheduled Firecrawl site checks and credit use. Requires confirmed=true.",
  "monitor.site.trigger": "Queue a paid Firecrawl site-monitor check. Requires confirmed=true.",
  "monitor.site.delete": "Delete a Firecrawl site-monitor API resource. Requires confirmed=true.",
  "monitor.site.checks": "List bounded Firecrawl checks for an owned site monitor.",
  "monitor.site.check.get": "Get one Firecrawl check and bounded page-level change results.",
};

const readOnly = new Set<Capability>(["web.search", "web.fetch", "web.content.get", "web.map", "web.related", "code.context", "browser.snapshot", "browser.status", "monitor.list", "monitor.status", "monitor.runs", "monitor.run.get", "monitor.site.list", "monitor.site.status", "monitor.site.checks", "monitor.site.check.get"]);
const destructive = new Set<Capability>(["browser.close", "monitor.delete", "monitor.site.delete"]);

export function createMcpServer(config?: ArkSpaceConfig): McpServer {
  const server = new McpServer({ name: "arkspace", version: "0.1.2" });
  const activeRequests = new Map<string | number, AbortController>();
  const names = new Set<string>();
  for (const capability of Object.keys(inputSchemas) as Capability[]) {
    if (config && !isToolEnabled(config, capability)) continue;
    const name = config?.tools[capability]?.mcpName ?? capability.replaceAll(".", "_");
    if (names.has(name)) throw new Error(`Duplicate MCP tool name: ${name}`);
    names.add(name);
    registerCapability(server, capability, name, inputSchemas[capability], activeRequests);
  }
  server.server.setNotificationHandler("notifications/cancelled", (notification) => {
    const requestId = notification.params.requestId;
    const controller = requestId === undefined ? undefined : activeRequests.get(requestId);
    if (controller) controller.abort(new Error(notification.params.reason ?? "MCP request cancelled."));
  });
  return server;
}

function registerCapability(server: McpServer, capability: Capability, name: string, schema: z.ZodObject<z.ZodRawShape>, activeRequests: Map<string | number, AbortController>): void {
  server.registerTool(
    name,
    {
      description: descriptions[capability],
      inputSchema: schema,
      outputSchema: z.record(z.string(), z.unknown()),
      annotations: {
        readOnlyHint: readOnly.has(capability),
        destructiveHint: destructive.has(capability),
        idempotentHint: readOnly.has(capability) || capability === "browser.close" || capability === "monitor.pause" || capability === "monitor.resume" || capability === "monitor.delete" || capability === "monitor.site.pause" || capability === "monitor.site.resume" || capability === "monitor.site.delete",
        openWorldHint: true,
      },
    },
    async (input, context) => {
      const controller = new AbortController();
      activeRequests.set(context.mcpReq.id, controller);
      const signal = AbortSignal.any([context.mcpReq.signal, controller.signal]);
      try {
        const result = await invokeCapability(capability, { protocolVersion: PROTOCOL_VERSION, capability, input }, { signal });
        // SAFETY: Capability results are JSON object envelopes; MCP structuredContent requires the equivalent string-keyed record type.
        const structured = result as unknown as Record<string, unknown>;
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: structured,
          isError: !result.ok,
        };
      } finally {
        if (activeRequests.get(context.mcpReq.id) === controller) activeRequests.delete(context.mcpReq.id);
      }
    },
  );
}
