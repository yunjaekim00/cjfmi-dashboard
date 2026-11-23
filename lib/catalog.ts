import type { RangeKey } from "@/lib/series";
import type { ChangeStyle } from "@/lib/types";

/**
 * 대시보드가 다루는 모든 시계열의 정의.
 * 지표를 추가할 때는 여기 SERIES 에 한 줄 넣고, CARDS / CHARTS 에서 참조하면 된다.
 *
 * ECOS 통계표·항목 코드는 StatisticItemList API 로 실제 확인한 값이다.
 * (특히 회사채 AA- 는 010300000 이고, 010320000 은 BBB- 라 헷갈리기 쉽다.)
 * 환율은 모두 CNBC 시세를 쓴다 (사용자 지시, 2026-11-16) — 한국은행 고시보다 하루 빠르고 오늘 값은 장중에 움직인다.
 */

/** 모든 계열의 조회 시작 시점. 1997년 외환위기가 들어오도록 1995년부터. */
const ECOS_DAILY_START = "19950101";
const ECOS_MONTHLY_START = "199501";
const FRED_START = "1995-01-01";

export type SeriesDef =
  | {
      source: "ecos";
      label: string;
      statCode: string;
      cycle: "D" | "M";
      itemCode1: string;
      start: string;
    }
  | {
      source: "fred";
      label: string;
      seriesId: string;
      start: string;
    }
  | {
      source: "cnbc";
      label: string;
      /** CNBC 심볼 — 환율은 "KRW=" 처럼 RIC 모양, 지수는 ".DXY" */
      symbol: string;
      /** 값에 곱할 배수. 원/엔은 1엔당 원 시세(JPYKRW=)에 100 을 곱해 100엔당 원으로 맞춘다 */
      scale?: number;
    };

export const SERIES = {
  // ── 환율 (CNBC 시세, lib/sources/cnbc.ts) ──
  // 과거는 종가(최근 3년 일별, 그 앞은 2011년부터 주별), 오늘(KST)은 실시간 시세로 덮어쓴다 (lib/dashboard.ts).
  // 한국은행 고시가 필요하면 ECOS 731Y001(원화 환율)·731Y002(대미달러환율)에 있다 — 주간 모니터링 스크립트가 쓴다.
  usdkrw: { source: "cnbc", label: "원/달러", symbol: "KRW=" },
  // 원/엔(100엔)은 종합 지표 카드에만 쓴다 — 환율 탭은 엔/달러를 그린다
  jpykrw: { source: "cnbc", label: "원/엔(100엔)", symbol: "JPYKRW=", scale: 100 },
  usdjpy: { source: "cnbc", label: "엔/달러", symbol: "JPY=" },
  dxy: { source: "cnbc", label: "달러인덱스", symbol: ".DXY" },
  eurusd: { source: "cnbc", label: "달러/유로", symbol: "EUR=" },
  usdcny: { source: "cnbc", label: "위안/달러", symbol: "CNY=" },
  usdvnd: { source: "cnbc", label: "베트남 동/달러", symbol: "VND=" },
  usdinr: { source: "cnbc", label: "인도 루피/달러", symbol: "INR=" },
  usdidr: { source: "cnbc", label: "인도네시아 루피아/달러", symbol: "IDR=" },
  usdmyr: { source: "cnbc", label: "말레이시아 링깃/달러", symbol: "MYR=" },
  usdtry: { source: "cnbc", label: "튀르키예 리라/달러", symbol: "TRY=" },
  usdbrl: { source: "cnbc", label: "브라질 헤알/달러", symbol: "BRL=" },
  usdrub: { source: "cnbc", label: "러시아 루블/달러", symbol: "RUB=" },

  // ── 한국은행 기준금리 (722Y001) ──
  // 월별 계열은 당월이 끝나야 채워져서, 금리를 인상한 날 카드가 한 달 내내 옛 값을
  // 보여주게 된다. 그래서 화면에는 일별을 쓰고 월별 정의는 참고용으로만 남겨 둔다.
  baseRateMonthly: {
    source: "ecos", label: "한국은행 기준금리(월)",
    statCode: "722Y001", cycle: "M", itemCode1: "0101000", start: ECOS_MONTHLY_START,
  },
  baseRate: {
    source: "ecos", label: "한국은행 기준금리(일)",
    statCode: "722Y001", cycle: "D", itemCode1: "0101000", start: ECOS_DAILY_START,
  },

  // ── 시장금리(일별) (817Y002) ──
  callRate: {
    source: "ecos", label: "콜금리(1일, 전체거래)",
    statCode: "817Y002", cycle: "D", itemCode1: "010101000", start: ECOS_DAILY_START,
  },
  cd91: {
    source: "ecos", label: "CD(91일)",
    statCode: "817Y002", cycle: "D", itemCode1: "010502000", start: ECOS_DAILY_START,
  },
  ktb3: {
    source: "ecos", label: "국고채(3년)",
    statCode: "817Y002", cycle: "D", itemCode1: "010200000", start: ECOS_DAILY_START,
  },
  ktb10: {
    source: "ecos", label: "국고채(10년)",
    statCode: "817Y002", cycle: "D", itemCode1: "010210000", start: ECOS_DAILY_START,
  },
  corpAA: {
    source: "ecos", label: "회사채(3년, AA-)",
    statCode: "817Y002", cycle: "D", itemCode1: "010300000", start: ECOS_DAILY_START,
  },

  // ── 주가지수 (802Y001 주식시장(일)) ──
  kospi: {
    source: "ecos", label: "KOSPI지수",
    statCode: "802Y001", cycle: "D", itemCode1: "0001000", start: ECOS_DAILY_START,
  },
  kosdaq: {
    source: "ecos", label: "KOSDAQ지수",
    // 코스닥 일별 자료는 2003년부터라, 그 이전을 조회해 봐야 빈 요청만 늘어난다.
    statCode: "802Y001", cycle: "D", itemCode1: "0089000", start: "20030101",
  },

  // ── 해외 (FRED) ──
  ust10: { source: "fred", label: "미국 국채 10년물", seriesId: "DGS10", start: FRED_START },
  fedFunds: {
    source: "fred", label: "미국 연방기금금리(실효)", seriesId: "DFF", start: FRED_START,
  },
  ecbDeposit: {
    source: "fred", label: "ECB 예금금리", seriesId: "ECBDFR", start: FRED_START,
  },
  // FRED 의 S&P 500 은 라이선스 때문에 최근 10년치만 제공된다.
  sp500: { source: "fred", label: "S&P 500", seriesId: "SP500", start: FRED_START },
  // WTI 현물(쿠싱). 주간 모니터링의 원자재 항목에 쓴다 — EIA 집계라 며칠 늦게 올라온다.
  wti: { source: "fred", label: "WTI", seriesId: "DCOILWTICO", start: FRED_START },
} as const satisfies Record<string, SeriesDef>;

export type SeriesId = keyof typeof SERIES;

/**
 * 계열 색.
 * dataviz 검증 스크립트로 색각 이상 판별 가능 여부를 확인한 조합만 쓴다.
 * 참고 화면은 초록·주황을 같이 썼지만 그 쌍은 적록색약에서 사실상 구분되지 않아
 * (ΔE 3.2) 초록 대신 보라를 쓴다.
 */
export const COLOR = {
  blue: "#2a78d6",
  orange: "#eb6834",
  violet: "#4a3aa7",
  red: "#e34948",
} as const;

// ───────────────────────── 종합지표 카드 ─────────────────────────

export type CardSpec = {
  id: string;
  label: string;
  seriesId: SeriesId;
  /** 스파크라인을 다른 계열로 그릴 때 (월별 카드 + 일별 추세선) */
  sparkSeriesId?: SeriesId;
  unit: string;
  digits: number;
  changeStyle: ChangeStyle;
  period: "day" | "month";
  /**
   * 직전 관측치 대신 n 개월 전 값과 비교한다.
   * 정책금리처럼 값이 며칠씩 그대로인 계열에 필요하다.
   */
  compareMonthsBack?: number;
  sparkMonths: number;
  /** 계단 함수인 계열은 스파크라인도 계단으로 */
  stepSpark?: boolean;
};

export const CARDS: CardSpec[] = [
  {
    id: "baseRate", label: "한국은행 기준금리",
    seriesId: "baseRate",
    unit: "%", digits: 2, changeStyle: "pp", period: "day",
    compareMonthsBack: 1, sparkMonths: 24, stepSpark: true,
  },
  { id: "ktb3", label: "국고채 3년", seriesId: "ktb3", unit: "%", digits: 2, changeStyle: "bp", period: "day", sparkMonths: 3 },
  { id: "ktb10", label: "국고채 10년", seriesId: "ktb10", unit: "%", digits: 2, changeStyle: "bp", period: "day", sparkMonths: 3 },
  { id: "ust10", label: "미국 10년물", seriesId: "ust10", unit: "%", digits: 2, changeStyle: "bp", period: "day", sparkMonths: 3 },
  { id: "usdkrw", label: "원/달러", seriesId: "usdkrw", unit: "원", digits: 1, changeStyle: "pct", period: "day", sparkMonths: 3 },
  { id: "jpykrw", label: "원/엔(100엔)", seriesId: "jpykrw", unit: "원", digits: 1, changeStyle: "pct", period: "day", sparkMonths: 3 },
  { id: "kospi", label: "KOSPI", seriesId: "kospi", unit: "", digits: 2, changeStyle: "pct", period: "day", sparkMonths: 3 },
  { id: "kosdaq", label: "KOSDAQ", seriesId: "kosdaq", unit: "", digits: 2, changeStyle: "pct", period: "day", sparkMonths: 3 },
  { id: "sp500", label: "S&P 500", seriesId: "sp500", unit: "", digits: 2, changeStyle: "pct", period: "day", sparkMonths: 3 },
];

// ───────────────────────── 차트 ─────────────────────────

export type TabId = "overview" | "rates" | "fx" | "weekly" | "consumption";

/** 차트를 두는 탭. 종합지표는 카드, 주간 모니터링은 뉴스 요약이라 차트가 없다. */
export type ChartTabId = Extract<TabId, "rates" | "fx">;

export type ChartSeries = {
  /** 계열 id — 이 카탈로그의 SERIES 키이거나, 소비동향처럼 따로 받는 자료의 키 */
  seriesId: string;
  label: string;
  color: string;
  /** 계단 함수인 계열 (정책금리) */
  step?: boolean;
};

/** SeriesChart 가 그리는 차트 한 장. 카탈로그 밖(국내 소비동향)에서도 만든다. */
export type ChartSpec = {
  id: string;
  tab: TabId;
  title: string;
  /** y축 라벨 */
  unit: string;
  /** 값 표기 소수점 */
  digits: number;
  /** 관측 주기 표기 (차트 머리글). 없으면 "일별" */
  cadence?: string;
  /** 처음 보여줄 구간. 없으면 1Y */
  defaultRange?: RangeKey;
  /** x축 날짜 표기. 없으면 구간에 따라 "8.21" · "Oct 2025" · "2026" */
  axisDate?: "yy.m.d";
  /** 증감률 차트처럼 0선을 그을지 */
  zeroLine?: boolean;
  /** 툴팁 값 뒤에 붙일 글자 ("%" 등) */
  valueSuffix?: string;
  series: ChartSeries[];
  sources: string[];
};

/** 이 카탈로그의 차트 — 계열은 SERIES 에 있는 것만 가리킨다 */
export type CatalogChart = Omit<ChartSpec, "tab" | "series"> & {
  tab: ChartTabId;
  series: Array<ChartSeries & { seriesId: SeriesId }>;
};

/**
 * 환율 차트 한 장 — 모두 CNBC 시세 한 계열 (사용자 지시, 2026-11-16).
 * 제목은 "국가 통화 (통화/달러)" 로 통일, 기본 2Y 구간, x축 yy.m.d. 3Y 까지 일별이고 5Y·10Y·전체는 3년 전부터 주별 봉.
 */
function fxChart(id: SeriesId, title: string, unit: string, digits: number): CatalogChart {
  const def: SeriesDef = SERIES[id];
  return {
    id, tab: "fx", title, unit, digits,
    cadence: "일별 종가 · 3년 전부터는 주별 · 오늘은 실시간",
    defaultRange: "2Y",
    axisDate: "yy.m.d",
    series: [{ seriesId: id, label: def.source === "cnbc" ? `CNBC ${def.symbol}` : def.label, color: COLOR.blue }],
    sources: ["CNBC"],
  };
}

export const CHARTS: CatalogChart[] = [
  {
    id: "policyRates", tab: "rates", title: "정책금리: 한·미·유로",
    unit: "%", digits: 2,
    series: [
      { seriesId: "ecbDeposit", label: "EA20", color: COLOR.violet, step: true },
      { seriesId: "fedFunds", label: "USA", color: COLOR.blue, step: true },
      { seriesId: "baseRate", label: "KOR", color: COLOR.red, step: true },
    ],
    sources: ["한국은행", "FRED"],
  },
  {
    id: "shortRates", tab: "rates", title: "한국 단기금리",
    unit: "%", digits: 2,
    series: [
      { seriesId: "cd91", label: "CD(91일)", color: COLOR.violet },
      { seriesId: "callRate", label: "콜금리(1일)", color: COLOR.orange },
      { seriesId: "baseRate", label: "기준금리", color: COLOR.blue, step: true },
    ],
    sources: ["한국은행"],
  },
  {
    id: "bondRates", tab: "rates", title: "한국 채권금리",
    unit: "%", digits: 2,
    series: [
      { seriesId: "corpAA", label: "회사채 AA-", color: COLOR.violet },
      { seriesId: "ktb10", label: "국고채 10년", color: COLOR.orange },
      { seriesId: "ktb3", label: "국고채 3년", color: COLOR.blue },
    ],
    sources: ["한국은행"],
  },
  // ── 환율 (CNBC 시세) — 제목은 "국가 통화 (통화/달러)" ──
  fxChart("usdkrw", "한국 원 (원/달러)", "원", 1),
  fxChart("usdjpy", "일본 엔 (엔/달러)", "엔", 2),
  fxChart("dxy", "달러인덱스 (DXY)", "", 2),
  fxChart("eurusd", "유로 (달러/유로)", "달러", 4),
  fxChart("usdcny", "중국 위안 (위안/달러)", "위안", 4),
  fxChart("usdvnd", "베트남 동 (동/달러)", "동", 0),
  fxChart("usdinr", "인도 루피 (루피/달러)", "루피", 2),
  fxChart("usdidr", "인도네시아 루피아 (루피아/달러)", "루피아", 0),
  fxChart("usdmyr", "말레이시아 링깃 (링깃/달러)", "링깃", 3),
  fxChart("usdtry", "튀르키예 리라 (리라/달러)", "리라", 2),
  fxChart("usdbrl", "브라질 헤알 (헤알/달러)", "헤알", 3),
  fxChart("usdrub", "러시아 루블 (루블/달러)", "루블", 2),
];

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "0. 종합 지표" },
  { id: "rates", label: "1. 금리" },
  { id: "fx", label: "2. 환율" },
  { id: "weekly", label: "3. 주간 모니터링" },
  { id: "consumption", label: "4. 국내 소비동향" },
];

/** 화면에 실제로 쓰이는 계열만 조회한다. */
export const USED_SERIES_IDS: SeriesId[] = [
  ...new Set<SeriesId>([
    ...CARDS.flatMap((card) => [card.seriesId, ...(card.sparkSeriesId ? [card.sparkSeriesId] : [])]),
    ...CHARTS.flatMap((chart) => chart.series.map((s) => s.seriesId)),
  ]),
];
