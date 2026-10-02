/** GET /api/config → configuración pública (sin secretos) para el frontend. */
import { ConfigError, getConfig, isDryRun } from './_lib/env.js';
import { json, preflight } from './_lib/http.js';

export function GET(request: Request): Response {
  try {
    const cfg = getConfig(process.env, !isDryRun());
    // Versión desplegada (variable de sistema de Vercel) para saber qué commit está en producción.
    const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local';
    return json(request, 200, { dryRun: cfg.dryRun, webBaseUrl: cfg.webBaseUrl, environment: cfg.environment, version });
  } catch (e) {
    const message = e instanceof ConfigError ? e.message : 'Configuración del servidor inválida.';
    return json(request, 500, { error: message });
  }
}

export function OPTIONS(request: Request): Response {
  return preflight(request);
}
