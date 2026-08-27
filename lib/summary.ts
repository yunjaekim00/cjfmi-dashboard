import { latestChange, tail } from "@/lib/series";
import type { ExchangeRateData, IndicatorSummary } from "@/lib/types";

/**
 * 종합지표 탭 카드용 요약.
 * 폴링으로 갱신된 데이터를 클라이언트에서도 다시 계산해야 하므로
 * 서버 전용 모듈(lib/data.ts)이 아니라 여기에 둔다.
 */
export function summarizeUsdKrw(data: ExchangeRateData): IndicatorSummary | null {
  const change = latestChange(data.bok);

  if (!change) return null;

  return {
    id: "usdkrw",
    label: "원/달러",
    unit: "원",
    value: change.latest.value,
    change: change.change,
    changePct: change.changePct,
    asOf: change.latest.date,
    digits: 1,
    spark: tail(data.bok, 3),
  };
}
