#!/usr/bin/env node
// SSE consumer for WeKnora knowledge-chat / agent-chat.
//
// Zero dependencies. Prints exactly one JSON envelope on stdout and sends every
// diagnostic to stderr, so stdout stays machine-readable.
//
//   node consume-sse.mjs --session <session_id> --query "question"
//   node consume-sse.mjs --session <id> --query "q" --mode agent
//   node consume-sse.mjs --session <id> --query "q" --resource-urls public
//   node consume-sse.mjs --self-test
//
// Requires WEKNORA_BASE_URL (the /api/v1 root) and WEKNORA_API_KEY.
// Exit codes: 0 = terminal complete/stop, 1 = protocol or transport failure.

import { argv, env, exit, stderr, stdout } from "node:process";

const TERMINAL = new Set(["complete", "error", "stop"]);

function warn(message) {
  stderr.write(`consume-sse: ${message}\n`);
}

// Split a growing buffer into complete SSE frames, returning the unconsumed tail.
// Frames are separated by a blank line; a frame's data may span several reads.
export function splitFrames(buffer) {
  const frames = [];
  let rest = buffer;
  for (;;) {
    const cut = rest.search(/\r?\n\r?\n/);
    if (cut === -1) break;
    const match = rest.slice(cut).match(/^\r?\n\r?\n/);
    frames.push(rest.slice(0, cut));
    rest = rest.slice(cut + match[0].length);
  }
  return { frames, rest };
}

// A frame may carry several `data:` lines; join them. Unknown event names and
// unparsable payloads are skipped rather than thrown, because the server emits
// response types the documentation does not list.
export function decodeFrame(frame) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (data.length === 0) return null;
  const raw = data.join("\n").trim();
  if (raw === "" || raw === "[DONE]") return null;
  try {
    return JSON.parse(raw);
  } catch {
    warn("skipped an unparsable frame");
    return null;
  }
}

// Assemble a StreamResponse sequence into one result.
export function assemble(events) {
  let answer = "";
  let terminatedBy = null;
  let failure = null;
  let sessionTitle = null;
  let usage = null;
  const references = [];

  for (const event of events) {
    const type = event?.response_type;
    if (typeof type === "string") {
      if (type === "answer") {
        // Only `answer` contributes to the visible text. `thinking`, `tool_call`,
        // `reflection` and friends carry their own text and must not be appended.
        if (typeof event.content === "string") answer += event.content;
      } else if (type === "references") {
        if (Array.isArray(event.knowledge_references)) {
          references.push(...event.knowledge_references);
        }
      } else if (TERMINAL.has(type)) {
        // A `session_title` event can arrive after `complete`, so record the
        // terminal type on first sight and let later frames be ignored.
        if (terminatedBy === null) terminatedBy = type;
        if (type === "error") failure = event.content ?? "stream reported an error";
      } else if (type === "session_title") {
        sessionTitle = typeof event.content === "string" ? event.content : null;
      }
      // Any other response_type is deliberately ignored.
    }
    if (event?.usage && typeof event.usage === "object") usage = event.usage;
  }

  const result = {
    ok: terminatedBy === "complete" || terminatedBy === "stop",
    answer,
    references,
    usage,
    session_title: sessionTitle,
    // No terminal event means the stream was cut short: a partial answer, never
    // to be presented as a complete one.
    terminated_by: terminatedBy ?? "incomplete",
  };
  if (failure !== null) result.error = failure;
  else if (terminatedBy === null) result.error = "stream ended without a terminal event";
  return result;
}

function parseArgs(args) {
  const options = { mode: "knowledge", resourceUrls: null, selfTest: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const next = () => {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      index += 1;
      return value;
    };
    if (flag === "--self-test") options.selfTest = true;
    else if (flag === "--session") options.session = next();
    else if (flag === "--query") options.query = next();
    else if (flag === "--mode") options.mode = next();
    else if (flag === "--base") options.base = next();
    else if (flag === "--resource-urls") options.resourceUrls = next();
    else throw new Error(`unknown argument: ${flag}`);
  }
  return options;
}

function endpoint(base, mode, session, resourceUrls) {
  if (!["knowledge", "agent"].includes(mode)) {
    throw new Error(`--mode must be knowledge or agent, got ${mode}`);
  }
  const url = new URL(`${base.replace(/\/+$/, "")}/${mode}-chat/${encodeURIComponent(session)}`);
  if (resourceUrls) {
    // Only `handle` (the default) and `public` are accepted; anything else is a 400.
    if (!["handle", "public"].includes(resourceUrls)) {
      throw new Error(`--resource-urls must be handle or public, got ${resourceUrls}`);
    }
    url.searchParams.set("resource_urls", resourceUrls);
  }
  return url;
}

async function stream(options) {
  const base = options.base ?? env.WEKNORA_BASE_URL;
  const key = env.WEKNORA_API_KEY;
  if (!base) throw new Error("WEKNORA_BASE_URL is not set");
  if (!key) throw new Error("WEKNORA_API_KEY is not set");
  if (!options.session) throw new Error("--session is required");
  if (!options.query) throw new Error("--query is required");

  const url = endpoint(base, options.mode, options.session, options.resourceUrls);
  warn(`POST ${url.pathname} (mode ${options.mode})`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ query: options.query }),
  });

  if (!response.ok) {
    warn(`HTTP ${response.status}`);
    return {
      ok: false,
      answer: "",
      references: [],
      usage: null,
      session_title: null,
      terminated_by: "error",
      error: `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
    };
  }

  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { frames, rest } = splitFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      const event = decodeFrame(frame);
      if (event === null) continue;
      events.push(event);
      // Stop on the terminal event rather than on connection close: the server
      // may still send a title frame afterwards.
      const type = event?.response_type;
      if (TERMINAL.has(type)) {
        await reader.cancel().catch(() => {});
        return assemble(events);
      }
    }
  }
  return assemble(events);
}

function selfTest() {
  const assert = (condition, label) => {
    if (!condition) throw new Error(`self-test failed: ${label}`);
    stdout.write(`ok  ${label}\n`);
  };
  const frame = (object) => `event: message\ndata: ${JSON.stringify(object)}\n\n`;
  const events = (text) =>
    splitFrames(text)
      .frames.map(decodeFrame)
      .filter((event) => event !== null);

  // Frames split across reads must still be reassembled.
  const stream = [
    frame({ response_type: "thinking", content: "hmm" }),
    frame({ response_type: "answer", content: "Refunds are " }),
    frame({ response_type: "answer", content: "issued within 30 days." }),
    frame({ response_type: "references", knowledge_references: [{ title: "Policy" }] }),
    frame({ response_type: "usage", usage: { total_tokens: 12 } }),
    frame({ response_type: "complete", done: true }),
  ].join("");
  const half = Math.floor(stream.length / 2);
  const parsed = [...events(stream.slice(0, half))];
  const tail = splitFrames(stream.slice(0, half)).rest;
  parsed.push(...events(tail + stream.slice(half)));

  const result = assemble(parsed);
  assert(
    result.answer === "Refunds are issued within 30 days.",
    "only answer deltas are concatenated",
  );
  assert(result.references.length === 1, "references are collected");
  assert(result.usage?.total_tokens === 12, "usage is captured");
  assert(result.terminated_by === "complete", "complete terminates the stream");
  assert(result.ok === true, "complete is reported as ok");

  // A frame boundary landing mid-frame must not lose or duplicate events.
  assert(parsed.length === 6, "no event is lost or duplicated across a split read");

  // An undocumented response type must be ignored, not fatal.
  const unknown = assemble(
    events(
      frame({ response_type: "context_compacted", content: "x" }) +
        frame({ response_type: "answer", content: "ok" }) +
        frame({ response_type: "complete" }),
    ),
  );
  assert(unknown.answer === "ok", "an unknown response type is ignored and is not appended");

  // A title frame after completion must not unseat the terminal result.
  const titled = assemble(
    events(
      frame({ response_type: "answer", content: "a" }) +
        frame({ response_type: "complete", done: true }) +
        frame({ response_type: "session_title", content: "Refunds" }),
    ),
  );
  assert(titled.terminated_by === "complete", "a trailing title frame keeps complete");
  assert(titled.session_title === "Refunds", "the trailing title is still captured");

  // An error event and a truncated stream are distinct failures.
  const errored = assemble(events(frame({ response_type: "error", content: "boom" })));
  assert(errored.terminated_by === "error" && errored.ok === false, "error is a failure");
  assert(errored.error === "boom", "the error message is surfaced");
  const truncated = assemble(events(frame({ response_type: "answer", content: "half" })));
  assert(
    truncated.terminated_by === "incomplete" && truncated.ok === false,
    "a stream with no terminal event is incomplete, not ok",
  );
  assert(assemble([]).terminated_by === "incomplete", "an empty stream is incomplete");

  // `stop` is terminal and distinct from `complete`.
  assert(
    assemble(events(frame({ response_type: "stop" }))).terminated_by === "stop",
    "stop is terminal",
  );

  // The endpoint builder must reject values the API returns 400 for.
  const built = endpoint("http://k.local/api/v1/", "agent", "s-1", "public");
  assert(
    built.pathname === "/api/v1/agent-chat/s-1" && built.searchParams.get("resource_urls") === "public",
    "the endpoint strips a trailing slash and appends resource_urls",
  );

  stdout.write("\nall self-tests passed\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(argv.slice(2));
  } catch (error) {
    stderr.write(`consume-sse: ${error.message}\n`);
    return 1;
  }
  if (options.selfTest) {
    selfTest();
    return 0;
  }
  let result;
  try {
    result = await stream(options);
  } catch (error) {
    // Missing configuration or a transport failure is still reported as one
    // machine-readable envelope, with the reason on stderr.
    warn(error.message);
    result = {
      ok: false,
      answer: "",
      references: [],
      usage: null,
      session_title: null,
      terminated_by: "error",
      error: error.message,
    };
  }
  stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

exit(await main());
