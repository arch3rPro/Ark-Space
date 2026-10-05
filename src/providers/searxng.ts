import { z } from "zod";
import { ProviderError } from "../errors/provider-error.js";
import type { FailureKind, WebSearchData } from "../protocol/types.js";
import type { ProviderSearchRequest } from "./contracts.js";
import { LocalHttpError, localHttpGet } from "./local-http.js";

const ResultSchema = z.object({
  url: z.string().url().max(4_096).refine(value => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }),
  title: z.string().max(10_000).nullish(), content: z.string().max(100_000).nullish(),
  score: z.number().finite().nullish(),
  publishedDate: z.string().max(100).nullish(), published_date: z.string().max(100).nullish(),
  engine: z.string().max(200).nullish(), category: z.string().max(200).nullish(),
}).loose();
const ResponseSchema = z.object({ results: z.array(ResultSchema).max(1_000) }).loose();

/** The only search adapter with no credential. All network authority comes from local configuration. */
export class SearxngProvider {
  readonly id = "searxng" as const;
  async search(request: Omit<ProviderSearchRequest, "apiKey"> & { allowRanges?: readonly string[] }): Promise<WebSearchData> {
    const { input } = request;
    let url: URL;
    try { url = new URL(`${request.baseUrl.replace(/\/$/, "")}/search`); }
    catch { throw new ProviderError("Invalid SearXNG base URL.", { kind: "config" }); }
    url.searchParams.set("q", input.query); url.searchParams.set("format", "json");
    const options = input.options?.searxng;
    url.searchParams.set("pageno", String(options?.page ?? 1));
    if (options?.categories) url.searchParams.set("categories", options.categories.join(","));
    if (options?.engines) url.searchParams.set("engines", options.engines.join(","));
    if (options?.language) url.searchParams.set("language", options.language);
    if (options?.safesearch !== undefined) url.searchParams.set("safesearch", String(options.safesearch));
    if (options?.timeRange) url.searchParams.set("time_range", options.timeRange);
    try {
      const response = await localHttpGet(url.href, {
        allowRanges: request.allowRanges ?? [], timeoutMs: input.timeoutMs,
        maxBodyBytes: 2 * 1024 * 1024, maxRedirects: 5,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!/^application\/(?:json|[a-z0-9.+-]+\+json)$/i.test(response.contentType)) {
        throw new ProviderError("SearXNG must enable JSON search responses.", { kind: "invalid-response" });
      }
      let json: unknown;
      try { json = JSON.parse(response.text); } catch { throw new ProviderError("SearXNG returned invalid JSON.", { kind: "invalid-response" }); }
      const parsed = ResponseSchema.safeParse(json);
      if (!parsed.success) throw new ProviderError("SearXNG returned an invalid search response.", { kind: "invalid-response" });
      const matches = (hostname: string, domains: string[]) => domains.some(domain => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`));
      return { query: input.query, results: parsed.data.results.filter(result => {
        const hostname = new URL(result.url).hostname;
        return (!input.includeDomains.length || matches(hostname, input.includeDomains)) && !matches(hostname, input.excludeDomains);
      }).slice(0, input.maxResults).map(result => ({
        url: result.url, title: result.title ?? result.url, snippet: (result.content ?? "").slice(0, 10_000),
        ...(result.score == null ? {} : { score: result.score }),
        ...(result.publishedDate ?? result.published_date ? { published: (result.publishedDate ?? result.published_date)! } : {}),
        ...(result.engine || result.category ? { source: { ...(result.engine ? { engine: result.engine } : {}), ...(result.category ? { category: result.category } : {}) } } : {}),
      })) };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof LocalHttpError) {
        let kind: FailureKind;
        if (error.status !== undefined) kind = error.status === 429 ? "rate-limit" : error.status === 401 ? "auth" : error.status === 403 ? "permission" : error.status >= 500 ? "transient" : "invalid-request";
        else if (["blocked-address", "invalid-url", "configuration"].includes(error.kind)) kind = "config";
        else if (["content-type", "encoding", "body", "headers"].includes(error.kind)) kind = "invalid-response";
        else kind = "network";
        throw new ProviderError(`SearXNG request failed (${error.kind}).`, { kind, ...(error.status === undefined ? {} : { status: error.status }) });
      }
      throw new ProviderError("SearXNG request failed.", { kind: "unknown" });
    }
  }
}
