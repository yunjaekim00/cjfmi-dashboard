import { toFiniteNumber } from "@/lib/parse";
import type { Point } from "@/lib/types";

const ECOS_BASE = "https://ecos.bok.or.kr/api/StatisticSearch";

/**
 * 한 번에 요청하는 건수. ECOS 는 요청 건수 상한이 있어서
 * list_total_count 를 보고 나머지 페이지를 이어 받는다.
 */
const PAGE_SIZE = 10000;

/** 안전장치: 이 이상은 받지 않는다 (일별 환율 30년치도 1만 건 미만). */
const MAX_PAGES = 10;

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

async function fetchPage(url: string): Promise<{ rows: EcosRow[]; total: number }> {
  const res = await fetch(url, {
    // 환율은 하루 한 번 갱신되므로 6시간 캐시로 충분하다.
    next: { revalidate: 60 * 60 * 6 },
  });

  if (!res.ok) {
    throw new EcosError(`ECOS 응답 오류 (HTTP ${res.status})`);
  }

  const json = (await res.json()) as EcosResponse;

  if (json.RESULT) {
    throw new EcosError(`ECOS ${json.RESULT.CODE}: ${json.RESULT.MESSAGE.split("\n")[0].trim()}`);
  }

  return {
    rows: json.StatisticSearch?.row ?? [],
    total: json.StatisticSearch?.list_total_count ?? 0,
  };
}

/**
 * 한국은행 ECOS 통계검색 API 호출.
 * 키가 없으면 EcosError 를 던진다 (호출부에서 안내 배너로 처리).
 */
export async function fetchEcosSeries(query: EcosQuery): Promise<Point[]> {
  const apiKey = process.env.ECOS_API_KEY?.trim();

  if (!apiKey) {
    throw new EcosError(
      "ECOS_API_KEY 가 설정되지 않았습니다. .env.local 에 한국은행 API 인증키를 넣어주세요."
    );
  }

  const first = await fetchPage(buildUrl(apiKey, query, 1, PAGE_SIZE));
  const rows = [...first.rows];

  const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES);

  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        fetchPage(buildUrl(apiKey, query, (i + 1) * PAGE_SIZE + 1, (i + 2) * PAGE_SIZE))
      )
    );
    for (const page of rest) rows.push(...page.rows);
  }

  return rows
    .map((row) => ({
      date: normalizeTime(row.TIME),
      value: toFiniteNumber(row.DATA_VALUE),
    }))
    .filter((point): point is Point => point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}
