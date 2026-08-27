/** 하나의 시계열 점. date 는 "YYYY-MM-DD". */
export type Point = {
  date: string;
  value: number;
};

/** 여러 소스를 날짜 기준으로 합친 차트용 행. t 는 epoch ms. */
export type MergedRow = {
  t: number;
  date: string;
  [seriesKey: string]: number | string | null;
};

export type SeriesMeta = {
  key: string;
  label: string;
  color: string;
  source: string;
};

/** 요약 카드 한 장에 필요한 값. */
export type IndicatorSummary = {
  id: string;
  label: string;
  unit: string;
  /** 최신 값 */
  value: number;
  /** 전일(전월) 대비 변화량 */
  change: number;
  /** 전일(전월) 대비 변화율 (%) */
  changePct: number;
  /** 최신 관측일 */
  asOf: string;
  /** 소수점 자릿수 */
  digits: number;
  /** 스파크라인용 최근 구간 */
  spark: Point[];
};

export type SourceStatus = {
  key: string;
  label: string;
  ok: boolean;
  message?: string;
  count: number;
};

export type ExchangeRateData = {
  /** 한국은행 매매기준율 (일별, 전체 구간) */
  bok: Point[];
  /** FRED 뉴욕 종가 (일별, 전체 구간) */
  fred: Point[];
  /** 데이터 소스별 수집 상태 */
  status: SourceStatus[];
  /** 서버가 데이터를 조회한 시각 (ISO) */
  fetchedAt: string;
};
