import { z } from "zod";

import { ProviderError } from "../errors/provider-error.js";
import type { BrowserSessionId } from "../protocol/types.js";
import { postJson, requestJson, type FetchLike } from "./http.js";

const SessionSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  createdAt: z.string().optional(),
  lastActivity: z.string().optional(),
  expiresAt: z.string().optional(),
}).loose();
const CreateSchema = SessionSchema.extend({ success: z.literal(true) }).loose();
const ExecuteSchema = z.object({
  success: z.literal(true),
  stdout: z.string().optional().default(""),
  result: z.unknown().optional(),
  stderr: z.string().optional().default(""),
  exitCode: z.number().int().optional().default(0),
  killed: z.boolean().optional().default(false),
}).loose();
const ListSchema = z.object({ success: z.literal(true), sessions: z.array(SessionSchema) }).loose();

export interface BrowserProviderSession {
  id: BrowserSessionId;
  status: "active" | "closed" | "expired" | "unknown";
  createdAt?: string;
  lastActivityAt?: string;
  expiresAt?: string;
}

export interface BrowserProviderExecution {
  output: string;
  exitCode: number;
  killed: boolean;
}

export interface BrowserProvider {
  readonly id: "firecrawl";
  create(key: string, input: { ttlSeconds: number; activityTtlSeconds: number; timeoutMs: number }, signal?: AbortSignal): Promise<BrowserProviderSession>;
  execute(key: string, sessionId: BrowserSessionId, command: string, timeoutMs: number, signal?: AbortSignal): Promise<BrowserProviderExecution>;
  status(key: string, sessionId: BrowserSessionId, timeoutMs: number, signal?: AbortSignal): Promise<BrowserProviderSession>;
  close(key: string, sessionId: BrowserSessionId, timeoutMs: number, signal?: AbortSignal): Promise<void>;
}

export class FirecrawlBrowserProvider implements BrowserProvider {
  readonly id = "firecrawl" as const;

  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly baseUrl = "https://api.firecrawl.dev",
  ) {}

  async create(key: string, input: { ttlSeconds: number; activityTtlSeconds: number; timeoutMs: number }, externalSignal?: AbortSignal): Promise<BrowserProviderSession> {
    const value = await withTimeout(input.timeoutMs, externalSignal, (signal) => postJson(this.fetcher, this.id, `${this.baseUrl}/v2/interact`, auth(key), {
      ttl: input.ttlSeconds,
      activityTtl: input.activityTtlSeconds,
    }, signal));
    const parsed = CreateSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("create");
    return normalizeSession(parsed.data);
  }

  async execute(key: string, sessionId: BrowserSessionId, command: string, timeoutMs: number, externalSignal?: AbortSignal): Promise<BrowserProviderExecution> {
    const value = await withTimeout(timeoutMs, externalSignal, (signal) => postJson(
      this.fetcher,
      this.id,
      `${this.baseUrl}/v2/interact/${encodeURIComponent(sessionId)}/execute`,
      auth(key),
      { code: command, language: "bash", timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)) },
      signal,
    ));
    const parsed = ExecuteSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("execute");
    const output = parsed.data.stdout || serializeResult(parsed.data.result) || parsed.data.stderr;
    return { output, exitCode: parsed.data.exitCode, killed: parsed.data.killed };
  }

  async status(key: string, sessionId: BrowserSessionId, timeoutMs: number, externalSignal?: AbortSignal): Promise<BrowserProviderSession> {
    const value = await withTimeout(timeoutMs, externalSignal, (signal) => requestJson(this.fetcher, this.id, `${this.baseUrl}/v2/interact?status=active`, {
      method: "GET",
      headers: auth(key),
      signal,
    }));
    const parsed = ListSchema.safeParse(value);
    if (!parsed.success) throw invalidResponse("list");
    const session = parsed.data.sessions.find((candidate) => candidate.id === sessionId);
    return session ? normalizeSession(session) : { id: sessionId, status: "expired" };
  }

  async close(key: string, sessionId: BrowserSessionId, timeoutMs: number, externalSignal?: AbortSignal): Promise<void> {
    try {
      await withTimeout(timeoutMs, externalSignal, (signal) => requestJson(
        this.fetcher,
        this.id,
        `${this.baseUrl}/v2/interact/${encodeURIComponent(sessionId)}`,
        { method: "DELETE", headers: auth(key), signal },
      ));
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return;
      throw error;
    }
  }
}

function auth(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

function normalizeSession(value: z.infer<typeof SessionSchema>): BrowserProviderSession {
  return {
    id: value.id as BrowserSessionId,
    status: value.status === "active" || value.status === "closed" || value.status === "expired" ? value.status : "unknown",
    ...(value.createdAt ? { createdAt: value.createdAt } : {}),
    ...(value.lastActivity ? { lastActivityAt: value.lastActivity } : {}),
    ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
  };
}

function serializeResult(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function invalidResponse(operation: string): ProviderError {
  return new ProviderError(`firecrawl returned an invalid Browser ${operation} response.`, { kind: "invalid-response" });
}

async function withTimeout<T>(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Browser request timed out.")), timeoutMs);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}
