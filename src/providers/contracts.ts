import type {
  CodeContextData,
  CodeContextInput,
  ExaProviderId,
  FirecrawlProviderId,
  ProviderId,
  ResearchData,
  ResearchInput,
  ResearchProviderId,
  WebCrawlData,
  WebCrawlInput,
  WebCrawlProviderId,
  WebExtractData,
  WebExtractInput,
  WebFetchData,
  WebFetchInput,
  WebMapData,
  WebMapInput,
  WebMapProviderId,
  WebRelatedData,
  WebRelatedInput,
  WebSearchData,
  WebSearchInput,
} from "../protocol/types.js";

export interface ProviderSearchRequest {
  input: WebSearchInput;
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface ProviderFetchRequest {
  input: WebFetchInput;
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface ProviderRelatedRequest {
  input: WebRelatedInput;
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface ProviderCodeContextRequest {
  input: CodeContextInput;
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface ProviderExtractRequest {
  input: WebExtractInput;
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  signal?: AbortSignal;
}

export interface ProviderResearchRequest {
  input: ResearchInput;
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  cleanupTimeoutMs: number;
  signal?: AbortSignal;
}

export interface ProviderCrawlRequest {
  input: WebCrawlInput;
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  cleanupTimeoutMs: number;
  signal?: AbortSignal;
}

export interface ProviderMapRequest {
  input: WebMapInput;
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface ResearchProvider {
  readonly id: ResearchProviderId;
  research(request: ProviderResearchRequest): Promise<ResearchData>;
}

export interface WebRelatedProvider {
  readonly id: ExaProviderId;
  related(request: ProviderRelatedRequest): Promise<WebRelatedData>;
}

export interface CodeContextProvider {
  readonly id: ExaProviderId;
  context(request: ProviderCodeContextRequest): Promise<CodeContextData>;
}

export interface WebExtractProvider {
  readonly id: FirecrawlProviderId;
  extract(request: ProviderExtractRequest): Promise<WebExtractData>;
}

export interface WebCrawlProvider {
  readonly id: WebCrawlProviderId;
  crawl(request: ProviderCrawlRequest): Promise<WebCrawlData>;
}

export interface WebSearchProvider {
  readonly id: ProviderId;
  search(request: ProviderSearchRequest): Promise<WebSearchData>;
}

export interface WebFetchProvider {
  readonly id: ProviderId;
  fetch(request: ProviderFetchRequest): Promise<WebFetchData>;
}

export interface WebMapProvider {
  readonly id: WebMapProviderId;
  map(request: ProviderMapRequest): Promise<WebMapData>;
}
