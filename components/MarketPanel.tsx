"use client";

import {
  CHART_SPECS,
  FX_SERIES,
  FX_SPECS,
  annotationBelow,
  dateFraction,
  formatAxisValue,
  formatKstTime,
  formatSignedPct,
  formatTickDate,
  formatValue,
  formatWeekChange,
  fxCompare,
  kstDateOf,
  marketWindow,
  snapshotLabel,
  snapshotPoint,
  yScale,
  type ChartSpec,
  type MarketChart,
  type MarketSnapshot,
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
  /** 전주比의 비교점 — 고른 지난 보고 스냅샷. 그 계열 값이 없으면 7일 전 관측치(weekAgo)로 */
  baseline: MarketSnapshot | null;
};

function MarketChartSvg({ spec, chart, market, first, baseline }: ChartProps) {
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
  const { latest } = chart;
  const weekAgo = snapshotPoint(baseline, spec.id) ?? chart.weekAgo;
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
  // 종가 기준인데 그날 거래가 없어(휴장·출처 지연) 직전 거래일 종가를 썼으면 그 날짜를 밝힌다
  if (baseline?.kind === "close" && weekAgo && weekAgo.date !== kstDateOf(baseline.at)) {
    changeText = `${changeText ? `${changeText}, ` : ""}${formatTickDate(weekAgo.date)} 종가比`;
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

/**
 * 환율표 — 최근치 · 전쟁직전(2/27)比 · 직전보고일比. 마지막 행의 괄호 날짜는 오른쪽 "전주比 기준"에서 고른 시점이고,
 * 값은 지금 시세를 그 시점 값과 비교한 절상(+)·절하(−) 율이다.
 */
function FxTable({ market, baseline }: { market: WeeklyMarket; baseline: MarketSnapshot | null }) {
  const items = new Map(market.fx.items.map((item) => [item.id, item]));
  // 환율표의 기준일 — 한국은행 고시(08:30)가 있는 가장 늦은 날
  const asOf = market.fx.items
    .map((item) => item.latest?.date)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  // 최근치가 실행 시점 시세면 그 시각을, 집계치면 고시 시각(08:30)을 적는다
  const liveTime = market.liveAt && market.fx.items.some((item) => item.live) ? formatKstTime(market.liveAt) : null;

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
          <td>{asOf ? `${formatTickDate(asOf)}일(${liveTime ? `${liveTime} 현재` : "08:30 기준"})` : "최근"}</td>
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
        <tr>
          <td>직전보고일{baseline ? `(${formatTickDate(kstDateOf(baseline.at))}일)` : ""}比</td>
          {FX_SPECS.map((spec) => {
            const item = items.get(spec.id);
            const compare = item ? fxCompare(spec, item, baseline) : null;
            return (
              <td key={spec.id} title={compare ? `${formatTickDate(compare.date)}일 ${formatValue(spec, compare.value)} 대비` : undefined}>
                {compare ? formatSignedPct(compare.changePct, 1, "%") : "-"}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

/** 종가 기준에서 계열 이름 — 차트 제목, 차트에 없는 계열(환율표 통화 · 국고채 3년)은 따로 */
const SERIES_NAMES: Record<string, string> = Object.fromEntries([
  ...FX_SPECS.map((spec) => [FX_SERIES[spec.id], `환율표 ${spec.label}`]),
  ...CHART_SPECS.map((spec) => [spec.id, spec.title]),
  ["ktb3", "국고채 3년"],
]);

/**
 * 차트 오른쪽 빈 칸의 "전주比 기준" 패널 — 보고 시점 스냅샷(저장 파일) 또는 최근 14일의 종가 기준 중 하나를 고른다.
 * PC 화면 전용.
 */
function BaselinePanel({
  market,
  baseline,
  snapshots,
  defaultPrefix,
  onBaseChange,
}: {
  market: WeeklyMarket;
  baseline: MarketSnapshot | null;
  snapshots: MarketSnapshot[];
  defaultPrefix: string | null;
  onBaseChange: (prefix: string | null) => void;
}) {
  const reports = snapshots.filter((s) => s.kind !== "close").reverse();
  const closes = snapshots.filter((s) => s.kind === "close").reverse();
  if (!reports.length && !closes.length) return null;
  // 종가 기준인데 그날 거래가 없어 직전 거래일 종가를 쓴 계열
  const substituted =
    baseline?.kind === "close"
      ? Object.entries(baseline.dates ?? {})
          .filter(([, date]) => date !== kstDateOf(baseline.at))
          .map(([id, date]) => `${SERIES_NAMES[id] ?? id} ${formatTickDate(date)}`)
      : [];

  return (
    <aside className="absolute left-full top-0 ml-5 w-[240px] rounded-lg border border-line bg-card px-3 py-2.5 text-[12px] text-ink-2">
      <p className="font-semibold text-ink">전주比 기준</p>
      <p className="mt-0.5 text-muted">지난 보고 때 저장된 값, 또는 그날 종가와 비교합니다.</p>
      <select
        aria-label="전주比 기준"
        className="mt-2 w-full rounded-md border border-line bg-white px-2 py-1 text-ink"
        value={baseline?.prefix ?? ""}
        // 기본값을 고르면 주소에 남기지 않는다 — 다음 보고 때 자동으로 그 전 보고로 넘어가게
        onChange={(event) => onBaseChange(event.target.value === defaultPrefix ? null : event.target.value)}
      >
        <optgroup label="보고 시점 (저장 파일)">
          {reports.map((snapshot) => (
            <option key={snapshot.prefix} value={snapshot.prefix}>
              {snapshotLabel(snapshot)}
              {snapshot.prefix === defaultPrefix ? " (기본)" : ""}
            </option>
          ))}
        </optgroup>
        <optgroup label="종가 기준 (최근 14일)">
          {closes.map((snapshot) => (
            <option key={snapshot.prefix} value={snapshot.prefix}>
              {snapshotLabel(snapshot)}
            </option>
          ))}
        </optgroup>
      </select>
      {baseline ? (
        <p className="mt-2 text-muted">
          기준 {snapshotLabel(baseline)}
          {baseline.kind === "close" ? "" : ` · ${baseline.prefix}`}
          <br />
          현재 {formatTickDate(market.asOf)}일 {market.liveAt ? formatKstTime(market.liveAt) : ""} 시세와 비교
          {substituted.length ? (
            <>
              <br />
              그날 종가가 없어 직전 거래일 사용: {substituted.join(" · ")}
            </>
          ) : null}
        </p>
      ) : null}
      <p className="mt-2 text-muted">
        기본값은 오늘보다 앞선 날의 가장 최근 보고. 종가 기준은 출처 집계가 늦은 날이면 직전 거래일 종가를 씁니다. 고른 값은
        주소(?base=)에 남고 엑셀에도 적용됩니다.
      </p>
    </aside>
  );
}

function Notes({ market, baseline }: { market: WeeklyMarket; baseline: MarketSnapshot | null }) {
  const overridden = market.charts
    .filter((chart) => chart.overrideDates.length)
    .map((chart) => {
      const spec = CHART_SPECS.find((s) => s.id === chart.id);
      return `${spec?.title ?? chart.id} ${chart.overrideDates.map(formatTickDate).join("·")}`;
    });
  const liveTime = market.liveAt ? formatKstTime(market.liveAt) : null;
  // 시세를 받으려 했는데 못 받아 집계치로 남은 항목
  const notLive = market.liveAt
    ? [
        ...market.charts
          .filter((chart) => chart.points.length && !chart.live)
          .map((chart) => CHART_SPECS.find((s) => s.id === chart.id)?.title ?? chart.id),
        ...market.fx.items
          .filter((item) => item.latest && !item.live)
          .map((item) => `환율표 ${FX_SPECS.find((s) => s.id === item.id)?.label ?? item.id}`),
      ]
    : [];

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 text-[12px] text-muted">
      <p className="max-w-[640px]">
        {liveTime
          ? `최근치는 ${formatTickDate(market.asOf)}일 ${liveTime} KST 시세(CNBC 시세 · 네이버 금융, 5분마다 갱신). `
          : ""}
        1년 이력: FRED(S&P500 · 美 10년물 · WTI 쿠싱 현물), 한국은행 ECOS(KOSPI · 국고채 10년 · 환율 매매기준율), 美
        10년물은 재무부 일별 금리표로 보충. 환율표 비교 시점 값은 한국은행 고시(08:30) 기준, 달러인덱스 비교 시점은
        ICE 산식으로 계산, 위안은 교차환율. WTI 최근치는 선물 근월물이라 현물 이력과 기준이 다르다.
        {baseline ? ` 전주比와 환율표 직전보고일比는 ${snapshotLabel(baseline)} 대비.` : " 전주比는 지난주 같은 요일 대비."}
        {notLive.length ? ` ※ 실시간 시세를 못 받아 집계치 사용: ${notLive.join(", ")}.` : ""}
        {overridden.length ? ` ※ 출처 집계 전 종가(CNBC 마감 시세·기사): ${overridden.join(", ")}.` : ""}
        {market.file ? ` · data/${market.file}` : ""}
      </p>
      <a
        href={`/api/weekly/xlsx${baseline ? `?base=${encodeURIComponent(baseline.prefix)}` : ""}`}
        download
        className="whitespace-nowrap rounded-md border border-line bg-card px-2.5 py-1 text-ink-2 transition-colors hover:bg-[#e7e7e7]"
      >
        엑셀 파일로 내려받기 (차트 + 1년치 데이터)
      </a>
    </div>
  );
}

export function MarketPanel({
  market,
  baseline,
  snapshots,
  defaultPrefix,
  onBaseChange,
}: {
  market: WeeklyMarket | null | undefined;
  baseline: MarketSnapshot | null;
  snapshots: MarketSnapshot[];
  defaultPrefix: string | null;
  onBaseChange: (prefix: string | null) => void;
}) {
  if (!market) {
    return (
      <p className="text-[12px] text-muted">
        주요국 금융시장 동향 차트는 Claude Code 에서 /weekly 를 실행하면 생깁니다 (data/YYMMDD-weekly-market.json).
      </p>
    );
  }

  const charts = new Map(market.charts.map((chart) => [chart.id, chart]));

  return (
    <section className="mk relative space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="mk-title mk-400">[ 주요국 금융시장 동향 ]</h3>
        {market.liveAt ? (
          <span className="text-[12px] text-muted">
            {formatTickDate(market.asOf)}일 {formatKstTime(market.liveAt)} 현재 시세
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <div className="mk-grid min-w-[640px]">
          {CHART_SPECS.map((spec, index) => {
            const chart = charts.get(spec.id);
            return (
              <div key={spec.id} className="mk-cell">
                <div className="mk-bar">{spec.title}</div>
                {chart && chart.points.length ? (
                  <MarketChartSvg spec={spec} chart={chart} market={market} first={index === 0} baseline={baseline} />
                ) : (
                  <div className="mk-empty">{chart?.error ?? "자료 없음"}</div>
                )}
              </div>
            );
          })}
        </div>

        <FxTable market={market} baseline={baseline} />
      </div>

      <Notes market={market} baseline={baseline} />
      <BaselinePanel
        market={market}
        baseline={baseline}
        snapshots={snapshots}
        defaultPrefix={defaultPrefix}
        onBaseChange={onBaseChange}
      />
    </section>
  );
}
