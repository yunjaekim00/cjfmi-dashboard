import type { Point } from "@/lib/types";

/**
 * LTTB(Largest-Triangle-Three-Buckets).
 * 균등 간격으로 솎아내면 1997년 환율 급등 같은 뾰족한 극값이 잘려 나간다.
 * LTTB 는 각 구간에서 "면적이 가장 큰" 점을 남겨 선의 모양을 보존한다.
 */
export function lttb(points: Point[], threshold: number): Point[] {
  const n = points.length;
  if (threshold >= n || threshold < 3) return points;

  const sampled: Point[] = [points[0]];
  const bucketSize = (n - 2) / (threshold - 2);
  let anchor = 0;

  for (let i = 0; i < threshold - 2; i += 1) {
    // 다음 구간의 무게중심
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j += 1) {
      avgX += j;
      avgY += points[j].value;
    }
    const count = nextEnd - nextStart;
    if (count > 0) {
      avgX /= count;
      avgY /= count;
    } else {
      avgX = nextStart;
      avgY = points[Math.min(nextStart, n - 1)].value;
    }

    // 현재 구간에서 (앞점, 후보, 다음 구간 무게중심) 삼각형이 가장 큰 점을 고른다
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.floor((i + 1) * bucketSize) + 1;
    const anchorValue = points[anchor].value;

    let bestArea = -1;
    let chosen = start;

    for (let j = start; j < end && j < n; j += 1) {
      const area =
        Math.abs(
          (anchor - avgX) * (points[j].value - anchorValue) -
            (anchor - j) * (avgY - anchorValue)
        ) / 2;

      if (area > bestArea) {
        bestArea = area;
        chosen = j;
      }
    }

    sampled.push(points[chosen]);
    anchor = chosen;
  }

  sampled.push(points[n - 1]);
  return sampled;
}

/**
 * 전송량을 줄이기 위한 해상도 조절.
 *
 * 차트가 실제로 그릴 수 있는 점은 화면 폭만큼(약 1,400개)이라, 30년치 일별 자료를
 * 그대로 브라우저에 보내는 건 낭비다. 최근 `dailyYears` 년은 일별 그대로 두고
 * (1M~5Y 구간을 원본 해상도로 보려면 필요하다) 그보다 과거만 LTTB 로 솎아낸다.
 */
export function thinForTransfer(points: Point[], dailyYears = 5, historyBudget = 900): Point[] {
  if (points.length < 2) return points;

  const cutoff = new Date(Date.parse(`${points[points.length - 1].date}T00:00:00Z`));
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - dailyYears);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const splitAt = points.findIndex((point) => point.date >= cutoffDate);
  if (splitAt <= 0) return points;

  return [...lttb(points.slice(0, splitAt), historyBudget), ...points.slice(splitAt)];
}
