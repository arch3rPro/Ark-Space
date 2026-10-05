// ArkSpace MIT: adapted from this repository's synthetic setup qualification fixtures.
// Owned subprocess only: no real services, credential logs, or listening sockets.
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";

const trace = process.env.ARKS_SETUP_FIXTURE_TRACE;
if (!trace) throw new Error("Owned fixture trace required.");
const first = "synthetic-pty?credential-only";
const labels = new Map([first, ..."bcd"].map((value, index) => [index ? `${first}-${value}` : value, "ABCD"[index]]));
const deny = () => { appendFileSync(trace, "DENIED\n"); throw new Error("PTY fixture prohibits network I/O."); };
// Deny lower-level transports as well as unexpected fetches; even initialization is offline.
for (const module of [http, https]) for (const name of ["request", "get"]) module[name] = deny;
net.connect = net.createConnection = tls.connect = dgram.createSocket = deny;
net.Socket.prototype.connect = deny;
for (const name of ["lookup", "resolve", "resolve4", "resolve6"]) { dns[name] = deny; dns.promises[name] = deny; }
syncBuiltinESMExports();
globalThis.fetch = async (url, init = {}) => {
  if (String(url) !== "https://api.exa.ai/search" || init.method !== "POST") return deny();
  let body;
  try { body = JSON.parse(init.body); } catch { return deny(); }
  if (body.query !== "Agent Skills documentation" || body.numResults !== 1) return deny();
  const label = labels.get(new Headers(init.headers).get("x-api-key"));
  if (!label) return deny();
  appendFileSync(trace, `${label}\n`);
  if (label === "C") return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("Fixture cancelled.", "AbortError"));
    if (!init.signal) return deny();
    if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
  });
  return new Response(JSON.stringify(label === "B" ? { error: `${first}-b` } : { results: [] }), { status: label === "B" ? 401 : 200 });
};
