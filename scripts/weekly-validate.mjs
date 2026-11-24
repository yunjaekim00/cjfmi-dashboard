#!/usr/bin/env node
/**
 * data/YYMMDD-weekly-brief.json 검증 — Claude Code 의 /weekly 스킬이 파일을 쓴 뒤 실행한다.
 * 서버(lib/weekly.ts 의 FileBrief)도 같은 규칙으로 다시 검증하므로, 여기서 통과하면 화면에 뜬다.
 *
 *   node scripts/weekly-validate.mjs [경로]   # 기본: data/ 에서 날짜 접두사가 가장 늦은 파일
 *
 * 통과하면 보고서 문장을 미리보기로 찍고 0 으로 끝난다. 실패하면 사유를 찍고 1.
 */
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

const CATEGORIES = ["원자재", "금리", "주가", "외환"]; // 보고 순서 (사용자 지시, 2026-11-16)
const Line = z.string().trim().min(1);
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다");
const Point = z.object({ date: DateString, value: z.number(), time: z.string().nullable().optional() });

const Brief = z
  .object({
    weekStart: DateString,
    weekEnd: DateString,
    generatedAt: z.string().min(1),
    model: z.string().default("claude-code"),
    issue: z.object({ headline: Line, points: z.array(Line).min(2).max(2) }),
    reaction: z.object({
      headline: Line,
      items: z.array(z.object({ category: z.enum(CATEGORIES), text: Line })).min(4).max(4),
    }),
    sources: z
      .array(
        z.object({
          title: Line,
          publisher: Line,
          url: z.string().url(),
          date: DateString.nullable().optional(),
        })
      )
      .default([]),
    indicators: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          unit: z.string(),
          digits: z.number().int(),
          changeStyle: z.enum(["bp", "pct"]),
          latest: Point,
          weekAgo: Point.nullable(),
        })
      )
      .default([]),
  })
  .refine((v) => new Set(v.reaction.items.map((i) => i.category)).size === 4, {
    message: "reaction.items 의 category 는 주가·금리·외환·원자재가 각각 한 번씩이어야 합니다.",
  })
  .refine((v) => v.weekStart <= v.weekEnd, { message: "weekStart 가 weekEnd 보다 늦습니다." });

function latestBriefPath() {
  let names = [];
  try {
    // 접두사 YYMMDD-HHMM (시각 없는 옛 이름도) 순
    const stampKey = (name) => {
      const match = /^(\d{6})(?:-(\d{4}))?/.exec(name);
      return match ? `${match[1]}${match[2] ?? "0000"}` : "";
    };
    names = readdirSync("data")
      .filter((n) => /^\d{6}(?:-\d{4})?-weekly-brief\.json$/.test(n))
      .sort((a, b) => stampKey(a).localeCompare(stampKey(b)));
  } catch {
    // data/ 가 없으면 아래에서 읽기 실패로 알린다
  }
  return names.length ? `data/${names.at(-1)}` : "data/weekly-brief.json";
}

const file = process.argv[2] ?? latestBriefPath();

let json;
try {
  json = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`✗ ${file} 을 읽지 못했습니다: ${error.message}`);
  process.exit(1);
}

const parsed = Brief.safeParse(json);
if (!parsed.success) {
  console.error(`✗ ${file} 형식 오류`);
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".") || "(루트)"}: ${issue.message}`);
  process.exit(1);
}

const brief = parsed.data;
const problems = [];
const warnings = [];

const strip = (text) => text.replace(/\{\{([\s\S]*?)\}\}/g, "$1");
const lines = [
  ["issue.headline", brief.issue.headline],
  ...brief.issue.points.map((t, i) => [`issue.points[${i}]`, t]),
  ["reaction.headline", brief.reaction.headline],
  ...brief.reaction.items.map((it) => [`reaction.items(${it.category})`, it.text]),
];

// 쓰지 않는 말 (사용자 지시, 2026-11-16) — 있으면 실패
const BANNED = /(쇼크|레버리지|충격|매파|비둘기파)/;
// 정책금리는 "기준금리"라고 밝힌다 — "인상/인하"가 있는데 "기준금리"가 없으면 경고
const POLICY_MOVE = /(금리 ?인상|금리 ?인하|\d+월 인상|\d+월 인하|인상 (기정사실화|확률|확실시|전망)|인하 (기정사실화|확률|확실시|전망))/;

/** 화면 한 줄에 들어가는지 어림한다 — 한글·한자·전각은 1em, 공백 0.3em, 나머지(숫자·영문·기호) 0.55em. 상자 920px·13pt 면 약 42em. */
const emWidth = (text) =>
  [...strip(text)].reduce((sum, ch) => sum + (/[\u1100-\u11FF\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : ch === " " ? 0.3 : 0.55), 0);
// 모든 문장은 화면 두 줄 분량 (사용자 지시, 2026-11-23) — 한 줄(42em)에 그치거나 두 줄(84em)을 넘으면 경고
// 예외: [시장반응] headline 은 반드시 한 줄 (사용자 지시, 2026-11-23)
const LINE_EM = 42;
for (const [where, text] of lines) {
  const em = emWidth(text);
  if (where === "reaction.headline") {
    if (em > LINE_EM) warnings.push(`${where}: 한 줄을 넘을 듯합니다 (폭 ${em.toFixed(0)}em > ${LINE_EM}em) — [시장반응] 문장은 반드시 한 줄`);
  } else if (em <= LINE_EM + 8) warnings.push(`${where}: 한 줄 분량입니다 (폭 ${em.toFixed(0)}em) — 날짜·주체·수치·경과를 넣어 두 줄 분량(50~84em)으로`);
  else if (em > LINE_EM * 2) warnings.push(`${where}: 두 줄을 넘을 듯합니다 (폭 ${em.toFixed(0)}em > ${LINE_EM * 2}em)`);
}
// 한 문장 안에서 같은 낱말을 되풀이하지 않는다 (사용자 지시, 2026-11-23) — 끝의 조사를 떼고 두 글자 이상 한글 낱말을 센다
const PARTICLE = /(에서는|에서도|에서|에는|에도|으로|까지|부터|은|는|이|가|을|를|의|에|도|와|과|로)$/;
for (const [where, text] of lines) {
  const counts = new Map();
  for (const token of strip(text).match(/[가-힣]{2,}/g) ?? []) {
    const stem = token.length > 2 ? token.replace(PARTICLE, "") : token;
    if (stem.length >= 2) counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  const repeated = [...counts].filter(([, n]) => n > 1).map(([w]) => w);
  if (repeated.length) warnings.push(`${where}: 같은 낱말 반복 — ${repeated.join(", ")}. 한 문장 안에서는 다른 말로 바꿔 씁니다`);
}
// 시장반응의 주간 변동폭(몇 %, 몇 bp, 몇 원)은 차트·표가 보여주므로 적지 않는다 (사용자 지시, 2026-11-16)
const WEEKLY_CHANGE = /(주간|전주)\s*(比|대비)?\s*[+−-]?\d|[(,]\s*[+−-]\d+(\.\d+)?\s*(bp|%p?|원|달러)/;
// 시장반응은 지표 수치(종가·금리 수준) 없이 변동 현황과 배경·이유만 — 차트·표와 중복 (사용자 지시, 2026-11-17)
// %·bp·원·달러·$ 가 붙은 수, "5,000선"·"85달러대"·"1,330원대", 천 단위 콤마 수(7,417). 19개월·4분기·170만배럴·13일 같은 원인·날짜 수치는 걸리지 않는다.
const INDICATOR_LEVEL = /\d[\d,]*(?:\.\d+)?\s*(?:%|bp|원|달러|\$)|\d[\d,]*(?:\.\d+)?(?:선|대)(?![가-힣])|\d{1,3}(?:,\d{3})+/;
for (const it of brief.reaction.items) {
  const text = strip(it.text);
  const hit = text.match(WEEKLY_CHANGE);
  if (hit) warnings.push(`reaction.items(${it.category}): "${hit[0]}" — 주간 변동폭은 적지 않습니다 (차트·표에 있음). 방향과 배경만`);
  const level = text.match(INDICATOR_LEVEL);
  if (level) warnings.push(`reaction.items(${it.category}): "${level[0]}" — 지표 수치는 적지 않습니다 (차트·표에 있음). 상승·하락 등 변동 현황과 그 배경·이유만`);
}
// 모든 문장은 명사형 종결 (사용자 지시, 2026-11-17). 끝의 괄호와 화살표는 빼고 본다 — 시장반응 headline 은 화살표로 끝날 수 있다.
const ending = (text) => strip(text).trim().replace(/\s*\([^)]*\)\s*$/, "").replace(/[\s↑↓]+$/, "");
// "~함"·"~음"은 명사형 전성어미라 허용한다. "사임"·"포함"처럼 임·함으로 끝나는 명사도 있다.
const VERB_ENDING = /(습니다|니다|했다|있다|이다|한다|된다|됐다|였다|겠다|[가-힣]다)$/;
const NON_NOUN_ENDING = /(잇따라|이어|따라|하며|되며|하고|되고|해서|되어|돼|하지|되지|하면|되면|하여|하자|되자|면서|으며|인데|한데|지만|거나|도록|같이|처럼|보다|부터|까지|에서|에게|에도|에는|에|은|는|을|를|와)$/;
for (const [where, text] of lines) {
  const raw = strip(text).trim();
  if (/[↑↓]\s*$/.test(raw)) continue;
  const end = ending(text);
  const verb = end.match(VERB_ENDING);
  if (verb) problems.push(`${where}: "…${verb[0]}" — 서술형 어미입니다. 모든 문장은 명사형으로 끝냅니다 ("확대", "하락", "지속")`);
  else {
    const nn = end.match(NON_NOUN_ENDING);
    if (nn) warnings.push(`${where}: "…${nn[0]}" — 동사·부사형이나 조사로 끝납니다. 명사형으로 끝내 주세요 ("발언 잇따라" → "발언 지속")`);
  }
}

for (const [where, text] of lines) {
  const banned = strip(text).match(BANNED);
  if (banned) problems.push(`${where}: "${banned[0]}" 은 쓰지 않는 말입니다 (쇼크·레버리지·충격·매파·비둘기파 금지)`);
  const move = strip(text).match(POLICY_MOVE);
  if (move && !/기준금리/.test(text)) warnings.push(`${where}: "${move[0]}" — 정책금리면 "기준금리 인상/인하"라고 밝혀 주세요`);
  // 美 기준금리 인상·인하 확률 수치는 CME FedWatch 에서 직접 확인했을 때만 — 아니면 수치를 빼고 방향만 (사용자 지시, 2026-11-16)
  if (/(인상|인하) 확률/.test(strip(text))) {
    warnings.push(
      /FedWatch/i.test(text)
        ? `${where}: 인상·인하 확률 수치 — FedWatch 를 직접 열어 확인한 값인지 다시 확인하세요 (기사 인용치는 쓰지 않습니다)`
        : `${where}: 인상·인하 확률 수치는 FedWatch 에서 직접 확인한 경우에만 "(FedWatch, M/D)" 와 함께 씁니다. 아니면 수치를 빼고 방향만`
    );
  }
  if ((text.match(/\{\{/g) ?? []).length !== (text.match(/\}\}/g) ?? []).length) problems.push(`${where}: {{ }} 짝이 맞지 않습니다`);
  if (/\n/.test(text)) problems.push(`${where}: 줄바꿈이 들어 있습니다`);
}
if (/\{\{/.test(brief.issue.headline + brief.issue.points.join(""))) warnings.push("주간이슈에는 {{강조}}를 쓰지 않습니다 (라벨만 파랗게)");
// 주간이슈는 이슈만 — 지표의 수준·변동은 [시장반응]이 쓴다 (사용자 지시, 2026-11-16)
const INDICATOR_WORDS = /(10년물|2년물|3년물|국고채|S&P ?500|KOSPI|코스피|원달러|원\/달러|달러인덱스|WTI|유가|\d+ ?bp\b|\d+(?:\.\d+)?%\s*(?:급등|급락|상승|하락|반등))/;
for (const [where, text] of [["issue.headline", brief.issue.headline], ...brief.issue.points.map((t, i) => [`issue.points[${i}]`, t])]) {
  const hit = strip(text).match(INDICATOR_WORDS);
  if (hit) warnings.push(`${where}: "${hit[0]}" — 지표 동향은 [시장반응]에만 씁니다. 주간이슈에는 이슈와 그 근거만`);
}
if (brief.sources.length < 3) warnings.push(`sources 가 ${brief.sources.length}건 — 4~8건을 권장합니다`);
if (brief.reaction.items.map((it) => it.category).join() !== CATEGORIES.join()) {
  warnings.push(`reaction.items 순서는 ${CATEGORIES.join("·")} 입니다 (화면은 자동 정렬하지만 파일도 맞춰 두는 편이 좋습니다)`);
}

if (problems.length) {
  console.error(`✗ ${file}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✓ ${file} 통과 — ${brief.weekStart} ~ ${brief.weekEnd}, 출처 ${brief.sources.length}건, 지표 ${brief.indicators.length}개`);
for (const w of warnings) console.log(`  ! ${w}`);
console.log("");
console.log(`- [주간이슈] ${brief.issue.headline}`);
for (const p of brief.issue.points) console.log(`  · ${p}`);
console.log(`- [시장반응] ${brief.reaction.headline}`);
for (const it of brief.reaction.items) console.log(`  · (${it.category}) ${it.text}`);
