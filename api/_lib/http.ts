/** Utilidades HTTP comunes a las funciones: JSON, cabeceras de seguridad, CORS y cookies. */

const PROCORE_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*procore\.com$/;

export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

/**
 * CORS restringido: el frontend llama a /api desde su propio origen (no necesita CORS);
 * solo se refleja el origen si es de Procore. Cualquier otro origen no recibe cabeceras CORS.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (origin && PROCORE_ORIGIN.test(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Session',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }
  return { Vary: 'Origin' };
}

/** Rechaza peticiones con un Origin que no sea el propio ni de Procore. */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // navegación directa / server-to-server
  if (PROCORE_ORIGIN.test(origin)) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function json(request: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...corsHeaders(request), ...extra },
  });
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...corsHeaders(request) } });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, ...SECURITY_HEADERS });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function isLocalhost(request: Request): boolean {
  try {
    const h = new URL(request.url).hostname;
    return h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

export function cookie(
  request: Request,
  name: string,
  value: string,
  opts: { maxAge: number; path: string },
): string {
  const secure = isLocalhost(request) ? '' : '; Secure';
  return `${name}=${encodeURIComponent(value)}; Path=${opts.path}; Max-Age=${opts.maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** Lee el cuerpo JSON con límite de tamaño. */
export async function readJson(request: Request, maxBytes = 100_000): Promise<unknown> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new Error('payload-too-large');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('payload-too-large');
  return text ? JSON.parse(text) : null;
}
