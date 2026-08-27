import { CARDS } from "@/lib/catalog";
import { changeVsMonthsAgo, latestChange, tail } from "@/lib/series";
import type { IndicatorSummary, SeriesMap } from "@/lib/types";

/**
 * 종합지표 카드 값 계산.
 * 폴링으로 갱신된 데이터를 클라이언트에서도 다시 계산해야 하므로
 * 서버 전용 모듈(lib/dashboard.ts)이 아니라 여기에 둔다.
 */
export function buildSummaries(series: SeriesMap): IndicatorSummary[] {
  return CARDS.flatMap((card) => {
    const points = series[card.seriesId] ?? [];
    const change = card.compareMonthsBack
      ? changeVsMonthsAgo(points, card.compareMonthsBack)
      : latestChange(points);

    if (!change) return [];

    const sparkSource = card.sparkSeriesId ? (series[card.sparkSeriesId] ?? points) : points;

    return [
      {
        id: card.id,
        label: card.label,
        unit: card.unit,
        value: change.latest.value,
        change: change.change,
        changePct: change.changePct,
        asOf: change.latest.date,
        period: card.period,
        digits: card.digits,
        changeStyle: card.changeStyle,
        spark: tail(sparkSource, card.sparkMonths),
        stepSpark: card.stepSpark ?? false,
      } satisfies IndicatorSummary,
    ];
  });
}
