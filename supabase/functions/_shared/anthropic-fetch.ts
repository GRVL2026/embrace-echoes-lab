// Shared wrapper for Anthropic API calls with automatic retries on
// transient errors (429, 500, 502, 503, 529, network failures).
// - Up to 4 attempts (initial + 3 retries)
// - Exponential backoff: 2s, 5s, 10s
// - Honours the `retry-after` response header when present
// - Never retries other 4xx errors (400/401/403/404/...)
//
// If the final failure is a 529/overloaded_error or a rate limit (429),
// throws an AnthropicOverloadError so callers can surface a friendly
// French message to the end user instead of the raw API JSON.

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const BACKOFFS_MS = [2000, 5000, 10000];
const OVERLOAD_MESSAGE =
  "Les serveurs d'IA sont momentanément saturés. Réessaie dans quelques instants.";

export class AnthropicOverloadError extends Error {
  status: number;
  userMessage: string;
  constructor(status: number, message = OVERLOAD_MESSAGE) {
    super(message);
    this.name = "AnthropicOverloadError";
    this.status = status;
    this.userMessage = message;
  }
}

export class AnthropicApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Anthropic HTTP ${status}. Body: ${body.slice(0, 800)}`);
    this.name = "AnthropicApiError";
    this.status = status;
    this.body = body;
  }
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.min(delta, 30_000);
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AnthropicFetchInit extends RequestInit {
  /** Optional override for the URL (defaults to /v1/messages). */
  url?: string;
}

/**
 * Low-level fetch wrapper. Returns the Response on success (2xx) and
 * throws AnthropicApiError / AnthropicOverloadError on failure.
 * Callers are responsible for reading the body (text/JSON/stream).
 */
export async function anthropicFetch(
  input: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < BACKOFFS_MS.length + 1; attempt++) {
    let res: Response | null = null;
    let networkError: unknown = null;

    try {
      res = await fetch(input, init);
    } catch (err) {
      networkError = err;
    }

    if (res && res.ok) return res;

    const status = res?.status ?? 0;
    const isNetwork = networkError !== null;
    const isRetryable = isNetwork || RETRYABLE_STATUS.has(status);

    if (!isRetryable) {
      const body = res ? await res.text().catch(() => "") : "";
      throw new AnthropicApiError(status, body);
    }

    // Retryable path
    if (attempt < BACKOFFS_MS.length) {
      const retryAfterMs = res ? parseRetryAfter(res.headers.get("retry-after")) : null;
      const waitMs = retryAfterMs ?? BACKOFFS_MS[attempt];
      // Drain body so the connection can be reused.
      if (res) { try { await res.text(); } catch { /* ignore */ } }
      lastError = networkError ?? new AnthropicApiError(status, "");
      console.log(
        `[anthropic-fetch] attempt ${attempt + 1} failed (${
          isNetwork ? "network" : status
        }), retrying in ${waitMs}ms`,
      );
      await sleep(waitMs);
      continue;
    }

    // Exhausted retries
    if (isNetwork) {
      throw new AnthropicOverloadError(
        0,
        "Les serveurs d'IA sont momentanément injoignables. Réessaie dans quelques instants.",
      );
    }
    if (status === 429 || status === 529) {
      throw new AnthropicOverloadError(status);
    }
    const body = res ? await res.text().catch(() => "") : "";
    throw new AnthropicApiError(status, body);
  }

  throw lastError instanceof Error ? lastError : new Error("Anthropic call failed");
}

/**
 * High-level helper that POSTs a JSON payload to Anthropic /v1/messages
 * and returns the parsed JSON response. Errors follow the same contract
 * as anthropicFetch (AnthropicOverloadError for saturation, AnthropicApiError otherwise).
 */
export async function anthropicJson(
  apiKey: string,
  payload: Record<string, unknown>,
  opts: { url?: string; extraHeaders?: Record<string, string> } = {},
): Promise<any> {
  const url = opts.url ?? "https://api.anthropic.com/v1/messages";
  const res = await anthropicFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(opts.extraHeaders ?? {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new AnthropicApiError(res.status, `Invalid JSON. Body: ${text.slice(0, 800)}`);
  }
}

/** True when the error should be shown as a soft "AI overloaded" warning. */
export function isAnthropicOverload(err: unknown): err is AnthropicOverloadError {
  return err instanceof AnthropicOverloadError;
}

export const ANTHROPIC_OVERLOAD_MESSAGE = OVERLOAD_MESSAGE;
