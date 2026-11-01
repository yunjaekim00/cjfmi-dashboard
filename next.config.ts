import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * 주간 모니터링 결과 파일(data/weekly-brief.json)은 코드가 fs 로 읽을 뿐 import 하지 않아
   * 서버 함수 번들 추적에서 빠질 수 있다. 배포본(Vercel)에도 들어가도록 명시한다.
   */
  outputFileTracingIncludes: {
    "/api/weekly": ["./data/**/*"],
  },
};

export default nextConfig;
