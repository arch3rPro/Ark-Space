import { ProviderError } from "../errors/provider-error.js";
import { withFileLock, writeJsonAtomic } from "../io/json-store.js";
import type { KeyId } from "../protocol/types.js";
import { loadState } from "../key-pool/key-pool.js";
import type { BrowserSessionOwner, FirecrawlMonitorOwner, MonitorOwner } from "./schema.js";

export async function putBrowserOwner(
  statePath: string,
  sessionId: string,
  owner: BrowserSessionOwner,
): Promise<void> {
  await mutateState(statePath, (state) => {
    state.resources.browserSessions[sessionId] = owner;
  });
}

export async function getBrowserOwner(statePath: string, sessionId: string): Promise<BrowserSessionOwner> {
  const owner = (await loadState(statePath)).resources.browserSessions[sessionId];
  if (!owner) throw unknownResource("browser session", sessionId);
  return owner;
}

export async function listBrowserOwners(statePath: string): Promise<Array<{ sessionId: string } & BrowserSessionOwner>> {
  const owners = (await loadState(statePath)).resources.browserSessions;
  return Object.entries(owners).map(([sessionId, owner]) => ({ sessionId, ...owner }));
}

export async function removeBrowserOwner(statePath: string, sessionId: string): Promise<void> {
  await mutateState(statePath, (state) => {
    delete state.resources.browserSessions[sessionId];
  });
}

export async function putMonitorOwner(
  statePath: string,
  monitorId: string,
  owner: MonitorOwner,
): Promise<void> {
  await mutateState(statePath, (state) => {
    state.resources.monitors[monitorId] = owner;
  });
}

export async function getMonitorOwner(statePath: string, monitorId: string): Promise<MonitorOwner> {
  const owner = (await loadState(statePath)).resources.monitors[monitorId];
  if (!owner) throw unknownResource("monitor", monitorId);
  return owner;
}

export async function listMonitorOwners(statePath: string): Promise<Array<{ monitorId: string } & MonitorOwner>> {
  const owners = (await loadState(statePath)).resources.monitors;
  return Object.entries(owners).map(([monitorId, owner]) => ({ monitorId, ...owner }));
}

export async function removeMonitorOwner(statePath: string, monitorId: string): Promise<void> {
  await mutateState(statePath, (state) => {
    delete state.resources.monitors[monitorId];
  });
}

export async function putSiteMonitorOwner(statePath: string, monitorId: string, owner: FirecrawlMonitorOwner): Promise<void> {
  await mutateState(statePath, (state) => {
    state.resources.siteMonitors[monitorId] = owner;
  });
}

export async function getSiteMonitorOwner(statePath: string, monitorId: string): Promise<FirecrawlMonitorOwner> {
  const owner = (await loadState(statePath)).resources.siteMonitors[monitorId];
  if (!owner) throw unknownResource("site monitor", monitorId);
  return owner;
}

export async function listSiteMonitorOwners(statePath: string): Promise<Array<{ monitorId: string } & FirecrawlMonitorOwner>> {
  return Object.entries((await loadState(statePath)).resources.siteMonitors).map(([monitorId, owner]) => ({ monitorId, ...owner }));
}

export async function removeSiteMonitorOwner(statePath: string, monitorId: string): Promise<void> {
  await mutateState(statePath, (state) => {
    delete state.resources.siteMonitors[monitorId];
  });
}

function unknownResource(kind: string, id: string): ProviderError {
  return new ProviderError(`Unknown ArkSpace-owned ${kind}: ${id}.`, { kind: "invalid-request" });
}

async function mutateState(
  statePath: string,
  change: (state: Awaited<ReturnType<typeof loadState>>) => void,
): Promise<void> {
  await withFileLock(statePath, async () => {
    const state = await loadState(statePath);
    change(state);
    await writeJsonAtomic(statePath, state);
  });
}

export function asKeyId(value: string): KeyId {
  return value as KeyId;
}
