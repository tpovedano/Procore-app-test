import { Spinner } from './icons';

interface Props {
  selectedCount: number;
  pendingCount: number;
  busy: boolean;
  onCreate: () => void;
}

export function CreateBar({ selectedCount, pendingCount, busy, onCreate }: Props) {
  const disabled = busy || selectedCount === 0 || pendingCount > 0;
  const hint =
    selectedCount === 0
      ? 'Selecciona al menos un elemento.'
      : pendingCount > 0
        ? `Completa ${pendingCount} ${pendingCount === 1 ? 'valor objetivo' : 'valores objetivo'}.`
        : 'Listo para crear las inspecciones.';

  return (
    <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 tabular-nums">
            {selectedCount} {selectedCount === 1 ? 'elemento' : 'elementos'}
          </p>
          <p id="create-hint" className={`truncate text-xs ${pendingCount > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
            {hint}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={disabled}
          aria-describedby="create-hint"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {busy && <Spinner />}
          {busy ? 'Creando…' : 'Crear'}
        </button>
      </div>
    </div>
  );
}
