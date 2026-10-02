/**
 * Transporte del navegador: envía cada petición al proxy serverless, que es el
 * único que ve el access token. La sesión llega cifrada (opaca para el cliente)
 * y solo vive en memoria.
 */
import { ProcoreApiError, type ApiRequest, type ApiResponse, type Transport } from './procore.js';

export interface ProxyTransportOptions {
  companyId: string;
  getSession: () => string | null;
  /** El servidor puede devolver una sesión renovada tras refrescar el token. */
  onSessionRenewed: (session: string) => void;
  onUnauthorized: () => void;
  fetchFn?: typeof fetch;
}

interface ProxyEnvelope {
  status: number;
  data: unknown;
  link?: string | null;
  session?: string;
  error?: string;
}

export function procoreErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.message === 'string') return d.message;
    if (typeof d.error === 'string') return d.error;
    if (d.errors) {
      if (typeof d.errors === 'string') return d.errors;
      try {
        return JSON.stringify(d.errors).slice(0, 300);
      } catch {
        /* ignorar */
      }
    }
  }
  return `Error HTTP ${status}`;
}

export function createProxyTransport(opts: ProxyTransportOptions): Transport {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  return async (req: ApiRequest): Promise<ApiResponse> => {
    const session = opts.getSession();
    if (!session) {
      opts.onUnauthorized();
      throw new ProcoreApiError('No hay sesión con Procore.', 401);
    }
    const res = await fetchFn('/api/procore/proxy', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-App-Session': session },
      body: JSON.stringify({ ...req, companyId: opts.companyId }),
    });
    let env: ProxyEnvelope;
    try {
      env = (await res.json()) as ProxyEnvelope;
    } catch {
      throw new ProcoreApiError(`Respuesta no válida del servidor (${res.status}).`, res.status);
    }
    if (env.session) opts.onSessionRenewed(env.session);
    if (res.status === 401) opts.onUnauthorized();
    if (!res.ok) {
      throw new ProcoreApiError(env.error ?? procoreErrorMessage(env.data, res.status), res.status, env.data);
    }
    return { status: env.status, data: env.data, link: env.link ?? null };
  };
}
