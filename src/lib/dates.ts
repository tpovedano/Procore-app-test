/**
 * Utilidades de fecha (puras). Procore usa fechas "YYYY-MM-DD" para campos de día.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Devuelve "YYYY-MM-DD" si el valor es una fecha válida (acepta también ISO con hora), o null. */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

/** Fecha local de hoy en formato "YYYY-MM-DD". */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Suma meses a una fecha ISO, ajustando a fin de mes (31-ene + 1 mes → 28/29-feb). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months;
  const ty = y + Math.floor(targetMonthIndex / 12);
  const tm = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

/** Fechas trimestrales (cada 3 meses) desde start hasta end, ambos inclusive. */
export function quarterlyOccurrences(startIso: string, endIso: string, max = 400): string[] {
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const d = addMonthsIso(startIso, i * 3);
    if (d > endIso) break;
    out.push(d);
  }
  return out;
}

export function formatDateEs(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
