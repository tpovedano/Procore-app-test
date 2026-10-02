/**
 * Estado de selección y validación de valores objetivo (lógica pura, sin React).
 */
import { itemName, type Catalog, type CatalogDomain, type CatalogElement, type ValueType } from './catalog.js';

/** elementId → valor objetivo tal como lo escribe el usuario. Solo contiene elementos marcados. */
export type Selection = Readonly<Record<string, string>>;

export const MAX_TEXT_LENGTH = 500;
export const MAX_NUMBER = 1e12;

export function isSelected(sel: Selection, elementId: string): boolean {
  return Object.prototype.hasOwnProperty.call(sel, elementId);
}

export function toggleElement(sel: Selection, elementId: string, checked: boolean): Selection {
  if (checked) {
    if (isSelected(sel, elementId)) return sel;
    return { ...sel, [elementId]: '' };
  }
  if (!isSelected(sel, elementId)) return sel;
  const next = { ...sel };
  delete next[elementId];
  return next;
}

/** Marca o desmarca todos los elementos indicados (p. ej. los visibles de un dominio). Conserva valores ya escritos. */
export function setDomainSelection(sel: Selection, elements: readonly CatalogElement[], checked: boolean): Selection {
  let next = sel;
  for (const e of elements) next = toggleElement(next, e.id, checked);
  return next;
}

export function setValue(sel: Selection, elementId: string, value: string): Selection {
  if (!isSelected(sel, elementId)) return sel;
  return { ...sel, [elementId]: value };
}

export type DomainCheckState = 'none' | 'some' | 'all';

export function domainCheckState(sel: Selection, elements: readonly CatalogElement[]): DomainCheckState {
  const n = countSelected(sel, elements);
  if (n === 0) return 'none';
  return n === elements.length ? 'all' : 'some';
}

export function countSelected(sel: Selection, elements: readonly CatalogElement[]): number {
  return elements.reduce((acc, e) => acc + (isSelected(sel, e.id) ? 1 : 0), 0);
}

// ─── Saneado y validación ──────────────────────────────────────────────────────

/** Quita caracteres de control (salvo saltos de línea/tab), recorta y limita longitud. */
export function sanitizeText(raw: string, maxLength = MAX_TEXT_LENGTH): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

/** Acepta coma o punto decimal. Devuelve null si no es un número finito válido. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type ValidationResult =
  | { ok: true; value: number | string }
  | { ok: false; error: string };

export function validateValue(valueType: ValueType, raw: string): ValidationResult {
  if (valueType === 'number') {
    if (raw.trim() === '') return { ok: false, error: 'Introduce un valor numérico.' };
    const n = parseNumber(raw);
    if (n === null) return { ok: false, error: 'El valor debe ser un número válido.' };
    if (n < 0) return { ok: false, error: 'El valor debe ser mayor o igual que 0.' };
    if (n > MAX_NUMBER) return { ok: false, error: 'El valor es demasiado grande.' };
    return { ok: true, value: n };
  }
  const t = sanitizeText(raw);
  if (t === '') return { ok: false, error: 'Introduce un texto.' };
  return { ok: true, value: t };
}

// ─── Plan de creación ──────────────────────────────────────────────────────────

export interface PlannedItem {
  elementId: string;
  /** Nombre del ítem en Procore: "{label} ({unit})" o "{label}". */
  name: string;
  valueType: ValueType;
  target: number | string;
}

export interface PlannedSection {
  domainId: string;
  /** Nombre de la sección = nombre del dominio. */
  name: string;
  items: PlannedItem[];
}

export interface PlanError {
  elementId: string;
  label: string;
  error: string;
}

export type PlanResult =
  | { ok: true; sections: PlannedSection[] }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'invalid'; errors: PlanError[] };

/**
 * Convierte la selección en secciones/ítems. Solo incluye dominios con elementos
 * seleccionados y respeta el orden del catálogo.
 */
export function buildPlan(catalog: Catalog, sel: Selection): PlanResult {
  const sections: PlannedSection[] = [];
  const errors: PlanError[] = [];

  for (const d of catalog.domains) {
    const items: PlannedItem[] = [];
    for (const e of d.elements) {
      if (!isSelected(sel, e.id)) continue;
      const v = validateValue(e.valueType, sel[e.id] ?? '');
      if (!v.ok) {
        errors.push({ elementId: e.id, label: e.label, error: v.error });
        continue;
      }
      items.push({ elementId: e.id, name: itemName(e), valueType: e.valueType, target: v.value });
    }
    if (items.length > 0) sections.push({ domainId: d.id, name: d.label, items });
  }

  if (errors.length > 0) return { ok: false, reason: 'invalid', errors };
  if (sections.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, sections };
}

/** Elimina de la selección ids que ya no existen en el catálogo. */
export function pruneSelection(catalog: Catalog, sel: Selection): Selection {
  const ids = new Set(catalog.domains.flatMap((d: CatalogDomain) => d.elements.map((e) => e.id)));
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(sel)) if (ids.has(k)) next[k] = v;
  return next;
}
