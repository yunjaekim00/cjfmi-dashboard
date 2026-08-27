/**
 * 통계 API 는 결측치를 빈 문자열이나 "." 로 내려준다.
 * Number("") 가 0 이라 그대로 넘기면 차트에 0 스파이크가 생긴다.
 */
export function toFiniteNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;

  const trimmed = raw.trim();
  if (!trimmed || trimmed === "." || trimmed === "-") return null;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
