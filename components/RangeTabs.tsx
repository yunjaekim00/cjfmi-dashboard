"use client";

import { RANGE_KEYS, type RangeKey } from "@/lib/series";

type Props = {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
  /** 데이터가 없어 선택해도 의미가 없는 구간은 비활성화한다. */
  available?: (range: RangeKey) => boolean;
};

export function RangeTabs({ value, onChange, available }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="기간 선택">
      {RANGE_KEYS.map((range) => {
        const selected = range === value;
        const enabled = available ? available(range) : true;

        return (
          <button
            key={range}
            type="button"
            disabled={!enabled}
            aria-pressed={selected}
            onClick={() => onChange(range)}
            className={[
              "rounded-md px-2.5 py-1 text-[12px] transition-colors",
              selected
                ? "bg-[#e7e7e7] font-semibold text-ink"
                : "text-ink-2 hover:bg-[#f1f1f1]",
              enabled ? "" : "cursor-not-allowed opacity-35 hover:bg-transparent",
            ].join(" ")}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
