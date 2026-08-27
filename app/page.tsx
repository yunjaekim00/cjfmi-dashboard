"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ExchangePoint = {
  date: string;
  value: number;
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;

function formatDateLabel(date: string) {
  return new Date(date).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
  });
}

function formatValue(value: number) {
  return `${value.toFixed(2)} KRW`;
}

export default function Home() {
  const [data, setData] = useState<ExchangePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchRate = async () => {
    try {
      const response = await fetch("/api/exchange-rate", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("API request failed");
      }

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

    const intervalId = setInterval(() => {
      fetchRate();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  const summary = useMemo(() => {
    if (!data.length) return null;

    const first = data[0].value;
    const last = data[data.length - 1].value;
    const change = last - first;
    const changePercent = (change / first) * 100;

    return {
      first,
      last,
      change,
      changePercent,
    };
  }, [data]);

  return (
    <main className="min-h-screen bg-[#efefef] px-5 py-8 text-[#1a1a1a]">
      <div className="mx-auto max-w-[1200px] rounded-[20px] border border-[#cfcfcf] bg-[#f5f5f3] p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[2.2rem] font-semibold leading-tight tracking-[-0.04em]">
              한국 산업활동(전년동월대비)
            </h1>
            <div className="mt-3 flex items-center gap-3 text-[1.05rem] text-[#3a3a3a]">
              <span>월별 · 최신: 2026.6월</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="h-11 min-w-[92px] rounded-md border border-[#2b8ec8] bg-[#eaf5ff] px-4 text-base font-semibold text-[#0b6fb8] shadow-sm">
              증가율
            </button>
            <button className="h-11 min-w-[92px] rounded-md border border-[#b9c3cb] bg-[#f7f7f7] px-4 text-base font-medium text-[#1d2a35]">
              원계열
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3 text-base text-[#2c2c2c]">
          <button className="rounded-md border border-[#d8d8d8] bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#4b4b4b]">
            6M
          </button>
          <button className="rounded-md border border-[#d8d8d8] bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#4b4b4b]">
            1Y
          </button>
          <button className="rounded-md border border-[#d8d8d8] bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#4b4b4b]">
            3Y
          </button>
          <button className="rounded-md border border-[#d8d8d8] bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#4b4b4b]">
            5Y
          </button>
          <button className="rounded-md border border-[#d8d8d8] bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#4b4b4b]">
            10Y
          </button>
          <button className="rounded-md border border-[#d8d8d8] bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#4b4b4b]">
            20Y
          </button>
          <button className="rounded-md border border-[#d8d8d8] bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#4b4b4b]">
            전체
          </button>
        </div>

        <div className="rounded-[18px] border border-[#d8d8d8] bg-[#f6f6f6] p-3">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="text-[1.1rem] font-medium text-[#2b2b2b]">
              {isLoading ? "데이터 불러오는 중..." : "대외/환율"}
            </div>
            {updatedAt ? (
              <div className="text-xs text-[#5f5f5f]">
                마지막 업데이트: {new Date(updatedAt).toLocaleString("ko-KR")}
              </div>
            ) : null}
          </div>

          <div className="mb-4 flex items-center justify-between gap-4 rounded-md border border-[#d1d1d1] bg-white px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="inline-block h-3 w-8 rounded-sm bg-[#1d8f7a]" />
              <span className="text-base font-medium text-[#1b1b1b]">USD/KRW</span>
            </div>
            {summary ? (
              <div className="text-right text-sm text-[#2d2d2d]">
                <div className="font-semibold">최근값: {formatValue(summary.last)}</div>
                <div>
                  {summary.change >= 0 ? "+" : ""}
                  {summary.change.toFixed(2)} ({summary.changePercent >= 0 ? "+" : ""}
                  {summary.changePercent.toFixed(2)}%)
                </div>
              </div>
            ) : null}
          </div>

          <div className="h-[420px] w-full">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-[#555]">
                그래프 로딩 중...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#d8d8d8" strokeDasharray="0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateLabel}
                    tick={{ fill: "#4a4a4a", fontSize: 12 }}
                    axisLine={{ stroke: "#7d7d7d" }}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    domain={[
                      (dataMin: number) => Math.floor(dataMin * 0.98),
                      (dataMax: number) => Math.ceil(dataMax * 1.02),
                    ]}
                    tickFormatter={(value) => `${value.toFixed(0)}`}
                    tick={{ fill: "#4a4a4a", fontSize: 12 }}
                    axisLine={{ stroke: "#7d7d7d" }}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    formatter={(value) => {
                      const numericValue =
                        typeof value === "number" ? value : Number(value ?? 0);
                      return [formatValue(numericValue), "환율"];
                    }}
                    labelFormatter={(label) => formatDateLabel(String(label))}
                    contentStyle={{
                      backgroundColor: "#fff",
                      borderRadius: 12,
                      border: "1px solid #d1d1d1",
                    }}
                  />
                  <ReferenceLine x={data[data.length - 1]?.date} stroke="#000" strokeDasharray="4 4" />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#1d8f7a"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-10 text-base text-[#2b2b2b]">
          <div className="flex items-center gap-3">
            <span className="inline-block h-2.5 w-6 rounded-sm bg-[#1d8f7a]" />
            <span>USD/KRW</span>
          </div>
        </div>

        <div className="mt-12 text-left text-base text-[#3b3b3b]">
          <div>자료: Frankfurter API</div>
        </div>
      </div>
    </main>
  );
}
