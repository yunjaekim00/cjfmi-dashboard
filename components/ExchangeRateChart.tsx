"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { RangeTabs } from "@/components/RangeTabs";
import {
  formatDayTick,
  formatKoreanDate,
  formatMonthTick,
  formatNumber,
  formatShortDate,
  formatYearTick,
} from "@/lib/format";
import {
  buildTimeTicks,
  mergeSeries,
  niceScale,
  rangeStartMs,
  type RangeKey,
} from "@/lib/series";
import type { ExchangeRateData, MergedRow } from "@/lib/types";

const SERIES = [
  { key: "fred", label: "뉴욕 종가(FRED)", color: "var(--series-2)", source: "FRED DEXKOUS" },
  { key: "bok", label: "매매기준율(한국은행)", color: "var(--series-1)", source: "한국은행「환율」" },
] as const;

/** 화면 폭보다 촘촘한 점은 눈에 보이지 않으므로 렌더 전에 솎아낸다. */
const MAX_POINTS = 1400;

function decimate(rows: MergedRow[]): MergedRow[] {
  if (rows.length <= MAX_POINTS) return rows;

  const stride = Math.ceil(rows.length / MAX_POINTS);
  const sampled = rows.filter((_, i) => i % stride === 0);
  const last = rows[rows.length - 1];

  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

export function ExchangeRateChart({ data }: { data: ExchangeRateData }) {
  const [range, setRange] = useState<RangeKey>("1Y");

  const merged = useMemo(
    () => mergeSeries({ bok: data.bok, fred: data.fred }),
    [data.bok, data.fred]
  );

  // 데이터가 비었을 땐 서버가 조회한 시각을 기준으로 삼는다 (렌더는 순수해야 하므로 Date.now 금지).
  const latestMs = merged.length ? merged[merged.length - 1].t : Date.parse(data.fetchedAt);
  const earliestMs = merged.length ? merged[0].t : latestMs;

  const view = useMemo(() => {
    const startMs = Math.max(rangeStartMs(latestMs, range), earliestMs);
    const rows = merged.filter((row) => row.t >= startMs);
    const values = rows.flatMap((row) =>
      SERIES.map((s) => row[s.key]).filter((v): v is number => typeof v === "number")
    );

    return { rows: decimate(rows), startMs, scale: niceScale(values) };
  }, [merged, latestMs, earliestMs, range]);

  const { ticks, unit } = useMemo(
    () => buildTimeTicks(view.startMs, latestMs),
    [view.startMs, latestMs]
  );

  const latestDate = merged.length ? merged[merged.length - 1].date : null;

  // 키가 없어 못 받아온 소스는 선도 범례도 그리지 않는다.
  const activeSeries = SERIES.filter((series) =>
    view.rows.some((row) => typeof row[series.key] === "number")
  );

  // 표시할 데이터가 실제로 있는 구간만 활성화한다.
  const isAvailable = (candidate: RangeKey) =>
    candidate === "전체" || rangeStartMs(latestMs, candidate) >= earliestMs - 86_400_000;

  return (
    <section className="rounded-2xl border border-line bg-card px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-ink">원/달러 환율</h2>
          <p className="tabular mt-1.5 text-[12px] text-muted">
            일별 · 최신: {latestDate ? formatKoreanDate(latestDate) : "—"}
          </p>
        </div>
        <RangeTabs value={range} onChange={setRange} available={isAvailable} />
      </header>

      <div className="relative mt-5 h-[380px] w-full">
        <span className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 -rotate-90 text-[11px] text-muted">
          원
        </span>

        {view.rows.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={view.rows} margin={{ top: 6, right: 12, bottom: 4, left: 16 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />

              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[view.startMs, latestMs]}
                ticks={ticks}
                tickFormatter={
                  unit === "day" ? formatDayTick : unit === "month" ? formatMonthTick : formatYearTick
                }
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickMargin={10}
                axisLine={{ stroke: "var(--grid)" }}
                tickLine={false}
              />

              <YAxis
                domain={view.scale.domain}
                ticks={view.scale.ticks}
                width={44}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickFormatter={(value: number) => String(Math.round(value))}
                tickMargin={6}
                axisLine={false}
                tickLine={false}
              />

              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "#c4c4c4", strokeWidth: 1 }}
                isAnimationActive={false}
              />

              {activeSeries.map((series) => (
                <Line
                  key={series.key}
                  type="linear"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.color}
                  strokeWidth={1.6}
                  dot={false}
                  activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)" }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">
            표시할 데이터가 없습니다.
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {activeSeries.map((series) => (
          <span key={series.key} className="flex items-center gap-2 text-[12px] text-ink-2">
            <span
              aria-hidden
              className="inline-block h-[2px] w-5 rounded-full"
              style={{ background: series.color }}
            />
            {series.label}
          </span>
        ))}
      </div>

      {activeSeries.length ? (
        <p className="mt-4 text-[11px] text-muted">
          자료: {activeSeries.map((series) => series.source).join(" · ")} (
          {formatShortDate(data.fetchedAt.slice(0, 10))} 접속)
        </p>
      ) : null}
    </section>
  );
}

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | null }>;
  label?: number;
};

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length || typeof label !== "number") return null;

  const date = new Date(label).toISOString().slice(0, 10);

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      <div className="tabular text-[11px] text-muted">{formatKoreanDate(date)}</div>
      <div className="mt-1.5 space-y-1">
        {SERIES.map((series) => {
          const entry = payload.find((item) => item.dataKey === series.key);
          if (typeof entry?.value !== "number") return null;

          return (
            <div key={series.key} className="flex items-center gap-2 text-[12px]">
              <span
                aria-hidden
                className="inline-block h-[2px] w-3.5 rounded-full"
                style={{ background: series.color }}
              />
              <span className="text-ink-2">{series.label}</span>
              <span className="tabular ml-auto font-semibold text-ink">
                {formatNumber(entry.value, 1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
