import { z } from "zod";
import { PROTOCOL_VERSION } from "./types.js";

export const UseGptTaskIdSchema = z.string().regex(/^ugpt_[a-f0-9-]{36}$/);
export const UseGptModeSchema = z.enum(["chat", "search", "deep-research", "image"]);
const TaskOptions = {
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  prompt: z.string().trim().min(1).max(200_000),
  mode: UseGptModeSchema.default("chat"),
  timeoutMs: z.number().int().min(10_000).max(3_600_000).default(1_200_000),
  files: z.array(z.object({ name: z.string().trim().min(1).max(255), content: z.string().max(200_000) }).strict()).max(20).default([]),
  confirmed: z.literal(true),
};
export const UseGptInputSchemas = {
  "usegpt.connection.status": z.object({}).strict(),
  "usegpt.task.start": z.object(TaskOptions).strict().refine(v => v.prompt.length + v.files.reduce((n, f) => n + f.content.length + f.name.length + 20, 0) <= 200_000, "Total task context exceeds 200,000 characters"),
  "usegpt.task.get": z.object({ taskId: UseGptTaskIdSchema }).strict(),
  "usegpt.task.list": z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict(),
  "usegpt.task.wait": z.object({ taskId: UseGptTaskIdSchema, timeoutMs: z.number().int().min(0).max(60_000).default(30_000) }).strict(),
  "usegpt.task.follow_up": z.object({ ...TaskOptions, taskId: UseGptTaskIdSchema }).strict().refine(v => v.prompt.length + v.files.reduce((n, f) => n + f.content.length + f.name.length + 20, 0) <= 200_000, "Total task context exceeds 200,000 characters"),
  "usegpt.task.cancel": z.object({ taskId: UseGptTaskIdSchema, confirmed: z.literal(true) }).strict(),
  "usegpt.artifact.get": z.object({ taskId: UseGptTaskIdSchema, artifactId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100_000).default(20_000) }).strict(),
} as const;
export type UseGptCapability = keyof typeof UseGptInputSchemas;
export const USEGPT_CAPABILITIES = Object.keys(UseGptInputSchemas) as UseGptCapability[];
export const UseGptRequestSchemas = Object.fromEntries(USEGPT_CAPABILITIES.map(capability => [capability, z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), capability: z.literal(capability), input: UseGptInputSchemas[capability] }).strict()]));

export const UseGptArtifactSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: z.string().max(255), mimeType: z.string().max(128), sizeBytes: z.number().int().nonnegative().max(20_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const UseGptTaskSchema = z.object({
  taskId: UseGptTaskIdSchema,
  requestId: TaskOptions.requestId,
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
export type UseGptTaskStartInput = z.infer<typeof UseGptInputSchemas["usegpt.task.start"]>;

export const UseGptEnvelopeSchema = z.object({
  protocolVersion: z.literal(1), ok: z.boolean(), capability: z.enum(USEGPT_CAPABILITIES as [UseGptCapability, ...UseGptCapability[]]), connection: z.literal("usegpt"),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ kind: z.string().max(80), message: z.string().max(1000), retryable: z.boolean() }).strict().optional(),
  warnings: z.array(z.string().max(1000)).max(30),
}).strict().refine(value => value.ok ? value.data !== undefined && value.error === undefined : value.error !== undefined && value.data === undefined, "Envelope must contain either data or error");
export type UseGptEnvelope = z.infer<typeof UseGptEnvelopeSchema>;
export function useGptFailure(capability: UseGptCapability, kind: string, message: string): UseGptEnvelope {
  return { protocolVersion: 1, ok: false, capability, connection: "usegpt", error: { kind, message, retryable: false }, warnings: [] };
}
export function useGptSuccess(capability: UseGptCapability, data: Record<string, unknown>, warnings: string[] = []): UseGptEnvelope {
  return { protocolVersion: 1, ok: true, capability, connection: "usegpt", data, warnings };
}
