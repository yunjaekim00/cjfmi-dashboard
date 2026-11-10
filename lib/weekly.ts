import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { revalidateTag, unstable_cache } from "next/cache";
import { z } from "zod";

import { SERIES, type SeriesDef, type SeriesId } from "@/lib/catalog";
import { formatChange, formatKoreanDate, formatNumber } from "@/lib/format";
import { getLiveQuotes, listMarketSnapshots, overlayLiveMarket, readMarketFile } from "@/lib/market";
import { latestOnOrBefore, pickWeekAgo, stampKey } from "@/lib/market-shared";
import { fetchEcosSeries } from "@/lib/sources/ecos";
import { fetchFredSeries } from "@/lib/sources/fred";
import type { Point } from "@/lib/types";
import {
  REACTION_CATEGORIES,
  type WeeklyBrief,
  type WeeklyIndicator,
  type WeeklyMarket,
  type WeeklySource,
} from "@/lib/weekly-types";

/*
 * "3. 주간 모니터링" — 지난 일주일 뉴스를 Claude 가 읽고 보고서 문장으로 정리한다. (서버 전용)
 *
 * 두 경로가 있다.
 *  1) 파일: Claude Code 의 /weekly 스킬(.claude/skills/weekly)이 data/YYMMDD-weekly-brief.json 을 쓴다.
 *     구독만으로 운영하는 경로이고, 파일이 있으면 늘 이것을 보여준다.
 *  2) API: 파일이 없을 때 — 지표 주간 변동 계산(ECOS·FRED) → Claude 에 웹 검색·열람 도구를
 *     주고 요약 요청 → JSON 추출·검증 → 캐시.
 *
 * 한 번 만드는 데 1~2분, 비용은 모델 토큰 + 검색 건당 $0.01 정도다. 그래서
 *  - 하루에 한 번만 만들고(unstable_cache, 12시간),
 *  - 같은 프로세스 안에서는 메모리에도 들고 있으며(핫리로드·배포 캐시 유실 대비),
 *  - 동시에 들어온 요청은 하나의 생성을 함께 기다린다.
 */

// ───────────────────────── 설정 ─────────────────────────

/** 요약을 만드는 모델. 바꾸려면 .env 에 WEEKLY_MODEL 을 둔다. */
const MODEL = process.env.WEEKLY_MODEL?.trim() || "claude-opus-5-5";

/**
 * 뉴스 출처. 검색·열람 모두 이 도메인 안에서만 한다 (하위 도메인 자동 포함).
 * 앞의 둘이 주 출처이고, 뒤의 둘은 韓 증시·외환 세부(외국인 수급, 수출업체 매도 등)를
 * 보충할 때만 쓰라고 프롬프트에서 지시한다. 출처를 바꾸려면 여기만 고치면 된다.
 * (Reuters 는 Anthropic 크롤러를 차단해 검색이 되지 않는다 — 넣어도 결과가 없다.)
 */
const NEWS_DOMAINS = ["bloomberg.com", "kcif.or.kr", "yna.co.kr", "einfomax.co.kr"];

/** 요청 한 번에 허용하는 검색·열람 횟수. 검색은 건당 $0.01. */
const MAX_SEARCHES = 8;
const MAX_FETCHES = 4;

/** 서버 쪽 도구 루프가 길어져 pause_turn 으로 끊기면 이 횟수까지 이어 받는다. */
const MAX_CONTINUATIONS = 4;

/** 캐시 수명. 날짜가 바뀌면 키(대상 기간 끝)도 바뀌어 하루 한 번 새로 만든다. */
const CACHE_SECONDS = 12 * 60 * 60;
const CACHE_TAG = "weekly-brief";

/** 모델에 제공하는 지표 — 사용자가 지정한 다섯 개에 韓 금리 기준물을 더했다. */
const INDICATORS: Array<Omit<WeeklyIndicator, "latest" | "weekAgo"> & { id: SeriesId }> = [
  { id: "sp500", label: "S&P 500", unit: "", digits: 2, changeStyle: "pct" },
  { id: "ust10", label: "美 10년물", unit: "%", digits: 2, changeStyle: "bp" },
  { id: "kospi", label: "KOSPI", unit: "", digits: 2, changeStyle: "pct" },
  { id: "ktb3", label: "국고채 3년", unit: "%", digits: 2, changeStyle: "bp" },
  { id: "usdkrw", label: "원/달러", unit: "원", digits: 1, changeStyle: "pct" },
  { id: "wti", label: "WTI", unit: "$", digits: 2, changeStyle: "pct" },
];

/** API 키가 없는 것처럼 설정 문제. 모델·네트워크 오류와 구분해 503 으로 돌려준다. */
export class WeeklyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeeklyConfigError";
  }
}

// ───────────────────────── 날짜 ─────────────────────────

/** 서버가 어디에 있든 한국 날짜 기준으로 "오늘"을 정한다. */
function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 대상 기간의 끝 = 어제. "지난 일주일"은 끝난 7일이다 — 월요일 아침에 보면 지난주 월~일이 되고,
 * 한 주 전 비교점은 그 직전 금요일 종가가 된다. 오늘을 넣으면 아직 열리지 않은 장이 섞인다.
 */
function defaultWeekEnd(): string {
  return shiftDate(todayKst(), -1);
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

// ───────────────────────── 지표 ─────────────────────────

function toStamp(iso: string, cycle: "D" | "M"): string {
  return cycle === "D" ? iso.replaceAll("-", "") : iso.slice(0, 7).replace("-", "");
}

/** 최근 구간만 받아온다. 조회 창이 하나라 ECOS 호출은 계열당 1회다. */
async function fetchRecent(def: SeriesDef, since: string, until: string): Promise<Point[]> {
  if (def.source === "ecos") {
    return fetchEcosSeries({
      statCode: def.statCode,
      cycle: def.cycle,
      itemCode1: def.itemCode1,
      start: toStamp(since, def.cycle),
      end: toStamp(until, def.cycle),
    });
  }
  return fetchFredSeries(def.seriesId, since);
}

/**
 * 지표별 "한 주 전 → 최근" 을 만든다. 한 주 전은 대상 기간 시작일 직전 관측치다.
 * 한 계열이 실패해도(키 없음·한도) 나머지로 진행한다 — 뉴스 요약 자체는 가능하므로.
 */
async function loadIndicators(weekStart: string, weekEnd: string): Promise<WeeklyIndicator[]> {
  const since = shiftDate(weekStart, -14);

  const loaded = await Promise.all(
    INDICATORS.map(async (spec): Promise<WeeklyIndicator | null> => {
      try {
        const points = await fetchRecent(SERIES[spec.id], since, weekEnd);
        const latest = points.at(-1);
        if (!latest) return null;

        let weekAgo: Point | null = null;
        for (const point of points) {
          if (point.date >= weekStart) break;
          weekAgo = point;
        }

        return { ...spec, latest, weekAgo };
      } catch (error) {
        console.warn(`[weekly] ${spec.id} 지표 조회 실패:`, error instanceof Error ? error.message : error);
        return null;
      }
    })
  );

  return loaded.filter((entry): entry is WeeklyIndicator => entry !== null);
}

function describeIndicators(indicators: WeeklyIndicator[]): string {
  if (!indicators.length) return "(지표 데이터를 받아오지 못했습니다. 기사에서 확인한 수치만 쓰세요.)";

  const rows = indicators.map((i) => {
    const latest = `${formatNumber(i.latest.value, i.digits)}${i.unit} (${formatKoreanDate(i.latest.date)})`;
    if (!i.weekAgo) return `| ${i.label} | - | ${latest} | - |`;

    const change = i.latest.value - i.weekAgo.value;
    const changePct = i.weekAgo.value !== 0 ? (change / i.weekAgo.value) * 100 : 0;
    const weekAgo = `${formatNumber(i.weekAgo.value, i.digits)}${i.unit} (${formatKoreanDate(i.weekAgo.date)})`;
    return `| ${i.label} | ${weekAgo} | ${latest} | ${formatChange(i.changeStyle, change, changePct, i.digits)} |`;
  });

  return ["| 지표 | 한 주 전 | 최근 | 변동 |", "|---|---|---|---|", ...rows].join("\n");
}

// ───────────────────────── 예시 (서식 기준) ─────────────────────────

/**
 * 참고 보고서의 한 주치 원문. 모델에는 서식 예시로 주고,
 * 화면에서는 `?sample=1` 로 API 호출 없이 레이아웃을 확인하는 데 쓴다.
 */
export const SAMPLE_BRIEF: WeeklyBrief = {
  weekStart: "2026-10-13",
  weekEnd: "2026-10-19",
  generatedAt: "2026-10-19T09:00:00+09:00",
  model: "sample",
  source: "sample",
  issue: {
    headline: "美 AI 투자 관련 금융시장 경계감 확대, 10월 기준금리 동결 기대 강화",
    points: [
      "코어위브(AI 클라우드社) 회사채 금리 16% 돌파로 AI 데이터센터 관련 자금조달 부담 재부각",
      "연준의장, 구체적 금리경로 제시 유보로 10월 기준금리 동결 확률 83%로 상승",
    ],
  },
  reaction: {
    headline: "유가 100달러 상회에 韓/美 증시 {{↓}}, 美 기준금리 동결 기대에 시장금리도 {{↓}}",
    items: [
      {
        category: "원자재",
        text: "{{WTI}}는 이란의 호르무즈 공격 지속과 美 원유재고 급감(-860만배럴, 전주比)에 {{100달러 상회}}, {{금 가격}}은 금리 부담에도 증시조정/중동불안에 따른 안전자산 수요로 {{보합}}",
      },
      {
        category: "주가",
        text: "{{S&P500}}와 {{KOSPI}} 모두 AI 투자 관련 차입 우려와 유가 상승 부담에 {{동반 하락}}, 다만 KOSPI는 저가매수 유입으로 13거래일만에 외국인 순매수 전환하며 낙폭 축소",
      },
      {
        category: "금리",
        text: "{{美}}는 기술주 조정에 따른 안전자산 수요로 {{하락}}, {{韓}}도 금통위 10월 기준금리 동결 전망(22일 豫)에도 불구 외국인 국채선물 매수세에 소폭 {{하락}}",
      },
      {
        category: "외환",
        text: "{{원달러}}는 반도체 수출 호조發 수출업체 달러 매도와 외국인 순매수 전환에 {{1,330원↓}}",
      },
    ],
  },
  sources: [],
  indicators: [],
};

/** 모델을 부르지 않는 미리보기 — 문장은 참고 원문 그대로, 지표 각주만 실제 값이다. */
export async function getSampleBrief(): Promise<WeeklyBrief> {
  const weekEnd = defaultWeekEnd();
  return {
    ...SAMPLE_BRIEF,
    indicators: await loadIndicators(shiftDate(weekEnd, -6), weekEnd),
    market: await readMarketFile(),
  };
}

function renderExample(brief: WeeklyBrief): string {
  return [
    `- [주간이슈] ${brief.issue.headline}`,
    ...brief.issue.points.map((point) => `  · ${point}`),
    `- [시장반응] ${brief.reaction.headline}`,
    ...brief.reaction.items.map((item) => `  · (${item.category}) ${item.text}`),
  ].join("\n");
}

// ───────────────────────── 프롬프트 ─────────────────────────

const SYSTEM_PROMPT = `당신은 한국 대기업 경제연구 조직의 금융시장 모니터링 담당자다. 매주 임원 보고용 「금융시장 모니터링」의 [주간이슈]·[시장반응] 단락을 쓴다. 짧고 밀도 높은 개조식 문장으로, 아래 예시의 서식과 문체를 그대로 따른다.

## 자료 수집
- web_search 로 대상 기간의 금융시장 뉴스를 찾는다. 주 출처는 Bloomberg(bloomberg.com)와 국제금융센터(kcif.or.kr — 국제금융속보, 주간 국제금융 주요이슈 및 전망)다. 연합뉴스·연합인포맥스는 韓 증시·외환의 세부(외국인 수급, 수출업체 달러 매도 등)를 보충할 때만 쓴다.
- 관심 지표: 미국 주가지수(S&P500), 미국 국채금리(10년물), KOSPI, 원/달러 환율, WTI 유가. 이 지표들을 움직인 뉴스를 찾는다.
- 검색은 최소 4회(① Bloomberg 주간 시장 정리 ② 국제금융센터 국제금융속보·주간 이슈 ③ 지표별 핵심 이벤트 — 연준·금통위·물가·고용·실적·지정학 ④ 韓 증시·환율 수급), 필요하면 web_fetch 로 본문을 읽는다.
- 대상 기간 밖의 뉴스는 쓰지 않는다. 확인되지 않은 수치는 쓰지 않는다. 추측 금지.

## 내용 구성
- [주간이슈]: 지표를 움직인 가장 중요한 뉴스 3개를 고른다. headline 은 그중 가장 중요한 이슈(그 주를 요약하는 한 문장, 쉼표로 두 절까지), points 는 나머지 두 개(각각 "주체, 사건으로 결과" 구조).
- [시장반응] headline: 지표 움직임을 인과로 묶은 한 문장.
- [시장반응] items: 주가(S&P500·KOSPI), 금리(美 10년물·韓 국고채), 외환(원/달러), 원자재(WTI, 필요시 금) 각 한 문장. 그 주의 주도 요인을 앞에 둔다(기본 순서 주가→금리→외환→원자재). "{{지표}}는 원인에 {{결과}}" 구조로, 제공된 지표 표의 방향·수준과 맞아야 한다.

## 문체 규칙
- 개조식·명사형 종결: "확대", "상승", "하락", "보합", "재부각". 서술형 어미("~했다", "~입니다") 금지.
- 국가는 한자 약어: 美 韓 中 日 歐 英. 기관·회사 설명은 괄호 안에 짧게: 코어위브(AI 클라우드社).
- 수치·근거는 괄호 안에: (-860만배럴, 전주比), (22일 豫). 괄호 안은 화면에서 작은 글씨로 그려진다.
- 방향은 ↑ ↓ 를 쓸 수 있다. 한 문장은 한국어 45자 안팎, 최대 70자. 줄바꿈 없음.
- 파란 강조 {{…}}: 시장반응 items 에서만 ① 지표 이름(WTI, S&P500, KOSPI, 원달러, 美, 韓 …) ② 결과 구절(방향·수준)에 붙인다. 시장반응 headline 에서는 화살표만 {{↓}} 처럼 감쌀 수 있다. 주간이슈에는 붙이지 않는다.

## 서식 예시 (지난 보고서 원문 — 내용은 참고하지 말고 서식·문체만 따른다)
${renderExample(SAMPLE_BRIEF)}

## 출력
자료 수집이 끝나면 마지막에 아래 모양의 JSON 하나만 \`\`\`json 코드블록으로 출력한다. 코드블록 밖에 다른 글은 쓰지 않는다.
{
  "issue": { "headline": "…", "points": ["…", "…"] },
  "reaction": { "headline": "…", "items": [ { "category": "주가", "text": "…" }, { "category": "금리", "text": "…" }, { "category": "외환", "text": "…" }, { "category": "원자재", "text": "…" } ] },
  "sources": [ { "title": "기사 제목", "publisher": "Bloomberg | 국제금융센터 | 연합뉴스 | 연합인포맥스", "url": "https://…", "date": "YYYY-MM-DD 또는 null" } ]
}
sources 에는 실제로 참고한 기사 4~8건을 검색 결과의 URL 그대로 넣는다.`;

function buildUserPrompt(weekStart: string, weekEnd: string, indicators: WeeklyIndicator[]): string {
  return `오늘은 ${weekEnd}(${weekday(weekEnd)})이다. 대상 기간: ${weekStart}(${weekday(weekStart)}) ~ ${weekEnd}(${weekday(weekEnd)}).

지표 주간 변동 (한국은행 ECOS · FRED, 최근 관측일 기준):
${describeIndicators(indicators)}

위 표의 수치는 확정치이므로 문장에 쓸 때 그대로 쓴다. 다만 FRED 계열(S&P 500, 美 10년물, WTI)은 집계가 며칠 늦어 "최근" 날짜가 대상 기간 끝보다 이를 수 있다 — 그 뒤의 움직임과 최신 수준은 기사로 확인해 보완한다.

이제 자료를 수집하고, 끝나면 JSON 을 출력한다.`;
}

// ───────────────────────── 모델 응답 검증 ─────────────────────────

const Line = z.string().trim().min(1);
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다");

/** 모델(API)과 Claude Code(/weekly 스킬)가 똑같이 지켜야 하는 본문 모양. scripts/weekly-validate.mjs 와 맞춘다. */
const BODY_SHAPE = {
  issue: z.object({ headline: Line, points: z.array(Line).min(2).max(2) }),
  reaction: z.object({
    headline: Line,
    items: z.array(z.object({ category: z.enum(REACTION_CATEGORIES), text: Line })).min(4).max(4),
  }),
  sources: z
    .array(
      z.object({
        title: z.string(),
        publisher: z.string(),
        url: z.string(),
        date: z.string().nullable().optional(),
      })
    )
    .default([]),
};

function hasAllCategories(value: { reaction: { items: Array<{ category: string }> } }): boolean {
  return new Set(value.reaction.items.map((item) => item.category)).size === REACTION_CATEGORIES.length;
}

const CATEGORY_RULE = {
  message: "reaction.items 의 category 는 주가·금리·외환·원자재가 각각 한 번씩이어야 합니다.",
};

/** 모델이 돌려주는 JSON */
const RawBrief = z.object(BODY_SHAPE).refine(hasAllCategories, CATEGORY_RULE);
type RawBrief = z.infer<typeof RawBrief>;

const PointSchema = z.object({ date: DateString, value: z.number(), time: z.string().nullable().optional() });

/** Claude Code 가 쓰는 data/weekly-brief.json */
const FileBrief = z
  .object({
    ...BODY_SHAPE,
    weekStart: DateString,
    weekEnd: DateString,
    generatedAt: z.string(),
    model: z.string().default("claude-code"),
    indicators: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          unit: z.string(),
          digits: z.number().int(),
          changeStyle: z.enum(["bp", "pct"]),
          latest: PointSchema,
          weekAgo: PointSchema.nullable(),
        })
      )
      .default([]),
  })
  .refine(hasAllCategories, CATEGORY_RULE);

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

/** 응답 본문에서 JSON 을 꺼낸다. ```json 블록이 있으면 마지막 것을, 없으면 가장 바깥 중괄호를 쓴다. */
function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].at(-1)?.[1];
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  const candidate = fenced ?? (open >= 0 && close > open ? text.slice(open, close + 1) : "");

  if (!candidate.trim()) throw new Error("응답에 JSON 이 없습니다.");
  return JSON.parse(candidate);
}

/** 모델이 적어 준 출처 중 URL 이 멀쩡한 것만, 날짜는 YYYY-MM-DD 만 남긴다. */
function normalizeSources(sources: RawBrief["sources"]): WeeklySource[] {
  const seen = new Set<string>();
  const result: WeeklySource[] = [];

  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) continue;
    seen.add(url.href);

    const date = source.date && /^\d{4}-\d{2}-\d{2}$/.test(source.date) ? source.date : null;
    result.push({
      title: source.title.trim() || url.hostname,
      publisher: source.publisher.trim() || url.hostname,
      url: url.href,
      date,
    });
    if (result.length >= 12) break;
  }

  return result;
}

function parseBrief(text: string): { brief: RawBrief | null; error: string | null } {
  try {
    const parsed = RawBrief.safeParse(extractJson(text));
    if (parsed.success) return { brief: parsed.data, error: null };
    return { brief: null, error: formatIssues(parsed.error) };
  } catch (error) {
    return { brief: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// ───────────────────────── Claude Code 가 만든 파일 ─────────────────────────

/**
 * /weekly 스킬이 결과를 쌓는 폴더. 파일명은 `YYMMDD-HHMM-weekly-brief.json`(실행 날짜·시각 KST, 예 261110-1405).
 * 시각 없는 옛 이름(`YYMMDD-…`)도 받는다. 지난 파일은 지우지 않고 남기며, 화면에는 접두사가 가장 늦은 것만 보여준다.
 * 배포본에 들어가도록 next.config.ts 가 이 폴더를 함수 번들에 포함한다.
 */
export const BRIEF_DIR = path.join(process.cwd(), "data");
const BRIEF_FILE_PATTERN = /^\d{6}(?:-\d{4})?-weekly-brief\.json$/;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** 가장 최근 파일의 이름. 날짜 접두사(파일명) 기준이라 지난 파일을 손봐도 순서가 바뀌지 않는다. 없으면 null. */
async function findLatestBriefFile(): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(BRIEF_DIR);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  const dated = names.filter((name) => BRIEF_FILE_PATTERN.test(name)).sort((a, b) => stampKey(a).localeCompare(stampKey(b)));
  // 접두사 없는 옛 이름도 받아 주되, 날짜 붙은 파일이 하나라도 있으면 그쪽이 우선이다.
  return dated.at(-1) ?? (names.includes("weekly-brief.json") ? "weekly-brief.json" : null);
}

/** 파일이 없으면 null. 있으면 검증해서 돌려주고, 지표 각주가 비어 있으면 여기서 채운다. */
async function readBriefFile(): Promise<WeeklyBrief | null> {
  const name = await findLatestBriefFile();
  if (!name) return null;

  // 경로를 fs 호출 자리에서 "data" 하위로 묶어 써야 Turbopack 이 data/ 만 번들에 넣는다
  // (변수에 담아 넘기면 프로젝트 전체를 추적한다는 경고가 난다).
  let mtime: number;
  try {
    mtime = (await stat(path.join(process.cwd(), "data", name))).mtimeMs;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  // 지표 계산(ECOS·FRED)을 요청마다 하지 않도록 파일명과 수정 시각을 키로 캐시한다.
  const key = `file:${name}:${mtime}`;
  const cached = memo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.brief;

  let json: unknown;
  try {
    json = JSON.parse(await readFile(path.join(process.cwd(), "data", name), "utf8"));
  } catch (error) {
    throw new WeeklyConfigError(
      `data/${name} 을 읽지 못했습니다: ${error instanceof Error ? error.message : error}`
    );
  }

  const parsed = FileBrief.safeParse(json);
  if (!parsed.success) {
    throw new WeeklyConfigError(`data/${name} 형식 오류 — ${formatIssues(parsed.error)}`);
  }

  const data = parsed.data;
  const brief: WeeklyBrief = {
    weekStart: data.weekStart,
    weekEnd: data.weekEnd,
    generatedAt: data.generatedAt,
    model: data.model,
    source: "file",
    file: name,
    issue: data.issue,
    reaction: data.reaction,
    sources: normalizeSources(data.sources),
    // 클라우드에서 만들어 ECOS 키가 없었으면 지표가 비어 있다 — 서버에서 채운다.
    indicators: data.indicators.length
      ? data.indicators
      : await loadIndicators(data.weekStart, data.weekEnd),
  };

  memo.set(key, { brief, expiresAt: Date.now() + CACHE_SECONDS * 1000 });
  return brief;
}

// ───────────────────────── 모델 호출 ─────────────────────────

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

function createClient(): Anthropic {
  // 키는 ANTHROPIC_API_KEY 에서 읽는다 (없으면 SDK 가 ant auth login 프로필도 찾아본다).
  // Next.js 가 fetch 를 가로채 캐시하지 않도록 no-store 를 못 박는다.
  return new Anthropic({ fetchOptions: { cache: "no-store" } });
}

const FILE_HINT = "API 없이 쓰려면 Claude Code 에서 /weekly 를 실행해 data/YYMMDD-weekly-brief.json 을 만들면 됩니다.";

/** 키가 없거나(요청 시점에 SDK 가 알려 준다) 틀린 경우. */
function isCredentialError(error: unknown): boolean {
  if (error instanceof Anthropic.AuthenticationError) return true;
  return (
    error instanceof Anthropic.AnthropicError &&
    !(error instanceof Anthropic.APIError) &&
    /authentication method|api ?key/i.test(error.message)
  );
}

function textOf(message: BetaMessage): string {
  return message.content
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function logUsage(message: BetaMessage, label: string) {
  const { input_tokens, output_tokens, server_tool_use } = message.usage;
  console.log(
    `[weekly] ${label}: ${message.model} · 입력 ${input_tokens} · 출력 ${output_tokens} 토큰` +
      ` · 검색 ${server_tool_use?.web_search_requests ?? 0}회 · 열람 ${server_tool_use?.web_fetch_requests ?? 0}회` +
      ` · stop=${message.stop_reason}`
  );
}

/**
 * 한 턴을 끝까지 받는다. 웹 검색은 서버에서 반복 실행되는데 10회를 넘기면
 * pause_turn 으로 끊기므로, 받은 내용을 그대로 돌려보내 이어 가게 한다.
 */
async function runTurn(client: Anthropic, messages: BetaMessageParam[], label: string): Promise<BetaMessage> {
  const history = [...messages];

  for (let round = 0; round <= MAX_CONTINUATIONS; round += 1) {
    const message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 24_000,
        system: SYSTEM_PROMPT,
        messages: history,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_SEARCHES,
            allowed_domains: NEWS_DOMAINS,
            user_location: { type: "approximate", city: "Seoul", country: "KR", timezone: "Asia/Seoul" },
          },
          {
            type: "web_fetch_20260209",
            name: "web_fetch",
            max_uses: MAX_FETCHES,
            allowed_domains: NEWS_DOMAINS,
            max_content_tokens: 12_000,
          },
        ],
        output_config: { effort: "high" },
        // 안전 분류기가 요청을 거절하면 Anthropic 이 권장하는 다른 모델로 서버에서 다시 시도한다.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      })
      .finalMessage();

    logUsage(message, round ? `${label} (이어받기 ${round})` : label);

    if (message.stop_reason === "pause_turn") {
      history.push({ role: "assistant", content: message.content });
      continue;
    }

    if (message.stop_reason === "refusal") {
      throw new Error(`모델이 요청을 거절했습니다 (${message.stop_details?.category ?? "사유 미상"}).`);
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error("모델 출력이 길이 제한에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.");
    }

    return message;
  }

  throw new Error("웹 검색이 너무 길어져 중단했습니다. 잠시 뒤 다시 시도해 주세요.");
}

/** 실제 생성. 캐시는 바깥(getWeeklyBrief)에서 맡는다. */
async function generateBrief(weekEnd: string): Promise<WeeklyBrief> {
  const weekStart = shiftDate(weekEnd, -6);
  const client = createClient();
  const indicators = await loadIndicators(weekStart, weekEnd);

  const messages: BetaMessageParam[] = [
    { role: "user", content: buildUserPrompt(weekStart, weekEnd, indicators) },
  ];

  let message: BetaMessage;
  try {
    message = await runTurn(client, messages, "생성");
  } catch (error) {
    if (isCredentialError(error)) {
      throw new WeeklyConfigError(
        "요약 파일(data/YYMMDD-weekly-brief.json)이 없고 Claude API 키도 없습니다. " + FILE_HINT +
          " 또는 ANTHROPIC_API_KEY 를 .env.local(배포는 Vercel Environment Variables)에 넣고 서버를 다시 시작해 주세요."
      );
    }
    // 키는 맞지만 API 계정에 선불 크레딧이 없을 때 (claude.ai 구독과는 별도 결제)
    if (error instanceof Anthropic.APIError && /credit balance/i.test(error.message)) {
      throw new WeeklyConfigError(
        "Anthropic API 크레딧이 없습니다 (claude.ai 구독과는 별도 결제). " + FILE_HINT +
          " 또는 https://platform.claude.com → Plans & Billing 에서 크레딧을 충전해 주세요."
      );
    }
    throw error;
  }

  let { brief, error } = parseBrief(textOf(message));

  // 형식이 어긋나면 한 번만 고쳐 달라고 한다. 검색은 이미 끝났으니 빠르다.
  if (!brief) {
    console.warn(`[weekly] JSON 형식 오류, 다시 요청합니다: ${error}`);
    const repaired = await runTurn(
      client,
      [
        ...messages,
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `출력이 요구한 JSON 형식에 맞지 않습니다 (${error}). 검색은 더 하지 말고, 같은 내용을 형식에 맞춰 \`\`\`json 코드블록 하나로만 다시 출력해 주세요.`,
        },
      ],
      "형식 수정"
    );
    ({ brief, error } = parseBrief(textOf(repaired)));
    if (!brief) throw new Error(`모델 응답을 해석하지 못했습니다: ${error}`);
  }

  return {
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString(),
    model: message.model,
    source: "api",
    issue: brief.issue,
    reaction: brief.reaction,
    sources: normalizeSources(brief.sources),
    indicators,
  };
}

// ───────────────────────── 캐시 ─────────────────────────

type Memo = { brief: WeeklyBrief; expiresAt: number };

/** 프로세스 메모리 캐시. globalThis 에 두어 dev 핫리로드에도 살아남는다. */
const memo: Map<string, Memo> = ((globalThis as Record<string, unknown>).__weeklyMemo ??=
  new Map()) as Map<string, Memo>;

const inflight: Map<string, Promise<WeeklyBrief>> = ((globalThis as Record<string, unknown>)
  .__weeklyInflight ??= new Map()) as Map<string, Promise<WeeklyBrief>>;

/** 배포 환경에서 인스턴스가 바뀌어도 하루 한 번만 만들도록 Next.js 데이터 캐시에도 둔다. */
const generateCached = unstable_cache(generateBrief, ["weekly-brief"], {
  revalidate: CACHE_SECONDS,
  tags: [CACHE_TAG],
});

type Options = {
  /** 캐시를 비우고 새로 만든다 ("다시 생성"). 파일 경로에서는 의미가 없다. */
  force?: boolean;
};

export async function getWeeklyBrief(options: Options = {}): Promise<WeeklyBrief> {
  const brief = await resolveBrief(options);
  // 차트·환율표 자료는 본문과 별도 파일이다 — 접두사가 가장 늦은 파일을 붙이고, 둘 다 지금 시세로 덧씌운다.
  // 과거 파일들의 스냅샷 목록은 화면의 "전주比 기준" 드롭다운이 된다.
  const [market, snapshots] = await Promise.all([readMarketFile(), listMarketSnapshots()]);
  const result = await attachLive(brief, market);
  return result.market ? { ...result, market: { ...result.market, snapshots } } : result;
}

/**
 * 화면을 여는 시점의 시세를 덧씌운다 — 차트·환율표(기준일을 오늘로)와 지표 각주의 최근치.
 * 각주의 "한 주 전"은 차트 자료에서(오늘 − 7일 이전 마지막 관측치), 차트에 없는 계열(국고채 3년)은 출처에서 다시 잡는다.
 * 시세를 못 받으면 파일 그대로 보여준다. (사용자 요청: 08:30 고시·전일 종가가 아니라 지금 값)
 */
async function attachLive(brief: WeeklyBrief, market: WeeklyMarket | null): Promise<WeeklyBrief> {
  const live = await getLiveQuotes();
  if (!live || !Object.keys(live.quotes).length) return { ...brief, market };

  const today = todayKst();
  const liveMarket = market ? overlayLiveMarket(market, live, today) : null;
  const indicators = await Promise.all(
    brief.indicators.map(async (indicator): Promise<WeeklyIndicator> => {
      const quote = live.quotes[indicator.id];
      if (!quote) return indicator;
      const latest = { date: today, value: quote.value, time: quote.time ?? live.fetchedAt };
      const chart = liveMarket?.charts.find((c) => c.id === indicator.id);
      const weekAgo = chart ? pickWeekAgo(chart.points, latest) : await weekAgoFromSource(indicator.id, today);
      return { ...indicator, latest, weekAgo: weekAgo ?? indicator.weekAgo };
    })
  );
  return { ...brief, indicators, market: liveMarket };
}

/** 차트 자료에 없는 계열의 "한 주 전" — 출처에서 최근 3주를 받아 오늘 − 7일 이전 마지막 관측치. 30분 캐시. */
const weekAgoMemo: Map<string, { point: Point | null; expiresAt: number }> = ((globalThis as Record<string, unknown>)
  .__weeklyWeekAgo ??= new Map()) as Map<string, { point: Point | null; expiresAt: number }>;

async function weekAgoFromSource(id: string, today: string): Promise<Point | null> {
  if (!(id in SERIES)) return null;
  const key = `${id}:${today}`;
  const cached = weekAgoMemo.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.point;
  try {
    const points = await fetchRecent(SERIES[id as SeriesId], shiftDate(today, -21), today);
    const point = latestOnOrBefore(points, shiftDate(today, -7));
    weekAgoMemo.set(key, { point, expiresAt: Date.now() + 30 * 60 * 1000 });
    return point;
  } catch (error) {
    console.warn(`[weekly] ${id} 한 주 전 값 조회 실패:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function resolveBrief({ force = false }: Options): Promise<WeeklyBrief> {
  // Claude Code 가 만든 파일이 있으면 그것이 정답이다. 갱신도 /weekly 로 한다.
  const fromFile = await readBriefFile();
  if (fromFile) return fromFile;

  const weekEnd = defaultWeekEnd();

  if (!force) {
    const cached = memo.get(weekEnd);
    if (cached && cached.expiresAt > Date.now()) return cached.brief;

    const pending = inflight.get(weekEnd);
    if (pending) return pending;
  }

  const work = (async () => {
    if (force) {
      // 데이터 캐시의 이전 결과를 만료시키고 이번에는 캐시를 거치지 않고 만든다.
      revalidateTag(CACHE_TAG, { expire: 0 });
    }
    const brief = force ? await generateBrief(weekEnd) : await generateCached(weekEnd);
    memo.set(weekEnd, { brief, expiresAt: Date.now() + CACHE_SECONDS * 1000 });
    return brief;
  })();

  inflight.set(weekEnd, work);
  try {
    return await work;
  } finally {
    inflight.delete(weekEnd);
  }
}
