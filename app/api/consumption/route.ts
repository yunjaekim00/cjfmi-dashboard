import type { NextRequest } from "next/server";

import { getConsumptionData } from "@/lib/consumption";

/**
 * 국내 소비동향(주간 나우캐스트 · 월간 ECOS) 자료 — 탭을 열 때 한 번 받는다.
 * GET            캐시(6시간)된 자료. 없으면 새로 받아 온다 (주간 계열 16개를 순차로 받느라 10초 안팎, 월간은 병렬이라 금방).
 * GET ?refresh=1 캐시를 무시하고 새로 받는다.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const data = await getConsumptionData(force);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return Response.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
