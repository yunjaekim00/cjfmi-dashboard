import type { NextRequest } from "next/server";

import { getSampleBrief, getWeeklyBrief, WeeklyConfigError } from "@/lib/weekly";

/**
 * 주간 모니터링 요약.
 *
 * GET  — 캐시된 요약을 준다. 없으면 만들어서 준다 (웹 검색 + 요약, 1~2분).
 *        `?sample=1` 이면 모델을 부르지 않고 참고 보고서 원문을 그대로 준다 (레이아웃 확인용).
 * POST — 캐시를 비우고 새로 만든다 ("다시 생성" 버튼).
 *
 * 생성은 모델 호출 한 번에 몇십 초가 걸리므로 플랫폼 기본 제한(보통 10~60초)보다
 * 길게 잡는다. Vercel Hobby 는 300초가 상한이다.
 */
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

async function respond(force: boolean) {
  try {
    const brief = await getWeeklyBrief({ force });
    return Response.json(brief, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    console.warn("[weekly] 생성 실패:", message);

    // 설정 문제(API 키 없음)는 503, 모델·네트워크 문제는 502 로 구분해 둔다.
    const status = error instanceof WeeklyConfigError ? 503 : 502;
    return Response.json({ error: message }, { status, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("sample") === "1") {
    return Response.json(await getSampleBrief(), { headers: NO_STORE });
  }
  return respond(false);
}

export async function POST() {
  return respond(true);
}
