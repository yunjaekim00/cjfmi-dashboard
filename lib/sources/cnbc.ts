import { fetchCnbcQuotes } from "@/lib/market-live";
import type { Point, SeriesMap } from "@/lib/types";

/**
 * CNBC 환율 시계열 — 과거는 종가, 오늘은 실시간 시세 (사용자 지시, 2026-11-16).
 *
 * 이력: ts-api.cnbc.com/harmony/app/charts/<범위>.json?symbol=… (키 없음, 비공식 — 예고 없이 바뀔 수 있다).
 *   범위 이름과 실제 응답이 다르다 (2026-11-16 확인). 일별은 "6M" 이 가장 길다:
 *     6M  → 최근 3년 일별 봉 (1M·YTD 는 1년, 3M·1Y 는 2년 일별)
 *     10Y → 2011년부터 주별 봉 (5Y 는 2016년부터 주별)
 *     ALL → 1980년부터 분기별 봉 (쓰지 않는다)
 *   3년 전까지는 일별, 그 앞은 주별을 이어 붙여 5Y·10Y·전체 구간도 볼 수 있게 한다. 봉의 tradeTime 은 뉴욕 날짜이고 close 만 쓴다.
 * 실시간: 시세 조회(quote.cnbc.com, lib/market-live.ts)의 지금 값을 오늘(KST) 점으로 넣는다 — 주간 모니터링 탭과 같은 기준.
 */

const BASE = "https://ts-api.cnbc.com/harmony/app/charts";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

type Range = { name: "6M" | "10Y"; revalidate: number };
/** 일별 봉(최근 3년) — 오늘 봉은 실시간 시세가 덮어쓰므로 10분 캐시면 된다 */
const DAILY: Range = { name: "6M", revalidate: 60 * 10 };
/** 주별 봉(2011년~) — 일별이 없는 그 앞 구간에만 쓴다. 지난 봉은 바뀌지 않는다 */
const WEEKLY: Range = { name: "10Y", revalidate: 60 * 60 * 6 };

/** 실시간 시세 캐시 — 새로고침이 몰려도 CNBC 를 분당 한 번만 부른다 */
const LIVE_TTL_MS = 60 * 1000;
/** 429·403 을 받으면 이 시간 동안 이력 조회를 쉰다 — 차단을 키우지 않기 위해서다 */
const BACKOFF_MS = 15 * 60 * 1000;

type Bar = { close?: string; tradeTime?: string };
type ChartResponse = { barData?: { priceBars?: Bar[] } };

export class CnbcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CnbcError";
  }
}

/*
 * 프로세스 안에 남는 캐시와 차단 상태. Next.js 의 fetch 캐시는 개발 중 핫리로드마다
 * 무효화되기도 하므로(lib/sources/ecos.ts 와 같은 이유) 파싱된 결과를 메모리에도 들고 있는다.
 */
type MemoEntry = { points: Point[]; expiresAt: number };
const memo: Map<string, MemoEntry> = ((globalThis as Record<string, unknown>).__cnbcSeriesMemo ??=
  new Map()) as Map<string, MemoEntry>;
const backoff: { until: number; status: number } = ((globalThis as Record<string, unknown>)
  .__cnbcSeriesBackoff ??= { until: 0, status: 0 }) as { until: number; status: number };

type LiveQuote = { value: number; time: string | null };
type LiveMemo = { quotes: Map<string, LiveQuote>; expiresAt: number };
const liveMemo: Map<string, LiveMemo> = ((globalThis as Record<string, unknown>).__cnbcLiveMemo ??=
  new Map()) as Map<string, LiveMemo>;

function kstTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

/** 오늘(KST) "YYYY-MM-DD" */
function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** "20261113000000" → "2026-11-13". 같은 날 봉이 둘이면 뒤의 것. 0 이하는 빈 봉이라 버린다. */
function toPoints(bars: Bar[]): Point[] {
  const byDate = new Map<string, number>();
  for (const bar of bars) {
    const stamp = String(bar.tradeTime ?? "");
    if (!/^\d{8}/.test(stamp)) continue;
    const value = Number(bar.close);
    if (!Number.isFinite(value) || value <= 0) continue;
    byDate.set(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`, value);
  }
  return [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

/** 범위 하나의 봉 전부. 프로세스 캐시 → fetch 캐시 순으로 본다. */
async function fetchRange(symbol: string, range: Range): Promise<Point[]> {
  const key = `${symbol}/${range.name}`;
  const cached = memo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.points;

  if (backoff.until > Date.now()) {
    throw new CnbcError(`CNBC 가 HTTP ${backoff.status} 를 돌려줘 ${kstTime(backoff.until)} 까지 조회를 쉽니다.`);
  }

  const url = `${BASE}/${range.name}.json?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: range.revalidate },
  });

  if (res.status === 429 || res.status === 403) {
    backoff.until = Date.now() + BACKOFF_MS;
    backoff.status = res.status;
    throw new CnbcError(`CNBC 가 HTTP ${res.status} 를 돌려줘 ${kstTime(backoff.until)} 까지 조회를 쉽니다.`);
  }
  if (!res.ok) throw new CnbcError(`CNBC 응답 오류 (HTTP ${res.status})`);

  const json = (await res.json()) as ChartResponse;
  const points = toPoints(json.barData?.priceBars ?? []);
  if (!points.length) throw new CnbcError(`CNBC ${symbol} ${range.name}: 응답에 봉이 없습니다.`);

  memo.set(key, { points, expiresAt: Date.now() + range.revalidate * 1000 });
  return points;
}

/**
 * 심볼 하나의 종가 시계열 — 최근 3년 일별, 그 앞은 2011년부터 주별. since 가 있으면 그 날짜 이후만
 * (일별 범위 안이면 요청 한 번으로 끝난다). scale 은 값에 곱한다 (원/엔: 1엔당 원 × 100).
 * 돌려주는 배열은 새것이라 부르는 쪽이 고쳐도 캐시가 안 바뀐다.
 */
export async function fetchCnbcSeries(
  symbol: string,
  options: { since?: string; scale?: number } = {}
): Promise<Point[]> {
  const daily = await fetchRange(symbol, DAILY);
  let points = daily;

  if (!options.since || options.since < daily[0].date) {
    // 주별은 없어도 일별만으로 그릴 수 있으니 실패해도 멈추지 않는다.
    const weekly = await fetchRange(symbol, WEEKLY).catch((error: unknown) => {
      console.warn(`[cnbc] ${symbol} 주별 이력 조회 실패 — 일별만 씁니다:`, error instanceof Error ? error.message : error);
      return [] as Point[];
    });
    const firstDaily = daily[0].date;
    points = [...weekly.filter((p) => p.date < firstDaily), ...daily];
  }

  if (options.since) {
    const since = options.since;
    points = points.filter((p) => p.date >= since);
  }

  const scale = options.scale ?? 1;
  return points.map((p) => ({ date: p.date, value: scale === 1 ? p.value : Number((p.value * scale).toFixed(6)) }));
}

// ───────────────────────── 실시간 ─────────────────────────

async function liveQuotes(symbols: string[]): Promise<Map<string, LiveQuote>> {
  const key = [...symbols].sort().join("|");
  const cached = liveMemo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.quotes;

  const quotes = new Map<string, LiveQuote>();
  for (const [symbol, quote] of await fetchCnbcQuotes(symbols)) quotes.set(symbol, { value: quote.value, time: quote.time });
  liveMemo.set(key, { quotes, expiresAt: Date.now() + LIVE_TTL_MS });
  return quotes;
}

export type CnbcLiveTarget = { id: string; symbol: string; scale?: number };

/**
 * 계열들의 오늘(KST) 점을 실시간 시세로 넣는다 — 마지막 점이 오늘이면 바꾸고, 아니면 덧붙인다.
 * 절대 throw 하지 않는다: 시세를 못 받으면 봉 그대로 둔다 (마지막 봉도 장중치라 크게 틀리지 않는다).
 * 이력이 없는 계열은 시세만으로 점 하나를 만들지 않는다.
 */
export async function overlayCnbcLive(targets: CnbcLiveTarget[], series: SeriesMap): Promise<void> {
  if (!targets.length) return;

  let quotes: Map<string, LiveQuote>;
  try {
    quotes = await liveQuotes([...new Set(targets.map((target) => target.symbol))]);
  } catch (error) {
    console.warn("[cnbc] 실시간 시세 조회 실패 — 봉 그대로 둡니다:", error instanceof Error ? error.message : error);
    return;
  }

  const today = todayKst();
  for (const target of targets) {
    const quote = quotes.get(target.symbol);
    const points = series[target.id];
    if (!quote || !points?.length) continue;

    const value = Number((quote.value * (target.scale ?? 1)).toFixed(6));
    const last = points[points.length - 1];
    if (last.date === today) points[points.length - 1] = { date: today, value };
    else if (last.date < today) points.push({ date: today, value });
  }
}
