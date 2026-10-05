import { useEffect, useState } from 'react';
import {
  initializeTargets,
  parentOriginFromReferrer,
  parseContextFromUrl,
  parseSetupMessage,
  type ProcoreContext,
} from '../lib/procoreContext';

/** Datos para diagnosticar por qué no llega el contexto (se muestran en pantalla). */
export interface ContextDiagnostics {
  framed: boolean;
  referrerOrigin: string | null;
  ancestorOrigin: string | null;
  initializeSentTo: string[];
  /** Orígenes de mensajes recibidos que no eran un "setup" válido de Procore. */
  ignoredMessageOrigins: string[];
}

export type ContextState =
  | { status: 'waiting' }
  | { status: 'ready'; context: ProcoreContext }
  | { status: 'missing'; diagnostics: ContextDiagnostics };

/** Tiempo máximo esperando el mensaje "setup" antes de usar la URL o dar error. */
const SETUP_TIMEOUT_MS = 4000;

function safeOrigin(url: string): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * Obtiene company/project:
 * 1) parámetros interpolados en la URL (companyId / projectId), p. ej. en el componente Full Screen;
 * 2) si no hay, postMessage "setup" de Procore (Side Panel), tras enviar "initialize" al padre.
 */
export function useProcoreContext(): ContextState {
  const [state, setState] = useState<ContextState>({ status: 'waiting' });

  useEffect(() => {
    // Componente Full Screen (o URL con parámetros interpolados por Procore): el
    // contexto ya viene en la URL, no hace falta esperar al mensaje "setup".
    const fromUrlNow = parseContextFromUrl(window.location.search);
    if (fromUrlNow) {
      setState({ status: 'ready', context: fromUrlNow });
      return;
    }
    let settled = false;
    const framed = window.parent !== window;
    const ancestors = Array.from(window.location.ancestorOrigins ?? []);
    const diagnostics: ContextDiagnostics = {
      framed,
      referrerOrigin: safeOrigin(document.referrer),
      ancestorOrigin: ancestors[0] ?? null,
      initializeSentTo: [],
      ignoredMessageOrigins: [],
    };

    const onMessage = (event: MessageEvent) => {
      const ctx = parseSetupMessage(event.origin, event.data);
      if (ctx) {
        settled = true;
        setState({ status: 'ready', context: ctx });
      } else if (!diagnostics.ignoredMessageOrigins.includes(event.origin)) {
        diagnostics.ignoredMessageOrigins.push(event.origin);
      }
    };
    window.addEventListener('message', onMessage);

    if (framed) {
      diagnostics.initializeSentTo = initializeTargets(document.referrer, ancestors);
      for (const origin of diagnostics.initializeSentTo) {
        window.parent.postMessage({ type: 'initialize' }, origin);
      }
    }

    const timer = window.setTimeout(
      () => {
        if (!settled) setState({ status: 'missing', diagnostics: { ...diagnostics } });
      },
      framed || parentOriginFromReferrer(document.referrer) ? SETUP_TIMEOUT_MS : 0,
    );

    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
  }, []);

  return state;
}
