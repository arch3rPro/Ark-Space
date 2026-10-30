import { z } from "zod";
import { UseGptEnvelopeSchema, UseGptRequestSchemas, type UseGptCapability } from "../protocol/usegpt-schema.js";

export const MAX_REQUEST_BYTES = 1_300_000;
export const MAX_RESPONSE_BYTES = 16_000_000;
const CapabilitySchema = UseGptEnvelopeSchema.shape.capability;
export function capabilityOf(value: unknown): UseGptCapability {
  return CapabilitySchema.parse(z.object({ capability: CapabilitySchema }).parse(value).capability);
}
export function parseRequest(value: unknown) {
  const capability = capabilityOf(value);
  const parsed = UseGptRequestSchemas[capability]!.parse(value);
  return { capability, input: parsed.input };
}
