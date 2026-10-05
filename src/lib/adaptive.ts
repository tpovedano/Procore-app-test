/**
 * Descubrimiento de rutas y formatos de la API de Procore.
 *
 * Varias rutas y cuerpos de Inspections no se han podido verificar contra la
 * referencia (ver procoreSpec.CANDIDATES). Estas utilidades prueban candidatas
 * en orden y se quedan con la primera que Procore acepta:
 *  - GET para localizar una colección (sin efectos secundarios);
 *  - POST con variantes de cuerpo: 404 → siguiente ruta, 400/422 → siguiente cuerpo.
 * Un 404/400/422 en un POST no crea nada, así que probar es seguro.
 */
import { ProcoreApiError, type ProcoreClient } from './procore.js';
import type { Candidate } from './procoreSpec.js';

export interface ProbeOutcome {
  candidate: Candidate;
  status: number | null;
}

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly tried: ProbeOutcome[],
  ) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

export function describeTried(tried: ProbeOutcome[]): string {
  return tried.map((t) => `${t.candidate.path} → ${t.status ?? 'error de red'}`).join('; ');
}

const isOk = (s: number | null) => s !== null && s >= 200 && s < 300;

/** GET sin lanzar excepción: devuelve estado y datos. Un 401 sí se propaga (sesión caducada). */
export async function probe(client: ProcoreClient, c: Candidate): Promise<{ status: number | null; data?: unknown }> {
  try {
    const r = await client.getAt(c);
    return { status: r.status, data: r.data };
  } catch (e) {
    if (e instanceof ProcoreApiError && e.status === 401) throw e;
    return { status: e instanceof ProcoreApiError ? e.status : null };
  }
}

/**
 * Primera candidata cuyo GET responde 2xx. Si ninguna responde, espera y
 * reintenta (el objeto recién creado puede tardar en ser visible).
 */
export async function findFirst(
  client: ProcoreClient,
  candidates: Candidate[],
  sleep: (ms: number) => Promise<void>,
  delays: readonly number[],
): Promise<{ candidate: Candidate; data: unknown }> {
  let tried: ProbeOutcome[] = [];
  for (let attempt = 0; ; attempt++) {
    tried = [];
    for (const c of candidates) {
      const r = await probe(client, c);
      tried.push({ candidate: c, status: r.status });
      if (isOk(r.status)) return { candidate: c, data: r.data };
    }
    if (attempt >= delays.length) break;
    await sleep(delays[attempt]!);
  }
  throw new DiscoveryError(`Ninguna ruta candidata respondió: ${describeTried(tried)}`, tried);
}

export interface PostOutcome {
  data: unknown;
  candidate: Candidate;
  bodyIndex: number;
}

/**
 * POST probando rutas y variantes de cuerpo en orden.
 * 404 → siguiente ruta · 400/422 → siguiente variante de cuerpo · otro error → se propaga.
 * Si todas fallan, se lanza el error más informativo (el último 4xx de validación, si hubo).
 */
export async function postFirstAccepted(
  client: ProcoreClient,
  candidates: Candidate[],
  bodies: unknown[],
): Promise<PostOutcome> {
  let validationError: ProcoreApiError | null = null;
  let notFound: ProcoreApiError | null = null;
  for (const candidate of candidates) {
    for (const [bodyIndex, body] of bodies.entries()) {
      try {
        const data = await client.postAt(candidate, body);
        return { data, candidate, bodyIndex };
      } catch (e) {
        if (!(e instanceof ProcoreApiError)) throw e;
        if (e.status === 404) {
          notFound = e;
          break; // la ruta no existe: no tiene sentido probar otros cuerpos
        }
        if (e.status === 400 || e.status === 422) {
          validationError = e;
          continue;
        }
        throw e;
      }
    }
  }
  throw validationError ?? notFound ?? new Error('No hay rutas candidatas.');
}

/** Reordena para probar primero lo que ya funcionó en una llamada anterior. */
export function preferFirst<T>(list: T[], preferredIndex: number): { item: T; originalIndex: number }[] {
  const indexed = list.map((item, originalIndex) => ({ item, originalIndex }));
  if (preferredIndex <= 0 || preferredIndex >= list.length) return indexed;
  return [indexed[preferredIndex]!, ...indexed.filter((_, i) => i !== preferredIndex)];
}
