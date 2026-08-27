"use client";

type Props = {
  checkedAt: number | null;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
};

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 자동 갱신 상태 표시.
 * 서버에서는 아직 확인 시각이 없으므로 아무것도 그리지 않는다 (하이드레이션 불일치 방지).
 */
export function LiveStatus({ checkedAt, refreshing, error, onRefresh }: Props) {
  const dotColor = error ? "var(--up)" : refreshing ? "var(--muted)" : "#22a06b";

  return (
    <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${refreshing ? "animate-pulse" : ""}`}
        style={{ background: dotColor }}
      />
      <span className="tabular">
        {error
          ? `갱신 실패 — ${error}`
          : checkedAt
            ? `자동 갱신 중 · 마지막 확인 ${formatClock(checkedAt)}`
            : "자동 갱신 중"}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="rounded-md px-2 py-0.5 text-ink-2 transition-colors hover:bg-[#e7e7e7] disabled:opacity-40"
      >
        새로고침
      </button>
    </div>
  );
}
