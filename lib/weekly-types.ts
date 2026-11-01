/**
 * "3. 주간 모니터링" 탭이 다루는 데이터 모양.
 * 서버(lib/weekly.ts)가 만들고 브라우저(components/WeeklyMonitor.tsx)가 그리므로
 * 양쪽에서 import 할 수 있도록 순수 타입만 둔다.
 */

/** 시장반응 분야. 화면 순서는 모델이 정한다 — 그 주의 주도 요인을 앞에 둔다. */
export const REACTION_CATEGORIES = ["주가", "금리", "외환", "원자재"] as const;
export type ReactionCategory = (typeof REACTION_CATEGORIES)[number];

/** 모델에 넘겨 준 지표 주간 변동. 화면 아래 각주로도 보여준다. */
export type WeeklyIndicator = {
  id: string;
  label: string;
  unit: string;
  digits: number;
  /** 직전 주 변동 표기 방식 — 금리는 bp, 나머지는 절대값+% */
  changeStyle: "bp" | "pct";
  latest: { date: string; value: number };
  /** 한 주 전(대상 기간 시작일 이전 마지막 관측치). 자료가 짧으면 null. */
  weekAgo: { date: string; value: number } | null;
};

export type WeeklySource = {
  title: string;
  /** "Bloomberg", "국제금융센터" 처럼 매체명 */
  publisher: string;
  url: string;
  /** 기사 날짜 (YYYY-MM-DD). 모르면 null. */
  date: string | null;
};

/**
 * 주간 모니터링 한 벌.
 *
 * 문장 안의 `{{…}}` 는 파란 강조, `(…)` 는 작은 보충설명으로 그린다
 * (lib/emphasis.ts). 참고 보고서의 표기 관행을 그대로 옮긴 것이다.
 */
export type WeeklyBrief = {
  /** 모니터링 대상 기간 (YYYY-MM-DD, 양 끝 포함) */
  weekStart: string;
  weekEnd: string;
  /** 생성 시각 (ISO) */
  generatedAt: string;
  /** 생성에 쓴 모델 ID (Claude Code 가 만들었으면 "claude-code") */
  model: string;
  /**
   * 어디서 왔는지 — api: 서버가 Claude API 로 생성 · file: Claude Code 의 /weekly 스킬이 쓴
   * data/weekly-brief.json · sample: 참고 보고서 원문(레이아웃 확인용)
   */
  source: "api" | "file" | "sample";
  /** source 가 file 일 때 그 파일명 (예 "261102-weekly-brief.json") */
  file?: string;
  issue: {
    /** 가장 중요한 뉴스 — 불릿 없이 [주간이슈] 라벨 뒤에 바로 이어 쓴다 */
    headline: string;
    /** 두 번째·세 번째 뉴스 — 불릿으로 */
    points: string[];
  };
  reaction: {
    headline: string;
    items: Array<{ category: ReactionCategory; text: string }>;
  };
  sources: WeeklySource[];
  indicators: WeeklyIndicator[];
};
