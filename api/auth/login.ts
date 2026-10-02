/**
 * GET /api/auth/login → inicia el Authorization Code Grant.
 * Se abre en una ventana emergente (la página de login de Procore no se puede
 * mostrar dentro de un iframe), lanzada con @procore/procore-iframe-helpers.
 */
import { ConfigError, getConfig } from '../_lib/env.js';
import { cookie, json, redirect } from '../_lib/http.js';
import { randomState } from '../_lib/session.js';

export const STATE_COOKIE = 'procore_oauth_state';

export function GET(request: Request): Response {
  let cfg;
  try {
    cfg = getConfig();
  } catch (e) {
    return json(request, 500, { error: e instanceof ConfigError ? e.message : 'Configuración inválida.' });
  }
  const state = randomState();
  const url = new URL(`${cfg.loginUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('state', state);
  return redirect(url.toString(), [cookie(request, STATE_COOKIE, state, { maxAge: 600, path: '/api/auth' })]);
}
