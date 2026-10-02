/**
 * Orquestación de "Crear". Sin dependencias de React: recibe el cliente de
 * Procore inyectado, así que se testea con un cliente falso.
 *
 *   prepare()  → lee proyecto (fecha fin) y busca duplicados por nombre.
 *   execute()  → plantilla (+secciones/ítems) → inspección → respuestas → planificada.
 *
 * Si un paso falla se detiene, se marca el resto como "omitido" y el resultado
 * indica qué se creó y qué no.
 */
import { normalizeForSearch } from './catalog.js';
import { todayIso } from './dates.js';
import { ProcoreApiError, type ProcoreClient, type ProcoreObject } from './procore.js';
import {
  INSPECTION_NAME,
  SCHEDULE_NAME,
  TEMPLATE_NAME,
  buildChecklistPayload,
  buildItemPayload,
  buildItemResponsePayload,
  buildScheduleEndDatePatch,
  buildSchedulePayload,
  buildSectionPayload,
  buildTemplatePayload,
  checklistWebUrl,
  extractChecklistItems,
  extractId,
  extractName,
  extractScheduleEndDate,
  resolveProjectEndDate,
  scheduleWebUrl,
  templateWebUrl,
} from './procoreSpec.js';
import type { PlannedSection } from './selection.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type StepId = 'template' | 'inspection' | 'responses' | 'schedule';
export type StepStatus = 'pending' | 'running' | 'done' | 'reused' | 'warning' | 'failed' | 'skipped';

export interface StepState {
  id: StepId;
  label: string;
  status: StepStatus;
  detail?: string;
  url?: string;
}

export interface ExistingRef {
  id: string;
  name: string;
}

export interface ExistingObjects {
  template?: ExistingRef;
  inspection?: ExistingRef;
  schedule?: ExistingRef & { endDate: string | null };
}

export interface Prepared {
  projectName: string | null;
  endDate: string;
  endDateField: string;
  existing: ExistingObjects;
}

export class PreconditionError extends Error {}

export const STEP_LABELS: Record<StepId, string> = {
  template: 'Plantilla de inspección',
  inspection: `Inspección "${INSPECTION_NAME}"`,
  responses: 'Valores objetivo',
  schedule: 'Inspección planificada trimestral',
};

export function initialSteps(): StepState[] {
  return (Object.keys(STEP_LABELS) as StepId[]).map((id) => ({ id, label: STEP_LABELS[id], status: 'pending' }));
}

export function hasExisting(e: ExistingObjects): boolean {
  return Boolean(e.template || e.inspection || e.schedule);
}

// ─── Errores legibles ─────────────────────────────────────────────────────────

/** Texto breve de la respuesta de Procore (para mostrar al usuario). */
function procoreDetail(e: ProcoreApiError): string {
  return e.message && !/^Error HTTP \d+$/.test(e.message) ? e.message : '';
}

export function describeError(e: unknown): string {
  if (e instanceof ProcoreApiError) {
    const where = e.request ? ` [${e.request.method} ${e.request.path}]` : '';
    const detail = procoreDetail(e);
    switch (e.status) {
      case 401:
        return 'La sesión con Procore ha caducado. Vuelve a conectar.';
      case 403:
        return `No tienes permisos suficientes en Procore para esta acción (revisa los permisos de Inspections/Projects)${where}.`;
      case 404:
        return `Procore respondió 404 (no encontrado)${where}.${detail ? ` ${detail}` : ''}`;
      case 422: {
        const hint = /list_template/i.test(detail)
          ? ' Puede que la plantilla esté vacía o incompleta por un intento anterior: elimínala en Procore (Inspecciones → Plantillas) y vuelve a crear.'
          : '';
        return `Procore rechazó los datos enviados${where}: ${detail || 'sin detalle'}.${hint}`;
      }
      case 429:
        return 'Se alcanzó el límite de peticiones de Procore. Espera un momento e inténtalo de nuevo.';
      default:
        return e.status >= 500
          ? `Procore no está disponible ahora mismo (${e.status})${where}.`
          : `Error ${e.status}${where}: ${detail || e.message}`;
    }
  }
  if (e instanceof Error) return e.message;
  return 'Error desconocido.';
}

// ─── Reintentos por propagación ───────────────────────────────────────────────

/** Esperas entre reintentos cuando un objeto recién creado aún no es visible. */
export const PROPAGATION_DELAYS_MS = [1500, 3000, 5000];

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reintenta `fn` si Procore responde 404, o 422 que menciona `list_template`,
 * justo después de crear el objeto del que depende (consistencia eventual).
 */
export async function retryWhileNotVisible<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  delays: readonly number[] = PROPAGATION_DELAYS_MS,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient =
        e instanceof ProcoreApiError && (e.status === 404 || (e.status === 422 && /list_template/i.test(e.message)));
      if (!transient || i >= delays.length) throw e;
      await sleep(delays[i]!);
    }
  }
}

// ─── Fase 1: preparar ─────────────────────────────────────────────────────────

function sameName(a: string | null, b: string): boolean {
  return a !== null && normalizeForSearch(a) === normalizeForSearch(b);
}

function findByName(list: ProcoreObject[], name: string): ExistingRef | undefined {
  for (const o of list) {
    const id = extractId(o);
    const n = extractName(o);
    if (id && sameName(n, name)) return { id, name: n as string };
  }
  return undefined;
}

export async function findExisting(client: ProcoreClient, projectId: string): Promise<ExistingObjects> {
  const [templates, lists, schedules] = await Promise.all([
    client.listProjectTemplates(projectId),
    client.listChecklists(projectId),
    client.listSchedules(projectId),
  ]);
  const existing: ExistingObjects = {};
  const t = findByName(templates, TEMPLATE_NAME);
  if (t) existing.template = t;
  const i = findByName(lists, INSPECTION_NAME);
  if (i) existing.inspection = i;
  const s = findByName(schedules, SCHEDULE_NAME);
  if (s) {
    const raw = schedules.find((o) => extractId(o) === s.id);
    existing.schedule = { ...s, endDate: extractScheduleEndDate(raw) };
  }
  return existing;
}

export async function prepare(
  client: ProcoreClient,
  companyId: string,
  projectId: string,
  today: string = todayIso(),
): Promise<Prepared> {
  const project = await client.getProject(companyId, projectId);
  const end = resolveProjectEndDate(project);
  if (!end) {
    throw new PreconditionError(
      'El proyecto no tiene fecha de finalización definida en Procore. Añádela en la configuración del proyecto y vuelve a intentarlo. No se ha creado nada.',
    );
  }
  if (end.date < today) {
    throw new PreconditionError(
      `La fecha de finalización del proyecto (${end.date}) ya pasó; no se puede planificar una medición trimestral. No se ha creado nada.`,
    );
  }
  const existing = await findExisting(client, projectId);
  return { projectName: extractName(project), endDate: end.date, endDateField: end.field, existing };
}

// ─── Fase 2: ejecutar ─────────────────────────────────────────────────────────

export interface ExecuteInput {
  client: ProcoreClient;
  projectId: string;
  sections: PlannedSection[];
  prepared: Prepared;
  /** true → reutilizar los objetos existentes con el mismo nombre. */
  reuseExisting: boolean;
  webBase: string;
  today?: string;
  onProgress?: (steps: StepState[]) => void;
  /** Inyectable para tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ExecuteResult {
  ok: boolean;
  steps: StepState[];
  /** Resumen en lenguaje natural de lo creado / no creado. */
  summary: string[];
}

/** Busca por nombre la plantilla recién creada (la más reciente = id mayor), con reintentos. */
async function findCreatedTemplate(
  client: ProcoreClient,
  projectId: string,
  sleep: (ms: number) => Promise<void>,
): Promise<string | null> {
  for (let i = 0; i <= PROPAGATION_DELAYS_MS.length; i++) {
    const templates = await client.listProjectTemplates(projectId);
    const ids = templates
      .filter((t) => sameName(extractName(t), TEMPLATE_NAME))
      .map((t) => extractId(t))
      .filter((x): x is string => x !== null)
      .sort((a, b) => Number(b) - Number(a));
    if (ids[0]) return ids[0];
    if (i < PROPAGATION_DELAYS_MS.length) await sleep(PROPAGATION_DELAYS_MS[i]!);
  }
  return null;
}

export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const { client, projectId, sections, prepared, webBase } = input;
  const reuse = input.reuseExisting;
  const existing = prepared.existing;
  const today = input.today ?? todayIso();
  const sleep = input.sleep ?? defaultSleep;
  const retry = <T,>(fn: () => Promise<T>) => retryWhileNotVisible(fn, sleep);
  const steps = initialSteps();
  const summary: string[] = [];

  const update = (id: StepId, patch: Partial<StepState>) => {
    const s = steps.find((x) => x.id === id)!;
    Object.assign(s, patch);
    input.onProgress?.(steps.map((x) => ({ ...x })));
  };

  let current: StepId = 'template';
  try {
    // 1. Plantilla con una sección por dominio y un ítem por elemento.
    current = 'template';
    update('template', { status: 'running' });
    let templateId: string;
    if (reuse && existing.template) {
      templateId = existing.template.id;
      update('template', {
        status: 'reused',
        detail: 'Se reutiliza la plantilla existente (sus ítems pueden diferir de la selección actual).',
        url: templateWebUrl(webBase, projectId, templateId),
      });
      summary.push(`Plantilla reutilizada (id ${templateId}).`);
    } else {
      const tpl = await client.createProjectTemplate(projectId, buildTemplatePayload());
      let id = extractId(tpl);
      if (!id) {
        // La respuesta no trae el id reconocible: se busca la plantilla recién creada por nombre.
        id = await findCreatedTemplate(client, projectId, sleep);
      }
      if (!id) {
        throw new Error(
          'Procore creó la plantilla pero no se pudo obtener su id. Revisa el registro técnico y elimina la plantilla en Procore antes de reintentar.',
        );
      }
      templateId = id;
      const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
      let createdItems = 0;
      try {
        for (const [si, section] of sections.entries()) {
          const sec = await retry(() =>
            client.createTemplateSection(projectId, templateId, buildSectionPayload(section.name, si + 1)),
          );
          const sectionId = extractId(sec);
          if (!sectionId) throw new Error(`Procore no devolvió el id de la sección "${section.name}".`);
          for (const [ii, item] of section.items.entries()) {
            await retry(() => client.createTemplateItem(projectId, templateId, sectionId, buildItemPayload(item, ii + 1)));
            createdItems++;
          }
        }
      } catch (e) {
        summary.push(
          `Plantilla creada (id ${templateId}) pero incompleta: ${createdItems} de ${totalItems} ítems. Revísala o elimínala en Procore.`,
        );
        throw e;
      }
      update('template', {
        status: 'done',
        detail: `${sections.length} secciones, ${totalItems} ítems.`,
        url: templateWebUrl(webBase, projectId, templateId),
      });
      summary.push(`Plantilla creada (id ${templateId}) con ${sections.length} secciones y ${totalItems} ítems.`);
    }

    // 2. Inspección "Reporte de objetivos" desde la plantilla.
    current = 'inspection';
    update('inspection', { status: 'running' });
    let listId: string;
    if (reuse && existing.inspection) {
      listId = existing.inspection.id;
      update('inspection', {
        status: 'reused',
        detail: 'Se reutiliza la inspección existente; se actualizarán sus valores.',
        url: checklistWebUrl(webBase, projectId, listId),
      });
      summary.push(`Inspección "${INSPECTION_NAME}" reutilizada (id ${listId}).`);
    } else {
      const list = await retry(() => client.createChecklist(projectId, buildChecklistPayload({ projectId, templateId })));
      const id = extractId(list);
      if (!id) throw new Error('Procore no devolvió el id de la inspección.');
      listId = id;
      update('inspection', { status: 'done', url: checklistWebUrl(webBase, projectId, listId) });
      summary.push(`Inspección "${INSPECTION_NAME}" creada (id ${listId}).`);
    }

    // 3. Valores objetivo como respuesta de cada ítem (emparejados por nombre).
    current = 'responses';
    update('responses', { status: 'running' });
    const detail = await retry(() => client.getChecklist(projectId, listId));
    const listItems = extractChecklistItems(detail);
    const planned = sections.flatMap((s) => s.items.map((it) => ({ ...it, sectionName: s.name })));
    let written = 0;
    const missing: string[] = [];
    for (const p of planned) {
      const match =
        listItems.find((li) => sameName(li.name, p.name) && (li.sectionName === null || sameName(li.sectionName, p.sectionName))) ??
        listItems.find((li) => sameName(li.name, p.name));
      if (!match) {
        missing.push(p.name);
        continue;
      }
      await client.createItemResponse(projectId, listId, match.id, buildItemResponsePayload(p.valueType, p.target));
      written++;
    }
    if (written === 0 && planned.length > 0) {
      throw new Error('No se encontró en la inspección ningún ítem que coincida con la selección.');
    }
    if (missing.length > 0) {
      update('responses', {
        status: 'warning',
        detail: `${written} valores cargados. Sin ítem correspondiente: ${missing.join(', ')}.`,
      });
      summary.push(`Valores objetivo: ${written} cargados, ${missing.length} sin ítem correspondiente.`);
    } else {
      update('responses', { status: 'done', detail: `${written} valores cargados.` });
      summary.push(`Valores objetivo cargados: ${written}.`);
    }

    // 4. Inspección planificada trimestral hasta la fecha fin del proyecto.
    current = 'schedule';
    update('schedule', { status: 'running' });
    if (reuse && existing.schedule) {
      const sid = existing.schedule.id;
      if (existing.schedule.endDate !== prepared.endDate) {
        await client.updateSchedule(projectId, sid, buildScheduleEndDatePatch(prepared.endDate));
        update('schedule', {
          status: 'reused',
          detail: `Se reutiliza la planificación existente; fecha fin actualizada a ${prepared.endDate}.`,
          url: scheduleWebUrl(webBase, projectId),
        });
      } else {
        update('schedule', {
          status: 'reused',
          detail: 'Se reutiliza la planificación existente.',
          url: scheduleWebUrl(webBase, projectId),
        });
      }
      summary.push(`Planificación trimestral reutilizada (id ${sid}).`);
    } else {
      const payload = buildSchedulePayload({ templateId, startDate: today, endDate: prepared.endDate });
      const sch = await retry(() => client.createSchedule(projectId, payload));
      const sid = extractId(sch);
      update('schedule', {
        status: 'done',
        detail: `Trimestral desde ${today} hasta ${prepared.endDate}.`,
        url: scheduleWebUrl(webBase, projectId),
      });
      summary.push(`Planificación trimestral creada${sid ? ` (id ${sid})` : ''} hasta ${prepared.endDate}.`);
    }

    return { ok: true, steps, summary };
  } catch (e) {
    update(current, { status: 'failed', detail: describeError(e) });
    for (const s of steps) if (s.status === 'pending') s.status = 'skipped';
    input.onProgress?.(steps.map((x) => ({ ...x })));
    summary.push(`Falló el paso "${STEP_LABELS[current]}": ${describeError(e)}`);
    const notCreated = steps.filter((s) => s.status === 'skipped').map((s) => s.label);
    if (notCreated.length) summary.push(`No se creó: ${notCreated.join(', ')}.`);
    return { ok: false, steps, summary };
  }
}
