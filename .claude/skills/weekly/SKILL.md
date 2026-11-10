---
name: weekly
description: 오늘까지 일주일(KST)의 금융시장 뉴스를 Bloomberg·국제금융센터에서 읽고, 실행 시점 시세로 최근치를 채워 대시보드 "3. 주간 모니터링" 탭이 보여줄 data/YYMMDD-weekly-brief.json(요약문)과 data/YYMMDD-weekly-market.json(차트 6개·환율표 자료)을 쓴다. 사용법 /weekly [종료일 YYYY-MM-DD]
---

# /weekly — 주간 모니터링 작성

대시보드 "3. 주간 모니터링" 탭이 보여줄 파일 두 개를 만든다 (YYMMDD-HHMM = 파일을 쓴 날짜·시각 KST, 예 `261110-1405`).

| 파일 | 내용 | 만드는 주체 |
|---|---|---|
| `data/<YYMMDD-HHMM>-weekly-brief.json` | [주간이슈]·[시장반응] 요약문, 참고 기사, 지표 주간 변동 | 이 세션이 뉴스를 읽고 쓴다 |
| `data/<YYMMDD-HHMM>-weekly-market.json` | "[ 주요국 금융시장 동향 ]" 차트 6개(최근 1년)와 환율표 자료, 그 시점 값 `snapshot` | `scripts/weekly-market.mjs` (이력 FRED·ECOS + 실행 시점 시세 CNBC·네이버) |

Claude API 키나 크레딧 없이 이 Claude Code 세션(구독)이 뉴스를 읽고 문장을 쓴다. **지난 파일은 지우지 않는다** —
실행마다 쌓이고(테스트 실행도 남는다), 서버는 접두사(날짜·시각)가 가장 늦은 것을 보여준다. 지난 market 파일들은 화면 오른쪽
"전주比 기준" 드롭다운에 보고 시점 스냅샷으로 뜨고(그 아래엔 최근 14일의 "종가 기준"도 있다), 차트·각주의 변동은 거기서 고른 시점 대비로 계산된다(기본: 오늘보다 앞선 가장 최근 파일).
차트용 1년치 자료는 `data/market-history.json` 에 쌓여서 실행마다 최근 2주치만 다시 받는다.

실행 요일은 정해져 있지 않다 — 월~금 업무시간 중 상사가 요청할 때(주로 수요일, 금요일일 수도 있다) 실행한다.
인자 `$ARGUMENTS` 가 `YYYY-MM-DD` 면 그 날을 대상 기간의 끝으로 삼는다(지난 주를 다시 만들 때 — 그 날짜엔 시세를 붙이지 않는다).
없으면 **오늘(KST)**: 대상 기간은 오늘 포함 7일이고, 지표 각주·차트·환율표의 최근치는 모두 **실행 시점 시세**다
(사용자 요청: 08:30 고시나 전일 종가가 아니라 `/weekly` 를 치는 순간의 값). 차트의 기준일(x축 오른쪽 끝) = 대상 기간의 끝 = 오늘.

실행 시점 시세의 뜻 — 문장에 쓸 때는 "10일 오전 현재" 처럼 시점을 밝힌다:
- KOSPI · 국고채 3년/10년 · 원달러: 장중(09:00~15:30, 원달러는 02:00 까지)이면 그 시각의 값, 장 마감 뒤면 당일 종가.
- S&P500: KST 낮에는 전날 뉴욕 종가(23:30~06:00 KST 장중이면 장중치). 美 10년물 · WTI 선물 · 환율표 통화는 24시간 거래라 그 시각 호가.
- WTI 시세는 선물 근월물이고 1년 이력은 FRED 쿠싱 현물이라 전주비에 현·선물 차이가 섞인다 — 본문엔 기사 기준(선물) 변동률을 쓴다.
- 화면과 엑셀은 열 때마다 서버가 같은 출처(`lib/market-live.ts`)에서 시세를 다시 받아 최근치에 덧씌운다(60초 캐시, 탭은 5분마다 갱신, 429·403 을 받은 호스트는 15분 조회 중단).
  그래서 파일에 든 시세는 요약문을 쓴 순간의 스냅샷이고 브라우저는 늘 지금 값이다. 서버는 날짜가 가장 늦은 market 파일을 쓰므로
  이력만 새로 받고 싶을 땐 `node scripts/weekly-market.mjs` 만 돌려도 된다.

## 1. 기간·지표

- `node scripts/weekly-indicators.mjs $ARGUMENTS` 를 실행한다. stderr 의 표(한 주 전 → 최근)를 읽어 두고,
  stdout 의 JSON 중 `indicators` 배열은 요약문 파일의 `indicators` 에 그대로 넣는다 (최근치가 시세면 `latest.time` 이 있다).
- `node scripts/weekly-market.mjs` 를 실행한다 (인자가 있었으면 `--as-of <대상 기간 끝>`). stderr 에
  차트 6개의 최근치·지난주·전주비 표와 환율표가 나온다. 이 표도 문장을 쓸 때 참고한다.
- 두 스크립트 모두 최근치를 실행 시점 시세(`scripts/lib/live-quotes.mjs` — CNBC 시세 JSON · 네이버 금융, 키 없음)로 채운다.
  시세는 캐시(`data/market-history.json`)에 넣지 않으므로 그 날짜의 집계치가 올라오면 다음 실행부터 자연히 대체된다.
  집계 지연도 일부 메운다: 美 10년물은 재무부 일별 금리표, KOSPI 는 네이버 일별 시세로 FRED·ECOS 에 아직 없는 날의 종가를 보충한다.
- "⚠ … 실시간 시세를 못 받아" 가 나오면(엔드포인트 변경·차단) 그 계열은 집계치가 최근치다. 그때만 종전 방식으로:
  기사(Bloomberg·美 재무부 금리표 등)에서 확인한 종가로 (1) 요약문 `indicators` 의 `latest` 를 덮어쓰고
  (2) `node scripts/weekly-market.mjs --set sp500=YYYY-MM-DD:값 …` 으로 차트에도 넣는다. 확인이 안 되면 그대로 둔다.
  `--set` 값은 캐시에 남아 다음 주에도 쓰이고, 출처에 그 날짜가 올라오면 출처 값이 이긴다. `--no-live` 로 시세를 끌 수 있다.
- 선이 건너뛰는 날(S&P500 은 FRED 가 2영업일, WTI 현물은 최대 1주 늦다)은 1년 차트에서 거의 보이지 않으므로 그대로 둔다.
- 스크립트 표의 "전주비(7일)"는 7일 전 관측치 대비, "지난 보고比"는 직전 보고 스냅샷 대비다. 화면의 괄호 수치는 후자(사용자가 고른 스냅샷)라서
  문장에 주간 변동률을 쓸 땐 기사 수치를 쓰고, 표의 두 값은 방향 확인용으로만 본다.
- `ECOS_API_KEY` 가 없는 환경(클라우드 routine)이면 FRED 계열만 나오거나 모두 실패한다. 그래도 계속한다 —
  요약문의 `indicators` 를 빈 배열로 두면 서버가 자기 키로 채운다 (차트는 자료가 있는 것만 그려진다).

## 2. 뉴스 수집 (WebSearch, 필요하면 WebFetch 로 본문)

관심 지표: S&P 500, 美 10년물, KOSPI, 원/달러, WTI. **대상 기간 안의 뉴스만** 쓴다(오늘 장중 움직임 포함 — 지표 표의 최근치가 그 시각 값이다). 주 출처는 Bloomberg 와 국제금융센터.
최소 네 갈래로 검색한다.

1. Bloomberg 주간 시장 정리 — `site:bloomberg.com` + stocks / treasuries / oil / won + 기간
2. 국제금융센터 — `site:kcif.or.kr` 국제금융속보, 주간 국제금융 주요이슈 및 전망
3. 지표를 움직인 이벤트 — 연준·금통위·물가·고용·실적·지정학
4. 韓 증시·환율 수급 — 외국인 순매수, 수출업체 달러 매도 등. 연합뉴스·연합인포맥스 등 국내 경제 뉴스로 보충
   (Reuters 는 크롤러를 차단해 WebSearch 의 `allowed_domains` 에 넣으면 오류가 난다 — 쓰지 않는다)

확인되지 않은 수치는 쓰지 않는다. 추측 금지.

## 3. 문장 작성 규칙

`lib/weekly.ts` 의 `SYSTEM_PROMPT` 상수를 읽고 "내용 구성"·"문체 규칙"·"서식 예시"를 그대로 따른다. 요약하면:

- 지표를 움직인 가장 중요한 뉴스 3개 → `issue.headline` (가장 중요한 1개, 불릿 없음) + `issue.points` (나머지 2개)
- `reaction.headline` 은 지표 움직임을 인과로 묶은 한 문장, `reaction.items` 는 주가·금리·외환·원자재 각 1문장 (그 주의 주도 요인을 앞에)
- 개조식 명사형 종결("확대", "하락"), 국가는 한자 약어(美 韓 中), 보충 수치는 괄호 안, 한 문장 45자 안팎(최대 70자), 줄바꿈 없음
- 파란 강조 `{{…}}` 는 `reaction.items` 의 지표 이름과 결과 구절에만. `reaction.headline` 은 화살표만 `{{↓}}`. `issue` 에는 쓰지 않는다.
- 제공된 지표 표의 방향·수준과 문장이 맞아야 한다.

## 4. 파일 쓰기

`data/<YYMMDD-HHMM>-weekly-brief.json` 을 아래 모양으로 쓴다. YYMMDD-HHMM 은 파일을 쓰는 지금 시각(KST) — `date +%y%m%d-%H%M` 로 확인한다.
실행마다 새 파일이 생기고 지우지 않는다. 서버는 `lib/weekly.ts` 의 `FileBrief` 스키마로 다시 검증한다.
(`data/<YYMMDD-HHMM>-weekly-market.json` 은 1단계의 스크립트가 이미 썼다 — 손으로 고치지 않는다.)

```json
{
  "weekStart": "YYYY-MM-DD",
  "weekEnd": "YYYY-MM-DD",
  "generatedAt": "지금 시각 ISO 8601",
  "model": "claude-code",
  "issue": { "headline": "…", "points": ["…", "…"] },
  "reaction": {
    "headline": "…",
    "items": [
      { "category": "주가", "text": "…" },
      { "category": "금리", "text": "…" },
      { "category": "외환", "text": "…" },
      { "category": "원자재", "text": "…" }
    ]
  },
  "sources": [
    { "title": "기사 제목", "publisher": "Bloomberg | 국제금융센터 | 연합뉴스 | 연합인포맥스 | 그 밖의 매체명", "url": "https://…", "date": "YYYY-MM-DD 또는 null" }
  ],
  "indicators": []
}
```

`sources` 는 실제로 읽은 기사 4~8건, URL 은 검색 결과 그대로. `indicators` 는 1단계 stdout 의 배열.

## 5. 검증·보고

- `node scripts/weekly-validate.mjs` 를 실행해 통과할 때까지 고친다 (인자가 없으면 가장 최근 파일을 검사한다).
  경고(문체·길이)도 가능하면 반영한다.
- 결과 문장과 차트 표(1단계 stderr)를 사용자에게 보여 준다. 로컬이면 `npm run dev` 뒤 http://localhost:3000/?tab=weekly 에서
  확인할 수 있고, 차트 아래 "엑셀 파일로 내려받기" 로 같은 내용을 엑셀로 받을 수 있다고 안내한다.
- 커밋·푸시는 사용자가 요청했거나 자동 routine 으로 실행 중일 때만 한다:
  `git add data/<YYMMDD-HHMM>-weekly-brief.json data/<YYMMDD-HHMM>-weekly-market.json data/market-history.json && git commit -m "주간 모니터링 <weekStart>~<weekEnd>"`
