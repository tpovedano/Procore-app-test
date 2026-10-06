import { describe, expect, it } from 'vitest';
import { createDryRunTransport, type DryRunEntry } from '../src/lib/dryRun';
import { ProcoreApiError, createProcoreClient, type ApiRequest, type ApiResponse, type Transport } from '../src/lib/procore';
import { INSPECTION_NAME, SCHEDULE_NAME, TEMPLATE_NAME } from '../src/lib/procoreSpec';
import { buildPlan, type PlannedSection } from '../src/lib/selection';
import { PreconditionError, execute, hasExisting, prepare } from '../src/lib/workflow';
import { catalog } from './fixtures';

const TODAY = '2026-10-06';
const WEB = 'https://app.procore.com';
const noSleep = async () => {};

function plan(sel: Record<string, string>): PlannedSection[] {
  const p = buildPlan(catalog, sel);
  if (!p.ok) throw new Error('plan inválido');
  return p.sections;
}

function dry(project?: Record<string, unknown>) {
  const log: DryRunEntry[] = [];
  const client = createProcoreClient(createDryRunTransport({ onRequest: (e) => log.push(e), project, today: TODAY }));
  return { client, log };
}

const preparedFresh = { projectName: 'P', endDate: '2027-12-31', endDateField: 'completion_date', existing: {} };

describe('flujo completo (dry-run, endpoints de la referencia)', () => {
  it('plantilla de compañía → secciones → ítems → copia a proyecto → inspección → valores → planificada', async () => {
    const { client, log } = dry({ id: 1, name: 'P', completion_date: '2027-12-31' });
    const prepared = await prepare(client, '10', '20', TODAY);
    expect(prepared.endDate).toBe('2027-12-31');
    expect(hasExisting(prepared.existing)).toBe(false);

    const sections = plan({ inc: '2', prot: 'Vigente', agua: '150' });
    const result = await execute({ client, companyId: '10', projectId: '20', sections, prepared, reuseExisting: false, webBase: WEB, today: TODAY, sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);

    const writes = log.filter((e) => e.method !== 'GET').map((e) => `${e.method} ${e.path.replace(/\d{6,}/g, ':id')}`);
    expect(writes).toEqual([
      'POST /rest/v1.0/companies/10/checklist/list_templates',
      'POST /rest/v1.0/companies/10/checklist/list_templates/:id/sections',
      'POST /rest/v1.0/companies/10/inspection_templates/:id/items',
      'POST /rest/v1.0/companies/10/inspection_templates/:id/items',
      'POST /rest/v1.0/companies/10/checklist/list_templates/:id/sections',
      'POST /rest/v1.0/companies/10/inspection_templates/:id/items',
      'POST /rest/v1.0/projects/20/checklist/list_templates/create_from_company_template',
      'DELETE /rest/v1.0/companies/10/checklist/list_templates/:id',
      'POST /rest/v1.0/projects/20/checklist/lists',
      'POST /rest/v1.0/projects/20/checklist/items/:id/item_response',
      'POST /rest/v1.0/projects/20/checklist/items/:id/item_response',
      'POST /rest/v1.0/projects/20/checklist/items/:id/item_response',
      'POST /rest/v1.0/projects/20/checklist/schedules',
    ]);

    const posts = log.filter((e) => e.method === 'POST');
    expect(posts.filter((e) => e.path.endsWith('/sections')).map((e) => (e.body as any).section.name)).toEqual([
      'Seguridad',
      'Medio ambiente',
    ]);
    const items = posts.filter((e) => e.path.endsWith('/items')).map((e) => (e.body as any).inspection_template_item);
    expect(items.map((i) => [i.name, i.type])).toEqual([
      ['Incidentes (uds)', 'number'],
      ['Protocolo', 'text'],
      ['Consumo de agua (m³)', 'number'],
    ]);
    expect(items.every((i) => typeof i.section_id === 'number')).toBe(true);

    const copy = posts.find((e) => e.path.endsWith('/create_from_company_template'))!;
    const companyTemplateId = (copy.body as any).source_template_id;
    expect(log.find((e) => e.method === 'DELETE')!.path).toBe(`/rest/v1.0/companies/10/checklist/list_templates/${companyTemplateId}`);

    const responses = posts.filter((e) => e.path.endsWith('/item_response')).map((e) => e.body);
    expect(responses).toEqual([
      { item_response: { number_value: 2 } },
      { item_response: { text_value: 'Vigente' } },
      { item_response: { number_value: 150 } },
    ]);
    const schedule = (posts.find((e) => e.path.endsWith('/checklist/schedules'))!.body as any).schedule;
    // Primera medición a los 3 meses del reporte de hoy (2026-10-06 → 2027-01-06).
    expect(schedule).toMatchObject({
      name: SCHEDULE_NAME,
      private: false,
      days_created_before_due_date: 7,
      first_inspection_due_at: '2027-01-06T12:00:00Z',
      ends_at: '2027-12-31T12:00:00Z',
      frequency: 'quarterly',
    });
    const createList = posts.find((e) => e.path === '/rest/v1.0/projects/20/checklist/lists')!.body as any;
    expect(schedule.inspection_template_id).toBe(createList.list_template_id);

    const inspection = result.steps.find((s) => s.id === 'inspection')!;
    expect(inspection.url).toMatch(/^https:\/\/app\.procore\.com\/20\/project\/checklists\/lists\/\d+$/);
  });

  it('fecha fin ausente → error claro y no se crea nada', async () => {
    const { client, log } = dry({ id: 1, name: 'P', completion_date: null });
    await expect(prepare(client, '10', '20', TODAY)).rejects.toBeInstanceOf(PreconditionError);
    expect(log.some((e) => e.method !== 'GET')).toBe(false);
  });

  it('usa estimated_completion_date si no hay completion_date', async () => {
    const { client } = dry({ id: 1, completion_date: null, estimated_completion_date: '2027-06-30' });
    expect((await prepare(client, '10', '20', TODAY)).endDate).toBe('2027-06-30');
  });

  it('fecha fin ya pasada → error y no se crea nada', async () => {
    const { client } = dry({ id: 1, completion_date: '2025-01-01' });
    await expect(prepare(client, '10', '20', TODAY)).rejects.toThrow(/ya pasó/);
  });
});

/** Transporte falso configurable: `handler` devuelve una respuesta, un error o undefined (comportamiento por defecto). */
function fakeTransport(handler: (req: ApiRequest) => ApiResponse | Error | undefined): { t: Transport; calls: ApiRequest[] } {
  const calls: ApiRequest[] = [];
  let id = 100;
  const t: Transport = async (req) => {
    calls.push(req);
    const r = handler(req);
    if (r instanceof Error) throw r;
    if (r !== undefined) return r;
    if (req.method === 'GET') return { status: 200, data: [], link: null };
    return { status: 201, data: { id: id++ }, link: null };
  };
  return { t, calls };
}

describe('duplicados y paginación', () => {
  it('detecta plantilla (proyecto y compañía), inspección y planificada por nombre, recorriendo páginas', async () => {
    const { t, calls } = fakeTransport((req) => {
      if (req.path.endsWith('/projects/20')) return { status: 200, data: { completion_date: '2027-06-30' } };
      if (req.path === '/rest/v1.0/projects/20/checklist/list_templates') {
        if (req.query?.page === 1) {
          return {
            status: 200,
            data: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Otra ${i}` })),
            link: '<x?page=2>; rel="next"',
          };
        }
        return { status: 200, data: [{ id: 555, name: TEMPLATE_NAME }], link: '<x?page=1>; rel="first"' };
      }
      if (req.path === '/rest/v1.0/companies/10/checklist/list_templates') return { status: 200, data: [{ id: 66, name: TEMPLATE_NAME }] };
      if (req.path === '/rest/v1.0/projects/20/checklist/lists') return { status: 200, data: [{ id: 7, name: INSPECTION_NAME.toUpperCase() }] };
      if (req.path.endsWith('/schedules')) return { status: 200, data: [{ id: 9, name: SCHEDULE_NAME, ends_at: '2027-01-01' }] };
      return undefined;
    });
    const prepared = await prepare(createProcoreClient(t), '10', '20', TODAY);
    expect(prepared.existing).toEqual({
      template: { id: '555', name: TEMPLATE_NAME },
      companyTemplate: { id: '66', name: TEMPLATE_NAME },
      inspection: { id: '7', name: INSPECTION_NAME.toUpperCase() },
      schedule: { id: '9', name: SCHEDULE_NAME, endDate: '2027-01-01' },
    });
    expect(calls.filter((c) => c.path === '/rest/v1.0/projects/20/checklist/list_templates').length).toBe(2);
  });

  it('reutilizar: no crea plantilla/inspección/planificada; actualiza valores y fecha fin (ends_at)', async () => {
    const { t, calls } = fakeTransport((req) => {
      if (req.method === 'GET' && req.path.endsWith('/checklist/list_items')) {
        return { status: 200, data: [{ id: 71, name: 'Incidentes (uds)', section_id: 1 }] };
      }
      if (req.method === 'GET' && req.path.endsWith('/checklist/list_sections')) return { status: 200, data: [{ id: 1, name: 'Seguridad' }] };
      return undefined;
    });
    const result = await execute({
      companyId: '10',
      client: createProcoreClient(t),
      projectId: '20',
      sections: plan({ inc: '4', prot: 'Sí' }),
      prepared: {
        ...preparedFresh,
        endDate: '2027-06-30',
        existing: {
          template: { id: '555', name: TEMPLATE_NAME },
          inspection: { id: '7', name: INSPECTION_NAME },
          schedule: { id: '9', name: SCHEDULE_NAME, endDate: '2027-01-01' },
        },
      },
      reuseExisting: true,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['reused', 'reused', 'warning', 'reused']);
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /rest/v1.0/projects/20/checklist/items/71/item_response',
      'PATCH /rest/v1.0/projects/20/checklist/schedules/9',
    ]);
    expect(writes[1]!.body).toEqual({ schedule: { ends_at: '2027-06-30T12:00:00Z' } });
    expect(calls.find((c) => c.path.endsWith('/list_items'))!.query).toMatchObject({ 'filters[list_id]': '7' });
  });
});

describe('type del ítem (no documentado en la referencia)', () => {
  it('si Procore rechaza el type, crea el ítem sin type y lo avisa', async () => {
    const calls: ApiRequest[] = [];
    const base = createDryRunTransport({ today: TODAY });
    const t: Transport = async (req) => {
      calls.push(req);
      const b = req.body as any;
      if (req.method === 'POST' && req.path.endsWith('/items') && b.inspection_template_item.type) {
        throw new ProcoreApiError('type is not included in the list', 422);
      }
      return base(req);
    };
    const result = await execute({
      client: createProcoreClient(t),
      companyId: '10',
      projectId: '20',
      sections: plan({ inc: '1', form: '2' }),
      prepared: preparedFresh,
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(result.steps[0]).toMatchObject({ status: 'warning' });
    expect(result.steps[0]!.detail).toMatch(/2 ítems con el tipo por defecto/);
    // 1.er ítem: prueba los valores del listado de tipos ("number", "Número") y luego sin type;
    // el 2.º (mismo tipo de valor) va directo sin type: se reutiliza lo aprendido.
    const itemPosts = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/items'));
    expect(itemPosts.map((c) => (c.body as any).inspection_template_item.type ?? null)).toEqual(['number', 'Número', null, null]);
  });

  it('si el proyecto termina antes de 3 meses, la primera planificada vence en la fecha fin', async () => {
    const { client, log } = dry();
    const result = await execute({
      client,
      companyId: '10',
      projectId: '20',
      sections: plan({ inc: '1' }),
      prepared: { ...preparedFresh, endDate: '2026-11-30' },
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    const schedule = (log.find((e) => e.method === 'POST' && e.path.endsWith('/checklist/schedules'))!.body as any).schedule;
    expect(schedule.first_inspection_due_at).toBe('2026-11-30T12:00:00Z');
  });
});

describe('errores parciales y limpieza', () => {
  it('si falla la planificada, informa qué se creó y qué no', async () => {
    const base = createDryRunTransport({ today: TODAY });
    const t: Transport = async (req) => {
      if (req.method === 'POST' && req.path.endsWith('/checklist/schedules')) throw new ProcoreApiError('boom', 500);
      return base(req);
    };
    const result = await execute({
      client: createProcoreClient(t),
      companyId: '10',
      projectId: '20',
      sections: plan({ inc: '1' }),
      prepared: preparedFresh,
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'failed']);
    expect(result.summary.join(' ')).toMatch(/Plantilla creada/);
    expect(result.summary.join(' ')).toMatch(/Falló el paso "Inspección planificada trimestral"/);
  });

  it('si Procore da 500 al crear la planificada pero la creó igualmente, no la duplica y continúa', async () => {
    const base = createDryRunTransport({ today: TODAY });
    const calls: ApiRequest[] = [];
    const t: Transport = async (req) => {
      calls.push(req);
      if (req.method === 'POST' && req.path.endsWith('/checklist/schedules')) throw new ProcoreApiError('Internal Server Error', 500);
      if (req.method === 'GET' && req.path.endsWith('/checklist/schedules')) {
        return { status: 200, data: [{ id: 77, name: SCHEDULE_NAME }], link: null };
      }
      return base(req);
    };
    const result = await execute({
      client: createProcoreClient(t),
      companyId: '10',
      projectId: '20',
      sections: plan({ inc: '1' }),
      prepared: preparedFresh,
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(result.summary.join(' ')).toMatch(/Planificación trimestral creada \(id 77\)/);
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/checklist/schedules'))).toHaveLength(1);
  });

  it('si Procore da 500 y la planificada no existe, informa del error', async () => {
    const base = createDryRunTransport({ today: TODAY });
    const t: Transport = async (req) => {
      if (req.method === 'POST' && req.path.endsWith('/checklist/schedules')) throw new ProcoreApiError('Internal Server Error', 500);
      return base(req);
    };
    const result = await execute({
      client: createProcoreClient(t),
      companyId: '10',
      projectId: '20',
      sections: plan({ inc: '1' }),
      prepared: preparedFresh,
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.steps.at(-1)).toMatchObject({ status: 'failed' });
    expect(result.steps.at(-1)!.detail).toMatch(/\(500\)/);
  });

  it('si falla un ítem, no se copia al proyecto ni se crea la inspección, y se borra la plantilla de compañía', async () => {
    const { t, calls } = fakeTransport((req) => {
      if (req.method === 'POST' && req.path.endsWith('/items') && JSON.stringify(req.body).includes('Horas de formación')) {
        return new ProcoreApiError('Item inválido', 422);
      }
      return undefined;
    });
    const result = await execute({
      companyId: '10',
      client: createProcoreClient(t),
      projectId: '20',
      sections: plan({ inc: '1', form: '2', prot: 'x' }),
      prepared: preparedFresh,
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
    expect(result.summary[0]).toMatch(/quedó incompleta y se eliminó automáticamente/);
    expect(result.steps[0]!.detail).toMatch(/rechazó los datos/);
    expect(calls.some((c) => c.method === 'DELETE' && /\/companies\/10\/checklist\/list_templates\/\d+$/.test(c.path))).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/create_from_company_template'))).toBe(false);
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/checklist/lists'))).toBe(false);
  });

  it('si las secciones no aparecen al releer la plantilla de compañía, se detiene antes de copiarla', async () => {
    const { t, calls } = fakeTransport(() => undefined); // acepta los POST, pero los GET devuelven []
    const result = await execute({
      companyId: '10',
      client: createProcoreClient(t),
      projectId: '20',
      sections: plan({ inc: '1', agua: '2' }),
      prepared: preparedFresh,
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: noSleep,
    });
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
    expect(result.steps[0]!.detail).toMatch(/no quedó completa: faltan las secciones Seguridad, Medio ambiente/);
    expect(calls.some((c) => c.path.endsWith('/create_from_company_template'))).toBe(false);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
