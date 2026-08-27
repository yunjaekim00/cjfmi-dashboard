import { getDashboardData } from "@/lib/dashboard";

/**
 * 브라우저 폴링용 엔드포인트.
 *
 * `?since=YYYY-MM-DD` 가 붙으면 조회 구간 자체를 좁혀서 계열당 요청 1건으로 끝낸다.
 * (전체 이력을 다시 받아 필터링하면 4KB 응답 하나에 ECOS 호출 수십 번이 나간다.)
 */
export async function GET(request: Request) {
  const since = new URL(request.url).searchParams.get("since") ?? undefined;

  // 형식이 어긋난 값으로 조회 구간을 망가뜨리지 않도록 걸러 낸다.
  const validSince = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : undefined;

  const data = await getDashboardData({ since: validSince });

  return Response.json(
    { ...data, partial: Boolean(validSince) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
