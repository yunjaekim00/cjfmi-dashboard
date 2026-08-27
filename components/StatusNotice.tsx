import type { SourceStatus } from "@/lib/types";

/** 데이터 소스가 실패했을 때만 보이는 안내 배너. */
export function StatusNotice({ status }: { status: SourceStatus[] }) {
  const failed = status.filter((s) => !s.ok);
  if (!failed.length) return null;

  return (
    <div className="rounded-xl border border-[#f0d9a8] bg-[#fdf6e7] px-4 py-3 text-[12px] text-[#7a5a15]">
      <p className="font-semibold">일부 데이터를 불러오지 못했습니다.</p>
      <ul className="mt-1.5 space-y-1">
        {failed.map((s) => (
          <li key={s.key}>
            · {s.label}: {s.message ?? "알 수 없는 오류"}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[#8b6a1e]">
        한국은행 데이터는 <code className="rounded bg-[#f5ebd4] px-1">.env.local</code> 의{" "}
        <code className="rounded bg-[#f5ebd4] px-1">ECOS_API_KEY</code> 가 필요합니다. 자세한
        발급 방법은 README 를 참고하세요.
      </p>
    </div>
  );
}
