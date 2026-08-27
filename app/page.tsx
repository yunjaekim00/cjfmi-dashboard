import { Dashboard } from "@/components/Dashboard";
import { getDashboardData } from "@/lib/dashboard";

/**
 * 첫 화면은 서버에서 그려 바로 보이게 하고, 이후 갱신은 브라우저 폴링이 맡는다.
 * 정적으로 캐시된 응답이 너무 오래 남지 않도록 10분마다 다시 생성한다.
 */
export const revalidate = 600;

export default async function Page() {
  const data = await getDashboardData();

  return (
    <main>
      <Dashboard initial={data} />
    </main>
  );
}
