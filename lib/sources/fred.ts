import { toFiniteNumber } from "@/lib/parse";
import type { Point } from "@/lib/types";

/**
 * FRED 시계열.
 * FRED_API_KEY 가 있으면 공식 JSON API 를, 없으면 키가 필요 없는
 * fredgraph CSV 엔드포인트를 사용한다. 둘 다 같은 데이터를 준다.
 */
export async function fetchFredSeries(
  seriesId: string,
  observationStart = "1990-01-01"
): Promise<Point[]> {
  const apiKey = process.env.FRED_API_KEY;

  return apiKey
    ? fetchViaJsonApi(seriesId, observationStart, apiKey)
    : fetchViaCsv(seriesId, observationStart);
}

async function fetchViaJsonApi(
  seriesId: string,
  observationStart: string,
  apiKey: string
): Promise<Point[]> {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", observationStart);

  const res = await fetch(url, { next: { revalidate: 60 * 60 * 6 } });

  if (!res.ok) {
    throw new Error(`FRED 응답 오류 (HTTP ${res.status})`);
  }

  const json = (await res.json()) as {
    observations?: Array<{ date: string; value: string }>;
  };

  return (json.observations ?? [])
    .map((row) => ({ date: row.date, value: toFiniteNumber(row.value) }))
    .filter((point): point is Point => point.value !== null);
}

async function fetchViaCsv(seriesId: string, observationStart: string): Promise<Point[]> {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", seriesId);
  url.searchParams.set("cosd", observationStart);

  const res = await fetch(url, { next: { revalidate: 60 * 60 * 6 } });

  if (!res.ok) {
    throw new Error(`FRED CSV 응답 오류 (HTTP ${res.status})`);
  }

  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);

  // 첫 줄은 헤더: "observation_date,DEXKOUS" (예전 포맷은 "DATE,DEXKOUS")
  return lines
    .slice(1)
    .map((line) => {
      const [date, raw] = line.split(",");
      return { date: date?.trim() ?? "", value: toFiniteNumber(raw) };
    })
    .filter((point): point is Point => point.date.length === 10 && point.value !== null);
}
