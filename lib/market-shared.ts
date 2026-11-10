/*
 * "주요국 금융시장 동향" — 주간 모니터링 탭 아래 차트 6개와 환율표의 정의·계산.
 *
 * 이 파일은 세 곳에서 import 한다.
 *   - scripts/weekly-market.mjs  (Node 가 .ts 를 직접 읽는다 — Node 22.18+/24 의 type stripping)
 *   - components/MarketPanel.tsx (브라우저)
 *   - lib/xlsx-market.ts         (서버, 엑셀 내려받기)
 * 그래서 다른 모듈을 import 하지 않고, enum 처럼 Node 가 지우지 못하는 문법도 쓰지 않는다.
 */

// ───────────────────────── 타입 ─────────────────────────

export type MarketPoint = { date: string; value: number };

/** 최근치를 /weekly 실행 시점 시세로 채웠을 때 그 시각(ISO)과 출처. 집계치(FRED·ECOS)면 없다. */
export type LiveQuote = { time: string | null; source: string };

export const MARKET_CHART_IDS = ["sp500", "kospi", "usdkrw", "ust10", "ktb10", "wti"] as const;
export type MarketChartId = (typeof MARKET_CHART_IDS)[number];

export const MARKET_FX_IDS = ["krw", "dxy", "eur", "jpy", "cny", "vnd"] as const;
export type MarketFxId = (typeof MARKET_FX_IDS)[number];

export type MarketChart = {
  id: MarketChartId;
  /** 1년 창 안의 관측치, 날짜 오름차순 */
  points: MarketPoint[];
  latest: MarketPoint | null;
  /** latest 보다 7일 이상 앞선 마지막 관측치 — 지난주 같은 요일 */
  weekAgo: MarketPoint | null;
  /** latest 가 실행 시점 시세(기준일 날짜)이면 그 시각·출처 */
  live?: LiveQuote | null;
  /** 원 출처에 아직 없어서 /weekly 가 기사에서 확인해 넣은 날짜들 */
  overrideDates: string[];
  /** 자료를 못 받았을 때 그 사유 */
  error?: string;
};

export type MarketFxItem = {
  id: MarketFxId;
  latest: MarketPoint | null;
  baseline: MarketPoint | null;
  /** 그 통화의 달러 대비 절상(+)·절하(−) 율, % */
  changePct: number | null;
  /** latest 가 실행 시점 시세이면 그 시각·출처 */
  live?: LiveQuote | null;
};

/**
 * 보고 시점 스냅샷 — /weekly(스크립트)가 market 파일을 쓸 때의 계열별 값.
 * 화면의 "전주比 기준" 드롭다운에서 고르면 차트·각주의 변동이 이 값 대비로 계산된다 (보고 요일이 매주 달라서).
 */
export type MarketSnapshot = {
  /** 보고 시점이면 파일명 접두사 "YYMMDD-HHMM"(옛 파일은 "YYMMDD"), 종가 기준이면 "close:YYYY-MM-DD" */
  prefix: string;
  /** 값을 받은 시각(ISO). 종가 기준은 그날 15:30 KST 로 둔다 */
  at: string;
  /** 계열 id → 값 (차트 6개 · 환율표 계열 · 국고채 3년) */
  values: Record<string, number>;
  /** report: /weekly 가 파일을 쓸 때의 값 · close: 그날 종가 (없으면 report) */
  kind?: "report" | "close";
  /** 종가 기준에서 계열마다 실제로 쓴 종가의 날짜 — 그날 거래가 없으면(휴장·출처 지연) 직전 거래일 */
  dates?: Record<string, string>;
};

export type WeeklyMarket = {
  /** 기준일 — /weekly 를 실행한 날(KST). 차트 x축의 오른쪽 끝. */
  asOf: string;
  /** 창의 시작 — 1년 전 다음 날 */
  windowStart: string;
  generatedAt: string;
  /** 실행 시점 시세를 받은 시각(ISO). 안 받았으면(과거 기준일·--no-live) null */
  liveAt?: string | null;
  /** 서버가 읽은 파일명 (예 "261102-weekly-market.json") */
  file?: string;
  /** 차트마다 세로 띠로 표시하는 사건 */
  event: { date: string; label: string; note: string };
  charts: MarketChart[];
  fx: { baselineDate: string; baselineLabel: string; items: MarketFxItem[] };
  /** 이 파일을 쓸 때의 계열별 값 — 다음 보고의 전주比 기준이 된다 */
  snapshot?: { at: string; values: Record<string, number> } | null;
  /** 서버가 붙이는 과거 스냅샷 목록(시각 오름차순) — 화면의 "전주比 기준" 드롭다운 */
  snapshots?: MarketSnapshot[];
  /** 차트에 없는 계열(국고채 3년)의 최근 일별 종가 — "종가 기준" 비교에 쓴다 (서버가 붙인다) */
  recentCloses?: Record<string, MarketPoint[]>;
  /** 적용한 비교 기준(엑셀). 화면은 브라우저에서 같은 계산을 한다 */
  compareBase?: { prefix: string; at: string; label: string } | null;
};

// ───────────────────────── 정의 ─────────────────────────

export type ChartSpec = {
  id: MarketChartId;
  /** 소제목 — 참고 보고서와 글자까지 같아야 한다 */
  title: string;
  /** 플롯 왼쪽 위의 작은 회색 단위 표기 */
  unitLabel: string;
  digits: number;
  prefix: string;
  suffix: string;
  /** 전주비 — 가격·지수는 %, 금리는 %p */
  changeStyle: "pct" | "pp";
  source: string;
};

export const CHART_SPECS: ChartSpec[] = [
  { id: "sp500", title: "S&P500", unitLabel: "(41~43년 평균=10)", digits: 0, prefix: "", suffix: "", changeStyle: "pct", source: "FRED SP500" },
  { id: "kospi", title: "KOSPI", unitLabel: "(80.1.4일=100)", digits: 0, prefix: "", suffix: "", changeStyle: "pct", source: "한국은행 ECOS 802Y001" },
  { id: "usdkrw", title: "원달러 환율", unitLabel: "(원/달러)", digits: 0, prefix: "", suffix: "원", changeStyle: "pct", source: "한국은행 ECOS 731Y001 매매기준율 · 최근치 CNBC KRW= 현물" },
  { id: "ust10", title: "美 국채 10년물 금리", unitLabel: "(%)", digits: 2, prefix: "", suffix: "%", changeStyle: "pp", source: "FRED DGS10" },
  { id: "ktb10", title: "韓 국채 10년물 금리", unitLabel: "(%)", digits: 2, prefix: "", suffix: "%", changeStyle: "pp", source: "한국은행 ECOS 817Y002" },
  { id: "wti", title: "WTI", unitLabel: "($/BBL)", digits: 1, prefix: "$", suffix: "", changeStyle: "pct", source: "FRED DCOILWTICO (EIA 쿠싱 현물) · 최근치 CNBC @CL.1 선물 근월물" },
];

export type FxSpec = {
  id: MarketFxId;
  label: string;
  digits: number;
  prefix: string;
  suffix: string;
  /**
   * 표기 방향. perUsd(달러당 ○○)는 값이 내려가야 그 통화의 절상,
   * usdPer(○○당 달러)와 index(달러인덱스)는 값이 올라가야 절상.
   */
  quote: "perUsd" | "usdPer" | "index";
  source: string;
};

export const FX_SPECS: FxSpec[] = [
  { id: "krw", label: "원화", digits: 0, prefix: "", suffix: "원", quote: "perUsd", source: "ECOS 731Y001 원/달러 매매기준율" },
  { id: "dxy", label: "달러화", digits: 1, prefix: "", suffix: "", quote: "index", source: "최근치 CNBC .DXY · 비교 시점은 ICE 산식으로 ECOS 731Y002 6개 통화에서 계산" },
  { id: "eur", label: "유로화", digits: 2, prefix: "$", suffix: "", quote: "usdPer", source: "ECOS 731Y002 달러/유로" },
  { id: "jpy", label: "엔화", digits: 1, prefix: "", suffix: "엔", quote: "perUsd", source: "ECOS 731Y002 엔/달러" },
  { id: "cny", label: "위안화", digits: 2, prefix: "", suffix: "위안", quote: "perUsd", source: "원/달러 ÷ 원/위안 매매기준율 (ECOS 731Y001)" },
  { id: "vnd", label: "베트남 동", digits: 0, prefix: "", suffix: "동", quote: "perUsd", source: "ECOS 731Y002 동/달러" },
];

/** 환율표 항목 → 자료 계열 id (scripts/weekly-market.mjs 의 캐시 키이자 시세 조회 id) */
export const FX_SERIES: Record<MarketFxId, string> = {
  krw: "usdkrw",
  dxy: "dxy",
  eur: "eurusd",
  jpy: "usdjpy",
  cny: "usdcny",
  vnd: "usdvnd",
};

/** 차트마다 연한 파란 세로 띠로 표시하는 사건. 바꾸면 다음 /weekly 부터 반영된다. */
export const MARKET_EVENT = { date: "2026-02-28", label: "이스라엘 이란 공습", note: "(26/2/28)" };

/** 환율표의 비교 시점 — 사건 전날 */
export const FX_BASELINE = { date: "2026-02-27", label: "전쟁직전" };

/**
 * ICE 달러인덱스(DXY) 산식. 6개 통화의 대미달러 환율을 가중 기하평균한다.
 * 음수 가중치는 "○○당 달러"(유로·파운드)로 표기되는 통화.
 */
export const DXY_WEIGHTS = {
  eurusd: -0.576,
  usdjpy: 0.136,
  gbpusd: -0.119,
  usdcad: 0.091,
  usdsek: 0.042,
  usdchf: 0.036,
} as const;
export const DXY_CONSTANT = 50.14348112;

export function dollarIndex(rates: Record<keyof typeof DXY_WEIGHTS, number>): number {
  let index = DXY_CONSTANT;
  for (const key of Object.keys(DXY_WEIGHTS) as Array<keyof typeof DXY_WEIGHTS>) {
    index *= rates[key] ** DXY_WEIGHTS[key];
  }
  return index;
}

// ───────────────────────── 날짜 ─────────────────────────

export function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 달을 더하되 말일을 넘지 않는다: 2025-11-30 + 3개월 → 2026-02-28 */
export function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/**
 * 차트 창. 기준일이 11/2 면 작년 11/3 부터 올해 11/2 까지 — 눈금은 11/3 · 2/3 · 5/3 · 8/3 · 11/2.
 * 석 달씩 더하되 말일을 넘기지 않으므로 2/31 같은 날짜는 나오지 않는다.
 */
export function marketWindow(asOf: string): { windowStart: string; ticks: string[] } {
  const windowStart = shiftDays(addMonthsClamped(asOf, -12), 1);
  const ticks = [0, 3, 6, 9].map((months) => addMonthsClamped(windowStart, months));
  ticks.push(asOf);
  return { windowStart, ticks };
}

/** "2026-02-03" → "2/3" */
export function formatTickDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 파일명 접두사 "261110-1405" → 정렬 키 "2611101405". 시각 없는 옛 접두사는 그날 맨 앞("0000"). */
export function stampKey(name: string): string {
  const match = /^(\d{6})(?:-(\d{4}))?/.exec(name);
  return match ? `${match[1]}${match[2] ?? "0000"}` : "";
}

/** ISO 시각의 KST 날짜 "YYYY-MM-DD" */
export function kstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** ISO 시각 → "11/3(화) 16:50" (KST) — 스냅샷 드롭다운 표기 */
export function formatSnapshotLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()}(${WEEKDAY_KO[kst.getUTCDay()]}) ${hh}:${mm}`;
}

/** 기본 비교 기준 — 기준일(오늘)보다 앞선 날의 가장 최근 스냅샷. 오늘 만든 파일(이번 보고·테스트)은 빼기 위해서다. */
export function defaultSnapshot(snapshots: MarketSnapshot[], asOf: string): MarketSnapshot | null {
  let found: MarketSnapshot | null = null;
  for (const snapshot of snapshots) if (kstDateOf(snapshot.at) < asOf) found = snapshot;
  return found;
}

/** 스냅샷을 비교점(weekAgo 자리)으로 — 그 계열 값이 없으면 null. 종가 기준이면 실제로 쓴 종가의 날짜. */
export function snapshotPoint(snapshot: MarketSnapshot | null | undefined, id: string): MarketPoint | null {
  const value = snapshot?.values[id];
  return snapshot && value !== undefined ? { date: snapshot.dates?.[id] ?? kstDateOf(snapshot.at), value } : null;
}

function weekdayKo(date: string): string {
  return WEEKDAY_KO[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** 드롭다운·각주 표기 — 보고 시점은 "11/3(화) 16:50 보고", 종가 기준은 "11/7(금) 종가" */
export function snapshotLabel(snapshot: MarketSnapshot): string {
  if (snapshot.kind === "close") {
    const date = kstDateOf(snapshot.at);
    return `${formatTickDate(date)}(${weekdayKo(date)}) 종가`;
  }
  return `${formatSnapshotLabel(snapshot.at)} 보고`;
}

/**
 * 최근 N일의 "종가 기준" 비교점 — 저장 파일이 없는 날짜와도 비교할 수 있게. 기준일(오늘)은 뺀다.
 * 차트 점(1년 일별 종가)과 recentCloses(차트에 없는 계열)에서 그날 종가를 쓰고, 없으면 직전 거래일 종가를 쓰되
 * 그 날짜를 dates 에 남긴다(화면이 밝힌다). 어느 계열도 거래가 없는 날(주말)은 뺀다. 날짜 오름차순.
 */
export function buildCloseSnapshots(market: WeeklyMarket, days = 14): MarketSnapshot[] {
  const series: Array<[string, MarketPoint[]]> = [
    ...market.charts.map((chart): [string, MarketPoint[]] => [chart.id, chart.points.filter((p) => p.date < market.asOf)]),
    ...Object.entries(market.recentCloses ?? {}),
  ];
  const out: MarketSnapshot[] = [];
  for (let back = days; back >= 1; back -= 1) {
    const date = shiftDays(market.asOf, -back);
    if (!series.some(([, points]) => points.some((p) => p.date === date))) continue;
    const values: Record<string, number> = {};
    const dates: Record<string, string> = {};
    for (const [id, points] of series) {
      const point = latestOnOrBefore(points, date);
      if (!point) continue;
      values[id] = point.value;
      dates[id] = point.date;
    }
    out.push({ prefix: `close:${date}`, at: `${date}T15:30:00+09:00`, values, dates, kind: "close" });
  }
  return out;
}

/** ISO 시각 → "12:21" (KST). 실행 시점 시세의 시각 표기. */
export function formatKstTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

/** 날짜 문자열 → 창 안의 비율(0~1). 거래일이 아니라 달력일 기준이라 주말은 빈 칸으로 남는다. */
export function dateFraction(date: string, windowStart: string, asOf: string): number {
  const start = Date.parse(`${windowStart}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const t = Date.parse(`${date}T00:00:00Z`);
  return end === start ? 1 : (t - start) / (end - start);
}

// ───────────────────────── 계산 ─────────────────────────

export function latestOnOrBefore(points: MarketPoint[], date: string): MarketPoint | null {
  let found: MarketPoint | null = null;
  for (const point of points) {
    if (point.date > date) break;
    found = point;
  }
  return found;
}

/** 지난주 같은 요일 — latest 보다 7일 이상 앞선 마지막 관측치 */
export function pickWeekAgo(points: MarketPoint[], latest: MarketPoint | null): MarketPoint | null {
  if (!latest) return null;
  return latestOnOrBefore(points, shiftDays(latest.date, -7));
}

/** 그 통화의 달러 대비 절상(+)·절하(−) 율 */
export function appreciationPct(spec: FxSpec, latest: number, baseline: number): number {
  if (!latest || !baseline) return 0;
  return spec.quote === "perUsd" ? (baseline / latest - 1) * 100 : (latest / baseline - 1) * 100;
}

/**
 * y축. 1년치 값이 플롯을 위아래로 잘 채우도록 눈금 간격(1·2·5 배수)을 먼저 정하고,
 * 그 1/5 단위로 아래위를 조금 여유 있게 잘라 낸다. 눈금은 아래 끝에서 간격마다 — 참고 보고서(Excel)처럼
 * 5,800 · 6,800 · 7,800 식으로 찍힌다.
 */
export function yScale(values: number[]): { lo: number; hi: number; step: number; ticks: number[]; decimals: number } {
  if (!values.length) return { lo: 0, hi: 1, step: 1, ticks: [0, 1], decimals: 0 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.abs(max) * 0.1 || 1;

  const step = niceStep(spread / 3);
  const minor = step / 5;
  const pad = spread * 0.05;
  const lo = round(Math.floor((min - pad) / minor) * minor);
  const hi = round(Math.ceil((max + pad) / minor) * minor);

  const ticks: number[] = [];
  for (let v = lo; v <= hi + minor / 1000; v += step) ticks.push(round(v));

  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return { lo, hi, step, ticks, decimals };
}

/** 1·2·5 배수 중 가까운 간격. 경계를 기하평균(√2·√10·√50)에 두어 눈금이 3~5개 나온다 (d3 의 tickStep 과 같은 방식). */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const snapped = normalized >= Math.sqrt(50) ? 10 : normalized >= Math.sqrt(10) ? 5 : normalized >= Math.sqrt(2) ? 2 : 1;
  return snapped * magnitude;
}

/**
 * 최근치 라벨을 선 아래에 둘지(true) 위에 둘지(false).
 * 라벨은 플롯 오른쪽 끝에 붙고 왼쪽으로 뻗으므로, 창의 마지막 30% 구간에서 선이 차지하는 위아래 중 빈 쪽을 고른다.
 */
export function annotationBelow(points: MarketPoint[], windowStart: string, asOf: string, lo: number, hi: number): boolean {
  const recent = points.filter((p) => dateFraction(p.date, windowStart, asOf) >= 0.7);
  if (!recent.length) return true;
  const values = recent.map((p) => p.value);
  const roomAbove = hi - Math.max(...values);
  const roomBelow = Math.min(...values) - lo;
  return roomBelow >= roomAbove;
}

function round(value: number): number {
  return Number(value.toFixed(10));
}

// ───────────────────────── 표기 ─────────────────────────

function fixed(value: number, digits: number, grouping = true): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: grouping,
  });
}

/** 7691.2 → "7,691" · 1330 → "1,330원" · 5.14 → "5.14%" · 103.6 → "$103.6" */
export function formatValue(spec: { digits: number; prefix: string; suffix: string }, value: number): string {
  return `${spec.prefix}${fixed(value, spec.digits)}${spec.suffix}`;
}

/** 축 눈금: "7,800", "3.8" */
export function formatAxisValue(value: number, decimals: number): string {
  return fixed(value, decimals);
}

/** 부호를 앞에 붙인다. 음수 부호는 보고서처럼 U+2212. 반올림해서 0 이 되면 부호를 붙이지 않는다 ("−0.00%p" 방지). */
export function formatSignedPct(value: number, digits: number, unit: string): string {
  const shown = Number(Math.abs(value).toFixed(digits));
  const sign = shown === 0 ? "" : value > 0 ? "+" : "−";
  return `${sign}${fixed(Math.abs(value), digits)}${unit}`;
}

/** 전주비: 가격·지수 "−1.5%", 금리 "−0.07%p" */
export function formatWeekChange(spec: ChartSpec, latest: MarketPoint, weekAgo: MarketPoint): string {
  if (spec.changeStyle === "pp") return formatSignedPct(latest.value - weekAgo.value, 2, "%p");
  return formatSignedPct(weekAgo.value === 0 ? 0 : ((latest.value - weekAgo.value) / weekAgo.value) * 100, 1, "%");
}
