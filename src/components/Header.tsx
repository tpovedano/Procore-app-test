interface Props {
  projectName: string | null;
  userName: string | null;
  dryRun: boolean;
  environment: 'sandbox' | 'production';
  onDisconnect?: () => void;
}

export function Header({ projectName, userName, dryRun, environment, onDisconnect }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wide text-brand-600 uppercase">Objetivos del proyecto</p>
          <h1 className="truncate text-base font-semibold text-slate-900" title={projectName ?? undefined}>
            {projectName ?? 'Cargando proyecto…'}
          </h1>
          <p className="truncate text-xs text-slate-500">
            <span className="sr-only">Usuario: </span>
            {userName ?? '—'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {dryRun && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Dry-run</span>
          )}
          {environment === 'sandbox' && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">Sandbox</span>
          )}
          {onDisconnect && (
            <button
              type="button"
              onClick={onDisconnect}
              className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              Desconectar
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
