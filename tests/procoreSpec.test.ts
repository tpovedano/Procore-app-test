import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_NAME,
  SchedulePayloadError,
  buildChecklistPayload,
  buildCopyFromCompanyPayload,
  buildItemResponsePayload,
  buildSchedulePayload,
  buildScheduleEndDatePatch,
  buildSectionPayload,
  buildTemplateItemPayload,
  buildTemplatePayload,
  checklistWebUrl,
  extractListItems,
  extractScheduleEndDate,
  isAllowedRequest,
  itemTypeCandidates,
  paths,
  resolveProjectEndDate,
} from '../src/lib/procoreSpec';

describe('fecha fin del proyecto (Show project)', () => {
  it('usa completion_date si existe', () => {
    expect(resolveProjectEndDate({ completion_date: '2027-12-31', estimated_completion_date: '2028-01-31' })).toEqual({
      date: '2027-12-31',
      field: 'completion_date',
    });
  });
  it('recurre a estimated_completion_date', () => {
    expect(resolveProjectEndDate({ completion_date: null, estimated_completion_date: '2028-01-31' })?.field).toBe(
      'estimated_completion_date',
    );
  });
  it('fecha fin ausente o inválida → null', () => {
    expect(resolveProjectEndDate({ name: 'X' })).toBeNull();
    expect(resolveProjectEndDate({ completion_date: '' })).toBeNull();
    expect(resolveProjectEndDate({ completion_date: 'no-es-fecha' })).toBeNull();
    expect(resolveProjectEndDate(null)).toBeNull();
  });
});

describe('payloads según la referencia', () => {
  it('Create Company Checklist Template', () => {
    expect(buildTemplatePayload()).toMatchObject({ list_template: { name: 'Reporte de objetivos' } });
  });

  it('Create Company Checklist Template Section', () => {
    expect(buildSectionPayload('Agua', 2)).toEqual({ section: { name: 'Agua', position: 2 } });
  });

  it('Create Company Inspection Template Item: sección en el cuerpo y type opcional', () => {
    expect(buildTemplateItemPayload({ name: 'Agua (m³)' }, 1, '55', 'number')).toEqual({
      inspection_template_item: { name: 'Agua (m³)', position: 1, section_id: 55, type: 'number' },
    });
    expect(buildTemplateItemPayload({ name: 'Plan' }, 2, 56)).toEqual({
      inspection_template_item: { name: 'Plan', position: 2, section_id: 56 },
    });
  });

  it('Create a Project Checklist Template from a Company Checklist Template', () => {
    expect(buildCopyFromCompanyPayload('9')).toEqual({ source_template_id: 9 });
  });

  it('Create Checklist (Inspection): list_template_id y list sin nombre', () => {
    const p = buildChecklistPayload({ templateId: '9', inspectionDate: '2026-10-06' }) as any;
    expect(p.list_template_id).toBe(9);
    expect(p.list).toMatchObject({ inspection_date: '2026-10-06' });
    expect(p.list.name).toBeUndefined();
  });

  it('Create Checklist Item Response: number_value o text_value', () => {
    expect(buildItemResponsePayload('number', 3.5)).toEqual({ item_response: { number_value: 3.5 } });
    expect(buildItemResponsePayload('text', 'OK')).toEqual({ item_response: { text_value: 'OK' } });
  });
});

describe('payload del schedule (planificada trimestral)', () => {
  it('incluye los campos obligatorios que exige Procore', () => {
    const p = buildSchedulePayload({ templateId: '42', firstDueDate: '2027-01-06', endDate: '2027-12-31' });
    expect(p).toEqual({
      schedule: {
        name: SCHEDULE_NAME,
        private: false,
        days_created_before_due_date: 7,
        inspection_template_id: 42,
        first_inspection_due_at: '2027-01-06T12:00:00Z',
        ends_at: '2027-12-31T12:00:00Z',
        frequency: 'quarterly',
      },
    });
  });

  it('la planificada no lleva valores de ítems', () => {
    const p = buildSchedulePayload({ templateId: 1, firstDueDate: '2027-01-01', endDate: '2027-06-01' });
    expect(JSON.stringify(p)).not.toMatch(/number_value|text_value|item_response/);
  });

  it('first_inspection_due_at es un timestamp válido; rechaza fechas inválidas o fin anterior', () => {
    const p = buildSchedulePayload({ templateId: 1, firstDueDate: '2027-01-01T08:00:00Z', endDate: '2027-06-01' }) as any;
    expect(p.schedule.first_inspection_due_at).toBe('2027-01-01T12:00:00Z');
    expect(Number.isNaN(Date.parse(p.schedule.first_inspection_due_at))).toBe(false);
    expect(() => buildSchedulePayload({ templateId: 1, firstDueDate: '2027-01-01', endDate: '' })).toThrow(SchedulePayloadError);
    expect(() => buildSchedulePayload({ templateId: 1, firstDueDate: '2027-01-01', endDate: '2026-09-01' })).toThrow(/anterior/);
  });

  it('actualización de fecha fin y lectura de ends_at', () => {
    expect(buildScheduleEndDatePatch('2028-03-31')).toEqual({ schedule: { ends_at: '2028-03-31T12:00:00Z' } });
    expect(extractScheduleEndDate({ ends_at: '2028-03-31T00:00:00Z' })).toBe('2028-03-31');
  });
});

describe('lectura de respuestas', () => {
  it('ítems de inspección con su sección (List Checklist Items + Sections)', () => {
    expect(
      extractListItems(
        [
          { id: 1, name: 'A', section_id: 10 },
          { name: 'sin id' },
        ],
        [{ id: 10, name: 'S' }],
      ),
    ).toEqual([{ id: '1', name: 'A', sectionName: 'S' }]);
  });

  it('tipos de ítem candidatos según el listado de Procore', () => {
    const types = [
      { id: 1, name: 'Number', type: 'number' },
      { id: 2, name: 'Free text', type: 'text' },
      { id: 3, name: 'Pass/Fail', type: 'pass_fail' },
    ];
    expect(itemTypeCandidates(types, 'number')).toEqual(['number', 'Number']);
    expect(itemTypeCandidates(types, 'text')).toEqual(['text', 'Free text']);
    expect(itemTypeCandidates(undefined, 'text')).toEqual([]);
  });

  it('URL web de la inspección', () => {
    expect(checklistWebUrl('https://app.procore.com', '12', '34')).toBe('https://app.procore.com/12/project/checklists/lists/34');
  });
});

describe('allowlist del proxy', () => {
  it('acepta exactamente las rutas de la referencia usadas por la app', () => {
    const allowed: [string, string][] = [
      ['GET', paths.showProject(1)],
      ['POST', paths.companyTemplates(1)],
      ['DELETE', paths.companyTemplate(1, 2)],
      ['POST', paths.companyTemplateSections(1, 2)],
      ['POST', paths.companyTemplateItems(1, 2)],
      ['POST', paths.projectTemplateFromCompany(3)],
      ['GET', paths.itemTypes()],
      ['POST', paths.projectLists(3)],
      ['GET', paths.listItems(3)],
      ['POST', paths.itemResponse(3, 4)],
      ['POST', paths.schedules(3)],
      ['PATCH', paths.schedule(3, 5)],
    ];
    for (const [m, p] of allowed) expect([m, p, isAllowedRequest(m, p)]).toEqual([m, p, true]);
  });

  it('rechaza rutas, métodos o ids no previstos', () => {
    expect(isAllowedRequest('DELETE', '/rest/v1.0/projects/3/checklist/lists/1')).toBe(false);
    expect(isAllowedRequest('GET', '/rest/v1.0/projects/abc')).toBe(false);
    expect(isAllowedRequest('GET', '/rest/v1.0/projects/1/../companies')).toBe(false);
    expect(isAllowedRequest('GET', '/rest/v1.0/companies/1/users')).toBe(false);
    expect(isAllowedRequest('POST', '/rest/v1.0/checklist/lists')).toBe(false);
    expect(isAllowedRequest('POST', '/rest/v1.0/companies/1/checklist/list_templates/2/sections/3/items')).toBe(false);
  });
});
