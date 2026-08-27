import { SERIES, USED_SERIES_IDS, type SeriesId } from "@/lib/catalog";
import { thinForTransfer } from "@/lib/downsample";
import { EcosError, fetchEcosSeries } from "@/lib/sources/ecos";
import { fetchFredSeries } from "@/lib/sources/fred";
import type { DashboardData, Point, SeriesMap, SourceStatus } from "@/lib/types";

/** 동시에 열어 둘 외부 요청 수. ECOS 를 한꺼번에 수십 개 때리지 않도록 묶는다. */
const CONCURRENCY = 4;

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

function todayFor(cycle: "D" | "M"): string {
  const iso = new Date().toISOString().slice(0, 10);
  return cycle === "D" ? iso.replaceAll("-", "") : iso.slice(0, 7).replace("-", "");
}

async function loadSeries(id: SeriesId): Promise<{ id: SeriesId; data: Point[]; status: SourceStatus }> {
  const def = SERIES[id];

  try {
    const data =
      def.source === "ecos"
        ? await fetchEcosSeries({
            statCode: def.statCode,
            cycle: def.cycle,
            itemCode1: def.itemCode1,
            start: def.start,
            end: todayFor(def.cycle),
          })
        : await fetchFredSeries(def.seriesId, def.start);

    return {
      id,
      data,
      status: {
        key: id,
        label: def.label,
        ok: data.length > 0,
        count: data.length,
        message: data.length ? undefined : "응답에 데이터가 없습니다.",
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
 * 각 계열은 최근 5년만 일별 원본이고 그 이전은 LTTB 로 솎아서 보낸다 —
 * 차트가 실제로 그릴 수 있는 점 수를 넘는 만큼은 전송해 봐야 보이지도 않는다.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const loaded = await mapLimit(USED_SERIES_IDS, CONCURRENCY, loadSeries);

  const series: SeriesMap = {};
  for (const entry of loaded) series[entry.id] = thinForTransfer(entry.data);

  return {
    series,
    status: loaded.map((entry) => entry.status),
    fetchedAt: new Date().toISOString(),
  };
}
