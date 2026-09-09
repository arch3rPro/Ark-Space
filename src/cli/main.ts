#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { Command } from "commander";
import { ZodError } from "zod";

import {
  executeBrowserClose,
  executeBrowserInteract,
  executeBrowserOpen,
  executeBrowserSnapshot,
  executeBrowserStatus,
} from "../capabilities/browser.js";
import { executeCodeContext } from "../capabilities/code-context.js";
import {
  executeMonitorCreate,
  executeMonitorDelete,
  executeMonitorList,
  executeMonitorPause,
  executeMonitorResume,
  executeMonitorRunGet,
  executeMonitorRuns,
  executeMonitorStatus,
  executeMonitorTrigger,
  executeMonitorUpdate,
} from "../capabilities/monitor.js";
import { executeResearch } from "../capabilities/research.js";
import { executeWebCrawl } from "../capabilities/web-crawl.js";
import { executeWebExtract } from "../capabilities/web-extract.js";
import { executeWebFetch } from "../capabilities/web-fetch.js";
import { executeWebMap } from "../capabilities/web-map.js";
import { executeWebRelated } from "../capabilities/web-related.js";
import { executeWebSearch } from "../capabilities/web-search.js";
import { resolveArkSpacePaths } from "../config/paths.js";
import { getProviderConfig } from "../config/schema.js";
import { addEnvironmentKey, initializeConfig, loadConfig } from "../config/store.js";
import { ProviderError, correctionFor } from "../errors/provider-error.js";
import { serveArkSpaceStdio } from "../mcp/stdio.js";
import {
  parseCodeContextRequest,
  parseResearchRequest,
  parseWebCrawlRequest,
  parseWebExtractRequest,
  parseWebFetchRequest,
  parseWebMapRequest,
  parseWebRelatedRequest,
  parseWebSearchRequest,
  resolveCodeContextInput,
  resolveResearchInput,
  resolveWebCrawlInput,
  resolveWebExtractInput,
  resolveWebFetchInput,
  resolveWebMapInput,
  resolveWebRelatedInput,
  resolveWebSearchInput,
} from "../protocol/schema.js";
import {
  parseBrowserCloseRequest,
  parseBrowserInteractRequest,
  parseBrowserOpenRequest,
  parseBrowserSnapshotRequest,
  parseBrowserStatusRequest,
  parseMonitorCreateRequest,
  parseMonitorDeleteRequest,
  parseMonitorListRequest,
  parseMonitorPauseRequest,
  parseMonitorResumeRequest,
  parseMonitorRunGetRequest,
  parseMonitorRunsRequest,
  parseMonitorStatusRequest,
  parseMonitorTriggerRequest,
  parseMonitorUpdateRequest,
} from "../protocol/resource-schema.js";
import { invokeCapability, isCapability } from "../protocol/invoke.js";
import {
  PROTOCOL_VERSION,
  PROVIDER_IDS,
  type Capability,
  type CodeContextInput,
  type FailureEnvelope,
  type ProviderId,
  type ResearchInput,
  type ResearchProviderId,
  type WebCrawlInput,
  type WebCrawlProviderId,
  type WebExtractInput,
  type WebFetchInput,
  type WebMapInput,
  type WebMapProviderId,
  type WebRelatedInput,
} from "../protocol/types.js";
import {
  createCodeContextProviderRegistry,
  createCrawlProviderRegistry,
  createExtractProviderRegistry,
  createFetchProviderRegistry,
  createMapProviderRegistry,
  createRelatedProviderRegistry,
  createResearchProviderRegistry,
  createSearchProviderRegistry,
} from "../providers/registry.js";

const VERSION = "0.1.0";
const MAX_INPUT_BYTES = 1_048_576;
const operationController = new AbortController();
let receivedTerminationSignal = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (receivedTerminationSignal) process.exit(130);
    receivedTerminationSignal = true;
    operationController.abort(new Error(`Received ${signal}.`));
  });
}

const program = new Command()
  .name("arks")
  .description("ArkSpace provider execution CLI")
  .version(VERSION);

program.command("setup").description("Create a configuration with Exa, Tavily, and Firecrawl environment-key references").action(async () => {
  const paths = resolveArkSpacePaths();
  await initializeConfig(paths.config);
  process.stdout.write(`ArkSpace configuration ready at ${paths.config}\n`);
});

const providerCommand = program.command("provider").description("Inspect configured providers");
providerCommand
  .command("list")
  .option("--json", "Write JSON")
  .action(async (options: { json?: boolean }) => {
    const paths = resolveArkSpacePaths();
    const config = await loadConfig(paths.config);
    const rows = config.providerOrder.map((provider) => {
      const entry = getProviderConfig(config, provider);
      return {
        provider,
        enabled: entry?.enabled ?? false,
        configuredKeys: entry?.keyRefs.length ?? 0,
        availableKeys: entry?.keyRefs.filter((reference) => hasEnvironmentKey(reference)).length ?? 0,
      };
    });
    if (options.json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    else for (const row of rows) process.stdout.write(`${row.provider}\t${row.enabled ? "enabled" : "disabled"}\t${row.availableKeys}/${row.configuredKeys} keys available\n`);
  });

const keyCommand = program.command("key").description("Manage credential references");
keyCommand
  .command("add")
  .argument("<provider>", "Provider ID")
  .requiredOption("--env <variable>", "Environment variable containing the key")
  .action(async (providerValue: string, options: { env: string }) => {
    const provider = parseProviderId(providerValue);
    const paths = resolveArkSpacePaths();
    await addEnvironmentKey(paths.config, provider, options.env);
    process.stdout.write(`Added env:${options.env} for ${provider}; no secret value was stored.\n`);
  });

program
  .command("doctor")
  .option("--json", "Write JSON")
  .action(async (options: { json?: boolean }) => {
    const paths = resolveArkSpacePaths();
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    try {
      const config = await loadConfig(paths.config);
      checks.push({ name: "config", ok: true, detail: paths.config });
      for (const provider of config.providerOrder) {
        const entry = getProviderConfig(config, provider);
        const available = entry?.keyRefs.filter((reference) => hasEnvironmentKey(reference)).length ?? 0;
        checks.push({
          name: `provider:${provider}`,
          ok: Boolean(entry?.enabled && available > 0),
          detail: entry ? `${available}/${entry.keyRefs.length} referenced keys available` : "not configured",
        });
      }
    } catch (error) {
      checks.push({ name: "config", ok: false, detail: publicError(error).message });
    }
    const ok = checks.some((check) => check.name.startsWith("provider:") && check.ok);
    if (options.json) process.stdout.write(`${JSON.stringify({ ok, checks }, null, 2)}\n`);
    else for (const check of checks) process.stdout.write(`${check.ok ? "ok" : "not ready"}\t${check.name}\t${check.detail}\n`);
    if (!ok) process.exitCode = 1;
  });

const codeCommand = program.command("code").description("Code retrieval capabilities");
codeCommand
  .command("context")
  .argument("<query>", "Technical context query")
  .option("--tokens <count>", "Token budget or dynamic", "dynamic")
  .option("--timeout-ms <milliseconds>", "Request timeout", "60000")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (query: string, options: Record<string, unknown>) => {
    try {
      const input = resolveCodeContextInput({
        query,
        tokens: parseTokenBudget(options.tokens),
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
      });
      const result = await runCodeContext(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanCodeContext(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

const researchCommand = program.command("research").description("Cited multi-source Research capabilities");
researchCommand
  .command("run")
  .argument("<prompt>", "Research question or instructions")
  .option("--provider <provider>", "Force exa or tavily")
  .option("--depth <depth>", "concise, standard, or deep", "standard")
  .option("--timeout-ms <milliseconds>", "Overall Research timeout", "600000")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (prompt: string, options: Record<string, unknown>) => {
    try {
      const input = resolveResearchInput({
        prompt,
        depth: parseResearchDepth(options.depth),
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
        ...(typeof options.provider === "string" ? { provider: parseResearchProviderId(options.provider) } : {}),
      });
      const result = await runResearch(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanResearch(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

program.command("mcp").description("Model Context Protocol transport").command("serve").description("Serve ArkSpace tools over stdio").action(() => {
  serveArkSpaceStdio();
});

const browserCommand = program.command("browser").description("Owned Firecrawl Browser Sandbox sessions");
browserCommand
  .command("open")
  .argument("<url>", "Initial HTTP(S) URL")
  .option("--ttl <seconds>", "Maximum session lifetime", "600")
  .option("--activity-ttl <seconds>", "Inactivity lifetime", "300")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (url: string, options: Record<string, unknown>) => {
    await writeCommandResult(await runBrowserOpen(parseBrowserOpenRequest({ protocolVersion: PROTOCOL_VERSION, capability: "browser.open", input: { url, ttlSeconds: parseIntegerOption(options.ttl, "--ttl"), activityTtlSeconds: parseIntegerOption(options.activityTtl, "--activity-ttl"), timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } })), Boolean(options.json));
  });
browserCommand
  .command("snapshot")
  .argument("<session-id>")
  .option("--all", "Include non-interactive nodes")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (sessionId: string, options: Record<string, unknown>) => {
    await writeCommandResult(await runBrowserSnapshot(parseBrowserSnapshotRequest({ protocolVersion: PROTOCOL_VERSION, capability: "browser.snapshot", input: { sessionId, interactiveOnly: !options.all, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } })), Boolean(options.json), "snapshot");
  });
browserCommand
  .command("act")
  .argument("<session-id>")
  .requiredOption("--input <path>", "JSON file containing one structured action")
  .requiredOption("--confirm", "Confirm the exact browser action")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (sessionId: string, options: Record<string, unknown>) => {
    const action = await readJsonInput(String(options.input));
    await writeCommandResult(await runBrowserInteract(parseBrowserInteractRequest({ protocolVersion: PROTOCOL_VERSION, capability: "browser.interact", input: { sessionId, action, confirmed: true, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } })), Boolean(options.json), "output");
  });
for (const [name, capability, run] of [
  ["status", "browser.status", runBrowserStatus],
  ["close", "browser.close", runBrowserClose],
] as const) {
  browserCommand.command(name).argument("<session-id>").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (sessionId: string, options: Record<string, unknown>) => {
    const value = { protocolVersion: PROTOCOL_VERSION, capability, input: { sessionId, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } };
    const input = capability === "browser.status" ? parseBrowserStatusRequest(value) : parseBrowserCloseRequest(value);
    await writeCommandResult(await run(input), Boolean(options.json));
  });
}

const monitorCommand = program.command("monitor").description("Owned recurring Exa search monitors");
monitorCommand
  .command("create")
  .requiredOption("--query <query>", "Recurring search query")
  .requiredOption("--period <period>", "Single-unit interval, such as 1h or 1d")
  .requiredOption("--webhook <url>", "Public HTTPS webhook URL")
  .requiredOption("--secret-file <path>", "New private file for the one-time webhook secret")
  .requiredOption("--confirm", "Confirm persistent schedule, notifications, and cost")
  .option("--name <name>")
  .option("--num-results <count>", "Results per run", "10")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (options: Record<string, unknown>) => {
    const input = parseMonitorCreateRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.create", input: { query: options.query, period: options.period, webhookUrl: options.webhook, webhookSecretPath: options.secretFile, confirmed: true, numResults: parseIntegerOption(options.numResults, "--num-results"), timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"), ...(typeof options.name === "string" ? { name: options.name } : {}) } });
    await writeCommandResult(await runMonitorCreate(input), Boolean(options.json));
  });
monitorCommand.command("list").option("--limit <count>", "Maximum owned monitors", "50").option("--json", "Write the protocol JSON envelope").action(async (options: Record<string, unknown>) => {
  const input = parseMonitorListRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.list", input: { limit: parseIntegerOption(options.limit, "--limit") } });
  await writeCommandResult(await runMonitorList(input), Boolean(options.json));
});
monitorCommand.command("status").argument("<monitor-id>").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
  const input = parseMonitorStatusRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.status", input: { monitorId, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } });
  await writeCommandResult(await runMonitorStatus(input), Boolean(options.json));
});
monitorCommand.command("update").argument("<monitor-id>").requiredOption("--confirm", "Confirm persistent monitor changes").option("--name <name>").option("--query <query>").option("--num-results <count>").option("--period <period>").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
  const input = parseMonitorUpdateRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.update", input: { monitorId, confirmed: true, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"), ...(typeof options.name === "string" ? { name: options.name } : {}), ...(typeof options.query === "string" ? { query: options.query } : {}), ...(typeof options.numResults === "string" ? { numResults: parseIntegerOption(options.numResults, "--num-results") } : {}), ...(typeof options.period === "string" ? { period: options.period } : {}) } });
  await writeCommandResult(await runMonitorUpdate(input), Boolean(options.json));
});
for (const [name, capability, parse, run] of [
  ["pause", "monitor.pause", parseMonitorPauseRequest, runMonitorPause],
  ["resume", "monitor.resume", parseMonitorResumeRequest, runMonitorResume],
  ["trigger", "monitor.trigger", parseMonitorTriggerRequest, runMonitorTrigger],
  ["delete", "monitor.delete", parseMonitorDeleteRequest, runMonitorDelete],
] as const) {
  monitorCommand.command(name).argument("<monitor-id>").requiredOption("--confirm", `Confirm monitor ${name}`).option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
    const input = parse({ protocolVersion: PROTOCOL_VERSION, capability, input: { monitorId, confirmed: true, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } });
    await writeCommandResult(await run(input), Boolean(options.json));
  });
}
monitorCommand.command("runs").argument("<monitor-id>").option("--limit <count>", "Maximum runs", "20").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
  const input = parseMonitorRunsRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.runs", input: { monitorId, limit: parseIntegerOption(options.limit, "--limit"), timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } });
  await writeCommandResult(await runMonitorRuns(input), Boolean(options.json));
});
monitorCommand.command("run").argument("<monitor-id>").argument("<run-id>").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, runId: string, options: Record<string, unknown>) => {
  const input = parseMonitorRunGetRequest({ protocolVersion: PROTOCOL_VERSION, capability: "monitor.run.get", input: { monitorId, runId, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } });
  await writeCommandResult(await runMonitorRunGet(input), Boolean(options.json));
});

const siteMonitorCommand = monitorCommand.command("site").description("Owned Firecrawl page, crawl, and web-search monitors");
siteMonitorCommand.command("create").requiredOption("--input <path>", "JSON file containing name, schedule, targets, retention, goal, and webhook options").requiredOption("--confirm", "Confirm schedule, notifications, retention, and credit use").option("--json", "Write the protocol JSON envelope").action(async (options: Record<string, unknown>) => {
  const fields = await readObjectInput(String(options.input));
  await writeCommandResult(await invokeCapability("monitor.site.create", { protocolVersion: PROTOCOL_VERSION, capability: "monitor.site.create", input: { ...fields, confirmed: true } }, { signal: operationController.signal }), Boolean(options.json));
});
siteMonitorCommand.command("list").option("--limit <count>", "Maximum owned monitors", "25").option("--json", "Write the protocol JSON envelope").action(async (options: Record<string, unknown>) => {
  await writeCommandResult(await invokeCapability("monitor.site.list", { protocolVersion: PROTOCOL_VERSION, capability: "monitor.site.list", input: { limit: parseIntegerOption(options.limit, "--limit") } }, { signal: operationController.signal }), Boolean(options.json));
});
siteMonitorCommand.command("status").argument("<monitor-id>").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
  await runSiteMonitorResource("monitor.site.status", monitorId, options);
});
siteMonitorCommand.command("update").argument("<monitor-id>").requiredOption("--input <path>", "JSON file containing fields to update").requiredOption("--confirm", "Confirm persistent site-monitor changes").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
  const fields = await readObjectInput(String(options.input));
  await writeCommandResult(await invokeCapability("monitor.site.update", { protocolVersion: PROTOCOL_VERSION, capability: "monitor.site.update", input: { ...fields, monitorId, confirmed: true } }, { signal: operationController.signal }), Boolean(options.json));
});
for (const [name, capability] of [["pause", "monitor.site.pause"], ["resume", "monitor.site.resume"], ["trigger", "monitor.site.trigger"], ["delete", "monitor.site.delete"]] as const) {
  siteMonitorCommand.command(name).argument("<monitor-id>").requiredOption("--confirm", `Confirm site monitor ${name}`).option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
    await runSiteMonitorResource(capability, monitorId, options, true);
  });
}
siteMonitorCommand.command("checks").argument("<monitor-id>").option("--limit <count>", "Maximum checks", "25").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, options: Record<string, unknown>) => {
  await writeCommandResult(await invokeCapability("monitor.site.checks", { protocolVersion: PROTOCOL_VERSION, capability: "monitor.site.checks", input: { monitorId, limit: parseIntegerOption(options.limit, "--limit"), timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } }, { signal: operationController.signal }), Boolean(options.json));
});
siteMonitorCommand.command("check").argument("<monitor-id>").argument("<check-id>").option("--limit <count>", "Maximum page results", "25").option("--timeout-ms <milliseconds>", "Request timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (monitorId: string, checkId: string, options: Record<string, unknown>) => {
  await writeCommandResult(await invokeCapability("monitor.site.check.get", { protocolVersion: PROTOCOL_VERSION, capability: "monitor.site.check.get", input: { monitorId, checkId, limit: parseIntegerOption(options.limit, "--limit"), timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") } }, { signal: operationController.signal }), Boolean(options.json));
});

program
  .command("invoke")
  .argument("<capability>", "Capability name")
  .requiredOption("--input <path>", "Versioned JSON request file, or - for stdin")
  .action(async (capability: string, options: { input: string }) => {
    if (!isCapability(capability)) {
      writeMachineFailure("web.search", new ProviderError(`Unsupported capability: ${capability}`, { kind: "invalid-request" }));
      return;
    }
    try {
      const value = await readJsonInput(options.input);
      writeMachineResult(await invokeCapability(capability, value, { signal: operationController.signal }));
    } catch (error) {
      writeMachineFailure(capability, error);
    }
  });

const webCommand = program.command("web").description("Web capabilities");
webCommand
  .command("search")
  .argument("<query>", "Search query")
  .option("--provider <provider>", "Force exa, tavily, or firecrawl")
  .option("--max-results <count>", "Maximum results", "5")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--include-domain <domain...>", "Allowed domains")
  .option("--exclude-domain <domain...>", "Excluded domains")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (query: string, options: Record<string, unknown>) => {
    try {
      const input = resolveWebSearchInput({
        query,
        maxResults: parseIntegerOption(options.maxResults, "--max-results"),
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
        ...(typeof options.provider === "string" ? { provider: parseProviderId(options.provider) } : {}),
        includeDomains: stringArrayOption(options.includeDomain),
        excludeDomains: stringArrayOption(options.excludeDomain),
      });
      const result = await runWebSearch(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanResults(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

webCommand
  .command("related")
  .argument("<url>", "HTTP(S) URL used to find related pages")
  .option("--max-results <count>", "Maximum results", "5")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--include-domain <domain...>", "Allowed domains")
  .option("--exclude-domain <domain...>", "Excluded domains")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (url: string, options: Record<string, unknown>) => {
    try {
      const input = resolveWebRelatedInput({
        url,
        maxResults: parseIntegerOption(options.maxResults, "--max-results"),
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
        includeDomains: stringArrayOption(options.includeDomain),
        excludeDomains: stringArrayOption(options.excludeDomain),
      });
      const result = await runWebRelated(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanRelatedResults(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

webCommand
  .command("extract")
  .argument("<urls...>", "Exact HTTP(S) URLs to extract")
  .requiredOption("--prompt <prompt>", "Extraction goal")
  .requiredOption("--schema <path>", "JSON Schema file")
  .option("--timeout-ms <milliseconds>", "Overall extraction timeout", "300000")
  .option("--full-page", "Include navigation and other non-main content")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (urls: string[], options: Record<string, unknown>) => {
    try {
      const schema = await readJsonInput(String(options.schema));
      const input = resolveWebExtractInput({
        urls,
        prompt: String(options.prompt),
        schema,
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
        onlyMainContent: !options.fullPage,
      });
      const result = await runWebExtract(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanExtractResult(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

webCommand
  .command("fetch")
  .argument("<urls...>", "HTTP(S) URLs to fetch")
  .option("--provider <provider>", "Force exa, tavily, or firecrawl")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--max-characters <count>", "Maximum content characters per URL", "20000")
  .option("--full-page", "Include navigation and other non-main content")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (urls: string[], options: Record<string, unknown>) => {
    try {
      const input = resolveWebFetchInput({
        urls,
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
        maxCharacters: parseIntegerOption(options.maxCharacters, "--max-characters"),
        onlyMainContent: !options.fullPage,
        ...(typeof options.provider === "string" ? { provider: parseProviderId(options.provider) } : {}),
      });
      const result = await runWebFetch(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanFetchResults(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

webCommand
  .command("map")
  .argument("<url>", "HTTP(S) site URL to map")
  .option("--provider <provider>", "Force tavily or firecrawl")
  .option("--query <query>", "Prioritize links matching this instruction")
  .option("--max-results <count>", "Maximum links", "100")
  .option("--timeout-ms <milliseconds>", "Request timeout", "60000")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (url: string, options: Record<string, unknown>) => {
    try {
      const input = resolveWebMapInput({
        url,
        maxResults: parseIntegerOption(options.maxResults, "--max-results"),
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
        ...(typeof options.query === "string" ? { query: options.query } : {}),
        ...(typeof options.provider === "string" ? { provider: parseWebMapProviderId(options.provider) } : {}),
      });
      const result = await runWebMap(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanMapResults(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

webCommand
  .command("crawl")
  .argument("<url>", "HTTP(S) site URL to crawl")
  .option("--provider <provider>", "Force tavily or firecrawl")
  .option("--query <query>", "Prioritize pages matching this instruction")
  .option("--max-pages <count>", "Maximum pages", "20")
  .option("--max-depth <count>", "Maximum discovery depth", "2")
  .option("--timeout-ms <milliseconds>", "Overall crawl timeout", "120000")
  .option("--max-characters <count>", "Maximum content characters per page", "20000")
  .option("--include-path <pattern...>", "Included path patterns")
  .option("--exclude-path <pattern...>", "Excluded path patterns")
  .option("--full-page", "Include navigation and other non-main content")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (url: string, options: Record<string, unknown>) => {
    try {
      const input = resolveWebCrawlInput({
        url,
        maxPages: parseIntegerOption(options.maxPages, "--max-pages"),
        maxDepth: parseIntegerOption(options.maxDepth, "--max-depth"),
        timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"),
        maxCharacters: parseIntegerOption(options.maxCharacters, "--max-characters"),
        onlyMainContent: !options.fullPage,
        includePaths: stringArrayOption(options.includePath),
        excludePaths: stringArrayOption(options.excludePath),
        ...(typeof options.query === "string" ? { query: options.query } : {}),
        ...(typeof options.provider === "string" ? { provider: parseWebCrawlProviderId(options.provider) } : {}),
      });
      const result = await runWebCrawl(input);
      if (options.json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else writeHumanCrawlResults(result);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const normalized = publicError(error);
      process.stderr.write(`arks: ${normalized.message}\n`);
      process.exitCode = 1;
    }
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const normalized = publicError(error);
  process.stderr.write(`arks: ${normalized.message}\n`);
  process.exitCode = 1;
}

async function monitorContext() {
  const paths = resolveArkSpacePaths();
  return { config: await loadConfig(paths.config), statePath: paths.state, signal: operationController.signal };
}

async function runMonitorCreate(input: ReturnType<typeof parseMonitorCreateRequest>) { return executeMonitorCreate(input, await monitorContext()); }
async function runMonitorList(input: ReturnType<typeof parseMonitorListRequest>) { return executeMonitorList(input, await monitorContext()); }
async function runMonitorStatus(input: ReturnType<typeof parseMonitorStatusRequest>) { return executeMonitorStatus(input, await monitorContext()); }
async function runMonitorUpdate(input: ReturnType<typeof parseMonitorUpdateRequest>) { return executeMonitorUpdate(input, await monitorContext()); }
async function runMonitorPause(input: ReturnType<typeof parseMonitorPauseRequest>) { return executeMonitorPause(input, await monitorContext()); }
async function runMonitorResume(input: ReturnType<typeof parseMonitorResumeRequest>) { return executeMonitorResume(input, await monitorContext()); }
async function runMonitorTrigger(input: ReturnType<typeof parseMonitorTriggerRequest>) { return executeMonitorTrigger(input, await monitorContext()); }
async function runMonitorDelete(input: ReturnType<typeof parseMonitorDeleteRequest>) { return executeMonitorDelete(input, await monitorContext()); }
async function runMonitorRuns(input: ReturnType<typeof parseMonitorRunsRequest>) { return executeMonitorRuns(input, await monitorContext()); }
async function runMonitorRunGet(input: ReturnType<typeof parseMonitorRunGetRequest>) { return executeMonitorRunGet(input, await monitorContext()); }

async function runBrowserOpen(input: ReturnType<typeof parseBrowserOpenRequest>) {
  const paths = resolveArkSpacePaths();
  return executeBrowserOpen(input, { config: await loadConfig(paths.config), statePath: paths.state, signal: operationController.signal });
}

async function runBrowserSnapshot(input: ReturnType<typeof parseBrowserSnapshotRequest>) {
  const paths = resolveArkSpacePaths();
  return executeBrowserSnapshot(input, { config: await loadConfig(paths.config), statePath: paths.state, signal: operationController.signal });
}

async function runBrowserInteract(input: ReturnType<typeof parseBrowserInteractRequest>) {
  const paths = resolveArkSpacePaths();
  return executeBrowserInteract(input, { config: await loadConfig(paths.config), statePath: paths.state, signal: operationController.signal });
}

async function runBrowserStatus(input: ReturnType<typeof parseBrowserStatusRequest>) {
  const paths = resolveArkSpacePaths();
  return executeBrowserStatus(input, { config: await loadConfig(paths.config), statePath: paths.state, signal: operationController.signal });
}

async function runBrowserClose(input: ReturnType<typeof parseBrowserCloseRequest>) {
  const paths = resolveArkSpacePaths();
  return executeBrowserClose(input, { config: await loadConfig(paths.config), statePath: paths.state, signal: operationController.signal });
}

async function runResearch(input: ResearchInput) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeResearch(input, {
    config,
    statePath: paths.state,
    providers: createResearchProviderRegistry(),
    signal: operationController.signal,
  });
}

async function runCodeContext(input: CodeContextInput) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeCodeContext(input, {
    config,
    statePath: paths.state,
    providers: createCodeContextProviderRegistry(),
  });
}

async function runWebRelated(input: WebRelatedInput) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeWebRelated(input, {
    config,
    statePath: paths.state,
    providers: createRelatedProviderRegistry(),
  });
}

async function runWebSearch(input: ReturnType<typeof resolveWebSearchInput>) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeWebSearch(input, {
    config,
    statePath: paths.state,
    providers: createSearchProviderRegistry(),
  });
}

async function runWebCrawl(input: WebCrawlInput) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeWebCrawl(input, {
    config,
    statePath: paths.state,
    providers: createCrawlProviderRegistry(),
    signal: operationController.signal,
  });
}

async function runWebExtract(input: WebExtractInput) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeWebExtract(input, {
    config,
    statePath: paths.state,
    providers: createExtractProviderRegistry(),
    signal: operationController.signal,
  });
}

async function runWebFetch(input: WebFetchInput) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeWebFetch(input, {
    config,
    statePath: paths.state,
    providers: createFetchProviderRegistry(),
  });
}

async function runWebMap(input: WebMapInput) {
  const paths = resolveArkSpacePaths();
  const config = await loadConfig(paths.config);
  return executeWebMap(input, {
    config,
    statePath: paths.state,
    providers: createMapProviderRegistry(),
  });
}

async function readJsonInput(path: string): Promise<unknown> {
  const content = path === "-" ? await readStandardInput() : await readFile(path, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_INPUT_BYTES) {
    throw new ProviderError(`Input exceeds ${MAX_INPUT_BYTES} bytes.`, { kind: "invalid-request" });
  }
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new ProviderError("Input is not valid JSON.", { kind: "invalid-request", cause: error });
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((total, value) => total + value.length, 0) > MAX_INPUT_BYTES) {
      throw new ProviderError(`Input exceeds ${MAX_INPUT_BYTES} bytes.`, { kind: "invalid-request" });
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function writeCommandResult(result: { ok: boolean; data?: unknown }, json: boolean, field?: string): Promise<void> {
  if (json || !result.ok) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (field && isRecord(result.data) && typeof result.data[field] === "string") process.stdout.write(`${result.data[field]}\n`);
  else process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeMachineResult(result: { ok: boolean }): void {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

function writeMachineFailure(capability: Capability, error: unknown): void {
  const normalized = publicError(error);
  const correction = correctionFor(normalized.kind);
  const envelope: FailureEnvelope<Capability> = {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    capability,
    error: {
      kind: normalized.kind,
      message: normalized.message,
      retryable: normalized.retryable,
      ...(correction ? { correction } : {}),
    },
    attempts: [],
    warnings: [],
  };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = 1;
}

function writeHumanResearch(result: Extract<Awaited<ReturnType<typeof runResearch>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\nJob: ${result.data.jobId}\n\n${result.data.report}\n`);
  if (result.data.sources.length > 0) {
    process.stdout.write("\nSources:\n");
    for (const source of result.data.sources) {
      process.stdout.write(`- ${source.title ? `${source.title}: ` : ""}${source.url}\n`);
    }
  }
  for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`);
}

function writeHumanCodeContext(result: Extract<Awaited<ReturnType<typeof runCodeContext>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\nQuery: ${result.data.query}\n\n${result.data.response}\n`);
}

function writeHumanRelatedResults(result: Extract<Awaited<ReturnType<typeof runWebRelated>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\nRelated to: ${result.data.url}\n\n`);
  for (const [index, item] of result.data.results.entries()) {
    process.stdout.write(`${index + 1}. ${item.title || item.url}\n   ${item.url}\n`);
    if (item.snippet) process.stdout.write(`   ${item.snippet}\n`);
  }
}

function writeHumanResults(result: Extract<Awaited<ReturnType<typeof runWebSearch>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\n\n`);
  for (const [index, item] of result.data.results.entries()) {
    process.stdout.write(`${index + 1}. ${item.title || item.url}\n   ${item.url}\n`);
    if (item.snippet) process.stdout.write(`   ${item.snippet}\n`);
  }
}

function writeHumanCrawlResults(result: Extract<Awaited<ReturnType<typeof runWebCrawl>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\nBase URL: ${result.data.baseUrl}\n\n`);
  for (const page of result.data.pages) {
    process.stdout.write(`## ${page.title ?? page.url}\n\n${page.url}\n\n${page.content}\n\n`);
  }
  for (const url of result.data.failedUrls) process.stdout.write(`Failed: ${url}\n`);
  for (const warning of result.warnings) process.stdout.write(`Warning: ${warning}\n`);
}

function writeHumanExtractResult(result: Extract<Awaited<ReturnType<typeof runWebExtract>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\nJob: ${result.data.jobId}\n\n`);
  process.stdout.write(`${JSON.stringify(result.data.data, null, 2)}\n`);
  for (const url of result.data.invalidUrls) process.stdout.write(`Invalid: ${url}\n`);
}

function writeHumanFetchResults(result: Extract<Awaited<ReturnType<typeof runWebFetch>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\n\n`);
  for (const item of result.data.results) {
    process.stdout.write(`## ${item.title ?? item.url}\n\n${item.url}\n\n${item.content}\n\n`);
  }
  for (const url of result.data.failedUrls) process.stdout.write(`Failed: ${url}\n`);
}

function writeHumanMapResults(result: Extract<Awaited<ReturnType<typeof runWebMap>>, { ok: true }>): void {
  process.stdout.write(`Provider: ${result.provider}\nBase URL: ${result.data.baseUrl}\n\n`);
  for (const [index, link] of result.data.links.entries()) {
    process.stdout.write(`${index + 1}. ${link.title ?? link.url}\n   ${link.url}\n`);
    if (link.description) process.stdout.write(`   ${link.description}\n`);
  }
}

async function readObjectInput(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderError("Site monitor input must be a JSON object.", { kind: "invalid-request" });
  return value as Record<string, unknown>;
}

async function runSiteMonitorResource(capability: "monitor.site.status" | "monitor.site.pause" | "monitor.site.resume" | "monitor.site.trigger" | "monitor.site.delete", monitorId: string, options: Record<string, unknown>, confirmed = false): Promise<void> {
  const input = { monitorId, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"), ...(confirmed ? { confirmed: true } : {}) };
  await writeCommandResult(await invokeCapability(capability, { protocolVersion: PROTOCOL_VERSION, capability, input }, { signal: operationController.signal }), Boolean(options.json));
}

function publicError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof ZodError) {
    return new ProviderError(`Request validation failed: ${error.issues.map((issue) => issue.message).join("; ")}`, {
      kind: "invalid-request",
    });
  }
  if (error instanceof Error && error.message) return new ProviderError(error.message, { kind: "unknown" });
  return new ProviderError("Unknown ArkSpace failure.", { kind: "unknown" });
}

function parseProviderId(value: string): ProviderId {
  if ((PROVIDER_IDS as readonly string[]).includes(value)) return value as ProviderId;
  throw new ProviderError(`Unknown provider: ${value}`, { kind: "invalid-request" });
}

function parseResearchProviderId(value: string): ResearchProviderId {
  if (value === "exa" || value === "tavily") return value;
  throw new ProviderError(`Provider ${value} does not support research.run.`, { kind: "invalid-request" });
}

function parseResearchDepth(value: unknown): ResearchInput["depth"] {
  if (value === "concise" || value === "standard" || value === "deep") return value;
  throw new ProviderError("--depth must be concise, standard, or deep.", { kind: "invalid-request" });
}

function parseWebCrawlProviderId(value: string): WebCrawlProviderId {
  if (value === "tavily" || value === "firecrawl") return value;
  throw new ProviderError(`Provider ${value} does not support web.crawl.`, { kind: "invalid-request" });
}

function parseWebMapProviderId(value: string): WebMapProviderId {
  if (value === "tavily" || value === "firecrawl") return value;
  throw new ProviderError(`Provider ${value} does not support web.map.`, { kind: "invalid-request" });
}

function parseTokenBudget(value: unknown): "dynamic" | number {
  if (value === "dynamic") return "dynamic";
  return parseIntegerOption(value, "--tokens");
}

function parseIntegerOption(value: unknown, flag: string): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ProviderError(`${flag} must be an integer.`, { kind: "invalid-request" });
  }
  return Number(value);
}

function stringArrayOption(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function hasEnvironmentKey(reference: string): boolean {
  const value = process.env[reference.slice("env:".length)]?.trim();
  return Boolean(value);
}
