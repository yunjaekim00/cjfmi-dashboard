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
 * ECOS 응답 한 건이 400바이트가 넘어서 일별 30년치를 한 번에 받으면 4MB가 넘고,
 * Next.js 의 fetch 캐시는 2MB 를 넘는 응답을 저장하지 않는다(캐시 미스가 계속 남).
 * 5년(약 1,300건, 600KB) 단위로 끊으면 창마다 캐시에 들어가고,
 * 과거 창은 값이 변하지 않으므로 훨씬 길게 캐시할 수 있다.
 */
const WINDOW_YEARS = 5;

/** 이미 지나간 구간은 값이 바뀌지 않으므로 30일 캐시. */
const PAST_REVALIDATE = 60 * 60 * 24 * 30;

/** 최신 구간만 자주 확인한다. 브라우저는 5분마다 폴링하지만 실제 호출은 10분에 한 번. */
const CURRENT_REVALIDATE = 60 * 10;

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

type EcosRow = {
  TIME: string;
  DATA_VALUE: string;
  UNIT_NAME?: string;
  ITEM_NAME1?: string;
};

type EcosResponse = {
  StatisticSearch?: {
    list_total_count: number;
    row: EcosRow[];
  };
  RESULT?: {
    CODE: string;
    MESSAGE: string;
  };
};

export class EcosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcosError";
  }
}

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

/**
 * [start, end] 를 WINDOW_YEARS 단위로 쪼갠다.
 * 마지막 창만 "현재"로 보고 짧게 캐시한다.
 */
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
    ECOS_BASE,
    encodeURIComponent(apiKey),
    "json",
    "kr",
    String(from),
    String(to),
    query.statCode,
    query.cycle,
    query.start,
    query.end,
    query.itemCode1,
  ].join("/");
}

async function fetchPage(url: string, revalidate: number) {
  const res = await fetch(url, { next: { revalidate } });

  if (!res.ok) {
    throw new EcosError(`ECOS 응답 오류 (HTTP ${res.status})`);
  }

  const json = (await res.json()) as EcosResponse;

  if (json.RESULT) {
    // ECOS 는 "해당하는 데이터가 없습니다" 도 오류 코드로 돌려준다.
    if (json.RESULT.CODE === "INFO-200") return { rows: [], total: 0 };
    throw new EcosError(`ECOS ${json.RESULT.CODE}: ${json.RESULT.MESSAGE.split("\n")[0].trim()}`);
  }

  return {
    rows: json.StatisticSearch?.row ?? [],
    total: json.StatisticSearch?.list_total_count ?? 0,
  };
}

/** 조회 창 하나를 통째로 받는다 (건수가 많으면 페이지를 이어받음). */
async function fetchWindow(apiKey: string, query: EcosQuery, window: Window): Promise<EcosRow[]> {
  const scoped: EcosQuery = { ...query, start: window.start, end: window.end };

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

  return rows;
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

  const windows = splitWindows(query);
  const chunks = await Promise.all(windows.map((window) => fetchWindow(apiKey, query, window)));

  return chunks
    .flat()
    .map((row) => ({
      date: normalizeTime(row.TIME),
      value: toFiniteNumber(row.DATA_VALUE),
    }))
    .filter((point): point is Point => point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
