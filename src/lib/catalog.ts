/**
 * Catálogo de elementos (src/catalog.json, versión 3).
 * Jerarquía: domains → elements. El dominio (id, name) es un agrupador visual y
 * equivale a una SECCIÓN de la inspección.
 */

export type ValueType = 'number' | 'text';

export interface CatalogElement {
  id: string;
  label: string;
  unit: string | null;
  valueType: ValueType;
}

export interface CatalogDomain {
  id: string;
  label: string;
  elements: CatalogElement[];
}

export interface Catalog {
  version: 3;
  domains: CatalogDomain[];
}

export class CatalogError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valida la forma del catálogo en tiempo de ejecución (el JSON puede editarse a mano). */
export function parseCatalog(raw: unknown): Catalog {
  if (!isRecord(raw)) throw new CatalogError('El catálogo no es un objeto JSON.');
  if (raw.version !== 3) {
    throw new CatalogError(`Versión de catálogo no soportada: ${String(raw.version)} (se esperaba 3).`);
  }
  if (!Array.isArray(raw.domains)) throw new CatalogError('El catálogo no tiene "domains".');

  const seenElementIds = new Set<string>();
  const seenDomainIds = new Set<string>();

  const domains = raw.domains.map((d, di): CatalogDomain => {
    // El catálogo v3 nombra el dominio con "name"; se acepta "label" por compatibilidad.
    const domainLabel = isRecord(d) ? (typeof d.name === 'string' ? d.name : d.label) : undefined;
    if (!isRecord(d) || typeof d.id !== 'string' || typeof domainLabel !== 'string' || !Array.isArray(d.elements)) {
      throw new CatalogError(`Dominio inválido en la posición ${di}.`);
    }
    if (seenDomainIds.has(d.id)) throw new CatalogError(`Id de dominio duplicado: ${d.id}`);
    seenDomainIds.add(d.id);

    const elements = d.elements.map((e, ei): CatalogElement => {
      if (
        !isRecord(e) ||
        typeof e.id !== 'string' ||
        typeof e.label !== 'string' ||
        !(e.unit === null || typeof e.unit === 'string') ||
        (e.valueType !== 'number' && e.valueType !== 'text')
      ) {
        throw new CatalogError(`Elemento inválido en ${d.id}[${ei}].`);
      }
      if (seenElementIds.has(e.id)) throw new CatalogError(`Id de elemento duplicado: ${e.id}`);
      seenElementIds.add(e.id);
      const unit = typeof e.unit === 'string' && e.unit.trim() !== '' ? e.unit.trim() : null;
      return { id: e.id, label: e.label.trim(), unit, valueType: e.valueType };
    });

    return { id: d.id, label: domainLabel.trim(), elements };
  });

  return { version: 3, domains };
}

/** Normaliza para búsqueda: minúsculas y sin tildes. */
export function normalizeForSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Filtra elementos por nombre. Los dominios sin coincidencias se omiten.
 * Si el término coincide con el nombre del dominio, se muestran todos sus elementos.
 */
export function filterCatalog(catalog: Catalog, query: string): CatalogDomain[] {
  const q = normalizeForSearch(query);
  if (!q) return catalog.domains;
  return catalog.domains
    .map((d) => {
      if (normalizeForSearch(d.label).includes(q)) return d;
      return { ...d, elements: d.elements.filter((e) => normalizeForSearch(e.label).includes(q)) };
    })
    .filter((d) => d.elements.length > 0);
}

/** Nombre del ítem en Procore: "{label} ({unit})" o "{label}" si no hay unidad. */
export function itemName(element: Pick<CatalogElement, 'label' | 'unit'>): string {
  return element.unit ? `${element.label} (${element.unit})` : element.label;
}
