import type { FailureEnvelope, WebContentGetEnvelope, WebContentGetInput } from "../protocol/types.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import { getCachedContent } from "../state/web-response-cache.js";

export async function executeWebContentGet(input: WebContentGetInput, statePath: string): Promise<WebContentGetEnvelope> {
  const content = await getCachedContent(input.responseId, statePath);
  if (content === undefined) return failure("Response not found or expired.", "invalid-request");
  let matchIndex: number | undefined;
  if (input.findText !== undefined) {
    const haystack = input.caseSensitive ? content : content.toLocaleLowerCase();
    const needle = input.caseSensitive ? input.findText : input.findText.toLocaleLowerCase();
    matchIndex = haystack.indexOf(needle);
    if (matchIndex < 0) return failure("Text was not found.", "invalid-request");
  }
  const offset = Math.min(input.offset, content.length);
  return { protocolVersion: PROTOCOL_VERSION, ok: true, capability: "web.content.get", provider: "local", data: { responseId: input.responseId, content: content.slice(offset, offset + input.limit), offset, limit: input.limit, totalLength: content.length, ...(matchIndex === undefined ? {} : { matchIndex }) }, attempts: [], warnings: [] };
}
function failure(message: string, kind: "invalid-request"): FailureEnvelope<"web.content.get"> { return { protocolVersion: PROTOCOL_VERSION, ok: false, capability: "web.content.get", error: { kind, message, retryable: false }, attempts: [], warnings: [] }; }
