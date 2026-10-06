import { useEffect, useRef } from 'react';
import type { ExistingObjects } from '../lib/workflow';
import { AlertIcon } from './icons';

interface Props {
  existing: ExistingObjects;
  onReuse: () => void;
  onAbort: () => void;
}

/** Diálogo modal accesible (foco atrapado, Escape = abortar). */
export function DuplicateDialog({ existing, onReuse, onAbort }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAbort();
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button'));
        if (f.length === 0) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onAbort]);

  const rows = [
    existing.template && { k: 'Plantilla', v: existing.template.name },
    existing.companyTemplate && { k: 'Plantilla (compañía)', v: existing.companyTemplate.name },
    existing.inspection && { k: 'Inspección', v: existing.inspection.name },
    existing.schedule && { k: 'Planificada', v: existing.schedule.name },
  ].filter(Boolean) as { k: string; v: string }[];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dup-title"
        aria-describedby="dup-desc"
        className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-full bg-amber-100 p-1.5 text-amber-700">
            <AlertIcon />
          </span>
          <div className="min-w-0">
            <h2 id="dup-title" className="text-sm font-semibold text-slate-900">
              Ya existen objetos con el mismo nombre
            </h2>
            <p id="dup-desc" className="mt-1 text-xs text-slate-600">
              Para evitar duplicados puedes reutilizarlos (se actualizarán los valores y la fecha fin) o cancelar sin
              crear nada.
            </p>
          </div>
        </div>
        <dl className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
          {rows.map((r) => (
            <div key={r.k} className="flex gap-2">
              <dt className="w-20 shrink-0 font-medium text-slate-500">{r.k}</dt>
              <dd className="min-w-0 truncate text-slate-800">{r.v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onAbort}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onReuse}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Reutilizar
          </button>
        </div>
      </div>
    </div>
  );
}
