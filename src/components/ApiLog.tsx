import { useState } from 'react';
import { formatLog, type ApiLogEntry } from '../lib/apiLog';

interface Props {
  entries: ApiLogEntry[];
  /** En dry-run se muestran las peticiones que se enviarían; si no, el registro técnico real. */
  dryRun: boolean;
}

export function ApiLog({ entries, dryRun }: Props) {
  const [copied, setCopied] = useState(false);
  if (entries.length === 0) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatLog(entries));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const failed = entries.filter((e) => e.error).length;
  const title = dryRun
    ? `Dry-run: ${entries.length} peticiones que se enviarían a Procore`
    : `Registro técnico: ${entries.length} llamadas a Procore${failed ? ` (${failed} con error)` : ''}`;

  return (
    <details
      className={`rounded-xl border p-3 text-xs ${dryRun ? 'border-amber-300 bg-amber-50' : 'border-slate-300 bg-white'}`}
      open={!dryRun && failed > 0}
    >
      <summary className={`cursor-pointer font-semibold ${dryRun ? 'text-amber-900' : 'text-slate-800'}`}>{title}</summary>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          {copied ? 'Copiado ✓' : 'Copiar registro'}
        </button>
      </div>
      <ol className="mt-2 space-y-2">
        {entries.map((e) => (
          <li key={e.seq} className={`rounded-lg bg-white p-2 shadow-sm ${e.error ? 'ring-1 ring-red-300' : ''}`}>
            <p className="font-mono text-[11px] break-all text-slate-800">
              <span className={`font-semibold ${dryRun ? 'text-amber-800' : 'text-slate-900'}`}>{e.method}</span> {e.path}
              {e.query && Object.keys(e.query).length > 0 && `?${new URLSearchParams(e.query as Record<string, string>)}`}
              {e.status !== undefined && (
                <span className={`ml-1 font-semibold ${e.status >= 400 ? 'text-red-700' : 'text-emerald-700'}`}>
                  → {e.status}
                </span>
              )}
            </p>
            {e.body !== undefined && (
              <>
                <p className="mt-1 text-[10px] font-medium text-slate-500 uppercase">Enviado</p>
                <pre className="max-h-40 overflow-auto rounded bg-slate-900 p-2 font-mono text-[11px] text-slate-100">
                  {JSON.stringify(e.body, null, 2)}
                </pre>
              </>
            )}
            {!dryRun && e.response !== undefined && (
              <>
                <p className="mt-1 text-[10px] font-medium text-slate-500 uppercase">Respuesta</p>
                <pre className="max-h-40 overflow-auto rounded bg-slate-100 p-2 font-mono text-[11px] text-slate-800">
                  {JSON.stringify(e.response, null, 2)}
                </pre>
              </>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
