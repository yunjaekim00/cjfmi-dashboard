"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { WeeklyBrief } from "@/lib/weekly-types";

export type WeeklyState =
  /** 탭을 아직 열지 않았다 */
  | { status: "idle"; brief: null }
  /** 서버가 뉴스를 읽고 요약하는 중. 다시 생성 중이면 이전 결과를 들고 있다. */
  | { status: "loading"; brief: WeeklyBrief | null }
  | { status: "ready"; brief: WeeklyBrief }
  | { status: "error"; brief: WeeklyBrief | null; error: string };

/**
 * 주간 모니터링은 만드는 데 1~2분이 걸리고(웹 검색 + 요약) 비용이 들어서,
 * 첫 화면에 끼우지 않고 탭을 처음 열 때 한 번만 /api/weekly 에 묻는다.
 * 서버가 하루 단위로 캐시하므로 두 번째부터는 바로 온다.
 * 결과는 Dashboard 에 들고 있어서 탭을 오가도 다시 묻지 않는다.
 */
export function useWeeklyBrief(active: boolean) {
  const [state, setState] = useState<WeeklyState>({ status: "idle", brief: null });

  const startedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (force: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState((previous) => ({ status: "loading", brief: previous.brief }));

    try {
      // 주소에 ?sample=1 이 있으면 모델을 부르지 않는 참고 원문을 받는다 (레이아웃 확인용).
      const sample = new URLSearchParams(window.location.search).get("sample") === "1";
      // 다시 생성은 POST — 서버 캐시를 비우고 새로 만든다.
      const res = await fetch(sample && !force ? "/api/weekly?sample=1" : "/api/weekly", {
        method: force ? "POST" : "GET",
        cache: "no-store",
        signal: controller.signal,
      });

      const body = (await res.json().catch(() => null)) as
        | WeeklyBrief
        | { error?: string }
        | null;

      if (!res.ok || !body || !("issue" in body)) {
        const message =
          body && "error" in body && body.error
            ? body.error
            : `서버 응답 오류 (HTTP ${res.status})`;
        throw new Error(message);
      }

      setState({ status: "ready", brief: body });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setState((previous) => ({
        status: "error",
        brief: previous.brief,
        error: cause instanceof Error ? cause.message : "주간 모니터링을 불러오지 못했습니다.",
      }));
    }
  }, []);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    void load(false);
  }, [active, load]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const regenerate = useCallback(() => void load(true), [load]);

  return { state, regenerate };
}
