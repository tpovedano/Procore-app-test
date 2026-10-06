/**
 * Orquestación de "Crear". Sin dependencias de React: recibe el cliente de
 * Procore inyectado, así que se testea con un cliente falso.
 *
 *   prepare()  → lee el proyecto (fecha fin) y busca duplicados por nombre.
 *   execute()  → plantilla → inspección → valores objetivo → planificada.
 *
 * Plantilla (endpoints verificados en la referencia de Procore):
 *   1. Create Company Checklist Template
 *   2. Create Company Checklist Template Section          (una por dominio)
 *   3. Create Company Inspection Template Item             (uno por elemento, con section_id)
 *   4. Create a Project Checklist Template from a Company Checklist Template (copia secciones e ítems)
 *   5. Delete Company Checklist Template                  (limpieza)
 * La inspección y la planificada usan la plantilla de PROYECTO resultante.
 *
 * Si un paso falla se detiene, se limpia lo que quedó a medias de la plantilla,
 * se marca el resto como "omitido" y el resultado indica qué se creó y qué no.
 */
import { normalizeForSearch, type ValueType } from './catalog.js';
import { todayIso } from './dates.js';
import { ProcoreApiError, type ProcoreClient, type ProcoreObject } from './procore.js';
import {
  INSPECTION_NAME,
  QUARTERLY_FREQUENCY_CANDIDATES,
  SCHEDULE_NAME,
  TEMPLATE_NAME,
  asArray,
  buildChecklistPayload,
  buildCopyFromCompanyPayload,
  buildItemResponsePayload,
  buildScheduleEndDatePatch,
  buildSchedulePayload,
  buildSectionPayload,
  buildTemplateItemPayload,
  buildTemplatePayload,
  checklistWebUrl,
  extractId,
  extractListItems,
  extractName,
  extractScheduleEndDate,
  itemTypeCandidates,
  resolveProjectEndDate,
  scheduleWebUrl,
  templateWebUrl,
  type ChecklistItemRef,
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
  /** Plantilla de proyecto (la que usan inspección y planificada). */
  template?: ExistingRef;
  /** Plantilla de compañía con el mismo nombre (resto de una ejecución anterior). */
  companyTemplate?: ExistingRef;
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
export class TemplateNotPopulatedError extends Error {}

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
  return Boolean(e.template || e.companyTemplate || e.inspection || e.schedule);
}

// ─── Errores legibles ─────────────────────────────────────────────────────────

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
        return `No tienes permisos suficientes en Procore para esta acción (Inspections de compañía y de proyecto)${where}.`;
      case 404:
        return `Procore respondió 404 (no encontrado)${where}.${detail ? ` ${detail}` : ''}`;
      case 422:
        return `Procore rechazó los datos enviados${where}: ${detail || 'sin detalle'}.`;
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

// ─── Reintentos ───────────────────────────────────────────────────────────────

/** Esperas entre reintentos cuando un objeto recién creado aún no es visible. */
export const PROPAGATION_DELAYS_MS = [1500, 3000, 5000];

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reintenta `fn` si Procore responde 404, o 422 que menciona `template`, justo
 * después de crear el objeto del que depende (consistencia eventual).
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
        e instanceof ProcoreApiError && (e.status === 404 || (e.status === 422 && /template/i.test(e.message)));
      if (!transient || i >= delays.length) throw e;
      await sleep(delays[i]!);
    }
  }
}

const isValidationError = (e: unknown) => e instanceof ProcoreApiError && (e.status === 400 || e.status === 422);

/**
 * Prueba variantes en orden: un 400/422 (no crea nada) pasa a la siguiente;
 * cualquier otro error se propaga. Devuelve el resultado y el índice que funcionó.
 */
async function firstAccepted<T>(attempts: (() => Promise<T>)[]): Promise<{ value: T; index: number }> {
  let last: unknown = new Error('Sin variantes que probar.');
  for (const [index, attempt] of attempts.entries()) {
    try {
      return { value: await attempt(), index };
    } catch (e) {
      if (!isValidationError(e)) throw e;
      last = e;
    }
  }
  throw last;
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

/** Id más reciente (mayor) entre los objetos con ese nombre. */
function newestByName(list: ProcoreObject[], name: string): string | null {
  const ids = list
    .filter((t) => sameName(extractName(t), name))
    .map((t) => extractId(t))
    .filter((x): x is string => x !== null)
    .sort((a, b) => Number(b) - Number(a));
  return ids[0] ?? null;
}

export async function findExisting(client: ProcoreClient, projectId: string, companyId: string): Promise<ExistingObjects> {
  const [projectTemplates, lists, schedules] = await Promise.all([
    client.listProjectTemplates(projectId),
    client.listChecklists(projectId),
    client.listSchedules(projectId),
  ]);
  let companyTemplates: ProcoreObject[] = [];
  try {
    companyTemplates = await client.listCompanyTemplates(companyId);
  } catch {
    /* sin permisos de compañía: se detectará al crear */
  }
  const existing: ExistingObjects = {};
  const t = findByName(projectTemplates, TEMPLATE_NAME);
  if (t) existing.template = t;
  const ct = findByName(companyTemplates, TEMPLATE_NAME);
  if (ct) existing.companyTemplate = ct;
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
  const existing = await findExisting(client, projectId, companyId);
  return { projectName: extractName(project), endDate: end.date, endDateField: end.field, existing };
}

// ─── Fase 2: plantilla ────────────────────────────────────────────────────────

interface Ctx {
  client: ProcoreClient;
  companyId: string;
  projectId: string;
  sections: PlannedSection[];
  sleep: (ms: number) => Promise<void>;
  retry: <T>(fn: () => Promise<T>) => Promise<T>;
}

function brief(data: unknown): string {
  try {
    const t = JSON.stringify(data);
    return t.length > 300 ? `${t.slice(0, 300)}…` : t;
  } catch {
    return '[no serializable]';
  }
}

/** Crea la plantilla de compañía y devuelve su id (de la respuesta o del listado). */
async function createCompanyTemplate(ctx: Ctx): Promise<string> {
  const { client, companyId, sleep } = ctx;
  const created = await client.createCompanyTemplate(companyId, buildTemplatePayload());
  let id = extractId(created);
  for (let i = 0; !id && i <= PROPAGATION_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(PROPAGATION_DELAYS_MS[i - 1]!);
    id = newestByName(await client.listCompanyTemplates(companyId), TEMPLATE_NAME);
  }
  if (!id) throw new Error('Procore creó la plantilla de compañía pero no devolvió su id.');
  return id;
}

/** Añade secciones e ítems a la plantilla de compañía y verifica releyéndola. Devuelve ítems sin tipo. */
async function populateCompanyTemplate(ctx: Ctx, templateId: string): Promise<number> {
  const { client, companyId, sections, retry } = ctx;

  // Tipos de ítem disponibles (para `type` número/texto). Si no se pueden leer, se crea sin tipo.
  let itemTypes: unknown = [];
  try {
    itemTypes = await client.listItemTypes(companyId);
  } catch {
    itemTypes = [];
  }
  const typeCandidates: Record<ValueType, (string | undefined)[]> = {
    number: [...itemTypeCandidates(itemTypes, 'number'), undefined],
    text: [...itemTypeCandidates(itemTypes, 'text'), undefined],
  };
  /** `type` que Procore aceptó para cada tipo de valor (se reutiliza en los siguientes ítems). */
  const acceptedType = new Map<ValueType, string | undefined>();
  let untypedItems = 0;

  for (const [si, section] of sections.entries()) {
    const sec = await retry(() =>
      client.createCompanyTemplateSection(companyId, templateId, buildSectionPayload(section.name, si + 1)),
    );
    const sectionId = extractId(sec);
    if (!sectionId) throw new Error(`Procore no devolvió el id de la sección "${section.name}".`);

    for (const [ii, item] of section.items.entries()) {
      const vt = item.valueType;
      const types = acceptedType.has(vt) ? [acceptedType.get(vt)] : typeCandidates[vt];
      const res = await retry(() =>
        firstAccepted(
          types.map(
            (type) => () =>
              client.createCompanyTemplateItem(
                companyId,
                templateId,
                buildTemplateItemPayload(item, ii + 1, sectionId, type),
              ),
          ),
        ),
      );
      acceptedType.set(vt, types[res.index]);
      if (types[res.index] === undefined) untypedItems++;
    }
  }

  // Verificación: las secciones e ítems deben existir de verdad antes de copiar la plantilla.
  const expectedItems = sections.reduce((n, s) => n + s.items.length, 0);
  for (let attempt = 0; ; attempt++) {
    const [secData, items] = await Promise.all([
      client.listCompanyTemplateSections(companyId, templateId),
      client.listCompanyTemplateItems(companyId, templateId),
    ]);
    const found = new Set(asArray(secData).map((s) => normalizeForSearch(extractName(s) ?? '')));
    const missing = sections.map((s) => s.name).filter((n) => !found.has(normalizeForSearch(n)));
    if (missing.length === 0 && items.length >= expectedItems) break;
    if (attempt >= PROPAGATION_DELAYS_MS.length) {
      throw new TemplateNotPopulatedError(
        `La plantilla de compañía ${templateId} no quedó completa: ` +
          (missing.length ? `faltan las secciones ${missing.join(', ')}; ` : '') +
          `${items.length} de ${expectedItems} ítems. Secciones leídas: ${brief(secData)}`,
      );
    }
    await ctx.sleep(PROPAGATION_DELAYS_MS[attempt]!);
  }
  return untypedItems;
}

/** Copia la plantilla de compañía al proyecto y devuelve el id de la plantilla de proyecto. */
async function copyToProject(ctx: Ctx, companyTemplateId: string): Promise<string> {
  const { client, projectId, sleep, retry } = ctx;
  const created = await retry(() =>
    client.createProjectTemplateFromCompany(projectId, buildCopyFromCompanyPayload(companyTemplateId)),
  );
  let id = extractId(created);
  for (let i = 0; !id && i <= PROPAGATION_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(PROPAGATION_DELAYS_MS[i - 1]!);
    id = newestByName(await client.listProjectTemplates(projectId), TEMPLATE_NAME);
  }
  if (!id) throw new Error('Procore copió la plantilla al proyecto pero no devolvió su id.');
  return id;
}

async function tryDelete(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

/** Ítems de la inspección (List Checklist Items + Sections filtrados por list_id), con reintentos. */
async function readChecklistItems(ctx: Ctx, listId: string): Promise<ChecklistItemRef[]> {
  const { client, projectId, sleep } = ctx;
  for (let attempt = 0; ; attempt++) {
    const [items, sections] = await Promise.all([
      client.listChecklistItems(projectId, listId),
      client.listChecklistSections(projectId, listId).catch(() => []),
    ]);
    const refs = extractListItems(items, sections);
    if (refs.length > 0 || attempt >= PROPAGATION_DELAYS_MS.length) return refs;
    await sleep(PROPAGATION_DELAYS_MS[attempt]!);
  }
}

// ─── Fase 2: ejecutar ─────────────────────────────────────────────────────────

export interface ExecuteInput {
  client: ProcoreClient;
  companyId: string;
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

export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const { client, companyId, projectId, sections, prepared, webBase } = input;
  const reuse = input.reuseExisting;
  const existing = prepared.existing;
  const today = input.today ?? todayIso();
  const sleep = input.sleep ?? defaultSleep;
  const retry = <T,>(fn: () => Promise<T>) => retryWhileNotVisible(fn, sleep);
  const ctx: Ctx = { client, companyId, projectId, sections, sleep, retry };
  const steps = initialSteps();
  const summary: string[] = [];

  const update = (id: StepId, patch: Partial<StepState>) => {
    const s = steps.find((x) => x.id === id)!;
    Object.assign(s, patch);
    input.onProgress?.(steps.map((x) => ({ ...x })));
  };

  let current: StepId = 'template';
  try {
    // 1. Plantilla de proyecto con una sección por dominio y un ítem por elemento.
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
      const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
      // Resto de una ejecución anterior: se usa como origen si se pidió reutilizar.
      const reusingCompany = Boolean(reuse && existing.companyTemplate);
      let companyTemplateId: string | null = reusingCompany ? existing.companyTemplate!.id : null;
      let projectTemplateId: string | null = null;
      let untypedItems = 0;
      try {
        if (!companyTemplateId) {
          companyTemplateId = await createCompanyTemplate(ctx);
          untypedItems = await populateCompanyTemplate(ctx, companyTemplateId);
        }
        projectTemplateId = await copyToProject(ctx, companyTemplateId);
      } catch (e) {
        // Limpieza de lo creado en este paso (nunca de lo reutilizado).
        const cleaned =
          companyTemplateId && !reusingCompany
            ? await tryDelete(() => client.deleteCompanyTemplate(companyId, companyTemplateId!))
            : true;
        summary.push(
          cleaned
            ? 'La plantilla quedó incompleta y se eliminó automáticamente para no dejar restos.'
            : `Plantilla de compañía (id ${companyTemplateId}) incompleta: elimínala en Procore (Inspecciones de compañía) antes de reintentar.`,
        );
        throw e;
      }
      templateId = projectTemplateId;
      // La copia de proyecto es independiente: se elimina la plantilla de compañía intermedia.
      const removed = await tryDelete(() => client.deleteCompanyTemplate(companyId, companyTemplateId!));
      update('template', {
        status: untypedItems > 0 ? 'warning' : 'done',
        detail:
          `${sections.length} secciones, ${totalItems} ítems.` +
          (untypedItems > 0 ? ` ${untypedItems} ítems con el tipo por defecto: Procore no aceptó el tipo número/texto.` : '') +
          (removed ? '' : ' No se pudo borrar la plantilla de compañía intermedia.'),
        url: templateWebUrl(webBase, projectId, templateId),
      });
      summary.push(`Plantilla creada (id ${templateId}) con ${sections.length} secciones y ${totalItems} ítems.`);
      if (!removed) summary.push(`Queda la plantilla de compañía intermedia (id ${companyTemplateId}); puedes borrarla.`);
    }

    // 2. Inspección "Reporte de objetivos" desde la plantilla de proyecto.
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
      const created = await retry(() =>
        client.createChecklist(projectId, buildChecklistPayload({ templateId, inspectionDate: today })),
      );
      const id = extractId(created);
      if (!id) throw new Error('Procore no devolvió el id de la inspección.');
      listId = id;
      update('inspection', { status: 'done', url: checklistWebUrl(webBase, projectId, listId) });
      summary.push(`Inspección "${INSPECTION_NAME}" creada (id ${listId}).`);
    }

    // 3. Valores objetivo como respuesta de cada ítem (emparejados por nombre).
    current = 'responses';
    update('responses', { status: 'running' });
    const listItems = await readChecklistItems(ctx, listId);
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
      await retry(() => client.createItemResponse(projectId, match.id, buildItemResponsePayload(p.valueType, p.target)));
      written++;
    }
    if (written === 0 && planned.length > 0) {
      throw new Error(
        `La inspección ${listId} no tiene ningún ítem que coincida con la selección (${listItems.length} ítems leídos).`,
      );
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
      const changed = existing.schedule.endDate !== prepared.endDate;
      if (changed) await client.updateSchedule(projectId, sid, buildScheduleEndDatePatch(prepared.endDate));
      update('schedule', {
        status: 'reused',
        detail: changed
          ? `Se reutiliza la planificación existente; fecha fin actualizada a ${prepared.endDate}.`
          : 'Se reutiliza la planificación existente.',
        url: scheduleWebUrl(webBase, projectId),
      });
      summary.push(`Planificación trimestral reutilizada (id ${sid}).`);
    } else {
      // TODO(verify): valores de `frequency`; se prueban en orden (un 422 no crea nada).
      const res = await retry(() =>
        firstAccepted(
          QUARTERLY_FREQUENCY_CANDIDATES.map(
            (frequency) => () =>
              client.createSchedule(
                projectId,
                buildSchedulePayload({ templateId, startDate: today, endDate: prepared.endDate, frequency }),
              ),
          ),
        ),
      );
      const sid = extractId(res.value);
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
