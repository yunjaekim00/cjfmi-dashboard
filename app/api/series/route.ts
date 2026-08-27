import { getDashboardData } from "@/lib/dashboard";
import type { SeriesMap } from "@/lib/types";

/**
 * 브라우저 폴링용 엔드포인트.
 *
 * 이 핸들러 자체는 요청마다 실행되지만, 안쪽의 ECOS/FRED fetch 가 캐시돼 있어
 * 외부 API 는 10분에 한 번만 실제로 호출된다.
 *
 * `?since=YYYY-MM-DD` 를 주면 그 날짜 이후 관측치만 돌려준다.
 * 전체 계열은 수만 건이므로, 폴링할 때는 항상 since 를 붙여 몇 건짜리 응답만 주고받는다.
 */
export async function GET(request: Request) {
  const since = new URL(request.url).searchParams.get("since");
  const data = await getDashboardData();

  if (!since) {
    return Response.json({ ...data, partial: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const series: SeriesMap = {};
  for (const [id, points] of Object.entries(data.series)) {
    series[id] = points.filter((point) => point.date >= since);
  }

  return Response.json(
    { ...data, series, partial: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
