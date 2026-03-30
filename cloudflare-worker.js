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

    const p = url.searchParams;
    if (url.pathname === '/api/macro-health') return handleMacroHealth(corsHeaders, env);
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

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const safeTrend = (latest, previous) => {
  if (latest === null || previous === null) return 'unknown';
  if (latest > previous) return 'up';
  if (latest < previous) return 'down';
  return 'flat';
};

function indicatorStatus(name, value, trend = 'unknown') {
  if (value === null) return { color: 'yellow', status: 'caution', reason: 'Data unavailable' };

  switch (name) {
    case 'gdpGrowth':
      if (value > 6) return { color: 'green', status: 'healthy', reason: 'Growth above 6%' };
      if (value < 5) return { color: 'red', status: 'warning', reason: 'Growth below 5%' };
      return { color: 'yellow', status: 'caution', reason: 'Growth in transition zone' };
    case 'iip':
      if (value > 5) return { color: 'green', status: 'healthy', reason: 'Industrial momentum strong' };
      if (value < 2) return { color: 'red', status: 'warning', reason: 'Industrial production weakening' };
      return { color: 'yellow', status: 'caution', reason: 'Moderate industrial growth' };
    case 'cpi':
      if (value >= 2 && value <= 6) return { color: 'green', status: 'healthy', reason: 'Inflation within RBI comfort band' };
      if (value > 6) return { color: 'red', status: 'warning', reason: 'Inflation above comfort band' };
      return { color: 'yellow', status: 'caution', reason: 'Very low inflation may indicate weak demand' };
    case 'wpi':
      if (value >= 0 && value <= 6) return { color: 'green', status: 'healthy', reason: 'Wholesale inflation stable' };
      if (value > 7 || value < -1) return { color: 'red', status: 'warning', reason: 'Wholesale price stress elevated' };
      return { color: 'yellow', status: 'caution', reason: 'Watch producer price trend' };
    case 'credit':
      if (value > 10) return { color: 'green', status: 'healthy', reason: 'Credit growth supports expansion' };
      if (value < 5) return { color: 'red', status: 'warning', reason: 'Credit impulse slowing' };
      return { color: 'yellow', status: 'caution', reason: 'Moderate credit creation' };
    case 'forex':
      if (trend === 'up') return { color: 'green', status: 'healthy', reason: 'Reserve buffers improving' };
      if (trend === 'down') return { color: 'red', status: 'warning', reason: 'Reserves trending down' };
      return { color: 'yellow', status: 'caution', reason: 'Reserve trend flat/unclear' };
    case 'unemployment':
      if (value < 6) return { color: 'green', status: 'healthy', reason: 'Labor market resilient' };
      if (value > 7) return { color: 'red', status: 'warning', reason: 'Labor market stress rising' };
      return { color: 'yellow', status: 'caution', reason: 'Labor market mixed' };
    default:
      return { color: 'yellow', status: 'caution', reason: 'No rule configured' };
  }
}

function scoreMacro(indicators) {
  let score = 0;

  if (indicators.gdpGrowth?.value !== null) {
    if (indicators.gdpGrowth.value > 6) score += 2;
    else if (indicators.gdpGrowth.value < 5) score -= 2;
  }

  if (indicators.iip?.value !== null) {
    if (indicators.iip.value > 5) score += 2;
    else if (indicators.iip.value < 2) score -= 2;
  }

  if (indicators.cpi?.value !== null) {
    if (indicators.cpi.value >= 2 && indicators.cpi.value <= 6) score += 2;
    else if (indicators.cpi.value > 6) score -= 2;
    else score -= 1;
  }

  if (indicators.wpi?.value !== null) {
    if (indicators.wpi.value >= 0 && indicators.wpi.value <= 6) score += 1;
    else score -= 1;
  }

  if (indicators.credit?.value !== null) {
    if (indicators.credit.value > 10) score += 1;
    else if (indicators.credit.value < 5) score -= 1;
  }

  if (indicators.forex?.trend === 'up') score += 1;
  if (indicators.forex?.trend === 'down') score -= 1;

  if (indicators.unemployment?.value !== null) {
    if (indicators.unemployment.value < 6) score += 2;
    else if (indicators.unemployment.value > 7) score -= 2;
  }

  return clamp(score, -10, 10);
}

function macroSignal(score) {
  if (score >= 4) return 'BULLISH';
  if (score <= -3) return 'BEARISH';
  return 'CAUTION';
}

function buildSectorImpact(signal, indicators) {
  const growthWeak = (indicators.gdpGrowth?.value ?? 99) < 5;
  const iipWeak = (indicators.iip?.value ?? 99) < 2;
  const inflationHigh = (indicators.cpi?.value ?? 0) > 6;

  return {
    itSoftware: signal === 'BEARISH'
      ? 'Export-driven IT can remain relatively resilient, but weak global growth can delay discretionary tech spending.'
      : 'Stable growth backdrop supports deal flow; monitor global recession signals for demand risk.',
    banks: inflationHigh
      ? 'Sticky inflation can keep rates higher for longer; NIM may hold near-term but credit stress risk rises if growth slows.'
      : 'Benign inflation allows rate normalization; watch NIM compression if rate cuts accelerate.',
    autoManufacturing: (growthWeak || iipWeak)
      ? 'Slowing output and demand can pressure volumes, utilization, and operating leverage.'
      : 'Healthy production trends typically support auto and capital-goods volume expansion.',
    defensive: signal === 'BEARISH'
      ? 'Defensives (FMCG, utilities, pharma) generally outperform when macro momentum fades.'
      : 'Defensives may lag in strong risk-on phases but provide portfolio stability across cycles.',
  };
}

function parseGenericValue(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'number') return payload;
  if (typeof payload === 'string') return num(payload);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const parsed = parseGenericValue(item);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  if (typeof payload === 'object') {
    const preferredKeys = ['value', 'latest', 'current', 'index', 'data'];
    for (const key of preferredKeys) {
      if (key in payload) {
        const parsed = parseGenericValue(payload[key]);
        if (parsed !== null) return parsed;
      }
    }
    for (const v of Object.values(payload)) {
      const parsed = parseGenericValue(v);
      if (parsed !== null) return parsed;
    }
  }

  return null;
}

async function fetchWorldBankIndicator(indicatorId) {
  const url = `https://api.worldbank.org/v2/country/IN/indicator/${indicatorId}?format=json&per_page=70`;
  const r = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`World Bank ${indicatorId} HTTP ${r.status}`);
  const payload = await r.json();
  const series = Array.isArray(payload) ? payload[1] : null;
  if (!Array.isArray(series)) return { value: null, previous: null, year: null };

  const usable = series
    .map((row) => ({
      year: Number.parseInt(row?.date, 10),
      value: num(row?.value),
    }))
    .filter((row) => Number.isFinite(row.year) && row.value !== null)
    .sort((a, b) => b.year - a.year);

  return {
    value: usable[0]?.value ?? null,
    previous: usable[1]?.value ?? null,
    year: usable[0]?.year ?? null,
  };
}

async function fetchOptionalSeries(url) {
  if (!url) return { value: null, previous: null, source: null };
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json, text/plain, */*' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!r.ok) return { value: null, previous: null, source: url };
    const payload = await r.json();
    const value = parseGenericValue(payload);
    return { value, previous: null, source: url };
  } catch {
    return { value: null, previous: null, source: url };
  }
}

async function handleMacroHealth(corsHeaders, env = {}) {
  try {
    const [gdp, wbInflation, unemployment, credit, forex, rbiIip, mospiCpi, mospiWpi] = await Promise.all([
      fetchWorldBankIndicator('NY.GDP.MKTP.KD.ZG'),
      fetchWorldBankIndicator('FP.CPI.TOTL.ZG'),
      fetchWorldBankIndicator('SL.UEM.TOTL.ZS'),
      fetchWorldBankIndicator('FS.AST.PRVT.GD.ZS'),
      fetchWorldBankIndicator('FI.RES.TOTL.CD'),
      fetchOptionalSeries(env.RBI_IIP_URL),
      fetchOptionalSeries(env.MOSPI_CPI_URL),
      fetchOptionalSeries(env.MOSPI_WPI_URL),
    ]);

    const cpiValue = mospiCpi.value ?? wbInflation.value;
    const iipTrend = safeTrend(rbiIip.value, rbiIip.previous);
    const forexTrend = safeTrend(forex.value, forex.previous);

    const indicators = {
      gdpGrowth: {
        label: 'GDP Growth',
        unit: '%',
        value: gdp.value,
        previous: gdp.previous,
        period: gdp.year,
        source: 'World Bank',
        ...indicatorStatus('gdpGrowth', gdp.value, safeTrend(gdp.value, gdp.previous)),
      },
      iip: {
        label: 'IIP',
        unit: '%',
        value: rbiIip.value,
        previous: rbiIip.previous,
        source: rbiIip.source || 'RBI DBIE (configure RBI_IIP_URL)',
        ...indicatorStatus('iip', rbiIip.value, iipTrend),
      },
      cpi: {
        label: 'CPI Inflation',
        unit: '%',
        value: cpiValue,
        previous: wbInflation.previous,
        period: wbInflation.year,
        source: mospiCpi.source || 'MOSPI / World Bank fallback',
        ...indicatorStatus('cpi', cpiValue, safeTrend(cpiValue, wbInflation.previous)),
      },
      wpi: {
        label: 'WPI Inflation',
        unit: '%',
        value: mospiWpi.value,
        previous: mospiWpi.previous,
        source: mospiWpi.source || 'MOSPI (configure MOSPI_WPI_URL)',
        ...indicatorStatus('wpi', mospiWpi.value, safeTrend(mospiWpi.value, mospiWpi.previous)),
      },
      credit: {
        label: 'Credit to Private Sector',
        unit: '% of GDP',
        value: credit.value,
        previous: credit.previous,
        period: credit.year,
        source: 'World Bank',
        ...indicatorStatus('credit', credit.value, safeTrend(credit.value, credit.previous)),
      },
      forex: {
        label: 'Forex Reserves',
        unit: 'USD',
        value: forex.value,
        previous: forex.previous,
        period: forex.year,
        trend: forexTrend,
        source: 'World Bank',
        ...indicatorStatus('forex', forex.value, forexTrend),
      },
      unemployment: {
        label: 'Unemployment',
        unit: '%',
        value: unemployment.value,
        previous: unemployment.previous,
        period: unemployment.year,
        source: 'World Bank',
        ...indicatorStatus('unemployment', unemployment.value, safeTrend(unemployment.value, unemployment.previous)),
      },
    };

    const score = scoreMacro(indicators);
    const signal = macroSignal(score);
    const alerts = Object.values(indicators)
      .filter((i) => i.status === 'warning')
      .map((i) => `${i.label}: ${i.reason}`);

    const body = {
      ok: true,
      signal,
      healthScore: score,
      healthBadge: signal === 'BULLISH' ? 'green' : signal === 'BEARISH' ? 'red' : 'yellow',
      indicators,
      alerts,
      recommendation: signal === 'BULLISH'
        ? 'Risk-on bias is supported. Favor cyclical exposure with disciplined stop-loss.'
        : signal === 'BEARISH'
          ? 'De-risk posture advised. Increase cash/hedges and rotate toward defensive sectors.'
          : 'Mixed macro setup. Keep balanced exposure and tighten risk controls.',
      sectorImpact: buildSectorImpact(signal, indicators),
      sources: {
        rbiDbie: 'https://data.rbi.org.in/DBIE/',
        mospiEsankhyiki: 'https://esankhyiki.mospi.gov.in/',
        worldBank: 'https://data.worldbank.org/',
      },
      lastUpdated: new Date().toISOString(),
    };

    return new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=1800' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `macro-health failed: ${e.message}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=120' },
    });
  }
}
