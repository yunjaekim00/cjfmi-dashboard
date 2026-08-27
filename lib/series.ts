import type { MergedRow, Point } from "@/lib/types";

export type RangeKey = "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "10Y" | "전체";

export const RANGE_KEYS: RangeKey[] = [
  "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "전체",
];

/** "2026-08-25" -> epoch ms (UTC 자정 기준) */
export function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * 선택한 기간의 시작 시각을 계산한다.
 * 기준점은 "오늘"이 아니라 데이터의 마지막 관측일 — 주말/공휴일에도
 * 차트가 비어 보이지 않도록.
 */
export function rangeStartMs(latestMs: number, range: RangeKey): number {
  if (range === "전체") return Number.NEGATIVE_INFINITY;

  const d = new Date(latestMs);

  if (range === "YTD") return Date.UTC(d.getUTCFullYear(), 0, 1);

  const months: Record<Exclude<RangeKey, "전체" | "YTD">, number> = {
    "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60, "10Y": 120,
  };

  const back = new Date(latestMs);
  back.setUTCMonth(back.getUTCMonth() - months[range]);
  return back.getTime();
}

/** 여러 시계열을 날짜 기준으로 합친다. 결측일은 null 로 남겨 connectNulls 가 잇는다. */
export function mergeSeries(series: Record<string, Point[]>): MergedRow[] {
  const byDate = new Map<string, MergedRow>();
  const keys = Object.keys(series);

  for (const key of keys) {
    for (const point of series[key]) {
      let row = byDate.get(point.date);
      if (!row) {
        row = { t: toMs(point.date), date: point.date };
        for (const k of keys) row[k] = null;
        byDate.set(point.date, row);
      }
      row[key] = point.value;
    }
  }

  return [...byDate.values()].sort((a, b) => a.t - b.t);
}

/** 최신 값과 직전 값의 차이. 관측치가 하나뿐이면 변화량 0. */
export function latestChange(points: Point[]) {
  const latest = points.at(-1);
  const previous = points.at(-2);

  if (!latest) return null;

  const change = previous ? latest.value - previous.value : 0;
  const changePct = previous && previous.value !== 0 ? (change / previous.value) * 100 : 0;

  return { latest, change, changePct };
}

/** 스파크라인용으로 마지막 n 개월치만 잘라낸다. */
export function tail(points: Point[], months: number): Point[] {
  const last = points.at(-1);
  if (!last) return [];

  const cutoff = new Date(toMs(last.date));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  return points.filter((p) => toMs(p.date) >= cutoff.getTime());
}

/**
 * 시간 축 눈금. 구간에 따라 일("8.21") / 월("Oct 2025") / 연("2026") 단위를 고른다.
 * 눈금이 6~8개를 넘지 않도록 간격을 넓힌다.
 */
export function buildTimeTicks(startMs: number, endMs: number) {
  const spanDays = (endMs - startMs) / 86_400_000;
  const ticks: number[] = [];

  // 3개월 이하 구간은 월 눈금이 한두 개밖에 안 나오므로 일 단위로 쪼갠다.
  if (spanDays <= 100) {
    const count = 6;
    for (let i = 0; i < count; i += 1) {
      const t = startMs + ((endMs - startMs) * i) / (count - 1);
      ticks.push(Math.round(t / 86_400_000) * 86_400_000);
    }
    return { ticks, unit: "day" as const };
  }

  if (spanDays <= 730) {
    const stepMonths = spanDays <= 200 ? 1 : spanDays <= 400 ? 3 : 6;
    const cursor = new Date(startMs);
    cursor.setUTCDate(1);
    cursor.setUTCHours(0, 0, 0, 0);
    // 시작점 이후 첫 눈금부터
    if (cursor.getTime() < startMs) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    // 눈금 간격에 맞는 달로 정렬
    while (cursor.getUTCMonth() % stepMonths !== 0) {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    while (cursor.getTime() <= endMs) {
      ticks.push(cursor.getTime());
      cursor.setUTCMonth(cursor.getUTCMonth() + stepMonths);
    }
    return { ticks, unit: "month" as const };
  }

  const spanYears = spanDays / 365;
  const stepYears = spanYears <= 8 ? 1 : spanYears <= 16 ? 2 : spanYears <= 40 ? 5 : 10;
  let year = new Date(startMs).getUTCFullYear();
  while (year % stepYears !== 0) year += 1;
  for (; Date.UTC(year, 0, 1) <= endMs; year += stepYears) {
    const t = Date.UTC(year, 0, 1);
    if (t >= startMs) ticks.push(t);
  }
  return { ticks, unit: "year" as const };
}

/**
 * y축 도메인과 눈금을 함께 계산한다.
 * recharts 에 도메인만 주면 눈금을 균등 분할해 1415 같은 값이 나오므로,
 * 눈금 간격을 먼저 정하고 그 배수만 눈금으로 쓴다.
 */
export function niceScale(values: number[], targetTicks = 5) {
  if (!values.length) return { domain: [0, 1] as [number, number], ticks: [0, 1] };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.abs(max) || 1;

  const pad = spread * 0.06;
  const lo = min - pad;
  const hi = max + pad;

  const step = niceStep(spread / targetTicks);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }

  return { domain: [lo, hi] as [number, number], ticks };
}

function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const snapped = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return snapped * magnitude;
}
