import { z } from "zod";

export const WeknoraVerifyRequestSchema = z.object({
  protocolVersion: z.literal(1), capability: z.literal("weknora.connection.verify"),
  input: z.object({ confirmed: z.literal(true), allowHttp: z.boolean().default(false).describe("Ignored compatibility field; not required for HTTP. Network access still requires confirmed=true."), timeoutMs: z.number().int().min(1).max(5_000).default(5_000) }).strict(),
}).strict();
export const WEKNORA_VERIFY_FAILURE_KINDS = ["invalid-request", "config", "http-consent", "auth", "permission", "rate-limit", "http-status", "business-failure", "invalid-response", "blocked-address", "dns", "redirect", "timeout", "cancelled", "network", "headers", "body", "content-type", "encoding", "invalid-url", "configuration"] as const;
const common = { protocolVersion: z.literal(1), capability: z.literal("weknora.connection.verify"), connection: z.literal("weknora"), warnings: z.array(z.string()) };
export const WeknoraVerifyEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ...common, ok: z.literal(true), source: z.enum(["managed", "environment"]), data: z.object({ outcome: z.literal("accepted"), status: z.number().int().min(200).max(299) }).strict() }).strict(),
  z.object({ ...common, ok: z.literal(false), source: z.enum(["managed", "environment"]).optional(), error: z.object({ kind: z.enum(WEKNORA_VERIFY_FAILURE_KINDS), message: z.string(), retryable: z.literal(false), status: z.number().int().min(100).max(599).optional() }).strict() }).strict(),
]);
export type WeknoraVerifyEnvelope = z.infer<typeof WeknoraVerifyEnvelopeSchema>;
export type WeknoraVerifyFailureKind = (typeof WEKNORA_VERIFY_FAILURE_KINDS)[number];
export function weknoraVerifyFailure(kind: WeknoraVerifyFailureKind): WeknoraVerifyEnvelope {
  const corrections: Partial<Record<WeknoraVerifyFailureKind, string>> = {
    "invalid-request": "Supply the verification request schema and confirmed=true after user consent; the capability must be enabled.",
    config: "Check the managed connection and credential, or supply both external WeKnora variables; never mix sources.",
    auth: "Check the API key in your trusted terminal; do not paste it into Agent chat.",
    permission: "Check key capabilities and scope; 403 may also mean this route has no API-key policy, not that the key is invalid.",
    redirect: "Configure the final API root directly; authenticated redirects are not followed.",
  };
  return { protocolVersion: 1, capability: "weknora.connection.verify", connection: "weknora", ok: false, warnings: [], error: { kind, message: `WeKnora verification failed (${kind}).${corrections[kind] ? ` ${corrections[kind]}` : ""}`, retryable: false } };
}
