export default async function handler(req, res) {
  try {
    const symbol = (req.query.symbol || '^NSEI').toString();
    const range = (req.query.range || '1mo').toString();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const points = ts.map((t, i) => ({
      time: t,
      open: Number(q.open?.[i] || q.close?.[i] || 0),
      high: Number(q.high?.[i] || q.close?.[i] || 0),
      low: Number(q.low?.[i] || q.close?.[i] || 0),
      close: Number(q.close?.[i] || 0),
    })).filter(p => p.close);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ symbol, points });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'chart error', points: [] });
  }
}
