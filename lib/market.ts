import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { MARKET_CHART_IDS, MARKET_FX_IDS, type WeeklyMarket } from "@/lib/market-shared";

/*
 * "주요국 금융시장 동향" 자료 파일(data/YYMMDD-weekly-market.json) 읽기. (서버 전용)
 * 파일은 Claude Code 의 /weekly 스킬이 scripts/weekly-market.mjs 로 만든다 — 서버는 읽기만 한다.
 */

export const MARKET_DIR = path.join(process.cwd(), "data");
const MARKET_FILE_PATTERN = /^\d{6}-weekly-market\.json$/;
const CACHE_MS = 12 * 60 * 60 * 1000;

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Point = z.object({ date: DateString, value: z.number() });

const FileMarket = z.object({
  asOf: DateString,
  windowStart: DateString,
  generatedAt: z.string().min(1),
  event: z.object({ date: DateString, label: z.string(), note: z.string().default("") }),
  charts: z.array(
    z.object({
      id: z.enum(MARKET_CHART_IDS),
      points: z.array(Point),
      latest: Point.nullable(),
      weekAgo: Point.nullable(),
      overrideDates: z.array(DateString).default([]),
      error: z.string().optional(),
    })
  ),
  fx: z.object({
    baselineDate: DateString,
    baselineLabel: z.string(),
    items: z.array(
      z.object({
        id: z.enum(MARKET_FX_IDS),
        latest: Point.nullable(),
        baseline: Point.nullable(),
        changePct: z.number().nullable(),
      })
    ),
  }),
});

type Memo = { market: WeeklyMarket | null; expiresAt: number };

/** 파일명+수정시각이 키. dev 에서 모듈이 다시 평가돼도 남도록 globalThis 에 둔다. */
const memo: Map<string, Memo> = ((globalThis as Record<string, unknown>).__marketMemo ??=
  new Map()) as Map<string, Memo>;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * 가장 알맞은 자료 파일을 읽는다. 주간 모니터링 본문과 같은 날짜 접두사(YYMMDD)가 있으면 그것,
 * 없으면 날짜가 가장 늦은 파일. 파일이 없거나 형식이 틀리면 null (서버 로그에 사유를 남긴다).
 */
export async function readMarketFile(preferPrefix?: string): Promise<WeeklyMarket | null> {
  let names: string[];
  try {
    names = await readdir(MARKET_DIR);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  const dated = names.filter((name) => MARKET_FILE_PATTERN.test(name)).sort();
  if (!dated.length) return null;
  const name = (preferPrefix && dated.find((n) => n.startsWith(preferPrefix))) || dated[dated.length - 1];

  // 경로는 fs 호출 자리에서 "data" 하위로 묶어 쓴다 — Turbopack 이 data/ 만 추적하게 하기 위해서다.
  let mtime: number;
  try {
    mtime = (await stat(path.join(process.cwd(), "data", name))).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  const key = `${name}:${mtime}`;
  const cached = memo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.market;

  let market: WeeklyMarket | null = null;
  try {
    const json: unknown = JSON.parse(await readFile(path.join(process.cwd(), "data", name), "utf8"));
    const parsed = FileMarket.safeParse(json);
    if (parsed.success) {
      market = { ...parsed.data, file: name };
    } else {
      console.warn(`[market] data/${name} 형식 오류:`, parsed.error.issues.slice(0, 3));
    }
  } catch (error) {
    console.warn(`[market] data/${name} 을 읽지 못했습니다:`, error instanceof Error ? error.message : error);
  }

  memo.set(key, { market, expiresAt: Date.now() + CACHE_MS });
  return market;
}
