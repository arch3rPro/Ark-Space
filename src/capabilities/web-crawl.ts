import type { ArkSpaceConfig } from "../config/schema.js";
import { correctionFor } from "../errors/provider-error.js";
import type {
  AttemptEvidence,
  CrawlSuccessEnvelope,
  FailureEnvelope,
  ProviderId,
  WebCrawlInput,
  WebCrawlProviderId,
} from "../protocol/types.js";
import { PROTOCOL_VERSION, WEB_CRAWL_PROVIDER_IDS } from "../protocol/types.js";
import type { CrawlProviderRegistry } from "../providers/registry.js";
import { executeWithProviders } from "./provider-execution.js";

const WEB_CRAWL_PROVIDERS = new Set<ProviderId>(WEB_CRAWL_PROVIDER_IDS);

export interface WebCrawlContext {
  config: ArkSpaceConfig;
  statePath: string;
  providers: CrawlProviderRegistry;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function executeWebCrawl(
  input: WebCrawlInput,
  context: WebCrawlContext,
): Promise<
  CrawlSuccessEnvelope | FailureEnvelope<"web.crawl">
> {
  const providerIds: WebCrawlProviderId[] = input.provider
    ? [input.provider]
    : context.config.providerOrder.filter(isWebCrawlProvider);
  const result = await executeWithProviders({
    providerIds,
    timeoutMs: input.timeoutMs,
    context,
    invoke: (providerId, apiKey, baseUrl, signal) => {
      const provider = context.providers.get(providerId);
      return provider?.crawl({
        input,
        apiKey,
        baseUrl,
        signal,
        pollIntervalMs: context.config.execution.crawlPollIntervalMs,
        cleanupTimeoutMs: context.config.execution.cleanupTimeoutMs,
      });
    },
  });

  if (result.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      ok: true,
      capability: "web.crawl",
      provider: result.provider,
      data: result.data,
      attempts: result.attempts,
      warnings: [
        ...result.data.failedUrls.map((url) => `Provider could not crawl ${url}`),
        ...cleanupWarnings(result.attempts),
      ],
    };
  }

  const correction = correctionFor(result.error.kind);
  return {
    protocolVersion: PROTOCOL_VERSION,
    ok: false,
    capability: "web.crawl",
    error: {
      kind: result.error.kind,
      message: result.error.message,
      retryable: result.error.retryable,
      ...(correction ? { correction } : {}),
    },
    attempts: result.attempts,
    warnings: cleanupWarnings(result.attempts),
  };
}

function cleanupWarnings(attempts: AttemptEvidence[]): string[] {
  return attempts.some((attempt) => attempt.cleanup?.ok === false)
    ? ["Remote crawl job cancellation could not be confirmed."]
    : [];
}

function isWebCrawlProvider(provider: ProviderId): provider is WebCrawlProviderId {
  return WEB_CRAWL_PROVIDERS.has(provider);
}
