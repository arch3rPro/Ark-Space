// External registry/terminal boundaries for built-entry tests; never loaded by shipped code.
import { appendFileSync, readFileSync } from "node:fs";

const state = JSON.parse(readFileSync(process.env.ARKS_UPDATE_TEST_STATE, "utf8"));
if (state.interactive) {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
  // A paused pipe keeps a handle alive unlike the native TTY used by readline.
  process.stdin.on("pause", () => process.stdin.unref());
}
globalThis.fetch = async (url, options) => {
  appendFileSync(state.log, `${JSON.stringify({ kind: "registry", url: String(url), headers: options.headers,
    redirect: options.redirect, credentials: options.credentials })}\n`);
  if (state.networkError) throw new Error("private-registry-detail");
  if (state.waitForSignal) return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("Fixture cancelled", "AbortError"));
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
  });
  const body = state.oversized ? "x".repeat(65537)
    : state.body ?? JSON.stringify(state.metadata ?? { name: "@arkspace/cli", version: "99.0.0" });
  return new Response(body, { status: state.status ?? 200, headers: {
    "content-type": state.contentType ?? "application/json",
    ...(state.location ? { location: state.location } : {}),
  } });
};
