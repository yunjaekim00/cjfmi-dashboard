"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DashboardData, Point, SeriesMap } from "@/lib/types";

/**
 * 폴링 주기.
 *
 * 서버가 외부 응답을 10분 캐시하므로, 그보다 자주 물어봐야 답이 바뀔 수가 없다.
 * 주기를 캐시 수명에 맞춘다 — 5분이면 절반이 헛걸음이었다.
 */
export const POLL_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 어떤 이유로든 이 간격보다 자주 묻지 않는다.
 * 탭 전환(visibilitychange)마다 조회가 나가면 창을 왔다갔다 하는 것만으로
 * 외부 API 호출이 쌓인다.
 */
const MIN_POLL_GAP_MS = 60 * 1000;

/** 서버가 이만큼 안에 받아온 데이터면, 뜨자마자 다시 물어볼 필요가 없다. */
const FRESH_ENOUGH_MS = 5 * 60 * 1000;

/**
 * 폴링할 때 다시 받아올 구간(일).
 * 통계 기관이 최근 며칠치를 정정하는 경우가 있어 조금 겹쳐 받는다.
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

function mergeSeriesMaps(previous: SeriesMap, patch: SeriesMap): SeriesMap {
  const merged: SeriesMap = { ...previous };
  for (const [id, points] of Object.entries(patch)) {
    merged[id] = applyPatch(previous[id] ?? [], points);
  }
  return merged;
}

/** 여러 계열 중 가장 늦은 관측일 — 다음 폴링의 기준점. */
function latestDateOf(series: SeriesMap): string | null {
  let latest: string | null = null;
  for (const points of Object.values(series)) {
    const last = points.at(-1)?.date;
    if (last && (!latest || last > latest)) latest = last;
  }
  return latest;
}

type Live = {
  data: DashboardData;
  /** 마지막으로 서버에 물어본 시각 (epoch ms). 아직 폴링 전이면 null. */
  checkedAt: number | null;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
};

/**
 * 서버에서 렌더된 초기 데이터로 시작해, 이후에는 브라우저가 주기적으로
 * /api/series 를 폴링해 최신 관측치를 이어 붙인다.
 * 탭을 다시 열거나 네트워크가 복구됐을 때도 한 번 확인한다.
 */
export function useLiveDashboard(initial: DashboardData): Live {
  const [data, setData] = useState(initial);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 다음 요청의 since 를 만들기 위한 커서. state 로 두면 폴링 타이머가 매번 재설정된다.
  const cursorRef = useRef(latestDateOf(initial.series));
  const inFlightRef = useRef(false);
  const lastPollAtRef = useRef(0);

  const poll = useCallback(async (signal: AbortSignal, force = false) => {
    if (inFlightRef.current) return;
    if (!force && Date.now() - lastPollAtRef.current < MIN_POLL_GAP_MS) return;

    lastPollAtRef.current = Date.now();
    inFlightRef.current = true;
    setRefreshing(true);

    try {
      const cursor = cursorRef.current;
      const url = cursor
        ? `/api/series?since=${shiftDate(cursor, -OVERLAP_DAYS)}`
        : "/api/series";

      const res = await fetch(url, { signal, cache: "no-store" });
      if (!res.ok) throw new Error(`서버 응답 오류 (HTTP ${res.status})`);

      const next = (await res.json()) as DashboardData & { partial: boolean };

      setData((previous) => ({
        ...next,
        series: next.partial ? mergeSeriesMaps(previous.series, next.series) : next.series,
      }));

      cursorRef.current = latestDateOf(next.series) ?? cursorRef.current;
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

  // 사용자가 직접 누른 새로고침은 간격 제한을 건너뛴다.
  const refresh = useCallback(() => {
    if (controllerRef.current) void poll(controllerRef.current.signal, true);
  }, [poll]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;

    const tick = () => void poll(controller.signal);

    /*
     * 정적으로 캐시된 페이지를 받았을 수 있어 뜨자마자 한 번 확인하되,
     * 서버가 방금 받아온 데이터라면 건너뛴다. 새로고침을 반복할 때마다
     * 조회가 나가면 그것만으로 외부 API 한도를 소진한다.
     */
    const age = Date.now() - Date.parse(initial.fetchedAt);
    if (!Number.isFinite(age) || age > FRESH_ENOUGH_MS) tick();

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
  }, [poll, initial.fetchedAt]);

  return { data, checkedAt, refreshing, error, refresh };
}
