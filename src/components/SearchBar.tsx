import { SearchIcon, XIcon } from './icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  resultCount: number;
}

export function SearchBar({ value, onChange, resultCount }: Props) {
  return (
    <div className="relative">
      <label htmlFor="search" className="sr-only">
        Buscar elementos por nombre
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
      <input
        id="search"
        type="search"
        value={value}
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar elemento…"
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-9 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
        >
          <XIcon />
        </button>
      )}
      <p className="sr-only" aria-live="polite">
        {value ? `${resultCount} elementos encontrados` : ''}
      </p>
    </div>
  );
}
