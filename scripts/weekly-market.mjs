#!/usr/bin/env node
/**
 * 주요국 금융시장 동향 — 차트 6개(최근 1년)와 환율표 자료를 모아 data/<YYMMDD-HHMM>-weekly-market.json 을 쓴다
 * (접두사 = 실행 날짜·시각 KST. 실행마다 새 파일이 생기고, 파일마다 그때의 값이 `snapshot` 으로 남아 다음 보고의 전주比 기준이 된다).
 * Claude Code 의 /weekly 스킬이 실행한다. 차트 정의·계산은 lib/market-shared.ts 와 공유한다
 * (Node 22.18+/24 는 .ts 를 플래그 없이 읽는다).
 *
 *   node scripts/weekly-market.mjs                               # 기준일 = 오늘(KST)
 *   node scripts/weekly-market.mjs --as-of 2026-11-02            # 기준일 지정 (x축 오른쪽 끝)
 *   node scripts/weekly-market.mjs --set sp500=2026-10-30:7580.07 --set wti=2026-10-30:104.12
 *       # 출처(FRED)에 아직 안 올라온 종가를 기사에서 확인해 넣는다. 캐시에 남아 다음 실행에도 쓰이고,
 *       # 출처에 그 날짜가 올라오면 출처 값이 이긴다. 대상: 차트 6개 + dxy·usdcny(파생) + 환율 구성 계열
 *   node scripts/weekly-market.mjs --offline                     # 받지 않고 캐시만으로 다시 만든다 (실시간 시세도 안 받는다)
 *   node scripts/weekly-market.mjs --no-live                     # 실시간 시세 없이 집계치(FRED·ECOS)만으로
 *   node scripts/weekly-market.mjs --baseline 2026-02-27         # 환율표 비교 시점 (기본: 전쟁직전 2/27)
 *   node scripts/weekly-market.mjs --out /tmp/x.json             # 쓸 파일 경로 지정 (기본 data/<YYMMDD>-weekly-market.json)
 *
 * 자료는 data/market-history.json 에 쌓아 둔다(14개월 + 비교 시점). 실행할 때마다 계열별 마지막 관측일의
 * 2주 전부터만 다시 받으므로 1년치를 매번 처음부터 받지 않는다.
 * 이력 출처: FRED(S&P 500 · 美 10년물 · WTI 쿠싱 현물), 한국은행 ECOS(KOSPI · 국고채 10년 · 환율 매매기준율). .env.local 의 ECOS_API_KEY 필요.
 *   보충: 美 10년물은 재무부 일별 금리표(FRED 보다 하루 빠름), KOSPI 는 네이버 일별 시세(ECOS 보다 하루 빠름).
 * 최근치: 기준일이 오늘이면 차트 6개와 환율표 6개의 최근치를 실행 시점 시세로 채운다 (scripts/lib/live-quotes.mjs —
 *   CNBC 시세 JSON · 네이버 금융, 키 없음). 시세는 캐시에 넣지 않으며, 그 날짜의 집계치가 올라오면 다음 실행부터 자연히 대체된다.
 *   못 받은 계열은 집계치가 최근치가 되고 ⚠ 로 알린다. WTI 시세는 선물 근월물이라 현물 이력과 기준이 다르다.
 *
 * stdout: 쓴 파일 경로. stderr: 읽기 좋은 표와 경고(시세 실패 · 출처가 늦어 최근치가 오래됐으면 --set 안내).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  CHART_SPECS,
  DXY_WEIGHTS,
  FX_BASELINE,
  FX_SERIES,
  FX_SPECS,
  MARKET_EVENT,
  addMonthsClamped,
  appreciationPct,
  dollarIndex,
  formatSignedPct,
  formatTickDate,
  formatValue,
  formatWeekChange,
  latestOnOrBefore,
  marketWindow,
  pickWeekAgo,
  shiftDays,
} from "../lib/market-shared.ts";
import { fetchLiveQuotes, fetchNaverIndexHistory, fetchTreasury10y, usCloseDate } from "./lib/live-quotes.mjs";

// ── .env.local (있으면) ──
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // 없으면 넘어간다
}

const ECOS_KEY = process.env.ECOS_API_KEY?.trim();

const CACHE_FILE = "data/market-history.json";
const KEEP_MONTHS = 14;
const REFETCH_DAYS = 14;
/** 최근치가 기준일보다 이만큼 넘게 오래됐으면 경고한다 (주말을 끼면 3일이 정상) */
const STALE_DAYS = 3;

/** 원 출처에서 받는 계열. 키는 캐시·--set 에서 쓰는 이름. */
const RAW = {
  sp500: { source: "fred", seriesId: "SP500", label: "FRED SP500" },
  ust10: { source: "fred", seriesId: "DGS10", label: "FRED DGS10" },
  wti: { source: "fred", seriesId: "DCOILWTICO", label: "FRED DCOILWTICO" },
  kospi: { source: "ecos", statCode: "802Y001", itemCode1: "0001000", label: "ECOS 802Y001 KOSPI" },
  ktb10: { source: "ecos", statCode: "817Y002", itemCode1: "010210000", label: "ECOS 817Y002 국고채 10년" },
  usdkrw: { source: "ecos", statCode: "731Y001", itemCode1: "0000001", label: "ECOS 731Y001 원/달러" },
  cnykrw: { source: "ecos", statCode: "731Y001", itemCode1: "0000053", label: "ECOS 731Y001 원/위안" },
  usdjpy: { source: "ecos", statCode: "731Y002", itemCode1: "0000002", label: "ECOS 731Y002 엔/달러" },
  eurusd: { source: "ecos", statCode: "731Y002", itemCode1: "0000003", label: "ECOS 731Y002 달러/유로" },
  gbpusd: { source: "ecos", statCode: "731Y002", itemCode1: "0000012", label: "ECOS 731Y002 달러/파운드" },
  usdcad: { source: "ecos", statCode: "731Y002", itemCode1: "0000013", label: "ECOS 731Y002 캐나다달러/달러" },
  usdchf: { source: "ecos", statCode: "731Y002", itemCode1: "0000014", label: "ECOS 731Y002 스위스프랑/달러" },
  usdsek: { source: "ecos", statCode: "731Y002", itemCode1: "0000016", label: "ECOS 731Y002 크로나/달러" },
  usdvnd: { source: "ecos", statCode: "731Y002", itemCode1: "0000035", label: "ECOS 731Y002 동/달러" },
};

/** 원 출처 계열에서 계산하는 계열. --set 덮어쓰기는 받는다. */
const DERIVED = ["dxy", "usdcny"];

// ───────────────────────── 인자 ─────────────────────────

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 지금 시각 "HHMM" (KST) — 파일명 접두사용 */
function nowHhmmKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16).replace(":", "");
}

/** 파일명 접두사 → 정렬 키 (시각 없는 옛 접두사는 "0000") */
function stampKey(name) {
  const match = /^(\d{6})(?:-(\d{4}))?/.exec(name);
  return match ? `${match[1]}${match[2] ?? "0000"}` : "";
}

/**
 * 지난 보고 스냅샷 — data/ 의 market 파일 중 기준일보다 앞선 날의 가장 최근 것. 화면의 "전주比 기준" 기본값과 같다.
 * 스냅샷 절이 없는 옛 파일은 차트·환율표 최근치로 대신한다.
 */
function previousSnapshot(asOf) {
  let names = [];
  try {
    names = readdirSync("data")
      .filter((name) => /^\d{6}(?:-\d{4})?-weekly-market\.json$/.test(name))
      .sort((a, b) => stampKey(a).localeCompare(stampKey(b)));
  } catch {
    return null;
  }
  for (const name of names.reverse()) {
    try {
      const file = JSON.parse(readFileSync(`data/${name}`, "utf8"));
      const at = file.snapshot?.at ?? file.liveAt ?? file.generatedAt;
      const date = new Date(Date.parse(at) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (!(date < asOf)) continue;
      const values = { ...(file.snapshot?.values ?? {}) };
      if (!file.snapshot) {
        for (const chart of file.charts ?? []) if (chart.latest) values[chart.id] = chart.latest.value;
        for (const item of file.fx?.items ?? []) if (item.latest) values[FX_SERIES[item.id]] = item.latest.value;
      }
      return { prefix: name.replace(/-weekly-market\.json$/, ""), at, values };
    } catch {
      // 깨진 파일은 건너뛴다
    }
  }
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv) {
  const args = { asOf: null, sets: [], offline: false, baseline: null, noLive: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--as-of") args.asOf = argv[++i];
    else if (arg === "--set") args.sets.push(argv[++i]);
    else if (arg.startsWith("--set=")) args.sets.push(arg.slice("--set=".length));
    else if (arg === "--offline") args.offline = true;
    else if (arg === "--no-live") args.noLive = true;
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--baseline") args.baseline = argv[++i];
    else if (DATE_RE.test(arg)) args.asOf = arg;
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  if (args.asOf && !DATE_RE.test(args.asOf)) throw new Error(`--as-of 는 YYYY-MM-DD 여야 합니다: ${args.asOf}`);
  if (args.baseline && !DATE_RE.test(args.baseline)) throw new Error(`--baseline 은 YYYY-MM-DD 여야 합니다: ${args.baseline}`);

  const overrides = args.sets.map((text) => {
    const match = /^([a-z0-9]+)=(\d{4}-\d{2}-\d{2}):(-?[\d.]+)$/.exec(text ?? "");
    if (!match) throw new Error(`--set 형식은 id=YYYY-MM-DD:값 입니다: ${text}`);
    const [, id, date, raw] = match;
    if (!(id in RAW) && !DERIVED.includes(id)) throw new Error(`--set 대상이 아닙니다: ${id} (가능: ${[...Object.keys(RAW), ...DERIVED].join(", ")})`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--set 값이 숫자가 아닙니다: ${text}`);
    return { id, date, value };
  });

  if (args.out !== null && !args.out) throw new Error("--out 뒤에 파일 경로가 필요합니다");
  return {
    asOf: args.asOf ?? todayKst(),
    overrides,
    offline: args.offline,
    noLive: args.noLive,
    out: args.out,
    baseline: args.baseline ?? FX_BASELINE.date,
  };
}

// ───────────────────────── 캐시 ─────────────────────────

function loadCache() {
  try {
    const json = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (json && typeof json === "object" && json.series) return json;
  } catch {
    // 없거나 깨졌으면 새로 시작한다
  }
  return { version: 1, updatedAt: null, series: {} };
}

function entryFor(cache, id) {
  const entry = (cache.series[id] ??= { points: [], overrides: {} });
  entry.points ??= [];
  entry.overrides ??= {};
  if (id in RAW) entry.source = RAW[id].label;
  return entry;
}

/** 출처 관측치 위에 덮어쓰기를 얹는다 — 출처에 그 날짜가 있으면 출처가 이긴다. */
function effectivePoints(entry) {
  const byDate = new Map(Object.entries(entry.overrides).map(([date, value]) => [date, { date, value, override: true }]));
  for (const point of entry.points) byDate.set(point.date, point);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── 조회 ─────────────────────────

async function fetchFred(seriesId, since) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${since}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  // 휴일은 값이 "" 또는 "." 로 온다 — Number("") 은 0 이라 숫자 검사로는 걸러지지 않으니 문자열에서 거른다.
  return (await res.text())
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, raw = ""] = line.split(",");
      return { date, raw: raw.trim() };
    })
    .filter((p) => DATE_RE.test(p.date ?? "") && p.raw !== "" && p.raw !== ".")
    .map((p) => ({ date: p.date, value: Number(p.raw) }))
    .filter((p) => Number.isFinite(p.value));
}

async function fetchEcos({ statCode, itemCode1 }, since, until) {
  if (!ECOS_KEY) throw new Error("ECOS_API_KEY 없음 (.env.local)");
  const start = since.replaceAll("-", "");
  const end = until.replaceAll("-", "");
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ECOS_KEY)}/json/kr/1/2000/${statCode}/D/${start}/${end}/${itemCode1}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);
  const json = await res.json();
  if (json.RESULT) {
    if (json.RESULT.CODE === "INFO-200") return [];
    throw new Error(`ECOS ${json.RESULT.CODE}: ${String(json.RESULT.MESSAGE).split("\n")[0].trim()}`);
  }
  return (json.StatisticSearch?.row ?? [])
    .map((row) => ({
      date: `${row.TIME.slice(0, 4)}-${row.TIME.slice(4, 6)}-${row.TIME.slice(6, 8)}`,
      value: Number(row.DATA_VALUE),
    }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 원 출처보다 빨리 올라오는 보충 출처. 원 출처에 아직 없는 날짜만 더한다 (같은 공식 종가라 캐시에 넣는다).
 * 오늘 날짜는 넣지 않는다 — 장중치일 수 있고, 오늘은 실행 시점 시세가 맡는다.
 */
const SUPPLEMENTS = {
  ust10: { label: "재무부 금리표", fetch: (since, today) => fetchTreasury10y(since, shiftDays(today, -1)) },
  kospi: { label: "네이버 일별", fetch: () => fetchNaverIndexHistory("KOSPI") },
};

/** 계열 하나를 캐시에 이어 받는다. 실패해도 캐시는 남긴다. */
async function refresh(cache, id, keepFrom, today) {
  const def = RAW[id];
  const entry = entryFor(cache, id);
  const last = entry.points.at(-1)?.date;
  const since = last ? shiftDays(last, -REFETCH_DAYS) : keepFrom;

  let note = "";
  try {
    const fresh = def.source === "fred" ? await fetchFred(def.seriesId, since) : await fetchEcos(def, since, today);
    const supplement = SUPPLEMENTS[id];
    if (supplement) {
      try {
        const have = new Set(fresh.map((p) => p.date));
        const extra = (await supplement.fetch(since, today)).filter((p) => p.date >= since && p.date < today && !have.has(p.date));
        fresh.push(...extra);
        if (extra.length) note = ` (+${supplement.label} ${extra.length}건)`;
      } catch (error) {
        note = ` (${supplement.label} 실패: ${error instanceof Error ? error.message : error})`;
      }
    }
    const byDate = new Map(entry.points.map((p) => [p.date, p.value]));
    let added = 0;
    for (const point of fresh) {
      if (!byDate.has(point.date)) added += 1;
      byDate.set(point.date, point.value);
    }
    entry.points = [...byDate.entries()]
      .filter(([date]) => date >= keepFrom)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
    entry.fetchedAt = new Date().toISOString();
    delete entry.error;
    return `✓ ${added}건 추가${note}`;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    return `✗ ${entry.error}${entry.points.length ? " (캐시 사용)" : ""}`;
  }
}

// ───────────────────────── 파생 계열 ─────────────────────────

function round(value, digits) {
  return Number(value.toFixed(digits));
}

/** 날짜가 모두 있는 날만 계산한다 */
function combine(seriesList, compute, digits) {
  const [first, ...rest] = seriesList;
  const maps = rest.map((points) => new Map(points.map((p) => [p.date, p.value])));
  const out = [];
  for (const point of first) {
    const values = [point.value];
    let complete = true;
    for (const map of maps) {
      const value = map.get(point.date);
      if (value === undefined) {
        complete = false;
        break;
      }
      values.push(value);
    }
    if (complete) out.push({ date: point.date, value: round(compute(values), digits) });
  }
  return out;
}

function deriveSeries(cache) {
  const eff = (id) => effectivePoints(entryFor(cache, id));
  const keys = Object.keys(DXY_WEIGHTS);
  const dxy = combine(
    keys.map((key) => eff(key)),
    (values) => dollarIndex(Object.fromEntries(keys.map((key, i) => [key, values[i]]))),
    3
  );
  const usdcny = combine([eff("usdkrw"), eff("cnykrw")], ([krw, cny]) => krw / cny, 4);

  const dxyEntry = entryFor(cache, "dxy");
  dxyEntry.source = "ICE 산식 · ECOS 731Y002 6개 통화";
  dxyEntry.points = dxy;
  const cnyEntry = entryFor(cache, "usdcny");
  cnyEntry.source = "원/달러 ÷ 원/위안 (ECOS 731Y001)";
  cnyEntry.points = usdcny;
}

// ───────────────────────── 표 ─────────────────────────

function fmtDate(date) {
  return date.slice(5).replace("-", "-");
}

/** ISO 시각 → "12:21" (KST) */
function fmtTime(iso) {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// ───────────────────────── main ─────────────────────────

async function main() {
  const { asOf, overrides, offline, noLive, out, baseline } = parseArgs(process.argv.slice(2));
  const today = todayKst();
  const { windowStart, ticks } = marketWindow(asOf);
  // 비교 시점(전쟁직전)이 창 밖으로 밀려나도 남아 있도록 보존 구간을 그만큼 넓힌다.
  const keepFrom = [addMonthsClamped(today, -KEEP_MONTHS), shiftDays(baseline, -10), shiftDays(windowStart, -10)].sort()[0];

  if (!existsSync("data")) mkdirSync("data");
  const cache = loadCache();

  // 덮어쓰기 등록
  for (const { id, date, value } of overrides) {
    entryFor(cache, id).overrides[date] = value;
  }

  // 출처에서 이어 받기
  const fetchLog = {};
  if (offline) {
    console.error("(--offline) 캐시만 사용합니다.");
  } else {
    for (const id of Object.keys(RAW)) {
      fetchLog[id] = await refresh(cache, id, keepFrom, today);
    }
  }

  // 출처에 올라온 날짜의 덮어쓰기는 지운다 (출처가 이긴다)
  for (const id of Object.keys(cache.series)) {
    const entry = entryFor(cache, id);
    const have = new Set(entry.points.map((p) => p.date));
    for (const date of Object.keys(entry.overrides)) if (have.has(date)) delete entry.overrides[date];
  }

  deriveSeries(cache);

  // ── 실행 시점 시세 (기준일이 오늘일 때만 — 과거 기준일을 다시 만들 땐 집계치만) ──
  const liveWanted = asOf === today && !offline && !noLive;
  let live = { quotes: {}, errors: {}, fetchedAt: null };
  if (liveWanted) {
    // 국고채 3년은 차트에 없지만 각주 기준(스냅샷)에 들어간다
    const ids = [...new Set([...CHART_SPECS.map((spec) => spec.id), ...Object.values(FX_SERIES), "ktb3"])];
    live = await fetchLiveQuotes(ids);

    // 뉴욕 마감(16:00 ET) 뒤의 S&P500 시세는 그날 종가 — FRED 가 이틀 늦으므로 덮어쓰기(출처가 올라오면 출처가 이긴다)로
    // 넣어 이력의 빈 날과 "종가 기준" 비교를 메운다. WTI 선물은 정산가가 따로라 넣지 않는다.
    const spQuote = live.quotes.sp500;
    const spDate = spQuote ? usCloseDate(spQuote.time) : null;
    if (spQuote && spDate && spDate < asOf) {
      const entry = entryFor(cache, "sp500");
      if (!entry.points.some((p) => p.date === spDate) && entry.overrides[spDate] === undefined) {
        entry.overrides[spDate] = spQuote.value;
        console.error(`S&P500 ${spDate} 종가 ${spQuote.value} 를 CNBC 마감 시세로 채웠습니다 (FRED 집계 전).`);
      }
    }
  } else if (!offline && !noLive) {
    console.error(`기준일 ${asOf} 이 오늘(${today})이 아니라 실시간 시세는 붙이지 않습니다.`);
  }
  /** 시세가 있으면 기준일 날짜의 점으로 끝에 붙인다 (같은 날짜의 집계치 — 예: 08:30 고시 — 는 시세로 바꾼다) */
  const withLive = (points, id) => {
    const quote = live.quotes[id];
    if (!quote) return { points, live: null };
    return {
      points: [...points.filter((p) => p.date !== asOf), { date: asOf, value: quote.value, live: true }],
      live: { time: quote.time, source: quote.source },
    };
  };
  const fmtLive = (info) => (info?.time ? `${fmtTime(info.time)} 시세` : "시세");

  // ── 차트 ──
  const warnings = [];
  const previous = previousSnapshot(asOf);
  const chartRows = ["| 차트 | 최근 | 지난주 | 전주비(7일) | 지난 보고比 | 출처 |", "|---|---|---|---|---|---|"];
  const charts = CHART_SPECS.map((spec) => {
    const entry = entryFor(cache, spec.id);
    const { points: all, live: liveInfo } = withLive(effectivePoints(entry).filter((p) => p.date <= asOf), spec.id);
    const points = all.filter((p) => p.date >= windowStart);
    const latest = points.at(-1) ?? null;
    const weekAgo = pickWeekAgo(all, latest);
    const overrideDates = points.filter((p) => p.override).map((p) => p.date);

    const chart = {
      id: spec.id,
      points: points.map(({ date, value }) => ({ date, value })),
      latest: latest ? { date: latest.date, value: latest.value } : null,
      weekAgo: weekAgo ? { date: weekAgo.date, value: weekAgo.value } : null,
      live: liveInfo,
      overrideDates,
    };
    if (!points.length) chart.error = entry.error ?? "자료 없음";

    const sourceNote = `${entry.source ?? ""} ${fetchLog[spec.id] ?? (offline ? "(캐시)" : "")}${liveInfo ? ` · 최근치 ${liveInfo.source}` : ""}`.trim();
    const latestNote = latest ? (latest.live ? `, ${fmtLive(liveInfo)}` : latest.override ? ", 덮어쓰기" : "") : "";
    chartRows.push(
      `| ${spec.title} | ${latest ? `${formatValue(spec, latest.value)} (${fmtDate(latest.date)}${latestNote})` : "-"} | ${
        weekAgo ? `${formatValue(spec, weekAgo.value)} (${fmtDate(weekAgo.date)})` : "-"
      } | ${latest && weekAgo ? formatWeekChange(spec, latest, weekAgo) : "-"} | ${
        latest && previous && previous.values[spec.id] !== undefined
          ? formatWeekChange(spec, latest, { date: previous.at.slice(0, 10), value: previous.values[spec.id] })
          : "-"
      } | ${sourceNote} |`
    );

    if (liveWanted && !liveInfo) {
      warnings.push(`${spec.title}: 실시간 시세를 못 받아 집계치를 최근치로 씁니다 — ${live.errors[spec.id] ?? "원인 불명"}`);
    }
    if (latest && !latest.live && daysBetween(latest.date, asOf) > STALE_DAYS) {
      warnings.push(
        `${spec.title}: 최근치가 ${latest.date} — 기준일보다 ${daysBetween(latest.date, asOf)}일 전입니다. 기사에서 그 뒤 종가를 확인했으면 --set ${spec.id}=YYYY-MM-DD:값 으로 넣으세요.`
      );
    }
    if (chart.error) warnings.push(`${spec.title}: ${chart.error}`);
    return chart;
  });

  // ── 환율표 ──
  const fxRows = ["| 통화 | 최근 | 비교 시점 | 절상(+)/절하(−) | 지난 보고比 |", "|---|---|---|---|---|"];
  const items = FX_SPECS.map((spec) => {
    const entry = entryFor(cache, FX_SERIES[spec.id]);
    const { points: all, live: liveInfo } = withLive(effectivePoints(entry).filter((p) => p.date <= asOf), FX_SERIES[spec.id]);
    const latest = all.at(-1) ?? null;
    const base = latestOnOrBefore(all, baseline);
    const changePct = latest && base ? round(appreciationPct(spec, latest.value, base.value), 2) : null;
    // 화면 환율표 맨 아래 "직전보고일比" — 지난 보고 스냅샷의 그 통화 값 대비
    const previousValue = previous?.values[FX_SERIES[spec.id]];
    const previousPct = latest && previousValue ? round(appreciationPct(spec, latest.value, previousValue), 2) : null;
    fxRows.push(
      `| ${spec.label} | ${latest ? `${formatValue(spec, latest.value)} (${fmtDate(latest.date)}${latest.live ? `, ${fmtLive(liveInfo)}` : ""})` : "-"} | ${
        base ? `${formatValue(spec, base.value)} (${fmtDate(base.date)})` : "-"
      } | ${changePct === null ? "-" : formatSignedPct(changePct, 1, "%")} | ${previousPct === null ? "-" : formatSignedPct(previousPct, 1, "%")} |`
    );
    if (!latest) warnings.push(`환율표 ${spec.label}: 자료 없음 (${entry.error ?? "계산 불가"})`);
    else if (liveWanted && !liveInfo) {
      warnings.push(`환율표 ${spec.label}: 실시간 시세를 못 받아 집계치(${latest.date})를 씁니다 — ${live.errors[FX_SERIES[spec.id]] ?? "원인 불명"}`);
    }
    return {
      id: spec.id,
      latest: latest ? { date: latest.date, value: latest.value } : null,
      baseline: base ? { date: base.date, value: base.value } : null,
      changePct,
      live: liveInfo,
    };
  });

  // 이 파일을 쓸 때의 값 — 다음 보고의 전주比 기준. 시세가 없으면(--no-live·과거 기준일) 차트·환율표의 최근치.
  const snapshotValues = {};
  for (const chart of charts) if (chart.latest) snapshotValues[chart.id] = chart.latest.value;
  for (const item of items) if (item.latest) snapshotValues[FX_SERIES[item.id]] = item.latest.value;
  for (const [id, quote] of Object.entries(live.quotes)) snapshotValues[id] = quote.value;

  const output = {
    asOf,
    windowStart,
    generatedAt: new Date().toISOString(),
    liveAt: live.fetchedAt,
    event: MARKET_EVENT,
    charts,
    fx: { baselineDate: baseline, baselineLabel: FX_BASELINE.label, items },
    snapshot: { at: live.fetchedAt ?? new Date().toISOString(), values: snapshotValues },
  };

  const stamp = `${asOf.slice(2).replaceAll("-", "")}-${nowHhmmKst()}`;
  const outFile = out ?? `data/${stamp}-weekly-market.json`;
  writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);

  cache.updatedAt = new Date().toISOString();
  writeFileSync(CACHE_FILE, `${JSON.stringify(cache)}\n`);

  console.error(`기준일 ${asOf} · 창 ${windowStart} ~ ${asOf} · 눈금 ${ticks.map(formatTickDate).join(" · ")}`);
  if (live.fetchedAt) {
    const got = Object.keys(live.quotes).length;
    console.error(
      `실행 시점 시세 ${got}/${got + Object.keys(live.errors).length}개 계열 (${fmtTime(live.fetchedAt)} KST · CNBC 시세 JSON · 네이버 금융) — 캐시에는 넣지 않는다`
    );
  }
  console.error(chartRows.join("\n"));
  console.error(`\n환율표 — ${FX_BASELINE.label}(${fmtDate(baseline)})比`);
  console.error(fxRows.join("\n"));
  if (warnings.length) console.error(`\n${warnings.map((w) => `⚠ ${w}`).join("\n")}`);
  if (previous) console.error(`\n지난 보고 스냅샷: ${previous.prefix} (${fmtTime(previous.at)} KST) — 화면 "전주比 기준"의 기본값. 표의 "지난 보고比"가 그 대비.`);
  console.error(`\n→ ${outFile} 저장 · 캐시 ${CACHE_FILE} 갱신 · 접두사 ${stamp}`);
  console.log(outFile);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
