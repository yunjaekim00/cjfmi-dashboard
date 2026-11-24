import { strToU8, zipSync } from "fflate";

import {
  CHART_SPECS,
  FX_SPECS,
  annotationBelow,
  formatKstTime,
  formatSignedPct,
  formatTickDate,
  formatValue,
  formatWeekChange,
  kstDateOf,
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
 * 차트 서식은 보고서(워드 "[미경연] 금융시장 모니터링")에 들어 있는 차트 6개의 정의를 그대로 옮겼다 (2026-11-24):
 *   꺾은선형 + 날짜 축 · 선 1pt 0070C0 · 제목·범례·눈금선 없음 · 배경·테두리 없음 · x축 선만 검정 0.75pt
 *   축 눈금 CJ ONLYONE 300 8.8~9pt 회색(595959) · 최근치는 마지막 점의 데이터 레이블(값 10pt + 전주비 8pt, 굵게, 오른쪽 맞춤)
 *   단위 표기 8pt 회색 텍스트 상자 · 사건 띠는 반투명 연파랑 직사각형 · 첫 차트에만 사건 라벨 7pt
 * 그림 크기·플롯 위치는 차트마다 조금씩 달라 CHART_REF 에 차트별로 적어 두었다.
 */

const FONT_300 = "CJ ONLYONE 300";
const FONT_400 = "CJ ONLYONE 400";
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
const CHART_ROWS = 7; // 7 × 15pt(20px) = 140px — 차트 높이(보고서 차트 그대로 약 3.4cm ≈ 131~134px)가 들어간다
const ROW_TITLE = 1;
/** 차트 두 줄의 첫 행 (제목 바 없이 차트가 바로 시작한다 — 사용자 엑셀 디자인) */
const ROW_CHART_1 = 2;
const ROW_CHART_2 = ROW_CHART_1 + CHART_ROWS + 1; // 14
const ROW_FX = ROW_CHART_2 + CHART_ROWS + 1; // 26
const ROW_NOTE = ROW_FX + 5; // 31 — 환율표 4행(머리·최근·전쟁직전比·직전보고일比) 다음 한 줄 띄고

const DATA_SHEET = "데이터";


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

/**
 * 차트별 치수 — 보고서(워드)에 들어 있는 차트 6개를 잰 값 그대로 (CHART_SPECS 순서: S&P500 · KOSPI · 원달러 · 美 10년 · 韓 10년 · WTI).
 *   cx·cy  그림 크기 (EMU)
 *   plot   플롯 영역 (차트 크기 대비 비율: x, y, w, h)
 *   tickSz 축 눈금 글자 크기 (1/100 pt)
 *   unit   단위 표기 상자 (x0, y0, x1, y1)
 *   bandY  사건 띠의 위·아래
 *   label  최근치 데이터 레이블 상자의 크기 (w, h)
 */
type ChartRef = {
  cx: number;
  cy: number;
  plot: [number, number, number, number];
  tickSz: number;
  unit: [number, number, number, number];
  bandY: [number, number];
  label: [number, number];
};
const CHART_REF: ChartRef[] = [
  {
    cx: 2291715,
    cy: 1251585,
    plot: [0.20713449515348259, 0.20682855079356691, 0.70004467364186396, 0.57661125692621751],
    tickSz: 880,
    unit: [0, 0.0273, 0.4227, 0.1864],
    bandY: [0.116, 0.7818],
    label: [0.43262661331598679, 0.30267348441200942],
  },
  {
    cx: 2154555,
    cy: 1219835,
    plot: [0.24226846644169478, 0.22288649600270105, 0.67302716906318771, 0.55967651823001452],
    tickSz: 880,
    unit: [0.0203, 0, 0.4112, 0.1488],
    bandY: [0.095, 0.7814],
    label: [0.2973767468255657, 0.34708981174307524],
  },
  {
    cx: 2154555,
    cy: 1219835,
    plot: [0.21891797658134063, 0.16789447308132874, 0.68986934751237272, 0.61258857241384967],
    tickSz: 880,
    unit: [0, 0, 0.39088, 0.14878],
    bandY: [0.09914, 0.78832],
    label: [0.29938633786848073, 0.30823739977090492],
  },
  {
    cx: 2255520,
    cy: 1247775,
    plot: [0.1556790695280737, 0.17799835516940943, 0.75706923829643258, 0.59814714566929139],
    tickSz: 900,
    unit: [0.0227, 0, 0.4135, 0.1488],
    bandY: [0.0427, 0.7733],
    label: [0.31399078164009986, 0.34852397124966578],
  },
  {
    cx: 2160905,
    cy: 1275715,
    plot: [0.15822645112688152, 0.16638999729612364, 0.76253772710353063, 0.60998877481625935],
    tickSz: 900,
    unit: [0.0305, 0.0058, 0.4213, 0.1546],
    bandY: [0.0689, 0.7905],
    label: [0.30524072729561386, 0.37151899537544375],
  },
  {
    cx: 2197100,
    cy: 1241425,
    plot: [0.079247594050743664, 0.16018248860444956, 0.72290325551411327, 0.61631227453822557],
    tickSz: 900,
    unit: [0.0217, 0, 0.4126, 0.1488],
    bandY: [0.1005, 0.7839],
    label: [0.22690104526407884, 0.31949393422596367],
  },
];

/** 지표 선·최근치 글자 (보고서 차트의 0070C0) */
const LINE_BLUE = "0070C0";
/** 지표 선 굵기 1pt */
const LINE_WIDTH_EMU = 12700;
/** 축 눈금 글자 — 테마 tx1 의 65% (보고서 차트 그대로) */
const AXIS_TEXT = "595959";
/** 단위 표기·사건 라벨 글자 — 50% 회색 */
const SHAPE_GRAY = "7F7F7F";
/** 사건 띠 — 테마 accent1(4F81BD)의 40% 밝은 색에 투명도 약 30% */
const BAND_FILL = "95B3D7";
const BAND_ALPHA = 30196;
/** 사건 띠 너비 (차트 너비 대비) */
const BAND_W = 0.012;
/** 사건 라벨이 띠 오른쪽에서 떨어진 거리·상자 크기 (S&P500 차트에서 잰 값) */
const EVENT_GAP = 0.0562;
const EVENT_BOX: [number, number, number, number] = [0.4058, 0.1853, 0.4214, 0];
/** 최근치 레이블을 마지막 점에서 옮기는 정도 (차트 크기 대비) — 선 아래에 둘 때 / 위에 둘 때 */
const LABEL_DX = -0.025;
const LABEL_DY_BELOW = 0.19;
const LABEL_DY_ABOVE = -0.225;

const NS_C15 = "http://schemas.microsoft.com/office/drawing/2012/chart";
const RPR_REST = `i="0" u="none" strike="noStrike" kern="1200" baseline="0"`;

function fontXml(font: string): string {
  return `<a:latin typeface="${esc(font)}"/><a:ea typeface="${esc(font)}"/>`;
}

function fill(color: string): string {
  return `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;
}

/** 축 눈금 글자 */
function axisText(sz: number): string {
  return (
    `<c:txPr><a:bodyPr rot="-60000000" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/>` +
    `<a:p><a:pPr><a:defRPr sz="${sz}" b="0" ${RPR_REST}>${fill(AXIS_TEXT)}${fontXml(FONT_300)}<a:cs typeface="+mn-cs"/></a:defRPr></a:pPr>` +
    `<a:endParaRPr lang="ko-KR"/></a:p></c:txPr>`
  );
}

const SHOW_NONE =
  `<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/>` +
  `<c:showPercent val="0"/><c:showBubbleSize val="0"/>`;

/** 최근치 레이블 — 값(10pt 굵게) 아래 줄에 전주비(8pt 굵게). 오른쪽 맞춤, 줄 간격 고정 11pt. */
function latestLabel(idx: number, value: string, change: string, dy: number, size: [number, number]): string {
  const rPr = (sz: number) => `<a:rPr lang="ko-KR" altLang="en-US" sz="${sz}" b="1" ${RPR_REST}>${fill(LINE_BLUE)}${fontXml(FONT_300)}</a:rPr>`;
  const pPr =
    `<a:pPr algn="r"><a:lnSpc><a:spcPts val="1100"/></a:lnSpc>` +
    `<a:defRPr sz="900" b="1" ${RPR_REST}>${fill(LINE_BLUE)}${fontXml(FONT_300)}<a:cs typeface="+mn-cs"/></a:defRPr></a:pPr>`;
  const body = `<a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" lIns="38100" tIns="19050" rIns="38100" bIns="19050" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>`;
  const text =
    `<a:r>${rPr(1000)}<a:t>${esc(value)}</a:t></a:r>` +
    (change ? `<a:br>${rPr(1000)}</a:br><a:r>${rPr(800)}<a:t>${esc(change)}</a:t></a:r>` : "");
  const noBox = `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr>`;
  return (
    `<c:dLbls><c:dLbl><c:idx val="${idx}"/>` +
    `<c:layout><c:manualLayout><c:x val="${LABEL_DX}"/><c:y val="${dy.toFixed(4)}"/></c:manualLayout></c:layout>` +
    `<c:tx><c:rich>${body}<a:p>${pPr}${text}</a:p></c:rich></c:tx>` +
    noBox +
    `<c:txPr>${body}<a:p>${pPr}<a:endParaRPr lang="ko-KR"/></a:p></c:txPr>` +
    `<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/>` +
    `<c:extLst><c:ext uri="{CE6537A1-D6FC-4f65-9D91-7224C49458BB}" xmlns:c15="${NS_C15}">` +
    `<c15:layout><c:manualLayout><c:w val="${size[0]}"/><c:h val="${size[1]}"/></c:manualLayout></c15:layout></c:ext></c:extLst>` +
    `</c:dLbl>` +
    noBox +
    SHOW_NONE +
    `<c:extLst><c:ext uri="{CE6537A1-D6FC-4f65-9D91-7224C49458BB}" xmlns:c15="${NS_C15}"><c15:showLeaderLines val="0"/></c:ext></c:extLst>` +
    `</c:dLbls>`
  );
}

let nextShapeId = 2;

type Box = [number, number, number, number];

function anchor([x0, y0, x1, y1]: Box, shape: string): string {
  const f = (v: number) => v.toFixed(5);
  return (
    `<cdr:relSizeAnchor><cdr:from><cdr:x>${f(x0)}</cdr:x><cdr:y>${f(y0)}</cdr:y></cdr:from>` +
    `<cdr:to><cdr:x>${f(x1)}</cdr:x><cdr:y>${f(y1)}</cdr:y></cdr:to>${shape}</cdr:relSizeAnchor>`
  );
}

/** 차트 위 텍스트 상자 (좌표는 차트 크기 대비 비율). 줄바꿈 없음 · 안쪽 여백 0 — 보고서 차트의 단위 표기·사건 라벨과 같다. */
function textBox(box: Box, lines: string[], sz: number, lineSpacing?: number): string {
  const rPr = `<a:rPr lang="ko-KR" altLang="en-US" sz="${sz}">${fill(SHAPE_GRAY)}${fontXml(FONT_400)}</a:rPr>`;
  const pPr = lineSpacing ? `<a:pPr algn="l"><a:lnSpc><a:spcPts val="${lineSpacing}"/></a:lnSpc><a:buNone/></a:pPr>` : "";
  return anchor(
    box,
    `<cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="${nextShapeId++}" name="TextBox"/><cdr:cNvSpPr txBox="1"/></cdr:nvSpPr>` +
      `<cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></cdr:spPr>` +
      `<cdr:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0"/><a:lstStyle/>` +
      lines.map((text) => `<a:p>${pPr}<a:r>${rPr}<a:t>${esc(text)}</a:t></a:r></a:p>`).join("") +
      `</cdr:txBody></cdr:sp>`
  );
}

/** 사건 띠 — 반투명 연파랑 직사각형 */
function bandShape(box: Box): string {
  return anchor(
    box,
    `<cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="${nextShapeId++}" name="직사각형"/><cdr:cNvSpPr/></cdr:nvSpPr>` +
      `<cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
      `<a:solidFill><a:srgbClr val="${BAND_FILL}"><a:alpha val="${BAND_ALPHA}"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></cdr:spPr>` +
      `<cdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></cdr:txBody></cdr:sp>`
  );
}

function userShapesXml(shapes: string[]): string {
  return (
    XML +
    `<c:userShapes xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing">` +
    shapes.join("") +
    `</c:userShapes>`
  );
}

function numCache(formatCode: string, values: number[]): string {
  return (
    `<c:numCache><c:formatCode>${esc(formatCode)}</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("") +
    `</c:numCache>`
  );
}

/**
 * 차트 하나 — 보고서(워드)의 차트와 같은 서식의 꺾은선형 차트(날짜 축).
 * dataCol 은 시트 2 에서 이 차트의 날짜 열 번호(0 기준) — 값은 그 다음 열. index 는 CHART_SPECS 에서의 순서.
 */
function chartXml(
  spec: ChartSpec,
  chart: MarketChart,
  market: WeeklyMarket,
  dataCol: number,
  index: number
): { chart: string; shapes: string | null } {
  const ref = CHART_REF[index] ?? CHART_REF[0];
  const first = index === 0;
  const n = chart.points.length;
  const dateRef = `'${DATA_SHEET}'!$${col(dataCol)}$2:$${col(dataCol)}$${n + 1}`;
  const valueRef = `'${DATA_SHEET}'!$${col(dataCol + 1)}$2:$${col(dataCol + 1)}$${n + 1}`;

  const { windowStart } = marketWindow(market.asOf);
  const scale = yScale(chart.points.map((p) => p.value));
  const xMin = serial(windowStart);
  const xMax = serial(market.asOf);
  // 눈금 네 개(창의 처음 · 1/3 · 2/3 · 끝) — 보고서 차트가 기간의 1/3(일 단위)을 간격으로 쓴다. 다섯 개면 Excel 이 글자를 기울이거나 자른다
  const tickUnit = Math.max(1, Math.floor((xMax - xMin) / 3));
  const yFormat = scale.decimals === 0 ? `#,##0_);[Red]\\(#,##0\\)` : `#,##0.${"0".repeat(scale.decimals)}_);[Red]\\(#,##0.${"0".repeat(scale.decimals)}\\)`;

  const [px, py, pw, ph] = ref.plot;
  // 점의 위치(차트 크기 대비 비율)와, 주어진 상자 안에 들어오는 점의 수 — 글 상자가 지표 선을 덜 가리는 자리를 찾는 데 쓴다
  const xOf = (date: string) => px + pw * ((serial(date) - xMin) / (xMax - xMin || 1));
  const yOf = (value: number) => py + ph * ((scale.hi - value) / (scale.hi - scale.lo || 1));
  const overlap = ([x0, x1]: [number, number], [y0, y1]: [number, number]) =>
    chart.points.filter((p) => {
      const x = xOf(p.date);
      const y = yOf(p.value);
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }).length;

  // 최근치 레이블 — 마지막 점에 붙는다
  const { latest, weekAgo } = chart;
  let dLbls = "";
  /** 최근치 레이블이 차지하는 자리 (x0, y0, x1, y1) — 사건 라벨이 이 자리를 피한다 */
  let labelRect: Box | null = null;
  if (latest && n > 0) {
    const below = annotationBelow(chart.points, windowStart, market.asOf, scale.lo, scale.hi);
    const change = weekAgo ? `(${first ? "전주比 " : ""}${formatWeekChange(spec, latest, weekAgo)})` : "";
    // 레이블 가운데가 마지막 점에서 dy 만큼 옮겨진다. 보고서에서는 손으로 옮긴 자리라, 여기서는 글(두 줄 ≈ 차트 높이의 0.24)이
    // 지표 선과 가장 덜 겹치는 dy 를 고른다 — x축·단위 표기를 넘지 않는 범위에서, 같으면 기본 자리(아래 0.19 / 위 -0.225)에 가까운 쪽
    const pointY = yOf(latest.value);
    const preferred = below ? LABEL_DY_BELOW : LABEL_DY_ABOVE;
    const textW = first ? 0.4 : 0.3;
    const span: [number, number] = [px + pw + 0.02 - textW, px + pw + 0.03];
    let dy = preferred;
    let best = Infinity;
    for (let step = -16; step <= 10; step += 1) {
      const candidate = step * 0.025;
      const center = pointY + candidate;
      if (Math.abs(candidate) < 0.1 || center - 0.12 < ref.unit[3] - 0.02 || center + 0.12 > py + ph - 0.01) continue;
      const cost = overlap(span, [center - 0.12, center + 0.12]) + Math.abs(candidate - preferred) * 0.01;
      if (cost < best) {
        best = cost;
        dy = candidate;
      }
    }
    labelRect = [span[0], pointY + dy - 0.12, span[1], pointY + dy + 0.12];
    dLbls = latestLabel(n - 1, formatValue(spec, latest.value), change, dy, ref.label);
  }

  // 차트 위 도형 — 단위 표기 · 사건 띠 · (첫 차트만) 사건 라벨
  const shapes: string[] = [textBox(ref.unit, [spec.unitLabel], 800)];
  const eventSerial = serial(market.event.date);
  if (market.event.date >= windowStart && market.event.date <= market.asOf && xMax > xMin) {
    const eventX = px + pw * ((eventSerial - xMin) / (xMax - xMin));
    shapes.push(bandShape([eventX - BAND_W / 2, ref.bandY[0], eventX + BAND_W / 2, ref.bandY[1]]));
    if (first) {
      // 보고서 자리(띠 오른쪽 위)가 기본. 지표 선이 지나가면 플롯 아래쪽 자리와 견주어 덜 겹치는 쪽에 둔다 (글 너비 ≈ 0.33, 높이 ≈ 0.17)
      const x0 = Math.min(eventX + BAND_W / 2 + EVENT_GAP, 0.99 - EVENT_BOX[0]);
      const cost = (top: number) =>
        overlap([x0, x0 + 0.33], [top, top + 0.17]) +
        (labelRect && x0 < labelRect[2] && x0 + 0.33 > labelRect[0] && top < labelRect[3] && top + 0.17 > labelRect[1] ? 1000 : 0);
      const top = [EVENT_BOX[1], py + ph - 0.2].reduce((a, b) => (cost(b) < cost(a) ? b : a));
      shapes.push(textBox([x0, top, x0 + EVENT_BOX[0], top + (EVENT_BOX[2] - EVENT_BOX[1])], [market.event.label, market.event.note], 700, 800));
    }
  }

  const series =
    `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(spec.title)}</c:v></c:tx>` +
    `<c:spPr><a:ln w="${LINE_WIDTH_EMU}" cap="rnd">${fill(LINE_BLUE)}<a:round/></a:ln><a:effectLst/></c:spPr>` +
    `<c:marker><c:symbol val="none"/></c:marker>` +
    dLbls +
    `<c:cat><c:numRef><c:f>${esc(dateRef)}</c:f>${numCache("yyyy\\-mm\\-dd", chart.points.map((p) => serial(p.date)))}</c:numRef></c:cat>` +
    `<c:val><c:numRef><c:f>${esc(valueRef)}</c:f>${numCache("General", chart.points.map((p) => p.value))}</c:numRef></c:val>` +
    `<c:smooth val="0"/></c:ser>`;

  const dateAxis =
    `<c:dateAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/><c:max val="${xMax}"/><c:min val="${xMin}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="m\\/d" sourceLinked="0"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:noFill/><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">${fill("000000")}<a:round/></a:ln><a:effectLst/></c:spPr>` +
    axisText(ref.tickSz) +
    `<c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblOffset val="100"/>` +
    `<c:baseTimeUnit val="days"/><c:majorUnit val="${tickUnit}"/><c:majorTimeUnit val="days"/></c:dateAx>`;

  const valueAxis =
    `<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/><c:max val="${scale.hi}"/><c:min val="${scale.lo}"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="${esc(yFormat)}" sourceLinked="0"/>` +
    `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr>` +
    axisText(ref.tickSz) +
    `<c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="${scale.step}"/></c:valAx>`;

  const plotLayout =
    `<c:layout><c:manualLayout><c:layoutTarget val="inner"/><c:xMode val="edge"/><c:yMode val="edge"/>` +
    `<c:x val="${px}"/><c:y val="${py}"/><c:w val="${pw}"/><c:h val="${ph}"/></c:manualLayout></c:layout>`;

  const chartXmlText =
    XML +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    `<c:date1904 val="0"/><c:lang val="ko-KR"/><c:roundedCorners val="0"/><c:style val="2"/>` +
    `<c:chart><c:autoTitleDeleted val="1"/><c:plotArea>${plotLayout}` +
    `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}` +
    `<c:dLbls>${SHOW_NONE}</c:dLbls><c:smooth val="0"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>` +
    dateAxis +
    valueAxis +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr></c:plotArea>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart>` +
    `<c:spPr><a:noFill/><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:noFill/><a:round/></a:ln><a:effectLst/></c:spPr>` +
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr>${fontXml(FONT_300)}</a:defRPr></a:pPr><a:endParaRPr lang="ko-KR"/></a:p></c:txPr>` +
    `<c:userShapes r:id="rId1"/>` +
    `</c:chartSpace>`;

  return { chart: chartXmlText, shapes: userShapesXml(shapes) };
}

/**
 * 보고서(워드)에 넣을 차트 6개 — CHART_SPECS 순서. 엑셀과 같은 차트 정의이고 값은 차트 안에 캐시로 들어 있다.
 * 자료가 없는 차트는 빈 차트로 만든다 (양식에 든 옛 값이 남지 않게).
 */
export function buildReportCharts(market: WeeklyMarket): { chart: string; shapes: string }[] {
  const chartById = new Map(market.charts.map((chart) => [chart.id, chart]));
  return CHART_SPECS.map((spec, index) => {
    const chart = chartById.get(spec.id) ?? ({ id: spec.id, points: [], latest: null, weekAgo: null, overrideDates: [] } as unknown as MarketChart);
    const built = chartXml(spec, chart, market, index * 2, index);
    return { chart: built.chart, shapes: built.shapes ?? userShapesXml([]) };
  });
}

// ───────────────────────── 시트 ─────────────────────────

type Placed = { spec: ChartSpec; chart: MarketChart; index: number; block: number; firstRow: number };

function drawingXml(placed: Placed[]): string {
  const anchors = placed
    .map(({ index, block, firstRow }, i) => {
      const fromCol = block * BLOCK;
      const fromRow = firstRow - 1; // xdr:row 는 0 기준
      return (
        `<xdr:oneCellAnchor>` +
        `<xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${(CHART_REF[index] ?? CHART_REF[0]).cx}" cy="${(CHART_REF[index] ?? CHART_REF[0]).cy}"/>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
        `</xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`
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
  // 직전보고일比 — 괄호 날짜는 적용한 비교 기준(?base=, 없으면 기준일보다 앞선 가장 최근 보고)
  const compareDate = market.compareBase ? formatTickDate(kstDateOf(market.compareBase.at)) : null;
  putMerged(ROW_FX + 3, 0, 2, `직전보고일${compareDate ? `(${compareDate}일)` : ""}比`, STYLE.fxLabel);
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
    putMerged(ROW_FX + 3, from, from + 2, item?.compare ? formatSignedPct(item.compare.changePct, 1, "%") : "-", STYLE.fxValue);
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
    `환율표 비교 시점 값은 한국은행 고시(08:30) 기준, 달러인덱스 비교 시점은 ICE 산식으로 계산, 위안은 원/달러 ÷ 원/위안 교차환율. 전주比와 환율표 직전보고일比는 ${
      market.compareBase ? `${market.compareBase.label} 대비` : "각각 지난주 같은 요일 대비 · 기준 없음"
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
      const built = chartXml(spec, chart, market, index * 2, index);
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
