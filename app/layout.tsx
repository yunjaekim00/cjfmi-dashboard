import type { Metadata } from "next";
import { Geist } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/**
 * 주간 모니터링 탭 전용 서체 — 참고 보고서(금융시장 모니터링)와 같은 CJ ONLYONE 300.
 * 한글 전체가 들어 있어 3.3MB 라, 미리 받지 않고(preload: false) 그 탭이 처음
 * 그려질 때만 내려받는다. 보고서처럼 300 굵기 하나에 굵게(합성 볼드)를 얹어 쓴다.
 */
const cjOnlyOne = localFont({
  src: "../fonts/CJ_ONLYONE_FONT/CJ_ONLYONE_300.ttf",
  weight: "300",
  variable: "--font-cj-onlyone",
  display: "swap",
  preload: false,
});

/**
 * 400 굵기는 별도 서체 가족으로 둔다. 한 가족에 300·400 을 같이 넣으면 브라우저가 "굵게"를
 * 400 에서 합성해 버려서, 보고서처럼 300 에 굵게를 얹은 소제목의 모양이 달라진다.
 * "[ 주요국 금융시장 동향 ]" 제목과 차트의 사건 라벨에만 쓴다.
 */
const cjOnlyOne400 = localFont({
  src: "../fonts/CJ_ONLYONE_FONT/CJ_ONLYONE_400.ttf",
  weight: "400",
  variable: "--font-cj-onlyone-400",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "경제 지표 대시보드",
  description: "한국은행·FRED 데이터를 모아 보는 거시 경제 지표 대시보드",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${cjOnlyOne.variable} ${cjOnlyOne400.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
