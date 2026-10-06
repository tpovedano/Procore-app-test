/**
 * Diagnóstico de API (solo lectura). Hace únicamente peticiones GET a endpoints
 * de la referencia de Procore para comprobar permisos y ver la forma real de las
 * respuestas (útil para los puntos TODO(verify) de procoreSpec.ts: tipos de ítem
 * y frecuencias de las planificadas).
 */
import { truncateForLog } from './apiLog.js';
import { ProcoreApiError, type ProcoreClient } from './procore.js';
import { asArray, extractId } from './procoreSpec.js';

export interface DiagnosticEntry {
  label: string;
  status: number | null;
  sample?: unknown;
  error?: string;
}

function firstOf(data: unknown): unknown {
  const arr = asArray(data);
  return arr.length ? arr[0] : data;
}

export async function runDiagnostics(
  client: ProcoreClient,
  companyId: string,
  projectId: string,
  onEntry?: (e: DiagnosticEntry) => void,
): Promise<DiagnosticEntry[]> {
  const out: DiagnosticEntry[] = [];

  const run = async <T,>(label: string, fn: () => Promise<T>, whole = false): Promise<T | undefined> => {
    let entry: DiagnosticEntry;
    let data: T | undefined;
    try {
      data = await fn();
      entry = { label, status: 200, sample: truncateForLog(whole ? data : firstOf(data)) };
    } catch (e) {
      if (e instanceof ProcoreApiError && e.status === 401) throw e;
      entry = {
        label,
        status: e instanceof ProcoreApiError ? e.status : null,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      };
    }
    out.push(entry);
    onEntry?.(entry);
    return data;
  };

  await run('Proyecto (Show project)', () => client.getProject(companyId, projectId));
  await run('Tipos de ítem (List Available Checklist Item Types)', () => client.listItemTypes(companyId), true);
  const companyTemplates = await run('Plantillas de compañía', () => client.listCompanyTemplates(companyId));
  const ctid = extractId(firstOf(companyTemplates));
  if (ctid) {
    await run('Secciones de plantilla de compañía', () => client.listCompanyTemplateSections(companyId, ctid));
    await run('Ítems de plantilla de compañía', () => client.listCompanyTemplateItems(companyId, ctid));
  }
  await run('Plantillas de proyecto', () => client.listProjectTemplates(projectId));
  const lists = await run('Inspecciones del proyecto', () => client.listChecklists(projectId));
  const lid = extractId(firstOf(lists));
  if (lid) {
    await run('Ítems de inspección', () => client.listChecklistItems(projectId, lid));
    await run('Secciones de inspección', () => client.listChecklistSections(projectId, lid));
  }
  // Ejemplo real de planificada: muestra el formato de `frequency` que usa la cuenta.
  await run('Inspecciones planificadas (frequency)', () => client.listSchedules(projectId));
  return out;
}
