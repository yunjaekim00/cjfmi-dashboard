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

const CATEGORIES = ["주가", "금리", "외환", "원자재"];
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

for (const [where, text] of lines) {
  if ((text.match(/\{\{/g) ?? []).length !== (text.match(/\}\}/g) ?? []).length) problems.push(`${where}: {{ }} 짝이 맞지 않습니다`);
  if (/\n/.test(text)) problems.push(`${where}: 줄바꿈이 들어 있습니다`);
  if (/(습니다|했다|있다|이다)\.?$/.test(strip(text).trim())) warnings.push(`${where}: 서술형 어미 — 명사형으로 끝내는 편이 보고서 문체입니다`);
  if (strip(text).length > 80) warnings.push(`${where}: ${strip(text).length}자 — 70자 안팎을 권장합니다`);
}
if (/\{\{/.test(brief.issue.headline + brief.issue.points.join(""))) warnings.push("주간이슈에는 {{강조}}를 쓰지 않습니다 (라벨만 파랗게)");
if (brief.sources.length < 3) warnings.push(`sources 가 ${brief.sources.length}건 — 4~8건을 권장합니다`);

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
