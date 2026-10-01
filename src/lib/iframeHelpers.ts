/**
 * Envoltorio de @procore/procore-iframe-helpers (paquete UMD/CommonJS): normaliza
 * la interoperabilidad de módulos y tipa solo lo que usamos.
 */
import * as helpersModule from '@procore/procore-iframe-helpers';

interface AuthConfig {
  url: string;
  width?: number;
  height?: number;
  onSuccess: (payload: unknown) => void;
  onFailure: (error: unknown) => void;
}

export interface IframeContext {
  authentication: {
    authenticate: (config: AuthConfig) => void;
    notifySuccess: (payload: unknown, origin?: string) => void;
    notifyFailure: (payload: unknown, origin?: string) => void;
  };
}

type HelpersModule = { initialize: () => IframeContext };

function resolveModule(): HelpersModule {
  const m = helpersModule as unknown as Partial<HelpersModule> & { default?: Partial<HelpersModule> };
  const initialize = m.initialize ?? m.default?.initialize;
  if (typeof initialize !== 'function') throw new Error('No se pudo cargar procore-iframe-helpers.');
  return { initialize };
}

let ctx: IframeContext | null = null;
export function getIframeContext(): IframeContext {
  ctx ??= resolveModule().initialize();
  return ctx;
}
