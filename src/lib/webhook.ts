/**
 * Lógica del webhook (pura salvo el cliente inyectado): si cambió un proyecto,
 * sincroniza la fecha fin de la inspección planificada creada por la app
 * (identificada por SCHEDULE_NAME).
 *
 * Procore no firma los webhooks: la autenticidad se comprueba con la cabecera
 * configurada en el hook (destination_headers → Authorization: Bearer <secreto>).
 */
import { normalizeForSearch } from './catalog.js';
import type { ProcoreClient } from './procore.js';
import {
  PROJECT_WEBHOOK_RESOURCES,
  SCHEDULE_NAME,
  buildScheduleEndDatePatch,
  extractId,
  extractName,
  extractScheduleEndDate,
  resolveProjectEndDate,
} from './procoreSpec.js';

export interface WebhookEvent {
  id: string | null;
  resourceName: string;
  eventType: string;
  companyId: string;
  projectId: string;
}

const ID = /^\d{1,19}$/;
const idStr = (v: unknown): string | null =>
  (typeof v === 'number' && Number.isSafeInteger(v)) || (typeof v === 'string' && ID.test(v)) ? String(v) : null;

/** Normaliza payloads v2/v3 (resource_name, event_type) y v4 (resource_type, reason). */
export function parseWebhookEvent(body: unknown): WebhookEvent | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const resourceName = typeof b.resource_name === 'string' ? b.resource_name : b.resource_type;
  const eventType = typeof b.event_type === 'string' ? b.event_type : b.reason;
  const companyId = idStr(b.company_id);
  const projectId = idStr(b.project_id);
  if (typeof resourceName !== 'string' || typeof eventType !== 'string' || !companyId || !projectId) return null;
  const rawId = b.ulid ?? b.id;
  return {
    id: typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null,
    resourceName,
    eventType,
    companyId,
    projectId,
  };
}

export function isProjectChangeEvent(e: WebhookEvent): boolean {
  return (
    e.eventType === 'update' &&
    (PROJECT_WEBHOOK_RESOURCES as readonly string[]).some((r) => r.toLowerCase() === e.resourceName.toLowerCase())
  );
}

/** Compara dos secretos en tiempo constante (sin depender de node:crypto). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function isAuthorizedWebhook(authorizationHeader: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !authorizationHeader) return false;
  return constantTimeEqual(authorizationHeader.trim(), `Bearer ${secret}`);
}

export type SyncResult =
  | { action: 'updated'; scheduleId: string; from: string | null; to: string }
  | { action: 'unchanged'; scheduleId: string; endDate: string }
  | { action: 'no-schedule' }
  | { action: 'no-end-date' };

export async function syncScheduleEndDate(
  client: ProcoreClient,
  companyId: string,
  projectId: string,
): Promise<SyncResult> {
  const project = await client.getProject(companyId, projectId);
  const end = resolveProjectEndDate(project);
  if (!end) return { action: 'no-end-date' };

  const schedules = await client.listSchedules(projectId);
  const target = normalizeForSearch(SCHEDULE_NAME);
  const schedule = schedules.find((s) => normalizeForSearch(extractName(s) ?? '') === target);
  const scheduleId = schedule ? extractId(schedule) : null;
  if (!schedule || !scheduleId) return { action: 'no-schedule' };

  const current = extractScheduleEndDate(schedule);
  if (current === end.date) return { action: 'unchanged', scheduleId, endDate: end.date };

  await client.updateSchedule(projectId, scheduleId, buildScheduleEndDatePatch(end.date));
  return { action: 'updated', scheduleId, from: current, to: end.date };
}
