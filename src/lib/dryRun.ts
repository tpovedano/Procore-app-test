/**
 * Modo dry-run (DRY_RUN=true): no se llama a Procore. Se registran las peticiones
 * que se enviarían y se devuelven respuestas simuladas coherentes, de modo que
 * el flujo completo puede recorrerse y revisarse.
 */
import { addMonthsIso, todayIso } from './dates';
import type { ApiRequest, ApiResponse, Transport } from './procore';

export interface DryRunEntry {
  seq: number;
  method: string;
  path: string;
  query?: Record<string, string | number>;
  body?: unknown;
}

export interface DryRunOptions {
  onRequest?: (entry: DryRunEntry) => void;
  /** Proyecto simulado; por defecto con fecha fin dentro de un año. */
  project?: Record<string, unknown>;
  today?: string;
}

export function createDryRunTransport(opts: DryRunOptions = {}): Transport {
  let seq = 0;
  let nextId = 900_001;
  const today = opts.today ?? todayIso();
  const project = opts.project ?? {
    id: 0,
    name: 'Proyecto (simulado)',
    completion_date: addMonthsIso(today, 12),
  };

  // Estado simulado: plantillas → secciones → ítems; inspecciones → plantilla.
  const sectionsByTemplate = new Map<string, { id: string; name: string; items: { id: string; name: string }[] }[]>();
  const templateByList = new Map<string, string>();

  const ok = (data: unknown): ApiResponse => ({ status: 200, data, link: null });

  return async (req: ApiRequest): Promise<ApiResponse> => {
    const entry: DryRunEntry = { seq: ++seq, method: req.method, path: req.path, query: req.query, body: req.body };
    opts.onRequest?.(entry);
    console.info(`[DRY-RUN] ${req.method} ${req.path}`, req.query ?? '', req.body ?? '');

    const p = req.path;
    if (req.method === 'GET') {
      if (p === '/rest/v1.0/me') return ok({ id: 0, name: 'Usuario (simulado)', login: 'dry-run@example.com' });
      if (/^\/rest\/v1\.0\/projects\/\d+$/.test(p)) return ok({ ...project, id: Number(p.split('/').pop()) });
      const listMatch = /^\/rest\/v1\.0\/checklist\/lists\/(\d+)$/.exec(p);
      if (listMatch) {
        const tplId = templateByList.get(listMatch[1]!);
        const sections = (tplId && sectionsByTemplate.get(tplId)) || [];
        return ok({ id: Number(listMatch[1]), sections });
      }
      return ok([]); // colecciones vacías → sin duplicados
    }

    const id = String(nextId++);
    const body = (req.body ?? {}) as Record<string, any>;
    const secMatch = /list_templates\/(\d+)\/sections$/.exec(p);
    const itemMatch = /list_templates\/(\d+)\/sections\/(\d+)\/items$/.exec(p);
    if (/\/checklist\/list_templates$/.test(p)) sectionsByTemplate.set(id, []);
    else if (secMatch) sectionsByTemplate.get(secMatch[1]!)?.push({ id, name: body.section?.name ?? '', items: [] });
    else if (itemMatch) {
      const sec = sectionsByTemplate.get(itemMatch[1]!)?.find((s) => s.id === itemMatch[2]);
      sec?.items.push({ id, name: body.item?.name ?? '' });
    } else if (p === '/rest/v1.0/checklist/lists' && body.list_template_id != null) {
      templateByList.set(id, String(body.list_template_id));
    }
    return { status: 201, data: { id: Number(id), ...(body ?? {}) }, link: null };
  };
}
