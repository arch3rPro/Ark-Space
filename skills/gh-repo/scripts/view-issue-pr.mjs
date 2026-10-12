#!/usr/bin/env node

import { spawn } from "node:child_process";

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_TEXT_LENGTH = 12_000;
const TIMEOUT_MS = 10_000;

function failure(kind, message, details = {}) {
  return Object.assign(new Error(message), { kind, ...details });
}

function parseArgs(args) {
  let repo, number;
  let anonymous = false;
  const invalid = () => { throw failure("invalid-input", "Use --repo OWNER/REPO --number INTEGER [--anonymous]."); };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--anonymous" && !anonymous) anonymous = true;
    else if (arg === "--repo" && repo === undefined) repo = args[++i];
    else if (arg === "--number" && number === undefined) number = args[++i];
    else if (repo === undefined && /^[^/\s]+\/[^/\s]+$/.test(arg)) repo = arg;
    else if (number === undefined && /^\d+$/.test(arg)) number = arg;
    else invalid();
  }
  if (typeof repo !== "string" || repo.length > 140) invalid();
  const parts = repo.split("/");
  if (parts.length !== 2 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0]) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) || [".", ".."].includes(parts[1])) invalid();
  if (typeof number !== "string" || !/^\d+$/.test(number) || !Number.isSafeInteger(Number(number)) ||
      Number(number) < 1 || Number(number) > 2147483647) invalid();
  return { repo, number: String(Number(number)), anonymous };
}

function clip(value) {
  if (typeof value !== "string") return value ?? null;
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}\n[truncated]` : value;
}

function normalize(item, repo, number) {
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const optionalString = value => value == null || typeof value === "string";
  const invalid = () => { throw failure("invalid-response", "GitHub returned an unexpected record."); };
  if (!object(item) || item.number !== Number(number) || typeof item.title !== "string" ||
      !["open", "closed"].includes(item.state)) invalid();
  for (const field of ["body", "state_reason", "stateReason", "html_url", "url", "created_at", "createdAt", "updated_at", "updatedAt", "closed_at", "closedAt"])
    if (!optionalString(item[field])) invalid();
  for (const field of ["locked", "isLocked", "isPullRequest"])
    if (item[field] != null && typeof item[field] !== "boolean") invalid();
  if (item.pull_request != null && !object(item.pull_request)) invalid();
  for (const field of ["user", "author"])
    if (item[field] != null && (!object(item[field]) || !optionalString(item[field].login))) invalid();
  for (const [field, key] of [["labels", "name"], ["assignees", "login"]]) {
    if (item[field] != null && (!Array.isArray(item[field]) || item[field].some(value =>
      typeof value !== "string" && (!object(value) || typeof value[key] !== "string")))) invalid();
  }
  if (item.milestone != null && typeof item.milestone !== "string" &&
      (!object(item.milestone) || typeof item.milestone.title !== "string")) invalid();
  const url = item.html_url ?? item.url;
  if (typeof url !== "string") invalid();
  let parsed;
  try { parsed = new URL(url); } catch { invalid(); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password ||
      parsed.search || parsed.hash || ![`/${repo.toLowerCase()}/issues/${number}`, `/${repo.toLowerCase()}/pull/${number}`].includes(parsed.pathname.toLowerCase())) invalid();
  return {
    kind: item.pull_request || item.isPullRequest ? "pull_request" : "issue",
    repository: repo,
    number: item.number,
    title: clip(item.title),
    state: item.state,
    stateReason: item.state_reason ?? item.stateReason ?? null,
    url,
    author: item.user?.login ?? item.author?.login ?? null,
    body: clip(item.body),
    labels: (item.labels ?? []).map(label => typeof label === "string" ? label : label.name).filter(Boolean).slice(0, 100),
    assignees: (item.assignees ?? []).map(user => typeof user === "string" ? user : user.login).filter(Boolean).slice(0, 100),
    milestone: item.milestone?.title ?? item.milestone ?? null,
    createdAt: item.created_at ?? item.createdAt ?? null,
    updatedAt: item.updated_at ?? item.updatedAt ?? null,
    closedAt: item.closed_at ?? item.closedAt ?? null,
    locked: item.locked ?? item.isLocked ?? false,
  };
}

function rateHints(headers) {
  const hints = {};
  const integer = (name, max) => {
    const value = headers.get(name);
    return value && /^\d{1,10}$/.test(value) && Number(value) <= max ? Number(value) : undefined;
  };
  const remaining = integer("x-ratelimit-remaining", 2147483647);
  const reset = integer("x-ratelimit-reset", 9999999999);
  let retry = integer("retry-after", 2147483647);
  const retryHeader = headers.get("retry-after");
  if (retry === undefined && retryHeader && retryHeader.length <= 64 && /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryHeader)) {
    const seconds = Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 2147483647) retry = seconds;
  }
  if (remaining !== undefined) hints.remaining = remaining;
  if (reset !== undefined) hints.resetAt = reset;
  if (retry !== undefined) hints.retryAfterSeconds = retry;
  const resource = headers.get("x-ratelimit-resource");
  if (resource && ["core", "search", "graphql", "integration_manifest", "code_search", "code_scanning_upload", "actions_runner_registration", "scim", "dependency_snapshots", "audit_log", "source_import"].includes(resource)) hints.resource = resource;
  return hints;
}

function checkStatus(status, headers, body, anonymous = false) {
  if (status >= 200 && status < 300) return;
  const rateLimit = rateHints(headers);
  let secondary = false;
  try {
    const message = JSON.parse(body.toString("utf8"))?.message;
    secondary = typeof message === "string" && /secondary rate limit|abuse detection|API rate limit exceeded/i.test(message);
  } catch { /* Error bodies are never echoed. */ }
  let kind = "github-error", message = "GitHub request failed.";
  if (status === 401) {
    kind = anonymous ? "auth-required" : "auth-invalid";
    message = anonymous ? "GitHub requires authentication for this record." : "GitHub rejected the existing credentials.";
  }
  else if (status === 404) { kind = "not-found-or-inaccessible"; message = "The record was not found or is inaccessible."; }
  else if (status === 429 || (status === 403 && (rateLimit.remaining === 0 || rateLimit.retryAfterSeconds !== undefined || secondary))) {
    kind = "rate-limited"; message = "GitHub rate limit reached; respect the server wait before retrying.";
  } else if (status === 403) { kind = "access-denied"; message = "GitHub denied access to this record."; }
  throw failure(kind, message, { status, ...(Object.keys(rateLimit).length ? { rateLimit } : {}) });
}

function parseIncluded(stdout, stderrBytes) {
  let offset = 0, headerBytes = 0, status;
  let headers = new Headers();
  while (stdout.subarray(offset, offset + 5).toString("ascii") === "HTTP/") {
    const end = stdout.indexOf("\r\n\r\n", offset);
    const lfEnd = stdout.indexOf("\n\n", offset);
    const boundary = end < 0 || (lfEnd >= 0 && lfEnd < end) ? lfEnd : end;
    const separator = boundary === end ? 4 : 2;
    if (boundary < 0) throw failure(stdout.length + stderrBytes > MAX_METADATA_BYTES ? "response-too-large" : "invalid-response", "GitHub returned invalid HTTP headers.");
    headerBytes += boundary + separator - offset;
    if (headerBytes + stderrBytes > MAX_METADATA_BYTES) throw failure("response-too-large", "GitHub metadata exceeded the output limit.");
    const lines = stdout.subarray(offset, boundary).toString("utf8").split(/\r?\n/);
    const match = /^HTTP\/(?:1\.1|2(?:\.0)?) ([1-5]\d{2})(?: [^\r\n]*)?$/.exec(lines.shift());
    if (!match) throw failure("invalid-response", "GitHub returned invalid HTTP headers.");
    status = Number(match[1]);
    headers = new Headers();
    for (const line of lines) {
      const match = /^([!#$%&'*+.^_`|~\w-]+):[ \t]*([^\r\n]*)$/.exec(line);
      if (!match) throw failure("invalid-response", "GitHub returned invalid HTTP headers.");
      // Only retain classification hints, never credential or redirect headers.
      const name = match[1].toLowerCase();
      if (["x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-resource", "retry-after"].includes(name)) {
        try { headers.append(name, match[2]); } catch { throw failure("invalid-response", "GitHub returned invalid HTTP headers."); }
      }
    }
    offset = boundary + separator;
  }
  const body = stdout.subarray(offset);
  if (body.length > MAX_RESPONSE_BYTES) throw failure("response-too-large", "GitHub response exceeded the output limit.");
  return { status, headers, body };
}

async function runGh(repo, number, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.GH_BIN || "gh", ["api", `repos/${repo}/issues/${number}`, "--hostname", "github.com", "--method", "GET", "--include"], {
      stdio: ["ignore", "pipe", "pipe"], shell: false,
      env: { ...process.env, GH_PAGER: "", GH_FORCE_TTY: "0", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    const stdout = [], stderr = [];
    let stdoutBytes = 0, stderrBytes = 0, pendingError, killTimer;
    const stop = error => {
      if (pendingError) return;
      pendingError = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const abort = () => stop(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.once("error", error => {
      pendingError ??= failure(error.code === "ENOENT" ? "tool-unavailable" : "github-error", "GitHub CLI could not be started.");
    });
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes + stderrBytes > MAX_RESPONSE_BYTES + MAX_METADATA_BYTES) stop(failure("response-too-large", "GitHub output exceeded the output limit."));
      else if (!pendingError) stdout.push(chunk);
    });
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_METADATA_BYTES || stdoutBytes + stderrBytes > MAX_RESPONSE_BYTES + MAX_METADATA_BYTES) stop(failure("response-too-large", "GitHub output exceeded the output limit."));
      else if (!pendingError) stderr.push(chunk);
    });
    child.once("close", code => {
      clearTimeout(killTimer);
      signal.removeEventListener("abort", abort);
      if (pendingError) return reject(pendingError);
      try {
        const result = parseIncluded(Buffer.concat(stdout), stderrBytes);
        if (result.status === undefined) {
          const text = Buffer.concat(stderr).toString("utf8");
          if (code !== 0 && /(?:please run:\s*gh auth login|not logged into any GitHub hosts|authentication required|GH_TOKEN environment variable)/i.test(text))
            throw failure("auth-required", "GitHub CLI requires existing authentication; choose --anonymous only for a public record.");
          throw failure(code === 0 ? "invalid-response" : "github-error", "GitHub CLI did not return an HTTP response.");
        }
        checkStatus(result.status, result.headers, result.body);
        if (code !== 0) throw failure("github-error", "GitHub CLI request failed.", { status: result.status });
        resolve(result.body);
      } catch (error) { reject(error); }
    });
  });
}

async function runAnonymous(repo, number, signal) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw failure("network-error", "Anonymous access requires verified TLS.");
  const response = await fetch(`https://api.github.com/repos/${repo}/issues/${number}`, {
    method: "GET", credentials: "omit", redirect: "error", signal,
    headers: { Accept: "application/vnd.github+json", "User-Agent": "gh-repo-record-viewer" },
  });
  let headerBytes = 0;
  for (const [name, value] of response.headers) headerBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
  if (headerBytes > MAX_METADATA_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw failure("response-too-large", "GitHub metadata exceeded the output limit.");
  }
  const chunks = [];
  let bytes = 0;
  const reader = response.body?.getReader();
  if (reader) {
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => { rejectAbort(signal.reason); void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) throw signal.reason;
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          void reader.cancel().catch(() => {});
          throw failure("response-too-large", "GitHub response exceeded the output limit.");
        }
        chunks.push(Buffer.from(value));
      }
    } finally { signal.removeEventListener("abort", abort); }
  }
  const body = Buffer.concat(chunks);
  checkStatus(response.status, response.headers, body, true);
  return body;
}

let controller, timer;
const cancel = () => controller?.abort(failure("cancelled", "GitHub request cancelled."));
try {
  const { repo, number, anonymous } = parseArgs(process.argv.slice(2));
  controller = new AbortController();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  timer = setTimeout(() => controller.abort(failure("timeout", "GitHub request timed out.")), TIMEOUT_MS);
  const raw = await (anonymous ? runAnonymous(repo, number, controller.signal) : runGh(repo, number, controller.signal));
  if (controller.signal.aborted) throw controller.signal.reason;
  let item;
  try { item = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { throw failure("invalid-response", "GitHub returned invalid JSON."); }
  console.log(JSON.stringify({ ok: true, data: normalize(item, repo, number) }));
} catch (caught) {
  const error = controller?.signal.aborted ? controller.signal.reason : caught;
  const { kind, message, status, rateLimit } = error?.kind ? error : failure("network-error", "GitHub request could not be completed.");
  console.error(JSON.stringify({ ok: false, error: { kind, message, ...(status !== undefined ? { status } : {}), ...(rateLimit ? { rateLimit } : {}) } }));
  process.exitCode = kind === "invalid-input" ? 2 : kind === "cancelled" ? 130 : 1;
} finally {
  clearTimeout(timer);
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
