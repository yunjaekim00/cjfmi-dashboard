"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConsumptionData } from "@/lib/consumption-types";

export type ConsumptionState =
  /** 탭을 아직 열지 않았다 */
  | { status: "idle"; data: null }
  | { status: "loading"; data: ConsumptionData | null }
  | { status: "ready"; data: ConsumptionData }
  | { status: "error"; data: ConsumptionData | null; error: string };

/**
 * 국내 소비동향은 주간 자료라 첫 화면에 끼우지 않고 탭을 처음 열 때 /api/consumption 에 묻는다.
 * 서버가 6시간 캐시하므로 두 번째부터는 바로 온다. 결과는 Dashboard 가 들고 있어 탭을 오가도 다시 묻지 않는다.
 */
export function useConsumption(active: boolean) {
  const [state, setState] = useState<ConsumptionState>({ status: "idle", data: null });
  const startedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (force: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((previous) => ({ status: "loading", data: previous.data }));

    try {
      const res = await fetch(force ? "/api/consumption?refresh=1" : "/api/consumption", {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as ConsumptionData | { error?: string } | null;
      if (!res.ok || !body || !("series" in body)) {
        const message = body && "error" in body && body.error ? body.error : `서버 응답 오류 (HTTP ${res.status})`;
        throw new Error(message);
      }
      setState({ status: "ready", data: body });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setState((previous) => ({
        status: "error",
        data: previous.data,
        error: cause instanceof Error ? cause.message : "소비동향 자료를 불러오지 못했습니다.",
      }));
    }
  }, []);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    void load(false);
  }, [active, load]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reload = useCallback(() => void load(true), [load]);

  return { state, reload };
}
