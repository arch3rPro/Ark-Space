import { z } from "zod";
import { PROTOCOL_VERSION } from "./types.js";

const Id = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const Name = z.string().trim().min(1).max(255);
const Limit = z.number().int().min(1).max(100).default(20);
const Offset = z.number().int().min(0).max(1_000_000).default(0);
const EventCursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0);
const Confirmed = z.literal(true);

const HostFileSize = z.number().int().nonnegative().max(67_108_864);
export const UseGptHostFileSchema = z.union([
  z.object({ file_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/), download_url: z.string().min(1).max(8_192).optional(), name: Name.optional(), file_name: Name.optional(), mime_type: z.string().min(1).max(128).optional(), size: HostFileSize.optional() }).strict(),
  z.object({ type: z.literal("resource_link"), uri: z.string().min(1).max(8_192), name: Name, mimeType: z.string().min(1).max(128).optional(), size: HostFileSize.optional() }).strict(),
]);

export const UseGptModeSchema = z.enum(["chat", "search", "deep-research", "image"]);
export const UseGptTaskIdSchema = z.string().regex(/^ugpt_[a-f0-9-]{36}$/);
const LegacyTaskOptions = {
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), prompt: z.string().trim().min(1).max(200_000),
  mode: UseGptModeSchema.default("chat"), timeoutMs: z.number().int().min(10_000).max(3_600_000).default(1_200_000),
  files: z.array(z.object({ name: Name, content: z.string().max(200_000) }).strict()).max(20).default([]), confirmed: Confirmed,
};

const HubSchemas = {
  "usegpt.project.create": z.object({ name: Name, description: z.string().max(8_000).optional(), idempotencyKey: Id.optional() }).strict(),
  "usegpt.project.list": z.object({ includeDeleted: z.boolean().default(false), limit: Limit, offset: Offset }).strict(),
  "usegpt.project.get": z.object({ projectId: Id, eventCursor: EventCursor }).strict(),
  "usegpt.project.archive": z.object({ projectId: Id }).strict(),
  "usegpt.project.delete": z.object({ projectId: Id, confirmed: Confirmed }).strict(),
  "usegpt.project.restore": z.object({ projectId: Id }).strict(),
  "usegpt.project.purge": z.object({ projectId: Id, confirmed: Confirmed, planToken: Id.optional() }).strict(),
  "usegpt.task.create": z.object({ projectId: Id, title: Name, request: z.string().trim().min(1).max(64_000), artifactRefs: z.array(z.object({ artifactId: Id, revision: z.number().int().positive() }).strict()).max(100).default([]), idempotencyKey: Id.optional() }).strict(),
  "usegpt.task.list": z.object({ projectId: Id.optional(), includeDeleted: z.boolean().default(false), limit: Limit, offset: Offset }).strict(),
  "usegpt.task.get": z.object({ taskId: Id, eventCursor: EventCursor }).strict(),
  "usegpt.task.complete": z.object({ taskId: Id, artifactRefs: z.array(z.object({ artifactId: Id, revision: z.number().int().positive() }).strict()).max(100).default([]) }).strict(),
  "usegpt.task.wait": z.object({ taskId: Id, timeoutMs: z.number().int().min(0).max(60_000).default(30_000) }).strict(),
  "usegpt.task.cancel": z.object({ taskId: Id, confirmed: Confirmed }).strict(),
  "usegpt.task.delete": z.object({ taskId: Id, confirmed: Confirmed }).strict(),
  "usegpt.task.restore": z.object({ taskId: Id }).strict(),
  "usegpt.task.purge": z.object({ taskId: Id, confirmed: Confirmed, planToken: Id.optional() }).strict(),
  "usegpt.artifact.publish_inline": z.object({ projectId: Id, taskId: Id.optional(), artifactId: Id.optional(), name: Name, kind: z.string().trim().min(1).max(64).default("document"), mediaType: z.string().trim().min(1).max(128).default("text/plain"), content: z.string().max(1_048_576), idempotencyKey: Id.optional() }).strict(),
  "usegpt.artifact.publish_file": z.object({ projectId: Id, taskId: Id.optional(), artifactId: Id.optional(), name: Name, kind: z.string().trim().min(1).max(64).default("document"), mediaType: z.string().trim().min(1).max(128).optional(), file: UseGptHostFileSchema, idempotencyKey: Id.optional() }).strict(),
  "usegpt.artifact.list": z.object({ projectId: Id, taskId: Id.optional(), limit: Limit, offset: Offset }).strict(),
  "usegpt.artifact.describe": z.object({ artifactId: Id, taskId: Id.optional(), projectId: Id.optional(), revision: z.number().int().positive().optional() }).strict(),
  "usegpt.artifact.read": z.object({ artifactId: Id, taskId: Id.optional(), projectId: Id.optional(), revision: z.number().int().positive().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(4).max(100_000).default(20_000) }).strict(),
  "usegpt.artifact.delete": z.object({ artifactId: Id, confirmed: Confirmed }).strict(),
  "usegpt.handoff.create": z.object({ projectId: Id, taskId: Id, to: Name, from: Name.optional(), instruction: z.string().trim().min(1).max(8_000), artifactRefs: z.array(z.object({ artifactId: Id, revision: z.number().int().positive() }).strict()).max(100).default([]), idempotencyKey: Id.optional() }).strict(),
  "usegpt.handoff.list": z.object({ projectId: Id.optional(), to: Name.optional(), status: z.enum(["pending", "claimed", "running", "completed", "failed", "cancelled", "unknown"]).optional(), limit: Limit, offset: Offset }).strict(),
  "usegpt.handoff.get": z.object({ handoffId: Id }).strict(),
  "usegpt.handoff.claim": z.object({ handoffId: Id, to: Name }).strict(),
  "usegpt.handoff.complete": z.object({ handoffId: Id, claimToken: z.string().min(1).max(512), generation: z.number().int().positive() }).strict(),
  "usegpt.handoff.fail": z.object({ handoffId: Id, claimToken: z.string().min(1).max(512), generation: z.number().int().positive(), reason: z.string().trim().min(1).max(8_000).optional() }).strict(),
  "usegpt.handoff.cancel": z.object({ handoffId: Id, confirmed: Confirmed, claimToken: z.string().min(1).max(512).optional(), generation: z.number().int().positive().optional() }).strict(),
  "usegpt.storage.usage": z.object({ projectId: Id.optional(), taskId: Id.optional() }).strict(),
  "usegpt.delete.preview": z.object({ projectId: Id.optional(), taskId: Id.optional() }).strict().refine(input => Boolean(input.projectId || input.taskId), "A projectId or taskId is required"),
} as const;

export const UseGptInputSchemas = {
  ...HubSchemas,
  "usegpt.connection.status": z.object({}).strict(),
  "usegpt.task.start": z.object(LegacyTaskOptions).strict().refine(v => v.prompt.length + v.files.reduce((n, f) => n + f.content.length + f.name.length + 20, 0) <= 200_000, "Total task context exceeds 200,000 characters"),
  "usegpt.task.follow_up": z.object({ ...LegacyTaskOptions, taskId: UseGptTaskIdSchema }).strict().refine(v => v.prompt.length + v.files.reduce((n, f) => n + f.content.length + f.name.length + 20, 0) <= 200_000, "Total task context exceeds 200,000 characters"),
  "usegpt.artifact.get": z.object({ taskId: UseGptTaskIdSchema, artifactId: Id, offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100_000).default(20_000) }).strict(),
} as const;
export type UseGptCapability = keyof typeof UseGptInputSchemas;
export const USEGPT_CAPABILITIES = Object.keys(UseGptInputSchemas) as UseGptCapability[];
export const UseGptRequestSchemas = Object.fromEntries(USEGPT_CAPABILITIES.map(capability => [capability, z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), capability: z.literal(capability), input: UseGptInputSchemas[capability] }).strict()]));
export const UseGptEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION), ok: z.boolean(), capability: z.enum(USEGPT_CAPABILITIES as [UseGptCapability, ...UseGptCapability[]]), connection: z.literal("usegpt"),
  data: z.record(z.string(), z.unknown()).optional(), error: z.object({ kind: z.string().max(80), message: z.string().max(1000), retryable: z.boolean() }).strict().optional(), warnings: z.array(z.string().max(1000)).max(30),
}).strict().refine(value => value.ok ? value.data !== undefined && value.error === undefined : value.error !== undefined && value.data === undefined, "Envelope must contain either data or error");
export type UseGptEnvelope = z.infer<typeof UseGptEnvelopeSchema>;
export type UseGptTaskStartInput = z.infer<typeof UseGptInputSchemas["usegpt.task.start"]>;
export const UseGptArtifactSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: z.string().max(255), mimeType: z.string().max(128), sizeBytes: z.number().int().nonnegative().max(20_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const UseGptTaskSchema = z.object({
  taskId: UseGptTaskIdSchema,
  requestId: LegacyTaskOptions.requestId,
  status: z.enum(["queued", "running", "completed", "partial", "failed", "cancellation_requested", "cancelled", "possibly_running"]),
  mode: UseGptModeSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  output: z.string().max(2_000_000).optional(),
  conversationUrl: z.string().max(512).refine(value => /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{1,128}$/.test(value)).optional(),
  artifacts: z.array(UseGptArtifactSchema).max(100).default([]),
  warnings: z.array(z.string().max(1000)).max(30).default([]),
  error: z.object({ kind: z.string().max(80), message: z.string().max(1000) }).strict().optional(),
}).strict();
export type UseGptTask = z.infer<typeof UseGptTaskSchema>;
export function useGptFailure(capability: UseGptCapability, kind: string, message: string, retryable = false): UseGptEnvelope { return { protocolVersion: 1, ok: false, capability, connection: "usegpt", error: { kind, message, retryable }, warnings: [] }; }
export function useGptSuccess(capability: UseGptCapability, data: Record<string, unknown>, warnings: string[] = []): UseGptEnvelope { return { protocolVersion: 1, ok: true, capability, connection: "usegpt", data, warnings }; }
