import { useEffect, useRef } from 'react';
import type { CatalogDomain } from '../lib/catalog';
import { countSelected, domainCheckState, isSelected, type Selection } from '../lib/selection';
import { ElementRow } from './ElementRow';
import { ChevronIcon } from './icons';

interface Props {
  /** Dominio completo (para "Seleccionar todos" y contador). */
  domain: CatalogDomain;
  /** Elementos visibles tras el filtro de búsqueda. */
  visible: CatalogDomain['elements'];
  expanded: boolean;
  selection: Selection;
  onToggleExpanded: () => void;
  onToggleAll: (checked: boolean) => void;
  onToggleElement: (id: string, checked: boolean) => void;
  onValueChange: (id: string, value: string) => void;
}

export function DomainAccordion(props: Props) {
  const { domain, visible, expanded, selection } = props;
  const state = domainCheckState(selection, domain.elements);
  const count = countSelected(selection, domain.elements);
  const allRef = useRef<HTMLInputElement>(null);
  const panelId = `panel-${domain.id}`;
  const headerId = `header-${domain.id}`;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = state === 'some';
  }, [state]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 pr-3">
        <h2 className="min-w-0 flex-1">
          <button
            id={headerId}
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={props.onToggleExpanded}
            className="flex w-full items-center gap-2 px-3 py-3 text-left"
          >
            <ChevronIcon className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`} />
            <span className="truncate text-sm font-semibold text-slate-900">{domain.label}</span>
            <span
              className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                count > 0 ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'
              }`}
              aria-label={`${count} de ${domain.elements.length} seleccionados`}
            >
              {count}/{domain.elements.length}
            </span>
          </button>
        </h2>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input
            ref={allRef}
            type="checkbox"
            checked={state === 'all'}
            onChange={(e) => props.onToggleAll(e.target.checked)}
            aria-label={`Seleccionar todos los elementos de ${domain.label}`}
            className="size-4 cursor-pointer accent-brand-600"
          />
          <span aria-hidden="true">Todos</span>
        </label>
      </div>

      {expanded && (
        <div id={panelId} role="region" aria-labelledby={headerId}>
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {visible.map((el) => (
            <ElementRow
              key={el.id}
              element={el}
              selected={isSelected(selection, el.id)}
              value={selection[el.id] ?? ''}
              onToggle={(c) => props.onToggleElement(el.id, c)}
              onValueChange={(v) => props.onValueChange(el.id, v)}
            />
          ))}
        </ul>
        </div>
      )}
    </section>
  );
}
