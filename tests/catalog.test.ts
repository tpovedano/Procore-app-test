import { describe, expect, it } from 'vitest';
import realCatalog from '../src/catalog.json';
import { CatalogError, filterCatalog, itemName, parseCatalog } from '../src/lib/catalog';
import { catalog } from './fixtures';

describe('catálogo', () => {
  it('el src/catalog.json del repo es válido (v3)', () => {
    const c = parseCatalog(realCatalog);
    expect(c.version).toBe(3);
    expect(c.domains.length).toBeGreaterThan(0);
  });

  it('rechaza versiones distintas de 3, tipos inválidos e ids duplicados', () => {
    expect(() => parseCatalog({ version: 2, domains: [] })).toThrow(CatalogError);
    expect(() =>
      parseCatalog({ version: 3, domains: [{ id: 'a', label: 'A', elements: [{ id: 'x', label: 'X', unit: null, valueType: 'date' }] }] }),
    ).toThrow(CatalogError);
    expect(() =>
      parseCatalog({
        version: 3,
        domains: [
          { id: 'a', label: 'A', elements: [{ id: 'x', label: 'X', unit: null, valueType: 'text' }] },
          { id: 'b', label: 'B', elements: [{ id: 'x', label: 'Y', unit: null, valueType: 'text' }] },
        ],
      }),
    ).toThrow(/duplicado/);
  });

  it('nombre del ítem: "{label} ({unit})" o solo "{label}"', () => {
    expect(itemName({ label: 'Incidentes', unit: 'uds' })).toBe('Incidentes (uds)');
    expect(itemName({ label: 'Protocolo', unit: null })).toBe('Protocolo');
  });

  it('filtra por nombre sin distinguir tildes ni mayúsculas y oculta dominios vacíos', () => {
    const r = filterCatalog(catalog, 'FORMACION');
    expect(r).toHaveLength(1);
    expect(r[0]!.elements.map((e) => e.id)).toEqual(['form']);
    expect(filterCatalog(catalog, 'calidad')[0]!.elements).toHaveLength(2); // coincide con el dominio
    expect(filterCatalog(catalog, 'zzz')).toEqual([]);
    expect(filterCatalog(catalog, '  ')).toBe(catalog.domains);
  });
});
