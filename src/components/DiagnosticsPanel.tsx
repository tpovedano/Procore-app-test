import { useState } from 'react';
import { runDiagnostics, type DiagnosticEntry } from '../lib/diagnostics';
import type { ProcoreClient } from '../lib/procore';
import { describeError } from '../lib/workflow';
import { Spinner } from './icons';

interface Props {
  client: ProcoreClient;
  companyId: string;
  projectId: string;
}

/** Herramienta de soporte: consulta (solo GET) qué rutas de Inspections existen y con qué forma responden. */
export function DiagnosticsPanel({ client, companyId, projectId }: Props) {
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setRunning(true);
    setEntries([]);
    setError(null);
    try {
      await runDiagnostics(client, companyId, projectId, (e) => setEntries((l) => [...l, e]));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-700">Herramientas de soporte</summary>
      <p className="mt-2 text-slate-600">
        El diagnóstico solo <strong>consulta</strong> Procore (no crea ni modifica nada) y genera un informe con las rutas
        de Inspections disponibles y ejemplos de sus respuestas.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-900 disabled:opacity-60"
        >
          {running && <Spinner />} Diagnóstico de API
        </button>
        {entries.length > 0 && !running && (
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            {copied ? 'Copiado ✓' : 'Copiar informe'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-red-700">{error}</p>}
      {entries.length > 0 && (
        <ul className="mt-2 space-y-1" aria-live="polite">
          {entries.map((e, i) => (
            <li key={i} className="font-mono text-[11px] break-all">
              <span
                className={`mr-1 font-semibold ${
                  e.status !== null && e.status < 300 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {e.status ?? 'ERR'}
              </span>
              <span className="text-slate-500">{e.label}</span>
              {e.error && <span className="text-red-700"> — {e.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
