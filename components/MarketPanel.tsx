"use client";

import {
  CHART_SPECS,
  FX_SPECS,
  annotationBelow,
  dateFraction,
  formatAxisValue,
  formatSignedPct,
  formatTickDate,
  formatValue,
  formatWeekChange,
  marketWindow,
  yScale,
  type ChartSpec,
  type MarketChart,
  type WeeklyMarket,
} from "@/lib/market-shared";

/*
 * "[ 주요국 금융시장 동향 ]" — 주간 모니터링 상자 아래 차트 6개(최근 1년)와 환율표.
 *
 * 참고 보고서의 Excel 차트를 SVG 로 옮겼다. 좌표는 보고서 이미지의 차트 한 칸(가로 610)을 기준으로 잡고
 * viewBox 로 칸 너비에 맞춰 늘인다 — 글자 크기도 같이 늘어나 어떤 너비에서도 보고서와 같은 비율이 된다.
 * 색·서체는 app/globals.css 의 .mk-* 규칙에 있다.
 */

const VW = 610;
const VH = 330;
/** 플롯 영역. 왼쪽은 y 눈금, 아래는 x 눈금 자리 */
const PLOT = { left: 128, right: 582, top: 42, bottom: 258 };
/** 마지막 날짜(기준일)의 x. 축은 보고서처럼 조금 더 오른쪽까지 이어진다. */
const LAST_X = 545;
const BAND_WIDTH = 6;
/** 최근치가 기준일보다 이보다 오래됐으면 날짜를 덧붙인다 (주말을 끼면 3일이 정상) */
const STALE_DAYS = 3;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

type ChartProps = {
  spec: ChartSpec;
  chart: MarketChart;
  market: WeeklyMarket;
  /** 첫 칸(S&P500)에만 "전주비" 글자와 사건 라벨을 쓴다 — 보고서와 같게 */
  first: boolean;
};

function MarketChartSvg({ spec, chart, market, first }: ChartProps) {
  const { asOf, windowStart, event } = market;
  const { ticks } = marketWindow(asOf);

  const x = (date: string) => PLOT.left + dateFraction(date, windowStart, asOf) * (LAST_X - PLOT.left);
  const scale = yScale(chart.points.map((p) => p.value));
  const y = (value: number) =>
    PLOT.bottom - ((value - scale.lo) / (scale.hi - scale.lo)) * (PLOT.bottom - PLOT.top);

  const path = chart.points
    .map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");

  const eventInWindow = event.date >= windowStart && event.date <= asOf;
  const eventX = x(event.date);

  // 최근치 표기 — 오른쪽 끝에 맞춰 쓰고, 마지막 30% 구간에서 선이 비운 쪽(위/아래)에 둔다 (보고서의 배치 방식)
  const { latest, weekAgo } = chart;
  const below = annotationBelow(chart.points, windowStart, asOf, scale.lo, scale.hi);
  const recentYs = chart.points
    .filter((p) => dateFraction(p.date, windowStart, asOf) >= 0.7)
    .map((p) => y(p.value));
  const lineTop = recentYs.length ? Math.min(...recentYs) : PLOT.bottom;
  const lineBottom = recentYs.length ? Math.max(...recentYs) : PLOT.top;
  // 값 글자(38) 아래 전주비 글자(26)가 30 간격으로 붙는다
  const valueBaseline = below
    ? Math.min(lineBottom + 46, PLOT.bottom - 34)
    : Math.max(lineTop - 48, PLOT.top + 30);
  const changeBaseline = valueBaseline + 30;

  let changeText = latest && weekAgo ? formatWeekChange(spec, latest, weekAgo) : "";
  if (latest && daysBetween(latest.date, asOf) > STALE_DAYS) {
    changeText = `${changeText ? `${changeText}, ` : ""}${formatTickDate(latest.date)}`;
  }

  return (
    <svg className="mk-chart" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`${spec.title} 최근 1년 추이`}>
      {/* 사건 표시 띠 */}
      {eventInWindow ? (
        <rect
          x={eventX - BAND_WIDTH / 2}
          y={PLOT.top - 12}
          width={BAND_WIDTH}
          height={PLOT.bottom - PLOT.top + 12}
          fill="var(--mk-band)"
        />
      ) : null}
      {eventInWindow && first ? (
        <g className="mk-400" fill="var(--mk-note)" fontSize={20}>
          <text x={eventX + BAND_WIDTH / 2 + 6} y={PLOT.top + 14}>
            {event.label}
          </text>
          <text x={eventX + BAND_WIDTH / 2 + 6} y={PLOT.top + 38}>
            {event.note}
          </text>
        </g>
      ) : null}

      {/* 단위 */}
      <text x={8} y={26} fontSize={21} fill="var(--mk-note)">
        {spec.unitLabel}
      </text>

      {/* y 눈금 — 축선은 없고 숫자만 */}
      <g fill="var(--mk-tick)" fontSize={26} textAnchor="end">
        {scale.ticks.map((tick) => (
          <text key={tick} x={92} y={y(tick) + 9}>
            {formatAxisValue(tick, scale.decimals)}
          </text>
        ))}
      </g>

      {/* x 축선과 눈금 */}
      <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} stroke="#000" strokeWidth={1.6} />
      <g fill="var(--mk-tick)" fontSize={26} textAnchor="middle">
        {ticks.map((tick) => (
          <text key={tick} x={x(tick)} y={PLOT.bottom + 42}>
            {formatTickDate(tick)}
          </text>
        ))}
      </g>

      {/* 선 */}
      {chart.points.length > 1 ? (
        <path d={path} fill="none" stroke="var(--mk-blue)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      ) : null}

      {/* 최근치와 전주비 */}
      {latest ? (
        <g fill="var(--mk-blue)" textAnchor="end">
          <text x={PLOT.right} y={valueBaseline} fontSize={38}>
            {formatValue(spec, latest.value)}
          </text>
          {changeText ? (
            <text x={PLOT.right} y={changeBaseline} fontSize={26}>
              ({first ? "전주比 " : ""}
              {changeText})
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}

function FxTable({ market }: { market: WeeklyMarket }) {
  const items = new Map(market.fx.items.map((item) => [item.id, item]));
  // 환율표의 기준일 — 한국은행 고시(08:30)가 있는 가장 늦은 날
  const asOf = market.fx.items
    .map((item) => item.latest?.date)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

  return (
    <table className="mk-fx">
      <colgroup>
        <col style={{ width: "19%" }} />
        {FX_SPECS.map((spec) => (
          <col key={spec.id} style={{ width: "13.5%" }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col">(+ 절상, − 절하)</th>
          {FX_SPECS.map((spec) => (
            <th key={spec.id} scope="col">
              {spec.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{asOf ? `${formatTickDate(asOf)}일(08:30 기준)` : "최근"}</td>
          {FX_SPECS.map((spec) => {
            const item = items.get(spec.id);
            return <td key={spec.id}>{item?.latest ? formatValue(spec, item.latest.value) : "-"}</td>;
          })}
        </tr>
        <tr>
          <td>
            {market.fx.baselineLabel}({formatTickDate(market.fx.baselineDate)}일)比
          </td>
          {FX_SPECS.map((spec) => {
            const item = items.get(spec.id);
            return (
              <td key={spec.id}>{item && item.changePct !== null ? formatSignedPct(item.changePct, 1, "%") : "-"}</td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

function Notes({ market }: { market: WeeklyMarket }) {
  const overridden = market.charts
    .filter((chart) => chart.overrideDates.length)
    .map((chart) => {
      const spec = CHART_SPECS.find((s) => s.id === chart.id);
      return `${spec?.title ?? chart.id} ${chart.overrideDates.map(formatTickDate).join("·")}`;
    });

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 text-[12px] text-muted">
      <p className="max-w-[640px]">
        자료: FRED(S&P500 · 美 10년물 · WTI 쿠싱 현물), 한국은행 ECOS(KOSPI · 국고채 10년 · 환율). 달러인덱스는 ICE
        산식으로 ECOS 의 6개 통화 환율에서 계산. 환율표는 한국은행 고시 환율(08:30) 기준이며 위안은 원/달러 ÷
        원/위안 교차환율.
        {overridden.length ? ` ※ 기사에서 확인한 종가(출처 집계 전): ${overridden.join(", ")}.` : ""}
        {market.file ? ` · data/${market.file}` : ""}
      </p>
      <a
        href="/api/weekly/xlsx"
        download
        className="whitespace-nowrap rounded-md border border-line bg-card px-2.5 py-1 text-ink-2 transition-colors hover:bg-[#e7e7e7]"
      >
        엑셀 파일로 내려받기 (차트 + 1년치 데이터)
      </a>
    </div>
  );
}

export function MarketPanel({ market }: { market: WeeklyMarket | null | undefined }) {
  if (!market) {
    return (
      <p className="text-[12px] text-muted">
        주요국 금융시장 동향 차트는 Claude Code 에서 /weekly 를 실행하면 생깁니다 (data/YYMMDD-weekly-market.json).
      </p>
    );
  }

  const charts = new Map(market.charts.map((chart) => [chart.id, chart]));

  return (
    <section className="mk space-y-2">
      <h3 className="mk-title mk-400">[ 주요국 금융시장 동향 ]</h3>

      <div className="overflow-x-auto">
        <div className="mk-grid min-w-[640px]">
          {CHART_SPECS.map((spec, index) => {
            const chart = charts.get(spec.id);
            return (
              <div key={spec.id} className="mk-cell">
                <div className="mk-bar">{spec.title}</div>
                {chart && chart.points.length ? (
                  <MarketChartSvg spec={spec} chart={chart} market={market} first={index === 0} />
                ) : (
                  <div className="mk-empty">{chart?.error ?? "자료 없음"}</div>
                )}
              </div>
            );
          })}
        </div>

        <FxTable market={market} />
      </div>

      <Notes market={market} />
    </section>
  );
}
