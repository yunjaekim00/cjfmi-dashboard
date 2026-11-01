"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import { IndicatorCard } from "@/components/IndicatorCard";
import { LiveStatus } from "@/components/LiveStatus";
import { SeriesChart } from "@/components/SeriesChart";
import { StatusNotice } from "@/components/StatusNotice";
import { WeeklyMonitor } from "@/components/WeeklyMonitor";
import { CHARTS, TABS, type TabId } from "@/lib/catalog";
import { buildSummaries } from "@/lib/summary";
import { useLiveDashboard } from "@/lib/useLiveDashboard";
import { useWeeklyBrief } from "@/lib/useWeeklyBrief";
import type { DashboardData } from "@/lib/types";

/** 주소의 ?tab=weekly 같은 값. 서버에는 주소가 없으므로 그때는 null — 하이드레이션 뒤 브라우저 값으로 바뀐다. */
function readRequestedTab(): TabId | null {
  const requested = new URLSearchParams(window.location.search).get("tab");
  return TABS.find((item) => item.id === requested)?.id ?? null;
}

const noSubscribe = () => () => {};

export function Dashboard({ initial }: { initial: DashboardData }) {
  const requestedTab = useSyncExternalStore(noSubscribe, readRequestedTab, () => null);
  const [chosenTab, setTab] = useState<TabId | null>(null);
  // 사용자가 누른 탭 > 주소로 지정한 탭 > 종합 지표
  const tab: TabId = chosenTab ?? requestedTab ?? "overview";
  const { data, checkedAt, refreshing, error, refresh } = useLiveDashboard(initial);
  // 주간 모니터링은 탭을 처음 열 때 받아오고, 그 뒤로는 탭을 오가도 들고 있는다.
  const weekly = useWeeklyBrief(tab === "weekly");

  const indicators = useMemo(() => buildSummaries(data.series), [data.series]);

  // 차트 탭은 둘 다 같은 3열 그리드를 쓴다.
  const charts = CHARTS.filter((chart) => chart.tab === tab);

  return (
    <div className="mx-auto w-full max-w-[1800px] px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line">
        <nav className="flex items-center gap-1" role="tablist">
          {TABS.map((item) => {
            const selected = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={[
                  "-mb-px border-b-2 px-4 py-2.5 text-[14px] transition-colors",
                  selected
                    ? "border-ink font-bold text-ink"
                    : "border-transparent text-ink-2 hover:text-ink",
                ].join(" ")}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <LiveStatus
          checkedAt={checkedAt}
          refreshing={refreshing}
          error={error}
          onRefresh={refresh}
        />
      </div>

      <div className="mt-6 space-y-4">
        <StatusNotice status={data.status} />

        {tab === "overview" ? (
          indicators.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(255px,1fr))] gap-3">
              {indicators.map((indicator) => (
                <IndicatorCard key={indicator.id} indicator={indicator} />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">표시할 지표가 없습니다.</p>
          )
        ) : null}

        {tab === "weekly" ? (
          <WeeklyMonitor state={weekly.state} onRegenerate={weekly.regenerate} />
        ) : null}

        {charts.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {charts.map((chart) => (
              <SeriesChart
                key={chart.id}
                spec={chart}
                series={data.series}
                fetchedAt={data.fetchedAt}
                height={300}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
