import type { NextRequest } from "next/server";

import { buildWeeklyReport } from "@/lib/docx-report";
import { applyCompareBase, fxRecentCloses, getLiveQuotes, listMarketSnapshots, overlayLiveMarket, readMarketFile } from "@/lib/market";
import { buildCloseSnapshots, defaultSnapshot } from "@/lib/market-shared";
import { getWeeklyBrief } from "@/lib/weekly";

/**
 * 주간 보고서 한 장을 워드 파일로 내려준다 — 제목 · 날짜 · [주간이슈]·[시장반응] 요약 · 차트 6개 · 환율표.
 * 양식은 documents/weekly-report-template.docx (사용자가 쓰는 보고서 파일)이고, 글과 차트만 갈아 끼운다.
 * 요약문은 화면과 같은 data/YYMMDD-weekly-brief.json, 차트·환율표는 /api/weekly/xlsx 와 같은 자료다.
 *
 *   GET /api/weekly/docx            # 가장 최근 파일 + 내려받는 시점의 시세(화면과 같다)
 *   GET /api/weekly/docx?live=0     # 시세를 덧씌우지 않고 파일 그대로
 *   GET /api/weekly/docx?base=…     # 전주比·직전보고일比의 비교 기준 (/api/weekly/xlsx 와 같다)
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const file = await readMarketFile();
  if (!file) {
    return Response.json(
      { error: "주요국 금융시장 동향 자료(data/YYMMDD-weekly-market.json)가 없습니다. Claude Code 에서 /weekly 를 실행하세요." },
      { status: 404, headers: NO_STORE }
    );
  }

  let bytes: Uint8Array;
  let asOf: string;
  try {
    const brief = await getWeeklyBrief();
    const live = request.nextUrl.searchParams.get("live") === "0" ? file : overlayLiveMarket(file, await getLiveQuotes());
    const base = request.nextUrl.searchParams.get("base");
    const reports = await listMarketSnapshots();
    // 기본 비교 기준은 직전 보고일(따로 지정이 없으면 일주일 전)의 값 — 그날 보고가 없으면 그날 종가
    const closes = !base || base.startsWith("close:") ? buildCloseSnapshots({ ...live, recentCloses: await fxRecentCloses(live.asOf) }) : [];
    const snapshot = !base
      ? defaultSnapshot([...reports, ...closes], live.asOf, live.previousReport)
      : ((base.startsWith("close:") ? closes : reports).find((s) => s.prefix === base) ?? null);
    const market = applyCompareBase(live, snapshot);
    bytes = await buildWeeklyReport(brief, market);
    asOf = market.asOf;
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    console.warn("[weekly/docx] 생성 실패:", message);
    return Response.json({ error: message }, { status: 502, headers: NO_STORE });
  }

  const stamp = asOf.slice(2).replaceAll("-", "");
  const koreanName = `[미경연] 금융시장 모니터링 ${stamp}.docx`;

  return new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${stamp}-weekly-report.docx"; filename*=UTF-8''${encodeURIComponent(koreanName)}`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
