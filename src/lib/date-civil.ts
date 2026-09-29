const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CivilDate = { year: number; month: number; day: number };

export function parseCivilDate(value: unknown): CivilDate | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(DATE_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatCivilDate(value: unknown, separator = '-'): string | null {
  const parsed = parseCivilDate(typeof value === 'string' ? value.slice(0, 10) : value);
  if (!parsed) return null;
  return [parsed.year, String(parsed.month).padStart(2, '0'), String(parsed.day).padStart(2, '0')].join(separator);
}

export function formatCivilDateDisplay(value: unknown): string | null {
  const parsed = parseCivilDate(typeof value === 'string' ? value.slice(0, 10) : value);
  if (!parsed) return null;
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month).padStart(2, '0')}/${parsed.year}`;
}

export function todayInSaoPaulo(): CivilDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  };
}

export function excelSerialToCivilDate(value: number): string | null {
  if (!Number.isFinite(value) || value < 1) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(value) * 86400000);
  return formatCivilDate(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`);
}
