"use client";

import { useMemo, useState } from "react";

import { IndicatorCard } from "@/components/IndicatorCard";
import { LiveStatus } from "@/components/LiveStatus";
import { SeriesChart } from "@/components/SeriesChart";
import { StatusNotice } from "@/components/StatusNotice";
import { CHARTS, TABS, type TabId } from "@/lib/catalog";
import { buildSummaries } from "@/lib/summary";
import { useLiveDashboard } from "@/lib/useLiveDashboard";
import type { DashboardData } from "@/lib/types";

export function Dashboard({ initial }: { initial: DashboardData }) {
  const [tab, setTab] = useState<TabId>("overview");
  const { data, checkedAt, refreshing, error, refresh } = useLiveDashboard(initial);

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
