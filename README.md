# 경제 지표 대시보드

한국은행 ECOS 와 FRED 데이터를 모아 보는 거시 경제 대시보드입니다.
현재는 **원/달러 환율**만 구현되어 있고, 지표를 추가하기 쉽도록 구조를 잡아 두었습니다.

- **1. 종합 지표** — 지표별 요약 카드(최신값 · 전일대비 · 스파크라인)
- **2. 환율** — 원/달러 환율 시계열 (뉴욕 종가 vs 매매기준율, 기간 선택)

---

## 1. 한국은행(ECOS) API 인증키 발급 — 단계별

매매기준율(한국은행 고시 환율)을 받으려면 ECOS 인증키가 필요합니다. 무료이고, 심사 없이 바로 발급됩니다.

1. **ECOS 사이트 접속** — <https://ecos.bok.or.kr>
2. **회원가입** — 우측 상단 `회원가입`. 이메일 인증까지 완료해야 합니다.
3. **로그인**
4. 상단 메뉴에서 **`오픈API`** → **`인증키 신청`** 으로 이동
5. **신청서 작성**
   - 활용 용도: 예) `개인 학습용 경제지표 대시보드`
   - 사용 URL: 예) `http://localhost:3000` (배포하면 실제 도메인으로 수정)
   - 이메일: 가입한 이메일
6. **신청** 버튼을 누르면 **즉시 발급**됩니다. 발급된 키는
   `오픈API` → `인증키 관리`(마이페이지)에서 다시 확인할 수 있고, 가입 이메일로도 발송됩니다.
7. 발급받은 키를 프로젝트 루트의 `.env.local` 에 넣습니다.

```bash
cp .env.local.example .env.local
```

```dotenv
ECOS_API_KEY=여기에_발급받은_키
```

8. **개발 서버를 재시작**합니다. `.env.local` 은 서버 시작 시점에만 읽힙니다.

> 호출 한도는 **인증키당 하루 100,000회**입니다. 이 앱은 응답을 6시간 캐시하므로
> 개발 중에도 한도에 걸릴 일은 거의 없습니다.

> 키가 없어도 앱은 동작합니다. FRED(뉴욕 종가)만 그려지고, 화면 상단에
> "일부 데이터를 불러오지 못했습니다" 안내가 뜹니다.

### FRED 키 (선택)

`FRED_API_KEY` 는 **없어도 됩니다.** 비워 두면 키가 필요 없는 `fredgraph.csv`
엔드포인트를 사용합니다. 공식 JSON API 를 쓰고 싶다면
<https://fredaccount.stlouisfed.org/apikeys> 에서 발급받아 `.env.local` 에 넣으세요.

---

## 2. 실행

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm run start   # 프로덕션
```

---

## 3. 데이터 출처

| 계열 | 출처 | 식별자 |
|---|---|---|
| 매매기준율(한국은행) | ECOS `StatisticSearch` | 통계표 `731Y001` · 주기 `D` · 항목 `0000001` (원/미국달러(매매기준율)) |
| 뉴욕 종가 | FRED | `DEXKOUS` (Korean Won to U.S. Dollar Spot Exchange Rate) |

두 계열 모두 1990년부터 일별로 받아 오고, 결측일(휴장일)은 선으로 이어 그립니다.

---

## 4. 구조

```
app/
  page.tsx                  서버 컴포넌트 — 데이터를 받아 Dashboard 에 넘김
  layout.tsx, globals.css   디자인 토큰(색·타이포)
components/
  Dashboard.tsx             탭 전환
  IndicatorCard.tsx         종합지표 카드 한 장
  Sparkline.tsx             카드용 미니 추세선 (순수 SVG)
  ExchangeRateChart.tsx     환율 차트 (recharts)
  RangeTabs.tsx             1M ~ 전체 기간 선택
lib/
  data.ts                   지표 정의 + 조회 + 요약
  sources/ecos.ts           한국은행 ECOS 클라이언트 (페이지네이션 포함)
  sources/fred.ts           FRED 클라이언트 (JSON API / CSV 폴백)
  series.ts                 기간 필터 · 계열 병합 · 축 눈금 계산
  format.ts                 숫자·날짜 표기
```

### 지표를 추가하려면

1. `lib/data.ts` 에 ECOS 통계표/항목 코드를 추가하고 조회 함수를 만듭니다.
   코드는 ECOS 사이트의 `통계검색` 화면이나 `오픈API` → `서비스 이용 안내`의
   통계표 목록에서 찾을 수 있습니다.
2. `summarizeUsdKrw` 와 같은 요약 함수를 만들어 `IndicatorSummary` 를 반환합니다.
3. `app/page.tsx` 의 `indicators` 배열에 추가하면 종합지표 탭에 카드가 늘어납니다.

### 색상

`app/globals.css` 의 CSS 변수로 관리합니다. 계열 색(`--series-1` 파랑,
`--series-2` 주황)은 색각 이상 판별 가능 여부를 검증한 조합입니다.
등락 색은 국내 관행대로 **상승 빨강(`--up`) · 하락 파랑(`--down`)** 입니다.
