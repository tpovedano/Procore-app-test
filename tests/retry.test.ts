import { describe, expect, it, vi } from 'vitest';
import { computeRetryDelay, fetchWithRetry, hasNextPage } from '../src/lib/retry';

const h = (o: Record<string, string>) => new Headers(o);

describe('backoff', () => {
  it('429 espera hasta X-Rate-Limit-Reset', () => {
    const now = () => 1_000_000;
    expect(computeRetryDelay(0, 429, h({ 'x-rate-limit-reset': '1005' }), { now })).toBe(5250);
  });

  it('503 respeta Retry-After', () => {
    expect(computeRetryDelay(0, 503, h({ 'retry-after': '3' }))).toBe(3000);
  });

  it('exponencial con jitter y tope', () => {
    const d = computeRetryDelay(3, 502, null, { baseDelayMs: 100, random: () => 1 });
    expect(d).toBe(800);
    expect(computeRetryDelay(20, 502, null, { maxDelayMs: 1000, random: () => 1 })).toBe(1000);
  });

  it('reintenta 429 y devuelve el primer éxito', async () => {
    const sleep = vi.fn(async () => {});
    const responses = [new Response('', { status: 429 }), new Response('', { status: 503 }), new Response('ok')];
    const res = await fetchWithRetry(async () => responses.shift()!, { sleep, random: () => 0 });
    expect(res.status).toBe(200);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('no reintenta 4xx no transitorios', async () => {
    const fn = vi.fn(async () => new Response('', { status: 422 }));
    const res = await fetchWithRetry(fn, { sleep: async () => {} });
    expect(res.status).toBe(422);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras maxRetries', async () => {
    const fn = vi.fn(async () => new Response('', { status: 429 }));
    const res = await fetchWithRetry(fn, { maxRetries: 2, sleep: async () => {}, random: () => 0 });
    expect(res.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('paginación', () => {
  it('detecta rel="next" en Link', () => {
    expect(hasNextPage('<https://x?page=2>; rel="next", <https://x?page=5>; rel="last"')).toBe(true);
    expect(hasNextPage('<https://x?page=1>; rel="first", <https://x?page=4>; rel="prev"')).toBe(false);
    expect(hasNextPage(null)).toBe(false);
  });
});
