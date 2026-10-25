import { z } from "zod";
import { UseGptArtifactSchema, UseGptEnvelopeSchema, UseGptRequestSchemas, UseGptTaskSchema, type UseGptCapability } from "../protocol/usegpt-schema.js";

export const MAX_REQUEST_BYTES = 1_300_000;
export const MAX_RESPONSE_BYTES = 16_000_000;
export const StatusSchema = z.object({ connected: z.boolean(), authenticated: z.boolean(), composerAvailable: z.boolean() }).strict();
export const ArtifactContentSchema = z.object({
  artifact: UseGptArtifactSchema, encoding: z.literal("utf8"), content: z.string().max(100_000),
  offset: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative(), eof: z.boolean(),
}).strict().refine(v => v.nextOffset === v.offset + Buffer.byteLength(v.content, "utf8") && v.nextOffset <= v.artifact.sizeBytes && v.eof === (v.nextOffset === v.artifact.sizeBytes));
const CapabilitySchema = UseGptEnvelopeSchema.shape.capability;
export function capabilityOf(value: unknown): UseGptCapability {
  return CapabilitySchema.parse(z.object({ capability: CapabilitySchema }).parse(value).capability);
}
export function parseRequest(value: unknown) {
  const capability = capabilityOf(value);
  const parsed = UseGptRequestSchemas[capability]!.parse(value);
  return { capability, input: parsed.input };
}
export function parseResponse(value: unknown, capability: UseGptCapability) {
  const result = UseGptEnvelopeSchema.parse(value);
  if (result.capability !== capability) throw new Error("Capability mismatch.");
  if (result.ok) {
    const schema = capability === "usegpt.connection.status" ? StatusSchema
      : capability === "usegpt.task.list" ? z.object({ tasks: z.array(UseGptTaskSchema).max(100) }).strict()
      : capability === "usegpt.artifact.get" ? ArtifactContentSchema : UseGptTaskSchema;
    schema.parse(result.data);
  }
  return result;
}
export function tokenFrom(environment: NodeJS.ProcessEnv): string {
  const token = environment.ARKSPACE_USEGPT_TOKEN;
  if (!token || token.length < 32 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error("UseGPT requires ARKSPACE_USEGPT_TOKEN with 32–4096 printable non-whitespace characters.");
  }
  return token;
}
