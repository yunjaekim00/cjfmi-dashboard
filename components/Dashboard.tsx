"use client";

import { useState } from "react";

import { ExchangeRateChart } from "@/components/ExchangeRateChart";
import { IndicatorCard } from "@/components/IndicatorCard";
import { StatusNotice } from "@/components/StatusNotice";
import type { ExchangeRateData, IndicatorSummary } from "@/lib/types";

const TABS = [
  { id: "overview", label: "1. 종합 지표" },
  { id: "fx", label: "2. 환율" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type Props = {
  exchangeRate: ExchangeRateData;
  /**
   * 종합지표 카드 목록. 지금은 원/달러 한 장뿐이고,
   * 지표를 추가할 때 이 배열만 늘리면 된다.
   */
  indicators: IndicatorSummary[];
};

export function Dashboard({ exchangeRate, indicators }: Props) {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div className="mx-auto w-full max-w-[1600px] px-5 py-6 sm:px-8">
      <nav className="flex items-center gap-1 border-b border-line" role="tablist">
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

      <div className="mt-6 space-y-4">
        <StatusNotice status={exchangeRate.status} />

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
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <ExchangeRateChart data={exchangeRate} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
