import type { Point } from "@/lib/types";

type Props = {
  points: Point[];
  /** 선 색 (상승/하락에 따라 호출부에서 결정) */
  color: string;
  /** 정책금리처럼 계단 함수인 계열은 계단으로 그린다 */
  step?: boolean;
  width?: number;
  height?: number;
};

/**
 * 카드용 초소형 추세선. 축도 눈금도 없어서 recharts 를 쓸 이유가 없고,
 * 카드가 여러 장 깔리므로 순수 SVG 가 훨씬 가볍다.
 */
export function Sparkline({ points, color, step = false, width = 128, height = 44 }: Props) {
  if (points.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  // 선 두께가 잘리지 않도록 위아래 여백을 둔다.
  const padY = 3;
  const usableH = height - padY * 2;
  const stepX = width / (points.length - 1);

  const coords = values.map((value, i) => {
    const x = i * stepX;
    const y = padY + (1 - (value - min) / span) * usableH;
    return [x, y] as const;
  });

  const d = coords
    .map(([x, y], i) => {
      if (i === 0) return `M${x.toFixed(2)} ${y.toFixed(2)}`;
      // 계단선은 이전 높이를 유지한 채 옆으로 간 뒤 수직으로 꺾는다.
      if (step) return `H${x.toFixed(2)} V${y.toFixed(2)}`;
      return `L${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMaxYMid meet"
      className="block max-w-full"
      aria-hidden
    >
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} />
    </svg>
  );
}
