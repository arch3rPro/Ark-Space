import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { localHttpGet, LocalHttpError } from "../src/providers/local-http.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });
async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
const loopback = { allowRanges: ["127.0.0.0/8"] };
async function fails(promise: Promise<unknown>, kind: string) {
  await expect(promise).rejects.toMatchObject({ kind, message: `Local HTTP request failed (${kind}).` });
}

describe("local HTTP transport", () => {
  it("rejects private/reserved addresses, IPv4-mapped addresses and invalid exceptions", async () => {
    for (const host of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.1.1", "192.0.2.1", "[::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[fc00::1]"]) {
      await fails(localHttpGet(`http://${host}/`), "blocked-address");
    }
    for (const cidr of ["127.0.0.1", "127.0.0.1/33", "example.com/24", "::ffff:127.0.0.1/120"]) {
      await fails(localHttpGet("http://example.com", { allowRanges: [cidr] }), "configuration");
    }
    await fails(localHttpGet("http://example.com", { trustEnvProxy: true }), "configuration");
    for (const url of ["http://user:secret@example.com/", "http://example.com./", "http://foo..example.com/", "http://example.com\\@127.0.0.1/", "http://example.com/#fragment", "file:///etc/passwd"]) {
      await fails(localHttpGet(url), "invalid-url");
    }
  });

  it("checks every A/AAAA, pins the checked address, and ignores ambient proxy settings", async () => {
    const port = await serve((_req, res) => { res.setHeader("content-type", "text/plain; charset=utf-8"); res.end("ok"); });
    const url = `http://example.test:${port}/`;
    await fails(localHttpGet(url, { lookup: async () => [{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }] }), "blocked-address");
    await fails(localHttpGet(url, { lookup: async () => [{ address: "127.0.0.1", family: 4 }, { address: "8.8.8.8", family: 4 }], allowRanges: ["8.8.8.0/24"] }), "blocked-address");
    await fails(localHttpGet(url, { lookup: async () => [{ address: "::ffff:7f00:1", family: 6 }] }), "blocked-address");
    await fails(localHttpGet(url, { lookup: async () => [{ address: "::ffff:127.0.0.1", family: 6 }, { address: "::1", family: 6 }], ...loopback }), "blocked-address");
    const old = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = "http://127.0.0.1:1";
    try {
      let lookups = 0;
      const result = await localHttpGet(url, { ...loopback, lookup: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; } });
      expect(result.text).toBe("ok");
      expect(lookups).toBe(1); // no second DNS resolution by the socket
      const mapped = await localHttpGet(url, { ...loopback, lookup: async () => [{ address: "::ffff:7f00:1", family: 6 }] });
      expect(mapped.text).toBe("ok");
    } finally { if (old === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = old; }
  });

  it("revalidates each redirect and bounds redirect chains", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/private") { res.writeHead(302, { location: "http://10.0.0.1/" }); res.end(); }
      else if (req.url === "/auth") { res.writeHead(302, { location: "http://user:password@example.com/" }); res.end(); }
      else { res.writeHead(302, { location: "/again" }); res.end(); }
    });
    await fails(localHttpGet(`http://127.0.0.1:${port}/private`, loopback), "blocked-address");
    await fails(localHttpGet(`http://127.0.0.1:${port}/auth`, loopback), "invalid-url");
    await fails(localHttpGet(`http://127.0.0.1:${port}/again`, { ...loopback, maxRedirects: 1 }), "redirect");
    let calls = 0;
    await fails(localHttpGet(`http://redirect.test:${port}/again`, { ...loopback, lookup: async () => {
      calls++;
      return [{ address: calls === 1 ? "127.0.0.1" : "10.0.0.1", family: 4 }];
    } }), "blocked-address");
    expect(calls).toBe(2);
  });

  it("limits headers/body, requires text and valid UTF-8, handles timeout and cancellation", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/slow") return;
      if (req.url === "/truncated") { res.writeHead(200, { "content-type": "text/plain", "content-length": "100" }); res.write("partial"); res.destroy(); return; }
      if (req.url === "/drip") { res.writeHead(200, { "content-type": "text/plain" }); res.write("a"); const interval = setInterval(() => res.write("a"), 5); res.on("close", () => clearInterval(interval)); return; }
      if (req.url === "/headers") res.setHeader("x-large", "a".repeat(5000));
      res.setHeader("content-type", req.url === "/binary" ? "application/octet-stream" : "text/plain");
      res.end(req.url === "/utf8" ? Buffer.from([0xff]) : "a".repeat(100));
    });
    const url = `http://127.0.0.1:${port}`;
    await fails(localHttpGet(url, { ...loopback, maxBodyBytes: 10 }), "body");
    await fails(localHttpGet(url + "/headers", { ...loopback, maxHeaderBytes: 100 }), "headers");
    await fails(localHttpGet(url + "/binary", loopback), "content-type");
    await fails(localHttpGet(url + "/utf8", loopback), "encoding");
    await fails(localHttpGet(url + "/slow", { ...loopback, timeoutMs: 30 }), "timeout");
    await fails(localHttpGet(url + "/drip", { ...loopback, timeoutMs: 40 }), "timeout");
    await fails(localHttpGet(url + "/truncated", loopback), "network");
    const controller = new AbortController(); controller.abort();
    await fails(localHttpGet(url, { ...loopback, signal: controller.signal }), "cancelled");
    const pendingLookup = async () => new Promise<readonly { address: string; family: number }[]>(() => {});
    await fails(localHttpGet("http://pending.test/", { lookup: pendingLookup, timeoutMs: 30 }), "timeout");
    const pendingController = new AbortController();
    const pending = localHttpGet("http://pending.test/", { lookup: pendingLookup, signal: pendingController.signal });
    pendingController.abort();
    await fails(pending, "cancelled");
    expect(new LocalHttpError("body").message).not.toContain(url);
  });
});
