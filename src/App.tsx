import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import rawCatalog from './catalog.json';
import { CreateBar } from './components/CreateBar';
import { DomainAccordion } from './components/DomainAccordion';
import { DryRunLog } from './components/DryRunLog';
import { DuplicateDialog } from './components/DuplicateDialog';
import { Header } from './components/Header';
import { Notice } from './components/Notice';
import { ProgressPanel } from './components/ProgressPanel';
import { SearchBar } from './components/SearchBar';
import { Spinner } from './components/icons';
import { useAppConfig, type AppConfig } from './hooks/useAppConfig';
import { useProcoreContext } from './hooks/useProcoreContext';
import { CatalogError, filterCatalog, parseCatalog, type Catalog } from './lib/catalog';
import { formatDateEs } from './lib/dates';
import { createDryRunTransport, type DryRunEntry } from './lib/dryRun';
import { getIframeContext } from './lib/iframeHelpers';
import { createProcoreClient, type ProcoreClient } from './lib/procore';
import type { ProcoreContext } from './lib/procoreContext';
import { extractName } from './lib/procoreSpec';
import {
  buildPlan,
  isSelected,
  setDomainSelection,
  setValue,
  toggleElement,
  validateValue,
  type PlannedSection,
  type Selection,
} from './lib/selection';
import { createProxyTransport } from './lib/transport';
import {
  PreconditionError,
  describeError,
  execute,
  hasExisting,
  prepare,
  type ExecuteResult,
  type Prepared,
  type StepState,
} from './lib/workflow';

function loadCatalog(): { catalog: Catalog } | { error: string } {
  try {
    return { catalog: parseCatalog(rawCatalog) };
  } catch (e) {
    return { error: e instanceof CatalogError ? e.message : 'El catálogo no es válido.' };
  }
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-4">{children}</main>;
}

export default function App() {
  const config = useAppConfig();
  const context = useProcoreContext();
  const catalog = useMemo(loadCatalog, []);

  if (config.status === 'loading' || context.status === 'waiting') {
    return (
      <FullScreenMessage>
        <p className="flex items-center justify-center gap-2 text-sm text-slate-600" role="status">
          <Spinner /> Cargando…
        </p>
      </FullScreenMessage>
    );
  }
  if (config.status === 'error') {
    return (
      <FullScreenMessage>
        <Notice tone="error" title="La app no está configurada correctamente">
          {config.message}
        </Notice>
      </FullScreenMessage>
    );
  }
  if (context.status === 'missing') {
    return (
      <FullScreenMessage>
        <Notice tone="warning" title="No se detectó un proyecto de Procore">
          Abre esta app desde el panel lateral de un proyecto en Procore.
        </Notice>
        <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-800">Diagnóstico</summary>
          <dl className="mt-2 space-y-1 break-all">
            <div>
              <dt className="inline font-medium">Dentro de un iframe: </dt>
              <dd className="inline">{context.diagnostics.framed ? 'sí' : 'no'}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Origen del padre: </dt>
              <dd className="inline">
                {context.diagnostics.ancestorOrigin ?? context.diagnostics.referrerOrigin ?? 'desconocido'}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">"initialize" enviado a: </dt>
              <dd className="inline">{context.diagnostics.initializeSentTo.join(', ') || 'ninguno'}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Mensajes ignorados de: </dt>
              <dd className="inline">{context.diagnostics.ignoredMessageOrigins.join(', ') || 'ninguno'}</dd>
            </div>
          </dl>
        </details>
      </FullScreenMessage>
    );
  }
  if ('error' in catalog) {
    return (
      <FullScreenMessage>
        <Notice tone="error" title="Error en el catálogo">
          {catalog.error}
        </Notice>
      </FullScreenMessage>
    );
  }
  return <Main config={config.config} context={context.context} catalog={catalog.catalog} />;
}

// ─── Pantalla principal ───────────────────────────────────────────────────────

type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'confirm'; prepared: Prepared; sections: PlannedSection[] }
  | { kind: 'running'; steps: StepState[] }
  | { kind: 'finished'; result: ExecuteResult; endDate: string }
  | { kind: 'error'; message: string };

interface MainProps {
  config: AppConfig;
  context: ProcoreContext;
  catalog: Catalog;
}

function Main({ config, context, catalog }: MainProps) {
  // La sesión (cifrada, opaca) vive solo en memoria: no se guarda en ningún almacenamiento.
  const [session, setSession] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = session;
  const [authError, setAuthError] = useState<string | null>(null);
  const [dryLog, setDryLog] = useState<DryRunEntry[]>([]);

  const client: ProcoreClient = useMemo(
    () =>
      createProcoreClient(
        config.dryRun
          ? createDryRunTransport({ onRequest: (e) => setDryLog((l) => [...l, e]) })
          : createProxyTransport({
              companyId: context.companyId,
              getSession: () => sessionRef.current,
              onSessionRenewed: (s) => setSession(s),
              onUnauthorized: () => setSession(null),
            }),
      ),
    [config.dryRun, context.companyId],
  );

  const authenticated = config.dryRun || session !== null;

  const [projectName, setProjectName] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    void Promise.allSettled([client.getMe(), client.getProject(context.companyId, context.projectId)]).then(
      ([me, project]) => {
        if (cancelled) return;
        setUserName(me.status === 'fulfilled' ? extractName(me.value) ?? '—' : '—');
        setProjectName(
          project.status === 'fulfilled' ? extractName(project.value) ?? `Proyecto ${context.projectId}` : `Proyecto ${context.projectId}`,
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [authenticated, client, context.companyId, context.projectId]);

  const connect = useCallback(() => {
    setAuthError(null);
    try {
      getIframeContext().authentication.authenticate({
        url: '/api/auth/login',
        width: 600,
        height: 700,
        onSuccess: (payload) => {
          const s = (payload as { session?: unknown } | null)?.session;
          if (typeof s === 'string' && s.length > 0) setSession(s);
          else setAuthError('No se recibió la sesión de Procore.');
        },
        onFailure: (err) => {
          const msg = (err as { error?: unknown } | null)?.error;
          setAuthError(typeof msg === 'string' ? msg : 'Se canceló el inicio de sesión.');
        },
      });
    } catch {
      setAuthError('No se pudo abrir la ventana de inicio de sesión. Revisa el bloqueador de ventanas emergentes.');
    }
  }, []);

  if (!authenticated) {
    return (
      <FullScreenMessage>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">Conecta con Procore</h1>
          <p className="mt-1 text-sm text-slate-600">
            Necesitamos tu autorización para crear inspecciones en este proyecto.
          </p>
          <button
            type="button"
            onClick={connect}
            className="mt-4 w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Iniciar sesión con Procore
          </button>
        </div>
        {authError && <Notice tone="error" title="No se pudo conectar">{authError}</Notice>}
      </FullScreenMessage>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        projectName={projectName}
        userName={userName}
        dryRun={config.dryRun}
        environment={config.environment}
        onDisconnect={config.dryRun ? undefined : () => setSession(null)}
      />
      <Workspace
        catalog={catalog}
        client={client}
        context={context}
        webBase={config.webBaseUrl}
        dryRun={config.dryRun}
        dryLog={dryLog}
        clearDryLog={() => setDryLog([])}
      />
    </div>
  );
}

// ─── Selección + creación ─────────────────────────────────────────────────────

interface WorkspaceProps {
  catalog: Catalog;
  client: ProcoreClient;
  context: ProcoreContext;
  webBase: string;
  dryRun: boolean;
  dryLog: DryRunEntry[];
  clearDryLog: () => void;
}

function Workspace({ catalog, client, context, webBase, dryRun, dryLog, clearDryLog }: WorkspaceProps) {
  const [selection, setSelection] = useState<Selection>({});
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(catalog.domains[0] ? [catalog.domains[0].id] : []));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const filtered = useMemo(() => filterCatalog(catalog, query), [catalog, query]);
  const visibleCount = filtered.reduce((n, d) => n + d.elements.length, 0);
  const allElements = useMemo(() => catalog.domains.flatMap((d) => d.elements), [catalog]);
  const selectedCount = allElements.filter((e) => isSelected(selection, e.id)).length;
  const pendingCount = allElements.filter(
    (e) => isSelected(selection, e.id) && !validateValue(e.valueType, selection[e.id] ?? '').ok,
  ).length;

  const run = useCallback(
    async (prepared: Prepared, sections: PlannedSection[], reuseExisting: boolean) => {
      setPhase({ kind: 'running', steps: [] });
      const result = await execute({
        client,
        projectId: context.projectId,
        sections,
        prepared,
        reuseExisting,
        webBase,
        onProgress: (steps) => setPhase({ kind: 'running', steps }),
      });
      setPhase({ kind: 'finished', result, endDate: prepared.endDate });
    },
    [client, context.projectId, webBase],
  );

  const onCreate = useCallback(async () => {
    const plan = buildPlan(catalog, selection);
    if (!plan.ok) return; // el botón ya está deshabilitado en estos casos
    clearDryLog();
    setPhase({ kind: 'preparing' });
    try {
      const prepared = await prepare(client, context.companyId, context.projectId);
      if (hasExisting(prepared.existing)) setPhase({ kind: 'confirm', prepared, sections: plan.sections });
      else await run(prepared, plan.sections, false);
    } catch (e) {
      setPhase({
        kind: 'error',
        message: e instanceof PreconditionError ? e.message : `No se pudo leer el proyecto: ${describeError(e)}`,
      });
    }
  }, [catalog, selection, client, context.companyId, context.projectId, run, clearDryLog]);

  const busy = phase.kind === 'preparing' || phase.kind === 'running' || phase.kind === 'confirm';
  const showProgress = phase.kind === 'running' || phase.kind === 'finished';

  return (
    <>
      <main className="flex-1 space-y-3 px-4 py-3">
        {phase.kind === 'error' && (
          <Notice tone="error" title="No se ha creado nada">
            {phase.message}
          </Notice>
        )}

        {showProgress ? (
          <>
            {phase.kind === 'finished' && phase.result.ok && (
              <p className="text-xs text-slate-500">
                Fecha fin de la planificación: <strong>{formatDateEs(phase.endDate)}</strong>
              </p>
            )}
            <ProgressPanel
              steps={phase.kind === 'running' ? phase.steps : phase.result.steps}
              summary={phase.kind === 'finished' ? phase.result.summary : undefined}
              ok={phase.kind === 'finished' ? phase.result.ok : undefined}
              onClose={phase.kind === 'finished' ? () => setPhase({ kind: 'idle' }) : undefined}
            />
          </>
        ) : (
          <>
            <SearchBar value={query} onChange={setQuery} resultCount={visibleCount} />
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">No hay elementos que coincidan con «{query}».</p>
            )}
            {filtered.map((visibleDomain) => {
              const domain = catalog.domains.find((d) => d.id === visibleDomain.id)!;
              return (
                <DomainAccordion
                  key={domain.id}
                  domain={domain}
                  visible={visibleDomain.elements}
                  expanded={query.trim() !== '' || expanded.has(domain.id)}
                  selection={selection}
                  onToggleExpanded={() =>
                    setExpanded((s) => {
                      const n = new Set(s);
                      if (n.has(domain.id)) n.delete(domain.id);
                      else n.add(domain.id);
                      return n;
                    })
                  }
                  onToggleAll={(checked) => {
                    setSelection((s) => setDomainSelection(s, domain.elements, checked));
                    if (checked) setExpanded((s) => new Set(s).add(domain.id));
                  }}
                  onToggleElement={(id, checked) => setSelection((s) => toggleElement(s, id, checked))}
                  onValueChange={(id, v) => setSelection((s) => setValue(s, id, v))}
                />
              );
            })}
          </>
        )}

        {dryRun && <DryRunLog entries={dryLog} />}
      </main>

      {!showProgress && (
        <CreateBar
          selectedCount={selectedCount}
          pendingCount={pendingCount}
          busy={busy}
          onCreate={() => void onCreate()}
        />
      )}

      {phase.kind === 'confirm' && (
        <DuplicateDialog
          existing={phase.prepared.existing}
          onReuse={() => void run(phase.prepared, phase.sections, true)}
          onAbort={() => setPhase({ kind: 'idle' })}
        />
      )}
    </>
  );
}
