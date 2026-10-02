/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CONTRATO CON LA API DE PROCORE: único lugar con rutas, campos y payloads.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Todo lo que depende de la referencia REST de Procore está aquí y en ningún
 * otro sitio. Cada elemento lleva una marca:
 *
 *   VERIFIED     → confirmado en la documentación oficial (repo procore/documentation)
 *                  o en el enunciado del proyecto.
 *   TODO(verify) → NO se pudo confirmar contra la referencia REST
 *                  (developers.procore.com/reference). Hay que revisarlo antes
 *                  de usarlo en producción. Ver la lista de TODOs en el README.
 *
 * Si algo no coincide con la referencia, corrígelo SOLO en este archivo.
 */

import type { ValueType } from './catalog.js';
import { toIsoDate } from './dates.js';
import type { PlannedItem } from './selection.js';

// ─── Nombres de los objetos que crea la app (sirven también para detectar duplicados) ───

export const INSPECTION_NAME = 'Reporte de objetivos';
export const TEMPLATE_NAME = 'Plantilla · Reporte de objetivos';
export const SCHEDULE_NAME = 'Medición trimestral de objetivos';

// ─── Endpoints ────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PATCH';
type Id = number | string;

export interface EndpointSpec {
  method: HttpMethod;
  /** Plantilla de ruta, solo para documentación y para la allowlist del proxy. */
  template: string;
  verified: boolean;
  note: string;
}

export const ENDPOINTS = {
  me: {
    method: 'GET',
    template: '/rest/v1.0/me',
    verified: true,
    note: 'Documentado en "OAuth 2.0 Authorization Code Grant Flow".',
  },
  showProject: {
    method: 'GET',
    template: '/rest/v1.0/projects/{project_id}?company_id={company_id}',
    verified: false,
    note: 'TODO(verify): "List Projects" (GET /rest/v1.0/projects?company_id=) está documentado; confirmar "Show Project" y el nombre del campo de fecha fin.',
  },
  listProjectTemplates: {
    method: 'GET',
    template: '/rest/v1.0/projects/{project_id}/checklist/list_templates',
    verified: false,
    note: 'TODO(verify): Project Checklist Templates → List.',
  },
  createProjectTemplate: {
    method: 'POST',
    template: '/rest/v1.0/projects/{project_id}/checklist/list_templates',
    verified: false,
    note: 'TODO(verify): Project Checklist Templates → Create. Cuerpo { list_template: {...} }.',
  },
  createTemplateSection: {
    method: 'POST',
    template: '/rest/v1.0/projects/{project_id}/checklist/list_templates/{list_template_id}/sections',
    verified: false,
    note: 'TODO(verify): Checklist Sections → Create (sección de plantilla).',
  },
  createTemplateItem: {
    method: 'POST',
    template: '/rest/v1.0/projects/{project_id}/checklist/list_templates/{list_template_id}/sections/{section_id}/items',
    verified: false,
    note: 'TODO(verify): Checklist Items → Create (ítem de plantilla) y campo de tipo de ítem (Checklist Item Types).',
  },
  listChecklists: {
    method: 'GET',
    template: '/rest/v1.0/checklist/lists?project_id={project_id}',
    verified: false,
    note: 'TODO(verify): Checklists → List (misma colección que el POST identificado).',
  },
  createChecklist: {
    method: 'POST',
    template: '/rest/v1.0/checklist/lists?project_id={project_id}',
    verified: true,
    note: 'Ruta identificada en el enunciado. TODO(verify): forma exacta del cuerpo ({ list_template_id, list: {...} }).',
  },
  showChecklist: {
    method: 'GET',
    template: '/rest/v1.0/checklist/lists/{list_id}?project_id={project_id}',
    verified: false,
    note: 'TODO(verify): Checklists → Show; se asume que devuelve sections[].items[].',
  },
  createItemResponse: {
    method: 'POST',
    template: '/rest/v1.0/checklist/lists/{list_id}/items/{item_id}/item_responses?project_id={project_id}',
    verified: false,
    note: 'TODO(verify): Checklist Item Responses → Create; campos number_value / text_value.',
  },
  listSchedules: {
    method: 'GET',
    template: '/rest/v1.0/projects/{project_id}/checklist/schedules',
    verified: false,
    note: 'TODO(verify): Checklist Schedules → List (la ruta base aparece en "Checklist Schedule Attachments").',
  },
  createSchedule: {
    method: 'POST',
    template: '/rest/v1.0/projects/{project_id}/checklist/schedules',
    verified: true,
    note: 'Ruta identificada en el enunciado. TODO(verify): campos del cuerpo y de periodicidad.',
  },
  updateSchedule: {
    method: 'PATCH',
    template: '/rest/v1.0/projects/{project_id}/checklist/schedules/{schedule_id}',
    verified: false,
    note: 'TODO(verify): Checklist Schedules → Update (usado por el webhook para la fecha fin).',
  },
} as const satisfies Record<string, EndpointSpec>;

export type EndpointName = keyof typeof ENDPOINTS;

const enc = (v: Id) => encodeURIComponent(String(v));

/** Rutas concretas (sin query). Los parámetros de query se pasan aparte. */
export const paths = {
  me: () => '/rest/v1.0/me',
  showProject: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}`,
  projectTemplates: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}/checklist/list_templates`,
  templateSections: (projectId: Id, templateId: Id) =>
    `/rest/v1.0/projects/${enc(projectId)}/checklist/list_templates/${enc(templateId)}/sections`,
  templateItems: (projectId: Id, templateId: Id, sectionId: Id) =>
    `/rest/v1.0/projects/${enc(projectId)}/checklist/list_templates/${enc(templateId)}/sections/${enc(sectionId)}/items`,
  checklists: () => '/rest/v1.0/checklist/lists',
  checklist: (listId: Id) => `/rest/v1.0/checklist/lists/${enc(listId)}`,
  itemResponses: (listId: Id, itemId: Id) =>
    `/rest/v1.0/checklist/lists/${enc(listId)}/items/${enc(itemId)}/item_responses`,
  schedules: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}/checklist/schedules`,
  schedule: (projectId: Id, scheduleId: Id) =>
    `/rest/v1.0/projects/${enc(projectId)}/checklist/schedules/${enc(scheduleId)}`,
};

/**
 * Allowlist del proxy serverless: solo estas combinaciones método+ruta pueden
 * llegar a Procore. Los ids deben ser numéricos.
 */
export const PROXY_ALLOWLIST: ReadonlyArray<{ method: HttpMethod; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/rest\/v1\.0\/me$/ },
  { method: 'GET', pattern: /^\/rest\/v1\.0\/projects\/\d+$/ },
  { method: 'GET', pattern: /^\/rest\/v1\.0\/projects\/\d+\/checklist\/list_templates$/ },
  { method: 'POST', pattern: /^\/rest\/v1\.0\/projects\/\d+\/checklist\/list_templates$/ },
  { method: 'POST', pattern: /^\/rest\/v1\.0\/projects\/\d+\/checklist\/list_templates\/\d+\/sections$/ },
  { method: 'POST', pattern: /^\/rest\/v1\.0\/projects\/\d+\/checklist\/list_templates\/\d+\/sections\/\d+\/items$/ },
  { method: 'GET', pattern: /^\/rest\/v1\.0\/checklist\/lists$/ },
  { method: 'POST', pattern: /^\/rest\/v1\.0\/checklist\/lists$/ },
  { method: 'GET', pattern: /^\/rest\/v1\.0\/checklist\/lists\/\d+$/ },
  { method: 'POST', pattern: /^\/rest\/v1\.0\/checklist\/lists\/\d+\/items\/\d+\/item_responses$/ },
  { method: 'GET', pattern: /^\/rest\/v1\.0\/projects\/\d+\/checklist\/schedules$/ },
  { method: 'POST', pattern: /^\/rest\/v1\.0\/projects\/\d+\/checklist\/schedules$/ },
  { method: 'PATCH', pattern: /^\/rest\/v1\.0\/projects\/\d+\/checklist\/schedules\/\d+$/ },
];

export function isAllowedRequest(method: string, path: string): boolean {
  return PROXY_ALLOWLIST.some((r) => r.method === method && r.pattern.test(path));
}

// ─── Proyecto: fecha fin ──────────────────────────────────────────────────────

/**
 * TODO(verify): nombre del campo de fecha fin en "Show Project".
 * Se prueban en este orden; el primero con fecha válida gana.
 */
export const PROJECT_END_DATE_FIELDS = ['completion_date', 'projected_finish_date'] as const;

export interface ProjectEndDate {
  date: string;
  field: (typeof PROJECT_END_DATE_FIELDS)[number];
}

export function resolveProjectEndDate(project: unknown): ProjectEndDate | null {
  if (typeof project !== 'object' || project === null) return null;
  const p = project as Record<string, unknown>;
  for (const field of PROJECT_END_DATE_FIELDS) {
    const date = toIsoDate(p[field]);
    if (date) return { date, field };
  }
  return null;
}

// ─── Tipos de ítem y respuestas ───────────────────────────────────────────────

/**
 * TODO(verify) [Checklist Item Types]: cómo se declara que un ítem es de tipo
 * número o texto. Ajustar SOLO esta función.
 */
export function itemTypeFields(valueType: ValueType): Record<string, unknown> {
  return valueType === 'number' ? { item_type: 'number' } : { item_type: 'text' };
}

/**
 * TODO(verify) [Checklist Item Responses]: formato de la respuesta con el valor
 * objetivo. El enunciado sugiere number_value / text_value.
 */
export function buildItemResponsePayload(valueType: ValueType, value: number | string): Record<string, unknown> {
  return {
    item_response: valueType === 'number' ? { number_value: Number(value) } : { text_value: String(value) },
  };
}

// ─── Payloads de creación ─────────────────────────────────────────────────────

export function buildTemplatePayload(name: string = TEMPLATE_NAME): Record<string, unknown> {
  return {
    list_template: {
      name,
      description: 'Generada por la app "Objetivos" a partir del catálogo de elementos.',
    },
  };
}

export function buildSectionPayload(name: string, position: number): Record<string, unknown> {
  return { section: { name, position } };
}

export function buildItemPayload(item: Pick<PlannedItem, 'name' | 'valueType'>, position: number): Record<string, unknown> {
  return { item: { name: item.name, position, ...itemTypeFields(item.valueType) } };
}

/** TODO(verify) [Checklists → Create]: cuerpo para crear la inspección desde una plantilla. */
export function buildChecklistPayload(args: { projectId: Id; templateId: Id; name?: string }): Record<string, unknown> {
  return {
    project_id: Number(args.projectId),
    list_template_id: Number(args.templateId),
    list: { name: args.name ?? INSPECTION_NAME },
  };
}

/**
 * TODO(verify) [Checklist Schedules]: campos de periodicidad. Aquí se modela
 * "trimestral" como repetición mensual cada 3 meses, anclada al día de inicio.
 * Si la API tiene un valor "quarterly" o usa RRULE, cambiar SOLO esta función.
 */
export function quarterlyRecurrenceFields(startDate: string): Record<string, unknown> {
  const dayOfMonth = Number(startDate.slice(8, 10));
  return { frequency: 'monthly', interval: 3, day_of_month: dayOfMonth };
}

export interface SchedulePayloadArgs {
  templateId: Id;
  startDate: string;
  endDate: string;
  name?: string;
}

export class SchedulePayloadError extends Error {}

/** TODO(verify) [Checklist Schedules → Create]: nombres de campos del cuerpo. */
export function buildSchedulePayload(args: SchedulePayloadArgs): Record<string, unknown> {
  const start = toIsoDate(args.startDate);
  const end = toIsoDate(args.endDate);
  if (!start) throw new SchedulePayloadError('Fecha de inicio inválida.');
  if (!end) throw new SchedulePayloadError('Fecha fin inválida.');
  if (end < start) {
    throw new SchedulePayloadError(
      `La fecha fin del proyecto (${end}) es anterior a la fecha de inicio de la planificación (${start}).`,
    );
  }
  return {
    schedule: {
      name: args.name ?? SCHEDULE_NAME,
      list_template_id: Number(args.templateId),
      start_date: start,
      end_date: end,
      ...quarterlyRecurrenceFields(start),
    },
  };
}

/** TODO(verify) [Checklist Schedules → Update]. */
export function buildScheduleEndDatePatch(endDate: string): Record<string, unknown> {
  return { schedule: { end_date: endDate } };
}

// ─── Lectura de respuestas ────────────────────────────────────────────────────

/**
 * Id de un objeto devuelto por Procore. TODO(verify): forma de las respuestas de
 * creación. Acepta { id }, { data: { id } } y un objeto envuelto por su tipo,
 * p. ej. { list_template: { id } } o { section: { id } }.
 */
export function extractId(resp: unknown): string | null {
  const direct = (o: unknown): string | null => {
    if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;
    const raw = (o as Record<string, unknown>).id;
    return typeof raw === 'number' || (typeof raw === 'string' && raw !== '') ? String(raw) : null;
  };
  if (typeof resp !== 'object' || resp === null || Array.isArray(resp)) return null;
  const top = direct(resp);
  if (top) return top;
  const r = resp as Record<string, unknown>;
  const fromData = direct(r.data);
  if (fromData) return fromData;
  // Un único objeto anidado con id (envoltorio por tipo).
  const nested = Object.values(r).map(direct).filter((x): x is string => x !== null);
  return nested.length === 1 ? nested[0]! : null;
}

export function extractName(obj: unknown): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const n = (obj as Record<string, unknown>).name;
  return typeof n === 'string' ? n : null;
}

/** TODO(verify): fecha fin del schedule en la respuesta (List/Show). */
export function extractScheduleEndDate(schedule: unknown): string | null {
  if (typeof schedule !== 'object' || schedule === null) return null;
  return toIsoDate((schedule as Record<string, unknown>).end_date);
}

export interface ChecklistItemRef {
  id: string;
  name: string;
  sectionName: string | null;
}

/**
 * TODO(verify) [Checklists → Show]: se asume { sections: [{ name, items: [{ id, name }] }] }.
 * También acepta { items: [...] } plano por si la API lo devuelve así.
 */
export function extractChecklistItems(list: unknown): ChecklistItemRef[] {
  if (typeof list !== 'object' || list === null) return [];
  const l = list as Record<string, unknown>;
  const out: ChecklistItemRef[] = [];
  const pushItems = (items: unknown, sectionName: string | null) => {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      const id = extractId(it);
      const name = extractName(it);
      if (id && name) out.push({ id, name, sectionName });
    }
  };
  if (Array.isArray(l.sections)) {
    for (const s of l.sections) {
      if (typeof s === 'object' && s !== null) {
        pushItems((s as Record<string, unknown>).items, extractName(s));
      }
    }
  }
  pushItems(l.items, null);
  return out;
}

// ─── Enlaces a la web de Procore ──────────────────────────────────────────────

/** VERIFIED: patrón /:project_id/project/checklists/lists/:id (Side Panel View Keys → Inspections). */
export function checklistWebUrl(webBase: string, projectId: Id, listId: Id): string {
  return `${webBase}/${enc(projectId)}/project/checklists/lists/${enc(listId)}`;
}

/** TODO(verify): URL de una plantilla de proyecto en la web. */
export function templateWebUrl(webBase: string, projectId: Id, templateId: Id): string {
  return `${webBase}/${enc(projectId)}/project/checklists/list_templates/${enc(templateId)}`;
}

/** TODO(verify): URL de las inspecciones planificadas; se enlaza a la herramienta Inspections. */
export function scheduleWebUrl(webBase: string, projectId: Id): string {
  return `${webBase}/${enc(projectId)}/project/checklists`;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * TODO(verify): nombre del recurso de webhook cuando cambia un proyecto
 * (Webhook Resources list / CSV). "Projects" es el candidato principal.
 */
export const PROJECT_WEBHOOK_RESOURCES = ['Projects', 'Project Dates'] as const;
