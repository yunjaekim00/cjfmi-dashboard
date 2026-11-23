"use client";

import { Fragment, useState, type ReactNode } from "react";

import { MonthlyChart } from "@/components/MonthlyChart";
import { SeriesChart } from "@/components/SeriesChart";
import { StatusNotice } from "@/components/StatusNotice";
import { COLOR, type ChartSpec } from "@/lib/catalog";
import {
  CONSUMPTION_GROUP_IDS,
  CONSUMPTION_GROUPS,
  consumptionSeriesId,
  INDUSTRY_LABELS,
  INDUSTRY_ORDER,
  MONTHLY_CHART_STACKS,
  MONTHLY_GROUP_IDS,
  MONTHLY_GROUPS,
  monthlySeriesId,
  yoySeries,
  type ConsumptionData,
  type ConsumptionGroupId,
} from "@/lib/consumption-types";
import {
  changeColor,
  formatKoreanDate,
  formatKoreanMonth,
  formatNumber,
  formatShortDate,
  formatSigned,
} from "@/lib/format";
import type { Point } from "@/lib/types";
import type { ConsumptionState } from "@/lib/useConsumption";

/*
 * "4. 국내 소비동향" — 주간 · 월간 · 분기 · 연간.
 *  주간: 나우캐스트 신용카드 이용금액 · 가맹점 카드매출액(전체 + 7개 업종)의 전년동기대비 증감률.
 *  월간: 소매판매액지수 · 서비스업생산지수(경상지수)의 지수와 전년동월비 — 한 표와 항목별 차트 (ECOS).
 *  분기 · 연간: 아직 없다.
 * 주간·월간 자료는 /api/consumption 한 번에 같이 온다 — 어느 쪽을 먼저 열어도 한 번만 받는다.
 */

const PERIODS = [
  { id: "weekly", label: "주간" },
  { id: "monthly", label: "월간" },
  { id: "quarterly", label: "분기" },
  { id: "annual", label: "연간" },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

/** 표에 보여줄 최근 주 수 */
const TABLE_WEEKS = 4;
/** 표에 보여줄 최근 달 수 */
const TABLE_MONTHS = 6;

/** 월간 계열 id 는 "m:" 으로 시작한다 — 안내 배너를 기간별로 나눠 보여줄 때 쓴다 */
const isMonthlyKey = (key: string) => key.startsWith("m:");

/** 포털이 월간으로만 주는 주간 업종(가맹점 카드매출액의 오락 스포츠 및 문화, 2026-11-16 확인) — 날짜가 모두 월말이다 */
const isMonthlyOnly = (points: Point[]) => points.length > 1 && points.every((p) => Number(p.date.slice(8, 10)) >= 28);

type Props = { state: ConsumptionState; onReload: () => void };

export function ConsumptionPanel({ state, onReload }: Props) {
  const [period, setPeriod] = useState<PeriodId>("weekly");
  const loaded = period === "weekly" || period === "monthly";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1 rounded-lg bg-[#f1f1f1] p-1" role="tablist" aria-label="기간 구분">
          {PERIODS.map((item) => {
            const selected = item.id === period;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPeriod(item.id)}
                className={[
                  "rounded-md px-3 py-1 text-[13px] transition-colors",
                  selected ? "bg-card font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-2 hover:text-ink",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        {loaded && state.data ? <Caption period={period} data={state.data} /> : null}
      </div>

      {loaded ? (
        <Loaded state={state} onReload={onReload} period={period}>
          {(data) => (period === "weekly" ? <Weekly data={data} /> : <Monthly data={data} />)}
        </Loaded>
      ) : (
        <Placeholder label={PERIODS.find((p) => p.id === period)?.label ?? ""} />
      )}
    </section>
  );
}

function Caption({ period, data }: { period: PeriodId; data: ConsumptionData }) {
  const fetched = formatShortDate(data.fetchedAt.slice(0, 10));
  if (period === "weekly") {
    return (
      <p className="tabular text-[12px] text-muted">
        최근 주 기준일 {data.latestWeek ? formatKoreanDate(data.latestWeek) : "—"} · 전년동기대비(52주 전 같은 주) 증감률 · {fetched} 조회
      </p>
    );
  }
  return (
    <p className="tabular text-[12px] text-muted">
      최근 월 {data.latestMonth ? formatKoreanMonth(data.latestMonth) : "—"} · 경상지수(2020=100)와 전년동월비 · {fetched} 조회
    </p>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card px-5 py-10 text-center text-[13px] text-muted">
      {label} 소비동향은 아직 준비 중입니다. 주간 · 월간부터 채우고 있습니다.
    </div>
  );
}

/** 받아오는 중 · 실패 · 받아 둔 자료 안내를 공통으로 처리하고, 자료가 있으면 children 에 넘긴다. */
function Loaded({
  state,
  onReload,
  period,
  children,
}: Props & { period: PeriodId; children: (data: ConsumptionData) => ReactNode }) {
  if (state.status === "idle" || (state.status === "loading" && !state.data)) return <LoadingBox />;

  if (!state.data) {
    return <ErrorBox message={state.status === "error" ? state.error : "자료가 없습니다."} onReload={onReload} />;
  }

  const data = state.data;
  // 지금 보는 기간의 계열만 안내한다 — 주간이 막혀도 월간 화면에는 그 얘기를 하지 않는다
  const status = data.status.filter((entry) => isMonthlyKey(entry.key) === (period === "monthly"));

  return (
    <div className="space-y-6">
      {state.status === "error" ? <ErrorBox message={state.error} onReload={onReload} compact /> : null}
      {data.stale ? (
        <p className="rounded-xl border border-line bg-[#fff8e6] px-4 py-2 text-[12px] text-ink-2">
          새로 받지 못해 {formatShortDate(data.fetchedAt.slice(0, 10))} 에 받아 둔 자료입니다 — {data.stale}
        </p>
      ) : null}
      <StatusNotice status={status} />
      {children(data)}
    </div>
  );
}

// ───────────────────────── 주간 ─────────────────────────

function Weekly({ data }: { data: ConsumptionData }) {
  return (
    <>
      {CONSUMPTION_GROUP_IDS.map((group) => (
        <WeeklyGroupSection key={group} group={group} data={data} />
      ))}
      <p className="text-[11px] text-muted">
        출처: 국가데이터처 나우캐스트(속보성 경제사회 지표, data.kostat.go.kr/nowcast) — 신용카드 이용금액은 신한카드, 가맹점 카드매출액은 신한카드·한국정보통신
        자료. 주간 지표는 약 10일 뒤 공표되고 x축 날짜는 그 주의 기준일입니다. 국가승인통계가 아닌 실험적 통계입니다. 업종 이름은 포털 표기
        그대로입니다. 가맹점 카드매출액의 오락 스포츠 및 문화는 포털이 월간(월말 기준)으로만 제공해 표에는 이름 옆에 최근 월 값을 적고 차트는
        월별로 그립니다.
      </p>
    </>
  );
}

/** 지표 한 묶음 — 최근 4주 표 + 전체·업종별 차트 */
function WeeklyGroupSection({ group, data }: { group: ConsumptionGroupId; data: ConsumptionData }) {
  const def = CONSUMPTION_GROUPS[group];
  const totalId = consumptionSeriesId(group, "total");
  const rows: Array<{ id: string; label: string; points: Point[] }> = [];
  if (data.series[totalId]?.length) rows.push({ id: totalId, label: "전체", points: data.series[totalId] });
  for (const code of INDUSTRY_ORDER) {
    const id = consumptionSeriesId(group, code);
    const points = data.series[id];
    if (points?.length) rows.push({ id, label: INDUSTRY_LABELS[code] ?? code, points });
  }

  if (!rows.length) {
    return (
      <section>
        <WeeklySectionHeader def={def} />
        <p className="mt-3 text-[13px] text-muted">받아온 자료가 없습니다. 위 안내의 사유를 확인해 주세요.</p>
      </section>
    );
  }

  // 표의 열 — 자료가 가장 긴 계열의 최근 주들
  const longest = rows.reduce((a, b) => (b.points.length > a.points.length ? b : a));
  const weeks = longest.points.slice(-TABLE_WEEKS).map((p) => p.date);

  return (
    <section>
      <WeeklySectionHeader def={def} />

      <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-4 py-2 text-left font-medium">업종</th>
              {weeks.map((week) => (
                <th key={week} className="tabular px-3 py-2 text-right font-medium">
                  {formatKoreanDate(week).slice(5)} 주
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const byDate = new Map(row.points.map((p) => [p.date, p.value]));
              // 월간으로만 오는 업종은 주 열에 값이 없다 — 최근 월말 값을 이름 옆에 적는다
              const monthly = isMonthlyOnly(row.points);
              const last = row.points.at(-1);
              return (
                <tr key={row.id} className={row.id === totalId ? "border-b border-line font-semibold" : ""}>
                  <td className="px-4 py-1.5 text-ink">
                    {row.label}
                    {monthly && last ? (
                      <span className="ml-2 text-[11px] font-normal text-muted">
                        월간만 제공 · {formatKoreanDate(last.date).slice(5)}{" "}
                        <span style={{ color: changeColor(last.value) }}>{formatSigned(last.value, 1)}%</span>
                      </span>
                    ) : null}
                  </td>
                  {weeks.map((week) => {
                    const value = byDate.get(week);
                    return (
                      <td
                        key={week}
                        className="tabular px-3 py-1.5 text-right"
                        style={{ color: value === undefined ? "var(--muted)" : changeColor(value) }}
                      >
                        {value === undefined ? "-" : `${formatSigned(value, 1)}%`}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <SeriesChart
            key={row.id}
            spec={weeklyChartSpec(row.id, row.label, def.label, isMonthlyOnly(row.points))}
            series={data.series}
            fetchedAt={data.fetchedAt}
            height={220}
          />
        ))}
      </div>
    </section>
  );
}

function WeeklySectionHeader({ def }: { def: (typeof CONSUMPTION_GROUPS)[ConsumptionGroupId] }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[15px] font-bold text-ink">
        [ 주간 {def.label} ] <span className="ml-1 text-[12px] font-normal text-muted">전년동기대비 증감률, %</span>
      </h2>
      <span className="text-[11px] text-muted">자료: {def.provider}</span>
    </div>
  );
}

function weeklyChartSpec(id: string, label: string, groupLabel: string, monthly = false): ChartSpec {
  return {
    id,
    tab: "consumption",
    title: label === "전체" ? `${groupLabel} — 전체` : label,
    unit: "%",
    digits: 1,
    cadence: monthly ? "월간(월말 기준) · 전년동기대비" : "주간 · 전년동기대비",
    defaultRange: "1Y",
    axisDate: "yy.m.d",
    zeroLine: true,
    valueSuffix: "%",
    series: [{ seriesId: id, label: "전년동기대비", color: COLOR.blue }],
    sources: ["국가데이터처 나우캐스트"],
  };
}

// ───────────────────────── 월간 ─────────────────────────

type MonthlyRow = { id: string; group: string; label: string; source: string; level: Point[]; yoy: Point[] };

/** 두 지표를 한 표에 — 지표 → 항목 → (지수 · 전년동월비) 두 줄. 그 아래 항목별 차트를 주제별 기둥으로 쌓는다. */
function Monthly({ data }: { data: ConsumptionData }) {
  const groups = MONTHLY_GROUP_IDS.map((group) => {
    const def = MONTHLY_GROUPS[group];
    const rows: MonthlyRow[] = def.items.flatMap((item) => {
      const id = monthlySeriesId(group, item.code);
      const level = data.series[id];
      if (!level?.length) return [];
      return [{ id, group: def.label, label: item.label, source: def.source, level, yoy: yoySeries(level) }];
    });
    return { label: def.label, rows };
  }).filter((entry) => entry.rows.length);
  const all = groups.flatMap((entry) => entry.rows);

  if (!all.length) {
    return (
      <section>
        <MonthlyHeader />
        <p className="mt-3 text-[13px] text-muted">받아온 자료가 없습니다. 위 안내의 사유를 확인해 주세요.</p>
      </section>
    );
  }

  // 표의 열 — 자료가 가장 긴 계열의 최근 달들
  const longest = all.reduce((a, b) => (b.level.length > a.level.length ? b : a));
  const months = longest.level.slice(-TABLE_MONTHS).map((p) => p.date);

  // 차트 기둥 — 정해진 배치대로 쌓고, 배치에 없는 계열(나중에 추가된 항목)은 뒤에 하나씩 둔다
  const byId = new Map(all.map((row) => [row.id, row]));
  const stacks = MONTHLY_CHART_STACKS.map((stack) =>
    stack.flatMap(([group, code]) => {
      const row = byId.get(monthlySeriesId(group, code));
      return row ? [row] : [];
    })
  ).filter((stack) => stack.length);
  const placed = new Set(stacks.flat().map((row) => row.id));
  for (const row of all) if (!placed.has(row.id)) stacks.push([row]);

  return (
    <>
      <section>
        <MonthlyHeader />

        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[760px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="px-4 py-2 text-left font-medium">지표</th>
                <th className="px-3 py-2 text-left font-medium">항목</th>
                <th className="px-3 py-2 text-left font-medium" />
                {months.map((month) => (
                  <th key={month} className="tabular px-3 py-2 text-right font-medium">
                    {formatKoreanMonth(month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((entry, groupIndex) =>
                entry.rows.map((row, rowIndex) => {
                  const level = new Map(row.level.map((p) => [p.date, p.value]));
                  const yoy = new Map(row.yoy.map((p) => [p.date, p.value]));
                  const lastGroup = groupIndex === groups.length - 1;
                  const lastRow = rowIndex === entry.rows.length - 1;
                  // 항목 사이는 가는 선, 지표 사이는 굵은 선, 표 끝은 없음
                  const divider = lastRow ? (lastGroup ? "" : "border-b-2 border-line") : "border-b border-line";
                  const weight = row.label === "총지수" ? "font-semibold" : "";
                  return (
                    <Fragment key={row.id}>
                      <tr className={weight}>
                        {rowIndex === 0 ? (
                          <td
                            rowSpan={entry.rows.length * 2}
                            className={`px-4 py-1.5 align-top font-semibold text-ink ${lastGroup ? "" : "border-b-2 border-line"}`}
                          >
                            {entry.label}
                          </td>
                        ) : null}
                        <td rowSpan={2} className={`px-3 py-1.5 align-top text-ink ${divider}`}>
                          {row.label}
                        </td>
                        <td className="px-3 py-1.5 font-normal text-muted">지수</td>
                        {months.map((month) => {
                          const value = level.get(month);
                          return (
                            <td key={month} className="tabular px-3 py-1.5 text-right text-ink">
                              {value === undefined ? "-" : formatNumber(value, 1)}
                            </td>
                          );
                        })}
                      </tr>
                      <tr className={`${weight} ${divider}`}>
                        <td className="px-3 py-1.5 font-normal text-muted">전년동월비</td>
                        {months.map((month) => {
                          const value = yoy.get(month);
                          return (
                            <td
                              key={month}
                              className="tabular px-3 py-1.5 text-right"
                              style={{ color: value === undefined ? "var(--muted)" : changeColor(value) }}
                            >
                              {value === undefined ? "-" : `${formatSigned(value, 1)}%`}
                            </td>
                          );
                        })}
                      </tr>
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {stacks.map((stack) => (
          <div key={stack[0].id} className="flex flex-col gap-4">
            {stack.map((row) => (
              <MonthlyChart
                key={row.id}
                title={row.label}
                note={row.group}
                level={row.level}
                yoy={row.yoy}
                fetchedAt={data.fetchedAt}
                source={row.source}
                height={230}
              />
            ))}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted">
        출처: 국가데이터처 산업활동동향 — 한국은행 ECOS 에 실린 재별 및 상품군별 판매액지수(901Y100)와 산업별 서비스업생산지수(901Y038)의
        경상지수(2020=100). 전월 자료가 매월 말에 공표됩니다. 전년동월비는 지수에서 계산한 값입니다. 소매판매액지수에는 &quot;의류 및 신발&quot;
        한 항목이 없어 의복과 신발 및 가방을 따로 둡니다. 항목 이름은 국가데이터처(통계청) 표기 그대로입니다.
      </p>
    </>
  );
}

function MonthlyHeader() {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[15px] font-bold text-ink">
        [ 월간 소매판매액지수 · 서비스업생산지수 ]{" "}
        <span className="ml-1 text-[12px] font-normal text-muted">경상지수(2020=100) · 전년동월비, %</span>
      </h2>
      <span className="text-[11px] text-muted">자료: 국가데이터처 산업활동동향 (ECOS 901Y100 · 901Y038)</span>
    </div>
  );
}

// ───────────────────────── 공통 ─────────────────────────

function LoadingBox() {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-6" aria-busy>
      <p className="text-[13px] text-ink-2">
        나우캐스트(주간 신용카드 이용금액·가맹점 카드매출액)와 ECOS(월간 소매판매액지수·서비스업생산지수) 자료를 받아오는 중입니다…
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-[220px] animate-pulse rounded-xl bg-[#ececec]" />
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">주간 계열 16개를 순차로 받아 10초쯤 걸립니다. 받은 뒤에는 6시간 동안 바로 열립니다.</p>
    </div>
  );
}

function ErrorBox({ message, onReload, compact = false }: { message: string; onReload: () => void; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-5 ${compact ? "py-3" : "py-6"}`}>
      <p className="text-[13px] text-ink-2">소비동향 자료를 불러오지 못했습니다 — {message}</p>
      <button
        type="button"
        onClick={onReload}
        className="rounded-md border border-line px-3 py-1 text-[12px] text-ink hover:bg-[#f1f1f1]"
      >
        다시 받기
      </button>
    </div>
  );
}
