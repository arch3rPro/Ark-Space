import { describe, expect, it } from "vitest";
import { LocalFetchProvider } from "../src/providers/local-fetch.js";

const response = (body: string, contentType = "text/html") =>
  new Response(body, { status: 200, headers: { "content-type": contentType } });

describe("LocalFetchProvider", () => {
  it("uses the injected transport and preserves raw HTML", async () => {
    let called = "";
    const provider = new LocalFetchProvider({
      transport: async (url) => {
        called = String(url);
        return response("<html><title>Page</title><p>Hello <b>world</b></p></html>");
      },
    });

    const result = await provider.fetch({
      input: { url: "https://safe.test/page", mode: "raw", maxCharacters: 500, timeoutMs: 1000 },
    });
    expect(called).toBe("https://safe.test/page");
    expect(result.results[0]).toEqual({
      url: "https://safe.test/page",
      content: "<html><title>Page</title><p>Hello <b>world</b></p></html>",
    });
  });

  it("provides dependency-free readable extraction and title", async () => {
    const provider = new LocalFetchProvider({
      transport: async () =>
        response("<html><head><title>  A &amp; B </title><style>x</style></head><body><nav>Menu</nav><main><h1>Hello</h1><p>World &amp; friends</p></main><script>bad()</script></body></html>"),
    });

    const result = await provider.fetch({
      input: { url: "https://safe.test/page", mode: "readable", maxCharacters: 500, timeoutMs: 1000 },
    });
    expect(result.results[0]).toEqual({
      url: "https://safe.test/page",
      content: "A & B\nHello\nWorld & friends",
      title: "A & B",
    });
  });

  it("applies maxCharacters after extraction", async () => {
    const provider = new LocalFetchProvider({
      transport: async () => response("plain response", "text/plain"),
    });
    const result = await provider.fetch({
      input: { url: "https://safe.test", mode: "raw", maxCharacters: 6, timeoutMs: 1000 },
    });
    expect(result.results[0]?.content).toBe("plain ");
  });

  it("rejects non-text responses without inspecting their body", async () => {
    const provider = new LocalFetchProvider({
      transport: async () => new Response("secret", { headers: { "content-type": "application/pdf" } }),
    });
    await expect(
      provider.fetch({ input: { url: "https://safe.test/file", mode: "raw", maxCharacters: 100, timeoutMs: 1000 } }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });
});
