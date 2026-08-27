import { EcosError, fetchEcosSeries } from "@/lib/sources/ecos";
import { fetchFredSeries } from "@/lib/sources/fred";
import type { ExchangeRateData, IndicatorSummary, Point, SourceStatus } from "@/lib/types";
import { latestChange, tail } from "@/lib/series";

/** 원/달러 매매기준율 — 한국은행 ECOS 8.8.2.1 주요국 통화의 대원화환율 */
export const USD_KRW_ECOS = {
  statCode: "731Y001",
  cycle: "D" as const,
  itemCode1: "0000001",
  start: "19900101",
};

/** 원/달러 뉴욕 종가 — FRED DEXKOUS (Korean Won to U.S. Dollar Spot Rate) */
export const USD_KRW_FRED_SERIES = "DEXKOUS";

function todayYyyymmdd(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

async function settle<T>(
  key: string,
  label: string,
  work: Promise<T[]>
): Promise<{ data: T[]; status: SourceStatus }> {
  try {
    const data = await work;
    return {
      data,
      status: { key, label, ok: data.length > 0, count: data.length,
        message: data.length ? undefined : "응답에 데이터가 없습니다." },
    };
  } catch (error) {
    const message =
      error instanceof EcosError || error instanceof Error
        ? error.message
        : "알 수 없는 오류";
    console.warn(`[${key}] 데이터 조회 실패:`, message);
    return { data: [], status: { key, label, ok: false, count: 0, message } };
  }
}

/** 원/달러 환율 원본 시계열. 한쪽 소스가 실패해도 나머지는 그대로 렌더링된다. */
export async function getExchangeRateData(): Promise<ExchangeRateData> {
  const [bok, fred] = await Promise.all([
    settle(
      "bok",
      "한국은행 매매기준율",
      fetchEcosSeries({ ...USD_KRW_ECOS, end: todayYyyymmdd() })
    ),
    settle("fred", "FRED 뉴욕 종가", fetchFredSeries(USD_KRW_FRED_SERIES)),
  ]);

  return {
    bok: bok.data,
    fred: fred.data,
    status: [bok.status, fred.status],
    fetchedAt: new Date().toISOString(),
  };
}

/** 종합지표 탭 카드용 요약. 표시 기준은 한국은행 매매기준율. */
export function summarizeUsdKrw(data: ExchangeRateData): IndicatorSummary | null {
  const primary: Point[] = data.bok.length ? data.bok : data.fred;
  const change = latestChange(primary);

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
    spark: tail(primary, 3),
  };
}
