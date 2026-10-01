import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_NAME,
  SchedulePayloadError,
  buildChecklistPayload,
  buildItemPayload,
  buildItemResponsePayload,
  buildSchedulePayload,
  checklistWebUrl,
  extractChecklistItems,
  isAllowedRequest,
  quarterlyRecurrenceFields,
  resolveProjectEndDate,
} from '../src/lib/procoreSpec';

describe('fecha fin del proyecto', () => {
  it('usa completion_date si existe', () => {
    expect(resolveProjectEndDate({ completion_date: '2027-12-31', projected_finish_date: '2028-01-31' })).toEqual({
      date: '2027-12-31',
      field: 'completion_date',
    });
  });
  it('recurre a projected_finish_date', () => {
    expect(resolveProjectEndDate({ completion_date: null, projected_finish_date: '2028-01-31' })?.field).toBe(
      'projected_finish_date',
    );
  });
  it('fecha fin ausente o inválida → null', () => {
    expect(resolveProjectEndDate({ name: 'X' })).toBeNull();
    expect(resolveProjectEndDate({ completion_date: '' })).toBeNull();
    expect(resolveProjectEndDate({ completion_date: 'no-es-fecha' })).toBeNull();
    expect(resolveProjectEndDate(null)).toBeNull();
  });
});

describe('payload del schedule (planificada trimestral)', () => {
  it('incluye plantilla, nombre, fechas y periodicidad trimestral', () => {
    const p = buildSchedulePayload({ templateId: '42', startDate: '2026-10-01', endDate: '2027-12-31' });
    expect(p).toEqual({
      schedule: {
        name: SCHEDULE_NAME,
        list_template_id: 42,
        start_date: '2026-10-01',
        end_date: '2027-12-31',
        ...quarterlyRecurrenceFields('2026-10-01'),
      },
    });
    expect(quarterlyRecurrenceFields('2026-10-15')).toEqual({ frequency: 'monthly', interval: 3, day_of_month: 15 });
  });

  it('la planificada no lleva valores de ítems', () => {
    const p = buildSchedulePayload({ templateId: 1, startDate: '2026-10-01', endDate: '2027-01-01' });
    expect(JSON.stringify(p)).not.toMatch(/number_value|text_value|item_response/);
  });

  it('normaliza fechas con hora y rechaza fechas inválidas o fin anterior al inicio', () => {
    const p = buildSchedulePayload({ templateId: 1, startDate: '2026-10-01T08:00:00Z', endDate: '2027-01-01' }) as {
      schedule: { start_date: string };
    };
    expect(p.schedule.start_date).toBe('2026-10-01');
    expect(() => buildSchedulePayload({ templateId: 1, startDate: '2026-10-01', endDate: '' })).toThrow(SchedulePayloadError);
    expect(() => buildSchedulePayload({ templateId: 1, startDate: '2026-10-01', endDate: '2026-09-01' })).toThrow(
      /anterior/,
    );
  });
});

describe('otros payloads', () => {
  it('ítem de plantilla con tipo según valueType', () => {
    expect(buildItemPayload({ name: 'Agua (m³)', valueType: 'number' }, 1)).toEqual({
      item: { name: 'Agua (m³)', position: 1, item_type: 'number' },
    });
    expect(buildItemPayload({ name: 'Plan', valueType: 'text' }, 2)).toEqual({
      item: { name: 'Plan', position: 2, item_type: 'text' },
    });
  });

  it('respuesta: number_value o text_value', () => {
    expect(buildItemResponsePayload('number', 3.5)).toEqual({ item_response: { number_value: 3.5 } });
    expect(buildItemResponsePayload('text', 'OK')).toEqual({ item_response: { text_value: 'OK' } });
  });

  it('inspección desde plantilla', () => {
    expect(buildChecklistPayload({ projectId: '7', templateId: '9' })).toEqual({
      project_id: 7,
      list_template_id: 9,
      list: { name: 'Reporte de objetivos' },
    });
  });

  it('extrae ítems de sections[].items[]', () => {
    expect(
      extractChecklistItems({ sections: [{ name: 'S', items: [{ id: 1, name: 'A' }, { name: 'sin id' }] }] }),
    ).toEqual([{ id: '1', name: 'A', sectionName: 'S' }]);
  });

  it('URL web de la inspección', () => {
    expect(checklistWebUrl('https://app.procore.com', '12', '34')).toBe(
      'https://app.procore.com/12/project/checklists/lists/34',
    );
  });
});

describe('allowlist del proxy', () => {
  it('acepta solo rutas conocidas con ids numéricos', () => {
    expect(isAllowedRequest('GET', '/rest/v1.0/projects/123')).toBe(true);
    expect(isAllowedRequest('POST', '/rest/v1.0/projects/123/checklist/schedules')).toBe(true);
    expect(isAllowedRequest('DELETE', '/rest/v1.0/projects/123')).toBe(false);
    expect(isAllowedRequest('GET', '/rest/v1.0/projects/abc')).toBe(false);
    expect(isAllowedRequest('GET', '/rest/v1.0/projects/1/../companies')).toBe(false);
    expect(isAllowedRequest('GET', '/rest/v1.0/companies')).toBe(false);
  });
});
