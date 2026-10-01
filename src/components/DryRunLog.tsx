import type { DryRunEntry } from '../lib/dryRun';

export function DryRunLog({ entries }: { entries: DryRunEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-amber-900">
        Dry-run: {entries.length} peticiones que se enviarían a Procore
      </summary>
      <ol className="mt-2 space-y-2">
        {entries.map((e) => (
          <li key={e.seq} className="rounded-lg bg-white p-2 shadow-sm">
            <p className="font-mono text-[11px] break-all text-slate-800">
              <span className="font-semibold text-amber-800">{e.method}</span> {e.path}
              {e.query && Object.keys(e.query).length > 0 && `?${new URLSearchParams(e.query as Record<string, string>)}`}
            </p>
            {e.body !== undefined && (
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
                {JSON.stringify(e.body, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
