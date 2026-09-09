import { executeBrowserClose, executeBrowserInteract, executeBrowserOpen, executeBrowserSnapshot, executeBrowserStatus } from "../capabilities/browser.js";
import { executeCodeContext } from "../capabilities/code-context.js";
import { executeMonitorCreate, executeMonitorDelete, executeMonitorList, executeMonitorPause, executeMonitorResume, executeMonitorRunGet, executeMonitorRuns, executeMonitorStatus, executeMonitorTrigger, executeMonitorUpdate } from "../capabilities/monitor.js";
import { executeResearch } from "../capabilities/research.js";
import { executeSiteMonitorCheckGet, executeSiteMonitorChecks, executeSiteMonitorCreate, executeSiteMonitorDelete, executeSiteMonitorList, executeSiteMonitorPause, executeSiteMonitorResume, executeSiteMonitorStatus, executeSiteMonitorTrigger, executeSiteMonitorUpdate } from "../capabilities/site-monitor.js";
import { executeWebCrawl } from "../capabilities/web-crawl.js";
import { executeWebExtract } from "../capabilities/web-extract.js";
import { executeWebFetch } from "../capabilities/web-fetch.js";
import { executeWebMap } from "../capabilities/web-map.js";
import { executeWebRelated } from "../capabilities/web-related.js";
import { executeWebSearch } from "../capabilities/web-search.js";
import { resolveArkSpacePaths, type ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { ProviderError } from "../errors/provider-error.js";
import { createCodeContextProviderRegistry, createCrawlProviderRegistry, createExtractProviderRegistry, createFetchProviderRegistry, createMapProviderRegistry, createRelatedProviderRegistry, createResearchProviderRegistry, createSearchProviderRegistry } from "../providers/registry.js";
import { parseBrowserCloseRequest, parseBrowserInteractRequest, parseBrowserOpenRequest, parseBrowserSnapshotRequest, parseBrowserStatusRequest, parseMonitorCreateRequest, parseMonitorDeleteRequest, parseMonitorListRequest, parseMonitorPauseRequest, parseMonitorResumeRequest, parseMonitorRunGetRequest, parseMonitorRunsRequest, parseMonitorStatusRequest, parseMonitorTriggerRequest, parseMonitorUpdateRequest } from "./resource-schema.js";
import { parseCodeContextRequest, parseResearchRequest, parseWebCrawlRequest, parseWebExtractRequest, parseWebFetchRequest, parseWebMapRequest, parseWebRelatedRequest, parseWebSearchRequest } from "./schema.js";
import { parseSiteMonitorCheckGetRequest, parseSiteMonitorChecksRequest, parseSiteMonitorCreateRequest, parseSiteMonitorDeleteRequest, parseSiteMonitorListRequest, parseSiteMonitorPauseRequest, parseSiteMonitorResumeRequest, parseSiteMonitorStatusRequest, parseSiteMonitorTriggerRequest, parseSiteMonitorUpdateRequest } from "./site-monitor-schema.js";
import type { Capability } from "./types.js";

export const CAPABILITIES = [
  "web.search", "web.fetch", "web.map", "web.crawl", "web.related", "web.extract", "code.context", "research.run",
  "browser.open", "browser.snapshot", "browser.interact", "browser.status", "browser.close",
  "monitor.create", "monitor.list", "monitor.status", "monitor.update", "monitor.pause", "monitor.resume", "monitor.trigger", "monitor.delete", "monitor.runs", "monitor.run.get",
  "monitor.site.create", "monitor.site.list", "monitor.site.status", "monitor.site.update", "monitor.site.pause", "monitor.site.resume", "monitor.site.trigger", "monitor.site.delete", "monitor.site.checks", "monitor.site.check.get",
] as const satisfies readonly Capability[];

export interface InvokeOptions {
  paths?: ArkSpacePaths;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function invokeCapability(capability: Capability, request: unknown, options: InvokeOptions = {}): Promise<{ ok: boolean }> {
  const paths = options.paths ?? resolveArkSpacePaths(options.environment);
  const config = await loadConfig(paths.config);
  const providerContext = { config, statePath: paths.state, ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) };
  switch (capability) {
    case "web.search": return executeWebSearch(parseWebSearchRequest(request).input, { config, statePath: paths.state, providers: createSearchProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "web.fetch": return executeWebFetch(parseWebFetchRequest(request).input, { config, statePath: paths.state, providers: createFetchProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "web.map": return executeWebMap(parseWebMapRequest(request).input, { config, statePath: paths.state, providers: createMapProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "web.crawl": return executeWebCrawl(parseWebCrawlRequest(request).input, { config, statePath: paths.state, providers: createCrawlProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "web.related": return executeWebRelated(parseWebRelatedRequest(request).input, { config, statePath: paths.state, providers: createRelatedProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "web.extract": return executeWebExtract(parseWebExtractRequest(request).input, { config, statePath: paths.state, providers: createExtractProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "code.context": return executeCodeContext(parseCodeContextRequest(request).input, { config, statePath: paths.state, providers: createCodeContextProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "research.run": return executeResearch(parseResearchRequest(request).input, { config, statePath: paths.state, providers: createResearchProviderRegistry(), ...(options.environment ? { environment: options.environment } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    case "browser.open": return executeBrowserOpen(parseBrowserOpenRequest(request), providerContext);
    case "browser.snapshot": return executeBrowserSnapshot(parseBrowserSnapshotRequest(request), providerContext);
    case "browser.interact": return executeBrowserInteract(parseBrowserInteractRequest(request), providerContext);
    case "browser.status": return executeBrowserStatus(parseBrowserStatusRequest(request), providerContext);
    case "browser.close": return executeBrowserClose(parseBrowserCloseRequest(request), providerContext);
    case "monitor.create": return executeMonitorCreate(parseMonitorCreateRequest(request), providerContext);
    case "monitor.list": return executeMonitorList(parseMonitorListRequest(request), providerContext);
    case "monitor.status": return executeMonitorStatus(parseMonitorStatusRequest(request), providerContext);
    case "monitor.update": return executeMonitorUpdate(parseMonitorUpdateRequest(request), providerContext);
    case "monitor.pause": return executeMonitorPause(parseMonitorPauseRequest(request), providerContext);
    case "monitor.resume": return executeMonitorResume(parseMonitorResumeRequest(request), providerContext);
    case "monitor.trigger": return executeMonitorTrigger(parseMonitorTriggerRequest(request), providerContext);
    case "monitor.delete": return executeMonitorDelete(parseMonitorDeleteRequest(request), providerContext);
    case "monitor.runs": return executeMonitorRuns(parseMonitorRunsRequest(request), providerContext);
    case "monitor.run.get": return executeMonitorRunGet(parseMonitorRunGetRequest(request), providerContext);
    case "monitor.site.create": return executeSiteMonitorCreate(parseSiteMonitorCreateRequest(request), providerContext);
    case "monitor.site.list": return executeSiteMonitorList(parseSiteMonitorListRequest(request), providerContext);
    case "monitor.site.status": return executeSiteMonitorStatus(parseSiteMonitorStatusRequest(request), providerContext);
    case "monitor.site.update": return executeSiteMonitorUpdate(parseSiteMonitorUpdateRequest(request), providerContext);
    case "monitor.site.pause": return executeSiteMonitorPause(parseSiteMonitorPauseRequest(request), providerContext);
    case "monitor.site.resume": return executeSiteMonitorResume(parseSiteMonitorResumeRequest(request), providerContext);
    case "monitor.site.trigger": return executeSiteMonitorTrigger(parseSiteMonitorTriggerRequest(request), providerContext);
    case "monitor.site.delete": return executeSiteMonitorDelete(parseSiteMonitorDeleteRequest(request), providerContext);
    case "monitor.site.checks": return executeSiteMonitorChecks(parseSiteMonitorChecksRequest(request), providerContext);
    case "monitor.site.check.get": return executeSiteMonitorCheckGet(parseSiteMonitorCheckGetRequest(request), providerContext);
  }
  throw new ProviderError(`Unsupported capability: ${capability}`, { kind: "invalid-request" });
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
