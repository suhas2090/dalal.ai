// DALAL.AI Cloudflare Worker (fixed MMI + FII/DII parsing)
export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    const p = url.searchParams;
    if (p.get('fiidii') === '1') return handleFIIDII(corsHeaders);
    if (p.get('mmi') === '1') return handleMMI(corsHeaders);
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }
};

const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function handleFIIDII(corsHeaders) {
  const endpoints = [
    'https://www.nseindia.com/api/fiidiiTradeReact',
    'https://www.nseindia.com/api/fii-dii-trade-react',
  ];
  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.nseindia.com/',
    'Origin': 'https://www.nseindia.com',
  };

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { headers, cf: { cacheTtl: 3600, cacheEverything: true } });
      if (!r.ok) continue;
      const data = await r.json();
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) continue;

      const fpiNet = num(row.fpiNet ?? row.fpi_net ?? row.FPI_NET ?? row.fiiNet ?? row.fii_net);
      const diiNet = num(row.diiNet ?? row.dii_net ?? row.DII_NET);
      const date = row.date || row.tradeDate || row.TRADE_DATE || row.dt || '';
      if (fpiNet === null && diiNet === null) continue;

      return new Response(JSON.stringify({ fpi_net: fpiNet, dii_net: diiNet, date }), {
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' },
      });
    } catch {}
  }

  return new Response(JSON.stringify({ fpi_net: null, dii_net: null, date: '', error: 'NSE FII/DII endpoint unavailable' }), {
    headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=300' },
  });
}

async function handleMMI(corsHeaders) {
  const endpoints = ['https://api.tickertape.in/market-mood-index', 'https://api.tickertape.in/mmi'];

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        cf: { cacheTtl: 1800, cacheEverything: true },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const value = num(data?.data?.currentValue ?? data?.data?.value ?? data?.currentValue ?? data?.value);
      const updatedAt = data?.data?.updatedAt || data?.updatedAt || new Date().toISOString();
      if (value === null) continue;
      return new Response(JSON.stringify({ value, updatedAt }), {
        headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=1800' },
      });
    } catch {}
  }

  return new Response(JSON.stringify({ value: null, updatedAt: '', error: 'MMI unavailable' }), {
    headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=300' },
  });
}
