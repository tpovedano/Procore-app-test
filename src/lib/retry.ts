/**
 * Reintentos con backoff exponencial respetando los límites de Procore
 * (docs "Rate Limiting"): 429 → esperar hasta X-Rate-Limit-Reset; 503 → Retry-After.
 * Lógica pura: fetch, sleep, reloj y aleatoriedad se inyectan para poder testear.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Tiempo total máximo de espera acumulada (p. ej. para no exceder el timeout de la función). */
  maxTotalWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

type HeaderBag = { get(name: string): string | null };

export const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * Calcula cuánto esperar antes del reintento `attempt` (0-based).
 * Prioridad: Retry-After → X-Rate-Limit-Reset (solo 429) → backoff exponencial con jitter.
 */
export function computeRetryDelay(
  attempt: number,
  status: number,
  headers: HeaderBag | null,
  opts: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'now' | 'random'> = {},
): number {
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;

  const retryAfter = headers?.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, max);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(at - now(), 0), max);
  }

  if (status === 429) {
    const reset = Number(headers?.get('x-rate-limit-reset'));
    if (Number.isFinite(reset) && reset > 0) {
      const wait = reset * 1000 - now();
      if (wait > 0) return Math.min(wait + 250, max);
    }
  }

  const exp = Math.min(base * 2 ** attempt, max);
  // "Full jitter" entre exp/2 y exp para no re-saturar el límite.
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Ejecuta `doFetch` reintentando ante 429/5xx transitorios y errores de red. */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  opts: RetryOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 4;
  const maxTotal = opts.maxTotalWaitMs ?? 45_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;

  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    let networkError: unknown = null;
    try {
      res = await doFetch();
    } catch (e) {
      networkError = e;
    }

    if (res && !RETRYABLE_STATUS.has(res.status)) return res;
    if (attempt >= maxRetries) {
      if (res) return res;
      throw networkError;
    }

    const delay = computeRetryDelay(attempt, res?.status ?? 0, res?.headers ?? null, opts);
    if (waited + delay > maxTotal) {
      if (res) return res;
      throw networkError;
    }
    waited += delay;
    await sleep(delay);
  }
}

/** Devuelve true si la cabecera Link contiene rel="next". */
export function hasNextPage(linkHeader: string | null | undefined): boolean {
  if (!linkHeader) return false;
  return linkHeader.split(',').some((part) => /rel="?next"?/.test(part));
}
