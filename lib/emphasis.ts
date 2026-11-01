/**
 * 주간 모니터링 문장의 인라인 서식.
 *
 * 참고 보고서는 한 문장 안에서 주어·결과만 파랗게, 보충 수치는 괄호 안에 작게 쓴다.
 * 모델에는 파란 강조를 `{{…}}` 로 표시하게 하고, 괄호 `(…)` 는 그대로 쓰게 한 뒤
 * 여기서 조각으로 나눈다. 렌더링은 components/WeeklyMonitor.tsx 가 맡는다.
 */

export type SegmentTone =
  /** 본문 (검정, 굵게) */
  | "text"
  /** 강조 (파랑, 굵게) */
  | "blue"
  /** 보충설명 (검정, 작게, 보통 굵기) — 괄호 포함 */
  | "note";

export type Segment = { text: string; tone: SegmentTone };

const EMPHASIS = /\{\{([\s\S]*?)\}\}/g;

/** 괄호 묶음 — 중첩은 고려하지 않는다 (보고서에도 중첩 괄호는 없다). */
const PAREN = /\([^()]*\)/g;

/** 검정 본문 안의 `(…)` 만 작은 글씨로 떼어 낸다. */
function splitNotes(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PAREN)) {
    const start = match.index;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), tone: "text" });
    segments.push({ text: match[0], tone: "note" });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), tone: "text" });
  return segments;
}

/**
 * "{{WTI}}는 美 원유재고 급감(-860만배럴, 전주比)에 {{100달러 상회}}"
 *   → [blue "WTI"] [text "는 美 원유재고 급감"] [note "(-860만배럴, 전주比)"] [text "에 "] [blue "100달러 상회"]
 *
 * `{{…}}` 안쪽은 괄호가 있어도 통째로 파란 강조로 둔다.
 * 닫히지 않은 `{{` 는 서식 기호가 아니라 글자로 본다.
 */
export function parseEmphasis(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(EMPHASIS)) {
    const start = match.index;
    if (start > cursor) segments.push(...splitNotes(text.slice(cursor, start)));
    if (match[1]) segments.push({ text: match[1], tone: "blue" });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) segments.push(...splitNotes(text.slice(cursor)));
  return segments.filter((segment) => segment.text.length > 0);
}

/** 서식 기호를 뺀 순수 문장 (글자 수 확인·로그용). */
export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS, "$1");
}
