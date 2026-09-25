import { ProviderError } from "../errors/provider-error.js";

/** Return promptly when the caller aborts, even if the operation cannot cancel itself. */
export async function awaitWithAbort<Data>(operation: Promise<Data>, signal: AbortSignal): Promise<Data> {
  if (signal.aborted) throw abortedProviderError(signal);

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortedProviderError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } catch (error) {
    // Give providers whose abort handler performs bounded cleanup one turn to
    // report it, without allowing an uncooperative promise to hang forever.
    if (signal.aborted) {
      // ponytail: one short grace window for provider cleanup; a provider-specific
      // settlement hook can replace this if cleanup latency becomes measurable.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([
          operation.then(value => ({ ok: true as const, value }), reason => ({ ok: false as const, reason })),
          new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 25); }),
        ]);
        if (settled) {
          if (settled.ok) return settled.value;
          throw settled.reason;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function abortedProviderError(signal: AbortSignal): ProviderError {
  return new ProviderError("Provider operation was cancelled or timed out.", {
    kind: "transient",
    safeToRetry: false,
    cause: signal.reason,
  });
}
