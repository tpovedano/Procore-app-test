/**
 * Diagnóstico de API (solo lectura). Hace únicamente peticiones GET para saber
 * qué rutas de Inspections existen en la cuenta y con qué forma responden.
 * El informe resultante sirve para fijar rutas y campos en procoreSpec.ts.
 */
import { truncateForLog } from './apiLog.js';
import type { ProcoreClient } from './procore.js';
import { ProcoreApiError } from './procore.js';
import { CANDIDATES, extractId, type Candidate } from './procoreSpec.js';

export interface DiagnosticEntry {
  label: string;
  path: string;
  query?: Record<string, string | number>;
  status: number | null;
  sample?: unknown;
}

function firstOf(data: unknown): unknown {
  if (Array.isArray(data)) return data[0];
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: unknown[] }).data[0];
  }
  return data;
}

/** Primera sección / ítem de un objeto que los traiga anidados. */
function nested(obj: unknown, key: 'sections' | 'items'): unknown[] {
  if (!obj || typeof obj !== 'object') return [];
  const v = (obj as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

export async function runDiagnostics(
  client: ProcoreClient,
  companyId: string,
  projectId: string,
  onEntry?: (e: DiagnosticEntry) => void,
): Promise<DiagnosticEntry[]> {
  const out: DiagnosticEntry[] = [];

  const get = async (label: string, c: Candidate): Promise<unknown | undefined> => {
    let status: number | null = null;
    let data: unknown;
    try {
      const r = await client.getAt(c);
      status = r.status;
      data = r.data;
    } catch (e) {
      status = e instanceof ProcoreApiError ? e.status : null;
      if (e instanceof ProcoreApiError && e.status === 401) throw e;
    }
    const entry: DiagnosticEntry = { label, path: c.path, query: c.query, status, sample: truncateForLog(firstOf(data)) };
    out.push(entry);
    onEntry?.(entry);
    return status !== null && status >= 200 && status < 300 ? data : undefined;
  };

  const pid = projectId;
  const cid = companyId;

  // 1) Plantillas de proyecto y de compañía.
  const projectTemplates = await get('Plantillas de proyecto', {
    path: `/rest/v1.0/projects/${pid}/checklist/list_templates`,
    query: { per_page: 5 },
  });
  const companyTemplates = await get('Plantillas de compañía', {
    path: `/rest/v1.0/companies/${cid}/checklist/list_templates`,
    query: { per_page: 5 },
  });

  // 2) Detalle y secciones de una plantilla de proyecto y de una de compañía.
  for (const [kind, list] of [
    ['proyecto', projectTemplates],
    ['compañía', companyTemplates],
  ] as const) {
    const tid = extractId(firstOf(list));
    if (!tid) continue;
    const showPath =
      kind === 'proyecto'
        ? `/rest/v1.0/projects/${pid}/checklist/list_templates/${tid}`
        : `/rest/v1.0/companies/${cid}/checklist/list_templates/${tid}`;
    const shown = await get(`Detalle de plantilla de ${kind}`, { path: showPath });
    let sectionId = extractId(nested(shown, 'sections')[0]);
    let sectionsRoot: Candidate | null = null;
    for (const c of CANDIDATES.templateSections(cid, pid, tid)) {
      const data = await get(`Secciones de plantilla de ${kind}`, c);
      if (data !== undefined && !sectionsRoot) {
        sectionsRoot = c;
        sectionId ??= extractId(firstOf(data));
      }
    }
    if (sectionsRoot && sectionId) {
      for (const c of CANDIDATES.templateItems(sectionsRoot, sectionId)) {
        await get(`Ítems de sección de plantilla de ${kind}`, c);
      }
    }
  }

  // 3) Inspecciones: listado, detalle e ítems.
  const lists = await get('Inspecciones del proyecto', {
    path: '/rest/v1.0/checklist/lists',
    query: { project_id: pid, per_page: 5 },
  });
  const lid = extractId(firstOf(lists));
  if (lid) {
    for (const c of CANDIDATES.checklistShow(pid, lid)) await get('Detalle de inspección', c);
    for (const c of CANDIDATES.checklistItems(pid, lid)) await get('Ítems de inspección', c);
  }

  // 4) Planificadas y posibles catálogos de tipos de respuesta.
  await get('Inspecciones planificadas', { path: `/rest/v1.0/projects/${pid}/checklist/schedules`, query: { per_page: 5 } });
  await get('Tipos de ítem (candidata)', { path: `/rest/v1.0/companies/${cid}/checklist/item_types` });
  await get('Conjuntos de respuesta (candidata)', { path: `/rest/v1.0/companies/${cid}/checklist/response_sets` });

  return out;
}
