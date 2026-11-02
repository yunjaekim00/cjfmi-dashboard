import type { NextRequest } from "next/server";

import { readMarketFile } from "@/lib/market";
import { buildMarketWorkbook } from "@/lib/xlsx-market";

/**
 * "주요국 금융시장 동향"을 엑셀 파일로 내려준다 — 화면의 차트 6개·환율표 + 1년치 원자료.
 * 자료는 Claude Code 의 /weekly 가 만든 data/YYMMDD-weekly-market.json 이다.
 *
 *   GET /api/weekly/xlsx            # 가장 최근 파일
 *   GET /api/weekly/xlsx?as=261102  # 그 날짜 접두사의 파일 (없으면 최근 파일)
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const prefix = request.nextUrl.searchParams.get("as")?.slice(0, 6);
  const market = await readMarketFile(prefix || undefined);
  if (!market) {
    return Response.json(
      { error: "주요국 금융시장 동향 자료(data/YYMMDD-weekly-market.json)가 없습니다. Claude Code 에서 /weekly 를 실행하세요." },
      { status: 404, headers: NO_STORE }
    );
  }

  const bytes = buildMarketWorkbook(market);
  const name = `${market.asOf.slice(2).replaceAll("-", "")}-weekly-market.xlsx`;

  // Uint8Array 를 그대로 넘기면 TS 가 SharedArrayBuffer 가능성을 따져 거절하므로 복사한 ArrayBuffer 를 쓴다.
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
