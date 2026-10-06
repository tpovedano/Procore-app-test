import { describe, expect, it } from 'vitest';
import { createDryRunTransport, type DryRunEntry } from '../src/lib/dryRun';
import { ProcoreApiError, createProcoreClient, type ApiRequest, type Transport } from '../src/lib/procore';
import { INSPECTION_NAME, SCHEDULE_NAME, TEMPLATE_NAME } from '../src/lib/procoreSpec';
import { buildPlan, type PlannedSection } from '../src/lib/selection';
import { PreconditionError, execute, hasExisting, prepare } from '../src/lib/workflow';
import { catalog } from './fixtures';

const TODAY = '2026-10-01';
const WEB = 'https://app.procore.com';

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

describe('flujo completo (dry-run)', () => {
  it('crea plantilla, secciones por dominio, ítems, inspección, respuestas y planificada', async () => {
    const { client, log } = dry({ id: 1, name: 'P', completion_date: '2027-12-31' });
    const prepared = await prepare(client, '10', '20', TODAY);
    expect(prepared.endDate).toBe('2027-12-31');
    expect(hasExisting(prepared.existing)).toBe(false);

    const sections = plan({ inc: '2', prot: 'Vigente', agua: '150' });
    const result = await execute({ companyId: '10', client, projectId: '20', sections, prepared, reuseExisting: false, webBase: WEB, today: TODAY });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);

    const posts = log.filter((e) => e.method === 'POST');
    const sectionPosts = posts.filter((e) => e.path.endsWith('/sections'));
    // Secciones e ítems con endpoints de compañía sobre la plantilla de proyecto.
    expect(sectionPosts.every((e) => /^\/rest\/v1\.0\/companies\/10\/checklist\/list_templates\/\d+\/sections$/.test(e.path))).toBe(true);
    expect(sectionPosts.map((e) => (e.body as any).section.name)).toEqual(['Seguridad', 'Medio ambiente']);
    const itemPosts = posts.filter((e) => e.path.endsWith('/items'));
    expect(itemPosts.map((e) => (e.body as any).item.name)).toEqual(['Incidentes (uds)', 'Protocolo', 'Consumo de agua (m³)']);
    const responses = posts.filter((e) => e.path.endsWith('/item_responses')).map((e) => e.body);
    expect(responses).toEqual([
      { item_response: { number_value: 2 } },
      { item_response: { text_value: 'Vigente' } },
      { item_response: { number_value: 150 } },
    ]);
    const schedule = posts.find((e) => e.path.endsWith('/checklist/schedules'))!.body as any;
    expect(schedule.schedule.end_date).toBe('2027-12-31');
    expect(schedule.schedule.start_date).toBe(TODAY);
    const inspection = result.steps.find((s) => s.id === 'inspection')!;
    expect(inspection.url).toMatch(/^https:\/\/app\.procore\.com\/20\/project\/checklists\/lists\/\d+$/);
  });

  it('fecha fin ausente → error claro y no se crea nada', async () => {
    const { client, log } = dry({ id: 1, name: 'P', completion_date: null });
    await expect(prepare(client, '10', '20', TODAY)).rejects.toBeInstanceOf(PreconditionError);
    expect(log.some((e) => e.method !== 'GET')).toBe(false);
  });

  it('fecha fin ya pasada → error y no se crea nada', async () => {
    const { client } = dry({ id: 1, completion_date: '2025-01-01' });
    await expect(prepare(client, '10', '20', TODAY)).rejects.toThrow(/ya pasó/);
  });
});

/** Transporte falso configurable para duplicados, paginación y fallos. */
function fakeTransport(handlers: (req: ApiRequest) => unknown | undefined): { t: Transport; calls: ApiRequest[] } {
  const calls: ApiRequest[] = [];
  let id = 100;
  const t: Transport = async (req) => {
    calls.push(req);
    const r = handlers(req);
    if (r instanceof Error) throw r;
    if (r !== undefined) return r as any;
    if (req.method === 'GET') return { status: 200, data: [], link: null };
    return { status: 201, data: { id: id++ }, link: null };
  };
  return { t, calls };
}

describe('duplicados y paginación', () => {
  it('detecta objetos existentes por nombre recorriendo todas las páginas', async () => {
    const { t, calls } = fakeTransport((req) => {
      if (req.path.endsWith('/projects/20')) return { status: 200, data: { completion_date: '2027-06-30' } };
      if (req.path.endsWith('/list_templates')) {
        const page = req.query?.page;
        if (page === 1) {
          return {
            status: 200,
            data: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Otra ${i}` })),
            link: '<x?page=2>; rel="next"',
          };
        }
        return { status: 200, data: [{ id: 555, name: TEMPLATE_NAME }], link: '<x?page=1>; rel="first"' };
      }
      if (req.path.endsWith('/checklist/lists')) return { status: 200, data: [{ id: 7, name: INSPECTION_NAME.toUpperCase() }] };
      if (req.path.endsWith('/schedules')) return { status: 200, data: [{ id: 9, name: SCHEDULE_NAME, end_date: '2027-01-01' }] };
      return undefined;
    });
    const prepared = await prepare(createProcoreClient(t), '10', '20', TODAY);
    expect(prepared.existing).toEqual({
      template: { id: '555', name: TEMPLATE_NAME },
      inspection: { id: '7', name: INSPECTION_NAME.toUpperCase() },
      schedule: { id: '9', name: SCHEDULE_NAME, endDate: '2027-01-01' },
    });
    expect(calls.filter((c) => c.path.endsWith('/list_templates')).length).toBe(2);
  });

  it('reutilizar: no crea plantilla/inspección/planificada; actualiza valores y fecha fin', async () => {
    const { t, calls } = fakeTransport((req) => {
      if (req.method === 'GET' && req.path === '/rest/v1.0/checklist/lists/7') {
        return { status: 200, data: { sections: [{ name: 'Seguridad', items: [{ id: 71, name: 'Incidentes (uds)' }] }] } };
      }
      return undefined;
    });
    const result = await execute({
      companyId: '10',
      client: createProcoreClient(t),
      projectId: '20',
      sections: plan({ inc: '4', prot: 'Sí' }),
      prepared: {
        projectName: 'P',
        endDate: '2027-06-30',
        endDateField: 'completion_date',
        existing: {
          template: { id: '555', name: TEMPLATE_NAME },
          inspection: { id: '7', name: INSPECTION_NAME },
          schedule: { id: '9', name: SCHEDULE_NAME, endDate: '2027-01-01' },
        },
      },
      reuseExisting: true,
      webBase: WEB,
      today: TODAY,
    });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['reused', 'reused', 'warning', 'reused']);
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /rest/v1.0/checklist/lists/7/items/71/item_responses',
      'PATCH /rest/v1.0/projects/20/checklist/schedules/9',
    ]);
    expect(writes[1]!.body).toEqual({ schedule: { end_date: '2027-06-30' } });
  });
});

describe('errores parciales', () => {
  it('si falla la planificada, informa qué se creó y qué no', async () => {
    const { client } = dry({ id: 1, completion_date: '2027-12-31' });
    const prepared = await prepare(client, '10', '20', TODAY);
    const failing = createProcoreClient(async () => {
      throw new ProcoreApiError('boom', 500);
    });
    const result = await execute({
      companyId: '10',
      client: { ...client, createSchedule: failing.createSchedule },
      projectId: '20',
      sections: plan({ inc: '1' }),
      prepared,
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
    });
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'failed']);
    expect(result.summary.join(' ')).toMatch(/Plantilla de compañía creada/);
    expect(result.summary.join(' ')).toMatch(/Falló el paso "Inspección planificada trimestral"/);
  });

  it('si falla un ítem de la plantilla, no se crea la inspección ni la planificada y se borra la plantilla', async () => {
    const { t, calls } = fakeTransport((req) => {
      // Procore rechaza siempre el 2.º ítem, con cualquier variante de cuerpo.
      const body = JSON.stringify(req.body ?? {});
      if (req.method === 'POST' && req.path.endsWith('/items') && body.includes('Horas de formación')) {
        return new ProcoreApiError('Item inválido', 422);
      }
      return undefined;
    });
    const result = await execute({
      companyId: '10',
      client: createProcoreClient(t),
      projectId: '20',
      sections: plan({ inc: '1', form: '2', prot: 'x' }),
      prepared: { projectName: 'P', endDate: '2027-12-31', endDateField: 'completion_date', existing: {} },
      reuseExisting: false,
      webBase: WEB,
      today: TODAY,
      sleep: async () => {},
    });
    expect(result.steps.map((s) => s.status)).toEqual(['failed', 'skipped', 'skipped', 'skipped']);
    expect(result.summary[0]).toMatch(/quedó incompleta y se eliminó automáticamente/);
    expect(result.steps[0]!.detail).toMatch(/rechazó los datos/);
    // Se probaron las 4 variantes de cuerpo del ítem antes de rendirse, y se borró la plantilla.
    const failedItemPosts = calls.filter((c) => c.method === 'POST' && JSON.stringify(c.body).includes('Horas de formación'));
    expect(failedItemPosts).toHaveLength(4);
    expect(calls.some((c) => c.method === 'DELETE' && /\/companies\/10\/checklist\/list_templates\/\d+$/.test(c.path))).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/checklist/lists') && c.method === 'POST')).toBe(false);
  });
});
