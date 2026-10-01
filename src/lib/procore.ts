/**
 * Cliente tipado de Procore: una función por endpoint usado.
 *
 * No hace fetch directamente: recibe un `Transport`. En el navegador el
 * transporte llama al proxy serverless (/api/procore/proxy), que añade el token
 * y la cabecera Procore-Company-Id; en dry-run se usa un transporte simulado.
 * Rutas y payloads salen de procoreSpec.ts.
 */
import { hasNextPage } from './retry';
import { paths } from './procoreSpec';
import type { HttpMethod } from './procoreSpec';

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
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProcoreApiError';
  }
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

export function createProcoreClient(transport: Transport) {
  return {
    getMe: () => one(transport, { method: 'GET', path: paths.me() }),

    getProject: (companyId: string, projectId: string) =>
      one(transport, { method: 'GET', path: paths.showProject(projectId), query: { company_id: companyId } }),

    listProjectTemplates: (projectId: string) => listAll(transport, paths.projectTemplates(projectId)),

    createProjectTemplate: (projectId: string, payload: unknown) =>
      one(transport, { method: 'POST', path: paths.projectTemplates(projectId), body: payload }),

    createTemplateSection: (projectId: string, templateId: string, payload: unknown) =>
      one(transport, { method: 'POST', path: paths.templateSections(projectId, templateId), body: payload }),

    createTemplateItem: (projectId: string, templateId: string, sectionId: string, payload: unknown) =>
      one(transport, { method: 'POST', path: paths.templateItems(projectId, templateId, sectionId), body: payload }),

    listChecklists: (projectId: string) => listAll(transport, paths.checklists(), { project_id: projectId }),

    createChecklist: (projectId: string, payload: unknown) =>
      one(transport, { method: 'POST', path: paths.checklists(), query: { project_id: projectId }, body: payload }),

    getChecklist: (projectId: string, listId: string) =>
      one(transport, { method: 'GET', path: paths.checklist(listId), query: { project_id: projectId } }),

    createItemResponse: (projectId: string, listId: string, itemId: string, payload: unknown) =>
      one(transport, {
        method: 'POST',
        path: paths.itemResponses(listId, itemId),
        query: { project_id: projectId },
        body: payload,
      }),

    listSchedules: (projectId: string) => listAll(transport, paths.schedules(projectId)),

    createSchedule: (projectId: string, payload: unknown) =>
      one(transport, { method: 'POST', path: paths.schedules(projectId), body: payload }),

    updateSchedule: (projectId: string, scheduleId: string, payload: unknown) =>
      one(transport, { method: 'PATCH', path: paths.schedule(projectId, scheduleId), body: payload }),
  };
}

export type ProcoreClient = ReturnType<typeof createProcoreClient>;
