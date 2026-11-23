import {
  ALTERNATE_CLS_CODE,
  CONSUMPTION_GROUP_IDS,
  CONSUMPTION_GROUPS,
  consumptionSeriesId,
  INDUSTRY_LABELS,
  MONTHLY_GROUP_IDS,
  MONTHLY_GROUPS,
  monthlySeriesId,
  type ConsumptionData,
  type ConsumptionGroupId,
} from "@/lib/consumption-types";
import { fetchEcosSeries } from "@/lib/sources/ecos";
import type { Point, SourceStatus } from "@/lib/types";

/*
 * 국내 소비동향 자료 조회 — 주간은 국가데이터처 나우캐스트, 월간은 ECOS(소매판매액지수·서비스업생산지수). 한 번에 같이 받는다.
 *
 * 주간 — 나우캐스트:
 * 포털(data.kostat.go.kr/nowcast)에는 공개 API 가 없다 — 공공데이터포털에는 연 1회 CSV 만, KOSIS 에는 표가 없다(2026-11-16 확인).
 * 그래서 포털 화면(Highcharts)이 쓰는 엔드포인트를 그대로 부른다:
 *   POST /nowcast/listIndcrDataAjax.do
 *     indcr_id=1|6 · val1=""(전국) · cd2=<업종 공통코드 그룹> · val2=<업종 코드> · wklId=52 · mode="" · initId=1|6
 *   → { data: [{ BASE_DT: epoch ms(KST 자정, 주 기준일), INDCR_VL: 52주 전 대비 비율 }], evt, evt_pr, info }
 *   wklId 는 화면의 "비교시점": 0 = 2020년 1월 기준, 1 = 지난주, 4 = 4주 전, 52 = 52주 전(전년동기대비). mode·initId 가 없으면 빈 응답.
 *   cd2·val2 를 빼면 전체. 포털은 요청이 짧은 시간에 몰리면 HTTP 200 에 빈 본문을 돌려준다 — 그래서 순차로, 간격을 두고 부르고,
 *   빈 응답이 오면 그 자리에서 멈추고 10분 쉰다. 자료는 주간(D+10 공표)이라 6시간 캐시면 충분하다.
 */

const ENDPOINT = "https://data.kostat.go.kr/nowcast/listIndcrDataAjax.do";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
/** 받아 둔 자료의 수명 */
const TTL_MS = 6 * 60 * 60 * 1000;
/** 빈 응답·오류 뒤 다시 묻기까지 */
const FAIL_BACKOFF_MS = 10 * 60 * 1000;
/** 요청 사이 간격 */
const GAP_MS = 300;
class EmptyResponseError extends Error {
  constructor() {
    super("포털이 빈 응답을 돌려줬습니다 (요청이 몰리면 그렇습니다). 잠시 뒤 다시 시도합니다.");
    this.name = "EmptyResponseError";
  }
}

/** 주간·월간은 출처가 달라 캐시도 따로 둔다 — 한쪽이 막혀도 다른 쪽은 그대로 쓴다 */
type PartKind = "weekly" | "monthly";
type PartResult = { part: Part; stale: string | null };
type PartMemo = {
  part: Part | null;
  expiresAt: number;
  failedAt: number;
  failure: string | null;
  inflight: Promise<PartResult> | null;
  /** 받을 때의 계열 구성(id 목록). 항목을 추가·삭제해 구성이 달라지면 TTL 이 남았어도 다시 받는다 */
  configKey: string;
};
const memo: Record<PartKind, PartMemo> = ((globalThis as Record<string, unknown>).__consumptionParts ??= {
  weekly: { part: null, expiresAt: 0, failedAt: 0, failure: null, inflight: null, configKey: "" },
  monthly: { part: null, expiresAt: 0, failedAt: 0, failure: null, inflight: null, configKey: "" },
}) as Record<PartKind, PartMemo>;

/** 설정상 받아야 할 계열 id — 캐시의 구성 비교용 */
function expectedIds(kind: PartKind): string[] {
  if (kind === "weekly") {
    return CONSUMPTION_GROUP_IDS.flatMap((group) => [
      consumptionSeriesId(group, "total"),
      ...CONSUMPTION_GROUPS[group].industries.map((code) => consumptionSeriesId(group, code)),
    ]);
  }
  return MONTHLY_GROUP_IDS.flatMap((group) => MONTHLY_GROUPS[group].items.map((item) => monthlySeriesId(group, item.code)));
}
const LABEL: Record<PartKind, string> = { weekly: "주간(나우캐스트)", monthly: "월간(ECOS)" };

type Row = { BASE_DT?: number; INDCR_VL?: number | null };

function kstDate(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 계열 하나 — 전년동기대비 %. code 가 없으면 전체. */
async function fetchYoY(group: ConsumptionGroupId, code: string | null, clsCode: string): Promise<Point[]> {
  const def = CONSUMPTION_GROUPS[group];
  const body = new URLSearchParams({
    indcr_id: String(def.indcrId),
    val1: "",
    wklId: "52",
    mode: "",
    initId: String(def.initId),
  });
  if (code) {
    body.set("cd2", clsCode);
    body.set("val2", code);
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`나우캐스트 응답 오류 (HTTP ${res.status})`);

  const text = await res.text();
  if (!text.trim()) throw new EmptyResponseError();

  let json: { data?: Row[] };
  try {
    json = JSON.parse(text) as { data?: Row[] };
  } catch {
    throw new Error(`JSON 이 아님 (${text.slice(0, 40).replace(/\s+/g, " ")}…)`);
  }

  const byDate = new Map<string, number>();
  for (const row of json.data ?? []) {
    if (typeof row.BASE_DT !== "number" || typeof row.INDCR_VL !== "number" || !Number.isFinite(row.INDCR_VL)) continue;
    byDate.set(kstDate(row.BASE_DT), Number((row.INDCR_VL * 100).toFixed(2)));
  }
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

function labelOf(group: ConsumptionGroupId, code: string | null): string {
  return `${CONSUMPTION_GROUPS[group].label} · ${code ? (INDUSTRY_LABELS[code] ?? code) : "전체"}`;
}

type Part = { series: Record<string, Point[]>; status: SourceStatus[]; failure: string | null; fetchedAt: string };

/** 주간(나우캐스트) — 전 계열을 순차로 받는다. 빈 응답이 나오면 거기서 멈춘다 — 더 보내 봐야 다 비어 오고 차단만 길어진다. */
async function loadWeekly(): Promise<Part> {
  const series: Record<string, Point[]> = {};
  const status: SourceStatus[] = [];
  let throttled: string | null = null;

  const one = async (group: ConsumptionGroupId, code: string | null, clsCode: string): Promise<boolean> => {
    const id = consumptionSeriesId(group, code ?? "total");
    const label = labelOf(group, code);
    if (throttled) {
      status.push({ key: id, label, ok: false, count: 0, message: throttled });
      return false;
    }
    try {
      const points = await fetchYoY(group, code, clsCode);
      series[id] = points;
      status.push({
        key: id,
        label,
        ok: points.length > 0,
        count: points.length,
        message: points.length ? undefined : "응답에 데이터가 없습니다.",
      });
      await sleep(GAP_MS);
      return points.length > 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      if (error instanceof EmptyResponseError) throttled = message;
      status.push({ key: id, label, ok: false, count: 0, message });
      return false;
    }
  };

  for (const group of CONSUMPTION_GROUP_IDS) {
    const def = CONSUMPTION_GROUPS[group];
    await one(group, null, def.clsCode);

    let got = 0;
    for (const code of def.industries) if (await one(group, code, def.clsCode)) got += 1;

    // 업종이 하나도 안 오면 같은 코드를 10개 업종 그룹으로 한 번 더 — 지표별 그룹 배정이 추정이라서 (consumption-types.ts 참고)
    if (!got && !throttled) {
      console.warn(`[consumption] ${def.label}: ${def.clsCode} 업종이 모두 비어 ${ALTERNATE_CLS_CODE} 로 다시 시도합니다.`);
      for (const code of def.industries) await one(group, code, ALTERNATE_CLS_CODE);
    }
  }

  return {
    series,
    status,
    failure: throttled ?? (status.some((s) => s.ok) ? null : (status[0]?.message ?? null)),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 월간(ECOS) — 소매판매액지수·서비스업생산지수의 경상지수. 계열끼리는 병렬로 받는다
 * (ECOS 는 자체 상한(3분 120회) 안이면 동시 호출이 괜찮고, 계열당 10년 창 2~3개라 다 합쳐 20회 안팎).
 * 전년동월대비는 저장하지 않고 화면에서 지수로 계산한다(consumption-types.ts 의 yoySeries).
 */
async function loadMonthly(): Promise<Part> {
  const end = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7).replace("-", "");
  const jobs = MONTHLY_GROUP_IDS.flatMap((group) => {
    const def = MONTHLY_GROUPS[group];
    return def.items.map(async (item): Promise<{ id: string; points: Point[]; status: SourceStatus }> => {
      const id = monthlySeriesId(group, item.code);
      const label = `${def.label} · ${item.label}`;
      try {
        const points = await fetchEcosSeries({
          statCode: def.statCode,
          cycle: "M",
          itemCode1: item.code,
          itemCode2: def.itemCode2,
          start: def.start,
          end,
        });
        return {
          id,
          points,
          status: {
            key: id,
            label,
            ok: points.length > 0,
            count: points.length,
            message: points.length ? undefined : "응답에 데이터가 없습니다.",
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        return { id, points: [], status: { key: id, label, ok: false, count: 0, message } };
      }
    });
  });

  const series: Record<string, Point[]> = {};
  const status: SourceStatus[] = [];
  for (const result of await Promise.all(jobs)) {
    if (result.points.length) series[result.id] = result.points;
    status.push(result.status);
  }
  return {
    series,
    status,
    failure: status.some((s) => s.ok) ? null : (status[0]?.message ?? null),
    fetchedAt: new Date().toISOString(),
  };
}

const LOADERS: Record<PartKind, () => Promise<Part>> = { weekly: loadWeekly, monthly: loadMonthly };

/**
 * 한 부분(주간 또는 월간)을 캐시에서 주거나 새로 받는다. 6시간 캐시, 동시 요청은 하나로 합친다.
 * 실패하면 받아 둔 것이 있을 때 그것을 stale 사유와 함께 주고, 없으면 throw. 실패 뒤 10분은 다시 묻지 않는다.
 */
async function getPart(kind: PartKind, force: boolean): Promise<PartResult> {
  const slot = memo[kind];
  const now = Date.now();
  const configKey = expectedIds(kind).join(",");
  if (!force && slot.part && slot.expiresAt > now && slot.configKey === configKey) return { part: slot.part, stale: null };
  if (slot.inflight) return slot.inflight;

  if (!force && slot.failedAt && now - slot.failedAt < FAIL_BACKOFF_MS) {
    if (slot.part) return { part: slot.part, stale: slot.failure ?? "최근 조회 실패" };
    throw new Error(slot.failure ?? `${LABEL[kind]} 조회에 실패해 잠시 쉬는 중입니다.`);
  }

  slot.inflight = (async (): Promise<PartResult> => {
    try {
      const part = await LOADERS[kind]();
      if (!Object.values(part.series).some((points) => points.length)) {
        throw new Error(part.failure ?? `${LABEL[kind]} 자료를 받지 못했습니다.`);
      }
      // 일부 계열만 못 받았으면(주간은 빈 응답으로 중간에 끊긴다) 그 계열은 지난 자료로 메운다
      if (slot.part) {
        for (const [id, points] of Object.entries(slot.part.series)) {
          if (!part.series[id]?.length) part.series[id] = points;
        }
      }
      slot.part = part;
      slot.expiresAt = Date.now() + TTL_MS;
      slot.failedAt = 0;
      slot.failure = null;
      slot.configKey = configKey;
      return { part, stale: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      slot.failedAt = Date.now();
      slot.failure = message;
      console.warn(`[consumption] ${LABEL[kind]} 조회 실패:`, message);
      if (slot.part) return { part: slot.part, stale: message };
      throw error;
    } finally {
      slot.inflight = null;
    }
  })();

  return slot.inflight;
}

function latestDate(series: Record<string, Point[]>, match: (id: string) => boolean): string | null {
  let latest: string | null = null;
  for (const [id, points] of Object.entries(series)) {
    if (!match(id)) continue;
    const last = points.at(-1)?.date;
    if (last && (!latest || last > latest)) latest = last;
  }
  return latest;
}

/**
 * 소비동향 자료 한 벌 — 주간과 월간을 따로 받아 합친다. 둘 다 못 받았을 때만 throw.
 * 한쪽만 실패하면 그 부분은 status 한 줄(key "weekly" / "m:all")로 알리고, 받아 둔 것을 썼으면 stale 에 사유를 적는다.
 */
export async function getConsumptionData(force = false): Promise<ConsumptionData> {
  const kinds: PartKind[] = ["weekly", "monthly"];
  const results = await Promise.allSettled(kinds.map((kind) => getPart(kind, force)));

  if (results.every((result) => result.status === "rejected")) {
    const reason = (results[0] as PromiseRejectedResult).reason;
    throw reason instanceof Error ? reason : new Error("소비동향 자료를 받지 못했습니다.");
  }

  const series: Record<string, Point[]> = {};
  const status: SourceStatus[] = [];
  const stale: string[] = [];
  const fetchedAts: string[] = [];
  kinds.forEach((kind, index) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      Object.assign(series, result.value.part.series);
      status.push(...result.value.part.status);
      fetchedAts.push(result.value.part.fetchedAt);
      if (result.value.stale) stale.push(`${LABEL[kind]}: ${result.value.stale}`);
    } else {
      const message = result.reason instanceof Error ? result.reason.message : "알 수 없는 오류";
      status.push({ key: kind === "weekly" ? "weekly" : "m:all", label: LABEL[kind], ok: false, count: 0, message });
    }
  });

  const isMonthly = (id: string) => id.startsWith("m:");
  return {
    series,
    status,
    // 둘 중 먼저 받은 시각 — "언제 자료인가"는 오래된 쪽이 기준이다
    fetchedAt: fetchedAts.sort()[0] ?? new Date().toISOString(),
    latestWeek: latestDate(series, (id) => !isMonthly(id)),
    latestMonth: latestDate(series, isMonthly),
    ...(stale.length ? { stale: stale.join(" / ") } : {}),
  };
}
