"use client";

import { useCallback, useMemo, useState } from "react";

import { MarketPanel } from "@/components/MarketPanel";
import { parseEmphasis } from "@/lib/emphasis";
import { formatChange, formatDayTick, formatKoreanDate, formatNumber } from "@/lib/format";
import {
  defaultSnapshot,
  formatKstTime,
  formatSnapshotLabel,
  snapshotPoint,
  type MarketSnapshot,
} from "@/lib/market-shared";
import { toMs } from "@/lib/series";
import type { WeeklyState } from "@/lib/useWeeklyBrief";
import type { WeeklyBrief, WeeklyIndicator } from "@/lib/weekly-types";

/*
 * "3. 주간 모니터링" 탭.
 *
 * 가운데 상자는 참고 보고서(금융시장 모니터링)의 서식을 그대로 옮긴 것이라
 * 서체·크기·색·들여쓰기를 app/globals.css 의 .wk-* 규칙에 모아 두었다.
 * 상자 바깥(기간·생성 시각·지표 각주·참고 기사)만 대시보드의 평소 스타일을 쓴다.
 */

/** `{{…}}` 는 파란 강조, `(…)` 는 작은 보충설명 (lib/emphasis.ts). */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseEmphasis(text).map((segment, index) =>
        segment.tone === "text" ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <span
            key={index}
            className={
              segment.tone === "blue"
                ? "wk-blue"
                : // "(22일 豫)" 같은 짧은 보충설명은 줄 끝에서 쪼개지지 않게 한다
                  segment.text.length <= 16
                  ? "wk-note whitespace-nowrap"
                  : "wk-note"
            }
          >
            {segment.text}
          </span>
        )
      )}
    </>
  );
}

/** "- [주간이슈] …" — 라벨만 파랗고 문장은 검정 */
function Headline({ label, text }: { label: string; text: string }) {
  return (
    <p className="wk-headline">
      <span className="wk-dash" aria-hidden>
        -
      </span>
      <span className="wk-blue">[{label}]</span> <Inline text={text} />
    </p>
  );
}

/** "· (주가) …" — 분야 라벨이 있으면 파랗게 앞에 붙인다 */
function Bullet({ label, text }: { label?: string; text: string }) {
  return (
    <p className="wk-bullet">
      <span className="wk-dot" aria-hidden />
      {label ? (
        <>
          <span className="wk-blue">({label})</span>{" "}
        </>
      ) : null}
      <Inline text={text} />
    </p>
  );
}

function BriefBox({ brief }: { brief: WeeklyBrief }) {
  return (
    <div className="wk-box">
      <Headline label="주간이슈" text={brief.issue.headline} />
      {brief.issue.points.map((point, index) => (
        <Bullet key={index} text={point} />
      ))}

      <Headline label="시장반응" text={brief.reaction.headline} />
      {brief.reaction.items.map((item, index) => (
        <Bullet key={`${item.category}-${index}`} label={item.category} text={item.text} />
      ))}
    </div>
  );
}

function LoadingBox() {
  return (
    <div className="wk-box" aria-busy>
      <p className="wk-headline">
        <span className="wk-dash" aria-hidden>
          -
        </span>
        <span className="wk-blue">[주간이슈]</span>{" "}
        <span className="text-ink-2">지난 일주일 뉴스를 읽고 정리하는 중입니다…</span>
      </p>
      <div className="mt-3 space-y-3 pl-[calc(var(--wk-pt)*14.7)]">
        <div className="h-4 w-11/12 animate-pulse rounded bg-[#ececec]" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-[#ececec]" />
      </div>
      <p className="wk-headline mt-[calc(var(--wk-pt)*15)]">
        <span className="wk-dash" aria-hidden>
          -
        </span>
        <span className="wk-blue">[시장반응]</span>
      </p>
      <div className="mt-3 space-y-3 pl-[calc(var(--wk-pt)*14.7)]">
        <div className="h-4 w-full animate-pulse rounded bg-[#ececec]" />
        <div className="h-4 w-10/12 animate-pulse rounded bg-[#ececec]" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-[#ececec]" />
        <div className="h-4 w-9/12 animate-pulse rounded bg-[#ececec]" />
      </div>
      <p className="mt-5 text-[12px] font-normal text-muted" style={{ fontFamily: "inherit" }}>
        Bloomberg · 국제금융센터 기사를 검색해 요약합니다. 보통 1~2분 걸립니다.
      </p>
    </div>
  );
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}.${d.getDate()} ${hh}:${mm}`;
}

function Meta({
  brief,
  refreshing,
  onRegenerate,
}: {
  brief: WeeklyBrief;
  refreshing: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-ink-2">
      <span>
        대상 기간{" "}
        <b className="tabular font-semibold text-ink">
          {formatKoreanDate(brief.weekStart)} ~ {formatKoreanDate(brief.weekEnd)}
        </b>
        <span className="text-muted">
          {brief.source === "sample"
            ? " · 미리보기 — 참고 보고서 원문 (모델 호출 없음)"
            : brief.source === "file"
              ? " · Claude Code(/weekly)가 Bloomberg · 국제금융센터 기사를 읽고 정리"
              : " · Bloomberg · 국제금융센터 기사를 Claude 가 읽고 정리"}
        </span>
      </span>
      <span className="flex items-center gap-2 text-muted">
        <span className="tabular">생성 {formatStamp(brief.generatedAt)}</span>
        {brief.source === "file" ? (
          // 파일은 Claude Code 가 만든다 — 서버에서 다시 만들 수 없다.
          <span>
            {brief.file ? `data/${brief.file} · ` : ""}갱신은 Claude Code 에서 /weekly
          </span>
        ) : (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={refreshing}
            className="rounded-md px-2 py-0.5 text-ink-2 transition-colors hover:bg-[#e7e7e7] disabled:opacity-40"
          >
            {refreshing ? "생성 중…" : "다시 생성"}
          </button>
        )}
      </span>
    </div>
  );
}

function IndicatorNote({ indicator, asOf }: { indicator: WeeklyIndicator; asOf: string }) {
  const { label, unit, digits, changeStyle, latest, weekAgo } = indicator;
  const change = weekAgo ? latest.value - weekAgo.value : null;
  const changePct = weekAgo && weekAgo.value !== 0 ? ((latest.value - weekAgo.value) / weekAgo.value) * 100 : 0;
  const color =
    change === null || change === 0 ? "var(--muted)" : change > 0 ? "var(--up)" : "var(--down)";

  return (
    <span className="tabular whitespace-nowrap">
      <span className="text-ink-2">{label}</span> {formatNumber(latest.value, digits)}
      {unit}
      {/* FRED 계열처럼 집계가 늦어 기준일이 다른 지표는 날짜를 덧붙인다 */}
      {latest.date !== asOf ? <span className="text-muted"> ({formatDayTick(toMs(latest.date))})</span> : null}
      {change !== null ? (
        <span style={{ color }}> {formatChange(changeStyle, change, changePct, digits)}</span>
      ) : null}
    </span>
  );
}

function Footnotes({ brief, baseline }: { brief: WeeklyBrief; baseline: MarketSnapshot | null }) {
  const latest = brief.indicators.map((i) => i.latest.date).sort().at(-1);
  // /weekly 실행 시점 시세로 채운 지표가 있으면 그중 가장 늦은 시각을 적는다
  const liveTime = brief.indicators
    .map((i) => i.latest.time)
    .filter((time): time is string => Boolean(time))
    .sort()
    .at(-1);

  return (
    <div className="space-y-2 text-[12px] text-muted">
      {brief.indicators.length ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="font-semibold text-ink-2">
            지표 주간 변동{latest ? ` (${formatKoreanDate(latest)} ${liveTime ? `${formatKstTime(liveTime)} 현재` : "기준"})` : ""}
            {baseline ? <span className="font-normal text-muted"> · {formatSnapshotLabel(baseline.at)} 보고比</span> : null}
          </span>
          {brief.indicators.map((indicator) => (
            // 비교점은 화면에서 고른 지난 보고 스냅샷. 그 스냅샷에 없는 계열(옛 파일의 국고채 3년)은 7일 전 관측치 그대로.
            <IndicatorNote
              key={indicator.id}
              indicator={{ ...indicator, weekAgo: snapshotPoint(baseline, indicator.id) ?? indicator.weekAgo }}
              asOf={latest ?? ""}
            />
          ))}
        </p>
      ) : null}

      {brief.sources.length ? (
        <details>
          <summary className="cursor-pointer select-none">참고한 기사 {brief.sources.length}건</summary>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
            {brief.sources.map((source, index) => (
              <li key={`${source.url}-${index}`}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-2 underline-offset-2 hover:underline"
                >
                  {source.title}
                </a>
                <span>
                  {" "}
                  — {source.publisher}
                  {source.date ? `, ${formatKoreanDate(source.date)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-[#f0d9a8] bg-[#fdf6e7] px-4 py-3 text-[12px] text-[#7a5a15]">
      <p className="font-semibold">주간 모니터링을 만들지 못했습니다.</p>
      <p className="mt-1">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md border border-[#e3cb93] px-2 py-0.5 text-[#7a5a15] transition-colors hover:bg-[#f5ebd4]"
      >
        다시 시도
      </button>
    </div>
  );
}

type Props = {
  state: WeeklyState;
  onRegenerate: () => void;
};

/** 주소의 ?base=접두사 — 전주比 기준으로 고른 스냅샷. 새로고침·엑셀 링크에도 이어지도록 주소에 둔다. (서버 렌더에서는 null) */
function readBaseParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("base");
}

function writeBaseParam(prefix: string | null) {
  const url = new URL(window.location.href);
  if (prefix) url.searchParams.set("base", prefix);
  else url.searchParams.delete("base");
  window.history.replaceState(null, "", url);
}

export function WeeklyMonitor({ state, onRegenerate }: Props) {
  const { brief } = state;
  const refreshing = state.status === "loading";

  // 전주比 비교 기준 — 보고 요일이 매주 달라서 "7일 전"이 아니라 지난 보고(스냅샷) 시점과 비교한다.
  // 주소의 ?base= 를 따르고, 없으면 기준일(오늘)보다 앞선 가장 최근 스냅샷.
  // 서버 렌더 때는 요약문이 아직 없어 이 값에 기대는 표시가 없으므로 첫 렌더에서 주소를 읽어도 hydration 이 어긋나지 않는다.
  const [basePrefix, setBasePrefix] = useState<string | null>(readBaseParam);
  const market = brief?.market ?? null;
  const baseline = useMemo(() => {
    if (!market) return null;
    const snapshots = market.snapshots ?? [];
    return (basePrefix && snapshots.find((s) => s.prefix === basePrefix)) || defaultSnapshot(snapshots, market.asOf);
  }, [market, basePrefix]);
  const changeBase = useCallback((prefix: string | null) => {
    setBasePrefix(prefix);
    writeBaseParam(prefix);
  }, []);

  return (
    <div className="max-w-[920px] space-y-3">
      {state.status === "error" ? <ErrorNotice message={state.error} onRetry={onRegenerate} /> : null}

      {brief ? (
        <>
          <Meta brief={brief} refreshing={refreshing} onRegenerate={onRegenerate} />
          <BriefBox brief={brief} />
          <Footnotes brief={brief} baseline={baseline} />
          {/* 상자와 같은 너비로 차트 6개와 환율표 — 자료 파일은 /weekly 가 만든다. 오른쪽 빈 칸에 전주比 기준 패널 */}
          <div className="pt-3">
            <MarketPanel market={brief.market} baseline={baseline} onBaseChange={changeBase} />
          </div>
        </>
      ) : refreshing || state.status === "idle" ? (
        <LoadingBox />
      ) : null}
    </div>
  );
}
