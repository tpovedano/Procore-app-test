import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  countSelected,
  domainCheckState,
  parseNumber,
  setDomainSelection,
  setValue,
  toggleElement,
  validateValue,
  type Selection,
} from '../src/lib/selection';
import { catalog } from './fixtures';

const seg = catalog.domains[0]!;
const cal = catalog.domains[1]!;

describe('selección múltiple por dominio', () => {
  it('"Seleccionar todos" marca todos los elementos del dominio y actualiza el contador', () => {
    const s = setDomainSelection({}, seg.elements, true);
    expect(countSelected(s, seg.elements)).toBe(3);
    expect(domainCheckState(s, seg.elements)).toBe('all');
    expect(countSelected(s, cal.elements)).toBe(0);
  });

  it('estado parcial y desmarcar todos', () => {
    let s = toggleElement({}, 'inc', true);
    expect(domainCheckState(s, seg.elements)).toBe('some');
    s = setDomainSelection(s, seg.elements, false);
    expect(s).toEqual({});
    expect(domainCheckState(s, seg.elements)).toBe('none');
  });

  it('"Seleccionar todos" conserva valores ya escritos', () => {
    let s = toggleElement({}, 'inc', true);
    s = setValue(s, 'inc', '5');
    s = setDomainSelection(s, seg.elements, true);
    expect(s.inc).toBe('5');
    expect(s.form).toBe('');
  });

  it('setValue ignora elementos no seleccionados', () => {
    expect(setValue({}, 'inc', '3')).toEqual({});
  });
});

describe('validación de valores', () => {
  it('números: >= 0, válidos, admite coma decimal', () => {
    expect(validateValue('number', '0')).toEqual({ ok: true, value: 0 });
    expect(validateValue('number', '12,5')).toEqual({ ok: true, value: 12.5 });
    expect(validateValue('number', ' 3.75 ')).toEqual({ ok: true, value: 3.75 });
    expect(validateValue('number', '-1').ok).toBe(false);
    expect(validateValue('number', 'abc').ok).toBe(false);
    expect(validateValue('number', '1e400').ok).toBe(false); // Infinity
    expect(validateValue('number', '').ok).toBe(false);
    expect(validateValue('number', '1.2.3').ok).toBe(false);
    expect(parseNumber('NaN')).toBeNull();
    expect(parseNumber('0x10')).toBeNull();
  });

  it('texto: no vacío, saneado y recortado', () => {
    expect(validateValue('text', '   ').ok).toBe(false);
    expect(validateValue('text', '  ISO 14001 \u0007')).toEqual({ ok: true, value: 'ISO 14001' });
    const long = validateValue('text', 'x'.repeat(900));
    expect(long.ok && typeof long.value === 'string' && long.value.length).toBe(500);
  });
});

describe('buildPlan', () => {
  it('sin selección → empty', () => {
    expect(buildPlan(catalog, {})).toEqual({ ok: false, reason: 'empty' });
  });

  it('dominio sin selección no genera sección; respeta orden del catálogo', () => {
    const s: Selection = { agua: '100', inc: '0' };
    const plan = buildPlan(catalog, s);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.sections.map((x) => x.name)).toEqual(['Seguridad', 'Medio ambiente']);
    expect(plan.sections.find((x) => x.domainId === 'cal')).toBeUndefined();
  });

  it('mezcla de valores number/text con nombres de ítem correctos', () => {
    const s: Selection = { inc: '2', prot: 'Vigente', nc: '1,5', plan: 'Revisado' };
    const plan = buildPlan(catalog, s);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.sections).toEqual([
      {
        domainId: 'seg',
        name: 'Seguridad',
        items: [
          { elementId: 'inc', name: 'Incidentes (uds)', valueType: 'number', target: 2 },
          { elementId: 'prot', name: 'Protocolo', valueType: 'text', target: 'Vigente' },
        ],
      },
      {
        domainId: 'cal',
        name: 'Calidad',
        items: [
          { elementId: 'nc', name: 'No conformidades (uds)', valueType: 'number', target: 1.5 },
          { elementId: 'plan', name: 'Plan de calidad', valueType: 'text', target: 'Revisado' },
        ],
      },
    ]);
  });

  it('valores inválidos o vacíos → invalid con la lista de errores', () => {
    const plan = buildPlan(catalog, { inc: '-3', prot: '', agua: '5' });
    expect(plan.ok).toBe(false);
    if (plan.ok || plan.reason !== 'invalid') throw new Error('esperaba invalid');
    expect(plan.errors.map((e) => e.elementId)).toEqual(['inc', 'prot']);
  });
});
