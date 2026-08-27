import { getExchangeRateData } from "@/lib/data";

/**
 * 브라우저 폴링용 엔드포인트.
 *
 * 이 핸들러 자체는 요청마다 실행되지만, 안쪽의 ECOS fetch 가 10분 캐시라
 * 한국은행 API 는 10분에 한 번만 실제로 호출된다.
 *
 * `?since=YYYY-MM-DD` 를 주면 그 날짜 이후 관측치만 돌려준다.
 * 전체 시계열은 9천 건이 넘으므로, 폴링할 때는 항상 since 를 붙여
 * 몇 건짜리 응답만 주고받는다.
 */
export async function GET(request: Request) {
  const since = new URL(request.url).searchParams.get("since");
  const data = await getExchangeRateData();

  const bok = since ? data.bok.filter((point) => point.date >= since) : data.bok;

  return Response.json(
    { ...data, bok, partial: Boolean(since) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
