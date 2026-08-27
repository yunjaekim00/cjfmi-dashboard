import type { SourceStatus } from "@/lib/types";

/** 데이터 소스가 실패했을 때만 보이는 안내 배너. */
/** 호출 한도처럼 모든 계열이 같은 이유로 실패하면 한 줄로 묶어서 보여준다. */
function groupByMessage(failed: SourceStatus[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();

  for (const entry of failed) {
    const message = entry.message ?? "알 수 없는 오류";
    groups.set(message, [...(groups.get(message) ?? []), entry.label]);
  }

  return [...groups.entries()];
}

export function StatusNotice({ status }: { status: SourceStatus[] }) {
  const failed = status.filter((s) => !s.ok);
  if (!failed.length) return null;

  return (
    <div className="rounded-xl border border-[#f0d9a8] bg-[#fdf6e7] px-4 py-3 text-[12px] text-[#7a5a15]">
      <p className="font-semibold">일부 데이터를 불러오지 못했습니다.</p>
      <ul className="mt-1.5 space-y-1">
        {groupByMessage(failed).map(([message, labels]) => (
          <li key={message}>
            · {labels.join(", ")}: {message}
          </li>
        ))}
      </ul>
      {failed.some((s) => s.message?.includes("호출 한도")) ? (
        <p className="mt-2 text-[#8b6a1e]">
          잠시 뒤 자동으로 복구됩니다. 화면은 5분마다 다시 확인합니다.
        </p>
      ) : (
        <p className="mt-2 text-[#8b6a1e]">
          한국은행 데이터에는 <code className="rounded bg-[#f5ebd4] px-1">ECOS_API_KEY</code> 가
          필요합니다. 로컬은 <code className="rounded bg-[#f5ebd4] px-1">.env.local</code>, 배포는
          Vercel 의 Environment Variables 를 확인하세요.
        </p>
      )}
    </div>
  );
}
