import { describe, expect, it } from 'vitest';
import { createProcoreClient, type ApiRequest } from '../src/lib/procore';
import { SCHEDULE_NAME } from '../src/lib/procoreSpec';
import { isAuthorizedWebhook, isProjectChangeEvent, parseWebhookEvent, syncScheduleEndDate } from '../src/lib/webhook';

describe('webhook', () => {
  it('normaliza payload v2 y v4', () => {
    const v2 = parseWebhookEvent({
      id: 1,
      ulid: '01ABC',
      event_type: 'update',
      resource_name: 'Projects',
      company_id: 5,
      project_id: 6,
    });
    expect(v2).toEqual({ id: '01ABC', resourceName: 'Projects', eventType: 'update', companyId: '5', projectId: '6' });
    expect(isProjectChangeEvent(v2!)).toBe(true);
    const v4 = parseWebhookEvent({ id: 'X', reason: 'update', resource_type: 'RFIs', company_id: '5', project_id: '6' });
    expect(isProjectChangeEvent(v4!)).toBe(false);
    expect(parseWebhookEvent({ resource_name: 'Projects' })).toBeNull();
  });

  it('verifica el secreto de la cabecera Authorization', () => {
    const secret = 's'.repeat(32);
    expect(isAuthorizedWebhook(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedWebhook(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedWebhook(null, secret)).toBe(false);
    expect(isAuthorizedWebhook('Bearer corto', 'corto')).toBe(false); // secreto demasiado débil
  });

  it('actualiza la fecha fin de la planificada si cambió', async () => {
    const calls: ApiRequest[] = [];
    const client = createProcoreClient(async (req) => {
      calls.push(req);
      if (req.path.endsWith('/projects/6')) return { status: 200, data: { completion_date: '2028-03-31' } };
      if (req.path.endsWith('/schedules') && req.method === 'GET') {
        return { status: 200, data: [{ id: 3, name: SCHEDULE_NAME, end_date: '2027-12-31' }] };
      }
      return { status: 200, data: {} };
    });
    const r = await syncScheduleEndDate(client, '5', '6');
    expect(r).toEqual({ action: 'updated', scheduleId: '3', from: '2027-12-31', to: '2028-03-31' });
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', body: { schedule: { end_date: '2028-03-31' } } });
  });

  it('no hace nada si no hay planificada de la app', async () => {
    const client = createProcoreClient(async (req) =>
      req.path.endsWith('/projects/6')
        ? { status: 200, data: { completion_date: '2028-03-31' } }
        : { status: 200, data: [{ id: 1, name: 'Otra' }] },
    );
    expect(await syncScheduleEndDate(client, '5', '6')).toEqual({ action: 'no-schedule' });
  });
});
