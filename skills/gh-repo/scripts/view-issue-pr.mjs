#!/usr/bin/env node

import { spawn } from "node:child_process";

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TEXT_LENGTH = 12_000;
const TIMEOUT_MS = 10_000;

function usage(message) {
  if (message) emitError("invalid-input", message, 2);
  else {
    console.error("Usage: node view-issue-pr.mjs --repo OWNER/REPO --number NUMBER");
    process.exit(2);
  }
}

function parseArgs(args) {
  let repo;
  let number;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--repo") repo = args[++i];
    else if (arg === "--number") number = args[++i];
    else if (!repo && /^[^/\s]+\/[^/\s]+$/.test(arg)) repo = arg;
    else if (!number && /^\d+$/.test(arg)) number = arg;
    else usage(`unsupported argument: ${arg}`);
  }
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
    usage("--repo must be OWNER/REPOSITORY");
  if (!number || Number(number) < 1 || Number(number) > 2147483647)
    usage("--number must be a positive integer");
  return { repo, number };
}

function clip(value) {
  if (typeof value !== "string") return value ?? null;
  return value.length > MAX_TEXT_LENGTH
    ? `${value.slice(0, MAX_TEXT_LENGTH)}\n[truncated]`
    : value;
}

function normalize(item, repo, number) {
  const isPullRequest = Boolean(item.pull_request) || Boolean(item.isPullRequest);
  return {
    kind: isPullRequest ? "pull_request" : "issue",
    repository: repo,
    number: item.number ?? Number(number),
    title: clip(item.title),
    state: item.state ?? null,
    stateReason: item.state_reason ?? item.stateReason ?? null,
    url: item.html_url ?? item.url ?? null,
    author: item.user?.login ?? item.author?.login ?? null,
    body: clip(item.body),
    labels: Array.isArray(item.labels)
      ? item.labels.map((label) => typeof label === "string" ? label : label.name).filter(Boolean).slice(0, 100)
      : [],
    assignees: Array.isArray(item.assignees)
      ? item.assignees.map((user) => typeof user === "string" ? user : user.login).filter(Boolean).slice(0, 100)
      : [],
    milestone: item.milestone?.title ?? item.milestone ?? null,
    createdAt: item.created_at ?? item.createdAt ?? null,
    updatedAt: item.updated_at ?? item.updatedAt ?? null,
    closedAt: item.closed_at ?? item.closedAt ?? null,
    locked: item.locked ?? item.isLocked ?? false,
  };
}

function redact(text) {
  return text
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[url redacted]");
}

function emitError(kind, message, code = 1) {
  console.error(JSON.stringify({ ok: false, error: { kind, message } }));
  process.exit(code);
}

function runGh(repo, number) {
  const command = process.env.GH_BIN || "gh";
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["api", `repos/${repo}/issues/${number}`], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: {
        ...process.env,
        GH_PAGER: "",
        GH_FORCE_TTY: "0",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, new Error("GitHub CLI timed out"));
    }, TIMEOUT_MS);
    child.on("error", (error) => finish(reject, new Error(error.code === "ENOENT" ? "GitHub CLI is unavailable" : "GitHub CLI could not be started")));
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        child.kill("SIGTERM");
        finish(reject, new Error("GitHub response exceeded the output limit"));
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 2_000); });
    child.on("close", (code) => {
      if (code !== 0) finish(reject, new Error(`GitHub CLI request failed (${code ?? "unknown"})`));
      else finish(resolve, stdout);
    });
  });
}

const { repo, number } = parseArgs(process.argv.slice(2));
try {
  const raw = await runGh(repo, number);
  let item;
  try { item = JSON.parse(raw); } catch { emitError("invalid-response", "GitHub CLI returned invalid JSON"); }
  if (!item || typeof item !== "object" || Array.isArray(item)) emitError("invalid-response", "GitHub CLI returned an unexpected response");
  console.log(JSON.stringify({ ok: true, data: normalize(item, repo, number) }));
} catch (error) {
  // Do not echo gh's stderr: it can contain URLs, usernames, or credential material.
  emitError("github-cli", redact(error instanceof Error ? error.message : "GitHub CLI request failed"));
}
