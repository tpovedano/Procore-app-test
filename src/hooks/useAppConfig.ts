import { useEffect, useState } from 'react';

export interface AppConfig {
  dryRun: boolean;
  webBaseUrl: string;
  environment: 'sandbox' | 'production';
}

export type ConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: AppConfig }
  | { status: 'error'; message: string };

export function useAppConfig(): ConfigState {
  const [state, setState] = useState<ConfigState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/config', { credentials: 'same-origin' })
      .then(async (r) => {
        let data: Partial<AppConfig> & { error?: string };
        try {
          data = (await r.json()) as Partial<AppConfig> & { error?: string };
        } catch {
          // Respuesta no JSON: la función serverless falló antes de ejecutarse (revisa los logs de Vercel).
          throw new Error(`El servidor respondió con un error (${r.status}). Revisa los logs de las funciones en Vercel.`);
        }
        if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
        if (typeof data.webBaseUrl !== 'string') throw new Error('Configuración incompleta.');
        if (!cancelled) {
          setState({
            status: 'ready',
            config: { dryRun: Boolean(data.dryRun), webBaseUrl: data.webBaseUrl, environment: data.environment ?? 'sandbox' },
          });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: e instanceof Error ? e.message : 'No se pudo cargar la configuración.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
