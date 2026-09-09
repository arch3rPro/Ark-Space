import { getProviderConfig, type ArkSpaceConfig } from "../config/schema.js";
import { ProviderError } from "../errors/provider-error.js";
import { recordKeyResult, selectCredential } from "../key-pool/key-pool.js";
import {
  PROTOCOL_VERSION,
  type AttemptEvidence,
  type BrowserAction,
  type BrowserCloseEnvelope,
  type BrowserInteractEnvelope,
  type BrowserInteractInput,
  type BrowserOpenEnvelope,
  type BrowserOpenInput,
  type BrowserResourceInput,
  type BrowserSnapshotEnvelope,
  type BrowserSnapshotInput,
  type BrowserStatusEnvelope,
  type KeyId,
} from "../protocol/types.js";
import { FirecrawlBrowserProvider, type BrowserProvider } from "../providers/firecrawl-browser.js";
import { getBrowserOwner, putBrowserOwner, removeBrowserOwner } from "../state/resources.js";
import { credentialForOwner, failureAttempt, normalizeError, resourceFailure } from "./resource-common.js";

const MAX_BROWSER_OUTPUT = 100_000;

export interface BrowserExecutionContext {
  config: ArkSpaceConfig;
  statePath: string;
  provider?: BrowserProvider;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeBrowserOpen(input: BrowserOpenInput, context: BrowserExecutionContext): Promise<BrowserOpenEnvelope> {
  const providerConfig = getProviderConfig(context.config, "firecrawl");
  if (!providerConfig?.enabled) return resourceFailure("browser.open", new ProviderError("Provider firecrawl is not enabled.", { kind: "config" }));
  let keyId: KeyId | undefined;
  try {
    const lease = await selectCredential(context.statePath, "firecrawl", providerConfig, context.environment);
    keyId = lease.keyId;
    const provider = context.provider ?? new FirecrawlBrowserProvider(fetch, providerConfig.baseUrl);
    let session;
    try {
      session = await provider.create(lease.value, input, context.signal);
    } catch (error) {
      const normalized = normalizeError(error);
      try { await recordKeyResult(context.statePath, "firecrawl", lease.keyId, providerConfig, failedKeyResult(normalized)); } catch { /* Preserve submission evidence. */ }
      const uncertain = normalized.kind === "network" || normalized.kind === "transient";
      const wrapped = uncertain
        ? new ProviderError(normalized.message, { kind: normalized.kind, ...(normalized.status === undefined ? {} : { status: normalized.status }), safeToRetry: false, submission: { resource: "browser-session", state: "acceptance-unknown" }, cause: normalized })
        : normalized;
      return resourceFailure("browser.open", wrapped, [failureAttempt("firecrawl", lease.keyId, wrapped)], uncertain ? ["Session creation may have been accepted; ArkSpace has no session ID and will not retry automatically."] : []);
    }

    await putBrowserOwner(context.statePath, session.id, {
      provider: "firecrawl",
      keyId: lease.keyId,
      createdAt: session.createdAt ?? new Date().toISOString(),
      ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
    });

    try {
      await provider.execute(lease.value, session.id, actionCommand({ type: "navigate", url: input.url }), input.timeoutMs, context.signal);
    } catch (error) {
      const normalized = normalizeError(error);
      let cleanupOk = false;
      try {
        await provider.close(lease.value, session.id, context.config.execution.cleanupTimeoutMs);
        cleanupOk = true;
        await removeBrowserOwner(context.statePath, session.id);
      } catch {
        // Ownership is retained so the session can be closed later.
      }
      const wrapped = new ProviderError(normalized.message, {
        kind: normalized.kind,
        ...(normalized.status === undefined ? {} : { status: normalized.status }),
        safeToRetry: cleanupOk,
        cleanup: { resource: "browser-session", sessionId: session.id, attempted: true, ok: cleanupOk },
        cause: normalized,
      });
      try { await recordKeyResult(context.statePath, "firecrawl", lease.keyId, providerConfig, failedKeyResult(normalized)); } catch { /* Cleanup evidence remains authoritative. */ }
      return resourceFailure("browser.open", wrapped, [failureAttempt("firecrawl", lease.keyId, wrapped)], cleanupOk ? [] : [`Browser session ${session.id} may still be active and billable.`]);
    }

    await recordKeyResult(context.statePath, "firecrawl", lease.keyId, providerConfig, { ok: true });
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "browser.open",
      provider: "firecrawl",
      data: { sessionId: session.id, status: "active", ...(session.createdAt ? { createdAt: session.createdAt } : {}), ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}) },
      attempts: [{ provider: "firecrawl", keyId: lease.keyId, ok: true }],
      warnings: ["The browser session accrues Firecrawl credits until it is closed or expires."],
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return resourceFailure("browser.open", normalized, keyId ? [failureAttempt("firecrawl", keyId, normalized)] : []);
  }
}

export async function executeBrowserSnapshot(input: BrowserSnapshotInput, context: BrowserExecutionContext): Promise<BrowserSnapshotEnvelope> {
  return executeOwnedBrowser("browser.snapshot", input, context, async (provider, key, owner) => {
    const result = await provider.execute(key, input.sessionId, `agent-browser snapshot${input.interactiveOnly ? " -i" : ""}`, input.timeoutMs, context.signal);
    const bounded = boundOutput(result.output);
    return { sessionId: input.sessionId, status: "active", createdAt: owner.createdAt, ...(owner.expiresAt ? { expiresAt: owner.expiresAt } : {}), snapshot: bounded.value, truncated: bounded.truncated };
  });
}

export async function executeBrowserInteract(input: BrowserInteractInput, context: BrowserExecutionContext): Promise<BrowserInteractEnvelope> {
  return executeOwnedBrowser("browser.interact", input, context, async (provider, key, owner) => {
    try {
      const result = await provider.execute(key, input.sessionId, actionCommand(input.action), input.timeoutMs, context.signal);
      const bounded = boundOutput(result.output);
      return { sessionId: input.sessionId, status: "active", createdAt: owner.createdAt, ...(owner.expiresAt ? { expiresAt: owner.expiresAt } : {}), output: bounded.value, exitCode: result.exitCode, killed: result.killed, truncated: bounded.truncated };
    } catch (error) {
      const normalized = normalizeError(error);
      throw new ProviderError(normalized.message, { kind: normalized.kind, ...(normalized.status === undefined ? {} : { status: normalized.status }), safeToRetry: false, cause: normalized });
    }
  }, ["The confirmed browser action may have produced an external side effect if execution is interrupted."]);
}

export async function executeBrowserStatus(input: BrowserResourceInput, context: BrowserExecutionContext): Promise<BrowserStatusEnvelope> {
  return executeOwnedBrowser("browser.status", input, context, async (provider, key) => {
    const session = await provider.status(key, input.sessionId, input.timeoutMs, context.signal);
    if (session.status !== "active") await removeBrowserOwner(context.statePath, input.sessionId);
    return { sessionId: session.id, status: session.status, ...(session.createdAt ? { createdAt: session.createdAt } : {}), ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}), ...(session.lastActivityAt ? { lastActivityAt: session.lastActivityAt } : {}) };
  });
}

export async function executeBrowserClose(input: BrowserResourceInput, context: BrowserExecutionContext): Promise<BrowserCloseEnvelope> {
  return executeOwnedBrowser("browser.close", input, context, async (provider, key) => {
    await provider.close(key, input.sessionId, input.timeoutMs, context.signal);
    await removeBrowserOwner(context.statePath, input.sessionId);
    return { sessionId: input.sessionId, status: "closed" };
  });
}

async function executeOwnedBrowser<C extends "browser.snapshot" | "browser.interact" | "browser.status" | "browser.close", D>(
  capability: C,
  input: { sessionId: BrowserResourceInput["sessionId"]; timeoutMs: number },
  context: BrowserExecutionContext,
  operation: (provider: BrowserProvider, key: string, owner: Awaited<ReturnType<typeof getBrowserOwner>>) => Promise<D>,
  warnings: string[] = [],
): Promise<import("../protocol/types.js").ResourceSuccessEnvelope<C, "firecrawl", D> | import("../protocol/types.js").FailureEnvelope<C>> {
  let keyId: KeyId | undefined;
  try {
    const owner = await getBrowserOwner(context.statePath, input.sessionId);
    keyId = owner.keyId as KeyId;
    const providerConfig = getProviderConfig(context.config, "firecrawl");
    if (!providerConfig) throw new ProviderError("Provider firecrawl is not configured.", { kind: "config" });
    const key = credentialForOwner(context.config, "firecrawl", keyId, context.environment);
    const provider = context.provider ?? new FirecrawlBrowserProvider(fetch, providerConfig.baseUrl);
    const data = await operation(provider, key, owner);
    await recordKeyResult(context.statePath, "firecrawl", keyId, providerConfig, { ok: true });
    return { protocolVersion: PROTOCOL_VERSION, ok: true, capability, provider: "firecrawl", data, attempts: [{ provider: "firecrawl", keyId, ok: true }], warnings };
  } catch (error) {
    const normalized = normalizeError(error);
    const providerConfig = getProviderConfig(context.config, "firecrawl");
    if (keyId && providerConfig) {
      try { await recordKeyResult(context.statePath, "firecrawl", keyId, providerConfig, failedKeyResult(normalized)); } catch { /* Preserve the operation failure. */ }
    }
    return resourceFailure(capability, normalized, keyId ? [failureAttempt("firecrawl", keyId, normalized)] : [], warnings);
  }
}

function failedKeyResult(error: ProviderError): { ok: false; kind: ProviderError["kind"]; retryAfterMs?: number } {
  return { ok: false, kind: error.kind, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }) };
}

function actionCommand(action: BrowserAction): string {
  switch (action.type) {
    case "navigate": return `agent-browser open ${shellQuote(action.url)}`;
    case "click": return `agent-browser click ${action.ref}`;
    case "fill": return `agent-browser fill ${action.ref} ${shellQuote(action.text)}`;
    case "press": return `agent-browser press ${shellQuote(action.key)}`;
    case "scroll": return `agent-browser scroll ${action.direction} ${action.pixels}`;
    case "scrape": return "agent-browser scrape";
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function boundOutput(value: string): { value: string; truncated: boolean } {
  return value.length > MAX_BROWSER_OUTPUT ? { value: value.slice(0, MAX_BROWSER_OUTPUT), truncated: true } : { value, truncated: false };
}
