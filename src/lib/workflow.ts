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
import { DiscoveryError, describeTried, findFirst, postFirstAccepted, preferFirst } from './adaptive.js';
import {
  CANDIDATES,
  INSPECTION_NAME,
  SCHEDULE_NAME,
  TEMPLATE_NAME,
  buildChecklistPayload,
  buildScheduleEndDatePatch,
  buildSchedulePayload,
  buildTemplatePayload,
  itemBodies,
  itemResponseBodies,
  sectionBodies,
  type Candidate,
  type ChecklistItemRef,
  checklistWebUrl,
  extractChecklistItems,
  extractId,
  extractName,
  extractScheduleEndDate,
  resolveProjectEndDate,
  scheduleWebUrl,
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
  if (e instanceof DiscoveryError) {
    return `No se encontró la ruta de la API para este paso (${describeTried(e.tried)}). Usa "Diagnóstico de API" y comparte el informe.`;
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

export async function findExisting(
  client: ProcoreClient,
  projectId: string,
  companyId: string,
): Promise<ExistingObjects> {
  // La plantilla vive a nivel COMPAÑÍA (sus secciones/ítems solo se pueden crear ahí).
  const [templates, lists, schedules] = await Promise.all([
    client.listCompanyTemplates(companyId),
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
  const existing = await findExisting(client, projectId, companyId);
  return { projectName: extractName(project), endDate: end.date, endDateField: end.field, existing };
}

// ─── Fase 2: ejecutar ─────────────────────────────────────────────────────────

export interface ExecuteInput {
  client: ProcoreClient;
  /** Necesario para las secciones/ítems de plantilla (endpoints de compañía). */
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

/** Busca por nombre la plantilla recién creada (la más reciente = id mayor), con reintentos. */
async function findCreatedTemplate(
  client: ProcoreClient,
  companyId: string,
  sleep: (ms: number) => Promise<void>,
): Promise<string | null> {
  for (let i = 0; i <= PROPAGATION_DELAYS_MS.length; i++) {
    const templates = await client.listCompanyTemplates(companyId);
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

export class TemplateNotPopulatedError extends Error {}

type TemplateScope = 'project' | 'company';

interface PopulateStats {
  createdItems: number;
  untypedItems: number;
}

interface PopulateCtx {
  client: ProcoreClient;
  companyId: string;
  projectId: string;
  sections: PlannedSection[];
  sleep: (ms: number) => Promise<void>;
  retry: <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Añade a la plantilla una sección por dominio y un ítem por elemento, y verifica releyéndola. */
async function populateTemplate(ctx: PopulateCtx, scope: TemplateScope, templateId: string): Promise<PopulateStats> {
  const { client, companyId, projectId, sections, sleep, retry } = ctx;
  // Localiza (con GET, sin efectos) la colección de secciones de la plantilla recién creada.
  const sectionsCol = (
    await findFirst(client, CANDIDATES.templateSections(companyId, projectId, templateId), sleep, PROPAGATION_DELAYS_MS)
  ).candidate;
  let sectionBodyPref = 0;
  let itemBodyPref = 0;
  let createdItems = 0;
  let untypedItems = 0;
  const createdSectionIds: string[] = [];
  for (const [si, section] of sections.entries()) {
    const secVariants = preferFirst(sectionBodies(section.name, si + 1), sectionBodyPref);
    const sec = await retry(() => postFirstAccepted(client, [sectionsCol], secVariants.map((v) => v.item)));
    sectionBodyPref = secVariants[sec.bodyIndex]!.originalIndex;
    const sectionId = extractId(sec.data);
    if (!sectionId) throw new Error(`Procore no devolvió el id de la sección "${section.name}".`);
    createdSectionIds.push(sectionId);
    const itemsCols: Candidate[] = CANDIDATES.templateItems(companyId, templateId);
    for (const [ii, item] of section.items.entries()) {
      const variants = preferFirst(itemBodies(item, ii + 1, sectionId), itemBodyPref);
      const res = await retry(() => postFirstAccepted(client, itemsCols, variants.map((v) => v.item.body)));
      const chosen = variants[res.bodyIndex]!;
      itemBodyPref = chosen.originalIndex;
      if (!chosen.item.typed) untypedItems++;
      createdItems++;
    }
  }
  // Procore respondió 2xx, pero se comprueba releyendo la plantilla que las secciones
  // existen de verdad antes de crear una inspección vacía.
  await verifyTemplateSections(client, {
    sectionsCol,
    showPath:
      scope === 'project'
        ? `/rest/v1.0/projects/${projectId}/checklist/list_templates/${templateId}`
        : `/rest/v1.0/companies/${companyId}/checklist/list_templates/${templateId}`,
    templateId,
    expected: sections.map((x) => x.name),
    createdSectionIds,
    sleep,
  });
  return { createdItems, untypedItems };
}

/** Nombres de secciones en una respuesta (lista de secciones o plantilla con sections[]). */
function sectionNames(data: unknown): string[] {
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { sections?: unknown }).sections)
      ? (data as { sections: unknown[] }).sections
      : [];
  return arr.map((x) => extractName(x)).filter((n): n is string => n !== null);
}

function brief(data: unknown): string {
  try {
    const t = JSON.stringify(data);
    return t.length > 300 ? `${t.slice(0, 300)}…` : t;
  } catch {
    return '[no serializable]';
  }
}

/**
 * Relee la plantilla (colección de secciones y detalle de la plantilla) y lanza
 * un error explicativo si faltan secciones, aunque Procore aceptara los POST.
 */
async function verifyTemplateSections(
  client: ProcoreClient,
  args: {
    sectionsCol: Candidate;
    showPath: string;
    templateId: string;
    expected: string[];
    createdSectionIds: string[];
    sleep: (ms: number) => Promise<void>;
  },
): Promise<void> {
  const reads: { path: string; data: unknown }[] = [];
  let missing: string[] = args.expected;
  for (let attempt = 0; attempt <= PROPAGATION_DELAYS_MS.length && missing.length > 0; attempt++) {
    if (attempt > 0) await args.sleep(PROPAGATION_DELAYS_MS[attempt - 1]!);
    reads.length = 0;
    const found = new Set<string>();
    for (const c of [args.sectionsCol, { path: args.showPath }]) {
      try {
        const r = await client.getAt(c);
        reads.push({ path: c.path, data: r.data });
        for (const n of sectionNames(r.data)) found.add(normalizeForSearch(n));
      } catch (e) {
        reads.push({ path: c.path, data: e instanceof ProcoreApiError ? `HTTP ${e.status}` : 'error' });
      }
    }
    missing = args.expected.filter((n) => !found.has(normalizeForSearch(n)));
  }
  if (missing.length > 0) {
    throw new TemplateNotPopulatedError(
      `Procore aceptó la creación de ${args.createdSectionIds.length} secciones (ruta ${args.sectionsCol.path}, ids ${args.createdSectionIds.join(', ')}), ` +
        `pero al releer la plantilla ${args.templateId} no aparecen: ${missing.join(', ')}. ` +
        `Relectura: ${reads.map((r) => `${r.path} → ${brief(r.data)}`).join(' | ')}`,
    );
  }
}

/** Intenta borrar la plantilla creada si su creación quedó incompleta. Devuelve true si se borró. */
async function deleteTemplate(
  client: ProcoreClient,
  companyId: string,
  projectId: string,
  templateId: string,
): Promise<boolean> {
  for (const c of CANDIDATES.templateDelete(companyId, projectId, templateId)) {
    try {
      await client.deleteAt(c);
      return true;
    } catch {
      /* se prueba la siguiente ruta */
    }
  }
  return false;
}

/** Ítems de una inspección: de "show" (sections[].items[]) o, si no vienen, del listado de ítems. */
async function readChecklistItems(
  client: ProcoreClient,
  projectId: string,
  listId: string,
  sleep: (ms: number) => Promise<void>,
): Promise<ChecklistItemRef[]> {
  const shown = await findFirst(client, CANDIDATES.checklistShow(projectId, listId), sleep, PROPAGATION_DELAYS_MS);
  const fromShow = extractChecklistItems(shown.data);
  if (fromShow.length > 0) return fromShow;
  try {
    const listed = await findFirst(client, CANDIDATES.checklistItems(projectId, listId), sleep, []);
    return extractChecklistItems(Array.isArray(listed.data) ? { items: listed.data } : listed.data);
  } catch {
    return [];
  }
}

export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const { client, companyId, projectId, sections, prepared, webBase } = input;
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
        detail: 'Se reutiliza la plantilla de compañía existente (sus ítems pueden diferir de la selección actual).',
      });
      summary.push(`Plantilla reutilizada (id ${templateId}).`);
    } else {
      // La plantilla se crea a nivel COMPAÑÍA: es el id que aceptan los endpoints de
      // "Company Checklist Template Sections" (con un id de plantilla de proyecto dan 404).
      const tpl = await client.createCompanyTemplate(companyId, buildTemplatePayload());
      let id = extractId(tpl);
      if (!id) {
        // La respuesta no trae un id reconocible: se busca en el listado de plantillas de compañía.
        id = await findCreatedTemplate(client, companyId, sleep);
      }
      if (!id) {
        throw new Error(
          'Procore creó la plantilla de compañía pero no se pudo obtener su id. Revisa el registro técnico y elimínala en Procore (Inspecciones de compañía) antes de reintentar.',
        );
      }
      templateId = id;
      const totalItems = sections.reduce((n, s) => n + s.items.length, 0);
      let stats: PopulateStats;
      try {
        stats = await populateTemplate({ client, companyId, projectId, sections, sleep, retry }, 'company', templateId);
      } catch (e) {
        const cleaned = await deleteTemplate(client, companyId, projectId, templateId);
        summary.push(
          cleaned
            ? 'La plantilla quedó incompleta y se eliminó automáticamente para no dejar restos.'
            : `Plantilla de compañía (id ${templateId}) incompleta: elimínala en Procore (Inspecciones de compañía) antes de reintentar.`,
        );
        throw e;
      }
      update('template', {
        status: stats.untypedItems > 0 ? 'warning' : 'done',
        detail:
          `Plantilla de compañía: ${sections.length} secciones, ${totalItems} ítems.` +
          (stats.untypedItems > 0 ? ` ${stats.untypedItems} ítems sin tipo número/texto: Procore rechazó el campo de tipo.` : ''),
      });
      summary.push(`Plantilla de compañía creada (id ${templateId}) con ${sections.length} secciones y ${totalItems} ítems.`);
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
      const created = await retry(() =>
        postFirstAccepted(client, CANDIDATES.checklistCreate(projectId), [buildChecklistPayload({ projectId, templateId })]),
      );
      const id = extractId(created.data);
      if (!id) throw new Error('Procore no devolvió el id de la inspección.');
      listId = id;
      update('inspection', { status: 'done', url: checklistWebUrl(webBase, projectId, listId) });
      summary.push(`Inspección "${INSPECTION_NAME}" creada (id ${listId}).`);
    }

    // 3. Valores objetivo como respuesta de cada ítem (emparejados por nombre).
    current = 'responses';
    update('responses', { status: 'running' });
    const listItems = await readChecklistItems(client, projectId, listId, sleep);
    const planned = sections.flatMap((s) => s.items.map((it) => ({ ...it, sectionName: s.name })));
    let written = 0;
    const missing: string[] = [];
    let responseTargetPref = 0;
    let responseBodyPref = 0;
    for (const p of planned) {
      const match =
        listItems.find((li) => sameName(li.name, p.name) && (li.sectionName === null || sameName(li.sectionName, p.sectionName))) ??
        listItems.find((li) => sameName(li.name, p.name));
      if (!match) {
        missing.push(p.name);
        continue;
      }
      const targets = preferFirst(CANDIDATES.itemResponses(projectId, listId, match.id), responseTargetPref);
      const bodies = preferFirst(itemResponseBodies(p.valueType, p.target), responseBodyPref);
      const res = await postFirstAccepted(
        client,
        targets.map((t) => t.item),
        bodies.map((b) => b.item),
      );
      responseTargetPref = targets[targets.findIndex((t) => t.item === res.candidate)]!.originalIndex;
      responseBodyPref = bodies[res.bodyIndex]!.originalIndex;
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
