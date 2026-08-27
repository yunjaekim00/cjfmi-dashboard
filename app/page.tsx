import { Dashboard } from "@/components/Dashboard";
import { getExchangeRateData, summarizeUsdKrw } from "@/lib/data";

/** 환율은 영업일 기준 하루 한 번 갱신되므로 1시간마다 페이지를 다시 그린다. */
export const revalidate = 3600;

export default async function Page() {
  const exchangeRate = await getExchangeRateData();
  const usdKrw = summarizeUsdKrw(exchangeRate);

  return (
    <main>
      <Dashboard
        exchangeRate={exchangeRate}
        indicators={usdKrw ? [usdKrw] : []}
      />
    </main>
  );
}
