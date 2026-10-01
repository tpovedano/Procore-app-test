/** Llamadas servidor → Procore: OAuth y peticiones REST con reintentos. Nunca se registran tokens. */
import { fetchWithRetry } from '../../src/lib/retry';
import { ProcoreApiError, type ApiRequest, type ApiResponse, type Transport } from '../../src/lib/procore';
import { procoreErrorMessage } from '../../src/lib/transport';
import type { ServerConfig } from './env';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  created_at?: number;
}

async function tokenRequest(cfg: ServerConfig, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params });
  const res = await fetchWithRetry(() =>
    fetch(`${cfg.loginUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    }),
  );
  if (!res.ok) {
    // No se incluye el cuerpo: podría contener datos sensibles.
    throw new ProcoreApiError(`Error de autenticación con Procore (${res.status}).`, res.status === 400 ? 401 : res.status);
  }
  const data = (await res.json()) as TokenResponse;
  if (typeof data.access_token !== 'string') throw new ProcoreApiError('Respuesta de token inválida.', 502);
  return data;
}

export function exchangeCode(cfg: ServerConfig, code: string): Promise<TokenResponse> {
  return tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri });
}

export function refreshAccessToken(cfg: ServerConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken, redirect_uri: cfg.redirectUri });
}

/** Client Credentials (requiere DMSA). Se usa en el webhook, donde no hay usuario. Caché solo en memoria. */
let ccCache: { token: string; exp: number } | null = null;
export async function clientCredentialsToken(cfg: ServerConfig): Promise<string> {
  if (ccCache && ccCache.exp - 60_000 > Date.now()) return ccCache.token;
  const t = await tokenRequest(cfg, { grant_type: 'client_credentials' });
  ccCache = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  return t.access_token;
}

export interface ProcoreCall extends ApiRequest {
  companyId: string;
}

/** Ejecuta una petición REST contra Procore con backoff ante 429/503. */
export async function callProcore(cfg: ServerConfig, accessToken: string, req: ProcoreCall): Promise<Response> {
  const url = new URL(cfg.baseUrl + req.path);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, String(v));
  const hasBody = req.method !== 'GET' && req.body !== undefined;
  return fetchWithRetry(() =>
    fetch(url, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Procore-Company-Id': req.companyId,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(req.body) : undefined,
    }),
  );
}

export async function parseProcoreResponse(res: Response): Promise<ApiResponse> {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 300) };
    }
  }
  return { status: res.status, data, link: res.headers.get('link') };
}

/** Transporte de servidor (para el webhook), con un token fijo. */
export function serverTransport(cfg: ServerConfig, accessToken: string, companyId: string): Transport {
  return async (req) => {
    const res = await callProcore(cfg, accessToken, { ...req, companyId });
    const parsed = await parseProcoreResponse(res);
    if (!res.ok) throw new ProcoreApiError(procoreErrorMessage(parsed.data, res.status), res.status, parsed.data);
    return parsed;
  };
}
