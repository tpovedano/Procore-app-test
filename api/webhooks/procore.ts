/**
 * POST /api/webhooks/procore → receptor de webhooks de Procore.
 *
 * Verificación: Procore no firma los envíos; se configura en el hook
 * destination_headers = { "Authorization": "Bearer <WEBHOOK_SECRET>" } y aquí
 * se compara en tiempo constante.
 *
 * Si cambia un proyecto, se actualiza la fecha fin de la inspección planificada
 * creada por la app (por nombre). Se responde 202 enseguida (Procore corta a los
 * 5 s) y el trabajo sigue con waitUntil. Sin usuario → token Client Credentials (DMSA).
 */
import { waitUntil } from '@vercel/functions';
import { createProcoreClient } from '../../src/lib/procore.js';
import { isAuthorizedWebhook, isProjectChangeEvent, parseWebhookEvent, syncScheduleEndDate } from '../../src/lib/webhook.js';
import { getConfig, isDryRun } from '../_lib/env.js';
import { json, readJson } from '../_lib/http.js';
import { clientCredentialsToken, serverTransport } from '../_lib/procoreServer.js';

/** Deduplicación best-effort en memoria (sin BD). La operación es idempotente de todos modos. */
const seen = new Set<string>();
function remember(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 500) seen.delete(seen.values().next().value as string);
  return true;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorizedWebhook(request.headers.get('authorization'), process.env.WEBHOOK_SECRET?.trim())) {
    return json(request, 401, { error: 'unauthorized' });
  }

  let body: unknown;
  try {
    body = await readJson(request, 50_000);
  } catch {
    return json(request, 400, { error: 'invalid-json' });
  }
  const event = parseWebhookEvent(body);
  if (!event) return json(request, 202, { ignored: 'unrecognized-event' });
  if (!isProjectChangeEvent(event)) return json(request, 202, { ignored: 'not-a-project-update' });
  if (event.id && !remember(event.id)) return json(request, 202, { ignored: 'duplicate' });

  const work = (async () => {
    try {
      if (isDryRun()) {
        console.info(`[webhook][DRY-RUN] sincronizaría la fecha fin del proyecto ${event.projectId}`);
        return;
      }
      const cfg = getConfig();
      const token = await clientCredentialsToken(cfg);
      const client = createProcoreClient(serverTransport(cfg, token, event.companyId));
      const result = await syncScheduleEndDate(client, event.companyId, event.projectId);
      console.info(`[webhook] proyecto ${event.projectId}: ${result.action}`);
    } catch (e) {
      console.error(`[webhook] proyecto ${event.projectId}: error`, e instanceof Error ? e.message : '');
    }
  })();
  waitUntil(work);

  return json(request, 202, { accepted: true });
}
