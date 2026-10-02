/**
 * GET /api/auth/callback → Redirect URI registrada en el Developer Portal.
 * Valida `state`, intercambia el code por tokens (con client_secret, solo en
 * servidor) y entrega al iframe una sesión cifrada a través de la ventana
 * emergente (/auth-complete.html, en el fragmento #, que no se envía a servidores).
 */
import { getConfig } from '../_lib/env.js';
import { cookie, readCookie, redirect } from '../_lib/http.js';
import { exchangeCode } from '../_lib/procoreServer.js';
import { SESSION_TTL_MS, safeEqual, seal } from '../_lib/session.js';
import { STATE_COOKIE } from './login.js';

function done(request: Request, fragment: Record<string, string>): Response {
  const clear = cookie(request, STATE_COOKIE, '', { maxAge: 0, path: '/api/auth' });
  return redirect(`/auth-complete.html#${new URLSearchParams(fragment).toString()}`, [clear]);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(request, STATE_COOKIE);

  if (url.searchParams.get('error')) return done(request, { error: 'Acceso denegado en Procore.' });
  if (!code || !state || !expected || !safeEqual(state, expected)) {
    return done(request, { error: 'La solicitud de inicio de sesión no es válida o ha caducado.' });
  }

  try {
    const cfg = getConfig();
    const t = await exchangeCode(cfg, code);
    const now = Date.now();
    const session = seal(
      { at: t.access_token, rt: t.refresh_token ?? '', atExp: now + t.expires_in * 1000, exp: now + SESSION_TTL_MS },
      cfg.sessionSecret,
    );
    return done(request, { session });
  } catch {
    console.error('[auth] fallo al intercambiar el código OAuth');
    return done(request, { error: 'No se pudo completar el inicio de sesión con Procore.' });
  }
}
