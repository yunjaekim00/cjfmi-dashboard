---
name: weekly
description: 지난 일주일(KST) 금융시장 뉴스를 Bloomberg·국제금융센터에서 읽고 대시보드 "3. 주간 모니터링" 탭이 보여줄 data/weekly-brief.json 을 쓴다. 사용법 /weekly [종료일 YYYY-MM-DD]
---

# /weekly — 주간 모니터링 작성

대시보드 "3. 주간 모니터링" 탭이 보여줄 `data/<YYMMDD>-weekly-brief.json` 을 만든다 (YYMMDD = 실행일 KST 여섯 자리,
예 `261102-weekly-brief.json`). Claude API 키나 크레딧 없이 이 Claude Code 세션(구독)이 뉴스를 읽고 문장을 쓴다.
**지난 파일은 지우지 않는다** — 날짜별로 쌓이고, 서버는 파일명이 가장 늦은 것만 보여준다.

인자 `$ARGUMENTS` 가 `YYYY-MM-DD` 면 그 날을 대상 기간의 끝으로 삼는다. 없으면 어제(KST) — "지난 일주일"은 끝난 7일이다. 대상 기간은 끝 날짜 포함 7일.

## 1. 기간·지표

- `node scripts/weekly-indicators.mjs $ARGUMENTS` 를 실행한다. stderr 의 표(한 주 전 → 최근)를 읽어 두고,
  stdout 의 JSON 중 `indicators` 배열은 결과 파일의 `indicators` 에 그대로 넣는다.
- `ECOS_API_KEY` 가 없는 환경(클라우드 routine)이면 FRED 계열만 나오거나 모두 실패한다. 그래도 계속한다 —
  `indicators` 를 빈 배열로 두면 서버가 자기 키로 채운다.
- FRED 계열(S&P 500 · 美 10년물 · WTI)은 집계가 며칠 늦다. 기사(Bloomberg·Yahoo Finance·美 재무부 일별 금리표 등)에서
  대상 기간 마지막 거래일 종가를 확인하면 해당 지표의 `latest` 를 그 값과 날짜로 **덮어쓴다** — 각주와 본문의 방향이
  어긋나지 않게 하기 위해서다. 확인이 안 되면 FRED 값을 그대로 둔다.

## 2. 뉴스 수집 (WebSearch, 필요하면 WebFetch 로 본문)

관심 지표: S&P 500, 美 10년물, KOSPI, 원/달러, WTI. **대상 기간 안의 뉴스만** 쓴다. 주 출처는 Bloomberg 와 국제금융센터.
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

`data/<YYMMDD>-weekly-brief.json` 을 아래 모양으로 쓴다. YYMMDD 는 오늘(KST) 날짜 여섯 자리 — `date +%y%m%d` 로 확인한다.
같은 날 다시 실행하면 그날 파일을 덮어쓴다. 서버는 `lib/weekly.ts` 의 `FileBrief` 스키마로 다시 검증한다.

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
- 결과 문장을 사용자에게 보여 준다. 로컬이면 `npm run dev` 뒤 http://localhost:3000/?tab=weekly 에서 확인할 수 있다고 안내한다.
- 커밋·푸시는 사용자가 요청했거나 자동 routine 으로 실행 중일 때만 한다:
  `git add data/<YYMMDD>-weekly-brief.json && git commit -m "주간 모니터링 <weekStart>~<weekEnd>"`
