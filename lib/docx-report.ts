import { readFile } from "node:fs/promises";
import path from "node:path";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  FX_SPECS,
  formatKstTime,
  formatSignedPct,
  formatTickDate,
  formatValue,
  kstDateOf,
  shiftDays,
  type WeeklyMarket,
} from "@/lib/market-shared";
import { REACTION_CATEGORIES, type WeeklyBrief } from "@/lib/weekly-types";
import { buildReportCharts } from "@/lib/xlsx-market";

/*
 * 주간 보고서 한 장을 워드 파일로 만든다. (서버 전용)
 *
 * 사용자가 쓰는 보고서 파일("[미경연] 금융시장 모니터링")을 양식으로 삼아, 그 안의 글과 차트만 갈아 끼운다 —
 * 쪽 설정·글꼴·번호 매기기·상자·표 모양은 양식 파일의 것을 그대로 쓰므로 양식과 똑같이 나온다.
 *   제목 상자            그대로
 *   날짜 · 작성 부서     날짜만 기준일로
 *   요약 상자            [주간이슈] 한 줄 · [시장반응] 한 줄 · (원자재)(금리)(주가)(외환) 네 줄
 *   전망 문단            "⇨ 시장은 … 주목" 한 줄 (요약문의 outlook. 없으면 뺀다)
 *   차트 6개             lib/xlsx-market.ts 가 엑셀용으로 만드는 차트 정의를 그대로 넣는다 (값은 차트 안에 캐시)
 *   환율표               최근 · 전쟁직전比 · 직전보고일比
 * 양식 파일을 바꾸면 아래의 "양식에 든 글"을 찾는 부분(날짜, 전망 문단)도 함께 맞춰야 한다.
 */

const TEMPLATE = path.join(process.cwd(), "documents", "weekly-report-template.docx");

const FONT = "CJ ONLYONE 300";
/** 양식의 강조 파랑 */
const BLUE = "0000CC";
const BLACK = "000000";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 본문 글자 한 조각 — 굵게 13pt 가 기본, small 이면 보통 굵기 11pt (양식의 괄호 안 보충 수치) */
function run(text: string, color: string, small = false): string {
  if (!text) return "";
  const size = small ? 22 : 26;
  return (
    `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:hint="eastAsia"/>` +
    (small ? "" : "<w:b/><w:bCs/>") +
    `<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
    `<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
  );
}

/** 요약문 한 문장 → 글자 조각들. {{강조}} 는 파랑, 괄호 안 보충 수치는 작은 글씨. */
function sentenceRuns(text: string): string {
  return text
    .split(/(\{\{[\s\S]*?\}\})/)
    .map((part) => {
      const highlight = /^\{\{([\s\S]*)\}\}$/.exec(part);
      if (highlight) return run(highlight[1], BLUE);
      return part
        .split(/(\([^()]*\))/)
        .map((piece) => run(piece, BLACK, /^\([^()]*\)$/.test(piece)))
        .join("");
    })
    .join("");
}

/** 문단의 글만 바꾼다 — 여는 태그와 문단 서식(pPr)은 양식 것을 둔다 */
function withRuns(paragraph: string, runs: string): string {
  const open = /^<w:p\b[^>]*>/.exec(paragraph)?.[0] ?? "<w:p>";
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? "";
  return `${open}${pPr}${runs}</w:p>`;
}

/** 표 칸 하나의 글을 바꾼다 — 첫 글자 조각에 넣고 나머지는 비운다 (칸·글자 서식은 그대로) */
function setCellText(cell: string, text: string): string {
  let first = true;
  return cell.replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/g, (_, open: string, close: string) => {
    if (!first) return `${open}${close}`;
    first = false;
    return `<w:t xml:space="preserve">${esc(text)}${close}`;
  });
}

function replaceCells(row: string, texts: string[]): string {
  let index = 0;
  return row.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cell) => {
    const text = texts[index];
    index += 1;
    return text === undefined ? cell : setCellText(cell, text);
  });
}

/** 요약 상자 — 문단 여섯 개(주간이슈 · 시장반응 · 원자재 · 금리 · 주가 · 외환)의 글을 바꾼다 */
function fillSummaryBox(box: string, brief: WeeklyBrief): string {
  const itemText = new Map(brief.reaction.items.map((item) => [item.category, item.text]));
  const lines = [
    run("[주간이슈] ", BLUE) + sentenceRuns(brief.issue.headline),
    run("[시장반응] ", BLUE) + sentenceRuns(brief.reaction.headline),
    ...REACTION_CATEGORIES.map((category) => run(`(${category}) `, BLUE) + sentenceRuns(itemText.get(category) ?? "")),
  ];
  let index = 0;
  return box.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const runs = lines[index];
    index += 1;
    return runs === undefined ? "" : withRuns(paragraph, runs);
  });
}

function fillFxTable(table: string, market: WeeklyMarket): string {
  const items = new Map(market.fx.items.map((item) => [item.id, item]));
  const fxAsOf = market.fx.items
    .map((item) => item.latest?.date)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const liveTime = market.liveAt && market.fx.items.some((item) => item.live) ? formatKstTime(market.liveAt) : null;
  const compareDate = market.compareBase ? formatTickDate(kstDateOf(market.compareBase.at)) : null;
  const compareWeekAgo = market.compareBase ? kstDateOf(market.compareBase.at) === shiftDays(market.asOf, -7) : false;
  const rows: string[][] = [
    [
      fxAsOf ? `${formatTickDate(fxAsOf)}일(${liveTime ? `${liveTime} 현재` : "08:30 기준"})` : "최근",
      ...FX_SPECS.map((spec) => {
        const item = items.get(spec.id);
        return item?.latest ? formatValue(spec, item.latest.value) : "-";
      }),
    ],
    [
      `${market.fx.baselineLabel}(${formatTickDate(market.fx.baselineDate)}일)比`,
      ...FX_SPECS.map((spec) => {
        const item = items.get(spec.id);
        return item && item.changePct !== null ? formatSignedPct(item.changePct, 1, "%") : "-";
      }),
    ],
    [
      // 양식의 이름 — 일주일 전이면 "전주(11/18일)比", 아니면 "직전보고일(10/7일)比"
      `${compareWeekAgo ? "전주" : "직전보고일"}${compareDate ? `(${compareDate}일)` : ""}比`,
      ...FX_SPECS.map((spec) => {
        const item = items.get(spec.id);
        return item?.compare ? formatSignedPct(item.compare.changePct, 1, "%") : "-";
      }),
    ],
  ];
  let index = 0;
  return table.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
    // 첫 행(통화 이름)은 양식 그대로
    const texts = index === 0 ? undefined : rows[index - 1];
    index += 1;
    return texts ? replaceCells(row, texts) : row;
  });
}

function fillDocument(xml: string, brief: WeeklyBrief, market: WeeklyMarket): string {
  // 옛 Word 용 대체 그림(VML)에는 요약문이 한 벌 더 들어 있다 — 갈아 끼울 곳을 하나로 줄이려고 뺀다 (Word 2010 이후는 쓰지 않는다)
  let doc = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");

  // 요약 상자는 양식에서 높이가 고정이라 글이 길면 아래가 잘린다 — 글에 맞게 늘어나도록 바꾼다
  doc = doc.replace(/<wps:wsp>[\s\S]*?<\/wps:wsp>/g, (shape) =>
    shape.includes("[주간이슈]") ? shape.replace("<a:noAutofit/>", "<a:spAutoFit/>") : shape
  );

  // 요약 상자 = 글 상자 가운데 "[주간이슈]" 가 든 것
  doc = doc.replace(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g, (box) => (box.includes("[주간이슈]") ? fillSummaryBox(box, brief) : box));

  // 날짜 — 양식에는 "2026. 11. " + "24" + "." 세 조각으로 들어 있다
  const [year, month, day] = market.asOf.split("-");
  const dateAt = doc.indexOf(">2026. 11. </w:t>");
  if (dateAt >= 0) {
    const head = doc.slice(0, dateAt);
    const tail = doc
      .slice(dateAt)
      .replace(">2026. 11. </w:t>", `>${year}. ${Number(month)}. ${Number(day)}.</w:t>`)
      .replace("<w:t>24</w:t>", "<w:t></w:t>")
      .replace("<w:t>.</w:t>", "<w:t></w:t>");
    doc = head + tail;
  }

  // 전망 문단("⇨ 시장은 … 주목") — 화살표는 문단 번호 서식이라 글만 바꾼다. 요약문에 전망이 없으면 문단째 뺀다
  const outlookAt = doc.indexOf(">시장은 </w:t>");
  if (outlookAt >= 0) {
    const start = doc.lastIndexOf("<w:p ", outlookAt);
    const end = doc.indexOf("</w:p>", outlookAt) + "</w:p>".length;
    if (start >= 0 && end > start) {
      const paragraph = brief.outlook ? withRuns(doc.slice(start, end), sentenceRuns(brief.outlook)) : "";
      doc = doc.slice(0, start) + paragraph + doc.slice(end);
    }
  }

  // 환율표 = 통화 이름이 든 표
  doc = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (table) => (table.includes("절상") ? fillFxTable(table, market) : table));

  return doc;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_USER_SHAPES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes";

/** 주간 보고서 워드 파일 (요약문 + 차트 6개 + 환율표) */
export async function buildWeeklyReport(brief: WeeklyBrief, market: WeeklyMarket): Promise<Uint8Array> {
  const files = unzipSync(new Uint8Array(await readFile(TEMPLATE)));
  const text = (name: string) => strFromU8(files[name]);

  files["word/document.xml"] = strToU8(fillDocument(text("word/document.xml"), brief, market));

  // 차트 — 정의와 차트 위 도형을 갈아 끼운다. 값은 차트 안에 캐시로 들어 있어 원본 엑셀 연결은 뺀다.
  buildReportCharts(market).forEach((built, i) => {
    const n = i + 1;
    files[`word/charts/chart${n}.xml`] = strToU8(built.chart);
    files[`word/drawings/drawing${n}.xml`] = strToU8(built.shapes);
    files[`word/charts/_rels/chart${n}.xml.rels`] = strToU8(
      XML_HEAD +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL_USER_SHAPES}" Target="../drawings/drawing${n}.xml"/></Relationships>`
    );
  });
  // 차트 1 에만 딸려 있던 스타일·색 부속 파일은 연결이 끊기므로 함께 뺀다
  for (const name of ["word/charts/style1.xml", "word/charts/colors1.xml"]) delete files[name];
  files["[Content_Types].xml"] = strToU8(
    text("[Content_Types].xml").replace(/<Override PartName="\/word\/charts\/(?:style|colors)1\.xml"[^>]*\/>/g, "")
  );

  // 편집 이력 번호(rsid) 목록은 내용과 무관하고 크기만 키운다
  if (files["word/settings.xml"]) {
    files["word/settings.xml"] = strToU8(text("word/settings.xml").replace(/<w:rsids>[\s\S]*?<\/w:rsids>/, ""));
  }

  return zipSync(files, { level: 6 });
}
