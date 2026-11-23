import { Sparkline } from "@/components/Sparkline";
import { formatChange, formatNumber, formatPeriod } from "@/lib/format";
import type { ChangeStyle, Delta, IndicatorSummary } from "@/lib/types";

/**
 * 종합지표 탭의 카드 한 장. 값 아래에 전일대비·전월대비 증감을 한 줄씩 적는다.
 * 상승은 빨강, 하락은 파랑 — 국내 금융 지표 표기 관행을 따른다.
 */
export function IndicatorCard({ indicator }: { indicator: IndicatorSummary }) {
  const { label, unit, value, day, month, trend, asOf, period, digits, changeStyle, spark, stepSpark } =
    indicator;

  // 월별 계열이면 직전 관측치가 곧 전월이라 한 줄만 적는다.
  const rows: Array<{ name: string; delta: Delta | null }> =
    period === "month"
      ? [{ name: "전월대비", delta: day }]
      : [
          { name: "전일대비", delta: day },
          { name: "전월대비", delta: month },
        ];

  return (
    <div className="rounded-2xl border border-line bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="text-[13px] font-semibold text-ink">{label}</div>

      <div className="mt-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 shrink-0">
          <div className="flex items-baseline gap-1">
            <span className="tabular text-[24px] leading-tight font-bold whitespace-nowrap text-ink">
              {formatNumber(value, digits)}
            </span>
            {unit ? <span className="text-[12px] text-muted">{unit}</span> : null}
          </div>

          <dl className="tabular mt-0.5 grid grid-cols-[auto_auto] gap-x-1.5 text-[12px] font-medium whitespace-nowrap">
            {rows.map((row) => (
              <ChangeRow
                key={row.name}
                name={row.name}
                delta={row.delta}
                style={changeStyle}
                digits={digits}
                period={period}
              />
            ))}
          </dl>

          <div className="tabular mt-0.5 text-[11px] text-muted">{formatPeriod(asOf, period)}</div>
        </div>

        <div className="mt-1 min-w-0 flex-1 overflow-hidden">
          <Sparkline points={spark} color={changeColor(trend)} step={stepSpark} />
        </div>
      </div>
    </div>
  );
}

function changeColor(change: number): string {
  if (change === 0) return "var(--muted)";
  return change > 0 ? "var(--up)" : "var(--down)";
}

/** "전일대비  −3.0 (−0.22%)" 한 줄. 비교할 자료가 없으면 "-". 마우스를 올리면 비교한 날짜가 보인다. */
function ChangeRow({
  name,
  delta,
  style,
  digits,
  period,
}: {
  name: string;
  delta: Delta | null;
  style: ChangeStyle;
  digits: number;
  period: "day" | "month";
}) {
  return (
    <>
      <dt className="font-normal text-muted">{name}</dt>
      <dd
        style={{ color: delta ? changeColor(delta.change) : "var(--muted)" }}
        title={delta ? `${formatPeriod(delta.baseDate, period)} 대비` : "비교할 자료 없음"}
      >
        {delta ? formatChange(style, delta.change, delta.changePct, digits) : "-"}
      </dd>
    </>
  );
}
