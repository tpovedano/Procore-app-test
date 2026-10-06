/**
 * Cliente tipado de Procore: una función por endpoint usado.
 *
 * No hace fetch directamente: recibe un `Transport`. En el navegador el
 * transporte llama al proxy serverless (/api/procore/proxy), que añade el token
 * y la cabecera Procore-Company-Id; en dry-run se usa un transporte simulado.
 * Rutas y payloads salen de procoreSpec.ts.
 */
import { hasNextPage } from './retry.js';
import { paths } from './procoreSpec.js';
import type { HttpMethod } from './procoreSpec.js';

export type Query = Record<string, string | number>;

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  query?: Query;
  body?: unknown;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  link?: string | null;
}

export type Transport = (req: ApiRequest) => Promise<ApiResponse>;

export class ProcoreApiError extends Error {
  /** Petición que falló (método y ruta), para mostrar dónde ocurrió el error. */
  request?: { method: string; path: string };

  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProcoreApiError';
  }
}

/** Envuelve el transporte para anotar en cada ProcoreApiError qué petición falló. */
function annotateErrors(transport: Transport): Transport {
  return async (req) => {
    try {
      return await transport(req);
    } catch (e) {
      if (e instanceof ProcoreApiError && !e.request) e.request = { method: req.method, path: req.path };
      throw e;
    }
  };
}

/** Objeto genérico de Procore (al menos id y, a menudo, name). */
export type ProcoreObject = Record<string, unknown> & { id?: number | string; name?: string };

export const PER_PAGE = 100;
export const MAX_PAGES = 50;

async function listAll(transport: Transport, path: string, query: Query = {}): Promise<ProcoreObject[]> {
  const out: ProcoreObject[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await transport({ method: 'GET', path, query: { ...query, page, per_page: PER_PAGE } });
    const items = Array.isArray(res.data) ? (res.data as ProcoreObject[]) : [];
    out.push(...items);
    // Sin cabecera Link (endpoints sin paginación) → nos guiamos por el tamaño de página.
    const more = res.link != null ? hasNextPage(res.link) : items.length === PER_PAGE;
    if (!more) break;
  }
  return out;
}

async function one<T = ProcoreObject>(transport: Transport, req: ApiRequest): Promise<T> {
  const res = await transport(req);
  return res.data as T;
}

export function createProcoreClient(rawTransport: Transport) {
  const transport = annotateErrors(rawTransport);
  const get = (path: string, query?: Query) => one(transport, { method: 'GET', path, query });
  const post = (path: string, body: unknown, query?: Query) => one(transport, { method: 'POST', path, query, body });
  return {
    getMe: () => get(paths.me()),
    getProject: (companyId: string, projectId: string) => get(paths.showProject(projectId), { company_id: companyId }),

    // Plantillas de compañía (secciones e ítems solo se pueden crear aquí).
    listCompanyTemplates: (companyId: string) => listAll(transport, paths.companyTemplates(companyId)),
    createCompanyTemplate: (companyId: string, payload: unknown) => post(paths.companyTemplates(companyId), payload),
    deleteCompanyTemplate: (companyId: string, templateId: string) =>
      transport({ method: 'DELETE', path: paths.companyTemplate(companyId, templateId) }),
    listCompanyTemplateSections: (companyId: string, templateId: string) =>
      get(paths.companyTemplateSections(companyId, templateId)),
    createCompanyTemplateSection: (companyId: string, templateId: string, payload: unknown) =>
      post(paths.companyTemplateSections(companyId, templateId), payload),
    listCompanyTemplateItems: (companyId: string, templateId: string) =>
      listAll(transport, paths.companyTemplateItems(companyId, templateId)),
    createCompanyTemplateItem: (companyId: string, templateId: string, payload: unknown) =>
      post(paths.companyTemplateItems(companyId, templateId), payload),
    listItemTypes: (companyId: string) => get(paths.itemTypes(), { company_id: companyId }),

    // Plantillas de proyecto.
    listProjectTemplates: (projectId: string) => listAll(transport, paths.projectTemplates(projectId)),
    createProjectTemplateFromCompany: (projectId: string, payload: unknown) =>
      post(paths.projectTemplateFromCompany(projectId), payload),
    deleteProjectTemplate: (projectId: string, templateId: string) =>
      transport({ method: 'DELETE', path: paths.projectTemplate(projectId, templateId) }),

    // Inspecciones.
    listChecklists: (projectId: string) => listAll(transport, paths.projectLists(projectId)),
    createChecklist: (projectId: string, payload: unknown) => post(paths.projectLists(projectId), payload),
    listChecklistItems: (projectId: string, listId: string) =>
      listAll(transport, paths.listItems(projectId), { 'filters[list_id]': listId }),
    listChecklistSections: (projectId: string, listId: string) =>
      listAll(transport, paths.listSections(projectId), { 'filters[list_id]': listId }),
    createItemResponse: (projectId: string, itemId: string, payload: unknown) =>
      post(paths.itemResponse(projectId, itemId), payload),

    // Planificadas.
    listSchedules: (projectId: string) => listAll(transport, paths.schedules(projectId)),
    createSchedule: (projectId: string, payload: unknown) => post(paths.schedules(projectId), payload),
    updateSchedule: (projectId: string, scheduleId: string, payload: unknown) =>
      one(transport, { method: 'PATCH', path: paths.schedule(projectId, scheduleId), body: payload }),
  };
}

export type ProcoreClient = ReturnType<typeof createProcoreClient>;
