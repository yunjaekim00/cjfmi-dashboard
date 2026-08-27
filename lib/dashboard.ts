import { SERIES, USED_SERIES_IDS, type SeriesDef, type SeriesId } from "@/lib/catalog";
import { thinForTransfer } from "@/lib/downsample";
import { EcosError, fetchEcosSeries, takeCallStats } from "@/lib/sources/ecos";
import { fetchFredSeries } from "@/lib/sources/fred";
import type { DashboardData, Point, SeriesMap, SourceStatus } from "@/lib/types";

/** 동시에 열어 둘 외부 요청 수. ECOS 를 한꺼번에 수십 개 때리지 않도록 묶는다. */
const CONCURRENCY = 3;

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function toStamp(iso: string, cycle: "D" | "M"): string {
  return cycle === "D" ? iso.replaceAll("-", "") : iso.slice(0, 7).replace("-", "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Options = {
  /**
   * 이 날짜 이후만 받아온다 ("YYYY-MM-DD").
   *
   * 브라우저 폴링은 최근 며칠치만 필요한데, 매번 전체 이력을 다시 받으면
   * 4KB 짜리 응답 하나에 ECOS 호출 수십 번이 나간다. since 가 있으면
   * 조회 구간 자체를 좁혀서 계열당 요청 1건으로 끝낸다.
   */
  since?: string;
};

async function loadSeries(
  id: SeriesId,
  options: Options
): Promise<{ id: SeriesId; data: Point[]; status: SourceStatus }> {
  const def: SeriesDef = SERIES[id];
  const incremental = Boolean(options.since);

  try {
    const data =
      def.source === "ecos"
        ? await fetchEcosSeries({
            statCode: def.statCode,
            cycle: def.cycle,
            itemCode1: def.itemCode1,
            start: options.since ? toStamp(options.since, def.cycle) : def.start,
            end: toStamp(today(), def.cycle),
          })
        : await fetchFredSeries(def.seriesId, options.since ?? def.start);

    return {
      id,
      data,
      // 증분 조회는 연휴에 0건이 나올 수 있으므로 그것만으로 실패로 보지 않는다.
      status: {
        key: id,
        label: def.label,
        ok: incremental || data.length > 0,
        count: data.length,
        message: incremental || data.length ? undefined : "응답에 데이터가 없습니다.",
      },
    };
  } catch (error) {
    const message =
      error instanceof EcosError || error instanceof Error ? error.message : "알 수 없는 오류";
    console.warn(`[${id}] 데이터 조회 실패:`, message);
    return { id, data: [], status: { key: id, label: def.label, ok: false, count: 0, message } };
  }
}

/**
 * 화면에 필요한 모든 계열을 모아 온다.
 * 한 계열이 실패해도 나머지는 그대로 렌더링되고, 실패 사유만 status 로 올라간다.
 *
 * 전체 조회일 때는 최근 5년만 일별 원본이고 그 이전은 LTTB 로 솎아서 보낸다 —
 * 차트가 실제로 그릴 수 있는 점 수를 넘는 만큼은 전송해 봐야 보이지도 않는다.
 */
export async function getDashboardData(options: Options = {}): Promise<DashboardData> {
  const loaded = await mapLimit(USED_SERIES_IDS, CONCURRENCY, (id) => loadSeries(id, options));

  const series: SeriesMap = {};
  for (const entry of loaded) {
    series[entry.id] = options.since ? entry.data : thinForTransfer(entry.data);
  }

  const { liveCalls, memoHits } = takeCallStats();
  if (liveCalls > 0) {
    console.log(
      `[ecos] 실제 호출 ${liveCalls}회 · 프로세스 캐시 적중 ${memoHits}회` +
        (options.since ? ` (증분: ${options.since} 이후)` : " (전체)")
    );
  }

  return {
    series,
    status: loaded.map((entry) => entry.status),
    fetchedAt: new Date().toISOString(),
  };
}
