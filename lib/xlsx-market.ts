import { strToU8, zipSync } from "fflate";

import {
  CHART_SPECS,
  FX_SPECS,
  annotationBelow,
  dateFraction,
  formatKstTime,
  formatSignedPct,
  formatTickDate,
  formatValue,
  formatWeekChange,
  marketWindow,
  yScale,
  type ChartSpec,
  type MarketChart,
  type WeeklyMarket,
} from "@/lib/market-shared";

/*
 * "주요국 금융시장 동향"을 엑셀 파일로 만든다. (서버 전용)
 *
 * 라이브러리 없이 OOXML 조각을 직접 쓴다 — 차트(DrawingML)를 만들어 주는 JS 라이브러리가 마땅치 않아서다.
 *   시트 1 "주요국 금융시장 동향": 제목, 차트 6개(3×2), 환율표, 각주
 *   시트 2 "데이터": 차트마다 날짜·값 두 열 (1년치)
 *
 * 차트 서식은 사용자가 쓰는 엑셀 파일의 차트를 기준으로 맞췄다 (2026-11-02 전달받은 화면):
 *   테두리 없음 · 제목은 차트 왼쪽 위에 굵게 13pt · 단위 표기는 그 아래 회색 9pt · 눈금 글자 회색 10pt
 *   최근치 파랑 굵게 14pt + 전주비 파랑 굵게 9pt 를 오른쪽 끝에 · 사건 띠는 폭 6pt, 플롯 안에서 선 뒤에
 * 사건 띠는 첫 번째 계열(굵은 연파랑 세로선)이다 — 도형(userShapes)은 늘 맨 위에 그려져 지표 선을 가리기 때문.
 * 차트는 엑셀 네이티브 분산형(직선) 차트다. 선형 차트는 모든 계열이 같은 날짜 축을 공유하는데
 * 계열마다 거래일이 달라서, 날짜를 x 값으로 갖는 분산형을 쓴다. 보고서의 생김새는 계열 세 개로 만든다:
 *   ① 공습 표시 띠(연파랑 굵은 세로선) ② 지표 선 ③ x 눈금 라벨(투명한 점 + 데이터 레이블)
 * 최근치·전주비와 사건 라벨은 차트 위에 얹은 텍스트 상자(userShapes)다 — 데이터 레이블은 Excel 이
 * 사용자 지정 글을 좁은 기본 상자 안에서 줄바꿈해 버려서(크기 지정도 무시) 긴 글에는 쓸 수 없었다.
 */

const FONT_300 = "CJ ONLYONE 300";
const FONT_400 = "CJ ONLYONE 400";
const BLUE = "3464B6";
const BAND = "DFE5F1";
const TICK = "4F4F4F";
const NOTE = "757575";
const BAR = "D4D4D4";
const BAR_SOFT = "DADADA";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

/** 시트 1 배치: 21열 — 차트 한 칸이 7열, 환율표는 머리 3열 + 통화 6개 × 3열 */
const COLS = 21;
const BLOCK = 7;
const COL_WIDTH = 5.71; // ≈ 45px → 차트 한 칸 315px
const CHART_ROWS = 11; // 11 × 15pt(20px) = 220px — 제목이 차트 안에 들어가므로 보고서 비율(1.8:1)보다 조금 높다
const ROW_TITLE = 1;
/** 차트 두 줄의 첫 행 (제목 바 없이 차트가 바로 시작한다 — 사용자 엑셀 디자인) */
const ROW_CHART_1 = 2;
const ROW_CHART_2 = ROW_CHART_1 + CHART_ROWS + 1; // 14
const ROW_FX = ROW_CHART_2 + CHART_ROWS + 1; // 26
const ROW_NOTE = ROW_FX + 4; // 30

const DATA_SHEET = "데이터";

/** 차트 안 배치(차트 크기 대비 비율). 사용자 엑셀 차트를 잰 값 — 위에서부터 제목 · 단위 표기 · 플롯 · x 눈금 */
const PLOT_X = 0.21;
const PLOT_Y = 0.3;
const PLOT_W = 0.7;
const PLOT_H = 0.48;
/** 단위 표기 "(원/달러)" 의 위치 */
const UNIT_Y = 0.17;
/** 사건 띠 굵기 (EMU, 6pt ≈ 차트 너비의 2.5%) — 계열 선이라 pt 로 준다 */
const BAND_WIDTH_EMU = 76200;
/** 사건 라벨을 띠 오른쪽에 둘 때의 간격 (차트 너비 대비) */
const BAND_GAP = 0.025;

/** 글자 크기 (1/100 pt) */
const SZ_TITLE = 1300;
const SZ_TICK = 1000;
const SZ_NOTE = 900;
const SZ_VALUE = 1400;
const SZ_CHANGE = 900;

// ───────────────────────── 작은 도구 ─────────────────────────

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "2026-11-02" → 엑셀 날짜 일련번호 (1899-12-30 기준) */
function serial(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** 0 → "A", 26 → "AA" */
function col(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function cellText(ref: string, text: string, style: number): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function cellNumber(ref: string, value: number, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function cellEmpty(ref: string, style: number): string {
  return `<c r="${ref}" s="${style}"/>`;
}

// ───────────────────────── 스타일 ─────────────────────────

/** cellXfs 의 순서. 아래 stylesXml 과 맞춘다. */
const STYLE = {
  normal: 0,
  title: 1,
  bar: 2,
  fxHead: 3,
  fxHeadFirst: 4,
  fxLabel: 5,
  fxValue: 6,
  date: 7,
  note: 8,
  dataHead: 9,
} as const;

function stylesXml(): string {
  const font = (sz: number, color: string, name: string, bold = false) =>
    `<font>${bold ? "<b/>" : ""}<sz val="${sz}"/><color rgb="FF${color}"/><name val="${esc(name)}"/><family val="2"/></font>`;
  const side = (tag: string, style: string) => `<${tag} style="${style}"><color rgb="FF000000"/></${tag}>`;
  const border = (top: string, rest = "thin") =>
    `<border>${side("left", rest)}${side("right", rest)}${side("top", top)}${side("bottom", rest)}<diagonal/></border>`;
  const xf = (fontId: number, fillId: number, borderId: number, numFmtId = 0, center = true, wrap = false) =>
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">` +
    `<alignment horizontal="${center ? "center" : "left"}" vertical="center"${wrap ? ' wrapText="1"' : ""}/></xf>`;

  return (
    XML +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>` +
    `<fonts count="6">` +
    font(10, "000000", FONT_300) + // 0 본문
    font(11, "000000", FONT_300, true) + // 1 소제목(굵게)
    font(14, "000000", FONT_400) + // 2 제목
    font(9, NOTE, FONT_300) + // 3 각주
    font(9, "000000", FONT_300) + // 4 환율표 머리칸
    font(10, "000000", FONT_300, true) + // 5 데이터 시트 머리
    `</fonts>` +
    `<fills count="4">` +
    `<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${BAR}"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${BAR_SOFT}"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="3">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` + // 0 없음
    border("thin") + // 1 가는 선
    border("medium") + // 2 환율표 머리 (위만 굵게)
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="10">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0 normal
    xf(2, 0, 0) + // 1 title
    xf(1, 2, 1) + // 2 bar
    xf(1, 2, 2) + // 3 fxHead
    xf(4, 2, 2) + // 4 fxHeadFirst
    xf(4, 3, 1) + // 5 fxLabel
    xf(0, 0, 1) + // 6 fxValue
    xf(0, 0, 0, 164) + // 7 date
    xf(3, 0, 0, 0, false) + // 8 note
    xf(5, 0, 1) + // 9 dataHead
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

// ───────────────────────── 차트 XML ─────────────────────────

type RunStyle = { sz: number; color: string; font?: string; bold?: boolean };

function run(text: string, { sz, color, font = FONT_300, bold = false }: RunStyle): string {
  return (
    `<a:r><a:rPr lang="ko-KR" sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
    `<a:latin typeface="${esc(font)}"/><a:ea typeface="${esc(font)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`
  );
}

function para(runs: string, align: "l" | "ctr" | "r" = "ctr", sz = 900, bold = false): string {
  // defRPr 의 크기를 run 과 맞춘다 — Excel 은 이 기본 크기로 상자를 잰다
  return `<a:p><a:pPr algn="${align}"><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"/></a:pPr>${runs}</a:p>`;
}

function richText(paragraphs: string): string {
  // 데이터 레이블 상자가 글에 맞게 늘어나도록 (wrap="none" 만으로는 Excel 이 기본 너비 안에서 줄을 바꾼다)
  return `<c:tx><c:rich><a:bodyPr wrap="none"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${paragraphs}</c:rich></c:tx>`;
}

/** 글자 기본값(축 눈금 등) */
function textProps(sz: number, color: string, font = FONT_300): string {
  return (
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
    `<a:latin typeface="${esc(font)}"/><a:ea typeface="${esc(font)}"/></a:defRPr></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr>`
  );
}

function numLit(values: number[]): string {
  return (
    `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("") +
    `</c:numLit>`
  );
}

function numRef(formula: string): string {
  return `<c:numRef><c:f>${esc(formula)}</c:f></c:numRef>`;
}

const SHOW_NONE =
  `<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/>` +
  `<c:showPercent val="0"/><c:showBubbleSize val="0"/>`;

/** 점 하나에 붙는 짧은 데이터 레이블 (x 눈금용). 긴 글은 Excel 이 좁은 상자에서 줄바꿈하므로 텍스트 상자(textBox)를 쓴다. */
function dataLabel(idx: number, tx: string, pos: "t" | "b" | "l" | "r" | "ctr"): string {
  return (
    `<c:dLbl><c:idx val="${idx}"/>${tx}<c:dLblPos val="${pos}"/>` +
    `<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/>` +
    `<c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl>`
  );
}

function dataLabels(labels: string): string {
  return labels ? `<c:dLbls>${labels}${SHOW_NONE}</c:dLbls>` : "";
}

function line(width: number, color: string, cap: "rnd" | "flat" = "rnd"): string {
  return `<c:spPr><a:ln w="${width}" cap="${cap}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr>`;
}

const NO_LINE = `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>`;
const NO_MARKER = `<c:marker><c:symbol val="none"/></c:marker>`;

type Series = { idx: number; name: string; spPr: string; dLbls: string; xVal: string; yVal: string };

function seriesXml({ idx, name, spPr, dLbls, xVal, yVal }: Series): string {
  return (
    `<c:ser><c:idx val="${idx}"/><c:order val="${idx}"/><c:tx><c:v>${esc(name)}</c:v></c:tx>` +
    spPr +
    NO_MARKER +
    dLbls +
    `<c:xVal>${xVal}</c:xVal><c:yVal>${yVal}</c:yVal><c:smooth val="0"/></c:ser>`
  );
}

function valueAxis(
  id: number,
  crossId: number,
  pos: "b" | "l",
  min: number,
  max: number,
  options: { numFmt: string; labels: boolean; axisLine: boolean; majorUnit?: number }
): string {
  return (
    `<c:valAx><c:axId val="${id}"/>` +
    `<c:scaling><c:orientation val="minMax"/><c:max val="${max}"/><c:min val="${min}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="${pos}"/>` +
    `<c:numFmt formatCode="${esc(options.numFmt)}" sourceLinked="0"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="${options.labels ? "nextTo" : "none"}"/>` +
    (options.axisLine
      ? `<c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></c:spPr>`
      : NO_LINE) +
    textProps(SZ_TICK, TICK) +
    `<c:crossAx val="${crossId}"/><c:crosses val="min"/><c:crossBetween val="midCat"/>` +
    (options.majorUnit ? `<c:majorUnit val="${options.majorUnit}"/>` : "") +
    `</c:valAx>`
  );
}

/** 차트 위 텍스트 상자 하나 (좌표는 차트 크기 대비 비율). wrap="none" 이라 상자가 좁아도 줄바꿈하지 않는다. */
function textBox(box: { x0: number; y0: number; x1: number; y1: number }, paragraphs: string): string {
  const f = (v: number) => v.toFixed(4);
  return (
    `<cdr:relSizeAnchor><cdr:from><cdr:x>${f(box.x0)}</cdr:x><cdr:y>${f(box.y0)}</cdr:y></cdr:from>` +
    `<cdr:to><cdr:x>${f(box.x1)}</cdr:x><cdr:y>${f(box.y1)}</cdr:y></cdr:to>` +
    `<cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="${nextShapeId++}" name="TextBox"/><cdr:cNvSpPr txBox="1"/></cdr:nvSpPr>` +
    `<cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></cdr:spPr>` +
    `<cdr:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/><a:lstStyle/>${paragraphs}</cdr:txBody>` +
    `</cdr:sp></cdr:relSizeAnchor>`
  );
}

let nextShapeId = 2;


function userShapesXml(shapes: string[]): string {
  return (
    XML +
    `<c:userShapes xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing">` +
    shapes.join("") +
    `</c:userShapes>`
  );
}

/** 차트 하나. dataCol 은 시트 2 에서 이 차트의 날짜 열 번호(0 기준) — 값은 그 다음 열. */
function chartXml(
  spec: ChartSpec,
  chart: MarketChart,
  market: WeeklyMarket,
  dataCol: number,
  first: boolean
): { chart: string; shapes: string | null } {
  const n = chart.points.length;
  const dateRef = `'${DATA_SHEET}'!$${col(dataCol)}$2:$${col(dataCol)}$${n + 1}`;
  const valueRef = `'${DATA_SHEET}'!$${col(dataCol + 1)}$2:$${col(dataCol + 1)}$${n + 1}`;

  const { windowStart, ticks } = marketWindow(market.asOf);
  const scale = yScale(chart.points.map((p) => p.value));
  const xMin = serial(windowStart);
  // 축은 기준일보다 열흘쯤 더 오른쪽까지 — 사용자 엑셀처럼 선이 거의 오른쪽 끝에서 끝난다
  const xMax = serial(market.asOf) + 10;
  const yFormat = scale.decimals === 0 ? "#,##0" : `0.${"0".repeat(scale.decimals)}`;

  const eventSerial = serial(market.event.date);
  const eventInWindow = market.event.date >= windowStart && market.event.date <= market.asOf;
  const eventX = PLOT_X + PLOT_W * ((eventSerial - xMin) / (xMax - xMin));

  // ① 사건 띠 — 같은 날짜의 아래·위 두 점을 굵은 연파랑 선으로 잇는다. 첫 계열이라 지표 선 뒤에 그려진다.
  const band: Series | null = eventInWindow
    ? {
        idx: 0,
        name: market.event.label,
        spPr: line(BAND_WIDTH_EMU, BAND, "flat"),
        dLbls: "",
        xVal: numLit([eventSerial, eventSerial]),
        yVal: numLit([scale.lo, scale.hi]),
      }
    : null;

  // ② 지표 선
  const main: Series = {
    idx: 1,
    name: spec.title,
    spPr: line(25400, BLUE), // 2pt — 사용자 엑셀 차트의 선 굵기
    dLbls: "",
    xVal: numRef(dateRef),
    yVal: numRef(valueRef),
  };

  // 차트 위 텍스트 상자 — ④ 단위 표기 ⑤ 최근치·전주비 ⑥ 첫 차트엔 사건 라벨
  const shapes: string[] = [];
  shapes.push(textBox({ x0: 0.03, y0: UNIT_Y, x1: 0.7, y1: UNIT_Y + 0.11 }, para(run(spec.unitLabel, { sz: SZ_NOTE, color: NOTE }), "l", SZ_NOTE)));
  const { latest, weekAgo } = chart;
  if (latest) {
    const below = annotationBelow(chart.points, windowStart, market.asOf, scale.lo, scale.hi);
    const yFrac = (value: number) => PLOT_Y + ((scale.hi - value) / (scale.hi - scale.lo)) * PLOT_H;
    const recent = chart.points
      .filter((p) => dateFraction(p.date, windowStart, market.asOf) >= 0.7)
      .map((p) => p.value);
    const anchor = recent.length ? (below ? Math.min(...recent) : Math.max(...recent)) : latest.value;
    const change = weekAgo ? `(${first ? "전주比 " : ""}${formatWeekChange(spec, latest, weekAgo)})` : "";
    const h = change ? 0.21 : 0.12;
    // 아래에 둘 때는 x축 선(PLOT_Y + PLOT_H) 위에서 끝나게(글이 상자 아래로 0.035쯤 내려오므로 여유를 둔다),
    // 위에 둘 때는 단위 표기 아래에서 시작하게
    const top = below
      ? Math.min(PLOT_Y + PLOT_H - h - 0.05, yFrac(anchor) + 0.03)
      : Math.max(UNIT_Y + 0.08, yFrac(anchor) - (h + 0.03));
    shapes.push(
      textBox(
        { x0: 0.4, y0: top, x1: PLOT_X + PLOT_W + 0.02, y1: top + h },
        para(run(formatValue(spec, latest.value), { sz: SZ_VALUE, color: BLUE, bold: true }), "r", SZ_VALUE, true) +
          (change ? para(run(change, { sz: SZ_CHANGE, color: BLUE, bold: true }), "r", SZ_CHANGE, true) : "")
      )
    );
  }
  if (first && eventInWindow) {
    shapes.push(
      textBox(
        { x0: eventX + BAND_GAP, y0: UNIT_Y + 0.1, x1: Math.min(0.99, eventX + 0.55), y1: UNIT_Y + 0.28 },
        para(run(market.event.label, { sz: SZ_NOTE, color: NOTE, font: FONT_400 }), "l", SZ_NOTE) +
          para(run(market.event.note, { sz: SZ_NOTE, color: NOTE, font: FONT_400 }), "l", SZ_NOTE)
      )
    );
  }

  // ③ x 눈금 라벨 — 축 아래에 "11/3 · 2/3 · …" 를 정확한 날짜에 찍기 위한 투명한 점들
  const tickSeries: Series = {
    idx: 2,
    name: "눈금",
    spPr: NO_LINE,
    dLbls: dataLabels(
      ticks
        .map((tick, i) => dataLabel(i, richText(para(run(formatTickDate(tick), { sz: SZ_TICK, color: TICK }), "ctr", SZ_TICK)), "b"))
        .join("")
    ),
    xVal: numLit(ticks.map(serial)),
    yVal: numLit(ticks.map(() => scale.lo)),
  };

  const plotLayout =
    `<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/>` +
    `<c:x val="${PLOT_X}"/><c:y val="${PLOT_Y}"/><c:w val="${PLOT_W}"/><c:h val="${PLOT_H}"/></c:manualLayout></c:layout>`;

  const title =
    `<c:title>${richText(para(run(spec.title, { sz: SZ_TITLE, color: "000000", bold: true }), "l", SZ_TITLE, true))}` +
    `<c:layout><c:manualLayout><c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.005"/><c:y val="0.01"/></c:manualLayout></c:layout>` +
    `<c:overlay val="1"/></c:title>`;


  const chartXmlText =
    XML +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    `<c:date1904 val="0"/><c:lang val="ko-KR"/><c:roundedCorners val="0"/>` +
    `<c:chart>${title}<c:autoTitleDeleted val="0"/><c:plotArea>${plotLayout}` +
    `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>` +
    (band ? seriesXml(band) : "") +
    seriesXml(main) +
    seriesXml(tickSeries) +
    `<c:axId val="10"/><c:axId val="20"/></c:scatterChart>` +
    valueAxis(10, 20, "b", xMin, xMax, { numFmt: "m/d", labels: false, axisLine: true }) +
    valueAxis(20, 10, "l", scale.lo, scale.hi, { numFmt: yFormat, labels: true, axisLine: false, majorUnit: scale.step }) +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` +
    textProps(SZ_TICK, "000000") +
    (shapes.length ? `<c:userShapes r:id="rId1"/>` : "") +
    `</c:chartSpace>`;

  return { chart: chartXmlText, shapes: shapes.length ? userShapesXml(shapes) : null };
}

// ───────────────────────── 시트 ─────────────────────────

type Placed = { spec: ChartSpec; chart: MarketChart; index: number; block: number; firstRow: number };

function drawingXml(placed: Placed[]): string {
  const anchors = placed
    .map(({ index, block, firstRow }, i) => {
      const fromCol = block * BLOCK;
      const fromRow = firstRow - 1; // xdr:row 는 0 기준
      return (
        `<xdr:twoCellAnchor editAs="oneCell">` +
        `<xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${fromCol + BLOCK}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow + CHART_ROWS}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
        `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
      );
    })
    .join("");
  return XML + `<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`;
}

function reportSheetXml(market: WeeklyMarket, placed: Placed[]): string {
  const rows = new Map<number, string[]>();
  const merges: string[] = [];
  const put = (row: number, xml: string) => {
    rows.set(row, [...(rows.get(row) ?? []), xml]);
  };
  const putMerged = (row: number, fromCol: number, toCol: number, text: string, style: number) => {
    put(row, cellText(`${col(fromCol)}${row}`, text, style));
    for (let c = fromCol + 1; c <= toCol; c += 1) put(row, cellEmpty(`${col(c)}${row}`, style));
    merges.push(`${col(fromCol)}${row}:${col(toCol)}${row}`);
  };

  // 제목
  putMerged(ROW_TITLE, 0, COLS - 1, "[ 주요국 금융시장 동향 ]", STYLE.title);

  // 자료가 없는 칸에는 제목과 사유만 적는다 (차트 제목은 차트 안에 있다)
  CHART_SPECS.forEach((spec, index) => {
    if (placed.some((p) => p.index === index)) return;
    const block = index % 3;
    const firstRow = index < 3 ? ROW_CHART_1 : ROW_CHART_2;
    const chart = market.charts.find((c) => c.id === spec.id);
    putMerged(firstRow, block * BLOCK, block * BLOCK + BLOCK - 1, spec.title, STYLE.dataHead);
    putMerged(firstRow + 2, block * BLOCK, block * BLOCK + BLOCK - 1, chart?.error ?? "자료 없음", STYLE.note);
  });

  // 환율표
  const items = new Map(market.fx.items.map((item) => [item.id, item]));
  const fxAsOf = market.fx.items
    .map((item) => item.latest?.date)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  putMerged(ROW_FX, 0, 2, "(+ 절상, − 절하)", STYLE.fxHeadFirst);
  const fxLiveTime = market.liveAt && market.fx.items.some((item) => item.live) ? formatKstTime(market.liveAt) : null;
  putMerged(ROW_FX + 1, 0, 2, fxAsOf ? `${formatTickDate(fxAsOf)}일(${fxLiveTime ? `${fxLiveTime} 현재` : "08:30 기준"})` : "최근", STYLE.fxLabel);
  putMerged(ROW_FX + 2, 0, 2, `${market.fx.baselineLabel}(${formatTickDate(market.fx.baselineDate)}일)比`, STYLE.fxLabel);
  FX_SPECS.forEach((spec, i) => {
    const from = 3 + i * 3;
    const item = items.get(spec.id);
    putMerged(ROW_FX, from, from + 2, spec.label, STYLE.fxHead);
    putMerged(ROW_FX + 1, from, from + 2, item?.latest ? formatValue(spec, item.latest.value) : "-", STYLE.fxValue);
    putMerged(
      ROW_FX + 2,
      from,
      from + 2,
      item && item.changePct !== null ? formatSignedPct(item.changePct, 1, "%") : "-",
      STYLE.fxValue
    );
  });

  // 각주
  const overridden = market.charts
    .filter((chart) => chart.overrideDates.length)
    .map((chart) => `${CHART_SPECS.find((s) => s.id === chart.id)?.title ?? chart.id} ${chart.overrideDates.join("·")}`);
  const notes = [
    `기준일 ${market.asOf} (창 ${market.windowStart} ~ ${market.asOf}) · 생성 ${market.generatedAt.slice(0, 16).replace("T", " ")} UTC${
      market.liveAt ? ` · 최근치는 ${formatKstTime(market.liveAt)} KST 시세(CNBC 시세 · 네이버 금융)` : ""
    }`,
    "1년 이력: FRED(S&P500 · 美 10년물 · WTI 쿠싱 현물), 한국은행 ECOS(KOSPI · 국고채 10년 · 환율 매매기준율), 美 10년물은 재무부 일별 금리표로 보충. WTI 최근치는 선물 근월물.",
    `환율표 비교 시점 값은 한국은행 고시(08:30) 기준, 달러인덱스 비교 시점은 ICE 산식으로 계산, 위안은 원/달러 ÷ 원/위안 교차환율. 전주比는 ${
      market.compareBase ? `${market.compareBase.label} 대비` : "지난주 같은 요일 대비"
    }(금리는 %p).`,
    ...(overridden.length ? [`출처 집계 전 종가(CNBC 마감 시세·기사): ${overridden.join(", ")}`] : []),
    `세로 연파랑 띠: ${market.event.label} ${market.event.note}. 1년치 원자료는 "${DATA_SHEET}" 시트.`,
  ];
  notes.forEach((note, i) => put(ROW_NOTE + i, cellText(`A${ROW_NOTE + i}`, note, STYLE.note)));

  const rowXml = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, cells]) => {
      const height =
        row === ROW_TITLE
          ? ' ht="30" customHeight="1"'
          : row >= ROW_FX && row < ROW_NOTE
            ? ' ht="20" customHeight="1"'
            : "";
      return `<row r="${row}"${height}>${cells.join("")}</row>`;
    })
    .join("");

  return (
    XML +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15" customHeight="1"/>` +
    `<cols><col min="1" max="${COLS}" width="${COL_WIDTH}" customWidth="1"/></cols>` +
    `<sheetData>${rowXml}</sheetData>` +
    `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    (placed.length ? `<drawing r:id="rId1"/>` : "") +
    `</worksheet>`
  );
}

function dataSheetXml(market: WeeklyMarket): string {
  const charts = new Map(market.charts.map((chart) => [chart.id, chart]));
  const columns = CHART_SPECS.map((spec) => ({ spec, points: charts.get(spec.id)?.points ?? [] }));
  const longest = Math.max(0, ...columns.map((c) => c.points.length));

  const rows: string[] = [];
  const header = columns
    .map(({ spec }, i) =>
      cellText(`${col(i * 2)}1`, `${spec.title} 날짜`, STYLE.dataHead) + cellText(`${col(i * 2 + 1)}1`, spec.title, STYLE.dataHead)
    )
    .join("");
  rows.push(`<row r="1">${header}</row>`);

  for (let r = 0; r < longest; r += 1) {
    const cells = columns
      .map(({ points }, i) => {
        const point = points[r];
        if (!point) return "";
        return cellNumber(`${col(i * 2)}${r + 2}`, serial(point.date), STYLE.date) + cellNumber(`${col(i * 2 + 1)}${r + 2}`, point.value, STYLE.normal);
      })
      .join("");
    rows.push(`<row r="${r + 2}">${cells}</row>`);
  }

  return (
    XML +
    `<worksheet xmlns="${NS_MAIN}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols><col min="1" max="${columns.length * 2}" width="13" customWidth="1"/></cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    `</worksheet>`
  );
}

// ───────────────────────── 패키지 ─────────────────────────

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function rels(entries: Array<{ id: string; type: string; target: string }>): string {
  return (
    XML +
    `<Relationships xmlns="${NS_REL}">` +
    entries.map((e) => `<Relationship Id="${e.id}" Type="${e.type}" Target="${e.target}"/>`).join("") +
    `</Relationships>`
  );
}

export function buildMarketWorkbook(market: WeeklyMarket): Uint8Array {
  const chartById = new Map(market.charts.map((chart) => [chart.id, chart]));
  const placed: Placed[] = [];
  CHART_SPECS.forEach((spec, index) => {
    const chart = chartById.get(spec.id);
    if (!chart || !chart.points.length) return;
    placed.push({ spec, chart, index, block: index % 3, firstRow: index < 3 ? ROW_CHART_1 : ROW_CHART_2 });
  });

  const reportSheet = "주요국 금융시장 동향";
  const files: Record<string, Uint8Array> = {};
  const add = (name: string, xml: string) => {
    files[name] = strToU8(xml);
  };

  add(
    "[Content_Types].xml",
    XML +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      (placed.length
        ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
        : "") +
      placed
        .map(
          (_, i) =>
            `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
            `<Override PartName="/xl/drawings/chartshapes${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml"/>`
        )
        .join("") +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
      `</Types>`
  );

  add(
    "_rels/.rels",
    rels([
      { id: "rId1", type: `${REL}/officeDocument`, target: "xl/workbook.xml" },
      { id: "rId2", type: `${PKG}/metadata/core-properties`, target: "docProps/core.xml" },
      { id: "rId3", type: `${REL}/extended-properties`, target: "docProps/app.xml" },
    ])
  );

  const now = new Date().toISOString().slice(0, 19) + "Z";
  add(
    "docProps/core.xml",
    XML +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>주요국 금융시장 동향 ${esc(market.asOf)}</dc:title><dc:creator>cj-dashboard</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
      `</cp:coreProperties>`
  );
  add(
    "docProps/app.xml",
    XML +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
      `<Application>Microsoft Excel</Application></Properties>`
  );

  add(
    "xl/workbook.xml",
    XML +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>` +
      `<sheets><sheet name="${esc(reportSheet)}" sheetId="1" r:id="rId1"/><sheet name="${esc(DATA_SHEET)}" sheetId="2" r:id="rId2"/></sheets>` +
      `</workbook>`
  );
  add(
    "xl/_rels/workbook.xml.rels",
    rels([
      { id: "rId1", type: `${REL}/worksheet`, target: "worksheets/sheet1.xml" },
      { id: "rId2", type: `${REL}/worksheet`, target: "worksheets/sheet2.xml" },
      { id: "rId3", type: `${REL}/styles`, target: "styles.xml" },
    ])
  );
  add("xl/styles.xml", stylesXml());
  add("xl/worksheets/sheet1.xml", reportSheetXml(market, placed));
  add("xl/worksheets/sheet2.xml", dataSheetXml(market));

  if (placed.length) {
    add("xl/worksheets/_rels/sheet1.xml.rels", rels([{ id: "rId1", type: `${REL}/drawing`, target: "../drawings/drawing1.xml" }]));
    add("xl/drawings/drawing1.xml", drawingXml(placed));
    add(
      "xl/drawings/_rels/drawing1.xml.rels",
      rels(placed.map((_, i) => ({ id: `rId${i + 1}`, type: `${REL}/chart`, target: `../charts/chart${i + 1}.xml` })))
    );
    placed.forEach(({ spec, chart, index }, i) => {
      const built = chartXml(spec, chart, market, index * 2, index === 0);
      add(`xl/charts/chart${i + 1}.xml`, built.chart);
      if (built.shapes) {
        add(`xl/drawings/chartshapes${i + 1}.xml`, built.shapes);
        add(
          `xl/charts/_rels/chart${i + 1}.xml.rels`,
          rels([{ id: "rId1", type: `${REL}/chartUserShapes`, target: `../drawings/chartshapes${i + 1}.xml` }])
        );
      }
    });
  }

  return zipSync(files, { level: 6 });
}
