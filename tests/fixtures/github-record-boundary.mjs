// External HTTPS/gh fixtures only; the installed Skill never imports this file.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, readFileSync } from "node:fs";
const state = JSON.parse(readFileSync(process.env.GITHUB_RECORD_TEST_STATE, "utf8"));
const record = event => appendFileSync(state.log, JSON.stringify(event) + "\n");
const originalSpawn = childProcess.spawn;
childProcess.spawn = (_command, args, options) => {
  record({ transport: "gh", args, shell: options.shell, stdin: options.stdio?.[0] });
  if (state.missingGh) return originalSpawn(state.missingGh, args, options);
  return originalSpawn(process.execPath, [state.ghScript, ...args], options);
};
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  record({ transport: "https", url: String(url), redirect: options.redirect, credentials: options.credentials, headers: options.headers });
  if (state.networkError) throw new Error("token=private-boundary-secret https://private.example");
  if (state.hang) return new Promise((_, reject) => {
    const stop = () => reject(new DOMException("Fixture aborted", "AbortError"));
    options.signal.addEventListener("abort", stop, { once: true });
    if (options.signal.aborted) stop();
  });
  const body = state.hangBody ? new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"number":')); } })
    : state.rawBytes ? new Uint8Array(state.rawBytes) : state.body ?? JSON.stringify(state.item);
  return new Response(body, {
    status: state.status ?? 200, headers: { "content-type": "application/json", ...state.headers },
  });
};
