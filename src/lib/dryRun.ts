/**
 * Modo dry-run (DRY_RUN=true): no se llama a Procore. Se registran las peticiones
 * que se enviarían y se devuelven respuestas simuladas coherentes con la
 * referencia de Procore, de modo que el flujo completo puede recorrerse y revisarse.
 */
import { addMonthsIso, todayIso } from './dates.js';
import type { ApiRequest, ApiResponse, Transport } from './procore.js';

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

interface SimTemplate {
  sections: { id: number; name: string }[];
  items: { id: number; name: string; section_id: number }[];
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

  // Estado simulado: plantillas (compañía y proyecto) e inspecciones.
  const companyTemplates = new Map<string, SimTemplate>();
  const projectTemplates = new Map<string, SimTemplate>();
  const lists = new Map<string, { sections: { id: number; name: string }[]; items: { id: number; name: string; section_id: number }[] }>();

  const ok = (data: unknown, status = 200): ApiResponse => ({ status, data, link: null });
  const id = () => nextId++;

  return async (req: ApiRequest): Promise<ApiResponse> => {
    const entry: DryRunEntry = { seq: ++seq, method: req.method, path: req.path, query: req.query, body: req.body };
    opts.onRequest?.(entry);
    console.info(`[DRY-RUN] ${req.method} ${req.path}`, req.query ?? '', req.body ?? '');

    const p = req.path;
    const body = (req.body ?? {}) as Record<string, any>;
    let m: RegExpExecArray | null;

    if (req.method === 'GET') {
      if (p === '/rest/v1.0/me') return ok({ id: 0, name: 'Usuario (simulado)', login: 'dry-run@example.com' });
      if (/^\/rest\/v1\.0\/projects\/\d+$/.test(p)) return ok({ ...project, id: Number(p.split('/').pop()) });
      if (p === '/rest/v1.0/checklist/item_types') {
        return ok([
          { id: 1, name: 'Número', type: 'number' },
          { id: 2, name: 'Texto', type: 'text' },
        ]);
      }
      if ((m = /companies\/\d+\/checklist\/list_templates\/(\d+)\/sections$/.exec(p))) {
        return ok(companyTemplates.get(m[1]!)?.sections ?? []);
      }
      if ((m = /companies\/\d+\/inspection_templates\/(\d+)\/items$/.exec(p))) {
        return ok(companyTemplates.get(m[1]!)?.items ?? []);
      }
      if (/\/checklist\/list_items$/.test(p)) return ok(lists.get(String(req.query?.['filters[list_id]']))?.items ?? []);
      if (/\/checklist\/list_sections$/.test(p)) return ok(lists.get(String(req.query?.['filters[list_id]']))?.sections ?? []);
      return ok([]); // colecciones vacías → sin duplicados
    }

    if (req.method === 'DELETE') return ok({});

    if (/companies\/\d+\/checklist\/list_templates$/.test(p)) {
      const tid = id();
      companyTemplates.set(String(tid), { sections: [], items: [] });
      return ok({ id: tid, name: body.list_template?.name }, 201);
    }
    if ((m = /companies\/\d+\/checklist\/list_templates\/(\d+)\/sections$/.exec(p))) {
      const s = { id: id(), name: body.section?.name ?? '' };
      companyTemplates.get(m[1]!)?.sections.push(s);
      return ok(s, 201);
    }
    if ((m = /companies\/\d+\/inspection_templates\/(\d+)\/items$/.exec(p))) {
      const f = body.inspection_template_item ?? {};
      const it = { id: id(), name: f.name ?? '', section_id: Number(f.section_id) };
      companyTemplates.get(m[1]!)?.items.push(it);
      return ok(it, 201);
    }
    if (/\/checklist\/list_templates\/create_from_company_template$/.test(p)) {
      const tid = id();
      const src = companyTemplates.get(String(body.source_template_id));
      projectTemplates.set(String(tid), structuredClone(src ?? { sections: [], items: [] }));
      return ok({ id: tid }, 201);
    }
    if (/projects\/\d+\/checklist\/lists$/.test(p)) {
      const lid = id();
      const tpl = projectTemplates.get(String(body.list_template_id)) ?? { sections: [], items: [] };
      // Al crear la inspección, Procore genera sus propias secciones e ítems a partir de la plantilla.
      const secMap = new Map<number, number>();
      const sections = tpl.sections.map((s) => {
        const nid = id();
        secMap.set(s.id, nid);
        return { id: nid, name: s.name };
      });
      const items = tpl.items.map((i) => ({ id: id(), name: i.name, section_id: secMap.get(i.section_id) ?? 0 }));
      lists.set(String(lid), { sections, items });
      return ok({ id: lid }, 201);
    }
    return ok({ id: id(), ...body }, 201);
  };
}
