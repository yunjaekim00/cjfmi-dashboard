import type { ChangeStyle } from "@/lib/types";

/**
 * 대시보드가 다루는 모든 시계열의 정의.
 * 지표를 추가할 때는 여기 SERIES 에 한 줄 넣고, CARDS / CHARTS 에서 참조하면 된다.
 *
 * ECOS 통계표·항목 코드는 StatisticItemList API 로 실제 확인한 값이다.
 * (특히 회사채 AA- 는 010300000 이고, 010320000 은 BBB- 라 헷갈리기 쉽다.)
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
    };

export const SERIES = {
  // ── 환율 (한국은행 8.8.2.1 주요국 통화의 대원화환율) ──
  usdkrw: {
    source: "ecos", label: "원/달러 매매기준율",
    statCode: "731Y001", cycle: "D", itemCode1: "0000001", start: ECOS_DAILY_START,
  },
  jpykrw: {
    source: "ecos", label: "원/엔(100엔) 매매기준율",
    statCode: "731Y001", cycle: "D", itemCode1: "0000002", start: ECOS_DAILY_START,
  },

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

export type TabId = "overview" | "rates" | "fx";

export type ChartSpec = {
  id: string;
  tab: Exclude<TabId, "overview">;
  title: string;
  /** y축 라벨 */
  unit: string;
  /** 값 표기 소수점 */
  digits: number;
  series: Array<{
    seriesId: SeriesId;
    label: string;
    color: string;
    /** 계단 함수인 계열 (정책금리) */
    step?: boolean;
  }>;
  sources: string[];
};

export const CHARTS: ChartSpec[] = [
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
  {
    id: "usdkrw", tab: "fx", title: "원/달러 환율",
    unit: "원", digits: 1,
    series: [{ seriesId: "usdkrw", label: "매매기준율(한국은행)", color: COLOR.blue }],
    sources: ["한국은행「환율」"],
  },
  {
    id: "jpykrw", tab: "fx", title: "원/엔(100엔) 환율",
    unit: "원", digits: 1,
    series: [{ seriesId: "jpykrw", label: "매매기준율(한국은행)", color: COLOR.blue }],
    sources: ["한국은행「환율」"],
  },
];

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "0. 종합 지표" },
  { id: "rates", label: "1. 금리" },
  { id: "fx", label: "2. 환율" },
];

/** 화면에 실제로 쓰이는 계열만 조회한다. */
export const USED_SERIES_IDS: SeriesId[] = [
  ...new Set<SeriesId>([
    ...CARDS.flatMap((card) => [card.seriesId, ...(card.sparkSeriesId ? [card.sparkSeriesId] : [])]),
    ...CHARTS.flatMap((chart) => chart.series.map((s) => s.seriesId)),
  ]),
];
