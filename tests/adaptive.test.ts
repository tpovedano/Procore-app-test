import { describe, expect, it } from 'vitest';
import { ProcoreApiError, createProcoreClient, type ApiRequest, type Transport } from '../src/lib/procore';
import { buildPlan } from '../src/lib/selection';
import { execute } from '../src/lib/workflow';
import { catalog } from './fixtures';

const notFound = () => new ProcoreApiError('Not Found', 404);
const invalid = (msg: string) => new ProcoreApiError(msg, 422);

/**
 * Procore simulado con rutas y formatos DISTINTOS de las primeras candidatas:
 * - secciones solo en /rest/v1.0/checklist/list_templates/{tid}/sections (3.ª candidata), cuerpo plano;
 * - ítems sin campo de tipo (rechaza item_type);
 * - inspecciones solo en /projects/{pid}/checklist/lists;
 * - respuestas solo en /checklist/items/{iid}/item_responses con cuerpo plano.
 */
function strangeProcore() {
  const calls: ApiRequest[] = [];
  let next = 100;
  const sections: { id: number; name: string; items: { id: number; name: string }[] }[] = [];
  const t: Transport = async (req) => {
    calls.push(req);
    const { method: m, path: p } = req;
    const body = (req.body ?? {}) as Record<string, any>;
    if (m === 'POST' && p === '/rest/v1.0/projects/20/checklist/list_templates') return { status: 201, data: { id: 77 } };
    if (p === '/rest/v1.0/checklist/list_templates/77/sections') {
      if (m === 'GET') return { status: 200, data: [] };
      if ('section' in body) throw invalid('param is missing or the value is empty: name');
      const s = { id: next++, name: body.name, items: [] };
      sections.push(s);
      return { status: 201, data: { id: s.id } };
    }
    const itemsMatch = /^\/rest\/v1\.0\/checklist\/list_templates\/77\/sections\/(\d+)\/items$/.exec(p);
    if (itemsMatch && m === 'POST') {
      const fields = body.item ?? body;
      if ('item_type' in fields) throw invalid('item_type is not a permitted parameter');
      if (!body.item) throw invalid('param is missing: item');
      const sec = sections.find((s) => s.id === Number(itemsMatch[1]))!;
      const it = { id: next++, name: fields.name };
      sec.items.push(it);
      return { status: 201, data: { id: it.id } };
    }
    if (p === '/rest/v1.0/projects/20/checklist/lists' && m === 'POST') return { status: 201, data: { id: 555 } };
    if (p === '/rest/v1.0/projects/20/checklist/lists/555' && m === 'GET') {
      return { status: 200, data: { id: 555, sections } };
    }
    if (/^\/rest\/v1\.0\/checklist\/items\/\d+\/item_responses$/.test(p) && m === 'POST') {
      if ('item_response' in body) throw invalid('unknown key item_response');
      return { status: 201, data: { id: next++ } };
    }
    if (m === 'POST' && p.endsWith('/checklist/schedules')) return { status: 201, data: { id: 900 } };
    throw notFound();
  };
  return { t, calls, sections };
}

describe('descubrimiento de rutas y formatos', () => {
  it('se adapta a rutas y cuerpos distintos y completa el flujo', async () => {
    const { t, calls, sections } = strangeProcore();
    const plan = buildPlan(catalog, { inc: '3', prot: 'Vigente', agua: '120' });
    if (!plan.ok) throw new Error('plan');
    const result = await execute({
      client: createProcoreClient(t),
      companyId: '10',
      projectId: '20',
      sections: plan.sections,
      prepared: { projectName: 'P', endDate: '2027-12-31', endDateField: 'completion_date', existing: {} },
      reuseExisting: false,
      webBase: 'https://sandbox.procore.com',
      today: '2026-10-05',
      sleep: async () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['warning', 'done', 'done', 'done']);
    expect(result.steps[0]!.detail).toMatch(/3 ítems sin tipo/);
    expect(sections.map((s) => [s.name, s.items.map((i) => i.name)])).toEqual([
      ['Seguridad', ['Incidentes (uds)', 'Protocolo']],
      ['Medio ambiente', ['Consumo de agua (m³)']],
    ]);
    const responses = calls.filter((c) => c.path.endsWith('/item_responses') && c.path.startsWith('/rest/v1.0/checklist/items/'));
    // 1.ª respuesta: prueba el cuerpo envuelto (rechazado) y luego el plano; las demás van directas.
    expect(responses.map((c) => c.body)).toEqual([
      { item_response: { number_value: 3 } },
      { number_value: 3 },
      { text_value: 'Vigente' },
      { number_value: 120 },
    ]);

    // Lo aprendido se reutiliza: la 2.ª sección va directa con cuerpo plano.
    const sectionPosts = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/sections'));
    expect(sectionPosts.map((c) => 'section' in (c.body as object))).toEqual([true, false, false]);
  });

  it('si ninguna ruta de secciones existe, lo explica y borra la plantilla', async () => {
    const calls: ApiRequest[] = [];
    const t: Transport = async (req) => {
      calls.push(req);
      if (req.method === 'POST' && req.path.endsWith('/checklist/list_templates')) return { status: 201, data: { id: 5 } };
      if (req.method === 'DELETE') return { status: 200, data: {} };
      throw notFound();
    };
    const plan = buildPlan(catalog, { inc: '1' });
    if (!plan.ok) throw new Error('plan');
    const result = await execute({
      client: createProcoreClient(t),
      companyId: '10',
      projectId: '20',
      sections: plan.sections,
      prepared: { projectName: 'P', endDate: '2027-12-31', endDateField: 'completion_date', existing: {} },
      reuseExisting: false,
      webBase: 'https://sandbox.procore.com',
      today: '2026-10-05',
      sleep: async () => {},
    });
    expect(result.ok).toBe(false);
    expect(result.steps[0]!.detail).toMatch(/No se encontró la ruta de la API.*companies\/10.*404/);
    expect(result.summary.join(' ')).toMatch(/se eliminó automáticamente/);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});

describe('diagnóstico de API', () => {
  it('solo hace peticiones GET y sigue con la siguiente ruta si una falla', async () => {
    const { runDiagnostics } = await import('../src/lib/diagnostics');
    const calls: ApiRequest[] = [];
    const t: Transport = async (req) => {
      calls.push(req);
      if (req.path === '/rest/v1.0/projects/20/checklist/list_templates') return { status: 200, data: [{ id: 1, name: 'T' }] };
      if (req.path === '/rest/v1.0/companies/10/checklist/list_templates/1/sections') {
        return { status: 200, data: [{ id: 7, name: 'S' }] };
      }
      if (req.path === '/rest/v1.0/checklist/lists') return { status: 200, data: [{ id: 3, name: 'L' }] };
      throw notFound();
    };
    const entries = await runDiagnostics(createProcoreClient(t), '10', '20');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(entries.find((e) => e.path.endsWith('/sections/7/items'))).toBeDefined();
    expect(entries.find((e) => e.path === '/rest/v1.0/checklist/lists/3')?.status).toBe(404);
    expect(entries.length).toBeGreaterThan(8);
  });
});
