#!/usr/bin/env node
/**
 * 주간 모니터링용 지표 주간 변동 — Claude Code 의 /weekly 스킬이 실행한다.
 *
 * Next.js 바깥의 순수 Node 스크립트라 lib/ 를 import 하지 않고 조회를 짧게 다시 쓴다
 * (계열 정의는 lib/catalog.ts 와 같아야 한다). .env.local 의 ECOS_API_KEY 를 읽고,
 * 없으면 FRED 계열(S&P 500 · 美 10년물 · WTI)만 돌려준다.
 *
 *   node scripts/weekly-indicators.mjs            # 오늘(KST) 포함 7일. 최근치는 실행 시점 시세(CNBC·네이버 — scripts/lib/live-quotes.mjs)
 *   node scripts/weekly-indicators.mjs 2026-11-02 # 종료일 지정 (오늘이 아니면 시세는 붙이지 않고 집계치만)
 *   node scripts/weekly-indicators.mjs --no-live  # 시세 없이 집계치(FRED·ECOS)만
 *
 * 최근치가 시세면 latest.time 에 그 시각(ISO)이 들어간다. 시세를 못 받은 지표는 집계치의 마지막 관측치가 최근치다.
 * stdout: { weekStart, weekEnd, liveAt, indicators: [...] } — data/<YYMMDD>-weekly-brief.json 의 indicators 에 그대로 넣는다.
 * stderr: 읽기 좋은 표.
 */
import { readFileSync } from "node:fs";

import { fetchLiveQuotes } from "./lib/live-quotes.mjs";

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

/** lib/catalog.ts 의 SERIES 와 lib/weekly.ts 의 INDICATORS 를 합친 것 */
const INDICATORS = [
  { id: "sp500", label: "S&P 500", unit: "", digits: 2, changeStyle: "pct", source: "fred", seriesId: "SP500" },
  { id: "ust10", label: "美 10년물", unit: "%", digits: 2, changeStyle: "bp", source: "fred", seriesId: "DGS10" },
  { id: "kospi", label: "KOSPI", unit: "", digits: 2, changeStyle: "pct", source: "ecos", statCode: "802Y001", itemCode1: "0001000" },
  { id: "ktb3", label: "국고채 3년", unit: "%", digits: 2, changeStyle: "bp", source: "ecos", statCode: "817Y002", itemCode1: "010200000" },
  { id: "usdkrw", label: "원/달러", unit: "원", digits: 1, changeStyle: "pct", source: "ecos", statCode: "731Y001", itemCode1: "0000001" },
  { id: "wti", label: "WTI", unit: "$", digits: 2, changeStyle: "pct", source: "fred", seriesId: "DCOILWTICO" },
];

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function fetchFred(seriesId, since) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${since}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  const lines = (await res.text()).trim().split(/\r?\n/).slice(1);
  // 휴일은 값이 "" 또는 "." 로 온다 — Number("") 은 0 이라 숫자 검사로는 걸러지지 않으니 문자열에서 거른다.
  return lines
    .map((line) => {
      const [date, raw = ""] = line.split(",");
      return { date, raw: raw.trim() };
    })
    .filter((p) => p.date?.length === 10 && p.raw !== "" && p.raw !== ".")
    .map((p) => ({ date: p.date, value: Number(p.raw) }))
    .filter((p) => Number.isFinite(p.value));
}

async function fetchEcos(statCode, itemCode1, since, until) {
  if (!ECOS_KEY) throw new Error("ECOS_API_KEY 없음");
  const start = since.replaceAll("-", "");
  const end = until.replaceAll("-", "");
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ECOS_KEY)}/json/kr/1/200/${statCode}/D/${start}/${end}/${itemCode1}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ECOS HTTP ${res.status}`);
  const json = await res.json();
  if (json.RESULT) {
    if (json.RESULT.CODE === "INFO-200") return [];
    throw new Error(`ECOS ${json.RESULT.CODE}: ${json.RESULT.MESSAGE}`);
  }
  return (json.StatisticSearch?.row ?? [])
    .map((row) => ({
      date: `${row.TIME.slice(0, 4)}-${row.TIME.slice(4, 6)}-${row.TIME.slice(6, 8)}`,
      value: Number(row.DATA_VALUE),
    }))
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function fmt(value, digits) {
  return value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signed(value, digits) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value), digits)}`;
}

/** ISO 시각 → "12:21" (KST) */
function fmtTime(iso) {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

async function main() {
  const argv = process.argv.slice(2);
  const noLive = argv.includes("--no-live");
  const dateArg = argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
  const today = todayKst();
  const weekEnd = dateArg ?? today;
  const weekStart = shiftDate(weekEnd, -6);
  const since = shiftDate(weekStart, -14);

  // 실행 시점 시세 — 종료일이 오늘일 때만. 못 받은 지표는 집계치로 간다.
  const liveWanted = weekEnd === today && !noLive;
  const live = liveWanted
    ? await fetchLiveQuotes(INDICATORS.map((spec) => spec.id))
    : { quotes: {}, errors: {}, fetchedAt: null };
  if (!liveWanted && !noLive) console.error(`종료일 ${weekEnd} 이 오늘(${today})이 아니라 실시간 시세는 붙이지 않습니다.`);

  const indicators = [];
  const table = ["| 지표 | 한 주 전 | 최근 | 변동 |", "|---|---|---|---|"];

  for (const spec of INDICATORS) {
    try {
      const points = (
        spec.source === "fred"
          ? await fetchFred(spec.seriesId, since)
          : await fetchEcos(spec.statCode, spec.itemCode1, since, weekEnd)
      ).filter((p) => p.date <= weekEnd);
      const quote = live.quotes[spec.id];
      if (liveWanted && !quote) console.error(`[${spec.id}] 실시간 시세 실패 — 집계치 사용: ${live.errors[spec.id] ?? "원인 불명"}`);
      const latest = quote ? { date: weekEnd, value: quote.value, time: quote.time ?? live.fetchedAt } : points.at(-1);
      if (!latest) throw new Error("데이터 없음");

      let weekAgo = null;
      for (const point of points) {
        if (point.date >= weekStart) break;
        weekAgo = point;
      }

      const { id, label, unit, digits, changeStyle } = spec;
      indicators.push({ id, label, unit, digits, changeStyle, latest, weekAgo });

      let change = "-";
      if (weekAgo) {
        const diff = latest.value - weekAgo.value;
        change =
          spec.changeStyle === "bp"
            ? `${signed(Math.round(diff * 100), 0)}bp`
            : `${signed(diff, spec.digits)} (${signed((diff / weekAgo.value) * 100, 2)}%)`;
      }
      const latestNote = latest.time ? `${latest.date} ${fmtTime(latest.time)} 시세` : latest.date;
      table.push(
        `| ${spec.label} | ${weekAgo ? `${fmt(weekAgo.value, spec.digits)}${spec.unit} (${weekAgo.date})` : "-"} | ${fmt(latest.value, spec.digits)}${spec.unit} (${latestNote}) | ${change} |`
      );
    } catch (error) {
      console.error(`[${spec.id}] 조회 실패: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.error(
    `대상 기간 ${weekStart} ~ ${weekEnd}${live.fetchedAt ? ` · 최근치는 ${fmtTime(live.fetchedAt)} KST 실행 시점 시세(CNBC·네이버)` : ""}\n${table.join("\n")}`
  );
  console.log(JSON.stringify({ weekStart, weekEnd, liveAt: live.fetchedAt, indicators }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
