"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ExchangeRateData, Point } from "@/lib/types";

/** 폴링 주기. 매매기준율은 영업일에 한 번 고시되므로 5분이면 충분히 촘촘하다. */
export const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 폴링할 때 다시 받아올 구간(일).
 * 한국은행이 최근 며칠치를 정정하는 경우가 있어 마지막 관측일에서 조금 앞까지 겹쳐 받는다.
 */
const OVERLAP_DAYS = 10;

function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 겹쳐 받은 구간은 새 값으로 덮어쓰고, 나머지는 그대로 둔다. */
function applyPatch(previous: Point[], patch: Point[]): Point[] {
  if (!patch.length) return previous;

  const byDate = new Map(previous.map((point) => [point.date, point]));
  for (const point of patch) byDate.set(point.date, point);

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

type Live = {
  data: ExchangeRateData;
  /** 마지막으로 서버에 물어본 시각 (epoch ms). 아직 폴링 전이면 null. */
  checkedAt: number | null;
  /** 폴링 요청이 진행 중인지 */
  refreshing: boolean;
  /** 마지막 폴링이 실패했다면 그 사유 */
  error: string | null;
  /** 수동 새로고침 */
  refresh: () => void;
};

/**
 * 서버에서 렌더된 초기 데이터로 시작해, 이후에는 브라우저가 주기적으로
 * /api/exchange-rate 를 폴링해 최신 관측치를 이어 붙인다.
 * 탭을 다시 열거나 네트워크가 돌아왔을 때도 한 번 확인한다.
 */
export function useLiveExchangeRate(initial: ExchangeRateData): Live {
  const [data, setData] = useState(initial);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 다음 요청의 since 를 만들기 위한 커서. state 로 두면 폴링 타이머가 매번 재설정된다.
  const latestDateRef = useRef(initial.bok.at(-1)?.date ?? null);
  const inFlightRef = useRef(false);

  const poll = useCallback(async (signal: AbortSignal) => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setRefreshing(true);

    try {
      const cursor = latestDateRef.current;
      const url = cursor
        ? `/api/exchange-rate?since=${shiftDate(cursor, -OVERLAP_DAYS)}`
        : "/api/exchange-rate";

      const res = await fetch(url, { signal, cache: "no-store" });
      if (!res.ok) throw new Error(`서버 응답 오류 (HTTP ${res.status})`);

      const next = (await res.json()) as ExchangeRateData & { partial: boolean };

      setData((previous) => ({
        ...next,
        bok: next.partial ? applyPatch(previous.bok, next.bok) : next.bok,
      }));

      latestDateRef.current = next.bok.at(-1)?.date ?? latestDateRef.current;
      setError(null);
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "갱신에 실패했습니다.");
    } finally {
      inFlightRef.current = false;
      if (!signal.aborted) {
        setRefreshing(false);
        setCheckedAt(Date.now());
      }
    }
  }, []);

  const controllerRef = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    if (controllerRef.current) void poll(controllerRef.current.signal);
  }, [poll]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;

    const tick = () => void poll(controller.signal);

    // 정적으로 캐시된 페이지를 받았을 수도 있으니 뜨자마자 한 번 확인한다.
    tick();

    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", tick);
      controller.abort();
      controllerRef.current = null;
    };
  }, [poll]);

  return { data, checkedAt, refreshing, error, refresh };
}
