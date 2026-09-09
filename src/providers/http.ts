import { ProviderError, classifyHttpFailure } from "../errors/provider-error.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function postJson(
  fetcher: FetchLike,
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return requestJson(fetcher, provider, url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

export async function requestJson(
  fetcher: FetchLike,
  provider: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  let text: string;
  try {
    response = await fetcher(url, init);
    text = await response.text();
  } catch (error) {
    throw new ProviderError(`${provider} request failed before receiving a response.`, {
      kind: "network",
      cause: error,
    });
  }

  if (!response.ok) {
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    throw new ProviderError(`${provider} request failed with HTTP ${response.status}.`, {
      kind: classifyHttpFailure(response.status, text),
      status: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ProviderError(`${provider} returned invalid JSON.`, {
      kind: "invalid-response",
      status: response.status,
      cause: error,
    });
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());
  return undefined;
}
