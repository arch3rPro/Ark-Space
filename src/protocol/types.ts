export const PROTOCOL_VERSION = 1 as const;

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
export type KeyId = Brand<string, "KeyId">;
export type CrawlJobId = Brand<string, "CrawlJobId">;
export type ExtractJobId = Brand<string, "ExtractJobId">;
export type ResearchJobId = Brand<string, "ResearchJobId">;
export type BrowserSessionId = Brand<string, "BrowserSessionId">;
export type MonitorId = Brand<string, "MonitorId">;
export type MonitorRunId = Brand<string, "MonitorRunId">;
export type SiteMonitorId = Brand<string, "SiteMonitorId">;
export type SiteMonitorCheckId = Brand<string, "SiteMonitorCheckId">;

export const PROVIDER_IDS = ["exa", "tavily", "firecrawl"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const WEB_MAP_PROVIDER_IDS = ["tavily", "firecrawl"] as const;
export type WebMapProviderId = (typeof WEB_MAP_PROVIDER_IDS)[number];
export const WEB_CRAWL_PROVIDER_IDS = ["tavily", "firecrawl"] as const;
export type WebCrawlProviderId = (typeof WEB_CRAWL_PROVIDER_IDS)[number];
export const EXA_PROVIDER_IDS = ["exa"] as const;
export type ExaProviderId = (typeof EXA_PROVIDER_IDS)[number];
export const FIRECRAWL_PROVIDER_IDS = ["firecrawl"] as const;
export type FirecrawlProviderId = (typeof FIRECRAWL_PROVIDER_IDS)[number];
export const RESEARCH_PROVIDER_IDS = ["exa", "tavily"] as const;
export type ResearchProviderId = (typeof RESEARCH_PROVIDER_IDS)[number];
export type Capability =
  | "web.search"
  | "web.fetch"
  | "web.map"
  | "web.crawl"
  | "web.related"
  | "web.extract"
  | "code.context"
  | "research.run"
  | "browser.open"
  | "browser.snapshot"
  | "browser.interact"
  | "browser.status"
  | "browser.close"
  | "monitor.create"
  | "monitor.list"
  | "monitor.status"
  | "monitor.update"
  | "monitor.pause"
  | "monitor.resume"
  | "monitor.trigger"
  | "monitor.delete"
  | "monitor.runs"
  | "monitor.run.get"
  | "monitor.site.create"
  | "monitor.site.list"
  | "monitor.site.status"
  | "monitor.site.update"
  | "monitor.site.pause"
  | "monitor.site.resume"
  | "monitor.site.trigger"
  | "monitor.site.delete"
  | "monitor.site.checks"
  | "monitor.site.check.get";

export const FAILURE_KINDS = [
  "auth",
  "permission",
  "rate-limit",
  "quota",
  "transient",
  "network",
  "invalid-request",
  "invalid-response",
  "config",
  "unknown",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export interface WebSearchInput {
  query: string;
  maxResults: number;
  timeoutMs: number;
  provider?: ProviderId;
  includeDomains: string[];
  excludeDomains: string[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  published?: string;
}

export interface WebSearchData {
  query: string;
  results: WebSearchResult[];
  answer?: string;
  requestId?: string;
}

export interface WebFetchInput {
  urls: string[];
  timeoutMs: number;
  provider?: ProviderId;
  onlyMainContent: boolean;
  maxCharacters: number;
}

export interface WebFetchResult {
  url: string;
  content: string;
  title?: string;
  published?: string;
  images?: string[];
}

export interface WebFetchData {
  results: WebFetchResult[];
  failedUrls: string[];
  requestId?: string;
}

export interface WebMapInput {
  url: string;
  query?: string;
  maxResults: number;
  timeoutMs: number;
  provider?: WebMapProviderId;
}

export interface WebMapLink {
  url: string;
  title?: string;
  description?: string;
}

export interface WebMapData {
  baseUrl: string;
  links: WebMapLink[];
  requestId?: string;
}

export interface WebCrawlInput {
  url: string;
  query?: string;
  maxPages: number;
  maxDepth: number;
  timeoutMs: number;
  maxCharacters: number;
  onlyMainContent: boolean;
  includePaths: string[];
  excludePaths: string[];
  provider?: WebCrawlProviderId;
}

export interface WebCrawlPage {
  url: string;
  content: string;
  title?: string;
}

export interface WebCrawlData {
  baseUrl: string;
  pages: WebCrawlPage[];
  failedUrls: string[];
  requestId?: string;
  jobId?: CrawlJobId;
}

export interface WebRelatedInput {
  url: string;
  maxResults: number;
  timeoutMs: number;
  includeDomains: string[];
  excludeDomains: string[];
  provider?: ExaProviderId;
}

export interface WebRelatedData {
  url: string;
  results: WebSearchResult[];
  requestId?: string;
}

export interface CodeContextInput {
  query: string;
  tokens: "dynamic" | number;
  timeoutMs: number;
  provider?: ExaProviderId;
}

export interface CodeContextData {
  query: string;
  response: string;
  resultsCount?: number;
  outputTokens?: number;
  requestId?: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface WebExtractInput {
  urls: string[];
  prompt: string;
  schema: JsonObject;
  timeoutMs: number;
  onlyMainContent: boolean;
  provider?: FirecrawlProviderId;
}

export interface WebExtractData {
  data: JsonValue;
  sources: string[];
  invalidUrls: string[];
  jobId: ExtractJobId;
}

export interface ResearchInput {
  prompt: string;
  depth: "concise" | "standard" | "deep";
  timeoutMs: number;
  provider?: ResearchProviderId;
}

export interface ResearchSource {
  url: string;
  title?: string;
}

export interface ResearchGrounding {
  field: string;
  sourceUrls: string[];
  confidence?: "low" | "medium" | "high";
}

export interface ResearchUsage {
  credits?: number;
  searches?: number;
  agentComputeUnits?: number;
  costDollars?: number;
}

export interface ResearchData {
  prompt: string;
  report: string;
  sources: ResearchSource[];
  status: "completed";
  jobId: ResearchJobId;
  grounding?: ResearchGrounding[];
  stopReason?: string;
  usage?: ResearchUsage;
}

export interface BrowserOpenInput {
  url: string;
  ttlSeconds: number;
  activityTtlSeconds: number;
  timeoutMs: number;
}

export interface BrowserSessionData {
  sessionId: BrowserSessionId;
  status: "active" | "closed" | "expired" | "unknown";
  createdAt?: string;
  expiresAt?: string;
  lastActivityAt?: string;
}

export interface BrowserSnapshotInput {
  sessionId: BrowserSessionId;
  interactiveOnly: boolean;
  timeoutMs: number;
}

export interface BrowserSnapshotData extends BrowserSessionData {
  snapshot: string;
  truncated: boolean;
}

export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; ref: string }
  | { type: "fill"; ref: string; text: string }
  | { type: "press"; key: string }
  | { type: "scroll"; direction: "up" | "down"; pixels: number }
  | { type: "scrape" };

export interface BrowserInteractInput {
  sessionId: BrowserSessionId;
  action: BrowserAction;
  confirmed: true;
  timeoutMs: number;
}

export interface BrowserInteractData extends BrowserSessionData {
  output: string;
  exitCode: number;
  killed: boolean;
  truncated: boolean;
}

export interface BrowserResourceInput {
  sessionId: BrowserSessionId;
  timeoutMs: number;
}

export interface MonitorCreateInput {
  name?: string;
  query: string;
  numResults: number;
  period: string;
  webhookUrl: string;
  webhookSecretPath: string;
  confirmed: true;
  timeoutMs: number;
}

export interface MonitorResourceInput {
  monitorId: MonitorId;
  timeoutMs: number;
}

export interface ConfirmedMonitorResourceInput extends MonitorResourceInput {
  confirmed: true;
}

export interface MonitorUpdateInput extends ConfirmedMonitorResourceInput {
  name?: string;
  query?: string;
  numResults?: number;
  period?: string;
}

export interface MonitorListInput {
  limit: number;
}

export interface MonitorRunsInput extends MonitorResourceInput {
  limit: number;
}

export interface MonitorRunGetInput extends MonitorResourceInput {
  runId: MonitorRunId;
}

export interface MonitorData {
  monitorId: MonitorId;
  name?: string;
  status: "active" | "paused" | "disabled" | "unknown";
  query?: string;
  numResults?: number;
  period?: string;
  nextRunAt?: string;
  createdAt?: string;
  updatedAt?: string;
  webhookSecretStored?: boolean;
  triggered?: boolean;
}

export interface MonitorRunData {
  runId: MonitorRunId;
  monitorId: MonitorId;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "unknown";
  results: WebSearchResult[];
  summary?: string;
  failReason?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface MonitorRunsData {
  monitorId: MonitorId;
  runs: MonitorRunData[];
}

export type SiteMonitorSchedule =
  | { type: "cron"; value: string; timezone: string }
  | { type: "text"; value: string; timezone: string };

export type SiteMonitorTarget =
  | { type: "scrape"; urls: string[]; onlyMainContent: boolean }
  | { type: "crawl"; url: string; limit: number; maxDepth: number; includePaths: string[]; excludePaths: string[]; onlyMainContent: boolean }
  | { type: "search"; queries: string[]; searchWindow: "5m" | "15m" | "1h" | "6h" | "24h" | "7d"; maxResults: number; includeDomains: string[]; excludeDomains: string[] };

export interface SiteMonitorCreateInput {
  name: string;
  schedule: SiteMonitorSchedule;
  targets: SiteMonitorTarget[];
  retentionDays: number;
  goal?: string;
  judgeEnabled: boolean;
  webhookUrl?: string;
  webhookEvents: Array<"monitor.page" | "monitor.check.completed">;
  confirmed: true;
  timeoutMs: number;
}

export interface SiteMonitorResourceInput {
  monitorId: SiteMonitorId;
  timeoutMs: number;
}

export interface ConfirmedSiteMonitorResourceInput extends SiteMonitorResourceInput {
  confirmed: true;
}

export interface SiteMonitorUpdateInput extends ConfirmedSiteMonitorResourceInput {
  name?: string;
  schedule?: SiteMonitorSchedule;
  targets?: SiteMonitorTarget[];
  retentionDays?: number;
  goal?: string;
  judgeEnabled?: boolean;
  webhookUrl?: string;
  webhookEvents?: Array<"monitor.page" | "monitor.check.completed">;
}

export interface SiteMonitorListInput { limit: number; }
export interface SiteMonitorChecksInput extends SiteMonitorResourceInput { limit: number; }
export interface SiteMonitorCheckGetInput extends SiteMonitorResourceInput { checkId: SiteMonitorCheckId; limit: number; }

export interface SiteMonitorSummary {
  totalPages: number;
  same: number;
  changed: number;
  new: number;
  removed: number;
  error: number;
}

export interface SiteMonitorData {
  monitorId: SiteMonitorId;
  name?: string;
  status: "active" | "paused" | "deleted" | "unknown";
  schedule?: { cron: string; timezone: string };
  targetTypes: Array<"scrape" | "crawl" | "search">;
  retentionDays?: number;
  goal?: string;
  judgeEnabled?: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  currentCheckId?: SiteMonitorCheckId;
  estimatedCreditsPerMonth?: number;
  lastCheckSummary?: SiteMonitorSummary;
  createdAt?: string;
  updatedAt?: string;
}

export interface SiteMonitorCheckPage {
  url: string;
  status: "same" | "new" | "changed" | "removed" | "error" | "unknown";
  statusCode?: number;
  error?: string;
  diffText?: string;
}

export interface SiteMonitorCheckData {
  checkId: SiteMonitorCheckId;
  monitorId: SiteMonitorId;
  status: "queued" | "running" | "completed" | "failed" | "partial" | "skipped_overlap" | "skipped_no_credits" | "unknown";
  trigger?: "scheduled" | "manual";
  estimatedCredits?: number;
  actualCredits?: number;
  billingStatus?: string;
  summary?: SiteMonitorSummary;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  pages: SiteMonitorCheckPage[];
}

export interface ResourceSuccessEnvelope<C extends Capability, P extends ProviderId, D> {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: C;
  provider: P;
  data: D;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export type CleanupEvidence =
  | { resource: "crawl-job"; attempted: true; ok: boolean }
  | { resource: "research-job"; jobId: ResearchJobId; attempted: true; ok: boolean }
  | { resource: "browser-session"; sessionId: BrowserSessionId; attempted: true; ok: boolean }
  | { resource: "monitor"; monitorId: MonitorId; attempted: true; ok: boolean }
  | { resource: "site-monitor"; monitorId: SiteMonitorId; attempted: true; ok: boolean };

export type SubmissionEvidence =
  | { resource: "research-job"; state: "acceptance-unknown" }
  | { resource: "browser-session"; state: "acceptance-unknown" }
  | { resource: "monitor"; state: "acceptance-unknown" }
  | { resource: "site-monitor"; state: "acceptance-unknown" };

export type RemoteJobEvidence =
  | { resource: "extract-job"; jobId: ExtractJobId; state: "possibly-running" }
  | {
      resource: "research-job";
      jobId: ResearchJobId;
      state: "possibly-running" | "completed" | "failed" | "cancelled";
    };

export interface AttemptEvidence {
  provider: ProviderId;
  keyId?: KeyId;
  ok: boolean;
  errorKind?: FailureKind;
  status?: number;
  retryable?: boolean;
  safeToRetry?: boolean;
  cleanup?: CleanupEvidence;
  submission?: SubmissionEvidence;
  remoteJob?: RemoteJobEvidence;
}

export interface SuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "web.search";
  provider: ProviderId;
  data: WebSearchData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface FetchSuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "web.fetch";
  provider: ProviderId;
  data: WebFetchData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface MapSuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "web.map";
  provider: WebMapProviderId;
  data: WebMapData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface CrawlSuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "web.crawl";
  provider: WebCrawlProviderId;
  data: WebCrawlData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface RelatedSuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "web.related";
  provider: ExaProviderId;
  data: WebRelatedData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface CodeContextSuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "code.context";
  provider: ExaProviderId;
  data: CodeContextData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface ExtractSuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "web.extract";
  provider: FirecrawlProviderId;
  data: WebExtractData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface ResearchSuccessEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: true;
  capability: "research.run";
  provider: ResearchProviderId;
  data: ResearchData;
  attempts: AttemptEvidence[];
  warnings: string[];
}

export interface FailureEnvelope<C extends Capability = "web.search"> {
  protocolVersion: typeof PROTOCOL_VERSION;
  ok: false;
  capability: C;
  error: {
    kind: FailureKind;
    message: string;
    retryable: boolean;
    correction?: string;
  };
  attempts: AttemptEvidence[];
  warnings: string[];
}

export type WebSearchEnvelope = SuccessEnvelope | FailureEnvelope<"web.search">;
export type WebFetchEnvelope = FetchSuccessEnvelope | FailureEnvelope<"web.fetch">;
export type WebMapEnvelope = MapSuccessEnvelope | FailureEnvelope<"web.map">;
export type WebCrawlEnvelope = CrawlSuccessEnvelope | FailureEnvelope<"web.crawl">;
export type WebRelatedEnvelope = RelatedSuccessEnvelope | FailureEnvelope<"web.related">;
export type CodeContextEnvelope = CodeContextSuccessEnvelope | FailureEnvelope<"code.context">;
export type WebExtractEnvelope = ExtractSuccessEnvelope | FailureEnvelope<"web.extract">;
export type ResearchEnvelope = ResearchSuccessEnvelope | FailureEnvelope<"research.run">;
export type BrowserOpenEnvelope = ResourceSuccessEnvelope<"browser.open", "firecrawl", BrowserSessionData> | FailureEnvelope<"browser.open">;
export type BrowserSnapshotEnvelope = ResourceSuccessEnvelope<"browser.snapshot", "firecrawl", BrowserSnapshotData> | FailureEnvelope<"browser.snapshot">;
export type BrowserInteractEnvelope = ResourceSuccessEnvelope<"browser.interact", "firecrawl", BrowserInteractData> | FailureEnvelope<"browser.interact">;
export type BrowserStatusEnvelope = ResourceSuccessEnvelope<"browser.status", "firecrawl", BrowserSessionData> | FailureEnvelope<"browser.status">;
export type BrowserCloseEnvelope = ResourceSuccessEnvelope<"browser.close", "firecrawl", BrowserSessionData> | FailureEnvelope<"browser.close">;
export type MonitorEnvelope<C extends Capability = "monitor.status"> = ResourceSuccessEnvelope<C, "exa", MonitorData> | FailureEnvelope<C>;
export type MonitorListEnvelope = ResourceSuccessEnvelope<"monitor.list", "exa", { monitors: MonitorData[] }> | FailureEnvelope<"monitor.list">;
export type MonitorRunsEnvelope = ResourceSuccessEnvelope<"monitor.runs", "exa", MonitorRunsData> | FailureEnvelope<"monitor.runs">;
export type MonitorRunGetEnvelope = ResourceSuccessEnvelope<"monitor.run.get", "exa", MonitorRunData> | FailureEnvelope<"monitor.run.get">;
export type SiteMonitorEnvelope<C extends Capability = "monitor.site.status"> = ResourceSuccessEnvelope<C, "firecrawl", SiteMonitorData> | FailureEnvelope<C>;
export type SiteMonitorListEnvelope = ResourceSuccessEnvelope<"monitor.site.list", "firecrawl", { monitors: SiteMonitorData[] }> | FailureEnvelope<"monitor.site.list">;
export type SiteMonitorChecksEnvelope = ResourceSuccessEnvelope<"monitor.site.checks", "firecrawl", { monitorId: SiteMonitorId; checks: SiteMonitorCheckData[] }> | FailureEnvelope<"monitor.site.checks">;
export type SiteMonitorCheckGetEnvelope = ResourceSuccessEnvelope<"monitor.site.check.get", "firecrawl", SiteMonitorCheckData> | FailureEnvelope<"monitor.site.check.get">;
