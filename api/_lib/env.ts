/** Configuración del servidor. Los secretos solo se leen aquí (nunca llegan al cliente). */

export interface ServerConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  loginUrl: string;
  webBaseUrl: string;
  redirectUri: string;
  webhookSecret: string | undefined;
  sessionSecret: string;
  dryRun: boolean;
  environment: 'sandbox' | 'production';
}

export class ConfigError extends Error {}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

function httpsUrl(name: string, value: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new ConfigError(`${name} no es una URL válida.`);
  }
  if (u.protocol !== 'https:') throw new ConfigError(`${name} debe usar https.`);
  return trimSlash(u.origin);
}

export function isDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return clean(env.DRY_RUN).toLowerCase() === 'true';
}

/** Quita espacios, saltos de línea y comillas envolventes que suelen colarse al pegar valores en Vercel. */
function clean(v: string | undefined): string {
  return (v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

/** Lee y valida la configuración. `requireOAuth=false` permite arrancar en dry-run sin credenciales. */
export function getConfig(rawEnv: NodeJS.ProcessEnv = process.env, requireOAuth = true): ServerConfig {
  const env: Record<string, string> = {};
  for (const k of [
    'PROCORE_BASE_URL',
    'PROCORE_LOGIN_URL',
    'PROCORE_CLIENT_ID',
    'PROCORE_CLIENT_SECRET',
    'PROCORE_REDIRECT_URI',
    'SESSION_SECRET',
    'WEBHOOK_SECRET',
    'DRY_RUN',
  ]) {
    env[k] = clean(rawEnv[k]);
  }
  const baseUrl = httpsUrl('PROCORE_BASE_URL', env.PROCORE_BASE_URL || 'https://sandbox.procore.com');
  const environment = /sandbox/.test(baseUrl) ? 'sandbox' : 'production';
  const loginUrl = env.PROCORE_LOGIN_URL
    ? httpsUrl('PROCORE_LOGIN_URL', env.PROCORE_LOGIN_URL)
    : environment === 'sandbox'
      ? 'https://login-sandbox.procore.com'
      : 'https://login.procore.com';
  // La web de producción es app.procore.com; en sandbox, API y web comparten dominio.
  const webBaseUrl = baseUrl === 'https://api.procore.com' ? 'https://app.procore.com' : baseUrl;

  const clientId = env.PROCORE_CLIENT_ID ?? '';
  const clientSecret = env.PROCORE_CLIENT_SECRET ?? '';
  const redirectUri = env.PROCORE_REDIRECT_URI ?? '';
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (requireOAuth && /\s/.test(clientId)) throw new ConfigError('PROCORE_CLIENT_ID contiene espacios: cópialo de nuevo del Developer Portal.');

  if (requireOAuth) {
    const missing = [
      !clientId && 'PROCORE_CLIENT_ID',
      !clientSecret && 'PROCORE_CLIENT_SECRET',
      !redirectUri && 'PROCORE_REDIRECT_URI',
    ].filter(Boolean);
    if (missing.length) throw new ConfigError(`Faltan variables de entorno: ${missing.join(', ')}`);
    if (sessionSecret.length < 32) throw new ConfigError('SESSION_SECRET debe tener al menos 32 caracteres.');
  }

  return {
    clientId,
    clientSecret,
    baseUrl,
    loginUrl,
    webBaseUrl,
    redirectUri,
    webhookSecret: env.WEBHOOK_SECRET || undefined,
    sessionSecret,
    dryRun: isDryRun(rawEnv),
    environment,
  };
}
