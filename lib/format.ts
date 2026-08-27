/** 1380.6 -> "1,380.6" */
export function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 축 눈금용. 자릿수 구분 쉼표 없이 "1550", "2.5" 처럼 찍는다. */
export function formatAxisNumber(value: number, digits: number): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
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

/** "2026-07-01" -> "2026.7월" (월별 통계 표기) */
export function formatKoreanMonth(date: string): string {
  const [y, m] = date.split("-");
  return `${y}.${Number(m)}월`;
}

/** 관측 주기에 맞는 날짜 표기 */
export function formatPeriod(date: string, period: "day" | "month"): string {
  return period === "month" ? formatKoreanMonth(date) : formatKoreanDate(date);
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

/**
 * 지표 성격에 맞는 변화량 표기.
 * 금리는 bp, 정책금리는 %p(전월대비), 환율은 절대값과 변화율을 함께 쓴다.
 */
export function formatChange(
  style: "bp" | "pp" | "pct",
  change: number,
  changePct: number,
  digits: number
): string {
  if (style === "bp") return `${formatSigned(Math.round(change * 100), 0)}bp`;
  if (style === "pp") return `${formatSigned(change, digits)}%p(전월대비)`;
  return `${formatSigned(change, digits)} (${formatSigned(changePct, 2)}%)`;
}
