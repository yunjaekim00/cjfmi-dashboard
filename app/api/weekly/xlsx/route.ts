import type { NextRequest } from "next/server";

import { applyCompareBase, fxRecentCloses, getLiveQuotes, listMarketSnapshots, overlayLiveMarket, readMarketFile } from "@/lib/market";
import { buildCloseSnapshots, defaultSnapshot } from "@/lib/market-shared";
import { buildMarketWorkbook } from "@/lib/xlsx-market";

/**
 * "주요국 금융시장 동향"을 엑셀 파일로 내려준다 — 화면의 차트 6개·환율표 + 1년치 원자료.
 * 자료는 Claude Code 의 /weekly 가 만든 data/YYMMDD-weekly-market.json 이다.
 *
 *   GET /api/weekly/xlsx            # 가장 최근 파일 + 내려받는 시점의 시세(화면과 같다)
 *   GET /api/weekly/xlsx?as=261102  # 그 접두사(날짜 또는 날짜-시각)의 파일 (없으면 최근 파일)
 *   GET /api/weekly/xlsx?live=0     # 시세를 덧씌우지 않고 파일 그대로
 *   GET /api/weekly/xlsx?base=261103-1559  # 전주比·환율표 직전보고일比를 그 스냅샷(지난 보고 시점 값) 대비로 — 화면의 "전주比 기준"과 같게
 *   GET /api/weekly/xlsx?base=close:2026-11-06  # 그날 종가 대비로
 *   base 가 없으면 화면의 기본값과 같다 — 기준일보다 앞선 가장 최근 보고.
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const prefix = request.nextUrl.searchParams.get("as")?.slice(0, 11);
  const file = await readMarketFile(prefix || undefined);
  if (!file) {
    return Response.json(
      { error: "주요국 금융시장 동향 자료(data/YYMMDD-weekly-market.json)가 없습니다. Claude Code 에서 /weekly 를 실행하세요." },
      { status: 404, headers: NO_STORE }
    );
  }

  const live = request.nextUrl.searchParams.get("live") === "0" ? file : overlayLiveMarket(file, await getLiveQuotes());
  const base = request.nextUrl.searchParams.get("base");
  const reports = await listMarketSnapshots();
  const snapshot = !base
    ? defaultSnapshot(reports, live.asOf)
    : base.startsWith("close:")
      ? (buildCloseSnapshots({ ...live, recentCloses: await fxRecentCloses(live.asOf) }).find((s) => s.prefix === base) ?? null)
      : (reports.find((s) => s.prefix === base) ?? null);
  const market = applyCompareBase(live, snapshot);
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
