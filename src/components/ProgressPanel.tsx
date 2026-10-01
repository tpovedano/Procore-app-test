import type { StepState, StepStatus } from '../lib/workflow';
import { AlertIcon, CheckIcon, ExternalIcon, Spinner, XIcon } from './icons';

const STATUS_TEXT: Record<StepStatus, string> = {
  pending: 'Pendiente',
  running: 'En curso',
  done: 'Creado',
  reused: 'Reutilizado',
  warning: 'Completado con avisos',
  failed: 'Error',
  skipped: 'No creado',
};

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'running':
      return <Spinner className="text-brand-600" />;
    case 'done':
    case 'reused':
      return <CheckIcon className="text-emerald-600" />;
    case 'warning':
      return <AlertIcon className="text-amber-600" />;
    case 'failed':
      return <XIcon className="text-red-600" />;
    default:
      return <span className="block size-4 rounded-full border-2 border-slate-300" aria-hidden="true" />;
  }
}

interface Props {
  steps: StepState[];
  summary?: string[];
  ok?: boolean;
  onClose?: () => void;
}

export function ProgressPanel({ steps, summary, ok, onClose }: Props) {
  const finished = summary !== undefined;
  return (
    <section
      aria-labelledby="progress-title"
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        !finished ? 'border-slate-200' : ok ? 'border-emerald-300' : 'border-red-300'
      }`}
    >
      <h2 id="progress-title" className="text-sm font-semibold text-slate-900">
        {!finished ? 'Creando en Procore…' : ok ? 'Inspecciones listas' : 'Proceso interrumpido'}
      </h2>
      <ol className="mt-3 space-y-2" aria-live="polite">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0">
              <StatusIcon status={s.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">
                {s.label} <span className="sr-only">: {STATUS_TEXT[s.status]}</span>
                <span aria-hidden="true" className="ml-1 text-xs text-slate-500">
                  · {STATUS_TEXT[s.status]}
                </span>
              </p>
              {s.detail && (
                <p className={`text-xs ${s.status === 'failed' ? 'text-red-700' : 'text-slate-500'}`}>{s.detail}</p>
              )}
              {s.url && (s.status === 'done' || s.status === 'reused' || s.status === 'warning') && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  Abrir en Procore <ExternalIcon width={12} height={12} />
                  <span className="sr-only">(se abre en una pestaña nueva)</span>
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      {finished && summary && summary.length > 0 && (
        <div className={`mt-4 rounded-lg p-3 text-xs ${ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
          <p className="mb-1 font-semibold">Resumen</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {summary.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {finished && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Volver a la selección
        </button>
      )}
    </section>
  );
}
