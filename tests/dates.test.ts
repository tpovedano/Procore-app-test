import { describe, expect, it } from 'vitest';
import { addMonthsIso, quarterlyOccurrences, toIsoDate } from '../src/lib/dates';

describe('fechas', () => {
  it('toIsoDate valida y normaliza', () => {
    expect(toIsoDate('2027-03-31')).toBe('2027-03-31');
    expect(toIsoDate('2027-03-31T10:00:00Z')).toBe('2027-03-31');
    expect(toIsoDate('2027-02-30')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });

  it('addMonthsIso ajusta a fin de mes', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsIso('2026-10-01', 12)).toBe('2027-10-01');
  });

  it('quarterlyOccurrences cada 3 meses hasta la fecha fin inclusive', () => {
    expect(quarterlyOccurrences('2026-10-01', '2027-07-01')).toEqual([
      '2026-10-01',
      '2027-01-01',
      '2027-04-01',
      '2027-07-01',
    ]);
    expect(quarterlyOccurrences('2026-10-01', '2026-09-30')).toEqual([]);
  });
});
