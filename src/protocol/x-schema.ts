import { z } from "zod";

export const X_CAPABILITIES = ["x.search", "x.thread", "x.user", "x.timeline"] as const;
export type XCapability = (typeof X_CAPABILITIES)[number];

const handle = z.string().regex(/^@?[A-Za-z0-9_]{1,15}$/);
const tweetRef = z.string().max(300).regex(/^(?:\d{1,25}|https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}[^\s]*)$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cursor = z.string().min(1).max(2_000);
// confirmed = consent to spend the operator's X session quota through the configured instance.
const base = { confirmed: z.literal(true), timeoutMs: z.number().int().min(1).max(60_000).default(20_000) };

export const XSearchRequestSchema = z.object({
  protocolVersion: z.literal(1), capability: z.literal("x.search"),
  input: z.object({
    ...base,
    query: z.string().max(500).default(""),
    from: z.array(handle).max(10).default([]),
    since: date.optional(), until: date.optional(),
    minLikes: z.number().int().min(0).max(999_999_999).optional(),
    mode: z.enum(["latest", "top", "media"]).default("latest"),
    filter: z.enum(["media", "images", "videos", "links", "news", "quote", "mentions", "replies"]).optional(),
    includeRetweets: z.boolean().default(false),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: cursor.optional(),
  }).strict().refine(value => value.query.trim() !== "" || value.from.length > 0, "Provide query and/or from."),
}).strict();
export const XThreadRequestSchema = z.object({
  protocolVersion: z.literal(1), capability: z.literal("x.thread"),
  input: z.object({
    ...base, tweet: tweetRef, includeReplies: z.boolean().default(false),
    maxReplies: z.number().int().min(1).max(100).default(20),
    sort: z.enum(["relevance", "recency", "likes"]).default("relevance"), cursor: cursor.optional(),
  }).strict(),
}).strict();
export const XUserRequestSchema = z.object({
  protocolVersion: z.literal(1), capability: z.literal("x.user"),
  input: z.object({ ...base, username: handle, includeAbout: z.boolean().default(false) }).strict(),
}).strict();
export const XTimelineRequestSchema = z.object({
  protocolVersion: z.literal(1), capability: z.literal("x.timeline"),
  input: z.object({
    ...base, username: handle, tab: z.enum(["posts", "replies", "media", "articles"]).default("posts"),
    limit: z.number().int().min(1).max(50).default(20), cursor: cursor.optional(),
  }).strict(),
}).strict();
export const XRequestSchemas = {
  "x.search": XSearchRequestSchema, "x.thread": XThreadRequestSchema, "x.user": XUserRequestSchema, "x.timeline": XTimelineRequestSchema,
} as const;
export const XRequestSchema = z.discriminatedUnion("capability", [XSearchRequestSchema, XThreadRequestSchema, XUserRequestSchema, XTimelineRequestSchema]);

export const X_FAILURE_KINDS = [
  "invalid-request", "config", "auth", "permission", "rate-limit", "transient", "upstream-error",
  "not-found", "protected-account", "user-suspended", "invalid-response", "timeout", "cancelled", "network",
] as const;
export type XFailureKind = (typeof X_FAILURE_KINDS)[number];

const s = (max: number) => z.string().max(max);
const brief = z.object({ username: s(100), name: s(1_000), verified: z.boolean() }).strict();
const stats = z.object({ replies: z.number(), reposts: z.number(), likes: z.number(), views: z.number().nullable() }).strict();
const media = z.object({ type: s(32), url: s(4_096).optional(), playlist: s(4_096).optional(), thumbnail: s(4_096).optional(), altText: s(2_000).optional() }).strict();
const card = z.object({ kind: s(64), title: s(2_000).optional(), description: s(4_000).optional(), url: s(4_096).optional(), domain: s(500).optional() }).strict();
const tweetCore = {
  id: s(32), url: s(500), available: z.boolean(), tombstone: s(2_000).optional(),
  author: brief.optional(), text: s(10_000).optional(), createdAt: s(40).optional(), stats: stats.optional(),
  conversationId: s(32).optional(), inReplyToId: s(32).optional(), replyingTo: z.array(s(100)).max(50).optional(),
  media: z.array(media).max(20).optional(), card: card.optional(), communityNote: s(4_000).optional(),
  retweetedBy: brief.optional(), pinned: z.boolean().optional(),
};
const quoted = z.object(tweetCore).strict();
export const XTweetSchema = z.object({ ...tweetCore, quote: quoted.optional() }).strict();
export const XUserSchema = z.object({
  id: s(32), username: s(100), name: s(1_000), url: s(500), bio: s(5_000), location: s(500), website: s(2_000),
  verified: s(64).nullable(), protected: z.boolean(), joined: s(40),
  stats: z.object({ followers: z.number().nullable(), following: z.number().nullable(), tweets: z.number().nullable(), likes: z.number().nullable(), media: z.number().nullable() }).strict(),
  pinnedTweetId: s(32).optional(),
  about: z.object({ basedIn: s(200).optional(), source: s(200).optional(), usernameChanges: z.number().optional(), identityVerified: z.boolean().optional(), affiliate: s(200).optional() }).strict().optional(),
}).strict();

const page = { items: z.array(XTweetSchema).max(200), nextCursor: s(2_000).nullable(), hasMore: z.boolean() };
export const XSearchDataSchema = z.object({ query: s(1_000).optional(), ...page }).strict();
export const XTimelineDataSchema = z.object({ user: z.object({ username: s(100), name: s(1_000) }).strict().optional(), tab: z.enum(["posts", "replies", "media", "articles"]), ...page }).strict();
export const XThreadDataSchema = z.object({
  tweet: XTweetSchema, ancestors: z.array(XTweetSchema).max(200), continuation: z.array(XTweetSchema).max(200),
  replies: z.array(z.array(XTweetSchema).max(200)).max(200), repliesOmitted: z.number().int().min(0).optional(),
  nextCursor: s(2_000).nullable(), hasMore: z.boolean(),
}).strict();
export const XUserDataSchema = z.object({ user: XUserSchema }).strict();

const common = { protocolVersion: z.literal(1), connection: z.literal("nitter"), warnings: z.array(s(1_000)).max(10) };
const failure = (capability: XCapability) => z.object({
  ...common, capability: z.literal(capability), ok: z.literal(false), source: z.enum(["managed", "environment"]).optional(),
  error: z.object({
    kind: z.enum(X_FAILURE_KINDS), message: s(2_000), retryable: z.boolean(),
    retryAfterSeconds: z.number().int().min(1).max(86_400).optional(), status: z.number().int().min(100).max(599).optional(),
  }).strict(),
}).strict();
// Tweet text, bios and names are attacker-controlled third-party data.
const success = <T extends z.ZodType>(capability: XCapability, data: T) => z.object({
  ...common, capability: z.literal(capability), ok: z.literal(true), source: z.enum(["managed", "environment"]),
  contentTrust: z.literal("untrusted"), data,
}).strict();
export const XEnvelopeSchemas = {
  "x.search": z.discriminatedUnion("ok", [success("x.search", XSearchDataSchema), failure("x.search")]),
  "x.thread": z.discriminatedUnion("ok", [success("x.thread", XThreadDataSchema), failure("x.thread")]),
  "x.user": z.discriminatedUnion("ok", [success("x.user", XUserDataSchema), failure("x.user")]),
  "x.timeline": z.discriminatedUnion("ok", [success("x.timeline", XTimelineDataSchema), failure("x.timeline")]),
} as const;
export type XEnvelope = z.infer<(typeof XEnvelopeSchemas)[XCapability]>;

export function xFailure(capability: XCapability, kind: XFailureKind, extra: { retryable?: boolean; retryAfterSeconds?: number; status?: number; warnings?: string[]; source?: "managed" | "environment" } = {}): XEnvelope {
  const hints: Partial<Record<XFailureKind, string>> = {
    "invalid-request": " Supply the request schema with confirmed=true after the user agreed to spend X session quota.",
    config: " Run `arks setup nitter`, or supply both NITTER_BASE_URL and NITTER_API_TOKEN; never mix sources.",
    auth: " Check the Nitter token in your trusted terminal; do not paste it into Agent chat.",
    permission: " The instance refused this request (origin or access policy).",
    "rate-limit": " X or the instance is limiting requests; wait before retrying.",
    "protected-account": " The account is protected; its content is not publicly visible.",
    "user-suspended": " The account is suspended.",
  };
  return XEnvelopeSchemas[capability].parse({
    protocolVersion: 1, capability, connection: "nitter", ok: false, ...(extra.source ? { source: extra.source } : {}), warnings: extra.warnings ?? [],
    error: {
      kind, message: `X request failed (${kind}).${hints[kind] ?? ""}`, retryable: extra.retryable ?? false,
      ...(extra.retryAfterSeconds ? { retryAfterSeconds: extra.retryAfterSeconds } : {}), ...(extra.status !== undefined ? { status: extra.status } : {}),
    },
  });
}
