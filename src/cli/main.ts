#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, open, readFile, rename } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { Command, CommanderError } from "commander";
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
import { serveUseGptDaemon, daemonRequest, daemonStatus, defaultDaemonDataDir, normalizeDaemonDataDir, stopUseGptDaemon } from "../usegpt/daemon.js";
import { runWorker } from "../usegpt/worker.js";
import { runSetup } from "./setup.js";
import { CliUpdateError, runCliUpdate } from "./update.js";
import { buildDiagnosticPlan, renderDiagnostic } from "./diagnostics.js";
import { loadCredentialEnvironment } from "../config/credentials.js";
import { resolveArkSpacePaths } from "../config/paths.js";
import { defaultConfig, getProviderConfig, getSearxngConfig, isToolEnabled, type ArkSpaceConfig } from "../config/schema.js";
import { addEnvironmentKey, addSearxngInstance, configureSearxng, loadConfig } from "../config/store.js";
import { ProviderError, correctionFor } from "../errors/provider-error.js";
import { serveArkSpaceStdio } from "../mcp/stdio.js";
import {
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
import { UseGptInputSchemas, useGptFailure, type UseGptCapability } from "../protocol/usegpt-schema.js";
import { weknoraVerifyFailure } from "../protocol/weknora-schema.js";
import { WeknoraRetrievalEnvelopeSchemas } from "../protocol/weknora-retrieval-schema.js";
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

const VERSION = "0.1.5";
const MAX_INPUT_BYTES = 1_048_576;
// Capture before credential bootstrap so setup can distinguish external overrides from local keys.
const originalEnvironment = { ...process.env };
const isUpdateInvocation = process.argv.slice(2).find((argument) => !argument.startsWith("-")) === "update";
const operationController = new AbortController();
let receivedTerminationSignal = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (receivedTerminationSignal && !isUpdateInvocation) process.exit(130);
    receivedTerminationSignal = true;
    operationController.abort(new Error(`Received ${signal}.`));
  });
}

const program = new Command()
  .name("arks")
  .description("ArkSpace provider execution CLI")
  .version(VERSION);

if (isUpdateInvocation) program.exitOverride().configureOutput({ writeErr: () => {} });
program.command("update")
  .description("Check npm stable or interactively approve an npm-global CLI update")
  .option("--check", "Check the official stable release without running npm or changing files")
  .option("--json", "Write one CLI-specific JSON result")
  .action(async (options: { check?: boolean; json?: boolean }) => {
    try {
      const result = await runCliUpdate(options, VERSION, originalEnvironment, operationController.signal,
        (message) => { process.stderr.write(`${message}\n`); });
      process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `${result.message}\n`);
    } catch (error) {
      writeUpdateFailure(error, Boolean(options.json));
    }
  });

program.command("setup").argument("[service]", "exa, tavily, firecrawl, searxng, weknora or usegpt")
  .description("Manage service connections and credentials in a trusted terminal")
  .option("--lang <language>", "Setup language for this run: en or zh (English / 中文)")
  .action(async (provider: string | undefined, options: { lang?: string }) => {
    await runSetup(resolveArkSpacePaths(), undefined, {
      ...(provider === undefined ? {} : { provider }), ...(options.lang === undefined ? {} : { language: options.lang }),
      environment: originalEnvironment, signal: operationController.signal,
    });
  });

const providerCommand = program.command("provider").description("Inspect configured providers");
providerCommand.command("configure")
  .argument("<provider>", "Provider ID (searxng)")
  .requiredOption("--base-url <url>", "Explicit SearXNG instance base URL")
  .option("--allow-range <cidr>", "Explicit private-network CIDR exception; repeatable", (value: string, previous: string[]) => [...previous, value], [])
  .option("--append", "Append a user-chosen instance instead of replacing SearXNG configuration")
  .action(async (provider: string, options: { baseUrl: string; allowRange?: string[]; append?: boolean }) => {
    if (provider !== "searxng") throw new ProviderError("Endpoint configuration supports searxng only.", { kind: "invalid-request" });
    await (options.append ? addSearxngInstance : configureSearxng)(resolveArkSpacePaths().config, options.baseUrl, options.allowRange ?? []);
    process.stdout.write("Configured SearXNG; default fallback order unchanged.\n");
  });
providerCommand
  .command("list")
  .option("--json", "Write JSON")
  .action(async (options: { json?: boolean }) => {
    const paths = resolveArkSpacePaths();
    const config = await loadConfig(paths.config);
    const rows = [...new Set([...config.providerOrder, ...PROVIDER_IDS.filter(id => getProviderConfig(config, id))])].map((provider) => {
      const entry = getProviderConfig(config, provider);
      return {
        provider,
        enabled: entry?.enabled ?? false,
        configuredKeys: entry?.keyRefs.length ?? 0,
        availableKeys: entry?.keyRefs.filter((reference) => hasEnvironmentKey(reference)).length ?? 0,
        ...(provider === "searxng" ? { keyless: true, configuredInstances: getSearxngConfig(config)?.instances.length ?? 0, ready: Boolean(entry?.enabled) } : {}),
      };
    });
    if (options.json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    else for (const row of rows) process.stdout.write(`${row.provider}\t${row.enabled ? "enabled" : "disabled"}\t${row.provider === "searxng" ? `${row.configuredInstances} keyless instances (not probed)` : `${row.availableKeys}/${row.configuredKeys} keys available`}\n`);
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
      for (const provider of [...new Set([...config.providerOrder, ...PROVIDER_IDS.filter(id => getProviderConfig(config, id))])]) {
        const entry = getProviderConfig(config, provider);
        const available = entry?.keyRefs.filter((reference) => hasEnvironmentKey(reference)).length ?? 0;
        checks.push({
          name: `provider:${provider}`,
          ok: Boolean(entry?.enabled && (provider === "searxng" || available > 0)),
          detail: provider === "searxng" && entry ? `${getSearxngConfig(config)?.instances.length ?? 0} keyless instances configured (not probed)` : entry ? `${available}/${entry.keyRefs.length} referenced keys available` : "not configured",
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
  serveArkSpaceStdio({ originalEnvironment });
});

const useGptCommand = program.command("usegpt").description("UseGPT local Artifact Hub");
const workerCommand = useGptCommand.command("worker").description("Run a fixed locally configured child for pending handoffs");
for (const mode of ["once", "run"] as const) workerCommand.command(mode)
  .requiredOption("--config <file>", "Protected local worker JSON configuration")
  .action(async (options: { config: string }) => {
    try {
      await runWorker(options.config, mode, operationController.signal, result => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (!result.ok) {
          process.stderr.write(`arks usegpt worker: ${result.data.status}; inspect protected recovery files before taking further action.\n`);
          if (mode === "once") process.exitCode = 1;
        }
      });
    } catch {
      process.stdout.write(`${JSON.stringify({ ok: false, command: "usegpt.worker", error: { code: "worker_error", message: "Worker configuration or hub request failed; inspect local configuration and durable records.", retryable: false } })}\n`);
      process.stderr.write("arks usegpt worker: configuration or hub request failed.\n");
      process.exitCode = 1;
    }
  });
const tunnelCommand = useGptCommand.command("tunnel").description("Manage the background Secure MCP Tunnel");
const tunnelState = (dataDir: string) => join(normalizeDaemonDataDir(dataDir), ".tunnel", "tunnel.json");
const tunnelRead = async (dataDir: string) => { try { return JSON.parse(await readFile(tunnelState(dataDir), "utf8")) as { pid: number; logPath?: string }; } catch { return undefined; } };
const tunnelAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
tunnelCommand.command("start").option("--data-dir <path>", "Hub data directory", defaultDaemonDataDir()).action(async (options: { dataDir: string }) => {
  const dataDir = normalizeDaemonDataDir(options.dataDir); const current = await tunnelRead(dataDir);
  if (current && tunnelAlive(current.pid)) { process.stdout.write(`${JSON.stringify({ ok: true, running: true, pid: current.pid, dataDir, logPath: current.logPath })}\n`); return; }
  const entry = resolve(process.argv[1]!); const script = resolve(dirname(entry), "../usegpt/tunnel-service.js");
  const child = spawn(process.execPath, [script, "--background"], { detached: true, stdio: "ignore", env: process.env }); child.unref();
  const deadline = Date.now() + 5_000; let state = await tunnelRead(dataDir);
  while ((!state || !tunnelAlive(state.pid)) && Date.now() < deadline) { await new Promise(resolveDelay => setTimeout(resolveDelay, 50)); state = await tunnelRead(dataDir); }
  process.stdout.write(`${JSON.stringify({ ok: Boolean(state && tunnelAlive(state.pid)), running: Boolean(state && tunnelAlive(state.pid)), ...(state ?? {}), dataDir })}\n`);
  if (!state || !tunnelAlive(state.pid)) process.exitCode = 1;
});
tunnelCommand.command("status").option("--data-dir <path>", "Hub data directory", defaultDaemonDataDir()).action(async (options: { dataDir: string }) => { const dataDir = normalizeDaemonDataDir(options.dataDir); const state = await tunnelRead(dataDir); const running = Boolean(state && tunnelAlive(state.pid)); process.stdout.write(`${JSON.stringify({ ok: true, running, dataDir, ...(running ? state : {}) })}\n`); });
tunnelCommand.command("stop").option("--data-dir <path>", "Hub data directory", defaultDaemonDataDir()).action(async (options: { dataDir: string }) => { const dataDir = normalizeDaemonDataDir(options.dataDir); const state = await tunnelRead(dataDir); if (state && tunnelAlive(state.pid)) { process.kill(state.pid, "SIGTERM"); const deadline = Date.now() + 5_000; while (tunnelAlive(state.pid) && Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 50)); } const running = Boolean(state && tunnelAlive(state.pid)); process.stdout.write(`${JSON.stringify({ ok: !running, running, dataDir })}\n`); if (running) process.exitCode = 1; });


for (const group of ["project", "task", "artifact", "handoff", "storage", "delete"]) {
  const namespace = useGptCommand.command(group).description(`Artifact Hub ${group} operations`);
  for (const capability of Object.keys(UseGptInputSchemas) as UseGptCapability[]) {
    const [, capabilityGroup, operation] = capability.split(".");
    if (capabilityGroup !== group || !operation || ["start", "follow_up"].includes(operation) || capability === "usegpt.artifact.get") continue;
    const schema = UseGptInputSchemas[capability];
    const command = namespace.command(operation.replaceAll("_", "-")).option("--input <path>", "JSON input object, or - for stdin").option("--json", "Write the protocol JSON envelope");
    const idField = ["get", "archive", "delete", "restore", "purge", "complete", "wait", "cancel", "describe", "read", "claim", "fail"].includes(operation) && ["project", "task", "artifact", "handoff"].includes(group) ? `${group}Id` : undefined;
    if (idField) command.argument("[id]", `${group} ID (or supply it with --input)`);
    const numericFields = new Set(["limit", "offset", "timeoutMs", "revision", "generation", "eventCursor"]);
    const booleanFields = new Set(["confirmed", "includeDeleted"]);
    for (const field of Object.keys(schema.shape)) {
      if (field === idField) continue;
      const flag = field === "confirmed" ? "confirm" : field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`);
      command.option(`--${flag}${booleanFields.has(field) ? "" : " <value>"}`, field === "artifactRefs" ? "JSON array of fixed artifact revisions" : `Set ${field}`);
    }
    if (capability === "usegpt.artifact.publish_inline") command.option("--input-file <path>", "Read at most 1 MiB of UTF-8 artifact content");
    command.action(async (...args: unknown[]) => {
      const options = command.opts<Record<string, unknown>>();
      try {
        const input = typeof options.input === "string" ? await readObjectInput(options.input) : {};
        if (idField && typeof args[0] === "string") input[idField] = args[0];
        for (const field of Object.keys(schema.shape)) {
          const value = options[field === "confirmed" ? "confirm" : field];
          if (value !== undefined) input[field] = numericFields.has(field) ? parseIntegerOption(value, field) : field === "artifactRefs" ? JSON.parse(String(value)) : value;
        }
        if (typeof options.inputFile === "string") {
          if (input.content !== undefined) throw new Error("Choose content or input-file.");
          input.content = await readUseGptContent(options.inputFile);
        }
        await writeUseGptCommand(capability, input);
      } catch (error) { writeMachineFailure(capability, error); }
    });
  }
}

const handoffCommand = useGptCommand.commands.find(command => command.name() === "handoff");
if (!handoffCommand) throw new Error("Handoff command is unavailable.");
const handoffPull = handoffCommand.command("pull").requiredOption("--to <recipient>", "Handoff recipient identity").option("--handoff-id <id>", "Pull this pending handoff by ID").option("--output-dir <path>", "Parent directory for the secure input package").option("--json", "Write the protocol JSON envelope");
const registerHandoffPull = async (options: { to: string; handoffId?: string; outputDir?: string }) => {
  let directory: string | undefined;
  let handoffId: string | undefined;
  let claimAttempted = false;
  let claimSaved = false;
  const output = (result: { ok: boolean } & Record<string, unknown>) => writeMachineResult(result);
  const call = async (capability: UseGptCapability, input: Record<string, unknown>) =>
    await invokeCapability(capability, { protocolVersion: PROTOCOL_VERSION, capability, input }, { originalEnvironment, signal: operationController.signal }) as { ok: boolean; data?: Record<string, unknown>; error?: unknown };
  const save = async (name: string, value: unknown) => {
    const path = join(directory!, name);
    const handle = await open(`${path}.partial`, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
    finally { await handle.close(); }
    await rename(`${path}.partial`, path);
    return path;
  };
  try {
    const recipient = UseGptInputSchemas["usegpt.handoff.claim"].shape.to.parse(options.to);
    if (options.handoffId !== undefined) {
      handoffId = UseGptInputSchemas["usegpt.handoff.claim"].shape.handoffId.parse(options.handoffId);
    } else {
      const listed = await call("usegpt.handoff.list", { to: recipient, status: "pending", limit: 1 });
      if (!listed.ok) { output({ ...listed, command: "usegpt.handoff.pull" }); return; }
      const handoffs = listed.data?.handoffs;
      if (!Array.isArray(handoffs)) throw new Error();
      if (!handoffs.length) {
        output({ ok: true, command: "usegpt.handoff.pull", data: { status: "empty" } });
        return;
      }
      if (!isRecord(handoffs[0]) || typeof handoffs[0].id !== "string") throw new Error();
      handoffId = handoffs[0].id;
    }
    directory = await mkdtemp(join(resolve(options.outputDir ?? tmpdir()), "arks-usegpt-handoff-"));
    await chmod(directory, 0o700);
    await save("attempt.json", { handoffId, to: recipient });
    claimAttempted = true;
    const claimed = await call("usegpt.handoff.claim", { handoffId, to: recipient });
    if (!claimed.ok) {
      output({ ...claimed, command: "usegpt.handoff.pull", recoveryDir: directory, handoffId });
      return;
    }
    const handoff = claimed.data;
    if (!handoff || typeof handoff.claimToken !== "string" || typeof handoff.generation !== "number" || !Array.isArray(handoff.artifactRefs)) throw new Error();
    await save("claim.json", handoff);
    claimSaved = true;
    const fence = { handoffId, claimToken: handoff.claimToken, generation: handoff.generation };
    const completePath = await save("complete.json", fence);
    const failPath = await save("fail.json", { ...fence, reason: "Consumer could not complete this handoff." });
    const task = await call("usegpt.task.get", { taskId: handoff.taskId });
    if (!task.ok) throw new Error();
    const artifacts = [];
    let totalBytes = 0;
    for (const ref of handoff.artifactRefs) {
      if (!isRecord(ref)) throw new Error();
      const chunks: string[] = [];
      let offset = 0;
      let metadata: Record<string, unknown> | undefined;
      for (;;) {
        const page = await call("usegpt.artifact.read", { projectId: handoff.projectId, artifactId: ref.artifactId, revision: ref.revision, offset, limit: 100_000 });
        const data = page.data;
        if (!page.ok || !data || typeof data.content !== "string" || !isRecord(data.artifact) || typeof data.nextOffset !== "number") throw new Error();
        metadata = data.artifact;
        totalBytes += Buffer.byteLength(data.content);
        if (totalBytes > 16 * 1_048_576) throw new Error("Text input package exceeds 16 MiB.");
        chunks.push(data.content);
        if (data.eof === true) break;
        if (data.nextOffset <= offset) throw new Error();
        offset = data.nextOffset;
      }
      artifacts.push({ artifact: metadata, content: chunks.join(""), encoding: "utf8" });
    }
    const inputPath = await save("input.json", { protocolVersion: PROTOCOL_VERSION, handoff, task: task.data, artifacts });
    output({ ok: true, command: "usegpt.handoff.pull", data: { status: "ready", handoffId, generation: handoff.generation, inputPath, completePath, failPath } });
  } catch {
    output({ ok: false, command: "usegpt.handoff.pull", data: { status: claimAttempted ? claimSaved ? "claimed" : "unknown" : "unclaimed", ...(handoffId ? { handoffId } : {}), ...(directory ? { recoveryDir: directory } : {}) }, error: { kind: "pull-failed", message: "Input package could not be prepared. Inspect the handoff and recovery files before continuing; no automatic retry was attempted.", retryable: false } });
  }
};
handoffPull.action(registerHandoffPull);
handoffCommand.command("continue").requiredOption("--to <recipient>", "Handoff recipient identity").option("--handoff-id <id>", "Pull this pending handoff by ID").option("--output-dir <path>", "Parent directory for the secure input package").option("--json", "Write the protocol JSON envelope").action(registerHandoffPull);

const daemonCommand = useGptCommand.command("daemon").description("Manage the local Artifact Hub daemon");
daemonCommand.command("serve")
  .option("--data-dir <path>", "Independent daemon data directory", defaultDaemonDataDir())
  .action(async (options: { dataDir: string }) => { await serveUseGptDaemon(normalizeDaemonDataDir(options.dataDir)); });
daemonCommand.command("start")
  .option("--data-dir <path>", "Independent daemon data directory", defaultDaemonDataDir())
  .action(async (options: { dataDir: string }) => {
    const dataDir = normalizeDaemonDataDir(options.dataDir);
    const current = await daemonStatus(dataDir);
    if (!current.running) {
      const entry = process.argv[1];
      if (!entry) throw new Error("Cannot locate the arks entry point.");
      const child = spawn(process.execPath, [resolve(entry), "usegpt", "daemon", "serve", "--data-dir", dataDir], { detached: true, stdio: "ignore", env: process.env });
      await new Promise<void>((done, reject) => { child.once("spawn", done); child.once("error", reject); });
      child.unref();
    }
    const deadline = Date.now() + 5_000;
    let status = await daemonStatus(dataDir);
    while (!status.running && Date.now() < deadline) { await new Promise(resolveDelay => setTimeout(resolveDelay, 25)); status = await daemonStatus(dataDir); }
    process.stdout.write(`${JSON.stringify({ ok: status.running, ...status })}\n`);
    if (!status.running) process.exitCode = 1;
  });
daemonCommand.command("stop")
  .option("--data-dir <path>", "Independent daemon data directory", defaultDaemonDataDir())
  .action(async (options: { dataDir: string }) => { const status = await stopUseGptDaemon(normalizeDaemonDataDir(options.dataDir)); process.stdout.write(`${JSON.stringify({ ok: !status.running, ...status })}\n`); if (status.running) process.exitCode = 1; });
daemonCommand.command("status")
  .option("--data-dir <path>", "Independent daemon data directory", defaultDaemonDataDir())
  .action(async (options: { dataDir: string }) => { const status = await daemonStatus(normalizeDaemonDataDir(options.dataDir)); process.stdout.write(`${JSON.stringify({ ok: true, ...status })}\n`); });
daemonCommand.command("invoke")
  .option("--data-dir <path>", "Independent daemon data directory", defaultDaemonDataDir())
  .requiredOption("--input <path>", "Versioned JSON request file, or - for stdin")
  .action(async (options: { dataDir: string; input: string }) => {
    try { writeMachineResult(await daemonRequest(normalizeDaemonDataDir(options.dataDir), await readJsonInput(options.input)) as { ok: boolean }); }
    catch { process.stdout.write(`${JSON.stringify({ ok: false, command: "usegpt.daemon.invoke", error: { message: "Daemon invoke failed." } })}\n`); process.exitCode = 1; }
  });

useGptCommand.command("start")
  .requiredOption("--prompt <prompt>", "Task prompt")
  .requiredOption("--request-id <request-id>", "Stable idempotency request ID")
  .option("--mode <mode>", "chat, search, deep-research, or image", "chat")
  .option("--timeout-ms <milliseconds>", "Task timeout", "1200000")
  .option("--file <path>", "Attach a text file as context; repeatable", (value: string, previous: string[]) => [...previous, value], [])
  .requiredOption("--confirm", "Confirm sending this task to ChatGPT")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (options: Record<string, unknown>) => {
    try {
      const files = await Promise.all((Array.isArray(options.file) ? options.file : []).map(async value => {
        const path = String(value);
        return { name: basename(path), content: await readFile(path, "utf8") };
      }));
      const mode = options.mode;
      if (mode !== "chat" && mode !== "search" && mode !== "deep-research" && mode !== "image") throw new ProviderError("--mode must be chat, search, deep-research, or image.", { kind: "invalid-request" });
      await writeCommandResult(await invokeCapability("usegpt.task.start", { protocolVersion: PROTOCOL_VERSION, capability: "usegpt.task.start", input: { requestId: String(options.requestId), prompt: String(options.prompt), mode, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms"), files, confirmed: true } }, { originalEnvironment, signal: operationController.signal }), true);
    } catch (error) { writeMachineFailure("usegpt.task.start", error); }
  });
useGptCommand.command("get").argument("<taskId>").option("--json", "Write the protocol JSON envelope").action(async (taskId: string) => {
  await writeUseGptCommand("usegpt.task.get", { taskId });
});
useGptCommand.command("wait").argument("<taskId>").option("--timeout-ms <milliseconds>", "Wait timeout", "30000").option("--json", "Write the protocol JSON envelope").action(async (taskId: string, options: Record<string, unknown>) => {
  await writeUseGptCommand("usegpt.task.wait", { taskId, timeoutMs: parseIntegerOption(options.timeoutMs, "--timeout-ms") });
});
useGptCommand.command("cancel").argument("<taskId>").requiredOption("--confirmed", "Confirm cancellation").option("--json", "Write the protocol JSON envelope").action(async (taskId: string) => {
  await writeUseGptCommand("usegpt.task.cancel", { taskId, confirmed: true });
});
useGptCommand.command("status").option("--json", "Write the protocol JSON envelope").action(async () => {
  await writeUseGptCommand("usegpt.connection.status", {});
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
  .option("--input-file <path>", "UTF-8 content file for usegpt.artifact.publish_inline only (at most 1 MiB)")
  .action(async (capability: string, options: { input: string; inputFile?: string }) => {
    if (!isCapability(capability)) {
      writeMachineFailure("web.search", new ProviderError(`Unsupported capability: ${capability}`, { kind: "invalid-request" }));
      return;
    }
    try {
      // WeKnora resolves its connection inside the bounded operation. Web invocation
      // still loads local credentials, but bootstrap failures stay in its JSON envelope.
      let environment: NodeJS.ProcessEnv | undefined;
      if (!capability.startsWith("weknora.") && !capability.startsWith("usegpt.")) {
        const paths = resolveArkSpacePaths(originalEnvironment);
        const config = await loadConfig(paths.config);
        if (!isToolEnabled(config, capability)) {
          writeMachineFailure(capability, new ProviderError(`Capability is disabled by configuration: ${capability}`, { kind: "invalid-request" }));
          return;
        }
        environment = await loadCredentialEnvironment(paths.credentials, originalEnvironment);
      }
      const value = await readJsonInput(options.input);
      if (options.inputFile !== undefined) {
        if (capability !== "usegpt.artifact.publish_inline" || !isRecord(value) || !isRecord(value.input) || value.input.content !== undefined) throw new Error("Invalid content file request.");
        value.input.content = await readUseGptContent(options.inputFile);
      }
      writeMachineResult(await invokeCapability(capability, value, { originalEnvironment, ...(environment ? { environment } : {}), signal: operationController.signal }));
    } catch (error) {
      writeMachineFailure(capability, error);
    }
  });

const webCommand = program.command("web").description("Web capabilities");
webCommand
  .command("search")
  .argument("<query>", "Search query")
  .option("--provider <provider>", "Force exa, tavily, firecrawl, or searxng")
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
  .option("--provider <provider>", "Force exa, tavily, firecrawl, or local")
  .option("--mode <mode>", "Local fetch mode: raw or readable", "readable")
  .option("--timeout-ms <milliseconds>", "Request timeout", "30000")
  .option("--max-characters <count>", "Maximum content characters per URL", "20000")
  .option("--full-page", "Include navigation and other non-main content")
  .option("--json", "Write the protocol JSON envelope")
  .action(async (urls: string[], options: Record<string, unknown>) => {
    try {
      const input = resolveWebFetchInput({
        urls,
        mode: options.mode === "raw" ? "raw" : options.mode === "readable" ? "readable" : (() => { throw new Error("--mode must be raw or readable"); })(),
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
  // Update never reads local config/credentials; setup and invoke own their bootstrap.
  if (!isUpdateInvocation && process.argv[2] !== "setup" && process.argv[2] !== "invoke" && process.argv[2] !== "usegpt" && process.argv[2] !== "mcp") {
    const paths = resolveArkSpacePaths();
    const environment = await loadCredentialEnvironment(paths.credentials);
    for (const [name, value] of Object.entries(environment)) {
      if (value !== undefined && process.env[name] === undefined) process.env[name] = value;
    }
    await configureCliCommands(program);
  }
  await program.parseAsync(process.argv);
} catch (error) {
  if (process.argv[2] === "usegpt" && process.argv[3] === "daemon") {
    process.stdout.write(`${JSON.stringify({ ok: false, command: `usegpt.daemon.${process.argv[4] ?? "unknown"}`, error: { message: "Artifact Hub daemon command failed; inspect the data directory and runtime." } })}\n`);
    process.exitCode = 1;
  } else if (isUpdateInvocation) {
    if (!(error instanceof CommanderError && error.exitCode === 0)) {
      writeUpdateFailure(new CliUpdateError("Invalid update arguments. Use arks update --help."), process.argv.includes("--json"));
    }
  } else {
    const normalized = publicError(error);
    process.stderr.write(`arks: ${normalized.message}\n`);
    process.exitCode = 1;
  }
}

function writeUpdateFailure(error: unknown, json: boolean): void {
  const safe = error instanceof CliUpdateError ? error : new CliUpdateError("CLI update failed; no automatic retry was attempted.");
  const result = { ok: false, command: "update", currentVersion: VERSION, latestVersion: null, updateAvailable: null,
    ...safe.details, status: safe.status, possiblePartialChanges: safe.possiblePartialChanges, error: { message: safe.message } };
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stderr.write(`arks: ${safe.message}\n`);
  process.exitCode = safe.status === "cancelled" ? 130 : 1;
}

async function configureCliCommands(root: Command): Promise<void> {
  let config: ArkSpaceConfig;
  try {
    await access(resolveArkSpacePaths().config);
    config = await loadConfig(resolveArkSpacePaths().config);
  } catch (error) {
    // Bootstrap and help/version remain available before setup; invoke still loads config itself.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    config = defaultConfig();
  }
  const commandPaths: Array<[string[], Capability]> = [
    [["web", "search"], "web.search"], [["web", "related"], "web.related"], [["web", "extract"], "web.extract"],
    [["web", "fetch"], "web.fetch"], [["web", "map"], "web.map"], [["web", "crawl"], "web.crawl"],
    [["code", "context"], "code.context"], [["research", "run"], "research.run"],
    [["browser", "open"], "browser.open"], [["browser", "snapshot"], "browser.snapshot"], [["browser", "act"], "browser.interact"],
    [["browser", "status"], "browser.status"], [["browser", "close"], "browser.close"],
    [["monitor", "create"], "monitor.create"], [["monitor", "list"], "monitor.list"], [["monitor", "status"], "monitor.status"],
    [["monitor", "update"], "monitor.update"], [["monitor", "pause"], "monitor.pause"], [["monitor", "resume"], "monitor.resume"],
    [["monitor", "trigger"], "monitor.trigger"], [["monitor", "delete"], "monitor.delete"], [["monitor", "runs"], "monitor.runs"],
    [["monitor", "run"], "monitor.run.get"], [["monitor", "site", "create"], "monitor.site.create"], [["monitor", "site", "list"], "monitor.site.list"],
    [["monitor", "site", "status"], "monitor.site.status"], [["monitor", "site", "update"], "monitor.site.update"],
    [["monitor", "site", "pause"], "monitor.site.pause"], [["monitor", "site", "resume"], "monitor.site.resume"],
    [["monitor", "site", "trigger"], "monitor.site.trigger"], [["monitor", "site", "delete"], "monitor.site.delete"],
    [["monitor", "site", "checks"], "monitor.site.checks"], [["monitor", "site", "check"], "monitor.site.check.get"],
  ];
  // CLI aliases replace only the final command segment (for example, `web search`
  // becomes `web <cliName>`); parent groups keep their documented names.
  // Resolve before renaming so a renamed sibling cannot change later path lookups.
  const commands = commandPaths.map(([path, capability]) => ({ command: findCommand(root, path), capability }));
  for (const { command, capability } of commands) {
    if (command && !isToolEnabled(config, capability)) removeDisabledCommand(command);
  }
  for (const { command, capability } of commands) {
    const alias = config.tools[capability]?.cliName;
    if (command && isToolEnabled(config, capability) && alias) command.name(alias);
  }
  const checkNames = (parent: Command): void => {
    const names = new Set<string>();
    for (const command of parent.commands) {
      if (names.has(command.name())) throw new Error(`Duplicate CLI command name under ${parent.name()}: ${command.name()}`);
      names.add(command.name());
      checkNames(command);
    }
  };
  checkNames(root);
}

function removeDisabledCommand(command: Command): void {
  const parent = command.parent;
  if (!parent) return;
  // Commander exposes commands as readonly; replace the collection rather than mutating it.
  // SAFETY: Commander stores child commands in this mutable runtime collection.
  const mutableParent = parent as unknown as { commands: Command[] };
  mutableParent.commands = parent.commands.filter((candidate) => candidate !== command);
  // Nested shapes such as `monitor site <subcommand>` must not leave an empty group visible.
  if (parent !== program && parent.commands.length === 0) removeDisabledCommand(parent);
}

function findCommand(root: Command, path: string[]): Command | undefined {
  let current: Command | undefined = root;
  for (const segment of path) {
    current = current?.commands.find((command) => command.name() === segment);
  }
  return current;
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
signal: operationController.signal,
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

async function readUseGptContent(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAX_INPUT_BYTES) throw new Error("Inline content exceeds 1 MiB.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally { await handle.close(); }
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

async function writeUseGptCommand(capability: UseGptCapability, input: Record<string, unknown>): Promise<void> {
  try {
    await writeCommandResult(await invokeCapability(capability, { protocolVersion: PROTOCOL_VERSION, capability, input }, { originalEnvironment, signal: operationController.signal }), true);
  } catch (error) { writeMachineFailure(capability, error); }
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
  if (capability.startsWith("usegpt.")) {
    const message = error instanceof ProviderError ? error.message : "UseGPT command failed.";
    process.stdout.write(`${JSON.stringify(useGptFailure(capability as UseGptCapability, "invalid-request", message))}\n`);
    process.exitCode = 1;
    return;
  }
  if (capability === "weknora.connection.verify") {
    writeMachineResult(weknoraVerifyFailure(error instanceof ProviderError && error.kind === "config" ? "config" : "invalid-request"));
    return;
  }
  if (capability === "weknora.knowledge-bases.list" || capability === "weknora.knowledge-bases.get" || capability === "weknora.search") {
    writeMachineResult(WeknoraRetrievalEnvelopeSchemas[capability].parse({
      ...weknoraVerifyFailure(error instanceof ProviderError && error.kind === "config" ? "config" : "invalid-request"), capability,
    }));
    return;
  }
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
  writeDiagnostic(normalized.message);
}

function writeDiagnostic(message: string): void {
  const plan = buildDiagnosticPlan(message);
  process.stderr.write(renderDiagnostic(plan));
  process.exitCode = plan.exitCode;
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
  const value = await readJsonInput(path);
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
