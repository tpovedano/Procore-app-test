/**
 * Contexto de Procore para apps de Side Panel (docs "Building Embedded Applications"):
 * la app envía { type: 'initialize' } al padre y Procore responde con
 * { type: 'setup', context: { company_id, project_id, id, view } }.
 * Lógica pura de validación aquí; el listener vive en hooks/useProcoreContext.ts.
 */

export interface ProcoreContext {
  companyId: string;
  projectId: string;
  view: string | null;
  resourceId: string | null;
  source: 'postMessage' | 'url';
}

/** Solo se aceptan mensajes / embebido desde dominios https de Procore (incluye regiones y sandbox). */
const PROCORE_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*procore\.com$/;

export function isProcoreOrigin(origin: string | null | undefined): boolean {
  return typeof origin === 'string' && PROCORE_ORIGIN.test(origin);
}

const NUMERIC_ID = /^\d{1,19}$/;

function asId(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && NUMERIC_ID.test(v)) return v;
  return null;
}

/** Valida un mensaje "setup" de Procore. Devuelve null si no es válido. */
export function parseSetupMessage(origin: string, data: unknown): ProcoreContext | null {
  if (!isProcoreOrigin(origin)) return null;
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'setup' || typeof d.context !== 'object' || d.context === null) return null;
  const c = d.context as Record<string, unknown>;
  const companyId = asId(c.company_id);
  const projectId = asId(c.project_id);
  if (!companyId || !projectId) return null;
  return {
    companyId,
    projectId,
    view: typeof c.view === 'string' ? c.view.slice(0, 200) : null,
    resourceId: asId(c.id),
    source: 'postMessage',
  };
}

/**
 * Alternativa documentada ("URL Parameter Interpolation"): configurar la URL del
 * componente como ?companyId={{procore.company.id}}&projectId={{procore.project.id}}.
 */
export function parseContextFromUrl(search: string): ProcoreContext | null {
  const p = new URLSearchParams(search);
  const companyId = asId(p.get('companyId') ?? p.get('company_id'));
  const projectId = asId(p.get('projectId') ?? p.get('project_id'));
  if (!companyId || !projectId) return null;
  return { companyId, projectId, view: null, resourceId: null, source: 'url' };
}

/** Origen del padre (Procore) a partir de document.referrer, si es de Procore. */
export function parentOriginFromReferrer(referrer: string): string | null {
  try {
    const origin = new URL(referrer).origin;
    return isProcoreOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}
