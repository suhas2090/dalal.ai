// DALAL.AI Cloudflare Worker (fixed MMI + FII/DII parsing)
export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);
    if (url.pathname === '/api/macro-health') return handleMacroHealth(corsHeaders, env);
    if (url.pathname === '/api/macro-health-detail') return handleMacroHealthDetail(url, corsHeaders);

    const p = url.searchParams;
    const symbolsParam = p.get('symbols');
    if (symbolsParam) return handleSymbols(symbolsParam, corsHeaders);
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

async function handleSymbols(symbolsParam, corsHeaders) {
  try {
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (!symbols.length) {
      return new Response(JSON.stringify({ error: 'No symbols provided' }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
    const r = await fetch(quoteUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      cf: { cacheTtl: 20, cacheEverything: true },
    });

    if (!r.ok) {
      return new Response(JSON.stringify({ error: `Yahoo quote HTTP ${r.status}` }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    const data = await r.json();
    const out = {};
    const quotes = data?.quoteResponse?.result || [];

    for (const q of quotes) {
      const sym = q?.symbol;
      const price = num(q?.regularMarketPrice);
      const chgAmt = num(q?.regularMarketChange);
      const chgPct = num(q?.regularMarketChangePercent);
      if (!sym || price === null || chgAmt === null || chgPct === null) continue;
      out[sym] = { price, chgAmt, chgPct };
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=20' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `symbols handler failed: ${e.message}` }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

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

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

function statusFromThreshold(value, { greenMin = -Infinity, greenMax = Infinity, yellowMin = -Infinity, yellowMax = Infinity }) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'yellow';
  if (value >= greenMin && value <= greenMax) return 'green';
  if (value >= yellowMin && value <= yellowMax) return 'yellow';
  return 'red';
}

function trendDirection(value, previous) {
  if (value === null || previous === null) return 'unknown';
  if (value > previous) return 'up';
  if (value < previous) return 'down';
  return 'flat';
}

async function fetchWorldBankLatest(indicatorCode) {
  const endpoint = `https://api.worldbank.org/v2/country/IN/indicator/${indicatorCode}?format=json&per_page=80`;
  const r = await fetch(endpoint, { cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!r.ok) throw new Error(`World Bank HTTP ${r.status} for ${indicatorCode}`);

  const payload = await r.json();
  const rows = Array.isArray(payload?.[1]) ? payload[1] : [];
  const valid = rows.filter((row) => row?.value !== null && row?.value !== undefined);
  const latest = valid[0] || null;
  const previous = valid[1] || null;

  return {
    value: num(latest?.value),
    date: latest?.date || null,
    previousValue: num(previous?.value),
    previousDate: previous?.date || null,
    source: 'World Bank API',
    indicatorCode,
  };
}

async function handleMacroHealth(corsHeaders, env) {
  try {
    const [gdp, iipProxy, cpi, wpiProxy, credit, forex, unemployment] = await Promise.all([
      fetchWorldBankLatest('NY.GDP.MKTP.KD.ZG'),
      fetchWorldBankLatest('NV.IND.TOTL.KD.ZG'),
      fetchWorldBankLatest('FP.CPI.TOTL.ZG'),
      fetchWorldBankLatest('NY.GDP.DEFL.KD.ZG'),
      fetchWorldBankLatest('FS.AST.PRVT.GD.ZS'),
      fetchWorldBankLatest('FI.RES.TOTL.MO'),
      fetchWorldBankLatest('SL.UEM.TOTL.ZS'),
    ]);

    const indicators = {
      gdpGrowth: {
        label: 'GDP Growth (%)',
        value: gdp.value,
        date: gdp.date,
        status: statusFromThreshold(gdp.value, { greenMin: 6, greenMax: 99, yellowMin: 5, yellowMax: 5.99 }),
        trend: trendDirection(gdp.value, gdp.previousValue),
        source: gdp.source,
      },
      iip: {
        label: 'IIP / Industrial Growth Proxy (%)',
        value: iipProxy.value,
        date: iipProxy.date,
        status: statusFromThreshold(iipProxy.value, { greenMin: 5, greenMax: 99, yellowMin: 2, yellowMax: 4.99 }),
        trend: trendDirection(iipProxy.value, iipProxy.previousValue),
        source: `MoSPI preferred, fallback: ${iipProxy.source}`,
      },
      cpi: {
        label: 'CPI Inflation (%)',
        value: cpi.value,
        date: cpi.date,
        status: statusFromThreshold(cpi.value, { greenMin: 2, greenMax: 6, yellowMin: 6.01, yellowMax: 7 }),
        trend: trendDirection(cpi.value, cpi.previousValue),
        source: `MoSPI preferred, fallback: ${cpi.source}`,
      },
      wpi: {
        label: 'WPI / Deflator Proxy (%)',
        value: wpiProxy.value,
        date: wpiProxy.date,
        status: statusFromThreshold(wpiProxy.value, { greenMin: 1, greenMax: 6, yellowMin: 6.01, yellowMax: 7.5 }),
        trend: trendDirection(wpiProxy.value, wpiProxy.previousValue),
        source: `MoSPI preferred, fallback: ${wpiProxy.source}`,
      },
      credit: {
        label: 'Private Credit (% GDP)',
        value: credit.value,
        date: credit.date,
        status: statusFromThreshold(credit.value, { greenMin: 45, greenMax: 200, yellowMin: 35, yellowMax: 44.99 }),
        trend: trendDirection(credit.value, credit.previousValue),
        source: `RBI preferred, fallback: ${credit.source}`,
      },
      forex: {
        label: 'Forex Reserves (months of imports)',
        value: forex.value,
        date: forex.date,
        status: statusFromThreshold(forex.value, { greenMin: 8, greenMax: 99, yellowMin: 5, yellowMax: 7.99 }),
        trend: trendDirection(forex.value, forex.previousValue),
        source: `RBI preferred, fallback: ${forex.source}`,
      },
      unemployment: {
        label: 'Unemployment (%)',
        value: unemployment.value,
        date: unemployment.date,
        status: statusFromThreshold(unemployment.value, { greenMin: 0, greenMax: 5, yellowMin: 5.01, yellowMax: 7 }),
        trend: trendDirection(unemployment.value, unemployment.previousValue),
        source: `MoSPI preferred, fallback: ${unemployment.source}`,
      },
    };

    let score = 0;
    if (indicators.gdpGrowth.value !== null) score += indicators.gdpGrowth.value > 6 ? 2 : indicators.gdpGrowth.value >= 5 ? 0 : -2;
    if (indicators.iip.value !== null) score += indicators.iip.value > 5 ? 2 : indicators.iip.value >= 2 ? 0 : -2;
    if (indicators.cpi.value !== null) score += indicators.cpi.value >= 2 && indicators.cpi.value <= 6 ? 2 : indicators.cpi.value > 6 ? -2 : -1;
    if (indicators.unemployment.value !== null) score += indicators.unemployment.value < 5 ? 1 : indicators.unemployment.value > 7 ? -2 : -1;
    if (indicators.credit.value !== null && credit.previousValue !== null) score += indicators.credit.value >= credit.previousValue ? 1 : -1;
    if (indicators.forex.value !== null && forex.previousValue !== null) score += indicators.forex.value >= forex.previousValue ? 1 : -1;
    if (indicators.wpi.value !== null) score += indicators.wpi.value > 7.5 ? -1 : indicators.wpi.value < 1 ? -1 : 0;

    score = clamp(score, -10, 10);

    const traderSignal = score >= 4 ? 'BULLISH' : score <= -3 ? 'BEARISH' : 'CAUTION';
    const healthBadge = score >= 4 ? 'green' : score <= -3 ? 'red' : 'yellow';

    const alerts = Object.values(indicators)
      .filter((x) => x.status !== 'green')
      .map((x) => ({
        severity: x.status === 'red' ? 'warning' : 'caution',
        message: `${x.label} is ${x.status.toUpperCase()} at ${x.value ?? 'N/A'}`,
      }));

    const sectorImpact = {
      itSoftware: score <= 0
        ? 'Slowing global/domestic demand can pressure discretionary tech budgets; focus on export resilience and deal quality.'
        : 'Healthy growth supports enterprise spending and stronger order books.',
      banks: indicators.cpi.value !== null && indicators.cpi.value > 6
        ? 'Sticky inflation can keep rates higher for longer; NIM may stay supported short-term but credit risk can rise.'
        : 'Benign inflation and stable rates usually support healthier credit growth and asset quality.',
      autoManufacturing: indicators.iip.value !== null && indicators.iip.value < 2
        ? 'Weak industrial momentum may soften volume growth and utilization.'
        : 'Improving industrial activity tends to support production, sales, and supplier capacity.',
      defensive: score <= 0
        ? 'Defensive sectors (FMCG, pharma, utilities) typically outperform during macro slowdowns.'
        : 'In stronger cycles, defensives may lag higher-beta cyclical sectors.',
    };

    const out = {
      ok: true,
      endpoint: '/api/macro-health',
      dataSources: ['RBI DBIE', 'MoSPI eSankhyiki', 'World Bank API'],
      indicators,
      economicHealthScore: score,
      healthBadge,
      traderSignal,
      traderActionRecommendation:
        traderSignal === 'BULLISH'
          ? 'Risk-ON gradually: favor cyclicals, trend leaders, and earnings momentum.'
          : traderSignal === 'BEARISH'
            ? 'DE-RISK: reduce leverage/beta, tighten stops, and rotate into defensives/cash.'
            : 'Stay selective: barbell defensives with high-conviction quality names.',
      alerts,
      sectorImpact,
      notes: env?.MACRO_NOTES || 'For RBI/MoSPI direct series, wire official dataset URLs via Worker env and replace proxy indicators.',
      lastUpdated: new Date().toISOString(),
    };

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `macro-health failed: ${e.message}` }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

const MACRO_SERIES_MAP = {
  gdpGrowth: { code: 'NY.GDP.MKTP.KD.ZG', sourceUrl: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG?locations=IN' },
  iip: { code: 'NV.IND.TOTL.KD.ZG', sourceUrl: 'https://esankhyiki.mospi.gov.in/' },
  cpi: { code: 'FP.CPI.TOTL.ZG', sourceUrl: 'https://esankhyiki.mospi.gov.in/' },
  wpi: { code: 'NY.GDP.DEFL.KD.ZG', sourceUrl: 'https://esankhyiki.mospi.gov.in/' },
  credit: { code: 'FS.AST.PRVT.GD.ZS', sourceUrl: 'https://data.rbi.org.in/DBIE/' },
  forex: { code: 'FI.RES.TOTL.MO', sourceUrl: 'https://data.rbi.org.in/DBIE/' },
  unemployment: { code: 'SL.UEM.TOTL.ZS', sourceUrl: 'https://esankhyiki.mospi.gov.in/' },
};

async function handleMacroHealthDetail(url, corsHeaders) {
  try {
    const indicator = url.searchParams.get('indicator') || 'gdpGrowth';
    const meta = MACRO_SERIES_MAP[indicator];
    if (!meta) {
      return new Response(JSON.stringify({ ok: false, error: `Unknown indicator: ${indicator}` }), { status: 400, headers: corsHeaders });
    }

    const endpoint = `https://api.worldbank.org/v2/country/IN/indicator/${meta.code}?format=json&per_page=20`;
    const r = await fetch(endpoint, { cf: { cacheTtl: 21600, cacheEverything: true } });
    if (!r.ok) throw new Error(`World Bank HTTP ${r.status}`);
    const wb = await r.json();
    const rows = Array.isArray(wb?.[1]) ? wb[1].filter((x) => x?.value !== null).slice(0, 8) : [];
    const history = rows.map((x) => ({ date: x.date, value: num(x.value) }));

    let sourceSnapshot = '';
    try {
      const srcResp = await fetch(meta.sourceUrl, { cf: { cacheTtl: 43200, cacheEverything: true } });
      if (srcResp.ok) {
        const txt = await srcResp.text();
        sourceSnapshot = txt.replace(/\s+/g, ' ').slice(0, 1200);
      }
    } catch {}

    return new Response(JSON.stringify({
      ok: true,
      indicator,
      sourceUrl: meta.sourceUrl,
      history,
      sourceSnapshot,
      lastUpdated: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `macro-health-detail failed: ${e.message}` }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
