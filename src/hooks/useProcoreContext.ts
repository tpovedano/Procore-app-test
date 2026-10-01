import { useEffect, useState } from 'react';
import {
  parentOriginFromReferrer,
  parseContextFromUrl,
  parseSetupMessage,
  type ProcoreContext,
} from '../lib/procoreContext';

export type ContextState =
  | { status: 'waiting' }
  | { status: 'ready'; context: ProcoreContext }
  | { status: 'missing' };

/** Tiempo máximo esperando el mensaje "setup" antes de usar la URL o dar error. */
const SETUP_TIMEOUT_MS = 2500;

/**
 * Obtiene company/project del panel lateral:
 * 1) postMessage "setup" de Procore (tras enviar "initialize" al origen del padre);
 * 2) si no llega, parámetros interpolados en la URL (companyId / projectId).
 */
export function useProcoreContext(): ContextState {
  const [state, setState] = useState<ContextState>({ status: 'waiting' });

  useEffect(() => {
    let settled = false;
    const onMessage = (event: MessageEvent) => {
      const ctx = parseSetupMessage(event.origin, event.data);
      if (ctx) {
        settled = true;
        setState({ status: 'ready', context: ctx });
      }
    };
    window.addEventListener('message', onMessage);

    const parentOrigin = parentOriginFromReferrer(document.referrer);
    if (parentOrigin && window.parent !== window) {
      window.parent.postMessage({ type: 'initialize' }, parentOrigin);
    }

    const timer = window.setTimeout(() => {
      if (settled) return;
      const fromUrl = parseContextFromUrl(window.location.search);
      setState(fromUrl ? { status: 'ready', context: fromUrl } : { status: 'missing' });
    }, parentOrigin ? SETUP_TIMEOUT_MS : 0);

    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
  }, []);

  return state;
}
