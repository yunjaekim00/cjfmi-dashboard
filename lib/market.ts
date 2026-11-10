import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { fetchLiveQuotes, usCloseDate, type LiveQuotesResult } from "@/lib/market-live";
import {
  FX_CLOSE_IDS,
  FX_SERIES,
  FX_SPECS,
  MARKET_CHART_IDS,
  MARKET_FX_IDS,
  appreciationPct,
  fxCompare,
  marketWindow,
  pickWeekAgo,
  shiftDays,
  snapshotLabel,
  snapshotPoint,
  stampKey,
  type MarketPoint,
  type MarketSnapshot,
  type WeeklyMarket,
} from "@/lib/market-shared";

/*
 * "주요국 금융시장 동향" 자료 파일(data/YYMMDD-weekly-market.json) 읽기. (서버 전용)
 * 파일은 Claude Code 의 /weekly 스킬이 scripts/weekly-market.mjs 로 만든다(1년 이력 + 그때의 시세).
 * 서버는 파일을 읽고, 화면·엑셀을 여는 시점의 시세(lib/market-live.ts)를 최근치에 덧씌운다 — 그래서
 * 브라우저는 /weekly 를 언제 돌렸든 늘 지금 값을 보여준다.
 */

export const MARKET_DIR = path.join(process.cwd(), "data");
/** `YYMMDD-HHMM-weekly-market.json` (실행 날짜·시각 KST). 시각 없는 옛 이름도 받는다. */
const MARKET_FILE_PATTERN = /^\d{6}(?:-\d{4})?-weekly-market\.json$/;
const CACHE_MS = 12 * 60 * 60 * 1000;

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Point = z.object({ date: DateString, value: z.number() });
const Live = z.object({ time: z.string().nullable(), source: z.string() });

const FileMarket = z.object({
  asOf: DateString,
  windowStart: DateString,
  generatedAt: z.string().min(1),
  liveAt: z.string().nullable().optional(),
  event: z.object({ date: DateString, label: z.string(), note: z.string().default("") }),
  charts: z.array(
    z.object({
      id: z.enum(MARKET_CHART_IDS),
      points: z.array(Point),
      latest: Point.nullable(),
      weekAgo: Point.nullable(),
      live: Live.nullable().optional(),
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
        live: Live.nullable().optional(),
      })
    ),
  }),
  snapshot: z.object({ at: z.string(), values: z.record(z.string(), z.number()) }).nullable().optional(),
});

type Memo = { market: WeeklyMarket | null; expiresAt: number };

/** 파일명+수정시각이 키. dev 에서 모듈이 다시 평가돼도 남도록 globalThis 에 둔다. */
const memo: Map<string, Memo> = ((globalThis as Record<string, unknown>).__marketMemo ??=
  new Map()) as Map<string, Memo>;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * 자료 파일을 읽는다. 접두사(YYMMDD)를 주면 그 파일(엑셀 `?as=`), 없으면 날짜가 가장 늦은 파일 —
 * 본문보다 뒤에 `node scripts/weekly-market.mjs` 만 돌려 이력을 새로 받아도 바로 쓰이게.
 * 파일이 없거나 형식이 틀리면 null (서버 로그에 사유를 남긴다).
 */
export async function readMarketFile(preferPrefix?: string): Promise<WeeklyMarket | null> {
  const names = await listMarketFileNames();
  if (!names.length) return null;
  const name = (preferPrefix && names.find((n) => n.startsWith(preferPrefix))) || names[names.length - 1];
  return loadMarketFile(name);
}

/** 자료 파일 이름들 — 접두사(날짜·시각) 오름차순. 같은 날이면 시각 없는 옛 파일이 앞에 온다. */
async function listMarketFileNames(): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(MARKET_DIR);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return names.filter((name) => MARKET_FILE_PATTERN.test(name)).sort((a, b) => stampKey(a).localeCompare(stampKey(b)));
}

/** 파일 하나를 읽어 검증한다 (파일명+수정시각으로 캐시). 없거나 형식이 틀리면 null. */
async function loadMarketFile(name: string): Promise<WeeklyMarket | null> {
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

/**
 * 파일마다 하나씩, 그 파일을 쓸 때의 값(스냅샷). 시각 오름차순.
 * 스냅샷 절이 없는 옛 파일은 차트·환율표의 최근치로 대신한다 (그때 화면에 있던 값이 곧 보고한 값이다).
 */
export async function listMarketSnapshots(): Promise<MarketSnapshot[]> {
  const names = await listMarketFileNames();
  const files = await Promise.all(names.map(async (name) => [name, await loadMarketFile(name)] as const));
  const out: MarketSnapshot[] = [];
  for (const [name, file] of files) {
    if (!file) continue;
    const values: Record<string, number> = {};
    if (file.snapshot) Object.assign(values, file.snapshot.values);
    else {
      for (const chart of file.charts) if (chart.latest) values[chart.id] = chart.latest.value;
      for (const item of file.fx.items) if (item.latest) values[FX_SERIES[item.id]] = item.latest.value;
    }
    if (!Object.keys(values).length) continue;
    out.push({
      prefix: name.replace(/-weekly-market\.json$/, ""),
      at: file.snapshot?.at ?? file.liveAt ?? file.generatedAt,
      values,
      kind: "report",
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * 고른 스냅샷을 비교점으로 — 차트의 weekAgo 를 그 값으로 바꾸고 환율표 항목에 "직전보고일比"(compare)를 채운다
 * (엑셀용. 화면은 브라우저에서 같은 계산을 한다).
 */
export function applyCompareBase(market: WeeklyMarket, snapshot: MarketSnapshot | null): WeeklyMarket {
  if (!snapshot) return market;
  return {
    ...market,
    compareBase: { prefix: snapshot.prefix, at: snapshot.at, label: snapshotLabel(snapshot) },
    charts: market.charts.map((chart) => ({ ...chart, weekAgo: snapshotPoint(snapshot, chart.id) ?? chart.weekAgo })),
    fx: {
      ...market.fx,
      items: market.fx.items.map((item) => {
        const spec = FX_SPECS.find((s) => s.id === item.id);
        return { ...item, compare: spec ? fxCompare(spec, item, snapshot) : null };
      }),
    },
  };
}

// ───────────────────────── 환율표 계열의 최근 일별 값 ─────────────────────────

/** scripts/weekly-market.mjs 의 1년 이력 캐시 */
const HISTORY_FILE = "market-history.json";
const HistoryFile = z.object({
  series: z.record(
    z.string(),
    z.object({ points: z.array(Point).default([]), overrides: z.record(z.string(), z.number()).default({}) })
  ),
});

type HistoryMemo = { closes: Record<string, MarketPoint[]>; expiresAt: number };
const historyMemo: Map<string, HistoryMemo> = ((globalThis as Record<string, unknown>).__marketHistoryMemo ??=
  new Map()) as Map<string, HistoryMemo>;

/**
 * 차트에 없는 환율표 계열(달러인덱스·유로·엔·위안·동)의 최근 3주 일별 값 — "종가 기준"의 직전보고일比에 쓴다
 * (buildCloseSnapshots 의 recentCloses). 출처는 스크립트의 이력 캐시 data/market-history.json(ECOS 고시, 달러인덱스는
 * ICE 산식, 위안은 교차환율)이라 마지막 /weekly 실행일까지만 있다 — 그 뒤 날짜는 buildCloseSnapshots 가 직전 값으로
 * 대신하고 화면이 그 날짜를 밝힌다. 파일이 없거나 형식이 틀리면 빈 객체.
 */
export async function fxRecentCloses(today: string, days = 21): Promise<Record<string, MarketPoint[]>> {
  let mtime: number;
  try {
    mtime = (await stat(path.join(process.cwd(), "data", HISTORY_FILE))).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return {};
    throw error;
  }
  const key = `${today}:${mtime}`;
  const cached = historyMemo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.closes;

  const since = shiftDays(today, -days);
  const closes: Record<string, MarketPoint[]> = {};
  try {
    const parsed = HistoryFile.safeParse(JSON.parse(await readFile(path.join(process.cwd(), "data", HISTORY_FILE), "utf8")));
    if (!parsed.success) {
      console.warn(`[market] data/${HISTORY_FILE} 형식 오류:`, parsed.error.issues.slice(0, 3));
    } else {
      for (const id of FX_CLOSE_IDS) {
        const entry = parsed.data.series[id];
        if (!entry) continue;
        // 출처 값 위에 --set 덮어쓰기 — 출처에 그 날짜가 있으면 출처가 이긴다 (스크립트의 effectivePoints 와 같다)
        const byDate = new Map<string, number>(Object.entries(entry.overrides));
        for (const point of entry.points) byDate.set(point.date, point.value);
        closes[id] = [...byDate.entries()]
          .map(([date, value]) => ({ date, value }))
          .filter((p) => p.date >= since)
          .sort((a, b) => a.date.localeCompare(b.date));
      }
    }
  } catch (error) {
    console.warn(`[market] data/${HISTORY_FILE} 을 읽지 못했습니다:`, error instanceof Error ? error.message : error);
  }
  historyMemo.set(key, { closes, expiresAt: Date.now() + CACHE_MS });
  return closes;
}

// ───────────────────────── 열람 시점 시세 ─────────────────────────

/** 차트 6개 + 환율표 계열 + 각주에만 있는 국고채 3년 */
export const LIVE_IDS: string[] = [...new Set<string>([...MARKET_CHART_IDS, ...Object.values(FX_SERIES), "ktb3"])];

/** 같은 시세를 다시 쓰는 시간 — 새로고침을 연달아 해도 출처에는 1분에 한 번만 묻는다 (탭의 자동 갱신은 5분) */
const LIVE_TTL_MS = 60 * 1000;

type LiveStore = {
  memo: { result: LiveQuotesResult; expiresAt: number } | null;
  inflight: Promise<LiveQuotesResult | null> | null;
};
const liveStore: LiveStore = ((globalThis as Record<string, unknown>).__liveQuotes ??= {
  memo: null,
  inflight: null,
}) as LiveStore;

/** 지금 시세 (60초 캐시, 동시 요청은 하나로). 조회 자체가 실패하면 null — 부르는 쪽은 파일 그대로 보여준다. */
export async function getLiveQuotes(): Promise<LiveQuotesResult | null> {
  if (liveStore.memo && liveStore.memo.expiresAt > Date.now()) return liveStore.memo.result;
  if (liveStore.inflight) return liveStore.inflight;

  const work = fetchLiveQuotes(LIVE_IDS)
    .then((result) => {
      liveStore.memo = { result, expiresAt: Date.now() + LIVE_TTL_MS };
      const failed = Object.entries(result.errors);
      if (failed.length) console.warn(`[market] 시세 못 받음 ${failed.length}개:`, failed.map(([id, why]) => `${id}(${why})`).join(" · "));
      return result;
    })
    .catch((error: unknown) => {
      console.warn("[market] 시세 조회 실패:", error instanceof Error ? error.message : error);
      return null;
    })
    .finally(() => {
      liveStore.inflight = null;
    });
  liveStore.inflight = work;
  return work;
}

/** 서버가 어디에 있든 한국 날짜 기준 오늘 */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 파일의 차트·환율표에 지금 시세를 덧씌운다. 기준일을 오늘로 옮기고(창도 하루씩 따라온다),
 * 시세가 있는 계열은 오늘 날짜 점으로 끝낸다 — 파일에 오늘 점이 있었으면(스크립트가 넣은 시세) 새 시세로 바꾼다.
 * 전주비·절상률은 새 최근치로 다시 계산한다. 시세가 하나도 없으면 파일 그대로.
 */
export function overlayLiveMarket(market: WeeklyMarket, live: LiveQuotesResult | null, today = todayKst()): WeeklyMarket {
  if (!live || !Object.keys(live.quotes).length) return market;
  const { windowStart } = marketWindow(today);

  const charts = market.charts.map((chart) => {
    const quote = live.quotes[chart.id];
    let kept = chart.points.filter((p) => p.date >= windowStart && (!quote || p.date !== today));
    // S&P500 은 뉴욕 마감 뒤 시세가 그날 종가 — FRED 가 아직 없는 날이면 이력에 끼워 "종가 기준" 비교가 맞게 한다
    const closeDate = quote && chart.id === "sp500" ? usCloseDate(quote.time) : null;
    if (quote && closeDate && closeDate < today && !kept.some((p) => p.date === closeDate)) {
      kept = [...kept, { date: closeDate, value: quote.value }].sort((a, b) => a.date.localeCompare(b.date));
    }
    const points = quote ? [...kept, { date: today, value: quote.value }] : kept;
    const latest = points.at(-1) ?? null;
    return {
      ...chart,
      points,
      latest,
      weekAgo: pickWeekAgo(points, latest),
      live: quote ? { time: quote.time, source: quote.source } : latest?.date === today ? (chart.live ?? null) : null,
      overrideDates: chart.overrideDates.filter((date) => date >= windowStart),
    };
  });

  const items = market.fx.items.map((item) => {
    const spec = FX_SPECS.find((s) => s.id === item.id);
    const quote = live.quotes[FX_SERIES[item.id]];
    if (!spec || !quote) return item;
    const changePct = item.baseline ? Number(appreciationPct(spec, quote.value, item.baseline.value).toFixed(2)) : null;
    return { ...item, latest: { date: today, value: quote.value }, changePct, live: { time: quote.time, source: quote.source } };
  });

  return { ...market, asOf: today, windowStart, liveAt: live.fetchedAt, charts, fx: { ...market.fx, items } };
}
