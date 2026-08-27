/** 1380.6 -> "1,380.6" */
export function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** -3.0 -> "-3.0", 3.0 -> "+3.0" */
export function formatSigned(value: number, digits: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(value), digits)}`;
}

/** "2026-08-25" -> "2026.8.25" */
export function formatKoreanDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y}.${Number(m)}.${Number(d)}`;
}

/** "2026-08-25" -> "26.8.25." (자료 출처 표기용) */
export function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y.slice(2)}.${Number(m)}.${Number(d)}.`;
}

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** epoch ms -> "Oct 2025" */
export function formatMonthTick(t: number): string {
  const d = new Date(t);
  return `${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** epoch ms -> "2026" */
export function formatYearTick(t: number): string {
  return String(new Date(t).getUTCFullYear());
}

/** epoch ms -> "8.21" */
export function formatDayTick(t: number): string {
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
}
