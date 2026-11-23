import { CARDS } from "@/lib/catalog";
import { changeVsMonthsAgo, latestChange, tail } from "@/lib/series";
import type { Delta, IndicatorSummary, Point, SeriesMap } from "@/lib/types";

/**
 * 종합지표 카드 값 계산.
 * 폴링으로 갱신된 데이터를 클라이언트에서도 다시 계산해야 하므로
 * 서버 전용 모듈(lib/dashboard.ts)이 아니라 여기에 둔다.
 */
export function buildSummaries(series: SeriesMap): IndicatorSummary[] {
  return CARDS.flatMap((card) => {
    const points = series[card.seriesId] ?? [];
    const latest = points.at(-1);
    if (!latest) return [];

    // 카드마다 전일대비(직전 관측치)와 전월대비(한 달 전 값)를 둘 다 적는다.
    const day = toDelta(latestChange(points));
    const month = toDelta(changeVsMonthsAgo(points, 1));
    // 스파크라인 색은 대표 변화를 따른다 — 정책금리처럼 값이 며칠씩 그대로인 계열은 전월대비
    const trend = card.compareMonthsBack ? toDelta(changeVsMonthsAgo(points, card.compareMonthsBack)) : day;

    const sparkSource = card.sparkSeriesId ? (series[card.sparkSeriesId] ?? points) : points;

    return [
      {
        id: card.id,
        label: card.label,
        unit: card.unit,
        value: latest.value,
        day,
        month,
        trend: trend?.change ?? 0,
        asOf: latest.date,
        period: card.period,
        digits: card.digits,
        changeStyle: card.changeStyle,
        spark: tail(sparkSource, card.sparkMonths),
        stepSpark: card.stepSpark ?? false,
      } satisfies IndicatorSummary,
    ];
  });
}

type Comparison = { latest: Point; baseline: Point | null; change: number; changePct: number } | null;

/** 비교할 관측치가 없거나 최신치 자신이면(자료가 그만큼 없음) null */
function toDelta(comparison: Comparison): Delta | null {
  if (!comparison?.baseline || comparison.baseline.date === comparison.latest.date) return null;
  return { baseDate: comparison.baseline.date, change: comparison.change, changePct: comparison.changePct };
}
