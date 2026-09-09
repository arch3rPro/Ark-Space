import type {
  CleanupEvidence,
  FailureKind,
  RemoteJobEvidence,
  SubmissionEvidence,
} from "../protocol/types.js";

const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set([
  "rate-limit",
  "quota",
  "transient",
  "network",
]);

export class ProviderError extends Error {
  readonly kind: FailureKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly retryable: boolean;
  readonly safeToRetry: boolean;
  readonly cleanup: CleanupEvidence | undefined;
  readonly submission: SubmissionEvidence | undefined;
  readonly remoteJob: RemoteJobEvidence | undefined;

  constructor(
    message: string,
    options: {
      kind: FailureKind;
      status?: number;
      retryAfterMs?: number;
      safeToRetry?: boolean;
      cleanup?: CleanupEvidence;
      submission?: SubmissionEvidence;
      remoteJob?: RemoteJobEvidence;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = options.kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    const hasUnsettledRemoteWork =
      options.submission !== undefined ||
      options.cleanup?.ok === false ||
      options.remoteJob?.state === "possibly-running";
    this.safeToRetry = options.safeToRetry ?? !hasUnsettledRemoteWork;
    this.retryable = RETRYABLE_KINDS.has(options.kind) && this.safeToRetry;
    this.cleanup = options.cleanup;
    this.submission = options.submission;
    this.remoteJob = options.remoteJob;
  }
}

export function classifyHttpFailure(status: number, body: string): FailureKind {
  const normalized = body.toLowerCase();
  if (status === 401) return "auth";
  if (status === 402 || status === 432 || status === 433) return "quota";
  if (status === 403) return "permission";
  if (status === 429) {
    return /quota|usage limit|credit|billing|plan/.test(normalized) ? "quota" : "rate-limit";
  }
  if (/quota|usage limit|credit|billing limit/.test(normalized)) return "quota";
  if (status >= 500) return "transient";
  if (status >= 400 && status < 500) return "invalid-request";
  return "unknown";
}

export function correctionFor(kind: FailureKind): string | undefined {
  switch (kind) {
    case "auth":
      return "Replace or re-enable the provider API key.";
    case "permission":
      return "Check the provider account, plan, and endpoint permissions.";
    case "rate-limit":
    case "quota":
      return "Wait for availability, add another key, or configure another provider.";
    case "config":
      return "Run `arks setup`, then add an environment-variable key reference with `arks key add`.";
    case "invalid-request":
      return "Correct the request fields and retry.";
    case "invalid-response":
      return "Retry later or report the provider response incompatibility.";
    case "network":
    case "transient":
      return "Check network access or retry later.";
    case "unknown":
      return undefined;
  }
}
