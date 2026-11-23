"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { RangeTabs } from "@/components/RangeTabs";
import { COLOR } from "@/lib/catalog";
import {
  changeColor,
  formatAxisNumber,
  formatKoreanMonth,
  formatNumber,
  formatShortDate,
  formatShortMonth,
  formatSigned,
} from "@/lib/format";
import { niceScale, rangeStartMs, toMs, type RangeKey } from "@/lib/series";
import type { Point } from "@/lib/types";

/*
 * 월별 지수 차트 — 지수(막대, 왼쪽 축)와 전년동월비(선, 오른쪽 축)를 한 그림에 그린다 (사용자 지시, 2026-11-16).
 * 막대는 0 에서 시작해야 높이를 비교할 수 있으므로 왼쪽 축은 0 부터다.
 * x축은 달을 범주로 쓴다(막대 폭이 달 간격에 맞게 나오도록). 눈금은 달 수에 따라 성글게 고른다.
 */

/** 월별 자료에 뜻이 있는 구간만 */
const RANGES: RangeKey[] = ["1Y", "2Y", "3Y", "5Y", "10Y", "전체"];
/** 지수 막대 — 연한 파랑 (선이 그 위로 지나가도 읽히게) */
const BAR = "#c3d6ef";
/** 전년동월비 선 */
const LINE = COLOR.orange;

type Row = { date: string; t: number; level: number; yoy: number | null };

type Props = {
  title: string;
  /** 지표 이름 등 제목 옆의 작은 글씨 */
  note?: string;
  /** 지수 (2020=100) */
  level: Point[];
  /** 전년동월비 % */
  yoy: Point[];
  fetchedAt: string;
  source: string;
  height?: number;
  defaultRange?: RangeKey;
};

export function MonthlyChart({ title, note, level, yoy, fetchedAt, source, height = 240, defaultRange = "3Y" }: Props) {
  const [range, setRange] = useState<RangeKey>(defaultRange);

  const rows = useMemo<Row[]>(() => {
    const yoyByDate = new Map(yoy.map((p) => [p.date, p.value]));
    return level.map((p) => ({ date: p.date, t: toMs(p.date), level: p.value, yoy: yoyByDate.get(p.date) ?? null }));
  }, [level, yoy]);

  // 데이터가 비었을 땐 서버가 조회한 시각을 기준으로 삼는다 (렌더는 순수해야 하므로 Date.now 금지).
  const latestMs = rows.length ? rows[rows.length - 1].t : Date.parse(fetchedAt);
  const earliestMs = rows.length ? rows[0].t : latestMs;

  const view = useMemo(() => {
    const startMs = Math.max(rangeStartMs(latestMs, range), earliestMs);
    const visible = rows.filter((row) => row.t >= startMs);
    const levels = visible.map((row) => row.level);
    const yoys = visible.flatMap((row) => (typeof row.yoy === "number" ? [row.yoy] : []));
    return {
      rows: visible,
      ticks: pickTicks(visible),
      left: fromZero(niceScale([0, ...levels])),
      // 증감률 축에는 0 이 꼭 들어가야 기준선이 보인다
      right: niceScale([...yoys, 0]),
    };
  }, [rows, latestMs, earliestMs, range]);

  const latest = rows.at(-1) ?? null;

  // 월별 자료에 뜻이 없는 짧은 구간은 끄고, 자료 시작보다 앞선 구간도 끈다 (한 달쯤 모자라는 건 봐준다).
  const isAvailable = (candidate: RangeKey) =>
    RANGES.includes(candidate) &&
    (candidate === "전체" || rangeStartMs(latestMs, candidate) >= earliestMs - 40 * 86_400_000);

  return (
    <section className="flex h-full flex-col rounded-2xl border border-line bg-card px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-[15px] font-bold text-ink">
            {title}
            {note ? <span className="ml-2 text-[12px] font-normal text-muted">{note}</span> : null}
          </h2>
          <p className="tabular mt-1.5 text-[12px] text-muted">
            월별 · 최신: {latest ? formatKoreanMonth(latest.date) : "—"}
            {latest ? ` · 지수 ${formatNumber(latest.level, 1)}` : ""}
            {latest && typeof latest.yoy === "number" ? (
              <>
                {" · 전년동월비 "}
                <span style={{ color: changeColor(latest.yoy) }}>{formatSigned(latest.yoy, 1)}%</span>
              </>
            ) : null}
          </p>
        </div>
        <RangeTabs value={range} onChange={setRange} available={isAvailable} />
      </header>

      <div className="relative mt-5 w-full" style={{ height }}>
        {view.rows.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={view.rows} margin={{ top: 6, right: 4, bottom: 4, left: 4 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />

              <XAxis
                dataKey="date"
                type="category"
                ticks={view.ticks.values}
                interval={0}
                tickFormatter={(date: string) => (view.ticks.yearly ? date.slice(0, 4) : formatShortMonth(date))}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickMargin={10}
                axisLine={{ stroke: "var(--grid)" }}
                tickLine={false}
              />

              {/* 왼쪽: 지수 (막대, 0 부터) */}
              <YAxis
                yAxisId="left"
                domain={view.left.domain}
                ticks={view.left.ticks}
                width={44}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickFormatter={(value: number) => formatAxisNumber(value, view.left.decimals)}
                tickMargin={6}
                axisLine={false}
                tickLine={false}
              />

              {/* 오른쪽: 전년동월비 % (선) */}
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={view.right.domain}
                ticks={view.right.ticks}
                width={44}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickFormatter={(value: number) => `${formatAxisNumber(value, view.right.decimals)}%`}
                tickMargin={6}
                axisLine={false}
                tickLine={false}
              />

              <ReferenceLine yAxisId="right" y={0} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={1} />

              <Tooltip content={<MonthlyTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} isAnimationActive={false} />

              <Bar yAxisId="left" dataKey="level" name="지수" fill={BAR} maxBarSize={22} isAnimationActive={false} />

              <Line
                yAxisId="right"
                type="linear"
                dataKey="yoy"
                name="전년동월비"
                stroke={LINE}
                strokeWidth={1.8}
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)" }}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">표시할 데이터가 없습니다.</div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-ink-2">
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-[2px]" style={{ background: BAR }} />
          지수 (2020=100, 왼쪽 축)
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-[2px] w-5 rounded-full" style={{ background: LINE }} />
          전년동월비 % (오른쪽 축)
        </span>
      </div>

      <p className="mt-auto pt-4 text-[11px] text-muted">
        자료: {source} ({formatShortDate(fetchedAt.slice(0, 10))} 접속)
      </p>
    </section>
  );
}

/** 막대 축은 0 에서 시작한다 — niceScale 이 0 아래로 둔 여백을 잘라낸다 */
function fromZero(scale: ReturnType<typeof niceScale>) {
  return { ...scale, domain: [0, scale.domain[1]] as [number, number], ticks: scale.ticks.filter((tick) => tick >= 0) };
}

/**
 * 범주형 x축의 눈금 — 달 수에 따라 매달 / 두 달 / 분기 / 반기 / 매년 1월 / 몇 년마다 1월.
 * 1년(13개월)은 홀수 달, 3년은 분기 첫 달, 10년은 매년 1월이 된다.
 */
function pickTicks(rows: Row[]): { values: string[]; yearly: boolean } {
  const n = rows.length;
  const stepMonths = n <= 8 ? 1 : n <= 16 ? 2 : n <= 40 ? 3 : n <= 80 ? 6 : n <= 150 ? 12 : n <= 300 ? 24 : 60;
  const values = rows
    .filter((row) => {
      const year = Number(row.date.slice(0, 4));
      const month = Number(row.date.slice(5, 7));
      if (stepMonths < 12) return (month - 1) % stepMonths === 0;
      return month === 1 && year % (stepMonths / 12) === 0;
    })
    .map((row) => row.date);
  return { values, yearly: stepMonths >= 12 };
}

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
};

function MonthlyTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      <div className="tabular text-[11px] text-muted">{formatKoreanMonth(row.date)}</div>
      <div className="mt-1.5 space-y-1 text-[12px]">
        <div className="flex items-center gap-4">
          <span className="text-ink-2">지수</span>
          <span className="tabular ml-auto font-semibold text-ink">{formatNumber(row.level, 1)}</span>
        </div>
        {typeof row.yoy === "number" ? (
          <div className="flex items-center gap-4">
            <span className="text-ink-2">전년동월비</span>
            <span className="tabular ml-auto font-semibold" style={{ color: changeColor(row.yoy) }}>
              {formatSigned(row.yoy, 1)}%
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
