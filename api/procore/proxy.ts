/**
 * POST /api/procore/proxy → única puerta del navegador a la API de Procore.
 *  - Solo rutas de la allowlist (procoreSpec.PROXY_ALLOWLIST) con ids numéricos.
 *  - El token sale de la sesión cifrada (cabecera X-App-Session); se refresca si caduca.
 *  - Añade Procore-Company-Id y aplica reintentos con backoff (429/503).
 */
import { isAllowedRequest, type HttpMethod } from '../../src/lib/procoreSpec.js';
import { getConfig, isDryRun, type ServerConfig } from '../_lib/env.js';
import { isAllowedOrigin, json, preflight, readJson } from '../_lib/http.js';
import { callProcore, parseProcoreResponse, refreshAccessToken } from '../_lib/procoreServer.js';
import { seal, unseal, type SessionData } from '../_lib/session.js';

const METHODS = new Set<HttpMethod>(['GET', 'POST', 'PATCH']);
const QUERY_KEY = /^[a-z_]{1,40}$/;

interface ProxyBody {
  method: HttpMethod;
  path: string;
  query: Record<string, string | number>;
  body?: unknown;
  companyId: string;
}

function validate(raw: unknown): ProxyBody | string {
  if (typeof raw !== 'object' || raw === null) return 'Cuerpo inválido.';
  const r = raw as Record<string, unknown>;
  if (typeof r.method !== 'string' || !METHODS.has(r.method as HttpMethod)) return 'Método no permitido.';
  if (typeof r.path !== 'string' || !isAllowedRequest(r.method, r.path)) return 'Ruta no permitida.';
  if (typeof r.companyId !== 'string' || !/^\d{1,19}$/.test(r.companyId)) return 'company_id inválido.';
  const query: Record<string, string | number> = {};
  if (r.query !== undefined) {
    if (typeof r.query !== 'object' || r.query === null) return 'Query inválida.';
    for (const [k, v] of Object.entries(r.query)) {
      if (!QUERY_KEY.test(k)) return 'Parámetro de query no permitido.';
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string' || v.length > 200) {
        return 'Valor de query inválido.';
      }
      query[k] = v as string | number;
    }
  }
  if (r.method === 'GET' && r.body !== undefined) return 'GET no admite cuerpo.';
  return { method: r.method as HttpMethod, path: r.path, query, body: r.body, companyId: r.companyId };
}

async function refreshed(cfg: ServerConfig, s: SessionData): Promise<SessionData> {
  const t = await refreshAccessToken(cfg, s.rt);
  return { ...s, at: t.access_token, rt: t.refresh_token ?? s.rt, atExp: Date.now() + t.expires_in * 1000 };
}

export async function POST(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request)) return json(request, 403, { error: 'Origen no permitido.' });
  if (isDryRun()) return json(request, 409, { error: 'Modo dry-run activo: no se llama a Procore.' });

  let cfg: ServerConfig;
  try {
    cfg = getConfig();
  } catch {
    return json(request, 500, { error: 'Configuración del servidor incompleta.' });
  }

  const blob = request.headers.get('x-app-session');
  let session = blob ? unseal(blob, cfg.sessionSecret) : null;
  if (!session) return json(request, 401, { error: 'Sesión no válida o caducada. Vuelve a conectar con Procore.' });

  let parsed: ProxyBody | string;
  try {
    parsed = validate(await readJson(request));
  } catch {
    return json(request, 400, { error: 'Cuerpo JSON inválido o demasiado grande.' });
  }
  if (typeof parsed === 'string') return json(request, 400, { error: parsed });

  let renewed = false;
  try {
    if (session.atExp - 60_000 < Date.now()) {
      session = await refreshed(cfg, session);
      renewed = true;
    }
    let res = await callProcore(cfg, session.at, parsed);
    if (res.status === 401 && !renewed && session.rt) {
      session = await refreshed(cfg, session);
      renewed = true;
      res = await callProcore(cfg, session.at, parsed);
    }
    const out = await parseProcoreResponse(res);
    console.info(`[proxy] ${parsed.method} ${parsed.path} → ${res.status}`);
    // Una Response con 204/205/304 no admite cuerpo: se envuelve como 200.
    const status = [204, 205, 304].includes(res.status) ? 200 : res.status;
    return json(request, status, { ...out, ...(renewed ? { session: seal(session, cfg.sessionSecret) } : {}) });
  } catch (e) {
    console.error(`[proxy] ${parsed.method} ${parsed.path} → error`, e instanceof Error ? e.message : '');
    const status = typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : 502;
    return json(request, status === 401 ? 401 : 502, {
      error: status === 401 ? 'Sesión caducada. Vuelve a conectar con Procore.' : 'No se pudo contactar con Procore.',
    });
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
