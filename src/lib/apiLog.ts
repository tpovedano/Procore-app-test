/**
 * Registro técnico de llamadas a Procore (solo en memoria, se borra en cada
 * ejecución). Sirve para diagnosticar formatos de la API: guarda método, ruta,
 * cuerpo enviado, estado y respuesta. Nunca contiene tokens: viajan cifrados
 * en una cabecera que este registro no ve.
 */
import { ProcoreApiError, type ApiRequest, type Transport } from './procore.js';

export interface ApiLogEntry {
  seq: number;
  method: string;
  path: string;
  query?: Record<string, string | number>;
  body?: unknown;
  status?: number;
  response?: unknown;
  error?: string;
  ms?: number;
}

const MAX_RESPONSE_CHARS = 4000;

/** Recorta respuestas grandes (p. ej. listados) para que el registro sea manejable. */
export function truncateForLog(value: unknown): unknown {
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return '[no serializable]';
  }
  if (text.length <= MAX_RESPONSE_CHARS) return value;
  if (Array.isArray(value)) {
    return { _truncado: true, total: value.length, primeros: value.slice(0, 3) };
  }
  return `${text.slice(0, MAX_RESPONSE_CHARS)}… [recortado]`;
}

export function withLogging(transport: Transport, onEntry: (e: ApiLogEntry) => void): Transport {
  let seq = 0;
  return async (req: ApiRequest) => {
    const base = { seq: ++seq, method: req.method, path: req.path, query: req.query, body: req.body };
    const t0 = Date.now();
    try {
      const res = await transport(req);
      onEntry({ ...base, status: res.status, response: truncateForLog(res.data), ms: Date.now() - t0 });
      return res;
    } catch (e) {
      onEntry({
        ...base,
        status: e instanceof ProcoreApiError ? e.status : undefined,
        response: e instanceof ProcoreApiError ? truncateForLog(e.details) : undefined,
        error: e instanceof Error ? e.message : String(e),
        ms: Date.now() - t0,
      });
      throw e;
    }
  };
}

/** Texto para copiar y compartir. */
export function formatLog(entries: ApiLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}
