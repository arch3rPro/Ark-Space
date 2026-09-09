import type {
  ExaProviderId,
  ProviderId,
  ResearchProviderId,
  WebCrawlProviderId,
  WebMapProviderId,
} from "../protocol/types.js";
import type {
  CodeContextProvider,
  ResearchProvider,
  WebCrawlProvider,
  WebExtractProvider,
  WebFetchProvider,
  WebMapProvider,
  WebRelatedProvider,
  WebSearchProvider,
} from "./contracts.js";
import { ExaProvider } from "./exa.js";
import { FirecrawlProvider } from "./firecrawl.js";
import { TavilyProvider } from "./tavily.js";

export type ResearchProviderRegistry = ReadonlyMap<ResearchProviderId, ResearchProvider>;
export type CodeContextProviderRegistry = ReadonlyMap<ExaProviderId, CodeContextProvider>;
export type RelatedProviderRegistry = ReadonlyMap<ExaProviderId, WebRelatedProvider>;
export type ExtractProviderRegistry = ReadonlyMap<"firecrawl", WebExtractProvider>;
export type CrawlProviderRegistry = ReadonlyMap<WebCrawlProviderId, WebCrawlProvider>;
export type SearchProviderRegistry = ReadonlyMap<ProviderId, WebSearchProvider>;
export type FetchProviderRegistry = ReadonlyMap<ProviderId, WebFetchProvider>;
export type MapProviderRegistry = ReadonlyMap<WebMapProviderId, WebMapProvider>;

export function createResearchProviderRegistry(): ResearchProviderRegistry {
  const providers: ResearchProvider[] = [new ExaProvider(), new TavilyProvider()];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export function createCodeContextProviderRegistry(): CodeContextProviderRegistry {
  const providers: CodeContextProvider[] = [new ExaProvider()];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export function createExtractProviderRegistry(): ExtractProviderRegistry {
  const providers: WebExtractProvider[] = [new FirecrawlProvider()];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export function createRelatedProviderRegistry(): RelatedProviderRegistry {
  const providers: WebRelatedProvider[] = [new ExaProvider()];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export function createSearchProviderRegistry(): SearchProviderRegistry {
  const providers: WebSearchProvider[] = [new ExaProvider(), new TavilyProvider(), new FirecrawlProvider()];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export function createFetchProviderRegistry(): FetchProviderRegistry {
  const providers: WebFetchProvider[] = [new ExaProvider(), new TavilyProvider(), new FirecrawlProvider()];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export function createCrawlProviderRegistry(): CrawlProviderRegistry {
  const providers: WebCrawlProvider[] = [new TavilyProvider(), new FirecrawlProvider()];
  return new Map(providers.map((provider) => [provider.id, provider]));
}

export function createMapProviderRegistry(): MapProviderRegistry {
  const providers: WebMapProvider[] = [
    new TavilyProvider(),
    new FirecrawlProvider(),
  ];
  return new Map(providers.map((provider) => [provider.id, provider]));
}
