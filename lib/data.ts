import { EcosError, fetchEcosSeries } from "@/lib/sources/ecos";
import type { ExchangeRateData, Point, SourceStatus } from "@/lib/types";

/** 원/달러 매매기준율 — 한국은행 ECOS 8.8.2.1 주요국 통화의 대원화환율 */
export const USD_KRW_ECOS = {
  statCode: "731Y001",
  cycle: "D" as const,
  itemCode1: "0000001",
  start: "19900101",
};

function todayYyyymmdd(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

async function settle(
  key: string,
  label: string,
  work: Promise<Point[]>
): Promise<{ data: Point[]; status: SourceStatus }> {
  try {
    const data = await work;
    return {
      data,
      status: {
        key,
        label,
        ok: data.length > 0,
        count: data.length,
        message: data.length ? undefined : "응답에 데이터가 없습니다.",
      },
    };
  } catch (error) {
    const message =
      error instanceof EcosError || error instanceof Error ? error.message : "알 수 없는 오류";
    console.warn(`[${key}] 데이터 조회 실패:`, message);
    return { data: [], status: { key, label, ok: false, count: 0, message } };
  }
}

/**
 * 원/달러 매매기준율 시계열.
 *
 * ECOS 응답 자체는 10분 캐시(lib/sources/ecos.ts)라 이 함수를 자주 불러도
 * 한국은행 쪽 호출은 시간당 6회를 넘지 않는다.
 */
export async function getExchangeRateData(): Promise<ExchangeRateData> {
  const bok = await settle(
    "bok",
    "한국은행 매매기준율",
    fetchEcosSeries({ ...USD_KRW_ECOS, end: todayYyyymmdd() })
  );

  return {
    bok: bok.data,
    status: [bok.status],
    fetchedAt: new Date().toISOString(),
  };
}
