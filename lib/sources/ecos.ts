import { toFiniteNumber } from "@/lib/parse";
import type { Point } from "@/lib/types";

const ECOS_BASE = "https://ecos.bok.or.kr/api/StatisticSearch";

/** 한 번에 요청하는 건수. 아래 조회 창 하나가 이보다 커질 일은 없다. */
const PAGE_SIZE = 10000;

/** 안전장치: 한 조회 창에서 이 이상은 받지 않는다. */
const MAX_PAGES = 5;

/**
 * 조회를 몇 년 단위로 쪼갤지.
 *
 * ECOS 응답 한 건이 400바이트가 넘어서 일별 30년치를 한 번에 받으면 4MB 가 넘고,
 * Next.js 의 fetch 캐시는 2MB 를 넘는 응답을 저장하지 않는다.
 * 반대로 잘게 쪼개면 요청 수가 늘어 ECOS 호출 한도(3분간 300회)에 걸린다.
 * 10년이면 일별 약 2,600건 ≈ 1.2MB 라 캐시에는 들어가면서 창 수는 4개로 줄어든다.
 */
const WINDOW_YEARS = 10;

/** 이미 지나간 구간은 값이 바뀌지 않으므로 30일 캐시. */
const PAST_REVALIDATE = 60 * 60 * 24 * 30;

/** 최신 구간만 자주 확인한다. */
const CURRENT_REVALIDATE = 60 * 10;

/** ERROR-602 를 맞으면 30분간 차단된다. 그동안은 아예 요청하지 않는다. */
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

export type EcosQuery = {
  /** 통계표코드 (예: 환율 = 731Y001) */
  statCode: string;
  /** 주기: D(일) / M(월) / Q(분기) / A(연) */
  cycle: "D" | "M" | "Q" | "A";
  /** 통계항목코드1 (예: 원/미국달러 매매기준율 = 0000001) */
  itemCode1: string;
  /** 검색 시작 (주기에 맞춘 포맷: D=YYYYMMDD, M=YYYYMM ...) */
  start: string;
  /** 검색 종료 */
  end: string;
};

type EcosRow = { TIME: string; DATA_VALUE: string };

type EcosResponse = {
  StatisticSearch?: { list_total_count: number; row: EcosRow[] };
  RESULT?: { CODE: string; MESSAGE: string };
};

export class EcosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcosError";
  }
}

/** ECOS 호출 한도(3분간 300회)에 걸린 상태. 30분간 풀리지 않는다. */
export class EcosRateLimitError extends EcosError {
  constructor(readonly retryAt: number) {
    const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60000));
    super(
      `한국은행 API 호출 한도(3분간 300회)에 걸렸습니다. 약 ${minutes}분 뒤에 자동으로 복구됩니다.`
    );
    this.name = "EcosRateLimitError";
  }
}

/**
 * 프로세스 안에 남는 캐시.
 *
 * Next.js 의 fetch 캐시는 `.next` 를 지우거나 재배포하면 통째로 날아가고,
 * 개발 중에는 핫리로드마다 무효화되기도 한다. 그때마다 ECOS 를 수십 번 다시
 * 부르면 호출 한도에 걸리므로, 파싱된 결과를 프로세스 메모리에도 들고 있는다.
 * globalThis 에 두는 건 dev 에서 모듈이 다시 평가돼도 살아남게 하기 위해서다.
 */
type MemoEntry = { points: Point[]; expiresAt: number };

const memo: Map<string, MemoEntry> = ((globalThis as Record<string, unknown>).__ecosMemo ??=
  new Map()) as Map<string, MemoEntry>;

const breaker: { blockedUntil: number } = ((globalThis as Record<string, unknown>)
  .__ecosBreaker ??= { blockedUntil: 0 }) as { blockedUntil: number };

/** 이번 렌더에서 ECOS 를 몇 번 실제로 불렀는지 (개발 중 진단용). */
let liveCalls = 0;
let memoHits = 0;

/** ECOS 의 TIME("20260825" / "202608") 을 "YYYY-MM-DD" 로 변환. */
function normalizeTime(time: string): string {
  if (time.length === 8) return `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`;
  if (time.length === 6) return `${time.slice(0, 4)}-${time.slice(4, 6)}-01`;
  if (time.length === 4) return `${time}-01-01`;
  return time;
}

/** "19900101" -> 1990 */
function yearOf(stamp: string): number {
  return Number(stamp.slice(0, 4));
}

/** 연도 경계에 맞춘 시작/끝 스탬프. 주기에 따라 자릿수가 다르다. */
function stampFor(year: number, edge: "start" | "end", width: number): string {
  if (width === 4) return String(year);
  if (width === 6) return `${year}${edge === "start" ? "01" : "12"}`;
  return `${year}${edge === "start" ? "0101" : "1231"}`;
}

type Window = { start: string; end: string; revalidate: number };

/** [start, end] 를 WINDOW_YEARS 단위로 쪼갠다. 마지막 창만 "현재"로 보고 짧게 캐시한다. */
function splitWindows(query: EcosQuery): Window[] {
  const width = query.start.length;
  const firstYear = yearOf(query.start);
  const lastYear = yearOf(query.end);
  const windows: Window[] = [];

  for (let year = firstYear; year <= lastYear; year += WINDOW_YEARS) {
    const endYear = Math.min(year + WINDOW_YEARS - 1, lastYear);
    const isLast = endYear === lastYear;

    windows.push({
      start: year === firstYear ? query.start : stampFor(year, "start", width),
      end: isLast ? query.end : stampFor(endYear, "end", width),
      revalidate: isLast ? CURRENT_REVALIDATE : PAST_REVALIDATE,
    });
  }

  return windows;
}

function buildUrl(apiKey: string, query: EcosQuery, from: number, to: number): string {
  return [
    ECOS_BASE, encodeURIComponent(apiKey), "json", "kr",
    String(from), String(to),
    query.statCode, query.cycle, query.start, query.end, query.itemCode1,
  ].join("/");
}

function assertNotBlocked() {
  if (breaker.blockedUntil > Date.now()) throw new EcosRateLimitError(breaker.blockedUntil);
}

async function fetchPage(url: string, revalidate: number) {
  assertNotBlocked();
  liveCalls += 1;

  const res = await fetch(url, { next: { revalidate } });

  if (!res.ok) throw new EcosError(`ECOS 응답 오류 (HTTP ${res.status})`);

  const json = (await res.json()) as EcosResponse;

  if (json.RESULT) {
    // 한도에 걸렸으면 남은 요청까지 밀어 넣어 상황을 악화시키지 않는다.
    if (json.RESULT.CODE === "ERROR-602") {
      breaker.blockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      throw new EcosRateLimitError(breaker.blockedUntil);
    }
    // "해당하는 데이터가 없습니다" 도 오류 코드로 돌려준다.
    if (json.RESULT.CODE === "INFO-200") return { rows: [], total: 0 };
    throw new EcosError(`ECOS ${json.RESULT.CODE}: ${json.RESULT.MESSAGE.split("\n")[0].trim()}`);
  }

  return {
    rows: json.StatisticSearch?.row ?? [],
    total: json.StatisticSearch?.list_total_count ?? 0,
  };
}

function toPoints(rows: EcosRow[]): Point[] {
  return rows
    .map((row) => ({ date: normalizeTime(row.TIME), value: toFiniteNumber(row.DATA_VALUE) }))
    .filter((point): point is Point => point.value !== null);
}

/** 조회 창 하나. 프로세스 캐시에 있으면 네트워크를 타지 않는다. */
async function fetchWindow(apiKey: string, query: EcosQuery, window: Window): Promise<Point[]> {
  const scoped: EcosQuery = { ...query, start: window.start, end: window.end };
  const key = `${scoped.statCode}/${scoped.cycle}/${scoped.itemCode1}/${scoped.start}/${scoped.end}`;

  const cached = memo.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    memoHits += 1;
    return cached.points;
  }

  const first = await fetchPage(buildUrl(apiKey, scoped, 1, PAGE_SIZE), window.revalidate);
  const rows = [...first.rows];

  const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);
  for (let page = 1; page < pages; page += 1) {
    const next = await fetchPage(
      buildUrl(apiKey, scoped, page * PAGE_SIZE + 1, (page + 1) * PAGE_SIZE),
      window.revalidate
    );
    rows.push(...next.rows);
  }

  const points = toPoints(rows);

  // 지난 구간은 값이 안 바뀌므로 오래 들고 있어도 되지만, 메모리를 감안해 상한을 둔다.
  const ttl = window.revalidate === CURRENT_REVALIDATE ? CURRENT_REVALIDATE : 60 * 60 * 6;
  memo.set(key, { points, expiresAt: Date.now() + ttl * 1000 });

  return points;
}

/**
 * 한국은행 ECOS 통계검색 API 호출.
 * 키가 없으면 EcosError 를 던진다 (호출부에서 안내 배너로 처리).
 */
export async function fetchEcosSeries(query: EcosQuery): Promise<Point[]> {
  const apiKey = process.env.ECOS_API_KEY?.trim();

  if (!apiKey) {
    throw new EcosError(
      "ECOS_API_KEY 가 설정되지 않았습니다. 로컬은 .env.local, 배포는 Vercel 의 Environment Variables 에 넣어주세요."
    );
  }

  assertNotBlocked();

  const windows = splitWindows(query);
  const chunks: Point[][] = [];

  // 창을 순차로 받는다. 한도에 걸린 순간 나머지를 쏘지 않기 위해서다.
  for (const window of windows) chunks.push(await fetchWindow(apiKey, query, window));

  return chunks.flat().sort((a, b) => a.date.localeCompare(b.date));
}

/** 한 번의 데이터 수집에서 실제 네트워크 호출이 몇 번 났는지 확인용. */
export function takeCallStats() {
  const stats = { liveCalls, memoHits };
  liveCalls = 0;
  memoHits = 0;
  return stats;
}

export function rateLimitedUntil(): number {
  return breaker.blockedUntil;
}
