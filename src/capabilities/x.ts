import type { ArkSpacePaths } from "../config/paths.js";
import { loadConfig } from "../config/store.js";
import { isToolEnabled } from "../config/schema.js";
import { resolveNitterConnection } from "../config/nitter.js";
import { LocalHttpError, localHttpNitterGet } from "../providers/local-http.js";
import { XEnvelopeSchemas, XRequestSchema, xFailure, type XCapability, type XEnvelope, type XFailureKind, type XFailureReason } from "../protocol/x-schema.js";

type Json = Record<string, unknown>;
const isObj = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const bad = (): never => { throw new TypeError("invalid upstream shape"); };
const obj = (value: unknown): Json => isObj(value) ? value : bad();
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : bad();
const num = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : bad();
const optNum = (value: unknown): number | undefined => value === undefined || value === null ? undefined : num(value);
const nullNum = (value: unknown): number | null => value === undefined || value === null ? null : num(value);
const set = <T extends Json>(target: T, key: string, value: unknown): T => { if (value !== undefined) (target as Json)[key] = value; return target; };

function project(capability: XCapability, data: Json, warnings: string[]): Json {
  const warnTruncated = () => {
    const warning = "Nitter response was truncated locally; returned content may be incomplete even when hasMore is false.";
    if (!warnings.includes(warning)) warnings.push(warning);
  };
  const str = (value: unknown, max: number): string => {
    if (typeof value !== "string") return bad();
    if (value.length > max) warnTruncated();
    return value.slice(0, max);
  };
  const optStr = (value: unknown, max: number): string | undefined => value === undefined || value === null ? undefined : str(value, max);
  const take = (value: unknown, max: number): unknown[] => {
    const values = arr(value);
    if (values.length > max) warnTruncated();
    return values.slice(0, max);
  };
  function brief(value: unknown) {
    const v = obj(value);
    return { username: str(v.username, 100), name: str(v.name ?? "", 1_000), verified: v.verified === true };
  }
  function tweet(value: unknown, depth = 0): Json {
    const v = obj(value);
    const out: Json = { id: str(v.id, 32), url: str(v.url, 500), available: v.available !== false };
    set(out, "tombstone", optStr(v.tombstone, 2_000));
    if (v.author !== undefined) out.author = brief(v.author);
    set(out, "text", optStr(v.text, 10_000));
    set(out, "createdAt", optStr(v.created_at, 40));
    if (v.stats !== undefined && v.stats !== null) {
      const st = obj(v.stats);
      out.stats = { replies: num(st.replies), reposts: num(st.reposts), likes: num(st.likes), views: nullNum(st.views) };
    }
    set(out, "conversationId", optStr(v.conversation_id, 32));
    set(out, "inReplyToId", optStr(v.in_reply_to_id, 32));
    if (v.replying_to !== undefined) out.replyingTo = take(v.replying_to, 50).map(item => str(item, 100));
    if (v.media !== undefined) out.media = take(v.media, 20).map(item => {
      const m = obj(item);
      const media: Json = { type: str(m.type, 32) };
      set(media, "url", optStr(m.url, 4_096)); set(media, "playlist", optStr(m.playlist, 4_096));
      set(media, "thumbnail", optStr(m.thumbnail, 4_096)); set(media, "altText", optStr(m.alt_text, 2_000));
      return media;
    });
    if (v.poll !== undefined && v.poll !== null) {
      const p = obj(v.poll);
      out.poll = {
        options: take(p.options, 20).map(value => {
          const option = obj(value);
          return { label: str(option.label, 1_000), votes: num(option.votes) };
        }),
        totalVotes: num(p.total_votes), status: str(p.status, 500),
      };
    }
    if (v.card !== undefined && v.card !== null) {
      const c = obj(v.card);
      const card: Json = { kind: str(c.kind, 64) };
      set(card, "title", optStr(c.title, 2_000)); set(card, "description", optStr(c.description, 4_000));
      set(card, "url", optStr(c.url, 4_096)); set(card, "domain", optStr(c.domain, 500));
      out.card = card;
    }
    set(out, "communityNote", optStr(v.community_note, 4_000));
    if (v.retweeted_by !== undefined) out.retweetedBy = brief(v.retweeted_by);
    if (v.pinned === true) out.pinned = true;
    if (v.quote !== undefined && v.quote !== null) {
      if (depth < 1) out.quote = tweet(v.quote, depth + 1);
      else warnTruncated();
    }
    return out;
  }
  const tweets = (value: unknown, max = 200): Json[] => take(value, max).map(item => tweet(item));
  const pagination = () => {
    const hasMore = data.has_more, nextCursor = data.next_cursor;
    if (typeof hasMore !== "boolean") return bad();
    if (nextCursor !== null && (typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor.length > 2_000)) return bad();
    if (hasMore !== (nextCursor !== null)) return bad();
    return { nextCursor, hasMore };
  };

  function user(value: unknown): Json {
    const v = obj(value); const st = obj(v.stats);
    const out: Json = {
      id: str(v.id, 32), username: str(v.username, 100), name: str(v.name ?? "", 1_000), url: str(v.url, 500),
      bio: str(v.bio ?? "", 5_000), location: str(v.location ?? "", 500), website: str(v.website ?? "", 2_000),
      verified: optStr(v.verified, 64) ?? null, protected: v.protected === true, joined: str(v.joined ?? "", 40),
      stats: { followers: nullNum(st.followers), following: nullNum(st.following), tweets: nullNum(st.tweets), likes: nullNum(st.likes), media: nullNum(st.media) },
    };
    set(out, "pinnedTweetId", optStr(v.pinned_tweet_id, 32));
    if (v.about !== undefined && v.about !== null) {
      const a = obj(v.about); const about: Json = {};
      set(about, "basedIn", optStr(a.based_in, 200)); set(about, "source", optStr(a.source, 200));
      set(about, "usernameChanges", optNum(a.username_changes));
      if (typeof a.identity_verified === "boolean") about.identityVerified = a.identity_verified;
      set(about, "affiliate", optStr(a.affiliate, 200));
      out.about = about;
    }
    return out;
  }
  switch (capability) {
    case "x.search": {
      const out: Json = { items: tweets(data.items), ...pagination() };
      set(out, "query", optStr(data.query, 1_000));
      return out;
    }
    case "x.timeline": {
      const out: Json = { tab: str(data.tab, 16), items: tweets(data.items), ...pagination() };
      if (data.user !== undefined) { const u = obj(data.user); out.user = { username: str(u.username, 100), name: str(u.name ?? "", 1_000) }; }
      return out;
    }
    case "x.thread": {
      const out: Json = {
        tweet: tweet(data.tweet), ancestors: tweets(data.ancestors), continuation: tweets(data.continuation),
        replies: take(data.replies, 200).map(chain => tweets(chain)),
        ...pagination(),
      };
      set(out, "repliesOmitted", optNum(data.replies_omitted));
      return out;
    }
    case "x.user": return { user: user(data) };
  }
}

function pathFor(request: ReturnType<typeof XRequestSchema.parse>): string {
  const q = new URLSearchParams({ format: "json" });
  switch (request.capability) {
    case "x.search": {
      const input = request.input;
      if (input.query.trim()) q.set("query", input.query);
      if (input.from.length) q.set("from", input.from.map(name => name.replace(/^@/, "")).join(","));
      if (input.since) q.set("since", input.since);
      if (input.until) q.set("until", input.until);
      if (input.minLikes !== undefined) q.set("min_likes", String(input.minLikes));
      q.set("mode", input.mode);
      if (input.filter) q.set("filter", input.filter);
      if (input.includeRetweets) q.set("include_retweets", "true");
      q.set("limit", String(input.limit));
      if (input.cursor) q.set("cursor", input.cursor);
      return `/api/v1/search/tweets?${q}`;
    }
    case "x.thread": {
      const input = request.input;
      q.set("include_replies", String(input.includeReplies)); q.set("max_replies", String(input.maxReplies)); q.set("sort", input.sort);
      if (input.cursor) q.set("cursor", input.cursor);
      return `/api/v1/tweets/${encodeURIComponent(input.tweet)}/thread?${q}`;
    }
    case "x.user": {
      const input = request.input;
      if (input.includeAbout) q.set("include_about", "true");
      return `/api/v1/users/${encodeURIComponent(input.username.replace(/^@/, ""))}?${q}`;
    }
    case "x.timeline": {
      const input = request.input;
      q.set("tab", input.tab); q.set("limit", String(input.limit));
      if (input.cursor) q.set("cursor", input.cursor);
      return `/api/v1/users/${encodeURIComponent(input.username.replace(/^@/, ""))}/tweets?${q}`;
    }
  }
}

const CODE_KIND: Record<string, XFailureKind> = {
  rate_limited: "rate-limit", unauthorized: "auth", forbidden_origin: "permission", invalid_argument: "invalid-request",
  upstream_unavailable: "transient", upstream_error: "upstream-error", internal_error: "upstream-error",
  not_found: "not-found", protected_account: "protected-account", user_suspended: "user-suspended",
};
const RETRYABLE = new Set<XFailureKind>(["rate-limit", "transient"]);
function statusKind(status: number): XFailureKind {
  return status === 401 ? "auth" : status === 403 ? "permission" : status === 404 ? "not-found" : status === 429 ? "rate-limit" : status === 400 ? "invalid-request" : status >= 500 ? "transient" : "invalid-response";
}

/** Read-only, one request, no retry, key rotation, fallback or durable state. Each call spends the operator's X session quota. */
export async function executeX(capability: XCapability, request: unknown, paths: ArkSpacePaths, originalEnvironment: NodeJS.ProcessEnv | undefined, signal?: AbortSignal): Promise<XEnvelope> {
  let source: "managed" | "environment" | undefined;
  let warnings: string[] = [];
  const fail = (kind: XFailureKind, extra: { retryAfterSeconds?: number; status?: number; reason?: XFailureReason } = {}): XEnvelope =>
    xFailure(capability, kind, { retryable: RETRYABLE.has(kind), warnings, ...(source ? { source } : {}), ...extra });
  const parsed = XRequestSchema.safeParse(request);
  if (!parsed.success || parsed.data.capability !== capability) {
    const input = isObj(request) && isObj(request.input) ? request.input : undefined;
    return fail("invalid-request", { reason: input && input.confirmed !== true ? "confirmation-required" : "request-schema" });
  }
  if (!originalEnvironment) return fail("config");
  const controller = new AbortController();
  const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), parsed.data.input.timeoutMs);
  const interrupted = () => fail(signal?.aborted ? "cancelled" : "timeout");
  let abort: (() => void) | undefined;
  try {
    const operation = async (): Promise<XEnvelope> => {
      let connection;
      try {
        const config = await loadConfig(paths.config);
        if (!isToolEnabled(config, capability)) return fail("invalid-request", { reason: "capability-disabled" });
        connection = await resolveNitterConnection(config, paths.credentials, originalEnvironment);
      } catch { return fail("config"); }
      if (active.aborted) return interrupted();
      if (!connection) return fail("config");
      source = connection.source; warnings = connection.warnings;
      try {
        const response = await localHttpNitterGet(connection.baseUrl, connection.token, pathFor(parsed.data), { timeoutMs: parsed.data.input.timeoutMs, signal: active });
        let body: unknown;
        try { body = JSON.parse(response.text); } catch { return fail(response.status >= 200 && response.status < 300 ? "invalid-response" : statusKind(response.status), { status: response.status }); }
        // Canonicalize JSON so Unicode escapes cannot hide an echoed credential.
        if (response.text.includes(connection.token) || JSON.stringify(body).includes(JSON.stringify(connection.token).slice(1, -1))) return fail("invalid-response");
        if (response.status < 200 || response.status >= 300) {
          const error = isObj(body) && isObj(body.error) ? body.error : undefined;
          const kind = (typeof error?.code === "string" ? CODE_KIND[error.code] : undefined) ?? statusKind(response.status);
          const retry = typeof error?.retry_after_s === "number" && Number.isInteger(error.retry_after_s) && error.retry_after_s > 0 ? Math.min(error.retry_after_s, 86_400) : undefined;
          return fail(kind, { status: response.status, ...(retry ? { retryAfterSeconds: retry } : {}) });
        }
        const data = obj(obj(body).data);
        const projected = project(capability, data, warnings);
        return XEnvelopeSchemas[capability].parse({ protocolVersion: 1, capability, connection: "nitter", ok: true, source: connection.source, contentTrust: "untrusted", warnings, data: projected });
      } catch (error) {
        if (active.aborted) return interrupted();
        if (error instanceof LocalHttpError) {
          if (error.kind === "cancelled") return fail("cancelled");
          if (error.kind === "timeout") return fail("timeout");
          if (["invalid-url", "configuration", "blocked-address"].includes(error.kind)) return fail("config");
          if (["content-type", "encoding", "body", "headers", "redirect"].includes(error.kind)) return fail("invalid-response");
          return fail("network", error.status === undefined ? {} : { status: error.status });
        }
        return fail("invalid-response", { reason: "response-schema" });
      }
    };
    return await Promise.race([operation(), new Promise<XEnvelope>(resolve => { abort = () => resolve(interrupted()); active.addEventListener("abort", abort, { once: true }); if (active.aborted) abort(); })]);
  } finally { clearTimeout(timer); if (abort) active.removeEventListener("abort", abort); }
}
