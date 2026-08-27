"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ExchangePoint = {
  date: string;
  value: number;
};

type TabKey = "exchange" | "overview";
type RangeKey = "6M" | "1Y" | "3Y" | "5Y" | "10Y" | "20Y" | "ALL";
type DisplayMode = "원계열" | "증가율";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const rangeOptions: RangeKey[] = ["6M", "1Y", "3Y", "5Y", "10Y", "20Y", "ALL"];

function formatDateLabel(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatLongDate(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function formatCurrency(value: number) {
  return `${value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} 원`;
}

function formatSummaryValue(value: number) {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildRangeData(raw: ExchangePoint[], range: RangeKey) {
  if (!raw.length) return raw;

  const latest = new Date(raw[raw.length - 1].date);
  let cutoff = new Date(latest);

  if (range === "6M") cutoff.setMonth(latest.getMonth() - 6);
  if (range === "1Y") cutoff.setFullYear(latest.getFullYear() - 1);
  if (range === "3Y") cutoff.setFullYear(latest.getFullYear() - 3);
  if (range === "5Y") cutoff.setFullYear(latest.getFullYear() - 5);
  if (range === "10Y") cutoff.setFullYear(latest.getFullYear() - 10);
  if (range === "20Y") cutoff.setFullYear(latest.getFullYear() - 20);
  if (range === "ALL") return raw;

  return raw.filter((point) => new Date(point.date) >= cutoff);
}

function getYAxisDomain(values: number[]) {
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, 5);
  return [Math.floor((min - padding) / 5) * 5, Math.ceil((max + padding) / 5) * 5];
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("exchange");
  const [activeRange, setActiveRange] = useState<RangeKey>("ALL");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("원계열");
  const [data, setData] = useState<ExchangePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchRate = async () => {
    try {
      const response = await fetch("/api/exchange-rate", { cache: "no-store" });
      if (!response.ok) throw new Error("API request failed");

      const payload = await response.json();
      setData(payload.data ?? []);
      setUpdatedAt(payload.updatedAt ?? null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRate();
    const intervalId = setInterval(() => fetchRate(), POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  const visibleData = useMemo(() => buildRangeData(data, activeRange), [data, activeRange]);

  const transformedData = useMemo(() => {
    if (!visibleData.length) return [];

    const baseline = visibleData[0].value;

    return visibleData.map((point) => {
      if (displayMode === "증가율") {
        const diff = ((point.value - baseline) / baseline) * 100;
        return { ...point, value: diff };
      }

      return point;
    });
  }, [displayMode, visibleData]);

  const summary = useMemo(() => {
    if (!visibleData.length) return null;
    const first = visibleData[0].value;
    const last = visibleData[visibleData.length - 1].value;
    const change = last - first;
    const changePercent = (change / first) * 100;

    return { first, last, change, changePercent };
  }, [visibleData]);

  const yDomain = useMemo(() => getYAxisDomain(transformedData.map((point) => point.value)), [transformedData]);

  return (
    <main className="min-h-screen bg-[#efefef] px-5 py-8 text-[#1a1a1a]">
      <div className="mx-auto max-w-[1200px] rounded-[20px] border border-[#c9c9c9] bg-[#f5f5f5] p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.02)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex gap-3">
            {[
              { key: "exchange", label: "대외/환율" },
              { key: "overview", label: "종합지표" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={[
                  "rounded-xl border px-4 py-2 text-[17px] font-medium transition-colors",
                  activeTab === tab.key
                    ? "border-[#5ca4d8] bg-[#eaf5ff] text-[#1169a7] shadow-sm"
                    : "border-[#cccccc] bg-[#f2f2f2] text-[#2b2b2b]",
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {(["증가율", "원계열"] as DisplayMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDisplayMode(mode)}
                className={[
                  "h-11 min-w-[96px] rounded-md border text-base font-medium",
                  displayMode === mode
                    ? "border-[#3f8fc7] bg-[#eaf4ff] text-[#0a6bb2] shadow-sm"
                    : "border-[#cfcfcf] bg-white text-[#1d1d1d]",
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "exchange" ? (
          <>
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h1 className="text-[2.2rem] font-semibold tracking-[-0.05em]">
                  원/달러 환율(매매기준율)
                </h1>
                <div className="mt-2 text-[1.1rem] text-[#3c3c3c]">
                  일별 · 최신: {updatedAt ? formatLongDate(updatedAt) : "-"}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {rangeOptions.map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setActiveRange(range)}
                    className={[
                      "rounded-md border px-4 py-2 text-[13px] font-medium transition-colors",
                      activeRange === range
                        ? "border-[#d7d7d7] bg-[#ececec] text-[#202020]"
                        : "border-[#d7d7d7] bg-[#f6f6f6] text-[#4f4f4f]",
                    ].join(" ")}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-[500px] w-full rounded-[16px] border border-[#d9d9d9] bg-[#f8f8f8] px-3 py-4">
              {isLoading ? (
                <div className="flex h-full items-center justify-center text-[#4d4d4d]">그래프 로딩 중...</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={transformedData} margin={{ top: 10, right: 30, left: 10, bottom: 15 }}>
                    <CartesianGrid stroke="#cfcfcf" strokeDasharray="0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value) => formatDateLabel(value)}
                      tick={{ fill: "#3d3d3d", fontSize: 12 }}
                      axisLine={{ stroke: "#8d8d8d" }}
                      tickLine={false}
                      minTickGap={28}
                    />
                    <YAxis
                      domain={yDomain}
                      tickFormatter={(value) =>
                        displayMode === "증가율" ? `${Number(value).toFixed(0)}%` : `${Number(value).toFixed(0)}`
                      }
                      tick={{ fill: "#3d3d3d", fontSize: 12 }}
                      axisLine={{ stroke: "#8d8d8d" }}
                      tickLine={false}
                      width={70}
                    />
                    <Tooltip
                      formatter={(value) => {
                        const numericValue = typeof value === "number" ? value : Number(value ?? 0);
                        if (displayMode === "증가율") {
                          return [`${numericValue.toFixed(2)}%`, "증가율"];
                        }
                        return [formatCurrency(numericValue), "환율"];
                      }}
                      labelFormatter={(label) => formatLongDate(String(label))}
                      contentStyle={{
                        backgroundColor: "#fff",
                        borderRadius: 12,
                        border: "1px solid #d2d2d2",
                        color: "#1d1d1d",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#1f6fb7"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0, fill: "#1f6fb7" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="mt-8 text-[1.05rem] text-[#3b3b3b]">
              자료: 한국은행/Frankfurter API 기준
            </div>
          </>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
            <div className="rounded-[18px] border border-[#d7d7d7] bg-[#f9f9f9] p-4">
              <div className="mb-3 text-[1.15rem] font-medium text-[#1d1d1d]">원/달러</div>
              <div className="mb-3 flex items-end gap-2">
                <div className="text-[3.1rem] font-medium tracking-[-0.06em] text-[#111111]">
                  {summary ? formatSummaryValue(summary.last) : "-"}
                </div>
                <div className="pb-2 text-[1.2rem] text-[#1f1f1f]">원</div>
              </div>

              <div className="mb-4 text-[1.05rem] text-[#cc5a3d]">
                {summary ? `${summary.change >= 0 ? "+" : ""}${summary.change.toFixed(2)} (${summary.changePercent >= 0 ? "+" : ""}${summary.changePercent.toFixed(2)}%)` : "-"}
              </div>

              <div className="text-[1rem] text-[#555555]">
                {updatedAt ? formatLongDate(updatedAt) : "-"}
              </div>

              <div className="mt-5 h-[170px] w-full">
                {transformedData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={transformedData.slice(-30)} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="miniFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#1f6fb7" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#1f6fb7" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="value" stroke="#1f6fb7" fill="url(#miniFill)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>

            <div className="rounded-[18px] border border-[#d7d7d7] bg-[#f4f4f4] p-5">
              <div className="text-[1.1rem] font-medium text-[#1d1d1d]">주요 지표</div>
              <div className="mt-4 space-y-4 text-base text-[#2d2d2d]">
                <div className="flex items-center justify-between border-b border-[#d7d7d7] pb-2">
                  <span>USD/KRW</span>
                  <span className="font-semibold">{summary ? formatSummaryValue(summary.last) : "-"}</span>
                </div>
                <div className="flex items-center justify-between border-b border-[#d7d7d7] pb-2">
                  <span>변동</span>
                  <span className="font-semibold">
                    {summary ? `${summary.change >= 0 ? "+" : ""}${summary.change.toFixed(2)}` : "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>기준일</span>
                  <span className="font-semibold">{updatedAt ? formatLongDate(updatedAt) : "-"}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
