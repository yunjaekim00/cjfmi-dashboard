import { Sparkline } from "@/components/Sparkline";
import { formatKoreanDate, formatNumber, formatSigned } from "@/lib/format";
import type { IndicatorSummary } from "@/lib/types";

/**
 * 종합지표 탭의 카드 한 장.
 * 상승은 빨강, 하락은 파랑 — 국내 금융 지표 표기 관행을 따른다.
 */
export function IndicatorCard({ indicator }: { indicator: IndicatorSummary }) {
  const { label, unit, value, change, changePct, asOf, digits, spark } = indicator;

  const rising = change > 0;
  const flat = change === 0;
  const color = flat ? "var(--muted)" : rising ? "var(--up)" : "var(--down)";

  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="text-[13px] font-semibold text-ink">{label}</div>

      <div className="mt-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 shrink-0">
          <div className="flex items-baseline gap-1">
            <span className="tabular text-[24px] leading-tight font-bold whitespace-nowrap text-ink">
              {formatNumber(value, digits)}
            </span>
            <span className="text-[12px] text-muted">{unit}</span>
          </div>

          <div className="tabular mt-0.5 text-[12px] font-medium whitespace-nowrap" style={{ color }}>
            {formatSigned(change, digits)} ({formatSigned(changePct, 2)}%)
          </div>

          <div className="tabular mt-0.5 text-[11px] text-muted">{formatKoreanDate(asOf)}</div>
        </div>

        <div className="mt-1 min-w-0 flex-1 overflow-hidden">
          <Sparkline points={spark} color={color} />
        </div>
      </div>
    </div>
  );
}
