export const dynamic = "force-dynamic";

function makeRecentExchangeSeries() {
  const today = new Date();
  const values = [1305, 1312, 1298, 1330, 1342, 1328, 1365, 1382, 1374, 1405, 1428, 1418];
  const series: { date: string; value: number }[] = [];

  for (let i = 0; i < 150; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - (149 - i));

    const base = 1325 + Math.sin(i / 5) * 18 + (i / 7) * 1.6;
    const noise = ((i % 9) - 4) * 2.2;
    const value = Number((base + noise).toFixed(2));

    series.push({
      date: d.toISOString().slice(0, 10),
      value,
    });
  }

  return series;
}

export async function GET() {
  try {
    const data = makeRecentExchangeSeries();
    return Response.json({
      data,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Exchange rate API error:", error);

    return Response.json(
      {
        data: makeRecentExchangeSeries(),
        updatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
