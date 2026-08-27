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
import type { ChartSpec } from "@/lib/catalog";
import {
  formatAxisNumber,
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
import type { MergedRow, Point, SeriesMap } from "@/lib/types";

/**
 * 화면 폭보다 촘촘한 점은 눈에 보이지 않는다.
 * 서버가 이미 해상도를 낮춰 보내므로(lib/downsample.ts) 여기서 걸릴 일은 드물다.
 */
const MAX_POINTS = 3000;

function decimate(rows: MergedRow[]): MergedRow[] {
  if (rows.length <= MAX_POINTS) return rows;

  const stride = Math.ceil(rows.length / MAX_POINTS);
  const sampled = rows.filter((_, i) => i % stride === 0);
  const last = rows[rows.length - 1];

  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

type Props = {
  spec: ChartSpec;
  series: SeriesMap;
  fetchedAt: string;
  height?: number;
  defaultRange?: RangeKey;
};

export function SeriesChart({ spec, series, fetchedAt, height = 380, defaultRange = "1Y" }: Props) {
  const [range, setRange] = useState<RangeKey>(defaultRange);

  const merged = useMemo(() => {
    const input: Record<string, Point[]> = {};
    for (const entry of spec.series) input[entry.seriesId] = series[entry.seriesId] ?? [];
    return mergeSeries(input);
  }, [spec.series, series]);

  // 데이터가 비었을 땐 서버가 조회한 시각을 기준으로 삼는다 (렌더는 순수해야 하므로 Date.now 금지).
  const latestMs = merged.length ? merged[merged.length - 1].t : Date.parse(fetchedAt);
  const earliestMs = merged.length ? merged[0].t : latestMs;

  const view = useMemo(() => {
    const startMs = Math.max(rangeStartMs(latestMs, range), earliestMs);
    const rows = merged.filter((row) => row.t >= startMs);
    const values = rows.flatMap((row) =>
      spec.series.map((s) => row[s.seriesId]).filter((v): v is number => typeof v === "number")
    );

    return { rows: decimate(rows), startMs, scale: niceScale(values) };
  }, [merged, latestMs, earliestMs, range, spec.series]);

  const { ticks, unit } = useMemo(
    () => buildTimeTicks(view.startMs, latestMs),
    [view.startMs, latestMs]
  );

  const latestDate = merged.length ? merged[merged.length - 1].date : null;

  // 못 받아온 계열은 선도 범례도 그리지 않는다.
  const activeSeries = spec.series.filter((entry) =>
    view.rows.some((row) => typeof row[entry.seriesId] === "number")
  );

  // 표시할 데이터가 실제로 있는 구간만 활성화한다.
  const isAvailable = (candidate: RangeKey) =>
    candidate === "전체" || rangeStartMs(latestMs, candidate) >= earliestMs - 86_400_000;

  return (
    <section className="flex h-full flex-col rounded-2xl border border-line bg-card px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-[15px] font-bold text-ink">{spec.title}</h2>
          <p className="tabular mt-1.5 text-[12px] text-muted">
            일별 · 최신: {latestDate ? formatKoreanDate(latestDate) : "—"}
          </p>
        </div>
        <RangeTabs value={range} onChange={setRange} available={isAvailable} />
      </header>

      <div className="relative mt-5 w-full" style={{ height }}>
        <span className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 -rotate-90 text-[11px] text-muted">
          {spec.unit}
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
                tickFormatter={(value: number) => formatAxisNumber(value, view.scale.decimals)}
                tickMargin={6}
                axisLine={false}
                tickLine={false}
              />

              <Tooltip
                content={<ChartTooltip spec={spec} />}
                cursor={{ stroke: "#c4c4c4", strokeWidth: 1 }}
                isAnimationActive={false}
              />

              {activeSeries.map((entry) => (
                <Line
                  key={entry.seriesId}
                  type={entry.step ? "stepAfter" : "linear"}
                  dataKey={entry.seriesId}
                  name={entry.label}
                  stroke={entry.color}
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

      {/* 계열이 하나뿐이면 제목이 곧 범례라 범례 상자를 그리지 않는다. */}
      {activeSeries.length > 1 ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {activeSeries.map((entry) => (
            <span key={entry.seriesId} className="flex items-center gap-2 text-[12px] text-ink-2">
              <span
                aria-hidden
                className="inline-block h-[2px] w-5 rounded-full"
                style={{ background: entry.color }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-auto pt-4 text-[11px] text-muted">
        자료: {spec.sources.join("·")} ({formatShortDate(fetchedAt.slice(0, 10))} 접속)
      </p>
    </section>
  );
}

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | null }>;
  label?: number;
  spec: ChartSpec;
};

function ChartTooltip({ active, payload, label, spec }: TooltipProps) {
  if (!active || !payload?.length || typeof label !== "number") return null;

  const date = new Date(label).toISOString().slice(0, 10);

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      <div className="tabular text-[11px] text-muted">{formatKoreanDate(date)}</div>
      <div className="mt-1.5 space-y-1">
        {spec.series.map((entry) => {
          const found = payload.find((item) => item.dataKey === entry.seriesId);
          if (typeof found?.value !== "number") return null;

          return (
            <div key={entry.seriesId} className="flex items-center gap-3 text-[12px]">
              {spec.series.length > 1 ? (
                <span
                  aria-hidden
                  className="inline-block h-[2px] w-3.5 rounded-full"
                  style={{ background: entry.color }}
                />
              ) : null}
              <span className="text-ink-2">{entry.label}</span>
              <span className="tabular ml-auto font-semibold text-ink">
                {formatNumber(found.value, spec.digits)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
