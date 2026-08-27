/** 하나의 시계열 점. date 는 "YYYY-MM-DD" (월별 자료도 그 달 1일로 정규화). */
export type Point = {
  date: string;
  value: number;
};

/** 여러 시계열을 날짜 기준으로 합친 차트용 행. t 는 epoch ms. */
export type MergedRow = {
  t: number;
  date: string;
  [seriesKey: string]: number | string | null;
};

/** 지표별 원본 시계열 모음. 키는 lib/catalog.ts 의 SeriesId. */
export type SeriesMap = Record<string, Point[]>;

export type SourceStatus = {
  key: string;
  label: string;
  ok: boolean;
  message?: string;
  count: number;
};

/** 서버가 내려주는 대시보드 데이터 한 벌. */
export type DashboardData = {
  series: SeriesMap;
  status: SourceStatus[];
  /** 서버가 데이터를 조회한 시각 (ISO) */
  fetchedAt: string;
};

/** 변화량 표기 방식. 지표 성격에 따라 다르다. */
export type ChangeStyle =
  /** 금리: "−1bp" */
  | "bp"
  /** 정책금리: "+0.25%p(전월대비)" */
  | "pp"
  /** 환율·지수: "−3.0 (−0.22%)" */
  | "pct";

/** 요약 카드 한 장에 필요한 값. */
export type IndicatorSummary = {
  id: string;
  label: string;
  unit: string;
  value: number;
  /** 직전 관측치 대비 변화량 (원계열 단위) */
  change: number;
  /** 직전 관측치 대비 변화율 (%) */
  changePct: number;
  /** 최신 관측일 */
  asOf: string;
  /** 관측 주기 — 날짜 표기를 "2026.8.25" 로 할지 "2026.7월" 로 할지 결정 */
  period: "day" | "month";
  digits: number;
  changeStyle: ChangeStyle;
  /** 스파크라인용 최근 구간 */
  spark: Point[];
  /** 스파크라인을 계단식으로 그릴지 (정책금리처럼 계단 함수인 계열) */
  stepSpark: boolean;
};
