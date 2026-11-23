import type { Point, SourceStatus } from "@/lib/types";

/*
 * "4. 국내 소비동향" 탭의 정의와 타입 — 조회는 lib/consumption.ts.
 *  주간: 국가데이터처 나우캐스트(data.kostat.go.kr/nowcast)의 속보성 지표. 값은 전년동기대비(52주 전 같은 주 대비) 증감률 %.
 *  월간: 국가데이터처 산업활동동향의 소매판매액지수·서비스업생산지수(경상, 2020=100) — 한국은행 ECOS 에 실린 표로 받는다.
 */

export type ConsumptionGroupId = "card" | "merchant";

export type ConsumptionGroup = {
  label: string;
  /** 나우캐스트 지표 id (selectIndcrTitle.do 로 확인: 1 신용카드이용금액 · 6 가맹점 카드매출액) */
  indcrId: number;
  /** 포털 화면의 initId (지표 페이지 번호) */
  initId: number;
  /** 업종 분류 공통코드 그룹 (listCmnCd.do) — 두 지표 모두 7개 업종 그룹 A00029 */
  clsCode: string;
  /** 그릴 업종 코드 — INDUSTRY_ORDER 순서 */
  industries: string[];
  provider: string;
};

/**
 * 나우캐스트 업종 분류 — 두 지표 모두 7개 업종으로 통일하고, 표·차트 순서도 이 배열 순서다(사용자 지시, 2026-11-16).
 * 코드와 이름은 포털 공통코드 A00029(listCmnCd.do) 그대로 — 국가데이터처 표기와 맞춘다. 10개 그룹(A00027)에만 있는
 * 운송·제조업·부동산은 쓰지 않는다.
 *
 * 배열로 두는 이유: 객체 키로 두고 Object.keys 로 순서를 뽑으면 "10"·"111"·"112" 같은 정수 꼴 키가 늘 앞으로 정렬된다.
 */
export const INDUSTRIES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "01", label: "식료품 및 음료(주류/담배 포함)" },
  { code: "111", label: "음식 및 음료서비스" },
  { code: "03", label: "의류 및 신발" },
  { code: "09", label: "오락 스포츠 및 문화" },
  { code: "112", label: "숙박 서비스" },
  { code: "06", label: "보건" },
  { code: "10", label: "교육서비스" },
];

/** 표시 순서의 업종 코드 */
export const INDUSTRY_ORDER: string[] = INDUSTRIES.map((item) => item.code);

/** 코드 → 이름 (순서 용도로는 INDUSTRY_ORDER 를 쓴다) */
export const INDUSTRY_LABELS: Record<string, string> = Object.fromEntries(
  INDUSTRIES.map((item) => [item.code, item.label])
);

/** 7개 업종 공통코드 그룹 */
export const INDUSTRY_CLS_CODE = "A00029";
/**
 * 같은 업종 코드가 든 10개 업종 그룹. 2026-11-16 실제 조회에서 두 지표 모두 A00029 로 7개 업종이 다 왔다 —
 * 그래도 포털이 그룹 배정을 바꿀 수 있으니 로더(lib/consumption.ts)는 A00029 로 업종이 모두 비어 오면 이 그룹으로 한 번 더 시도한다.
 * 가맹점 카드매출액의 오락 스포츠 및 문화(09)는 주간이 아니라 월간(월말 기준일)으로 온다.
 */
export const ALTERNATE_CLS_CODE = "A00027";

export const CONSUMPTION_GROUPS: Record<ConsumptionGroupId, ConsumptionGroup> = {
  card: {
    label: "신용카드 이용금액",
    indcrId: 1,
    initId: 1,
    clsCode: INDUSTRY_CLS_CODE,
    industries: INDUSTRY_ORDER,
    provider: "신한카드",
  },
  merchant: {
    label: "가맹점 카드매출액",
    indcrId: 6,
    initId: 6,
    clsCode: INDUSTRY_CLS_CODE,
    industries: INDUSTRY_ORDER,
    provider: "신한카드 · 한국정보통신",
  },
};

export const CONSUMPTION_GROUP_IDS: ConsumptionGroupId[] = ["card", "merchant"];

/** 계열 id — "card:total" · "card:111" · "merchant:01" */
export function consumptionSeriesId(group: ConsumptionGroupId, code: string | "total" = "total"): string {
  return `${group}:${code}`;
}

// ───────────────────────── 월간 — 소매판매액지수 · 서비스업생산지수 (ECOS) ─────────────────────────

export type MonthlyGroupId = "retail" | "service";

export type MonthlyItem = {
  /** ECOS 통계항목코드1 */
  code: string;
  /** 국가데이터처(통계청) 표기 그대로 — 사용자 지시(2026-11-16) */
  label: string;
};

export type MonthlyGroup = {
  label: string;
  /** ECOS 통계표 코드 */
  statCode: string;
  /** 통계항목코드2 — 경상(명목)지수 */
  itemCode2: string;
  /** 조회 시작(YYYYMM) — 항목이 모두 있는 시점부터 */
  start: string;
  items: MonthlyItem[];
  /** 차트 각주의 출처 표기 */
  source: string;
};

/**
 * 월간 지표 — 국가데이터처 산업활동동향의 소매판매액지수·서비스업생산지수. 둘 다 2020=100 의 경상(명목) 지수.
 * KOSIS 대신 한국은행 ECOS 에 실린 같은 표를 이미 쓰는 ECOS_API_KEY 로 받는다. 코드는 StatisticItemList 로 확인(2026-11-16):
 *   901Y100 재별 및 상품군별 판매액지수 — 항목2 T1 경상 · T2 불변 · T3 계절조정. 상품군은 2005년부터.
 *   901Y038 산업별 서비스업생산지수 — 항목2 1 경상 · 2 불변 · 3 계절조정. 2000년부터.
 * 소매판매액지수에는 "의류 및 신발" 한 항목이 없다 — 의복(G21)과 신발 및 가방(G22)으로 나뉘어 있어 둘 다 그린다.
 */
export const MONTHLY_GROUPS: Record<MonthlyGroupId, MonthlyGroup> = {
  retail: {
    label: "소매판매액지수(경상지수)",
    statCode: "901Y100",
    itemCode2: "T1",
    start: "200501",
    items: [
      { code: "G0", label: "총지수" },
      { code: "G31", label: "음식료품" },
      { code: "G33", label: "화장품" },
      { code: "G21", label: "의복" },
      { code: "G22", label: "신발 및 가방" },
    ],
    source: "국가데이터처 산업활동동향 · ECOS 901Y100",
  },
  service: {
    label: "서비스업생산지수(경상지수)",
    statCode: "901Y038",
    itemCode2: "1",
    start: "200001",
    items: [
      { code: "I51ADB", label: "음식점 및 주점업" },
      { code: "I51AL", label: "예술, 스포츠 및 여가관련 서비스업" },
      { code: "I51ADA", label: "숙박업" },
    ],
    source: "국가데이터처 산업활동동향 · ECOS 901Y038",
  },
};

export const MONTHLY_GROUP_IDS: MonthlyGroupId[] = ["retail", "service"];

/**
 * 월간 차트 배치 — 표는 지표별로 묶지만 차트는 주제별로 세로로 쌓는다(사용자 지시, 2026-11-16: 음식료품 아래 음식점 및 주점업).
 * 바깥 배열의 원소 하나가 한 기둥이고, 기둥 안은 위에서 아래 순서다. 화면이 2열이든 3열이든 기둥 안의 위아래는 유지된다.
 *   식품: 총지수 → 음식료품 → 음식점 및 주점업 · 화장품·의류: 화장품 → 의복 → 신발 및 가방 · 여가·숙박: 예술, 스포츠 및 여가관련 서비스업 → 숙박업
 * (화장품은 음식점 및 주점업과 의복 사이 — 사용자 지시, 2026-11-16)
 */
export const MONTHLY_CHART_STACKS: ReadonlyArray<ReadonlyArray<readonly [MonthlyGroupId, string]>> = [
  [["retail", "G0"], ["retail", "G31"], ["service", "I51ADB"]],
  [["retail", "G33"], ["retail", "G21"], ["retail", "G22"]],
  [["service", "I51AL"], ["service", "I51ADA"]],
];

/** 월간 계열 id — "m:retail:G0". 주간 id("card:111")와 구분되게 "m:" 으로 시작한다 */
export function monthlySeriesId(group: MonthlyGroupId, code: string): string {
  return `m:${group}:${code}`;
}

/** 지수에서 전년동월대비 증감률(%)을 만든다. 12개월 전 같은 달이 없는 달은 뺀다. 날짜는 그 달 1일. */
export function yoySeries(points: Point[]): Point[] {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: Point[] = [];
  for (const p of points) {
    const previous = byDate.get(`${Number(p.date.slice(0, 4)) - 1}${p.date.slice(4)}`);
    if (previous === undefined || previous === 0) continue;
    out.push({ date: p.date, value: Number(((p.value / previous - 1) * 100).toFixed(1)) });
  }
  return out;
}

export type ConsumptionData = {
  /** 계열 id → 주간 점. date 는 그 주의 기준일(KST, 금요일), value 는 전년동기대비 % */
  series: Record<string, Point[]>;
  /** 계열별 조회 결과 — 실패 사유는 화면 상단 안내로 */
  status: SourceStatus[];
  /** 서버가 포털에서 받아온 시각(ISO) */
  fetchedAt: string;
  /** 주간 지표의 가장 최근 주 기준일 */
  latestWeek: string | null;
  /** 월간 지표의 가장 최근 달(그 달 1일) */
  latestMonth: string | null;
  /** 이번 응답이 이전에 받아 둔 자료를 그대로 쓴 것이면 그 사유 */
  stale?: string;
};
