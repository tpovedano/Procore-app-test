/**
 * ════════════════════════════════════════════════════════════════════════════
 *  CONTRATO CON LA API DE PROCORE: único lugar con rutas, campos y payloads.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Verificado contra la referencia REST de Procore (skill /procore-api, área
 * "Project Management / Inspections" y "Core / Portfolio"). Cada endpoint indica
 * su nombre en la referencia. Lo que la referencia NO detalla está marcado con
 * TODO(verify) y se resuelve en tiempo de ejecución probando variantes:
 *   · valor de `type` de un ítem de plantilla (se toma de List Checklist Item Types).
 *
 * Flujo de plantilla (la API no permite añadir secciones/ítems a una plantilla
 * de proyecto; sí a una de compañía, que luego se copia al proyecto):
 *   1. Create Company Checklist Template
 *   2. Create Company Checklist Template Section (una por dominio)
 *   3. Create Company Inspection Template Item (uno por elemento, con section_id)
 *   4. Create a Project Checklist Template from a Company Checklist Template
 *   5. Delete Company Checklist Template (limpieza; la copia de proyecto es independiente)
 */

import type { ValueType } from './catalog.js';
import { toIsoDate } from './dates.js';
import type { PlannedItem } from './selection.js';

// ─── Nombres de los objetos que crea la app ──────────────────────────────────

/**
 * La inspección toma el nombre de su plantilla (Create Checklist no admite `name`
 * en `list`), así que la plantilla se llama igual que la inspección pedida.
 */
export const INSPECTION_NAME = 'Reporte de objetivos';
export const TEMPLATE_NAME = INSPECTION_NAME;
export const SCHEDULE_NAME = 'Medición trimestral de objetivos';

// ─── Endpoints ────────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Id = number | string;

const enc = (v: Id) => encodeURIComponent(String(v));

/** Rutas (sin query). Entre corchetes, el nombre del endpoint en la referencia. */
export const paths = {
  /** [Show me] */
  me: () => '/rest/v1.0/me',
  /** [Show project] query: company_id* */
  showProject: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}`,

  /** [List / Create Company Checklist Template] */
  companyTemplates: (companyId: Id) => `/rest/v1.0/companies/${enc(companyId)}/checklist/list_templates`,
  /** [Show / Delete Company Checklist Template] */
  companyTemplate: (companyId: Id, templateId: Id) =>
    `/rest/v1.0/companies/${enc(companyId)}/checklist/list_templates/${enc(templateId)}`,
  /** [List / Create Company Checklist Template Section] body: section*{name,position} */
  companyTemplateSections: (companyId: Id, templateId: Id) =>
    `/rest/v1.0/companies/${enc(companyId)}/checklist/list_templates/${enc(templateId)}/sections`,
  /** [List / Create Company Inspection Template Item] body: inspection_template_item*{name,position,section_id,type,…} */
  companyTemplateItems: (companyId: Id, templateId: Id) =>
    `/rest/v1.0/companies/${enc(companyId)}/inspection_templates/${enc(templateId)}/items`,

  /** [List Project Checklist Templates] */
  projectTemplates: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}/checklist/list_templates`,
  /** [Show / Delete Project Checklist Template] */
  projectTemplate: (projectId: Id, templateId: Id) =>
    `/rest/v1.0/projects/${enc(projectId)}/checklist/list_templates/${enc(templateId)}`,
  /** [Create a Project Checklist Template from a Company Checklist Template] body: source_template_id* */
  projectTemplateFromCompany: (projectId: Id) =>
    `/rest/v1.0/projects/${enc(projectId)}/checklist/list_templates/create_from_company_template`,

  /** [List Available Checklist Item Types] query: company_id (o project_id) */
  itemTypes: () => '/rest/v1.0/checklist/item_types',

  /** [List / Create Checklist (Inspection)] body: list_template_id*, list*{…} */
  projectLists: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}/checklist/lists`,
  /** [List Checklist (Inspections) Items] query: filters[list_id] */
  listItems: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}/checklist/list_items`,
  /** [List Checklist (Inspection) Sections] query: filters[list_id] */
  listSections: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}/checklist/list_sections`,
  /** [Create Checklist Item Response] body: item_response*{text_value,number_value,…} */
  itemResponse: (projectId: Id, itemId: Id) =>
    `/rest/v1.0/projects/${enc(projectId)}/checklist/items/${enc(itemId)}/item_response`,

  /** [List / Create a Checklist (Inspection) Schedule] */
  schedules: (projectId: Id) => `/rest/v1.0/projects/${enc(projectId)}/checklist/schedules`,
  /** [Update a Checklist (Inspection) Schedule] */
  schedule: (projectId: Id, scheduleId: Id) =>
    `/rest/v1.0/projects/${enc(projectId)}/checklist/schedules/${enc(scheduleId)}`,
};

/**
 * Allowlist del proxy serverless: solo estas combinaciones método+ruta llegan a
 * Procore (ids numéricos). Corresponde 1:1 con `paths`.
 */
const P = '\\/rest\\/v1\\.0';
const re = (s: string) => new RegExp(`^${P}${s}$`);
export const PROXY_ALLOWLIST: ReadonlyArray<{ method: HttpMethod; pattern: RegExp }> = [
  { method: 'GET', pattern: re('\\/me') },
  { method: 'GET', pattern: re('\\/projects\\/\\d+') },
  { method: 'GET', pattern: re('\\/companies\\/\\d+\\/checklist\\/list_templates') },
  { method: 'POST', pattern: re('\\/companies\\/\\d+\\/checklist\\/list_templates') },
  { method: 'GET', pattern: re('\\/companies\\/\\d+\\/checklist\\/list_templates\\/\\d+') },
  { method: 'DELETE', pattern: re('\\/companies\\/\\d+\\/checklist\\/list_templates\\/\\d+') },
  { method: 'GET', pattern: re('\\/companies\\/\\d+\\/checklist\\/list_templates\\/\\d+\\/sections') },
  { method: 'POST', pattern: re('\\/companies\\/\\d+\\/checklist\\/list_templates\\/\\d+\\/sections') },
  { method: 'GET', pattern: re('\\/companies\\/\\d+\\/inspection_templates\\/\\d+\\/items') },
  { method: 'POST', pattern: re('\\/companies\\/\\d+\\/inspection_templates\\/\\d+\\/items') },
  { method: 'GET', pattern: re('\\/projects\\/\\d+\\/checklist\\/list_templates') },
  { method: 'GET', pattern: re('\\/projects\\/\\d+\\/checklist\\/list_templates\\/\\d+') },
  { method: 'DELETE', pattern: re('\\/projects\\/\\d+\\/checklist\\/list_templates\\/\\d+') },
  { method: 'POST', pattern: re('\\/projects\\/\\d+\\/checklist\\/list_templates\\/create_from_company_template') },
  { method: 'GET', pattern: re('\\/checklist\\/item_types') },
  { method: 'GET', pattern: re('\\/projects\\/\\d+\\/checklist\\/lists') },
  { method: 'POST', pattern: re('\\/projects\\/\\d+\\/checklist\\/lists') },
  { method: 'GET', pattern: re('\\/projects\\/\\d+\\/checklist\\/list_items') },
  { method: 'GET', pattern: re('\\/projects\\/\\d+\\/checklist\\/list_sections') },
  { method: 'POST', pattern: re('\\/projects\\/\\d+\\/checklist\\/items\\/\\d+\\/item_response') },
  { method: 'GET', pattern: re('\\/projects\\/\\d+\\/checklist\\/schedules') },
  { method: 'POST', pattern: re('\\/projects\\/\\d+\\/checklist\\/schedules') },
  { method: 'PATCH', pattern: re('\\/projects\\/\\d+\\/checklist\\/schedules\\/\\d+') },
];

export function isAllowedRequest(method: string, path: string): boolean {
  return PROXY_ALLOWLIST.some((r) => r.method === method && r.pattern.test(path));
}

// ─── Proyecto: fecha fin ──────────────────────────────────────────────────────

/** Campos de fecha fin de [Show project], en orden de preferencia. */
export const PROJECT_END_DATE_FIELDS = ['completion_date', 'estimated_completion_date'] as const;

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

// ─── Payloads ─────────────────────────────────────────────────────────────────

/** [Create Company Checklist Template] list_template*{name, description, …} */
export function buildTemplatePayload(name: string = TEMPLATE_NAME): Record<string, unknown> {
  return {
    list_template: {
      name,
      description: 'Generada por la app "Objetivos" a partir del catálogo de elementos.',
    },
  };
}

/** [Create Company Checklist Template Section] section*{name, position} */
export function buildSectionPayload(name: string, position: number): Record<string, unknown> {
  return { section: { name, position } };
}

/**
 * [Create Company Inspection Template Item]
 * inspection_template_item*{name, details, optional, position, section_id, type, response_set_id}
 * `type` se omite si no se pudo determinar (Procore aplica su tipo por defecto).
 */
export function buildTemplateItemPayload(
  item: Pick<PlannedItem, 'name'>,
  position: number,
  sectionId: Id,
  type?: string,
): Record<string, unknown> {
  return {
    inspection_template_item: {
      name: item.name,
      position,
      section_id: Number(sectionId),
      ...(type ? { type } : {}),
    },
  };
}

/** [Create a Project Checklist Template from a Company Checklist Template] source_template_id* */
export function buildCopyFromCompanyPayload(companyTemplateId: Id): Record<string, unknown> {
  return { source_template_id: Number(companyTemplateId) };
}

/**
 * [Create Checklist (Inspection)] list_template_id*, list*{…}.
 * `list` no admite nombre: la inspección se llama como la plantilla.
 */
export function buildChecklistPayload(args: { templateId: Id; inspectionDate?: string }): Record<string, unknown> {
  return {
    list_template_id: Number(args.templateId),
    list: {
      description: 'Valores objetivo generados por la app "Objetivos".',
      ...(args.inspectionDate ? { inspection_date: args.inspectionDate } : {}),
    },
  };
}

/** [Create Checklist Item Response] item_response*{text_value | number_value} */
export function buildItemResponsePayload(valueType: ValueType, value: number | string): Record<string, unknown> {
  return {
    item_response: valueType === 'number' ? { number_value: Number(value) } : { text_value: String(value) },
  };
}

/**
 * Valores de `frequency` confirmados por la respuesta de validación de Procore:
 * once, daily, weekly, once_every_two_weeks, monthly, quarterly, twice_yearly, yearly.
 */
export const SCHEDULE_FREQUENCY = 'quarterly';

/** Días de antelación con que Procore crea cada inspección antes de su vencimiento (obligatorio). */
export const DAYS_CREATED_BEFORE_DUE_DATE = 7;

/** `first_inspection_due_at` debe ser un timestamp: se usa el mediodía UTC para no cambiar de día por zona horaria. */
export function toScheduleTimestamp(isoDate: string): string {
  return `${isoDate}T12:00:00Z`;
}

export interface SchedulePayloadArgs {
  templateId: Id;
  /** Vencimiento de la primera inspección planificada (YYYY-MM-DD). */
  firstDueDate: string;
  endDate: string;
  name?: string;
}

export class SchedulePayloadError extends Error {}

/**
 * [Create a Checklist (Inspection) Schedule]
 * schedule*{name, private, days_created_before_due_date, inspection_template_id,
 *           first_inspection_due_at (timestamp), ends_at, frequency}
 * `private` y `days_created_before_due_date` son obligatorios (respuesta 400 de Procore).
 */
export function buildSchedulePayload(args: SchedulePayloadArgs): Record<string, unknown> {
  const first = toIsoDate(args.firstDueDate);
  const end = toIsoDate(args.endDate);
  if (!first) throw new SchedulePayloadError('Fecha de la primera inspección inválida.');
  if (!end) throw new SchedulePayloadError('Fecha fin inválida.');
  if (end < first) {
    throw new SchedulePayloadError(
      `La fecha fin del proyecto (${end}) es anterior a la primera inspección planificada (${first}).`,
    );
  }
  return {
    schedule: {
      name: args.name ?? SCHEDULE_NAME,
      private: false,
      days_created_before_due_date: DAYS_CREATED_BEFORE_DUE_DATE,
      inspection_template_id: Number(args.templateId),
      first_inspection_due_at: toScheduleTimestamp(first),
      ends_at: end,
      frequency: SCHEDULE_FREQUENCY,
    },
  };
}

/** [Update a Checklist (Inspection) Schedule] schedule*{ends_at, …} */
export function buildScheduleEndDatePatch(endDate: string): Record<string, unknown> {
  return { schedule: { ends_at: endDate } };
}

// ─── Tipos de ítem ────────────────────────────────────────────────────────────

/**
 * Valores candidatos para `type` a partir de [List Available Checklist Item Types].
 * TODO(verify): la referencia no detalla el esquema de respuesta; se buscan objetos
 * cuyo identificador o nombre indique número/texto y se prueban sus valores.
 */
export function itemTypeCandidates(itemTypes: unknown, valueType: ValueType): string[] {
  const match = valueType === 'number' ? /n[uú]mer|numeric|number/i : /text|texto/i;
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && !out.includes(v)) out.push(v);
  };
  if (Array.isArray(itemTypes)) {
    for (const t of itemTypes) {
      if (typeof t === 'string') {
        if (match.test(t)) add(t);
        continue;
      }
      if (typeof t !== 'object' || t === null) continue;
      const o = t as Record<string, unknown>;
      const labels = ['type', 'key', 'value', 'name', 'label'].map((k) => o[k]).filter((v) => typeof v === 'string');
      if (!labels.some((l) => match.test(l as string))) continue;
      for (const k of ['type', 'key', 'value', 'name']) add(o[k]);
    }
  }
  return out;
}

// ─── Lectura de respuestas ────────────────────────────────────────────────────

/** Id de un objeto devuelto por Procore: { id }, { data: { id } } o envuelto por tipo. */
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
  const nested = Object.values(r).map(direct).filter((x): x is string => x !== null);
  return nested.length === 1 ? nested[0]! : null;
}

export function extractName(obj: unknown): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const n = (obj as Record<string, unknown>).name;
  return typeof n === 'string' ? n : null;
}

/** Colección de una respuesta: array directo o { data: [...] }. */
export function asArray(data: unknown): Record<string, unknown>[] {
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : [];
  return arr.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
}

/** Fecha fin de un schedule ([List/Show Checklist Schedule] → ends_at). */
export function extractScheduleEndDate(schedule: unknown): string | null {
  if (typeof schedule !== 'object' || schedule === null) return null;
  return toIsoDate((schedule as Record<string, unknown>).ends_at);
}

export interface ChecklistItemRef {
  id: string;
  name: string;
  sectionName: string | null;
}

/**
 * Ítems de una inspección a partir de [List Checklist (Inspections) Items]
 * (filtrado por list_id) y, si se tienen, sus secciones ([List Checklist (Inspection) Sections]).
 */
export function extractListItems(items: unknown, sections?: unknown): ChecklistItemRef[] {
  const sectionNames = new Map<string, string>();
  for (const s of asArray(sections)) {
    const id = extractId(s);
    const name = extractName(s);
    if (id && name) sectionNames.set(id, name);
  }
  const out: ChecklistItemRef[] = [];
  for (const it of asArray(items)) {
    const id = extractId(it);
    const name = extractName(it);
    if (!id || !name) continue;
    const sid = it.section_id ?? (it.section as { id?: unknown } | undefined)?.id;
    const sectionName =
      typeof sid === 'number' || typeof sid === 'string' ? (sectionNames.get(String(sid)) ?? null) : null;
    out.push({ id, name, sectionName });
  }
  return out;
}

// ─── Enlaces a la web de Procore ──────────────────────────────────────────────

/** Patrón /:project_id/project/checklists/lists/:id (Side Panel View Keys → Inspections). */
export function checklistWebUrl(webBase: string, projectId: Id, listId: Id): string {
  return `${webBase}/${enc(projectId)}/project/checklists/lists/${enc(listId)}`;
}

/** TODO(verify): URL web de una plantilla de proyecto. */
export function templateWebUrl(webBase: string, projectId: Id, templateId: Id): string {
  return `${webBase}/${enc(projectId)}/project/checklists/list_templates/${enc(templateId)}`;
}

/** Herramienta Inspections del proyecto (allí están las planificadas). */
export function scheduleWebUrl(webBase: string, projectId: Id): string {
  return `${webBase}/${enc(projectId)}/project/checklists`;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/** TODO(verify): nombre del recurso de webhook cuando cambia un proyecto (Webhook Resources). */
export const PROJECT_WEBHOOK_RESOURCES = ['Projects', 'Project Dates'] as const;
