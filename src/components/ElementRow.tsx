import { useState } from 'react';
import type { CatalogElement } from '../lib/catalog';
import { validateValue } from '../lib/selection';

interface Props {
  element: CatalogElement;
  selected: boolean;
  value: string;
  onToggle: (checked: boolean) => void;
  onValueChange: (value: string) => void;
}

export function ElementRow({ element, selected, value, onToggle, onValueChange }: Props) {
  const [touched, setTouched] = useState(false);
  const checkboxId = `el-${element.id}`;
  const inputId = `val-${element.id}`;
  const errorId = `err-${element.id}`;
  const validation = selected ? validateValue(element.valueType, value) : null;
  const showError = Boolean(validation && !validation.ok && (touched || value !== ''));

  return (
    <li className={`px-3 py-2 transition-colors ${selected ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}>
      <div className="flex items-center gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            onToggle(e.target.checked);
            if (!e.target.checked) setTouched(false);
          }}
          className="size-4 shrink-0 cursor-pointer rounded border-slate-300 accent-brand-600"
        />
        <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer text-sm text-slate-800">
          {element.label}
          {element.unit && <span className="ml-1 text-xs text-slate-500">({element.unit})</span>}
        </label>
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 uppercase">
          {element.valueType === 'number' ? 'Nº' : 'Texto'}
        </span>
      </div>

      {selected && (
        <div className="mt-2 pl-7">
          <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-slate-600">
            Valor objetivo
          </label>
          <div className="flex items-stretch">
            <input
              id={inputId}
              type="text"
              inputMode={element.valueType === 'number' ? 'decimal' : 'text'}
              autoComplete="off"
              value={value}
              maxLength={element.valueType === 'number' ? 20 : 500}
              placeholder={element.valueType === 'number' ? 'p. ej. 10' : 'Escribe el objetivo'}
              onChange={(e) => onValueChange(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-required="true"
              aria-invalid={showError}
              aria-describedby={showError ? errorId : undefined}
              className={`min-w-0 flex-1 border bg-white px-3 py-1.5 text-sm shadow-sm focus:outline-none ${
                element.unit && element.valueType === 'number' ? 'rounded-l-md' : 'rounded-md'
              } ${showError ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-brand-500'}`}
            />
            {element.unit && element.valueType === 'number' && (
              <span className="flex items-center rounded-r-md border border-l-0 border-slate-300 bg-slate-100 px-2 text-xs text-slate-600">
                {element.unit}
              </span>
            )}
          </div>
          {showError && validation && !validation.ok && (
            <p id={errorId} className="mt-1 text-xs text-red-600">
              {validation.error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
