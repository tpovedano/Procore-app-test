import { describe, expect, it } from 'vitest';
import { truncateForLog, withLogging, type ApiLogEntry } from '../src/lib/apiLog';
import { ProcoreApiError, createProcoreClient, type ApiRequest, type Transport } from '../src/lib/procore';
import { TEMPLATE_NAME, extractId } from '../src/lib/procoreSpec';
import { buildPlan } from '../src/lib/selection';
import { describeError, execute, retryWhileNotVisible } from '../src/lib/workflow';
import { catalog } from './fixtures';

const noSleep = async () => {};

describe('extractId acepta varias formas de respuesta', () => {
  it('id directo, data.id y envoltorio por tipo', () => {
    expect(extractId({ id: 5 })).toBe('5');
    expect(extractId({ data: { id: '6' } })).toBe('6');
    expect(extractId({ list_template: { id: 7, name: 'x' } })).toBe('7');
    expect(extractId({ a: { id: 1 }, b: { id: 2 } })).toBeNull(); // ambiguo
    expect(extractId([{ id: 1 }])).toBeNull();
    expect(extractId({})).toBeNull();
  });
});

describe('reintentos por propagación', () => {
  it('reintenta 404 y termina con éxito', async () => {
    let n = 0;
    const r = await retryWhileNotVisible(async () => {
      if (++n < 3) throw new ProcoreApiError('no', 404);
      return 'ok';
    }, noSleep);
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('reintenta 422 de list_template pero no otros 422', async () => {
    let n = 0;
    await expect(
      retryWhileNotVisible(async () => {
        n++;
        throw new ProcoreApiError('list_template_id is invalid', 422);
      }, noSleep),
    ).rejects.toThrow();
    expect(n).toBe(4); // 1 + 3 reintentos
    let m = 0;
    await expect(
      retryWhileNotVisible(async () => {
        m++;
        throw new ProcoreApiError('name is blank', 422);
      }, noSleep),
    ).rejects.toThrow();
    expect(m).toBe(1);
  });
});

describe('errores detallados', () => {
  it('incluyen método y ruta y una pista para list_template_id', async () => {
    const client = createProcoreClient(async () => {
      throw new ProcoreApiError('{"list_template_id":["is invalid"]}', 422);
    });
    const err = await client.createChecklist('2', {}).catch((e: unknown) => e);
    const text = describeError(err);
    expect(text).toContain('[POST /rest/v1.0/checklist/lists]');
    expect(text).toContain('is invalid');
    expect(text).toMatch(/plantilla esté vacía o incompleta/);
  });
});

describe('plantilla sin id en la respuesta', () => {
  it('la busca por nombre (la más reciente) y continúa', async () => {
    const calls: ApiRequest[] = [];
    let listed = 0;
    let id = 500;
    const t: Transport = async (req) => {
      calls.push(req);
      if (req.method === 'POST' && req.path.endsWith('/checklist/list_templates')) {
        return { status: 201, data: { ok: true } }; // sin id
      }
      if (req.method === 'GET' && req.path.endsWith('/checklist/list_templates')) {
        listed++;
        // Primera consulta: todavía no aparece (retraso de propagación).
        return {
          status: 200,
          data: listed === 1 ? [] : [{ id: 41, name: TEMPLATE_NAME }, { id: 42, name: TEMPLATE_NAME }],
        };
      }
      if (req.method === 'GET' && /checklist\/lists\/\d+$/.test(req.path)) {
        return { status: 200, data: { sections: [{ name: 'Seguridad', items: [{ id: 9, name: 'Incidentes (uds)' }] }] } };
      }
      if (req.method === 'GET' && req.path.endsWith('/sections')) {
        return { status: 200, data: calls.some((c) => c.method === 'POST' && c.path.endsWith('/sections')) ? [{ id: 1, name: 'Seguridad' }] : [] };
      }
      if (req.method === 'GET') return { status: 200, data: [] };
      return { status: 201, data: { id: id++ } };
    };
    const plan = buildPlan(catalog, { inc: '1' });
    if (!plan.ok) throw new Error('plan');
    const result = await execute({
      companyId: '10',
      client: createProcoreClient(t),
      projectId: '2',
      sections: plan.sections,
      prepared: { projectName: 'P', endDate: '2027-12-31', endDateField: 'completion_date', existing: {} },
      reuseExisting: false,
      webBase: 'https://sandbox.procore.com',
      today: '2026-10-02',
      sleep: noSleep,
    });
    expect(result.ok).toBe(true);
    const section = calls.find((c) => c.path.endsWith('/sections'))!;
    expect(section.path).toContain('/list_templates/42/sections');
    expect(listed).toBe(2);
  });
});

describe('registro técnico', () => {
  it('guarda petición, estado y respuesta, también en errores', async () => {
    const log: ApiLogEntry[] = [];
    const t = withLogging(async (req) => {
      if (req.method === 'POST') throw new ProcoreApiError('bad', 422, { errors: { name: ['blank'] } });
      return { status: 200, data: { id: 1 } };
    }, (e) => log.push(e));
    await t({ method: 'GET', path: '/a' });
    await t({ method: 'POST', path: '/b', body: { x: 1 } }).catch(() => {});
    expect(log.map((e) => [e.method, e.status])).toEqual([
      ['GET', 200],
      ['POST', 422],
    ]);
    expect(log[1]).toMatchObject({ body: { x: 1 }, response: { errors: { name: ['blank'] } }, error: 'bad' });
  });

  it('recorta respuestas grandes', () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ id: i, name: 'x'.repeat(20) }));
    expect(truncateForLog(big)).toMatchObject({ _truncado: true, total: 500 });
  });
});
