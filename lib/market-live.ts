/*
 * 시세 — 화면·엑셀을 여는 시점(서버, lib/market.ts)과 /weekly 를 실행하는 시점(scripts/*.mjs)에
 * 차트·환율표·지표 각주의 최근치를 "지금 값"으로 만들 때 쓴다.
 *
 * 이 파일은 서버와 Node 스크립트(scripts/lib/live-quotes.mjs 가 재수출, Node 24 type stripping)가 함께 import 한다.
 * 그래서 다른 모듈을 import 하지 않고, enum 처럼 Node 가 지우지 못하는 문법도 쓰지 않는다.
 *
 * 키 없이 열리는 공개 엔드포인트 둘 (둘 다 비공식이라 예고 없이 바뀔 수 있다 — 실패하면 부르는 쪽이 집계치로 돌아간다):
 *   - CNBC 시세 JSON   quote.cnbc.com/quote-html-webservice/restQuote/…
 *       S&P500(.SPX) · 美10년(US10Y) · WTI 선물 근월물(@CL.1) · 원달러 현물(KRW=) · ICE 달러인덱스(.DXY)
 *       · 유로(EUR=) · 엔(JPY=) · 위안(CNY=) · 동(VND=) · 韓10년(KR10Y-KR). 선물·KOSPI(.KS11)는 15분 지연(realTime=false).
 *   - 네이버 금융 모바일 API   m.stock.naver.com
 *       KOSPI(api/index/KOSPI/basic, 실시간) · 국고채 3년/10년(KR3YT=RR · KR10YT=RR, 실시간) · 원달러 하나은행 고시회차(FX_USDKRW)
 * 둘 다 User-Agent 가 브라우저 모양이 아니면 빈 응답이나 HTML 을 준다.
 *
 * 집계 지연 보충(공식 종가 — 스크립트가 캐시에 넣는다):
 *   - 美 재무부 일별 금리표 XML: 당일 저녁(ET) 게시라 FRED DGS10 보다 하루 빠르다
 *   - 네이버 KOSPI 일별 시세: ECOS 보다 하루 빠르다
 *
 * 쓰지 못하는 곳 (2026-11-10 확인): Yahoo Finance 익명 429(쿠키·크럼 우회는 하지 않는다) · Investing.com 403 · Stooq JS 검증
 * · EIA 는 2024-04-05 이후 선물 가격 미제공. 내장 fetch 만 쓴다.
 */

export type LiveSource =
  | { kind: "cnbc"; symbol: string }
  | { kind: "naver-index" | "naver-bond" | "naver-fx"; code: string };

export type LiveQuoteValue = {
  value: number;
  /** 시세 시각(ISO, UTC). 출처가 안 주면 null */
  time: string | null;
  /** "CNBC .SPX" · "네이버 KOSPI" */
  source: string;
  status: string | null;
  /** 15분 지연 시세 */
  delayed: boolean;
};

export type LiveQuotesResult = {
  quotes: Record<string, LiveQuoteValue>;
  errors: Record<string, string>;
  /** 조회한 시각(ISO) */
  fetchedAt: string;
};

export type DatedValue = { date: string; value: number };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

/**
 * 429(너무 잦은 요청)·403(접근 거부)을 돌려준 호스트는 이 시간 동안 부르지 않는다 — 차단을 키우지 않기 위해서다.
 * 호스트별이라 CNBC 가 막혀도 네이버 예비 출처는 그대로 쓴다. Retry-After 헤더가 더 길면 그만큼 쉰다.
 * 서버(장기 프로세스)에서 의미가 있고, 스크립트는 한 번 실행이라 그 안에서만 적용된다.
 */
const BACKOFF_MS = 15 * 60 * 1000;
type Backoff = Map<string, { until: number; status: number }>;
const backoff: Backoff = ((globalThis as Record<string, unknown>).__liveBackoff ??= new Map()) as Backoff;

function kstTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

/** 지금 쉬고 있는 호스트들 — 로그·진단용 */
export function liveBackoffStatus(): Array<{ host: string; status: number; until: string }> {
  const now = Date.now();
  return [...backoff]
    .filter(([, b]) => b.until > now)
    .map(([host, b]) => ({ host, status: b.status, until: new Date(b.until).toISOString() }));
}

/** 계열 id → 시세 출처 후보 (앞에서부터 시도) */
export const LIVE_SOURCES: Record<string, LiveSource[]> = {
  sp500: [{ kind: "cnbc", symbol: ".SPX" }],
  ust10: [{ kind: "cnbc", symbol: "US10Y" }],
  wti: [{ kind: "cnbc", symbol: "@CL.1" }],
  kospi: [
    { kind: "naver-index", code: "KOSPI" },
    { kind: "cnbc", symbol: ".KS11" },
  ],
  ktb10: [
    { kind: "cnbc", symbol: "KR10Y-KR" },
    { kind: "naver-bond", code: "KR10YT=RR" },
  ],
  ktb3: [{ kind: "naver-bond", code: "KR3YT=RR" }],
  usdkrw: [
    { kind: "cnbc", symbol: "KRW=" },
    { kind: "naver-fx", code: "FX_USDKRW" },
  ],
  dxy: [{ kind: "cnbc", symbol: ".DXY" }],
  eurusd: [{ kind: "cnbc", symbol: "EUR=" }],
  usdjpy: [{ kind: "cnbc", symbol: "JPY=" }],
  usdcny: [{ kind: "cnbc", symbol: "CNY=" }],
  usdvnd: [{ kind: "cnbc", symbol: "VND=" }],
};

// ───────────────────────── 공통 ─────────────────────────

type RawQuote = { value: number; time: string | null; status: string | null; delayed: boolean };

async function fetchText(url: string, accept = "*/*"): Promise<string> {
  const host = new URL(url).host;
  const paused = backoff.get(host);
  if (paused) {
    if (paused.until > Date.now()) throw new Error(`HTTP ${paused.status} 뒤 ${kstTime(paused.until)} 까지 조회 중단`);
    backoff.delete(host);
  }

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 429 || res.status === 403) {
    const retryAfter = Number(res.headers.get("retry-after")) * 1000;
    const until = Date.now() + Math.max(BACKOFF_MS, Number.isFinite(retryAfter) ? retryAfter : 0);
    backoff.set(host, { until, status: res.status });
    throw new Error(`HTTP ${res.status} — ${host} 조회를 ${kstTime(until)} 까지 중단`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url, "application/json, text/plain, */*");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`JSON 이 아님 (${text.slice(0, 40).replace(/\s+/g, " ")}…)`);
  }
}

/** "7,549.94" · "4.868%" → 숫자. 빈 값은 null */
function parseNumber(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text.replace(/[,%\s]/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** "2026-11-09T17:12:50.000-0500" · "2026-11-10T12:21:00+09:00" → ISO(UTC). 못 읽으면 null */
function isoTime(raw: unknown): string | null {
  if (!raw) return null;
  const text = String(raw).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ───────────────────────── CNBC ─────────────────────────

const CNBC_URL = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol";

type CnbcQuote = {
  symbol?: string;
  code?: number | string;
  last?: string;
  last_time?: string;
  curmktstatus?: string;
  realTime?: string;
};
type CnbcResponse = { FormattedQuoteResult?: { FormattedQuote?: CnbcQuote | CnbcQuote[] } };

/** 심볼 여러 개를 한 번에. 돌려주는 Map 에는 값이 있는 심볼만 들어 있다. */
export async function fetchCnbcQuotes(symbols: string[]): Promise<Map<string, RawQuote>> {
  const url = `${CNBC_URL}?symbols=${encodeURIComponent(symbols.join("|"))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const json = await fetchJson<CnbcResponse>(url);
  const raw = json?.FormattedQuoteResult?.FormattedQuote;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = new Map<string, RawQuote>();
  for (const quote of list) {
    if (!quote?.symbol || String(quote.code ?? "0") !== "0") continue;
    const value = parseNumber(quote.last);
    if (value === null) continue;
    out.set(quote.symbol, {
      value,
      time: isoTime(quote.last_time),
      status: quote.curmktstatus ?? null,
      delayed: String(quote.realTime) !== "true",
    });
  }
  return out;
}

// ───────────────────────── 네이버 ─────────────────────────

const NAVER = "https://m.stock.naver.com";

type NaverIndex = { closePrice?: string; localTradedAt?: string; marketStatus?: string };
type NaverProduct = {
  isSuccess?: boolean;
  message?: string;
  result?: { closePrice?: string; localTradedAt?: string; marketStatus?: string };
};
type NaverRow = { localTradedAt?: string; closePrice?: string };

/** 지수 현재가 — KOSPI 등. marketStatus 가 OPEN 이면 장중치, CLOSE 면 종가 */
export async function fetchNaverIndex(code: string): Promise<RawQuote> {
  const json = await fetchJson<NaverIndex>(`${NAVER}/api/index/${encodeURIComponent(code)}/basic`);
  const value = parseNumber(json?.closePrice);
  if (value === null) throw new Error("closePrice 없음");
  return { value, time: isoTime(json.localTradedAt), status: json.marketStatus ?? null, delayed: false };
}

/** 시장지표 상세 — category: "bond"(KR10YT=RR 등) · "exchange"(FX_USDKRW 등) */
export async function fetchNaverProduct(category: "bond" | "exchange", code: string): Promise<RawQuote> {
  const json = await fetchJson<NaverProduct>(
    `${NAVER}/front-api/marketIndex/productDetail?category=${category}&reutersCode=${encodeURIComponent(code)}`
  );
  const result = json?.result;
  if (!json?.isSuccess || !result) throw new Error(json?.message || "isSuccess=false");
  const value = parseNumber(result.closePrice);
  if (value === null) throw new Error("closePrice 없음");
  return { value, time: isoTime(result.localTradedAt), status: result.marketStatus ?? null, delayed: false };
}

/** 지수 일별 종가 (최근 pageSize 거래일, 날짜 오름차순). 오늘 행은 장중이면 현재가다 — 부르는 쪽이 거른다. */
export async function fetchNaverIndexHistory(code = "KOSPI", pageSize = 60): Promise<DatedValue[]> {
  const rows = await fetchJson<NaverRow[]>(`${NAVER}/api/index/${encodeURIComponent(code)}/price?pageSize=${pageSize}&page=1`);
  if (!Array.isArray(rows)) throw new Error("배열이 아님");
  return rows
    .map((row) => ({ date: String(row.localTradedAt ?? "").slice(0, 10), value: parseNumber(row.closePrice) }))
    .filter((p): p is DatedValue => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── 美 재무부 ─────────────────────────

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  while (year * 12 + month <= end) {
    out.push(`${year}${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/** 일별 금리표(par yield curve)의 10년 값. from~to 가 걸치는 달을 모두 받는다. 날짜 오름차순. */
export async function fetchTreasury10y(from: string, to: string): Promise<DatedValue[]> {
  const points: DatedValue[] = [];
  for (const yyyymm of monthsBetween(from, to)) {
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}`;
    const xml = await fetchText(url, "application/xml, text/xml, */*");
    for (const entry of xml.split("<entry>").slice(1)) {
      const date = /<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/.exec(entry);
      const value = /<d:BC_10YEAR[^>]*>([\d.]+)</.exec(entry);
      if (date && value) points.push({ date: date[1], value: Number(value[1]) });
    }
  }
  return points
    .filter((p) => p.date >= from && p.date <= to && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ───────────────────────── 묶음 조회 ─────────────────────────

/**
 * 계열 id 들의 지금 시세. 절대 throw 하지 않는다 — 못 받은 id 는 errors 에 사유가 들어간다.
 */
export async function fetchLiveQuotes(ids: string[]): Promise<LiveQuotesResult> {
  const wanted = ids.filter((id) => LIVE_SOURCES[id]);
  const cnbcSymbols = [
    ...new Set(wanted.flatMap((id) => LIVE_SOURCES[id].flatMap((s) => (s.kind === "cnbc" ? [s.symbol] : [])))),
  ];
  const cnbcPromise: Promise<Map<string, RawQuote> | Error> = cnbcSymbols.length
    ? fetchCnbcQuotes(cnbcSymbols).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
    : Promise.resolve(new Map<string, RawQuote>());

  const naverJobs = new Map<string, Promise<RawQuote | Error>>();
  for (const id of wanted) {
    for (const source of LIVE_SOURCES[id]) {
      if (source.kind === "cnbc") continue;
      const key = `${source.kind}:${source.code}`;
      if (naverJobs.has(key)) continue;
      const job =
        source.kind === "naver-index"
          ? fetchNaverIndex(source.code)
          : fetchNaverProduct(source.kind === "naver-bond" ? "bond" : "exchange", source.code);
      naverJobs.set(
        key,
        job.catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
      );
    }
  }

  const cnbc = await cnbcPromise;
  const naver = new Map(await Promise.all([...naverJobs].map(async ([key, job]) => [key, await job] as const)));

  const quotes: Record<string, LiveQuoteValue> = {};
  const errors: Record<string, string> = {};
  for (const id of ids) {
    if (!LIVE_SOURCES[id]) {
      errors[id] = "시세 출처 없음";
      continue;
    }
    const tried: string[] = [];
    for (const source of LIVE_SOURCES[id]) {
      let quote: RawQuote | null = null;
      let label: string;
      if (source.kind === "cnbc") {
        label = `CNBC ${source.symbol}`;
        if (cnbc instanceof Error) tried.push(`${label}: ${cnbc.message}`);
        else if (!cnbc.has(source.symbol)) tried.push(`${label}: 응답에 없음`);
        else quote = cnbc.get(source.symbol) ?? null;
      } else {
        label = `네이버 ${source.code}`;
        const result = naver.get(`${source.kind}:${source.code}`);
        if (result instanceof Error) tried.push(`${label}: ${result.message}`);
        else if (!result) tried.push(`${label}: 조회 안 함`);
        else quote = result;
      }
      if (quote) {
        quotes[id] = { value: quote.value, time: quote.time, source: label, status: quote.status, delayed: quote.delayed };
        break;
      }
    }
    if (!quotes[id]) errors[id] = tried.join(" / ") || "출처 없음";
  }
  return { quotes, errors, fetchedAt: new Date().toISOString() };
}
