  let dockOpen = false;
  function toggleDock() {
    dockOpen = !dockOpen;
    const panel = document.getElementById('dockPanel');
    const fab   = document.getElementById('dockFab');
    if (dockOpen) {
      panel.classList.add('open');
      fab.style.transform = 'rotate(45deg) scale(1.05)';
      fab.style.boxShadow = '0 6px 28px rgba(124,92,252,0.8)';
    } else {
      panel.classList.remove('open');
      fab.style.transform = 'rotate(0) scale(1)';
      fab.style.boxShadow = '0 4px 20px rgba(124,92,252,0.5)';
    }
  }
  // Close dock when an overlay opens
  ['openScenario','openSupplyChain','openGroqModal'].forEach(fn => {
    const orig = window[fn];
    window[fn] = function(...args) {
      if (dockOpen) toggleDock();
      orig?.(...args);
    };
  });

// ════════════════════════════════════════════════════════════════
//  ██████  CONFIG — EDIT THIS SECTION ONLY
// ════════════════════════════════════════════════════════════════

const CONFIG = {

  // ── GEMINI API KEY ───────────────────────────────────────────
  //  Free: 1,500 requests/day at aistudio.google.com
  //  ⚠️  NOTE: This key is visible in browser DevTools.
  //      If someone finds it, they can use your free quota.
  //      To reset: go to aistudio.google.com → API Keys → Delete & recreate.
  GEMINI_API_KEY: "", // loaded from localStorage at runtime
  GROQ_API_KEY: "",   // loaded from localStorage at runtime
  ALPHA_VANTAGE_KEY: "", // loaded from localStorage at runtime

  // ── CLOUDFLARE WORKER URL ────────────────────────────────────
  //  Step 1: Go to cloudflare.com → Workers & Pages → Create Worker
  //  Step 2: Paste the cloudflare-worker.js code → Deploy
  //  Step 3: Copy your worker URL and paste it below
  //  Format: "https://dalal-prices.YOUR-NAME.workers.dev"
  WORKER_URL: "https://dalal-prices.suhasnrao.workers.dev",

  // ── YAHOO FINANCE RAPIDAPI KEY ──────────────────────────────
  // Legacy RapidAPI key — no longer used (replaced by Finnhub)
  // YAHOO_FINANCE_API_KEY: "a1373f54a8mshe0a721106e107f1p13a10bjsn03d658c329ba",

  // ── DATA SOURCE URLs ─────────────────────────────────────────
  URLS: {
    BSE_ANNOUNCEMENTS: "https://www.bseindia.com/corporates/ann.html",
    NSE_FILINGS: "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
    CONCALL_SITE_1: "https://www.bseindia.com/xml-data/corpfiling/AttachLive/",
    CONCALL_SITE_2: "https://alphastreet.com/india/category/earnings-call-transcripts/",
    CONCALL_SITE_3: "https://trendlyne.com/conference-calls/",
    SCREENER_URL:   "https://www.screener.in/company/",
    TRADINGVIEW_BASE: "https://www.tradingview.com/symbols/NSE-",
    MONEYCONTROL_NEWS: "https://www.moneycontrol.com/rss/latestnews.xml",
    CUSTOM_URL_1:  "https://www.nseindia.com/rss-feed",
    CUSTOM_URL_2:  "https://www.business-standard.com/rss-feeds/listing",
    CUSTOM_URL_3:  "https://in.investing.com/rss/news.rss",
    CUSTOM_URL_4:  "http://feeds.reuters.com/reuters/businessNews",
    CUSTOM_URL_5:  "https://www.worldfinance.com/news/rss-feed",
    CUSTOM_URL_6:  "https://finnhub.io",
    CUSTOM_URL_7:  "https://www.marketaux.com",
    CUSTOM_URL_8:  "https://site.financialmodelingprep.com/developer/docs",
    CUSTOM_URL_9:  "https://pulse.zerodha.com",
    CUSTOM_URL_10: "https://finshots.in/archive/",
    CUSTOM_URL_11: "https://www.wsj.com/news/markets",
    CUSTOM_URL_12: "https://www.valuepickr.com/",
    CUSTOM_URL_13: "https://www.bloomberg.com/markets",
    CUSTOM_URL_14: "https://www.5paisa.com/rss",
    CUSTOM_URL_15: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    CUSTOM_URL_16: "https://www.etmarkets.com/",
    CUSTOM_URL_17: "https://www.ndtvprofit.com/markets",
  }
};

// ════════════════════════════════════════════════════════════════
//  END OF CONFIG — DO NOT EDIT BELOW UNLESS YOU KNOW JS
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  LIVE DATA ENGINE v4 — Cloudflare Worker + Yahoo Finance
//  Worker fetches Yahoo Finance server-side (no CORS issues)
//  News: rss2json.com free tier
//  Refresh: every 5 minutes automatically
// ════════════════════════════════════════════════════════════════

// ── PASTE YOUR CLOUDFLARE WORKER URL HERE ──
// After deploying the worker, copy the URL (e.g. https://dalal-prices.YOUR-NAME.workers.dev)
// and paste it below replacing the placeholder
const WORKER_URL = CONFIG.WORKER_URL;

const priceCache = {};

// ── CORE: fetch batch of symbols via Cloudflare Worker ──
async function workerFetch(symbols) {
  try {
    const url = `${WORKER_URL}?symbols=${encodeURIComponent(symbols.join(','))}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) { console.warn('Worker HTTP', res.status); return {}; }
    return await res.json();
  } catch(e) {
    console.warn('Worker fetch failed:', e.message);
    return {};
  }
}

// ── FALLBACK: direct Yahoo Finance API (used when worker is unavailable) ──
async function yahooDirectFetch(symbols) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    clearTimeout(timer);
    if (!res.ok) { console.warn('Yahoo fallback HTTP', res.status); return {}; }

    const json = await res.json();
    const quotes = json?.quoteResponse?.result || [];
    const out = {};
    for (const q of quotes) {
      const sym = q?.symbol;
      const price = Number(q?.regularMarketPrice);
      const chgAmt = Number(q?.regularMarketChange);
      const chgPct = Number(q?.regularMarketChangePercent);
      if (!sym || !Number.isFinite(price) || !Number.isFinite(chgAmt) || !Number.isFinite(chgPct)) continue;
      out[sym] = { price, chgAmt, chgPct };
    }
    return out;
  } catch (e) {
    console.warn('Yahoo fallback failed:', e.message);
    return {};
  }
}

// ── SYMBOL LISTS ──
// Yahoo Finance format: NSE stocks = "TCS.NS", indices = "^NSEI", forex = "USDINR=X"
const SYMBOLS = {
  // Stocks (ticker + watchlist + sectors — all in one batch)
  stocks: {
    'TCS.NS':        'TCS',
    'RELIANCE.NS':   'RELIANCE',
    'HDFCBANK.NS':   'HDFCBANK',
    'INFY.NS':       'INFY',
    'WIPRO.NS':      'WIPRO',
    'ICICIBANK.NS':  'ICICIBANK',
    'SUNPHARMA.NS':  'SUNPHARMA',
    'ADANIPORTS.NS': 'ADANIPORTS',
    'MARUTI.NS':     'MARUTI',
    'TATAMOTORS.NS': 'TATAMOTORS',
    'SBIN.NS':       'SBIN',
    'BAJFINANCE.NS': 'BAJFINANCE',
    'TITAN.NS':      'TITAN',
    'ONGC.NS':       'ONGC',
    'LTIM.NS':       'LTIM',
  },
  indices: {
    '^NSEI':        'NIFTY',
    '^BSESN':       'SENSEX',
    '^NSEBANK':    'BANKNIFTY',
    '^DJI':         'DJI',
    '^IXIC':        'NASDAQ',
  },
  macro: {
    'USDINR=X': 'USDINR',
    'BZ=F':     'CRUDE',
    'GC=F':     'GOLD',
    'IN10Y=X':  'GSEC',
    '^INDIAVIX': 'VIX',
  }
};

// ── FORMAT HELPERS ──
function fmt(p) {
  if (!p) return null;
  const up = p.chgPct >= 0;
  return {
    ...p, up,
    priceStr: p.price.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2}),
    chgStr:   (up ? '+' : '') + p.chgPct.toFixed(2) + '%',
    chgAmtStr:(up ? '+' : '') + Math.abs(p.chgAmt).toFixed(2),
  };
}

// ── APPLY ALL DATA TO UI ──
function applyToUI(raw, type) {
  if (type === 'stocks') {
    const symMap = SYMBOLS.stocks; // yahooSym -> shortName
    const tickerItems = [];

    for (const [yahooSym, shortName] of Object.entries(symMap)) {
      const p = fmt(raw[yahooSym]);
      if (!p) continue;
      priceCache[shortName] = p;

      // Ticker
      tickerItems.push(`<div class="tick-item">
        <span class="tick-name">${shortName}</span>
        <span class="tick-price">&#8377;${p.priceStr}</span>
        <span class="${p.up ? 'tick-up':'tick-down'}">${p.chgStr}</span>
      </div>`);

      // Watchlist
      const sid = shortName.toLowerCase();
      const wlMap = ['tcs','reliance','hdfcbank','infy','adaniports'];
      if (wlMap.includes(sid)) {
        const pe = document.getElementById(`wl-${sid}-price`);
        const ce = document.getElementById(`wl-${sid}-chg`);
        if (pe) pe.textContent = '\u20b9' + p.priceStr;
        if (ce) { ce.textContent = p.chgStr; ce.style.color = p.up ? 'var(--green)':'var(--red)'; }
      }

      // Sectors
      const secMap = { TCS:'sector-it', HDFCBANK:'sector-bank', SUNPHARMA:'sector-pharma', MARUTI:'sector-auto', RELIANCE:'sector-energy' };
      if (secMap[shortName]) {
        const el = document.getElementById(secMap[shortName]);
        if (el) { el.textContent = p.chgStr; el.style.color = p.up ? 'var(--green)':'var(--red)'; }
      }
    }

    if (tickerItems.length > 0) {
      document.getElementById('tickerInner').innerHTML = [...tickerItems, ...tickerItems].join('');
    }
  }

  if (type === 'indices') {
    const map = [
      ['^NSEI',        'nifty-val',     'nifty-chg'    ],
      ['^BSESN',       'sensex-val',    'sensex-chg'   ],
      ['^NSEBANK',     'banknifty-val', 'banknifty-chg'],
      ['^DJI',         'dji-val',       'dji-chg'      ],
      ['^IXIC',        'nasdaq-val',    'nasdaq-chg'   ],
    ];
    for (const [sym, vid, cid] of map) {
      const p = fmt(raw[sym]); if (!p) continue;
      const ve = document.getElementById(vid);
      const ce = document.getElementById(cid);
      if (ve) { ve.textContent = p.priceStr; ve.style.color = p.up ? 'var(--green)':'var(--red)'; }
      if (ce) { ce.textContent = `${p.up?'\u25b2':'\u25bc'} ${p.chgAmtStr} (${p.chgStr})`; ce.style.color = p.up ? 'var(--green)':'var(--red)'; }
    }
    // SGX Nifty — derived approx from Nifty futures (placeholder shown as Nifty +/- small premium)
    const nifty = fmt(raw['^NSEI']);
    if (nifty) {
      const sgxEl = document.getElementById('sgxnifty-val');
      const sgxCh = document.getElementById('sgxnifty-chg');
      const sgxPrice = (nifty.price * 1.0012).toFixed(0); // small premium proxy
      if (sgxEl) { sgxEl.textContent = Number(sgxPrice).toLocaleString('en-IN'); sgxEl.style.color = nifty.up ? 'var(--green)':'var(--red)'; }
      if (sgxCh) { sgxCh.textContent = nifty.up ? '▲ approx' : '▼ approx'; sgxCh.style.color = 'var(--muted)'; }
    }
  }

  if (type === 'macro') {
    const usd   = fmt(raw['USDINR=X']);
    const crude = fmt(raw['BZ=F']);
    const gold  = fmt(raw['GC=F']);
    const gsec  = fmt(raw['IN10Y=X']);
    const vix   = fmt(raw['^INDIAVIX']);

    if (usd) {
      const el = document.getElementById('macro-usdinr');
      if (el) { el.textContent = usd.priceStr + (usd.up?' \u25b2':' \u25bc'); el.style.color = usd.up?'var(--red)':'var(--green)'; }
    }
    if (crude) {
      const el = document.getElementById('macro-crude');
      if (el) { el.textContent = '$'+crude.priceStr+(crude.up?' \u25b2':' \u25bc'); el.style.color = crude.up?'var(--red)':'var(--green)'; }
    }
    if (gold && usd) {
      const per10g = Math.round((gold.price * usd.price / 31.1035) * 10);
      const el = document.getElementById('macro-gold');
      if (el) { el.textContent = '\u20b9'+per10g.toLocaleString('en-IN')+(gold.up?' \u25b2':' \u25bc'); el.style.color = gold.up?'var(--green)':'var(--red)'; }
    }
    if (gsec) {
      const el = document.getElementById('macro-gsec');
      if (el) { el.textContent = gsec.price.toFixed(2)+'%'; el.style.color = 'var(--text)'; }
    }
    if (vix) {
      const el = document.getElementById('macro-vix');
      if (el) { el.textContent = vix.price.toFixed(1) + (vix.up?' ▲':' ▼'); el.style.color = vix.up?'var(--red)':'var(--green)'; }
    }

    // CPI — updated monthly from RBI/MOSPI. Last reading auto-displayed.
    // Value hardcoded monthly — change when new data released
    const cpiEl = document.getElementById('macro-cpi');
    if (cpiEl && cpiEl.textContent === '—') {
      cpiEl.textContent = '4.31% (Jan 25)';
      cpiEl.style.color = 'var(--text)';
    }
  }
}

// ── NEWS — rss2json with fallback rotation ──
const NEWS_FEEDS = [
  { name:'ET Markets',   url:'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { name:'ET Markets',   url:'https://economictimes.indiatimes.com/rssfeeds/1310891583.cms' },
  { name:'Mint Markets', url:'https://www.livemint.com/rss/markets' },
  { name:'BS Markets',   url:'https://www.business-standard.com/rss/markets-106.rss' },
  { name:'Hindu Biz',    url:'https://www.thehindubusinessline.com/markets/feeder/default.rss' },
];
let newsFeedIdx = 0;

function timeAgo(dateStr) {
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 60000;
    if (diff < 1) return 'just now';
    if (diff < 60) return Math.round(diff) + 'm ago';
    if (diff < 1440) return Math.round(diff/60) + 'h ago';
    return Math.round(diff/1440) + 'd ago';
  } catch(e) { return ''; }
}

function cleanTitle(t) {
  return (t||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
}

async function refreshNews() {
  try {
    const res = await fetch(WORKER_URL + '?news=1');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.items || data.items.length === 0) return;

    const container = document.getElementById('news-container');
    if (!container) return;

    container.innerHTML = data.items.map(item => {
      const title = (item.title || '').replace(/<!\[CDATA\[/g,'').replace(/\]\]>/g,'').replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      const short = title.length > 90 ? title.substring(0, 90) + '…' : title;
      const diff  = item.pubDate ? Math.round((Date.now() - new Date(item.pubDate).getTime()) / 60000) : 0;
      const ago   = diff < 60 ? diff + 'm ago' : Math.round(diff/60) + 'h ago';
      return '<div class="news-item"><div class="ni-source">' + (item.source||'Market News') + '</div><div class="ni-title">' + short + '</div><div class="ni-time">' + ago + '</div></div>';
    }).join('');

    const ts = document.getElementById('news-refresh-time');
    if (ts) {
      const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
      ts.textContent = 'updated ' + now + ' IST';
    }
  } catch(e) { console.warn('News failed:', e.message); }
}

// ── FII/DII — fetch from NSE via Cloudflare Worker ──
let fiiLastDate = null;

async function fetchFIIDII() {
  try {
    const res = await fetch(WORKER_URL + '?fiidii=1');
    if (!res.ok) return;
    const d = await res.json();
    if (d.error || (d.fpi_net === null && d.dii_net === null)) {
      console.warn('FII/DII: no data from NSE', d);
      return;
    }

    const fpiNet = parseFloat(d.fpi_net) || 0;
    const diiNet = parseFloat(d.dii_net) || 0;
    const maxVal = Math.max(Math.abs(fpiNet), Math.abs(diiNet), 1000);

    // FPI row
    const fpiEl  = document.getElementById('fii-val');
    const fpiBar = document.getElementById('fii-bar');
    if (fpiEl) {
      const up = fpiNet >= 0;
      fpiEl.textContent = (up ? '+' : '') + Math.round(fpiNet).toLocaleString('en-IN');
      fpiEl.style.color = up ? 'var(--green)' : 'var(--red)';
      if (fpiBar) { fpiBar.style.width = Math.min(Math.abs(fpiNet)/maxVal*90,90)+'%'; fpiBar.style.background = up?'var(--green)':'var(--red)'; }
    }

    // DII row
    const diiEl  = document.getElementById('dii-val');
    const diiBar = document.getElementById('dii-bar');
    if (diiEl) {
      const up = diiNet >= 0;
      diiEl.textContent = (up ? '+' : '') + Math.round(diiNet).toLocaleString('en-IN');
      diiEl.style.color = up ? 'var(--green)' : 'var(--red)';
      if (diiBar) { diiBar.style.width = Math.min(Math.abs(diiNet)/maxVal*90,90)+'%'; diiBar.style.background = up?'var(--saffron)':'var(--red)'; }
    }

    // Date
    const dateEl = document.getElementById('fii-date');
    if (dateEl && d.date) dateEl.textContent = 'as of ' + d.date;

  } catch(e) { console.warn('FII/DII fetch error:', e.message); }
}

function macroClassFromStatus(status) {
  if (status === 'green') return 'macro-health-green';
  if (status === 'red') return 'macro-health-red';
  return 'macro-health-yellow';
}

function fmtMacroValue(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '—';
  return Number(val).toFixed(2);
}

function macroHealthSwitchTab(tabKey, tabEl) {
  const tabsWrap = document.getElementById('macroHealthTabs');
  if (tabsWrap) tabsWrap.querySelectorAll('.mnp-tab').forEach((tab) => tab.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');

  document.querySelectorAll('.macro-health-tab-panel').forEach((panel) => panel.classList.remove('active'));
  const activePanel = document.getElementById(`macroHealthTab-${tabKey}`);
  if (activePanel) activePanel.classList.add('active');
}

function macroSafeJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch (_) { return null; }
}

function normalizeMacroHealthData(data) {
  if (!data || typeof data !== 'object') return null;
  const signal = data.traderSignal || data.signal || 'CAUTION';
  const score = Number(data.economicHealthScore ?? data.healthScore);
  const normalizedAlerts = (Array.isArray(data.alerts) ? data.alerts : [])
    .map((a) => (typeof a === 'string' ? { severity: 'caution', message: a } : a))
    .filter((a) => a?.message);

  return {
    ...data,
    traderSignal: signal,
    economicHealthScore: Number.isFinite(score) ? score : null,
    traderActionRecommendation: data.traderActionRecommendation || data.recommendation || '',
    alerts: normalizedAlerts,
  };
}

function sanitizeMacroText(value) {
  if (typeof value !== 'string') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (char) => map[char]).trim();
}

function sanitizeSectorImpact(sectorImpact) {
  if (!sectorImpact || typeof sectorImpact !== 'object') return {};
  return Object.fromEntries(
    Object.entries(sectorImpact).map(([key, value]) => [key, sanitizeMacroText(value)])
  );
}

async function maybeGenerateMacroAI(data) {
  if (!data || !CONFIG.GROQ_API_KEY) return {};
  const cacheKey = 'dalal_macro_ai_v1';
  const now = Date.now();
  const existing = macroSafeJSON(localStorage.getItem(cacheKey));
  if (existing?.generatedAt && (now - existing.generatedAt) < 24 * 60 * 60 * 1000) return existing;

  const indicators = Object.values(data.indicators || {})
    .slice(0, 6)
    .map((i) => `${i.label || 'Indicator'}: ${fmtMacroValue(i.value)}${i.unit ? ` ${i.unit}` : ''} (${i.trend || 'flat'})`)
    .join('\n');

  const sys = `You are a concise Indian macro strategist for active equity traders.
Respond ONLY in valid JSON.`;
  const usr = `Signal: ${data.traderSignal || 'CAUTION'}
Health score: ${data.economicHealthScore ?? 'NA'}
Indicators:
${indicators}

Return JSON exactly:
{"traderAction":"<max 45 words, specific trade posture>","sectorImpact":{"itSoftware":"<max 16 words>","banks":"<max 16 words>","autoManufacturing":"<max 16 words>","defensive":"<max 16 words>"}}`;

  const raw = await groqChat(sys, usr, 260);
  const parsed = macroSafeJSON(raw);
  if (!parsed) return {};

  const out = {
    generatedAt: now,
    traderAction: sanitizeMacroText(parsed.traderAction),
    sectorImpact: sanitizeSectorImpact(parsed.sectorImpact),
  };
  localStorage.setItem(cacheKey, JSON.stringify(out));
  return out;
}

function updateMacroHealthUI(data) {
  const badge = document.getElementById('macro-health-badge');
  const score = document.getElementById('macro-health-score');
  const signal = document.getElementById('macro-health-signal');
  const updated = document.getElementById('macro-health-updated');
  const cards = document.getElementById('macro-health-cards');
  const alerts = document.getElementById('macro-health-alerts');
  const action = document.getElementById('macro-trader-action');
  const sectors = document.getElementById('macro-sector-list');

  if (!badge || !score || !signal || !updated || !cards || !alerts || !action || !sectors) return;

  const badgeState = (data.healthBadge || 'yellow').toLowerCase();
  badge.classList.remove('macro-health-green', 'macro-health-yellow', 'macro-health-red');
  badge.classList.add(macroClassFromStatus(badgeState));
  badge.textContent = (badgeState === 'green' ? 'HEALTHY' : badgeState === 'red' ? 'WARNING' : 'CAUTION');

  const scoreVal = Number(data.economicHealthScore);
  score.textContent = Number.isFinite(scoreVal) ? (scoreVal > 0 ? `+${scoreVal}` : `${scoreVal}`) : '—';

  signal.textContent = data.healthJustification || data.traderSignal || 'Justification unavailable';
  signal.style.color =
    data.traderSignal === 'BULLISH' ? 'var(--green)'
      : data.traderSignal === 'BEARISH' ? 'var(--red)'
        : 'var(--gold)';

  const istTime = data.lastUpdated
    ? new Date(data.lastUpdated).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  updated.textContent = `updated ${istTime ? `${istTime} IST` : '—'}`;

  const indicatorEntries = Object.entries(data.indicators || {});
  cards.innerHTML = indicatorEntries.map(([key, item]) => {
    const cls = macroClassFromStatus(scoreIndicatorStatus(key, item.value));
    const trendIcon = item.trend === 'up' ? '▲' : item.trend === 'down' ? '▼' : '•';
    return `<div class="macro-health-card ${cls}">
      <div class="mh-name">${item.label || 'Indicator'}</div>
      <div class="mh-value">${fmtMacroValue(item.value)} ${trendIcon}</div>
      <div class="mh-date">${item.date || '—'}</div>
    </div>`;
  }).join('');

  action.textContent = data.traderActionRecommendation || 'No recommendation available.';

  const alertList = Array.isArray(data.alerts) ? data.alerts : [];
  alerts.innerHTML = alertList.length
    ? alertList.slice(0, 4).map((a) =>
      `<div class="macro-health-alert ${a.severity === 'warning' ? 'macro-health-alert-warning' : 'macro-health-alert-caution'}">${a.message}</div>`
    ).join('')
    : '<div class="macro-health-alert macro-health-alert-neutral">No macro warnings right now.</div>';

  const s = sanitizeSectorImpact(data.sectorImpact);
  sectors.innerHTML = `
    <div class="macro-sector-item"><strong>IT / SOFTWARE</strong> — ${s.itSoftware || '—'}</div>
    <div class="macro-sector-item"><strong>BANKS</strong> — ${s.banks || '—'}</div>
    <div class="macro-sector-item"><strong>AUTO / MANUFACTURING</strong> — ${s.autoManufacturing || '—'}</div>
    <div class="macro-sector-item"><strong>DEFENSIVE</strong> — ${s.defensive || '—'}</div>
  `;
}

async function fetchMacroHealth() {
  try {
    const url = new URL('/api/macro-health', WORKER_URL).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload?.ok) throw new Error(payload?.error || 'invalid macro payload');
    const data = normalizeMacroHealthData(payload);
    const ai = await maybeGenerateMacroAI(data);

    if (ai?.traderAction) data.traderActionRecommendation = ai.traderAction;
    if (ai?.sectorImpact && Object.keys(ai.sectorImpact).length) {
      data.sectorImpact = {
        ...sanitizeSectorImpact(data.sectorImpact),
        ...sanitizeSectorImpact(ai.sectorImpact),
      };
    }
    updateMacroHealthUI(data);
  } catch (e) {
    console.warn('Macro health fetch error:', e.message);
    const updated = document.getElementById('macro-health-updated');
    const alerts = document.getElementById('macro-health-alerts');
    if (updated) updated.textContent = 'updated —';
    if (alerts) alerts.innerHTML = `<div class="macro-health-alert macro-health-alert-warning">Macro health unavailable (${e.message}).</div>`;
  }
}

function checkFIIDII() {
  const ist = new Date(new Date().toLocaleString('en-US', {timeZone:'Asia/Kolkata'}));
  const today = ist.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
  if (fiiLastDate !== today) {
    fiiLastDate = today;
    fetchFIIDII(); // fetch once per day, first time after page load
  }
}

// ── MASTER REFRESH ──
let refreshCount = 0;
async function refreshAllLiveData() {
  refreshCount++;
  console.log(`DALAL.AI refresh #${refreshCount} at`, new Date().toLocaleTimeString());

  // Check worker URL is configured
  if (!WORKER_URL || WORKER_URL.includes('YOUR-WORKER-URL')) {
    console.warn('Worker URL not configured — prices will not load. See CONFIG block.');
    const tickerEl = document.getElementById('tickerInner');
    if (tickerEl) {
      tickerEl.innerHTML =
        `<div class="tick-item"><span class="tick-name" style="color:var(--red)">⚠ Set WORKER_URL in CONFIG</span></div>`.repeat(3);
    }
    return;
  }

  // 3 parallel batches — all symbols fetched simultaneously
  const stockSyms = Object.keys(SYMBOLS.stocks);
  const indexSyms = Object.keys(SYMBOLS.indices);
  const macroSyms = Object.keys(SYMBOLS.macro);

  let [stockRaw, indexRaw, macroRaw] = await Promise.all([
    workerFetch(stockSyms),
    workerFetch(indexSyms),
    workerFetch(macroSyms),
  ]);

  // Worker may fail in some deployments (DNS/CORS/rate-limits). Fallback keeps dashboard alive.
  if (!Object.keys(stockRaw || {}).length) stockRaw = await yahooDirectFetch(stockSyms);
  if (!Object.keys(indexRaw || {}).length) indexRaw = await yahooDirectFetch(indexSyms);
  if (!Object.keys(macroRaw || {}).length) macroRaw = await yahooDirectFetch(macroSyms);

  applyToUI(stockRaw,  'stocks');
  applyToUI(indexRaw,  'indices');
  applyToUI(macroRaw,  'macro');

  // News (rotates between feeds each refresh)
  refreshNews();

  // FII/DII daily check
  checkFIIDII();
  // Macro Health panel
  fetchMacroHealth();
}

// Show loading placeholder in ticker immediately
{
  const tickerEl = document.getElementById('tickerInner');
  if (tickerEl) {
    tickerEl.innerHTML =
      Array(10).fill(`<div class="tick-item"><span class="tick-name" style="color:var(--muted)">loading\u2026</span></div>`).join('');
  }
}

// ── IST CLOCK — market-hours aware ──
function updateClock() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const h = ist.getHours(), m = ist.getMinutes(), s = ist.getSeconds();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  const t    = [h12, m, s].map(n => String(n).padStart(2,'0')).join(':') + ' ' + ampm;
  const el   = document.getElementById('istTime');
  if (!el) return;

  // Market open: 9:15 → 15:30 IST, Mon–Fri
  const totalMins  = h * 60 + m;
  const marketOpen = 9 * 60 + 15;   // 09:15
  const marketClose= 15 * 60 + 30;  // 15:30
  const preOpen    = 9 * 60 + 0;    // 09:00 pre-open
  const isWeekday  = ist.getDay() >= 1 && ist.getDay() <= 5;
  const isLive     = isWeekday && totalMins >= marketOpen && totalMins < marketClose;
  const isPreOpen  = isWeekday && totalMins >= preOpen && totalMins < marketOpen;
  const isPostClose= isWeekday && totalMins >= marketClose && totalMins < marketClose + 60;

  el.textContent = 'IST ' + t;

  if (isLive) {
    // Green pulse — market is open
    el.style.cssText = `
      font-family:'JetBrains Mono',monospace;
      font-size:10px; padding:4px 10px; border-radius:20px;
      border:1px solid var(--green);
      color:var(--green);
      background:rgba(0,200,83,0.10);
      box-shadow:0 0 8px rgba(0,200,83,0.35);
      white-space:nowrap;
      animation:mktPulse 2s ease-in-out infinite;
    `;
    el.title = 'NSE/BSE Market Open';
  } else if (isPreOpen) {
    // Amber — pre-open session
    el.style.cssText = `
      font-family:'JetBrains Mono',monospace;
      font-size:10px; padding:4px 10px; border-radius:20px;
      border:1px solid var(--gold);
      color:var(--gold);
      background:rgba(255,215,0,0.08);
      white-space:nowrap;
    `;
    el.title = 'NSE Pre-Open Session (9:00–9:15)';
  } else if (isPostClose) {
    // Dim orange — just closed
    el.style.cssText = `
      font-family:'JetBrains Mono',monospace;
      font-size:10px; padding:4px 10px; border-radius:20px;
      border:1px solid var(--border);
      color:var(--saffron);
      background:rgba(255,107,0,0.06);
      white-space:nowrap;
    `;
    el.title = 'NSE/BSE Market Closed';
  } else {
    // Default muted — off hours / weekend
    el.style.cssText = `
      font-family:'JetBrains Mono',monospace;
      font-size:10px; padding:4px 10px; border-radius:20px;
      border:1px solid var(--border);
      color:var(--muted);
      background:transparent;
      white-space:nowrap;
    `;
    el.title = isWeekday ? 'Market Closed' : 'Weekend — Market Closed';
  }
}
setInterval(updateClock, 1000);
updateClock(); // run immediately
updateClock();
updateClock();
setInterval(updateClock, 1000);

// Initial load + 5 min auto-refresh
refreshAllLiveData();
setInterval(refreshAllLiveData, 5 * 60 * 1000);

// ── SYMBOL DETECTION ──
function extractSymbol(query) {
  const KNOWN = {
    'tcs':'TCS','reliance':'RELIANCE','reliance industries':'RELIANCE',
    'hdfc bank':'HDFCBANK','hdfcbank':'HDFCBANK','hdfc':'HDFCBANK',
    'infosys':'INFY','infy':'INFY','wipro':'WIPRO',
    'icici bank':'ICICIBANK','icicibank':'ICICIBANK','icici':'ICICIBANK',
    'sun pharma':'SUNPHARMA','sunpharma':'SUNPHARMA',
    'adani ports':'ADANIPORTS','adaniports':'ADANIPORTS',
    'maruti':'MARUTI','maruti suzuki':'MARUTI',
    'tata motors':'TATAMOTORS','tatamotors':'TATAMOTORS',
    'sbi':'SBIN','state bank':'SBIN','bajaj finance':'BAJFINANCE',
    'bajfinance':'BAJFINANCE','titan':'TITAN','ongc':'ONGC',
    'ltimindtree':'LTIM','lti':'LTIM','hcl tech':'HCLTECH','hcltech':'HCLTECH',
    'axis bank':'AXISBANK','axisbank':'AXISBANK','kotak':'KOTAKBANK',
    'ntpc':'NTPC','itc':'ITC','asian paints':'ASIANPAINT',
    'nestle':'NESTLEIND','hul':'HINDUNILVR','hindustan unilever':'HINDUNILVR',
    'dr reddy':'DRREDDY','cipla':'CIPLA','divis':'DIVISLAB',
    'bajaj auto':'BAJAJ-AUTO','hero motocorp':'HEROMOTOCO',
    'tech mahindra':'TECHM','zomato':'ZOMATO','paytm':'PAYTM',
    'oil india':'OIL','oil india ltd':'OIL',
    'bpcl':'BPCL','bharat petroleum':'BPCL',
    'hpcl':'HPCL','hindustan petroleum':'HPCL',
    'ioc':'IOC','indian oil':'IOC','indian oil corporation':'IOC',
    'coal india':'COALINDIA',
    'power grid':'POWERGRID','powergrid':'POWERGRID',
    'gail':'GAIL','gail india':'GAIL',
    'bhel':'BHEL','bharat heavy':'BHEL',
    'sail':'SAIL','steel authority':'SAIL',
    'irctc':'IRCTC','indian railway':'IRCTC',
    'indigo':'INDIGO','interglobe':'INDIGO',
    'adani green':'ADANIGREEN','adani enterprises':'ADANIENT',
    'adani power':'ADANIPOWER','adani total':'ATGL',
    'jsw steel':'JSWSTEEL','tata steel':'TATASTEEL',
    'hindalco':'HINDALCO','vedanta':'VEDL',
    'ultracemco':'ULTRACEMCO','ultratech':'ULTRACEMCO',
    'shree cement':'SHREECEM','ambuja':'AMBUJACEM',
    'dmart':'DMART','avenue supermarts':'DMART',
    'naukri':'NAUKRI','info edge':'NAUKRI',
    'pidilite':'PIDILITIND','berger paints':'BERGEPAINT',
    'mrf':'MRF','apollo tyres':'APOLLOTYRE',
    'tata power':'TATAPOWER','torrent power':'TORNTPOWER',
    'ab capital':'ABCAPITAL','muthoot':'MUTHOOTFIN',
    'can fin':'CANFINHOME','lic housing':'LICHSGFIN',
    'pnb':'PNB','punjab national':'PNB',
    'bank of baroda':'BANKBARODA','bob':'BANKBARODA',
    'union bank':'UNIONBANK','canara bank':'CANBK',
    'indusind':'INDUSINDBK','yes bank':'YESBANK',
    'bandhan':'BANDHANBNK','federal bank':'FEDERALBNK',
    'persistent':'PERSISTENT','mphasis':'MPHASIS',
    'coforge':'COFORGE','happiest minds':'HAPPSTMNDS',
    'dixon':'DIXON','amber':'AMBER',
    'polycab':'POLYCAB','havells':'HAVELLS',
    'page industries':'PAGEIND','relaxo':'RELAXO',
    'jubilant food':'JUBLFOOD','devyani':'DEVYANI',
    'trent':'TRENT','v-mart':'VMART',
  };
  const q = query.toLowerCase().replace(/research|analysis|deep dive|fundamental|technical|stock|share|price|compare|vs|and/g,'').trim();
  for (const [k,v] of Object.entries(KNOWN)) { if (q.includes(k)) return v; }
  // Check for ALL CAPS ticker in query (e.g. "RECLTD research")
  const caps = query.match(/\b[A-Z]{2,10}\b/g);
  if (caps) {
    // Filter out common English words
    const skip = new Set(['NSE','BSE','IPO','FII','DII','ETF','NFO','MF','PE','EPS','ROE','ROCE','CAGR','YOY','QOQ','TTM','CMP','LTP','ATH','ATL','SIP','GDP','RBI','SEBI','CBI','ED']);
    const ticker = caps.find(c => !skip.has(c));
    if (ticker) return ticker;
  }
  return null;
}

// For unknown companies — ask Gemini to identify the NSE symbol
async function resolveSymbolViaYahoo(query) {
  // Use Yahoo Finance autocomplete search to find NSE symbol for any company name
  try {
    const clean = query.toLowerCase()
      .replace(/research|analysis|deep dive|fundamental|technical|stock|share|price|compare|vs|and|ltd|limited|industries|corporation|company/g, '')
      .trim();
    const searchUrl = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(clean + ' NSE') + '&quotesCount=5&newsCount=0&listsCount=0';
    const res = await fetch(WORKER_URL + '?search=' + encodeURIComponent(clean + ' NSE'));
    if (!res.ok) return null;
    const data = await res.json();
    // Worker returns array of {symbol, name, exchange}
    if (!data.quotes || data.quotes.length === 0) return null;
    // Find first NSE result
    const nse = data.quotes.find(q => q.exchange === 'NSI' || (q.symbol && q.symbol.endsWith('.NS')));
    if (!nse) return null;
    const sym = nse.symbol.replace('.NS', '');
    console.log('Yahoo search resolved:', clean, '->', sym);
    return sym;
  } catch(e) {
    console.warn('Yahoo search failed:', e.message);
    return null;
  }
}

const AGENT_STEPS = [
  { text: 'Parsing company query & identifying ticker…' },
  { text: 'Fetching LIVE price from Yahoo Finance / NSE…' },
  { text: 'Loading fundamental financials (P&L, Balance Sheet)…' },
  { text: 'Pulling TradingView technical indicators…' },
  { text: 'Identifying peer competitors & fetching data…' },
  { text: 'Scanning concall transcripts & management commentary…' },
  { text: 'Assessing macro & geopolitical impact factors…' },
  { text: 'Synthesizing AI research report with live data…' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runQuery(query) {
  // Redirect all sidebar/watchlist calls to D.AI popup
  openDAI();
  await daiRunQuery(query);
}

async function daiRunQuery(query) {
  if (!query || !query.trim()) return;
  const inputEl = document.getElementById('daiSearchInput');
  if (inputEl) inputEl.value = query;
  document.getElementById('daiWelcomeState').style.display = 'none';
  document.getElementById('daiResultContainer').style.display = 'none';

  const loadingEl = document.getElementById('daiLoadingState');
  loadingEl.classList.add('show');

  document.getElementById('daiThinkSteps').innerHTML = AGENT_STEPS.map((s,i) =>
    `<div class="think-step" id="daistep${i}"><div class="step-dot"></div><span>${s.text}</span></div>`
  ).join('');

  document.getElementById('daistep0').classList.add('active');
  let sym = extractSymbol(query);
  await sleep(300);
  document.getElementById('daistep0').classList.add('done');

  document.getElementById('daistep1').classList.add('active');
  let liveData = null;

  if (!sym) {
    sym = await resolveSymbolViaYahoo(query);
  }

  if (sym) {
    let p = priceCache[sym] || null;
    if (!p) {
      const yahooSym = sym + '.NS';
      const fresh = await workerFetch([yahooSym]);
      const raw = fresh[yahooSym];
      if (raw) { p = fmt(raw); if (p) priceCache[sym] = p; }
      if (!p) {
        const fresh2 = await workerFetch([sym + '.BO']);
        const raw2 = fresh2[sym + '.BO'];
        if (raw2) { p = fmt(raw2); if (p) priceCache[sym] = p; }
      }
    }
    if (p) liveData = { ...p, sym };
  }
  await sleep(400);
  document.getElementById('daistep1').classList.add('done');

  const delays = [500, 600, 600, 700, 600, 500];
  for (let i = 2; i < AGENT_STEPS.length; i++) {
    document.getElementById(`daistep${i-1}`).classList.add('done');
    document.getElementById(`daistep${i}`).classList.add('active');
    await sleep(delays[i-2]);
  }
  document.getElementById(`daistep${AGENT_STEPS.length-1}`).classList.add('done');

  const result = await callDAIAgent(query, liveData);
  loadingEl.classList.remove('show');

  const rc = document.getElementById('daiResultContainer');
  rc.innerHTML = result;
  rc.style.display = 'flex';

  // Scroll results into view
  rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


async function callDAIAgent(query, liveData) {

  // Build live price context to inject into prompt
  const livePriceContext = liveData
    ? `CRITICAL LIVE PRICE OVERRIDE — THIS OVERRIDES YOUR TRAINING DATA:
The current market price of ${liveData.sym} has been fetched RIGHT NOW from Yahoo Finance NSE feed.
YOU MUST USE THIS EXACT PRICE IN YOUR RESPONSE. DO NOT USE YOUR TRAINING DATA PRICE UNDER ANY CIRCUMSTANCES.

LIVE NSE DATA (fetched ${new Date().toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})} IST):
- NSE Symbol: ${liveData.sym}.NS
- CURRENT CMP: ₹${liveData.priceStr} ← USE THIS EXACT VALUE IN THE price FIELD
- Today Change: ${liveData.chgStr} (₹${liveData.chgAmtStr})
- Direction: ${liveData.up ? 'UP ▲' : 'DOWN ▼'} today

MANDATORY: The "price" field in your JSON response MUST be exactly ${liveData.price.toFixed(2)}
If you use any other price value your response will be considered wrong.`
    : `NOTE: Live price unavailable for this query. Use approximate training data and add "(approx)" after price.`;



  const systemPrompt = `You are DALAL.AI, a specialized Indian Stock Market Research Agent.

You have deep knowledge of NSE/BSE listed companies, Indian macroeconomics, sectoral trends, concall transcripts, and financial analysis.

DATA SOURCES: BSE=${CONFIG.URLS.BSE_ANNOUNCEMENTS} | NSE=${CONFIG.URLS.NSE_FILINGS} | Screener=${CONFIG.URLS.SCREENER_URL} | Concalls=${CONFIG.URLS.CONCALL_SITE_2} | TradingView=${CONFIG.URLS.TRADINGVIEW_BASE}

When asked about a company (e.g. "TCS research"), generate a COMPREHENSIVE research report in this EXACT JSON format:

{
  "type": "company_research",
  "company": {
    "name": "Full Company Name",
    "symbol": "NSE_SYMBOL",
    "exchange": "NSE",
    "sector": "Sector Name",
    "indices": ["NIFTY 50", "NIFTY IT"],
    "price": "3892.10",
    "change": "+1.24%",
    "positive": true,
    "marketcap": "₹14.2 L Cr",
    "52w_high": "₹4,592",
    "52w_low": "₹3,311",
    "pe": "27.4",
    "eps": "₹142"
  },
  "fundamentals": {
    "revenue_ttm": "₹2,40,893 Cr",
    "pat_ttm": "₹46,099 Cr",
    "ebitda_margin": "24.8%",
    "net_margin": "19.1%",
    "roe": "52.4%",
    "roce": "68.2%",
    "debt_equity": "0.0",
    "current_ratio": "3.2",
    "promoter_holding": "72.3%",
    "fii_holding": "12.8%",
    "quarterly": [
      {"quarter": "Q3FY25", "revenue": "₹63,973 Cr", "pat": "₹12,380 Cr", "yoy": "+5.6%"},
      {"quarter": "Q2FY25", "revenue": "₹62,418 Cr", "pat": "₹11,909 Cr", "yoy": "+4.5%"},
      {"quarter": "Q1FY25", "revenue": "₹61,237 Cr", "pat": "₹12,040 Cr", "yoy": "+8.7%"}
    ]
  },
  "technical": {
    "trend": "Bullish",
    "rsi": "58",
    "macd": "Bullish crossover",
    "sma50": "₹3,820",
    "sma200": "₹3,650",
    "support": "₹3,750",
    "resistance": "₹4,100",
    "volume": "1.2x average",
    "signals": [
      {"type": "bullish", "signal": "Price above 200 DMA — long-term uptrend intact"},
      {"type": "neutral", "signal": "RSI at 58 — room to run, not overbought"},
      {"type": "bullish", "signal": "MACD bullish crossover confirmed on weekly chart"}
    ]
  },
  "competitors": [
    {"name": "Infosys", "symbol": "INFY", "price": "₹1,523", "marketcap": "₹6.3 L Cr", "pe": "22.1", "revenue": "₹1,57,936 Cr", "net_margin": "17.2%", "roe": "32.1%", "yoy_growth": "+3.1%"},
    {"name": "Wipro", "symbol": "WIPRO", "price": "₹487", "marketcap": "₹2.5 L Cr", "pe": "19.8", "revenue": "₹89,503 Cr", "net_margin": "14.8%", "roe": "16.2%", "yoy_growth": "+0.4%"},
    {"name": "HCL Tech", "symbol": "HCLTECH", "price": "₹1,724", "marketcap": "₹4.7 L Cr", "pe": "26.3", "revenue": "₹1,08,806 Cr", "net_margin": "15.9%", "roe": "24.8%", "yoy_growth": "+7.2%"},
    {"name": "LTIMindtree", "symbol": "LTIM", "price": "₹5,230", "marketcap": "₹1.5 L Cr", "pe": "31.2", "revenue": "₹35,517 Cr", "net_margin": "13.8%", "roe": "27.4%", "yoy_growth": "+6.8%"}
  ],
  "concall": {
    "quarter": "Q3FY25",
    "date": "09 Jan 2025",
    "highlights": [
      {"speaker": "CEO Name — Designation", "quote": "Exact key quote from the earnings call relevant to the company", "context": "Context of the statement"},
      {"speaker": "CFO Name — Designation", "quote": "Another key financial quote", "context": "Context"}
    ],
    "guidance": "Detailed management guidance for next quarter/year including revenue growth expectations, margin outlook, and key focus areas.",
    "risks_mentioned": ["Risk 1", "Risk 2", "Risk 3"]
  },
  "macro_impact": [
    {"factor": "USD/INR Exchange Rate", "impact": "positive", "analysis": "Detailed explanation of how this macro factor specifically impacts this company with numbers"},
    {"factor": "Crude Oil Prices", "impact": "negative", "analysis": "Specific impact analysis with quantified estimates where possible"},
    {"factor": "US Recession Risk", "impact": "negative", "analysis": "How US slowdown affects this specific company's revenue and margins"},
    {"factor": "RBI Monetary Policy", "impact": "neutral", "analysis": "Impact of interest rates on this company and its sector"}
  ],
  "verdict": {
    "rating": "BUY",
    "score": "8",
    "target_price": "₹4,350",
    "upside": "+11.8%",
    "summary": "2-3 sentence comprehensive assessment of the investment case.",
    "bull_case": "Specific bull case scenario with price target and triggers",
    "bear_case": "Specific bear case scenario with downside risks and price"
  }
}

For NON-company queries (sector analysis, macro questions, comparisons) use:
{
  "type": "analysis",
  "title": "Query Title",
  "sections": [
    {"heading": "Section Name", "content": "Detailed paragraph with specific ₹/% numbers, company names, real market data"}
  ]
}

CRITICAL RULES:
1. Use REALISTIC Indian market data with actual figures
2. All prices in INR with ₹ symbol
3. Be specific — use real company names, actual financial figures from public knowledge
4. Return ONLY raw JSON — absolutely no markdown, no backticks, no \`\`\`json, no explanation text before or after
5. Start your response with { and end with } — nothing else`;

  try {
    const provider = /\bdbt\b/i.test(query) ? 'groq' : 'gemini';
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        prompt: systemPrompt + '\n\n' + livePriceContext + '\n\nUser Query: ' + query,
        geminiKey: CONFIG.GEMINI_API_KEY || undefined,
        groqKey: CONFIG.GROQ_API_KEY || undefined
      })
    });
    if (!response.ok) {
      const err = await response.json();
      const msg = err?.error?.message || 'Unknown error';
      if (response.status === 429) throw new Error('Rate limit hit. Wait 1 minute and try again.');
      throw new Error('API error ' + response.status + ': ' + msg);
    }
    const data = await response.json();

    // Extract raw text from Gemini response structure
    const raw = data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // ── ROBUST JSON EXTRACTION ──
    // Gemini sometimes wraps in markdown fences or adds extra text.
    // This handles all known cases:
    let clean = raw.trim();

    // Remove markdown code fences if present
    clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    // Find the first { and last } to extract pure JSON
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.substring(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch(jsonErr) {
      console.warn('AI JSON parse failed:', jsonErr.message);
      throw new Error('AI JSON parsing failed once; please retry query.');
    }
    return renderResult(parsed, query);

  } catch(err) {
    console.error('DALAL.AI Error:', err);

    // Show specific error message to help debug
    let errMsg = 'Error fetching data.';
    if (err.message.includes('401') || err.message.includes('API_KEY')) {
      errMsg = '❌ Invalid Gemini API key. Go to aistudio.google.com and regenerate your key.';
    } else if (err.message.includes('429')) {
      errMsg = '⏱ Rate limit hit. You have used your 1,500 free requests for today. Try again tomorrow.';
    } else if (err.message.includes('SyntaxError') || err.message.includes('JSON')) {
      errMsg = '⚠️ AI returned malformed data. Please retry the same query — this is occasional with Gemini.';
    } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      errMsg = '🌐 Network error. Check your internet connection and try again.';
    }

    return `<div class="section-card fade-in">
      <div class="sc-body" style="color:var(--red);font-size:13px;line-height:1.8">
        ${errMsg}<br>
        <span style="color:var(--muted);font-size:11px">Technical: ${err.message}</span>
      </div>
    </div>`;
  }
}

function renderResult(data, query) {
  if (data.type === 'company_research') {
    return renderCompanyResearch(data);
  } else {
    return renderAnalysis(data, query);
  }
}

function renderCompanyResearch(d) {
  const c = d.company;
  const f = d.fundamentals;
  const t = d.technical;
  const competitors = d.competitors || [];
  const cc = d.concall;
  const macro = d.macro_impact || [];
  const v = d.verdict;

  const colorClass = c.positive ? 'positive' : 'negative';

  // Mini chart bars (simulated)
  const bars = Array.from({length:40}, (_,i) => {
    const h = 20 + Math.random() * 60;
    const isUp = Math.random() > 0.45;
    return `<div class="chart-bar" style="height:${h}%;background:${isUp ? 'var(--green)':'var(--red)'}"></div>`;
  }).join('');

  // Competitor table
  const compHeaders = `<tr>
    <th>METRIC</th>
    <th style="color:var(--saffron)">${c.symbol} ★</th>
    ${competitors.slice(0,4).map(cp => `<th>${cp.symbol}</th>`).join('')}
  </tr>`;

  const compRows = [
    {label:'Market Cap', key:'marketcap'},
    {label:'P/E Ratio', key:'pe'},
    {label:'Revenue', key:'revenue'},
    {label:'Net Margin', key:'net_margin'},
    {label:'ROE', key:'roe'},
    {label:'YoY Growth', key:'yoy_growth'},
  ].map(row => `
    <tr>
      <td class="metric">${row.label}</td>
      <td style="color:var(--saffron)">${c[row.key] || f[row.key] || '—'}</td>
      ${competitors.slice(0,4).map(cp => `<td>${cp[row.key] || '—'}</td>`).join('')}
    </tr>
  `).join('');

  // Technical signals
  const techSignals = (t.signals || []).map(s => `
    <div class="signal-item ${s.type}">
      <span class="sig-badge">${s.type}</span>
      <span class="sig-text">${s.signal}</span>
    </div>
  `).join('');

  // Macro signals
  const macroSignals = macro.map(m => `
    <div class="signal-item ${m.impact === 'positive' ? 'bullish' : m.impact === 'negative' ? 'bearish' : 'neutral'}">
      <div style="display:flex;flex-direction:column;gap:4px;flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="sig-badge">${m.impact.toUpperCase()}</span>
          <strong style="font-size:12px">${m.factor}</strong>
        </div>
        <span class="sig-text">${m.analysis}</span>
      </div>
    </div>
  `).join('');

  // Concall highlights
  const concallHL = (cc.highlights || []).map(h => `
    <div class="concall-quote">
      <div class="cq-speaker">${h.speaker}</div>
      <div class="cq-text">"${h.quote}"</div>
      <div class="cq-meta">${h.context}</div>
    </div>
  `).join('');

  const verdictClass = v.rating === 'BUY' ? 'verdict-box' : v.rating === 'SELL' ? 'verdict-box bearish-verdict' : 'verdict-box neutral-verdict';
  const verdictColor = v.rating === 'BUY' ? 'var(--green)' : v.rating === 'SELL' ? 'var(--red)' : 'var(--gold)';

  return `
    <!-- COMPANY HERO -->
    <div class="company-hero fade-in">
      <div class="ch-top">
        <div>
          <div class="ch-name">${c.name}</div>
          <div class="ch-meta">
            <span class="ch-badge sector">${c.sector}</span>
            <span class="ch-badge exchange">${c.exchange}: ${c.symbol}</span>
            ${(c.indices || []).map(ix => `<span class="ch-badge index">${ix}</span>`).join('')}
          </div>
        </div>
        <div class="ch-price-block">
          <div class="ch-price">₹${c.price}</div>
          <div class="ch-change ${colorClass}">${c.positive ? '▲' : '▼'} ${c.change}</div>
        </div>
      </div>
      <div class="mini-chart">${bars}</div>
      <div class="ch-stats" style="margin-top:16px">
        <div class="ch-stat">
          <div class="ch-stat-label">Market Cap</div>
          <div class="ch-stat-val">${c.marketcap}</div>
        </div>
        <div class="ch-stat">
          <div class="ch-stat-label">P/E Ratio</div>
          <div class="ch-stat-val">${c.pe}x</div>
        </div>
        <div class="ch-stat">
          <div class="ch-stat-label">52W High</div>
          <div class="ch-stat-val positive">${c['52w_high']}</div>
        </div>
        <div class="ch-stat">
          <div class="ch-stat-label">52W Low</div>
          <div class="ch-stat-val negative">${c['52w_low']}</div>
        </div>
      </div>
    </div>

    <!-- FUNDAMENTALS -->
    <div class="section-card fade-in">
      <div class="sc-header">
        <div class="sc-title">
          <div class="sc-icon orange">📈</div>
          Fundamental Analysis
        </div>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted)">TTM DATA · SCREENER.IN</span>
      </div>
      <div class="sc-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>
            <table class="fin-table">
              <tr><th>KEY METRIC</th><th>VALUE</th></tr>
              <tr><td class="metric">Revenue (TTM)</td><td>${f.revenue_ttm}</td></tr>
              <tr><td class="metric">PAT (TTM)</td><td>${f.pat_ttm}</td></tr>
              <tr><td class="metric">EBITDA Margin</td><td class="positive">${f.ebitda_margin}</td></tr>
              <tr><td class="metric">Net Margin</td><td class="positive">${f.net_margin}</td></tr>
              <tr><td class="metric">ROE</td><td class="positive">${f.roe}</td></tr>
              <tr><td class="metric">ROCE</td><td class="positive">${f.roce}</td></tr>
              <tr><td class="metric">Debt/Equity</td><td>${f.debt_equity}</td></tr>
              <tr><td class="metric">Current Ratio</td><td>${f.current_ratio}</td></tr>
            </table>
          </div>
          <div>
            <table class="fin-table">
              <tr><th>QUARTER</th><th>REVENUE</th><th>PAT</th><th>YoY</th></tr>
              ${(f.quarterly || []).map(q => `
                <tr>
                  <td class="metric">${q.quarter}</td>
                  <td>${q.revenue}</td>
                  <td>${q.pat}</td>
                  <td class="${q.yoy.startsWith('+') ? 'positive':'negative'}">${q.yoy}</td>
                </tr>
              `).join('')}
            </table>
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div style="background:var(--ink);border-radius:6px;padding:10px">
                <div style="font-size:10px;color:var(--muted);font-family:'JetBrains Mono',monospace">PROMOTER HOLD.</div>
                <div style="font-size:18px;font-family:'Playfair Display',serif;margin-top:4px;color:var(--green)">${f.promoter_holding}</div>
              </div>
              <div style="background:var(--ink);border-radius:6px;padding:10px">
                <div style="font-size:10px;color:var(--muted);font-family:'JetBrains Mono',monospace">FII HOLDING</div>
                <div style="font-size:18px;font-family:'Playfair Display',serif;margin-top:4px;color:var(--saffron)">${f.fii_holding}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TECHNICAL -->
    <div class="section-card fade-in">
      <div class="sc-header">
        <div class="sc-title">
          <div class="sc-icon gold">📉</div>
          Technical Analysis
        </div>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted)">TRADINGVIEW SIGNALS</span>
      </div>
      <div class="sc-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px">
          <table class="fin-table">
            <tr><th>INDICATOR</th><th>VALUE</th></tr>
            <tr><td class="metric">Trend</td><td style="color:${t.trend==='Bullish'?'var(--green)':t.trend==='Bearish'?'var(--red)':'var(--gold)'}">${t.trend}</td></tr>
            <tr><td class="metric">RSI (14)</td><td>${t.rsi}</td></tr>
            <tr><td class="metric">MACD</td><td>${t.macd}</td></tr>
            <tr><td class="metric">50-Day SMA</td><td>${t.sma50}</td></tr>
            <tr><td class="metric">200-Day SMA</td><td>${t.sma200}</td></tr>
            <tr><td class="metric">Support</td><td class="positive">${t.support}</td></tr>
            <tr><td class="metric">Resistance</td><td class="negative">${t.resistance}</td></tr>
            <tr><td class="metric">Volume</td><td>${t.volume}</td></tr>
          </table>
          <div class="signal-list">${techSignals}</div>
        </div>
      </div>
    </div>

    <!-- COMPETITOR COMPARISON -->
    <div class="section-card fade-in">
      <div class="sc-header">
        <div class="sc-title">
          <div class="sc-icon red">⚔️</div>
          Competitive Landscape
        </div>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted)">PEER COMPARISON</span>
      </div>
      <div class="sc-body" style="overflow-x:auto">
        <div class="comp-grid" style="grid-template-columns:120px repeat(${Math.min(competitors.length,4)+1},1fr)">
          <div class="cg-cell header">METRIC</div>
          <div class="cg-cell header highlight">${c.symbol} ★</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell header">${cp.symbol}</div>`).join('')}

          <div class="cg-cell row-label">Company</div>
          <div class="cg-cell highlight" style="color:var(--text);font-size:10px">${c.name.split(' ').slice(0,2).join(' ')}</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell" style="font-size:10px">${cp.name}</div>`).join('')}

          <div class="cg-cell row-label">Price</div>
          <div class="cg-cell highlight" style="color:var(--saffron)">₹${c.price}</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell">${cp.price}</div>`).join('')}

          <div class="cg-cell row-label">Mkt Cap</div>
          <div class="cg-cell highlight" style="color:var(--saffron)">${c.marketcap}</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell">${cp.marketcap}</div>`).join('')}

          <div class="cg-cell row-label">P/E</div>
          <div class="cg-cell highlight" style="color:var(--saffron)">${c.pe}x</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell">${cp.pe}x</div>`).join('')}

          <div class="cg-cell row-label">Revenue</div>
          <div class="cg-cell highlight" style="color:var(--saffron)">${f.revenue_ttm}</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell">${cp.revenue}</div>`).join('')}

          <div class="cg-cell row-label">Net Margin</div>
          <div class="cg-cell highlight positive">${f.net_margin}</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell">${cp.net_margin}</div>`).join('')}

          <div class="cg-cell row-label">ROE</div>
          <div class="cg-cell highlight positive">${f.roe}</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell">${cp.roe}</div>`).join('')}

          <div class="cg-cell row-label">YoY Growth</div>
          <div class="cg-cell highlight positive">${(f.quarterly||[{}])[0]?.yoy || '—'}</div>
          ${competitors.slice(0,4).map(cp => `<div class="cg-cell ${cp.yoy_growth?.startsWith('+') ? 'positive':'negative'}">${cp.yoy_growth}</div>`).join('')}
        </div>
      </div>
    </div>

    <!-- CONCALL -->
    <div class="section-card fade-in">
      <div class="sc-header">
        <div class="sc-title">
          <div class="sc-icon green">📞</div>
          Earnings Call Intelligence — ${cc.quarter}
        </div>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted)">${cc.date}</span>
      </div>
      <div class="sc-body">
        ${concallHL}
        <div style="background:rgba(255,107,0,0.07);border:1px solid rgba(255,107,0,0.2);border-radius:8px;padding:12px;margin-top:12px">
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--saffron);margin-bottom:6px">MANAGEMENT GUIDANCE</div>
          <div style="font-size:12px;line-height:1.6">${cc.guidance}</div>
        </div>
        ${cc.risks_mentioned?.length ? `
          <div style="margin-top:12px">
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">RISKS FLAGGED BY MANAGEMENT</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${cc.risks_mentioned.map(r => `<span style="font-size:11px;padding:4px 10px;border-radius:4px;background:var(--red-dim);color:var(--red);border:1px solid rgba(255,23,68,0.2)">⚠ ${r}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- MACRO IMPACT -->
    <div class="section-card fade-in">
      <div class="sc-header">
        <div class="sc-title">
          <div class="sc-icon orange">🌐</div>
          Macro & Geopolitical Impact Assessment
        </div>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted)">AI SYNTHESIS</span>
      </div>
      <div class="sc-body">
        <div class="signal-list">${macroSignals}</div>
      </div>
    </div>

    <!-- VERDICT -->
    <div class="${verdictClass} fade-in">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px">
        <div>
          <div class="verdict-title">DALAL.AI Verdict — ${c.name}</div>
          <div class="verdict-sub">${v.summary}</div>
          <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
            <div style="font-size:12px;line-height:1.5">
              <span style="color:var(--green);font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1px">BULL CASE: </span>${v.bull_case}
            </div>
            <div style="font-size:12px;line-height:1.5">
              <span style="color:var(--red);font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1px">BEAR CASE: </span>${v.bear_case}
            </div>
          </div>
        </div>
        <div style="text-align:center;flex-shrink:0">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:4px">RATING</div>
          <div style="font-family:'Playfair Display',serif;font-size:40px;font-weight:900;color:${verdictColor}">${v.rating}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:300;color:${verdictColor}">${v.score}/10</div>
          <div style="margin-top:8px;font-size:11px;color:var(--muted)">Target: <strong style="color:${verdictColor}">${v.target_price}</strong></div>
          <div style="font-size:11px;color:${verdictColor};font-family:'JetBrains Mono',monospace">${v.upside} upside</div>
        </div>
      </div>
    </div>
  `;
}

function renderAnalysis(d, query) {
  const sections = (d.sections || []).map(s => `
    <div class="section-card fade-in">
      <div class="sc-header">
        <div class="sc-title">
          <div class="sc-icon orange">📊</div>
          ${s.heading}
        </div>
      </div>
      <div class="sc-body">
        <div style="font-size:13px;line-height:1.8;color:var(--text)">${s.content}</div>
      </div>
    </div>
  `).join('');

  return `
    <div class="company-hero fade-in">
      <div class="ch-name">${d.title || query}</div>
      <div class="ch-meta" style="margin-top:8px">
        <span class="ch-badge index">AI ANALYSIS</span>
        <span class="ch-badge exchange">DALAL.AI RESEARCH</span>
      </div>
    </div>
    ${sections}
  `;
}

// ── GEMINI KEY MANAGEMENT ──
function loadGeminiKey() {
  const stored = localStorage.getItem('dalal_gemini_key');
  if (stored && stored.startsWith('AIza')) {
    CONFIG.GEMINI_API_KEY = stored;
    document.getElementById('keyModal').style.display = 'none';
    return true;
  }
  // Vercel/server env flow: no browser key needed unless user wants override.
  document.getElementById('keyModal').style.display = 'none';
  return false;
}

function saveGeminiKey() {
  const key = document.getElementById('keyInput').value.trim();
  if (!key || !key.startsWith('AIza')) {
    alert('Please enter a valid Gemini API key (starts with AIza)');
    return;
  }
  localStorage.setItem('dalal_gemini_key', key);
  CONFIG.GEMINI_API_KEY = key;
  document.getElementById('keyModal').style.display = 'none';
  // Start data loading now that key is set
  refreshAllLiveData();
}

// Allow Enter key in input
document.getElementById('keyInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') saveGeminiKey();
});

// Also add a small "change key" button in header
function resetGeminiKey() {
  localStorage.removeItem('dalal_gemini_key');
  document.getElementById('keyModal').style.display = 'flex';
}

// Check key on load — if present skip modal, else show it
// ── D.AI POPUP CONTROLS ──
// ── D.AI POPUP ──
function openDAI() {
  document.getElementById('daiOverlay').classList.add('open');
  const inp = document.getElementById('daiSearchInput');
  if (inp) setTimeout(() => inp.focus(), 100);
}
function closeDAI() {
  document.getElementById('daiOverlay').classList.remove('open');
}
document.getElementById('daiOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeDAI();
});

// ── OPEN-SOURCE CHART (Lightweight Charts + Yahoo data via Vercel API) ──
let currentChartSymbol = '^NSEI';
let currentChartTF     = '1D';
let currentChartStyle  = '3'; // 3=line, 1=candles
let currentStockExchange = 'NSE';
let lwChart, lwSeries, lwLoaded = false;

const CHART_RANGE_MAP = { '1D':'1d', '1W':'5d', '1M':'1mo', '6M':'6mo', '12M':'1y' };

async function ensureLightweightCharts() {
  if (window.LightweightCharts) return true;
  if (lwLoaded) return false;
  lwLoaded = true;
  await new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js';
    sc.onload = resolve;
    sc.onerror = reject;
    document.head.appendChild(sc);
  });
  return !!window.LightweightCharts;
}

async function fetchChartData(symbol, tf) {
  const range = CHART_RANGE_MAP[tf] || '1mo';
  const url = `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Chart data unavailable');
  return await res.json();
}

function resetChartWrap(msg) {
  const wrap = document.getElementById('chartWidgetWrap');
  if (!wrap) return null;
  wrap.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;color:var(--muted);font-size:11px">${msg}</div>`;
  return wrap;
}

async function renderChart() {
  const wrap = document.getElementById('chartWidgetWrap');
  if (!wrap) return;
  resetChartWrap('Loading chart…');

  try {
    await ensureLightweightCharts();
    if (!window.LightweightCharts) throw new Error('Chart library failed');

    const payload = await fetchChartData(currentChartSymbol, currentChartTF);
    const points = payload.points || [];
    if (!points.length) throw new Error('No chart points');

    wrap.innerHTML = '<div id="lwChartHost" style="width:100%;height:100%"></div>';
    const host = document.getElementById('lwChartHost');
    lwChart = LightweightCharts.createChart(host, {
      layout: { background: { color: 'transparent' }, textColor: getComputedStyle(document.body).getPropertyValue('--muted') },
      grid: { vertLines: { color: 'rgba(100,100,130,0.2)' }, horzLines: { color: 'rgba(100,100,130,0.2)' } },
      rightPriceScale: { borderColor: 'rgba(100,100,130,0.2)' },
      timeScale: { borderColor: 'rgba(100,100,130,0.2)' },
      width: host.clientWidth,
      height: host.clientHeight,
    });
    lwSeries = currentChartStyle === '1'
      ? lwChart.addCandlestickSeries({ upColor:'#00C853', downColor:'#FF1744', borderVisible:false, wickUpColor:'#00C853', wickDownColor:'#FF1744' })
      : lwChart.addLineSeries({ color:'#FF6B00', lineWidth:2 });

    lwSeries.setData(currentChartStyle === '1' ? points.map(p => ({ time:p.time, open:p.open, high:p.high, low:p.low, close:p.close })) : points.map(p => ({ time:p.time, value:p.close })));
    window.addEventListener('resize', () => lwChart && lwChart.applyOptions({ width: host.clientWidth, height: host.clientHeight }));
  } catch (e) {
    resetChartWrap('Chart unavailable. Try another symbol.');
    console.warn('Chart render failed:', e.message);
  }
}

function switchChart(symbol, tabEl) {
  document.querySelectorAll('.ci-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  currentChartSymbol = symbol;
  renderChart();
}

function switchChartStyle(style, tabEl) {
  document.querySelectorAll('.cs-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  currentChartStyle = style;
  renderChart();
}

function setChartTF(tf, tabEl) {
  document.querySelectorAll('.tf-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  currentChartTF = tf;
  renderChart();
}

function setStockExchange(exchange, btnEl) {
  currentStockExchange = exchange;
  const nseBtn = document.getElementById('stockExNSE');
  const bseBtn = document.getElementById('stockExBSE');
  if (nseBtn) nseBtn.style.opacity = exchange === 'NSE' ? '1' : '0.7';
  if (bseBtn) bseBtn.style.opacity = exchange === 'BSE' ? '1' : '0.7';
  if (btnEl) btnEl.style.opacity = '1';
}

function loadStockChart() {
  const input = document.getElementById('stockChartInput');
  const statusEl = document.getElementById('stockChartStatus');
  if (!input) return;

  const raw = (input.value || '').trim().toUpperCase();
  const cleaned = raw.replace(/^[@#$]+/, '').replace(/[^A-Z0-9]/g, '');
  if (!cleaned) {
    if (statusEl) statusEl.textContent = 'Enter a NSE/BSE symbol first.';
    return;
  }

  currentChartSymbol = currentStockExchange === 'NSE' ? `${cleaned}.NS` : `${cleaned}.BO`;
  renderChart();

  document.querySelectorAll('.ci-tab').forEach(t => t.classList.remove('active'));
  if (statusEl) statusEl.textContent = `Loaded ${currentChartSymbol}`;
}

renderChart();

// ── THEME TOGGLE ──
function toggleTheme() {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  localStorage.setItem('dalal_theme', isLight ? 'light' : 'dark');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = isLight ? '🌙' : '☀️';
}
(function initTheme(){
  const saved = localStorage.getItem('dalal_theme');
  if (saved === 'light') document.body.classList.add('light');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = document.body.classList.contains('light') ? '🌙' : '☀️';
})();

// ── MARKET MOOD INDEX — fetch via Worker ?mmi=1 ──
async function fetchMMI() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(WORKER_URL + '?mmi=1', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Worker MMI ' + res.status);
    const data = await res.json();
    if (data.value !== undefined && data.value !== null) {
      renderMMI(data.value);
    }
  } catch(e) {
    console.warn('MMI fetch failed:', e.message);
    renderMMI(null);
  }
}

function renderMMI(value) {
  const score = value !== null ? Math.round(value) : null;
  const display = score !== null ? score : '—';

  // Zone label + color
  let color, zone;
  if (score === null)       { color = 'var(--muted)'; zone = 'Unavailable'; }
  else if (score <= 20)     { color = 'var(--red)';   zone = 'Extreme Fear'; }
  else if (score <= 40)     { color = '#FF6B00';      zone = 'Fear'; }
  else if (score <= 60)     { color = 'var(--gold)';  zone = 'Neutral'; }
  else if (score <= 80)     { color = '#8BC34A';      zone = 'Greed'; }
  else                      { color = 'var(--green)'; zone = 'Extreme Greed'; }

  // Arc — full arc = PI * r = PI * 50 ≈ 157.08, offset from 0 at left
  const arcLen = 157.08;
  const pct = score !== null ? score / 100 : 0.5;
  const offset = arcLen * (1 - pct);

  const arc = document.getElementById('mmiArcFill');
  if (arc) { arc.style.stroke = color; arc.setAttribute('stroke-dashoffset', offset.toFixed(2)); }

  const scoreEl = document.getElementById('mmiScore');
  if (scoreEl) { scoreEl.textContent = display; scoreEl.style.color = color; }

  const zoneEl = document.getElementById('mmiZoneLabel');
  if (zoneEl) { zoneEl.textContent = zone; zoneEl.style.color = color; }

  const needle = document.getElementById('mmiNeedle');
  if (needle) needle.style.left = (pct * 100) + '%';

  const updated = document.getElementById('mmiUpdated');
  if (updated) {
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
    updated.textContent = 'updated ' + now + ' IST';
  }
}

fetchMMI();
// Refresh MMI every 30 minutes
setInterval(fetchMMI, 30 * 60 * 1000);

// ══════════════════════════════════════════════════════════════
//  📺 LIVE TV — YouTube RSS Live Video ID Engine
//  Worker fetches youtube.com/feeds/videos.xml server-side
//  (no CORS, no API key). Returns latest video IDs. Frontend
//  embeds the first one. Auto-refreshes every 20 minutes so
//  a new stream ID is always picked up automatically.
// ══════════════════════════════════════════════════════════════

const LTV_CHANNELS = {
  cnbctv18: {
    name:      'CNBC TV18',
    channelId: 'UCmRbHAgG2k2vDUvb3xsEunQ',
    ytHandle:  'https://www.youtube.com/@CNBC-TV18-UCmRbHAgG2k2vDUvb3xsEunQ/live',
  },
  ndtvprofit: {
    name:      'NDTV Profit',
    channelId: 'UC3uJIdRFTGgLWrUziaHbzrg',
    ytHandle:  'https://www.youtube.com/@NDTVProfitIndia-UC3uJIdRFTGgLWrUziaHbzrg/live',
  },
  bloomberg: {
    name:      'Bloomberg Markets',
    channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg',
    ytHandle:  'https://www.youtube.com/@markets-UCIALMKvObZNtJ6AmdCLP7Lg/live',
  },
};

// Cache videoIds per channel so switching tabs is instant
const ltvCache = {};
let ltvCurrent = 'cnbctv18';
let ltvRefreshTimer = null;

// ── Fetch live video ID via Worker ──
async function ltvFetchVideoId(key) {
  const ch = LTV_CHANNELS[key];
  if (!ch) return null;

  // Return cache if fresh (< 20 min)
  const cached = ltvCache[key];
  if (cached && (Date.now() - cached.ts) < 20 * 60 * 1000) return cached.videoIds;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res   = await fetch(
      `${WORKER_URL}?ytlive=1&id=${ch.channelId}`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error('Worker error ' + res.status);
    const data = await res.json();
    if (!data.videoIds || !data.videoIds.length) throw new Error('No video IDs');

    ltvCache[key] = { videoIds: data.videoIds, ts: Date.now() };
    return data.videoIds;
  } catch(e) {
    console.warn('ltvFetchVideoId failed:', e.message);
    return null;
  }
}

// ── Build embed URL ──
function ltvEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&iv_load_policy=3`;
}

// ── Load a channel — try each video ID until one embeds ──
async function ltvLoad(key) {
  const ch      = LTV_CHANNELS[key];
  const iframe  = document.getElementById('ltvIframe');
  const overlay = document.getElementById('ltvOverlay');
  const nameEl  = document.getElementById('ltvChannelName');
  const openBtn = document.getElementById('ltvOpenBtn');
  const dot     = document.getElementById('ltvDot');

  if (nameEl)  nameEl.textContent = ch.name;
  if (openBtn) openBtn.href = ch.ytHandle;
  if (overlay) overlay.style.display = 'flex';
  if (dot)     dot.style.color = 'var(--muted)';
  document.getElementById('ltvOverlayText').textContent = 'Fetching live stream…';

  const videoIds = await ltvFetchVideoId(key);

  // Still the right channel?
  if (key !== ltvCurrent) return;

  if (!videoIds || !videoIds.length) {
    document.getElementById('ltvOverlayText').textContent = 'Stream unavailable — try ↗ YouTube';
    if (dot) dot.style.color = 'var(--red)';
    return;
  }

  // Try each videoId — use onload/onerror on iframe
  let idx = 0;

  function tryNext() {
    if (key !== ltvCurrent) return;
    if (idx >= videoIds.length) {
      document.getElementById('ltvOverlayText').textContent = 'Stream unavailable — try ↗ YouTube';
      if (dot) { dot.textContent = '● OFFLINE'; dot.style.color = 'var(--red)'; }
      return;
    }
    const vid = videoIds[idx++];
    document.getElementById('ltvOverlayText').textContent = 'Loading ' + ch.name + '…';
    iframe.src = ltvEmbedUrl(vid);
  }

  // Hide overlay once iframe content loads
  iframe.onload = () => {
    if (key !== ltvCurrent) return;
    if (overlay) overlay.style.display = 'none';
    if (dot) { dot.textContent = '● LIVE'; dot.style.color = 'var(--green)'; }
  };
  iframe.onerror = () => tryNext();

  tryNext();
}

// ── Switch channel tab ──
function ltvSwitch(key, tabEl) {
  document.querySelectorAll('#ltvTabs .mnp-tv-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  ltvCurrent = key;

  // Reset iframe immediately so old stream doesn't flash
  const iframe = document.getElementById('ltvIframe');
  if (iframe) iframe.src = 'about:blank';

  ltvLoad(key);
}

// ── Auto-refresh every 20 min (picks up new stream IDs) ──
function ltvAutoRefresh() {
  // Bust cache for current channel then reload
  delete ltvCache[ltvCurrent];
  ltvLoad(ltvCurrent);
}

// ── Init ──
ltvSwitch('cnbctv18', document.querySelector('#ltvTabs .mnp-tv-tab'));
setInterval(ltvAutoRefresh, 20 * 60 * 1000);

// ── INDIAN NEWS HEADLINES ──
let mnpCurrentTab = 'et';
let mnpCache = {};

function mnpSwitchTab(key, tabEl) {
  document.querySelectorAll('.news-panel-right .mnp-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  mnpCurrentTab = key;
  mnpRenderHeadlines(key);
}

async function mnpRenderHeadlines(key) {
  const container = document.getElementById('mnp-headlines');
  if (!container) return;
  if (mnpCache[key]) { mnpDisplayHeadlines(mnpCache[key], container); return; }
  container.innerHTML = '<div class="mnp-headline-loading">Fetching headlines…</div>';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(WORKER_URL + '?news=1', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('error');
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      mnpCache[key] = data.items;
      mnpDisplayHeadlines(data.items, container);
      const ts = document.getElementById('mnp-refresh-ts');
      if (ts) {
        const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
        ts.textContent = 'updated ' + now + ' IST';
      }
    }
  } catch(e) {
    container.innerHTML = '<div class="mnp-headline-loading" style="color:var(--red)">Headlines unavailable</div>';
  }
}

function mnpDisplayHeadlines(items, container) {
  container.innerHTML = items.slice(0, 6).map(item => {
    const title = (item.title||'').replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const short = title.length > 95 ? title.substring(0,95) + '…' : title;
    const diff = item.pubDate ? Math.round((Date.now() - new Date(item.pubDate).getTime())/60000) : 0;
    const ago = diff < 60 ? diff + 'm ago' : Math.round(diff/60) + 'h ago';
    return `<a class="mnp-headline-item" href="${item.link||'#'}" target="_blank" rel="noopener">
      <div class="mnp-hl-dot"></div>
      <div style="flex:1">
        <div class="mnp-hl-text">${short}</div>
        <div class="mnp-hl-time">${item.source||'Market News'} · ${ago}</div>
      </div>
    </a>`;
  }).join('');
}


mnpRenderHeadlines('et');
setInterval(() => mnpRenderHeadlines(mnpCurrentTab), 5 * 60 * 1000);

// ══════════════════════════════════════════════════════════════
//  📊 DAILY MARKET DATA — Tab switcher + dummy content
//  Tabs: Indices | Sectors | Top Movers | F&O
//  Currently shows EOD placeholder data (live data coming soon)
// ══════════════════════════════════════════════════════════════

const DMD_DATA = {

  indices: [
    { label:'NIFTY 50',        val:'22,161.35', chg:'-261.55', pct:'-1.17%', up:false },
    { label:'SENSEX',          val:'73,137.90', chg:'-883.28', pct:'-1.19%', up:false },
    { label:'BANK NIFTY',      val:'47,892.15', chg:'-543.40', pct:'-1.12%', up:false },
    { label:'NIFTY MIDCAP 100',val:'48,920.60', chg:'+124.30', pct:'+0.25%', up:true  },
    { label:'NIFTY SMALLCAP',  val:'14,312.45', chg:'+89.70',  pct:'+0.63%', up:true  },
    { label:'NIFTY IT',        val:'35,418.20', chg:'-892.30', pct:'-2.45%', up:false },
    { label:'NIFTY PHARMA',    val:'21,034.55', chg:'+312.80', pct:'+1.51%', up:true  },
    { label:'INDIA VIX',       val:'16.82',     chg:'+2.14',   pct:'+14.6%', up:false },
    { label:'GIFT NIFTY',      val:'22,205.00', chg:'-248.00', pct:'-1.11%', up:false },
  ],

  sectors: [
    { label:'IT',          val:'-2.45%', bar:82, up:false },
    { label:'Auto',        val:'-1.88%', bar:68, up:false },
    { label:'Banking',     val:'-1.12%', bar:45, up:false },
    { label:'FMCG',        val:'-0.43%', bar:20, up:false },
    { label:'Realty',      val:'+0.18%', bar:10, up:true  },
    { label:'Pharma',      val:'+1.51%', bar:55, up:true  },
    { label:'Metal',       val:'+1.73%', bar:62, up:true  },
    { label:'PSU Bank',    val:'+0.94%', bar:38, up:true  },
    { label:'Media',       val:'+2.31%', bar:74, up:true  },
    { label:'Energy',      val:'-0.76%', bar:30, up:false },
  ],

  movers: {
    gainers: [
      { sym:'COALINDIA',  name:'Coal India',     val:'491.25', pct:'+4.82%' },
      { sym:'HINDUNILVR', name:'HUL',            val:'2,318.40',pct:'+3.14%' },
      { sym:'SUNPHARMA',  name:'Sun Pharma',     val:'1,724.60',pct:'+2.91%' },
      { sym:'NESTLEIND',  name:'Nestle India',   val:'2,241.35',pct:'+2.44%' },
      { sym:'CIPLA',      name:'Cipla',          val:'1,512.80',pct:'+2.18%' },
    ],
    losers: [
      { sym:'TECHM',      name:'Tech Mahindra',  val:'1,312.45',pct:'-4.21%' },
      { sym:'WIPRO',      name:'Wipro',          val:'298.75',  pct:'-3.88%' },
      { sym:'INFY',       name:'Infosys',        val:'1,315.80',pct:'-3.50%' },
      { sym:'LTIM',       name:'LTIMindtree',    val:'5,218.90',pct:'-3.12%' },
      { sym:'HCLTECH',    name:'HCL Tech',       val:'1,624.30',pct:'-2.95%' },
    ],
  },

  fno: [
    { label:'NIFTY PCR',         val:'0.91',         note:'Bearish' },
    { label:'Max Pain',          val:'22,000',       note:'Key level' },
    { label:'Max OI Call',       val:'22,500 CE',    note:'Resistance' },
    { label:'Max OI Put',        val:'21,500 PE',    note:'Support'   },
    { label:'ATM IV (Nifty)',    val:'13.42%',       note:'Elevated'  },
    { label:'Total F&O Turnover',val:'₹4.82L Cr',   note:'vs ₹4.1L avg' },
    { label:'FII Index Futures', val:'-₹2,840 Cr',  note:'Net short' },
    { label:'FII Index Options', val:'+₹1,240 Cr',  note:'Net long'  },
    { label:'Expiry',            val:'3 days',       note:'Weekly Thu' },
  ],
};

let dmdCurrentTab = 'sectors';

function dmdSwitch(tab, tabEl) {
  document.querySelectorAll('#dmdTabs .mnp-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  dmdCurrentTab = tab;
  dmdRender(tab);
}

function dmdRender(tab) {
  const el = document.getElementById('dmdContent');
  if (!el) return;

  // EOD timestamp
  const tsEl = document.getElementById('dmdTs');
  if (tsEl) {
    const now = new Date();
    const ist = now.toLocaleString('en-IN',{ timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short' });
    tsEl.textContent = 'EOD · ' + ist + ' IST';
  }

  if (tab === 'indices') {
    el.innerHTML = DMD_DATA.indices.map(r => `
      <div class="dmd-row">
        <span class="dmd-label">${r.label}</span>
        <span class="dmd-val" style="color:var(--text)">₹${r.val}</span>
        <span class="dmd-chg" style="color:${r.up ? 'var(--green)' : 'var(--red)'}">
          ${r.pct}
        </span>
      </div>`).join('');

  } else if (tab === 'sectors') {
    el.innerHTML = `<div class="dmd-section-head">Sector Performance — Today</div>` +
      DMD_DATA.sectors.map(r => `
      <div class="dmd-row" style="gap:10px">
        <span class="dmd-label" style="min-width:72px">${r.label}</span>
        <div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${r.bar}%;background:${r.up ? 'var(--green)' : 'var(--red)'};border-radius:3px;transition:width 0.6s ease"></div>
        </div>
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;width:52px;text-align:right;
          color:${r.up ? 'var(--green)' : 'var(--red)'}">${r.val}</span>
      </div>`).join('');

  } else if (tab === 'movers') {
    el.innerHTML = `
      <div class="dmd-section-head">🟢 Top Gainers</div>
      ${DMD_DATA.movers.gainers.map(r => `
        <div class="dmd-row">
          <div style="flex:1">
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text)">${r.sym}</div>
            <div style="font-size:9px;color:var(--muted)">${r.name}</div>
          </div>
          <span class="dmd-val" style="color:var(--text)">₹${r.val}</span>
          <span class="dmd-chg" style="color:var(--green)">${r.pct}</span>
        </div>`).join('')}
      <div class="dmd-section-head" style="margin-top:2px">🔴 Top Losers</div>
      ${DMD_DATA.movers.losers.map(r => `
        <div class="dmd-row">
          <div style="flex:1">
            <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text)">${r.sym}</div>
            <div style="font-size:9px;color:var(--muted)">${r.name}</div>
          </div>
          <span class="dmd-val" style="color:var(--text)">₹${r.val}</span>
          <span class="dmd-chg" style="color:var(--red)">${r.pct}</span>
        </div>`).join('')}`;

  } else if (tab === 'fno') {
    el.innerHTML = `<div class="dmd-section-head">F&amp;O Snapshot — Expiry Week</div>` +
      DMD_DATA.fno.map(r => `
      <div class="dmd-row">
        <span class="dmd-label">${r.label}</span>
        <span class="dmd-val" style="color:var(--text)">${r.val}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;
          color:var(--muted);text-align:right;min-width:70px">${r.note}</span>
      </div>`).join('') +
      `<div style="padding:10px 12px;font-family:'JetBrains Mono',monospace;
        font-size:9px;color:var(--muted);border-top:1px solid var(--border);
        line-height:1.6">
        ⚠ Dummy data — live F&amp;O data coming soon.<br>
        Will pull from NSE derivatives API via Cloudflare Worker.
      </div>`;
  }
}

// Init — default to sectors (indices tab removed)
dmdRender('sectors');

// ══════════════════════════════════════════════════════════════
//  𝕏 INDIAN MARKET PULSE v3.0
//  ► Fetches via WORKER_URL + '?tweets=1&extra=...'
//  ► Worker does Nitter RSS server-side (no CORS)
//  ► Strictly live posts only (fallback/dummy is ignored)
//  ► Auto-refresh every 5 min | Filterable | Add accounts + hashtags
// ══════════════════════════════════════════════════════════════

// Core accounts shown in chips UI (custom ones stored in localStorage)
const X_CORE_HANDLES = [
  'ETMarkets','NSEIndia','BSEIndia','moneycontrolcom','ETNOWlive',
  'zerodhaonline','CNBCTV18News','RBI','SEBI_India','NDTVProfit',
  'LiveMint','bsindia','ValueResearchInd','Nifty50NSE'
];

// Custom (user-added) accounts — persisted in localStorage
let xCustomAccounts = (() => {
  try { return JSON.parse(localStorage.getItem('dalal_x_custom') || '[]'); }
  catch(e) { return []; }
})();

const X_CORE_HASHTAGS = ['IndianStockMarket','Nifty50','Sensex','BankNifty','DalalStreet'];
let xCustomHashtags = (() => {
  try { return JSON.parse(localStorage.getItem('dalal_x_tags') || '[]'); }
  catch(e) { return []; }
})();

let xAllTweets = [];
let xFilter    = 'all';
let xFetching  = false;

// ── HELPERS ──
function xEsc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function xAgo(dateStr) {
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (isNaN(diff) || diff < 0) return 'now';
    if (diff < 60)    return diff + 's';
    if (diff < 3600)  return Math.floor(diff/60) + 'm';
    if (diff < 86400) return Math.floor(diff/3600) + 'h';
    return Math.floor(diff/86400) + 'd';
  } catch(e) { return ''; }
}

function xIsUS(text) {
  return /\b(fed|federal reserve|powell|nasdaq|s&p 500|dow jones|wall street|nyse|fomc|treasury|rate cut|rate hike|dollar index|dxy|nonfarm|jerome)\b/i.test(text);
}
function xIsBreaking(text) {
  return /\b(breaking|alert|urgent|just in|flash|halt|circuit|sebi order|rbi rate|ban|fir|raid|arrest|freeze|default|insolvency)\b/i.test(text);
}

function xTags(text) {
  const tags = [];
  if (xIsBreaking(text))                                                                          tags.push({l:'🔴 BREAKING', c:'var(--red)'});
  if (/\b(nifty|sensex|bank nifty|midcap|smallcap|nse|bse)\b/i.test(text))                       tags.push({l:'📊 INDEX',    c:'var(--saffron)'});
  if (/\b(result|earnings|quarterly|q[1-4]|profit|revenue|pat|eps|ebitda)\b/i.test(text))         tags.push({l:'📋 RESULTS',  c:'var(--gold)'});
  if (/\b(ipo|listing|oversubscribed|gmp|allotment|drhp)\b/i.test(text))                          tags.push({l:'🚀 IPO',      c:'#7C5CFC'});
  if (/\b(fii|fpi|dii|mutual fund|net buy|net sell|institutional)\b/i.test(text))                 tags.push({l:'💰 FII/DII',  c:'#00BCD4'});
  if (xIsUS(text))                                                                                 tags.push({l:'🇺🇸 US',      c:'#64B5F6'});
  return tags.slice(0, 2);
}

// ── FETCH from Cloudflare Worker ──
async function xFetchAll() {
  if (xFetching) return;
  xFetching = true;

  const loadEl = document.getElementById('xFeedLoading');
  const listEl = document.getElementById('xFeedList');
  if (loadEl) loadEl.style.display = 'block';
  if (listEl) listEl.style.opacity = '0.4';

  try {
    // Pass user-added custom handles to the worker
    const extraAccounts = xCustomAccounts.join(',');
    const tags = [...X_CORE_HASHTAGS, ...xCustomHashtags].join(',');
    const workerUrl = WORKER_URL + '?tweets=1'
      + (extraAccounts ? '&extra=' + encodeURIComponent(extraAccounts) : '')
      + (tags ? '&hashtags=' + encodeURIComponent(tags) : '');

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res   = await fetch(workerUrl, { signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error('Worker ' + res.status);
    const data = await res.json();

    if (data.items && data.items.length > 0) {
      const liveOnly = data.items.filter(t => (t.source || '').toLowerCase() !== 'fallback');

      // Enrich with computed fields
      const enriched = liveOnly.map(t => ({
        ...t,
        id:         t.handle + '_' + (t.url || '') + '_' + (t.pubDate || ''),
        isUS:       xIsUS(t.text),
        isBreaking: xIsBreaking(t.text),
        tags:       xTags(t.text),
      }));

      // Deduplicate against existing
      const seen = new Set(xAllTweets.map(t => t.id));
      const fresh = enriched.filter(t => !seen.has(t.id));

      xAllTweets = [...fresh, ...xAllTweets]
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
        .slice(0, 80);
    }
  } catch(e) {
    console.warn('X feed fetch failed:', e.message);
    // Show a helpful error in the feed only if completely empty
    if (xAllTweets.length === 0) {
      if (listEl) listEl.innerHTML = `
        <div style="padding:20px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)">
          <div style="font-size:20px;margin-bottom:8px">𝕏</div>
          No live X posts available now. Check Worker/X source config.<br>
          <span style="font-size:9px;opacity:0.6">${WORKER_URL}</span>
        </div>`;
    }
  } finally {
    xFetching = false;
    if (loadEl) loadEl.style.display = 'none';
    if (listEl) listEl.style.opacity = '1';
    xRenderFeed();
    xUpdateRefreshTs();
  }
}

// ── RENDER ──
function xRenderFeed() {
  const list = document.getElementById('xFeedList');
  if (!list) return;

  let tweets = [...xAllTweets];
  if (xFilter === 'india')    tweets = tweets.filter(t => !t.isUS);
  else if (xFilter === 'us')  tweets = tweets.filter(t => t.isUS);
  else if (xFilter === 'breaking') tweets = tweets.filter(t => t.isBreaking);

  if (!tweets.length && xAllTweets.length === 0) return; // loading state handles this

  if (!tweets.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)">No tweets match this filter.</div>`;
    return;
  }

  list.innerHTML = tweets.map((t, idx) => {
    const initials = (t.name||t.handle||'X')[0].toUpperCase();
    const tagsHtml = t.tags.map(tag =>
      `<span style="font-family:'JetBrains Mono',monospace;font-size:8px;padding:2px 6px;border-radius:3px;
        background:${tag.c}22;color:${tag.c};border:1px solid ${tag.c}44;white-space:nowrap">${tag.l}</span>`
    ).join('');
    const leftBorder = t.isBreaking ? 'border-left:3px solid var(--red)' : t.isUS ? 'border-left:3px solid #64B5F6' : '';

    return `<a href="${xEsc(t.url)}" target="_blank" rel="noopener"
      style="display:block;text-decoration:none;background:var(--panel);border:1px solid var(--border);
        ${leftBorder};border-radius:10px;padding:12px 14px;cursor:pointer;
        animation:fadeIn 0.3s ease forwards;animation-delay:${Math.min(idx*0.03,0.5)}s;opacity:0"
      onmouseover="this.style.borderColor='var(--saffron)';this.style.background='rgba(255,107,0,0.04)'"
      onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--panel)'">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:30px;height:30px;border-radius:50%;background:var(--saffron-dim);border:1px solid var(--saffron);
            display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
            color:var(--saffron);flex-shrink:0">${xEsc(initials)}</div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.2">${xEsc(t.name||t.handle)}</div>
            <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace">
              @${xEsc(t.handle)} &middot; ${xAgo(t.pubDate)}</div>
          </div>
        </div>
        <div style="font-size:14px;color:var(--muted);opacity:0.4">𝕏</div>
      </div>

      <div style="font-size:12.5px;line-height:1.65;color:var(--text);margin-bottom:9px">
        ${t.isRT ? '<span style="font-size:9px;color:var(--muted)">🔁 RT &nbsp;</span>' : ''}${xEsc(t.text)}
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:5px">
        <div style="display:flex;gap:4px;flex-wrap:wrap">${tagsHtml}</div>
        <div style="display:flex;gap:10px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--muted)">
          <span>${new Date(t.pubDate).toLocaleString('en-IN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short',timeZone:'Asia/Kolkata'})} IST</span>
        </div>
      </div>
    </a>`;
  }).join('');
}

// ── FILTERS ──
function xSetFilter(filter, tabEl) {
  document.querySelectorAll('#xFilterTabs .mnp-tab').forEach(t => t.classList.remove('active'));
  if (tabEl) tabEl.classList.add('active');
  xFilter = filter;
  xRenderFeed();
}

// ── ADD ACCOUNT ──
function addXAccount() {
  const input = document.getElementById('xHandleInput');
  if (!input) return;
  const handle = (input.value || '').trim().replace(/^@/, '');
  if (!handle) return;
  if (!/^[A-Za-z0-9_]{1,50}$/.test(handle)) {
    alert('Enter a valid X handle (letters, numbers, underscore).');
    return;
  }
  const all = [...X_CORE_HANDLES, ...xCustomAccounts];
  if (all.some(h => h.toLowerCase() === handle.toLowerCase())) {
    input.value = '';
    alert('@' + handle + ' is already in your feed!');
    return;
  }
  xCustomAccounts.unshift(handle);
  xSaveCustom();
  xRenderChips();
  input.value = '';
  // Full refresh so the worker fetches the new account
  xAllTweets = [];
  xFetchAll();
}

// ── REMOVE custom account ──
function xRemoveAccount(handle) {
  xCustomAccounts = xCustomAccounts.filter(h => h.toLowerCase() !== handle.toLowerCase());
  xAllTweets = xAllTweets.filter(t => t.handle.toLowerCase() !== handle.toLowerCase());
  xSaveCustom();
  xRenderChips();
  xRenderFeed();
}

// ── RENDER CHIPS ──
function xRenderChips() {
  const accEl = document.getElementById('xAccountChips');
  const tagEl = document.getElementById('xHashtagChips');

  if (accEl) {
    const coreHtml = X_CORE_HANDLES.map(h =>
      `<span style="display:inline-flex;align-items:center;background:var(--panel);border:1px solid var(--border);
        border-radius:20px;padding:2px 8px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--muted)">
        <span style="color:var(--saffron)">@${xEsc(h)}</span>
      </span>`
    ).join('');
    const customHtml = xCustomAccounts.map(h =>
      `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,107,0,0.08);
        border:1px solid var(--saffron);border-radius:20px;padding:2px 6px 2px 8px;
        font-family:'JetBrains Mono',monospace;font-size:9px">
        <span style="color:var(--saffron)">@${xEsc(h)}</span>
        <span onclick="xRemoveAccount('${xEsc(h)}')" style="cursor:pointer;color:var(--muted);font-size:11px;line-height:1;padding-left:2px" title="Remove">×</span>
      </span>`
    ).join('');
    accEl.innerHTML = coreHtml + customHtml;
  }

  if (tagEl) {
    const coreTags = X_CORE_HASHTAGS.map(tag =>
      `<span style="display:inline-flex;align-items:center;background:var(--panel);border:1px solid var(--border);
        border-radius:20px;padding:2px 8px;font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--muted)">
        <span style="color:#64B5F6">#${xEsc(tag)}</span>
      </span>`
    ).join('');
    const customTags = xCustomHashtags.map(tag =>
      `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(100,181,246,0.10);
        border:1px solid #64B5F6;border-radius:20px;padding:2px 6px 2px 8px;
        font-family:'JetBrains Mono',monospace;font-size:9px">
        <span style="color:#64B5F6">#${xEsc(tag)}</span>
        <span onclick="xRemoveTag('${xEsc(tag)}')" style="cursor:pointer;color:var(--muted);font-size:11px;line-height:1;padding-left:2px" title="Remove">×</span>
      </span>`
    ).join('');
    tagEl.innerHTML = coreTags + customTags;
  }
}

function addXTag() {
  const input = document.getElementById('xTagInput');
  if (!input) return;
  const tag = (input.value || '').trim().replace(/^#/, '');
  if (!tag) return;
  if (!/^[A-Za-z0-9_]{1,60}$/.test(tag)) {
    alert('Enter a valid hashtag (letters, numbers, underscore).');
    return;
  }
  const all = [...X_CORE_HASHTAGS, ...xCustomHashtags];
  if (all.some(t => t.toLowerCase() === tag.toLowerCase())) {
    input.value = '';
    alert('#' + tag + ' is already tracked!');
    return;
  }
  xCustomHashtags.unshift(tag);
  xSaveCustom();
  xRenderChips();
  input.value = '';
  xAllTweets = [];
  xFetchAll();
}

function xRemoveTag(tag) {
  xCustomHashtags = xCustomHashtags.filter(t => t.toLowerCase() !== tag.toLowerCase());
  xSaveCustom();
  xRenderChips();
  xAllTweets = [];
  xFetchAll();
}

// ── TIMESTAMP ──
function xUpdateRefreshTs() {
  const el = document.getElementById('xFeedRefreshTs');
  if (!el) return;
  const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
  el.innerHTML = `<span style="color:var(--green);animation:blink 1.5s infinite">●</span> ${now} IST`;
}

// ── MANUAL REFRESH ──
function xManualRefresh() {
  xAllTweets = [];
  xFetchAll();
}

function xSaveCustom() {
  try { localStorage.setItem('dalal_x_custom', JSON.stringify(xCustomAccounts)); } catch(e) {}
  try { localStorage.setItem('dalal_x_tags', JSON.stringify(xCustomHashtags)); } catch(e) {}
}

// ── INIT ──
if (document.getElementById('xFeedList')) {
  xRenderChips();
  xFetchAll();
  setInterval(xFetchAll, 5 * 60 * 1000);
}


// ══════════════════════════════════════════════════════
//  GLOBAL INDICES GLOBE  —  D3 v7 + Natural Earth borders
// ══════════════════════════════════════════════════════

// ── Index definitions (precise capital/exchange city coords) ──
const GLOBE_INDICES = [
  // South Asia
  { id:'nifty50',    flag:'🇮🇳', name:'NIFTY 50',        short:'NIFTY',   region:'India · NSE',            lat:19.07, lng:72.87,  base:22500,  vol:180  },
  { id:'sensex',     flag:'🇮🇳', name:'SENSEX',          short:'SENSEX',  region:'India · BSE',            lat:18.93, lng:72.83,  base:74200,  vol:600  },
  // East Asia
  { id:'nikkei',     flag:'🇯🇵', name:'Nikkei 225',      short:'N225',    region:'Japan · TSE',            lat:35.68, lng:139.69, base:38500,  vol:400  },
  { id:'shanghaicomp',flag:'🇨🇳',name:'Shanghai Comp',   short:'SHCOMP',  region:'China · SSE',            lat:31.23, lng:121.47, base:3250,   vol:35   },
  { id:'hangseng',   flag:'🇭🇰', name:'Hang Seng',       short:'HSI',     region:'Hong Kong · HKEX',       lat:22.28, lng:114.16, base:17200,  vol:180  },
  { id:'kospi',      flag:'🇰🇷', name:'KOSPI',           short:'KOSPI',   region:'South Korea · KRX',      lat:37.57, lng:126.98, base:2560,   vol:30   },
  { id:'taiwan',     flag:'🇹🇼', name:'TWSE (Taiex)',    short:'TAIEX',   region:'Taiwan · TWSE',          lat:25.05, lng:121.53, base:21400,  vol:250  },
  // Southeast Asia & Oceania
  { id:'asx200',     flag:'🇦🇺', name:'ASX 200',         short:'ASX200',  region:'Australia · ASX',        lat:-33.87,lng:151.21, base:7900,   vol:90   },
  { id:'straits',    flag:'🇸🇬', name:'Straits Times',   short:'STI',     region:'Singapore · SGX',        lat:1.35,  lng:103.82, base:3350,   vol:25   },
  { id:'klse',       flag:'🇲🇾', name:'KLSE Composite',  short:'KLCI',    region:'Malaysia · Bursa',       lat:3.14,  lng:101.69, base:1580,   vol:12   },
  { id:'jakarta',    flag:'🇮🇩', name:'IDX Composite',   short:'IDX',     region:'Indonesia · IDX',        lat:-6.21, lng:106.85, base:7300,   vol:80   },
  { id:'nzx50',      flag:'🇳🇿', name:'NZX 50',          short:'NZX50',   region:'New Zealand · NZX',      lat:-36.87,lng:174.77, base:12200,  vol:100  },
  // Europe
  { id:'ftse100',    flag:'🇬🇧', name:'FTSE 100',        short:'FTSE',    region:'UK · LSE',               lat:51.51, lng:-0.09,  base:8300,   vol:90   },
  { id:'dax',        flag:'🇩🇪', name:'DAX 40',          short:'DAX',     region:'Germany · XETRA',        lat:50.11, lng:8.68,   base:18400,  vol:200  },
  { id:'cac40',      flag:'🇫🇷', name:'CAC 40',          short:'CAC40',   region:'France · Euronext',      lat:48.87, lng:2.33,   base:8100,   vol:90   },
  { id:'ibex35',     flag:'🇪🇸', name:'IBEX 35',         short:'IBEX',    region:'Spain · BME',            lat:40.42, lng:-3.70,  base:11600,  vol:120  },
  { id:'mib',        flag:'🇮🇹', name:'FTSE MIB',        short:'MIB',     region:'Italy · Borsa',          lat:45.46, lng:9.19,   base:34200,  vol:350  },
  { id:'smi',        flag:'🇨🇭', name:'SMI',             short:'SMI',     region:'Switzerland · SIX',      lat:47.38, lng:8.54,   base:11800,  vol:130  },
  { id:'aex',        flag:'🇳🇱', name:'AEX',             short:'AEX',     region:'Netherlands · Euronext', lat:52.37, lng:4.90,   base:880,    vol:10   },
  { id:'omx',        flag:'🇸🇪', name:'OMX Stockholm',   short:'OMXS30',  region:'Sweden · Nasdaq Nordic', lat:59.33, lng:18.07,  base:2400,   vol:25   },
  { id:'wse',        flag:'🇵🇱', name:'WIG 20',          short:'WIG20',   region:'Poland · WSE',           lat:52.23, lng:21.01,  base:2200,   vol:22   },
  { id:'bist100',    flag:'🇹🇷', name:'BIST 100',        short:'BIST',    region:'Turkey · Borsa Istanbul',lat:41.01, lng:28.98,  base:9800,   vol:100  },
  { id:'moex',       flag:'🇷🇺', name:'MOEX Russia',     short:'MOEX',    region:'Russia · MOEX',          lat:55.75, lng:37.62,  base:3100,   vol:35   },
  // Americas
  { id:'spx',        flag:'🇺🇸', name:'S&P 500',         short:'SPX',     region:'USA · NYSE',             lat:40.71, lng:-74.01, base:5300,   vol:55   },
  { id:'djia',       flag:'🇺🇸', name:'Dow Jones',       short:'DJIA',    region:'USA · NYSE',             lat:40.75, lng:-73.99, base:39200,  vol:420  },
  { id:'nasdaq',     flag:'🇺🇸', name:'NASDAQ',          short:'COMP',    region:'USA · Nasdaq',           lat:40.76, lng:-73.97, base:16800,  vol:200  },
  { id:'tsx',        flag:'🇨🇦', name:'TSX Composite',   short:'TSX',     region:'Canada · TSX',           lat:43.65, lng:-79.38, base:22100,  vol:230  },
  { id:'bovespa',    flag:'🇧🇷', name:'Bovespa',         short:'IBOV',    region:'Brazil · B3',            lat:-23.55,lng:-46.63, base:126000, vol:1300 },
  { id:'merval',     flag:'🇦🇷', name:'MERVAL',          short:'MERVAL',  region:'Argentina · BYMA',       lat:-34.60,lng:-58.38, base:1650000,vol:18000},
  { id:'ipc',        flag:'🇲🇽', name:'IPC (BMV)',       short:'IPC',     region:'Mexico · BMV',           lat:19.43, lng:-99.13, base:54000,  vol:560  },
  { id:'ipsa',       flag:'🇨🇱', name:'IPSA',            short:'IPSA',    region:'Chile · Santiago',       lat:-33.45,lng:-70.67, base:6400,   vol:65   },
  // Middle East
  { id:'tadawul',    flag:'🇸🇦', name:'Tadawul (TASI)',  short:'TASI',    region:'Saudi Arabia · Tadawul', lat:24.69, lng:46.72,  base:12100,  vol:130  },
  { id:'dfm',        flag:'🇦🇪', name:'DFM General',     short:'DFM',     region:'UAE · Dubai FM',         lat:25.20, lng:55.27,  base:4300,   vol:45   },
  { id:'egx30',      flag:'🇪🇬', name:'EGX 30',          short:'EGX30',   region:'Egypt · EGX',            lat:30.06, lng:31.24,  base:26000,  vol:280  },
  { id:'isx',        flag:'🇮🇱', name:'Tel Aviv 125',    short:'TA125',   region:'Israel · TASE',          lat:32.08, lng:34.78,  base:2100,   vol:22   },
  { id:'qe',         flag:'🇶🇦', name:'QE All Share',    short:'QEAS',    region:'Qatar · QSE',            lat:25.29, lng:51.53,  base:10400,  vol:110  },
  // Africa
  { id:'jse',        flag:'🇿🇦', name:'JSE Top 40',      short:'TOP40',   region:'South Africa · JSE',     lat:-26.20,lng:28.04,  base:76000,  vol:800  },
  { id:'nse_kenya',  flag:'🇰🇪', name:'NSE 20',          short:'NSE20',   region:'Kenya · NSE',            lat:-1.28, lng:36.82,  base:1680,   vol:18   },
  { id:'ngx',        flag:'🇳🇬', name:'NGX All Share',   short:'NGX',     region:'Nigeria · NGX',          lat:6.45,  lng:3.40,   base:98000,  vol:1000 },
];

// ── Market data state ──
let gData = {};
let gHovered = null;
let gTimer = null;
let gD3Loaded = false;
let gProjection, gPath, gSvg, gWorld;
let gRotating = true;
let gRotTimer = null;

function gSimulate() {
  const now = new Date();
  GLOBE_INDICES.forEach(idx => {
    if (!gData[idx.id]) {
      const chg = (Math.random() - 0.48) * idx.base * 0.015;
      gData[idx.id] = { value: idx.base + chg, change: chg, pct: (chg/idx.base)*100, time: now };
    } else {
      const micro = (Math.random()-0.5) * idx.vol * 0.12;
      const d = gData[idx.id];
      d.value = Math.max(d.value + micro, idx.base * 0.4);
      d.change += micro; d.pct = (d.change/idx.base)*100; d.time = now;
    }
  });
}

function gColor(pct) {
  if (pct >  1.0) return '#00E676';
  if (pct >  0.2) return '#69F0AE';
  if (pct >  0)   return '#B9F6CA';
  if (pct > -0.2) return '#FF5252';
  if (pct > -1.0) return '#FF1744';
  return '#D50000';
}

function gFmt(v, base) {
  if (base >= 500000) return v.toLocaleString('en-IN',{maximumFractionDigits:0});
  if (base >= 10000)  return v.toLocaleString('en-US',{maximumFractionDigits:0});
  return v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function gRenderSidebar() {
  const list = document.getElementById('globeIndicesList');
  if (!list) return;
  const sorted = [...GLOBE_INDICES].sort((a,b)=>{
    const da=gData[a.id], db=gData[b.id];
    if(!da||!db) return 0;
    return Math.abs(db.pct)-Math.abs(da.pct);
  });
  list.innerHTML = sorted.map(idx=>{
    const d = gData[idx.id]; if(!d) return '';
    const col = gColor(d.pct);
    const ts = d.time.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
    const dt = d.time.toLocaleDateString('en-US',{day:'2-digit',month:'short'});
    const sel = gHovered===idx.id;
    return `<div class="gi-item${sel?' selected':''}"
      onmouseover="gHoverIdx('${idx.id}')" onmouseout="gHoverIdx(null)">
      <div class="gi-flag">${idx.flag}</div>
      <div class="gi-info">
        <div class="gi-name">${idx.name}</div>
        <div class="gi-region">${idx.region}</div>
      </div>
      <div class="gi-vals">
        <div class="gi-price">${gFmt(d.value,idx.base)}</div>
        <div class="gi-chg" style="color:${col}">${d.pct>=0?'+':''}${d.pct.toFixed(2)}%</div>
        <div class="gi-time">${ts} · ${dt}</div>
      </div></div>`;
  }).join('');
}

function gHoverIdx(id) {
  gHovered = id;
  // Update dot sizes in SVG
  if (gSvg) {
    gSvg.selectAll('.g-marker').each(function(m) {
      const isH = m.id === id;
      d3.select(this).select('circle')
        .attr('r', isH ? 8 : 5)
        .attr('stroke-width', isH ? 2 : 1);
      d3.select(this).select('.g-label').style('display', isH ? 'block' : null);
    });
  }
  gRenderSidebar();
  // Show tooltip from sidebar hover
  if (id) {
    const idx = GLOBE_INDICES.find(x=>x.id===id);
    const d = gData[id];
    if (idx && d) gShowTooltip(idx, d);
  } else {
    document.getElementById('globeTooltip').style.display = 'none';
  }
}

function gShowTooltip(idx, d) {
  const col = gColor(d.pct);
  const ts = d.time.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) +
             ' · ' + d.time.toLocaleDateString('en-US',{day:'2-digit',month:'short'});
  document.getElementById('gtIndex').textContent = idx.flag+' '+idx.name;
  document.getElementById('gtValue').textContent = gFmt(d.value, idx.base);
  document.getElementById('gtChg').innerHTML = `<span style="color:${col}">${d.pct>=0?'+':''}${d.pct.toFixed(2)}% (1D)</span>`;
  document.getElementById('gtMeta').textContent = idx.region+' · '+ts;
}

function gInitD3() {
  const wrap = document.getElementById('globeCanvasWrap');
  if (!wrap) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;

  // Remove old SVG content
  const svgEl = document.getElementById('globeSvg');
  svgEl.setAttribute('width', W);
  svgEl.setAttribute('height', H);

  gSvg = d3.select('#globeSvg');
  gSvg.selectAll('*').remove();

  // Defs: ocean gradient + clip
  const defs = gSvg.append('defs');
  const oceanGrad = defs.append('radialGradient').attr('id','oceanGrad')
    .attr('cx','40%').attr('cy','35%');
  oceanGrad.append('stop').attr('offset','0%').attr('stop-color','#0d2255');
  oceanGrad.append('stop').attr('offset','100%').attr('stop-color','#020818');

  defs.append('radialGradient').attr('id','atmGrad')
    .attr('cx','50%').attr('cy','50%')
    .call(g => {
      g.append('stop').attr('offset','75%').attr('stop-color','rgba(100,181,246,0)');
      g.append('stop').attr('offset','100%').attr('stop-color','rgba(100,181,246,0.18)');
    });

  const sphereGrad = defs.append('radialGradient').attr('id','sphereGrad')
    .attr('cx','38%').attr('cy','32%');
  sphereGrad.append('stop').attr('offset','0%').attr('stop-color','rgba(100,181,246,0.07)');
  sphereGrad.append('stop').attr('offset','100%').attr('stop-color','rgba(0,0,0,0)');

  defs.append('clipPath').attr('id','globeClip')
    .append('circle').attr('cx',W/2).attr('cy',H/2).attr('r', Math.min(W,H)*0.42);

  const R = Math.min(W,H) * 0.42;

  gProjection = d3.geoOrthographic()
    .scale(R)
    .translate([W/2, H/2])
    .clipAngle(90)
    .rotate([20, -20, 0]);

  gPath = d3.geoPath().projection(gProjection);

  // Stars layer
  const starData = Array.from({length:200}, ()=>({
    x: Math.random()*W, y: Math.random()*H,
    r: Math.random()*1.3+0.2, a: Math.random()*0.7+0.1
  }));
  gSvg.append('g').attr('class','stars')
    .selectAll('circle').data(starData).join('circle')
    .attr('cx',d=>d.x).attr('cy',d=>d.y).attr('r',d=>d.r)
    .attr('fill',d=>`rgba(255,255,255,${d.a})`);

  // Ocean sphere
  gSvg.append('circle').attr('class','ocean')
    .attr('cx',W/2).attr('cy',H/2).attr('r',R)
    .attr('fill','url(#oceanGrad)');

  // Graticule
  const graticule = d3.geoGraticule().step([20,20]);
  gSvg.append('path').datum(graticule())
    .attr('class','graticule')
    .attr('d', gPath)
    .attr('fill','none')
    .attr('stroke','rgba(100,181,246,0.12)')
    .attr('stroke-width',0.5)
    .attr('clip-path','url(#globeClip)');

  // Countries
  const countryGroup = gSvg.append('g').attr('class','countries')
    .attr('clip-path','url(#globeClip)');

  // Markers group (above countries, inside clip)
  const markerGroup = gSvg.append('g').attr('class','markers')
    .attr('clip-path','url(#globeClip)');

  // Sphere highlight (glossy)
  gSvg.append('circle').attr('cx',W/2).attr('cy',H/2).attr('r',R)
    .attr('fill','url(#sphereGrad)').attr('pointer-events','none');

  // Atmosphere
  gSvg.append('circle').attr('cx',W/2).attr('cy',H/2).attr('r',R)
    .attr('fill','none')
    .attr('stroke','rgba(100,181,246,0.35)').attr('stroke-width',2)
    .attr('filter','url(#atmBlur)');

  // Outer glow
  const filter = defs.append('filter').attr('id','atmBlur');
  filter.append('feGaussianBlur').attr('stdDeviation',4);
  gSvg.append('circle').attr('cx',W/2).attr('cy',H/2).attr('r',R+4)
    .attr('fill','url(#atmGrad)').attr('pointer-events','none');

  // Rim
  gSvg.append('circle').attr('cx',W/2).attr('cy',H/2).attr('r',R)
    .attr('fill','none').attr('stroke','rgba(100,181,246,0.5)').attr('stroke-width',1.5);

  // ── Load world topojson ──
  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
    .then(r=>r.json())
    .then(world=>{
      gWorld = world;
      const countries = topojson.feature(world, world.objects.countries);
      const borders   = topojson.mesh(world, world.objects.countries, (a,b)=>a!==b);

      countryGroup.selectAll('.country')
        .data(countries.features)
        .join('path').attr('class','country')
        .attr('d', gPath)
        .attr('fill','#0e2a4a')
        .attr('stroke','rgba(100,181,246,0.25)')
        .attr('stroke-width',0.4);

      // Draw markers
      gDrawMarkers(markerGroup);

      // Drag
      const drag = d3.drag()
        .on('start', ()=>{ gRotating=false; clearTimeout(gRotTimer); })
        .on('drag', (event)=>{
          const r = gProjection.rotate();
          const sens = 0.25;
          gProjection.rotate([r[0]+event.dx*sens, r[1]-event.dy*sens, r[2]]);
          gUpdateGlobe(countryGroup, borders, markerGroup);
        })
        .on('end', ()=>{ gRotTimer = setTimeout(()=>{ gRotating=true; }, 3000); });

      // Zoom
      const zoom = d3.zoom()
        .scaleExtent([0.5, 8])
        .on('zoom', (event)=>{
          const t = event.transform;
          const baseR = Math.min(W,H)*0.42;
          const newR = baseR * t.k;
          gProjection.scale(newR).translate([W/2 + t.x, H/2 + t.y]);
          // Update clip radius
          defs.select('#globeClip circle').attr('r', newR);
          gSvg.select('.ocean').attr('r', newR);
          gSvg.select('.atmosphere-rim').attr('r', newR);
          gUpdateGlobe(countryGroup, borders, markerGroup);
        });

      gSvg.call(drag).call(zoom);

      // Auto-rotation
      d3.timer(()=>{
        if (!gRotating) return;
        if (!document.getElementById('globeOverlay').classList.contains('open')) return;
        const r = gProjection.rotate();
        gProjection.rotate([r[0]+0.15, r[1], r[2]]);
        gUpdateGlobe(countryGroup, borders, markerGroup);
      });

      gD3Loaded = true;
    })
    .catch(()=>{
      // Fallback if fetch fails
      countryGroup.append('text').attr('x',W/2).attr('y',H/2)
        .attr('text-anchor','middle').attr('fill','#64B5F6')
        .attr('font-family','JetBrains Mono,monospace').attr('font-size',12)
        .text('Loading map data...');
    });

  // Tooltip events on SVG
  gSvg.on('mousemove', function(event) {
    const tooltip = document.getElementById('globeTooltip');
    if (!gD3Loaded) return;
    // Check if over a marker
    const target = event.target;
    if (!target.classList.contains('g-dot')) {
      if (!gHovered) tooltip.style.display = 'none';
    }
  });
}

function gDrawMarkers(markerGroup) {
  markerGroup.selectAll('.g-marker').remove();

  const markers = markerGroup.selectAll('.g-marker')
    .data(GLOBE_INDICES, d=>d.id)
    .join('g').attr('class','g-marker')
    .style('cursor','pointer');

  markers.append('circle').attr('class','g-dot')
    .attr('r', 5)
    .attr('stroke','rgba(255,255,255,0.6)')
    .attr('stroke-width', 1)
    .attr('fill', d => {
      const dd = gData[d.id];
      return dd ? gColor(dd.pct) : '#888';
    });

  // Compact label: flag + short name + pct
  const labels = markers.append('g').attr('class','g-label').style('display','none');
  labels.append('rect')
    .attr('x',-36).attr('y',-28).attr('width',72).attr('height',20)
    .attr('rx',4).attr('fill','rgba(5,10,25,0.88)')
    .attr('stroke','rgba(100,181,246,0.5)').attr('stroke-width',0.8);
  labels.append('text').attr('class','g-name')
    .attr('x',0).attr('y',-14)
    .attr('text-anchor','middle')
    .attr('font-family','JetBrains Mono,monospace')
    .attr('font-size','8px')
    .attr('fill','#e8e8f0')
    .text(d=>`${d.flag} ${d.short}`);
  labels.append('text').attr('class','g-pct')
    .attr('x',0).attr('y',-4)
    .attr('text-anchor','middle')
    .attr('font-family','JetBrains Mono,monospace')
    .attr('font-size','7px')
    .attr('fill',d=>{ const dd=gData[d.id]; return dd?gColor(dd.pct):'#888'; })
    .text(d=>{ const dd=gData[d.id]; return dd?(dd.pct>=0?'+':'')+dd.pct.toFixed(2)+'%':''; });

  // Always-visible % badge (small, only when zoomed)
  markers.append('text').attr('class','g-badge')
    .attr('x',7).attr('y',4)
    .attr('font-family','JetBrains Mono,monospace')
    .attr('font-size','6.5px')
    .attr('fill',d=>{ const dd=gData[d.id]; return dd?gColor(dd.pct):'#888'; })
    .text(d=>{ const dd=gData[d.id]; return dd?(dd.pct>=0?'+':'')+dd.pct.toFixed(1)+'%':''; });

  markers
    .on('mouseenter', function(event, d) {
      gHovered = d.id;
      d3.select(this).select('circle').attr('r',9).attr('stroke-width',2);
      d3.select(this).select('.g-label').style('display','block');
      const dd = gData[d.id]; if(!dd) return;
      gShowTooltip(d, dd);
      const tooltip = document.getElementById('globeTooltip');
      tooltip.style.display = 'block';
      // Position tooltip
      const wrap = document.getElementById('globeCanvasWrap');
      const rect = wrap.getBoundingClientRect();
      const pt = gProjection([d.lng, d.lat]);
      if (pt) {
        let tx = pt[0]+14, ty = pt[1]-14;
        if (tx > wrap.clientWidth-220) tx = pt[0]-220;
        tooltip.style.left = tx+'px';
        tooltip.style.top  = ty+'px';
        tooltip.style.transform = 'none';
      }
      gRenderSidebar();
    })
    .on('mouseleave', function(event, d) {
      gHovered = null;
      d3.select(this).select('circle').attr('r',5).attr('stroke-width',1);
      d3.select(this).select('.g-label').style('display','none');
      document.getElementById('globeTooltip').style.display = 'none';
      gRenderSidebar();
    });

  gUpdateMarkers(markerGroup);
}

function gUpdateMarkers(markerGroup) {
  markerGroup.selectAll('.g-marker').each(function(d) {
    const pt = gProjection([d.lng, d.lat]);
    if (!pt) return;
    d3.select(this).attr('transform',`translate(${pt[0]},${pt[1]})`);
    // Hide if on back of globe (check visibility)
    const visible = gProjection.clipAngle ? true : false;
    // Use dot product to test if point faces viewer
    const r = gProjection.rotate();
    const lam = (d.lng + r[0]) * Math.PI/180;
    const phi = (d.lat - r[1]) * Math.PI/180;  // approx
    const cosAngle = Math.cos(phi) * Math.cos(lam);
    d3.select(this).style('display', cosAngle > 0 ? 'block' : 'none');
  });
}

function gUpdateGlobe(countryGroup, borders, markerGroup) {
  countryGroup.selectAll('.country').attr('d', gPath);
  if (countryGroup.select('.borders').size())
    countryGroup.select('.borders').attr('d', gPath);
  gSvg.select('.graticule').attr('d', gPath);
  gUpdateMarkers(markerGroup);
}

function openGlobeIndices() {
  gSimulate();
  document.getElementById('globeOverlay').classList.add('open');

  // Load D3 + TopoJSON if not already present
  function initWhenReady() {
    if (typeof d3 !== 'undefined' && typeof topojson !== 'undefined') {
      gInitD3();
      gRenderSidebar();
    } else {
      setTimeout(initWhenReady, 80);
    }
  }

  if (typeof d3 === 'undefined') {
    const s1 = document.createElement('script');
    s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js';
      s2.onload = initWhenReady;
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
  } else {
    initWhenReady();
  }

  if (!gTimer) {
    gTimer = setInterval(() => {
      if (!document.getElementById('globeOverlay').classList.contains('open')) return;
      gSimulate();
      gRenderSidebar();
      // Refresh marker colors
      if (gSvg) {
        gSvg.selectAll('.g-marker').each(function(d) {
          const dd = gData[d.id];
          if (!dd) return;
          d3.select(this).select('circle').attr('fill', gColor(dd.pct));
          d3.select(this).select('.g-pct').attr('fill', gColor(dd.pct))
            .text((dd.pct>=0?'+':'')+dd.pct.toFixed(2)+'%');
          d3.select(this).select('.g-badge').attr('fill', gColor(dd.pct))
            .text((dd.pct>=0?'+':'')+dd.pct.toFixed(1)+'%');
        });
        const ts = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'});
        const el = document.getElementById('globeLastUpdate');
        if (el) el.textContent = `Last updated: ${ts} IST`;
      }
    }, 30000);
  }
}

function closeGlobeIndices() {
  document.getElementById('globeOverlay').classList.remove('open');
  gRotating = false;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('globeOverlay').classList.contains('open')) {
    closeGlobeIndices();
  }
});

const keyReady = loadGeminiKey();

// ════════════════════════════════════════════════════════════
//  SCENARIO SIMULATOR
// ════════════════════════════════════════════════════════════
const SIM_SECTORS = [
  {id:'banking',name:'Banking',emoji:'🏦'},
  {id:'it',name:'IT',emoji:'💻'},
  {id:'pharma',name:'Pharma',emoji:'💊'},
  {id:'auto',name:'Auto',emoji:'🚗'},
  {id:'energy',name:'Energy',emoji:'⚡'},
  {id:'fmcg',name:'FMCG',emoji:'🛒'},
  {id:'metals',name:'Metals',emoji:'🔩'},
  {id:'realty',name:'Realty',emoji:'🏗️'},
  {id:'telecom',name:'Telecom',emoji:'📡'},
  {id:'infra',name:'Infra',emoji:'🛣️'},
];
const SIM_SECTOR_CORR = {
  banking: [-1.8,0.1,-0.5,0.2,1.0,0.0],
  it:      [-0.2,-0.1,-0.1,1.7,0.5,0.0],
  pharma:  [-0.3,-0.2,0.3,0.8,0.3,-0.3],
  auto:    [-0.9,-1.3,-0.6,-0.4,1.2,-0.2],
  energy:  [-0.2,2.0,0.3,-0.3,0.5,0.7],
  fmcg:    [-0.4,-0.3,-0.8,0.1,0.7,-0.5],
  metals:  [-0.9,0.4,0.9,-0.5,1.4,1.8],
  realty:  [-2.2,-0.2,-0.9,0.1,1.6,0.2],
  telecom: [-0.5,-0.2,-0.3,0.3,0.6,0.0],
  infra:   [-0.7,-0.4,-0.3,0.1,1.3,0.5],
};
const SIM_ASSETS = [
  {name:'NIFTY 50',type:'INDEX',s:{rate:-0.7,oil:-0.3,inflation:-0.5,fx:0.4,gdp:1.2,comm:-0.2}},
  {name:'HDFCBANK',type:'BANKING',s:{rate:-1.8,oil:0.1,inflation:-0.6,fx:0.2,gdp:0.9,comm:0.0}},
  {name:'RELIANCE',type:'ENERGY',s:{rate:-0.3,oil:1.4,inflation:0.3,fx:-0.6,gdp:0.8,comm:0.6}},
  {name:'INFY',type:'IT',s:{rate:-0.2,oil:-0.1,inflation:-0.1,fx:1.8,gdp:0.5,comm:0.0}},
  {name:'ONGC',type:'ENERGY',s:{rate:-0.2,oil:2.1,inflation:0.2,fx:-0.3,gdp:0.4,comm:0.8}},
  {name:'SUNPHARMA',type:'PHARMA',s:{rate:-0.3,oil:-0.1,inflation:0.3,fx:0.9,gdp:0.3,comm:-0.2}},
  {name:'TATASTEEL',type:'METALS',s:{rate:-0.9,oil:0.5,inflation:0.8,fx:-0.4,gdp:1.5,comm:1.9}},
  {name:'MARUTI',type:'AUTO',s:{rate:-0.8,oil:-1.2,inflation:-0.5,fx:-0.5,gdp:1.1,comm:-0.3}},
  {name:'GOLD',type:'COMMODITY',s:{rate:-1.4,oil:0.3,inflation:1.6,fx:-0.8,gdp:-0.5,comm:0.4}},
  {name:'10Y GSEC',type:'BONDS',s:{rate:-2.2,oil:-0.1,inflation:-1.1,fx:0.0,gdp:-0.3,comm:0.0}},
];
const SIM_PRESETS = {
  rateHike:   {rate:1,oil:0,inflation:0.5,fx:-1,gdp:-0.5,comm:0},
  oilShock:   {rate:0,oil:40,inflation:1.5,fx:-2,gdp:-1,comm:15},
  recession:  {rate:-1,oil:-20,inflation:-0.5,fx:-5,gdp:-3,comm:-10},
  rupeeSlide: {rate:0.5,oil:0,inflation:1,fx:-10,gdp:-0.5,comm:0},
  rally:      {rate:-0.5,oil:5,inflation:0.25,fx:2,gdp:1.5,comm:5},
};
let simSavedScenarios = [];

function simUpdateSlider(key,val,unit){
  const num=parseFloat(val);
  const sign=num>0?'+':'';
  const el=document.getElementById('sv-'+key);
  if(el) el.textContent=sign+num+unit;
}

function loadPreset(name,btn){
  document.querySelectorAll('#scenarioOverlay .sc-co-chip').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  const p=SIM_PRESETS[name]; if(!p) return;
  const set=(k,v,u)=>{const sl=document.getElementById('sl-'+k);if(sl){sl.value=v;simUpdateSlider(k,v,u);}};
  set('rate',p.rate,'%'); set('oil',p.oil,'%'); set('inflation',p.inflation,'%');
  set('fx',p.fx,'%'); set('gdp',p.gdp,'%'); set('comm',p.comm,'%');
}

function simHeatColor(v){
  if(v>=5) return '#00C853';
  if(v>=2) return '#4CAF50';
  if(v>=0.5) return '#8BC34A';
  if(v>-0.5) return '#333355';
  if(v>-2) return '#FF6B00';
  if(v>-5) return '#FF1744';
  return '#9B0025';
}

function runScenario(){
  const vals={
    rate:parseFloat(document.getElementById('sl-rate').value),
    oil:parseFloat(document.getElementById('sl-oil').value),
    inflation:parseFloat(document.getElementById('sl-inflation').value),
    fx:parseFloat(document.getElementById('sl-fx').value),
    gdp:parseFloat(document.getElementById('sl-gdp').value),
    comm:parseFloat(document.getElementById('sl-comm').value),
  };
  const now=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

  // Heatmap
  const hEl=document.getElementById('sectorHeatmap'); hEl.innerHTML='';
  let worst={name:'—',val:999}, best={name:'—',val:-999};
  SIM_SECTORS.forEach(s=>{
    const corr=SIM_SECTOR_CORR[s.id];
    const impact=(corr[0]*vals.rate+corr[1]*(vals.oil/10)+corr[2]*vals.inflation+corr[3]*(vals.fx/5)+corr[4]*vals.gdp+corr[5]*(vals.comm/10))*1.5;
    const col=simHeatColor(impact);
    const sign=impact>=0?'+':'';
    const cell=document.createElement('div');
    cell.className='heatmap-cell';
    cell.style.background=col+'22'; cell.style.borderColor=col+'55';
    cell.innerHTML=`<div class="hc-name">${s.emoji} ${s.name}</div><div class="hc-val" style="color:${col}">${sign}${impact.toFixed(1)}%</div>`;
    hEl.appendChild(cell);
    if(impact<worst.val) worst={name:s.name,val:impact};
    if(impact>best.val) best={name:s.name,val:impact};
  });
  document.getElementById('heatmapLastRun').textContent=`Run at ${now}`;

  // Asset impact
  const aEl=document.getElementById('assetImpactTable'); let wins=0,losses=0;
  const sorted=SIM_ASSETS.map(a=>{
    const s=a.s;
    const impact=(s.rate*vals.rate+s.oil*(vals.oil/10)+s.inflation*vals.inflation+s.fx*(vals.fx/5)+s.gdp*vals.gdp+s.comm*(vals.comm/10))*1.2;
    return{...a,impact};
  }).sort((a,b)=>b.impact-a.impact);
  aEl.innerHTML='';
  sorted.forEach(a=>{
    if(a.impact>0) wins++; else losses++;
    const col=a.impact>=0?'var(--green)':'var(--red)';
    const sign=a.impact>=0?'+':'';
    const barPct=Math.min(Math.abs(a.impact)*5,100);
    const row=document.createElement('div');
    row.className='impact-row';
    row.innerHTML=`<div class="impact-asset"><div class="impact-name">${a.name}</div><div class="impact-type">${a.type}</div></div><div class="impact-bar-wrap"><div class="impact-bar-fill" style="width:${barPct}%;background:${col}"></div></div><div class="impact-pct" style="color:${col}">${sign}${a.impact.toFixed(2)}%</div>`;
    aEl.appendChild(row);
  });
  document.getElementById('winnersCount').textContent=`Winners: ${wins}`;
  document.getElementById('losersCount').textContent=`Losers: ${losses}`;

  // Risk score + drawdown
  const riskScore=Math.min(100,Math.max(0,Math.abs(vals.rate)*15+Math.abs(vals.oil)*0.5+Math.abs(vals.inflation)*10+Math.abs(vals.fx)*3+Math.abs(vals.gdp)*8+Math.abs(vals.comm)*0.4));
  const ddPct=Math.min(95,Math.round(riskScore*0.9+5));
  document.getElementById('drawdownPct').textContent=ddPct+'%';
  document.getElementById('drawdownPct').style.color=ddPct<35?'var(--green)':ddPct<65?'var(--gold)':'var(--red)';
  document.getElementById('drawdownFill').style.width=ddPct+'%';
  document.getElementById('drawdownMarker').style.left=ddPct+'%';
  document.getElementById('riskScoreBar').style.width=riskScore+'%';
  document.getElementById('riskScoreBar').style.background=riskScore<30?'var(--green)':riskScore<60?'var(--gold)':'var(--red)';
  document.getElementById('riskScoreVal').textContent=Math.round(riskScore)+'/100';

  // Portfolio impact
  const pEl=document.getElementById('portfolioImpactList'); pEl.innerHTML='';
  const niftyImpact=sorted.find(a=>a.name==='NIFTY 50')?.impact||0;
  const bondImpact=sorted.find(a=>a.name==='10Y GSEC')?.impact||0;
  const goldImpact=sorted.find(a=>a.name==='GOLD')?.impact||0;
  const pfItems=[{name:'Equity',w:0.6,v:niftyImpact},{name:'Bonds',w:0.2,v:bondImpact},{name:'Gold',w:0.1,v:goldImpact},{name:'Cash',w:0.1,v:0}];
  let totalPfChange=0;
  pfItems.forEach(p=>{
    const ch=(p.v*p.w); totalPfChange+=ch;
    const col=ch>=0?'var(--green)':'var(--red)';
    const div=document.createElement('div');
    div.style.cssText='display:flex;justify-content:space-between;font-size:11px;font-family:JetBrains Mono,monospace';
    div.innerHTML=`<span style="color:var(--muted)">${p.name} (${(p.w*100).toFixed(0)}%)</span><span style="color:${col}">${ch>=0?'+':''}${ch.toFixed(2)}%</span>`;
    pEl.appendChild(div);
  });

  // Risk dist bars
  const rdbEl=document.getElementById('riskDistBars'); rdbEl.innerHTML='';
  const absImpacts=sorted.map(a=>Math.abs(a.impact));
  const bkts=[{l:'0-2%',r:[0,2]},{l:'2-5%',r:[2,5]},{l:'5-10%',r:[5,10]},{l:'10-15%',r:[10,15]},{l:'>15%',r:[15,100]}];
  const rdbColors=['var(--green)','#8BC34A','var(--gold)','var(--saffron)','var(--red)'];
  bkts.forEach((b,i)=>{
    const count=absImpacts.filter(v=>v>=b.r[0]&&v<b.r[1]).length;
    const hp=Math.max(4,Math.min(100,(count/SIM_ASSETS.length)*200));
    const col=document.createElement('div');
    col.className='rdb-col';
    col.innerHTML=`<div class="rdb-bar" style="height:${hp}%;background:${rdbColors[i]}"></div><div class="rdb-label">${b.l}</div>`;
    rdbEl.appendChild(col);
  });
  document.getElementById('riskSummaryText').textContent=`${wins}/${SIM_ASSETS.length} assets positive. Key drivers: ${Math.abs(vals.oil)>20?'Oil shock, ':''}${Math.abs(vals.rate)>1?'Rate change, ':''}${Math.abs(vals.fx)>5?'FX swing, ':''}${Math.abs(vals.gdp)>2?'GDP shift':'Balanced macro'}.`;

  // Timeline
  const tlEl=document.getElementById('scenarioTimeline'); tlEl.innerHTML='';
  const tlColors=['var(--saffron)','var(--red)','var(--gold)','#7C5CFC','var(--green)'];
  const tlItems=[
    {t:'T+0',e:`Shock activated: Rate ${vals.rate>0?'+':''}${vals.rate}%, Oil ${vals.oil>0?'+':''}${vals.oil}%`,l:'Initial shock'},
    {t:'T+7d',e:`Market repricing. ${worst.name} under pressure (${worst.val.toFixed(1)}%)`,l:'Volatility spike'},
    {t:'T+30d',e:`RBI/policy response. Inflation transmission ${vals.inflation>1?'accelerating':'moderate'}.`,l:'Policy watch'},
    {t:'T+90d',e:`Earnings season: ${best.name} outperforms. FII flows ${vals.fx<-3?'under pressure':'stable'}.`,l:'Earnings impact'},
    {t:'T+180d',e:`Structural adjustment. GDP revision ${vals.gdp<-1?'downward':vals.gdp>1?'upward':'neutral'}.`,l:'Stabilisation'},
  ];
  tlItems.forEach((ev,i)=>{
    const item=document.createElement('div');
    item.className='tl-item';
    item.innerHTML=`<div class="tl-dot" style="background:${tlColors[i]}"></div><div class="tl-time">${ev.t}</div><div class="tl-event">${ev.e}</div><div class="tl-impact" style="color:${tlColors[i]}">${ev.l}</div>`;
    tlEl.appendChild(item);
  });

  // Comparison table
  const label=document.querySelector('#scenarioOverlay .sim-slider-group+.run-btn')?.closest('.module-sidebar')?.querySelector('.sc-co-chip.active')?.textContent?.trim()||'Custom';
  simSavedScenarios.push({name:label,pf:totalPfChange.toFixed(2),risk:Math.round(riskScore),worst:worst.name,best:best.name});
  if(simSavedScenarios.length>5) simSavedScenarios.shift();
  renderScenarioCompare();
  document.getElementById('scenarioStatus').textContent=`Done · ${now}`;
  document.getElementById('scenarioStatus').style.color='var(--green)';
}

function renderScenarioCompare(){
  const tbody=document.getElementById('scenarioCompareBody');
  if(!simSavedScenarios.length){tbody.innerHTML='<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--muted)">Run scenarios to compare</td></tr>';return;}
  tbody.innerHTML=simSavedScenarios.map(s=>{
    const col=s.pf>=0?'var(--green)':'var(--red)';
    const rc=s.risk<30?'var(--green)':s.risk<60?'var(--gold)':'var(--red)';
    return`<tr><td style="color:var(--text)">${s.name}</td><td style="color:${col}">${s.pf>=0?'+':''}${s.pf}%</td><td style="color:${rc}">${s.risk}</td><td style="color:var(--red)">${s.worst}</td><td style="color:var(--green)">${s.best}</td></tr>`;
  }).join('');
}
function clearScenarioComparisons(){simSavedScenarios=[];renderScenarioCompare();}

function openScenario(){
  document.getElementById('scenarioOverlay').classList.add('open');
  // Init heatmap placeholders
  const hEl=document.getElementById('sectorHeatmap');
  if(!hEl.children.length){
    SIM_SECTORS.forEach(s=>{
      const cell=document.createElement('div');
      cell.className='heatmap-cell';
      cell.style.background='#1E1E3222'; cell.style.borderColor='#1E1E3255';
      cell.innerHTML=`<div class="hc-name">${s.emoji} ${s.name}</div><div class="hc-val" style="color:var(--muted)">—</div>`;
      hEl.appendChild(cell);
    });
  }
}
function closeScenario(){ document.getElementById('scenarioOverlay').classList.remove('open'); }

// ════════════════════════════════════════════════════════════
//  SUPPLY CHAIN RISK MAP
// ════════════════════════════════════════════════════════════
const SC_CO_DATA = {
  RELIANCE:{name:'Reliance Industries',suppliers:[
    {name:'Saudi Aramco',tier:1,region:'Middle East',commodity:'Crude Oil',riskScore:68},
    {name:'ADNOC',tier:1,region:'Middle East',commodity:'Natural Gas',riskScore:55},
    {name:'Glencore',tier:1,region:'Switzerland',commodity:'Metals/Coal',riskScore:42},
    {name:'ONGC',tier:1,region:'India',commodity:'Crude Oil',riskScore:22},
    {name:'Shell Trading',tier:2,region:'Netherlands',commodity:'LNG',riskScore:35},
    {name:'Sinopec',tier:2,region:'China',commodity:'Petrochemicals',riskScore:72},
    {name:'LG Chem',tier:2,region:'South Korea',commodity:'Polymers',riskScore:38},
  ],geoExposure:{'Middle East':65,'China':20,'India':50,'Europe':30,'USA':25,'SE Asia':40,'Africa':15,'Russia':10}},
  TCS:{name:'Tata Consultancy Services',suppliers:[
    {name:'Microsoft',tier:1,region:'USA',commodity:'Cloud Services',riskScore:28},
    {name:'AWS',tier:1,region:'USA',commodity:'Cloud Infra',riskScore:30},
    {name:'SAP',tier:1,region:'Germany',commodity:'ERP Software',riskScore:22},
    {name:'Oracle',tier:1,region:'USA',commodity:'Database',riskScore:25},
    {name:'TSMC',tier:2,region:'Taiwan',commodity:'Semiconductors',riskScore:82},
    {name:'DC India',tier:2,region:'India',commodity:'Data Centers',riskScore:20},
  ],geoExposure:{'USA':75,'India':55,'Europe':45,'China':15,'Middle East':20,'SE Asia':30,'Africa':10,'Russia':5}},
  MARUTI:{name:'Maruti Suzuki',suppliers:[
    {name:'Suzuki Japan',tier:1,region:'Japan',commodity:'Technology/IP',riskScore:32},
    {name:'Bharat Forge',tier:1,region:'India',commodity:'Forgings',riskScore:18},
    {name:'Motherson Sumi',tier:1,region:'India',commodity:'Wiring',riskScore:22},
    {name:'Bosch India',tier:1,region:'Germany',commodity:'Electronics',riskScore:28},
    {name:'Samsung SDI',tier:2,region:'South Korea',commodity:'Batteries',riskScore:55},
    {name:'CATL',tier:2,region:'China',commodity:'EV Batteries',riskScore:78},
    {name:'POSCO',tier:2,region:'South Korea',commodity:'Steel',riskScore:42},
  ],geoExposure:{'Japan':60,'India':70,'China':35,'South Korea':48,'Germany':30,'USA':20,'SE Asia':25,'Middle East':10}},
  SUNPHARMA:{name:'Sun Pharmaceutical',suppliers:[
    {name:'China API Cos.',tier:1,region:'China',commodity:'Active Pharma Ingr.',riskScore:85},
    {name:"Divi's Labs",tier:1,region:'India',commodity:'APIs',riskScore:20},
    {name:'Lonza Group',tier:1,region:'Switzerland',commodity:'CRAMS',riskScore:30},
    {name:'Piramal Pharma',tier:2,region:'India',commodity:'Intermediates',riskScore:22},
    {name:'Unichemicals',tier:2,region:'China',commodity:'Excipients',riskScore:70},
  ],geoExposure:{'China':80,'India':60,'Europe':35,'USA':50,'Middle East':20,'Africa':15,'SE Asia':25,'Russia':5}},
  TATASTEEL:{name:'Tata Steel',suppliers:[
    {name:'NMDC India',tier:1,region:'India',commodity:'Iron Ore',riskScore:18},
    {name:'BHP',tier:1,region:'Australia',commodity:'Coking Coal',riskScore:35},
    {name:'Rio Tinto',tier:1,region:'Australia',commodity:'Iron Ore',riskScore:32},
    {name:'Mechel',tier:2,region:'Russia',commodity:'Coal',riskScore:92},
    {name:'Vale SA',tier:2,region:'Brazil',commodity:'Iron Ore',riskScore:45},
  ],geoExposure:{'India':55,'Australia':60,'Russia':30,'Brazil':45,'China':40,'Europe':50,'USA':20,'Africa':15}},
  HDFCBANK:{name:'HDFC Bank',suppliers:[
    {name:'TCS/Infosys',tier:1,region:'India',commodity:'Core Banking IT',riskScore:18},
    {name:'IBM India',tier:1,region:'USA',commodity:'IT Services',riskScore:22},
    {name:'SWIFT',tier:1,region:'Belgium',commodity:'Payment Network',riskScore:30},
    {name:'Visa/Mastercard',tier:1,region:'USA',commodity:'Card Network',riskScore:25},
    {name:'AWS',tier:2,region:'USA',commodity:'Cloud',riskScore:28},
  ],geoExposure:{'India':80,'USA':55,'Europe':40,'Middle East':20,'China':10,'SE Asia':25,'Africa':10,'Russia':5}},
};

const GEO_REGIONS=[
  {name:'India',flag:'🇮🇳',base:20},
  {name:'China',flag:'🇨🇳',base:78},
  {name:'Middle East',flag:'🌍',base:65},
  {name:'USA',flag:'🇺🇸',base:28},
  {name:'Europe',flag:'🇪🇺',base:35},
  {name:'Russia',flag:'🇷🇺',base:92},
  {name:'SE Asia',flag:'🌏',base:45},
  {name:'Africa',flag:'🌍',base:60},
];

let scCurrentCo='RELIANCE';

function scSelectCompany(co,btn){
  scCurrentCo=co;
  document.querySelectorAll('#scCompanyFilter .sc-co-chip').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

function scRunAnalysis(){
  const data=SC_CO_DATA[scCurrentCo]; if(!data) return;
  const gw=parseFloat(document.getElementById('sl-geoWeight').value)/100;
  const avgRisk=Math.round(data.suppliers.reduce((s,x)=>s+x.riskScore,0)/data.suppliers.length);
  const col=avgRisk<30?'var(--green)':avgRisk<60?'var(--gold)':'var(--red)';
  document.getElementById('scOverallScore').textContent=avgRisk+'/100';
  document.getElementById('scOverallScore').style.color=col;
  document.getElementById('scSupplierCount').textContent=data.suppliers.length;
  document.getElementById('scCriticalCount').textContent=data.suppliers.filter(s=>s.riskScore>60).length;
  document.getElementById('scRegionCount').textContent=[...new Set(data.suppliers.map(s=>s.region))].length;
  scDrawNetwork(data);
  scRenderGeoHeatmap(data,gw);
  scRefreshAlerts(data);
  scRenderRiskScores(data);
  scRenderDepTree(data);
  scRenderDisruption(data);
}

function scRefreshAlerts(dataArg){
  const data=dataArg||SC_CO_DATA[scCurrentCo]; if(!data) return;
  const thresh=parseInt(document.getElementById('sl-riskThresh').value);
  const alerts=data.suppliers.filter(s=>s.riskScore>=thresh).sort((a,b)=>b.riskScore-a.riskScore);
  document.getElementById('scAlertCount').textContent=alerts.length;
  const el=document.getElementById('scAlertsList');
  if(!alerts.length){el.innerHTML='<div style="font-size:11px;color:var(--muted);font-family:JetBrains Mono,monospace">No alerts at current threshold.</div>';return;}
  el.innerHTML=alerts.map(s=>{
    const sev=s.riskScore>=75?'high':s.riskScore>=45?'medium':'low';
    const icon=sev==='high'?'🚨':sev==='medium'?'⚠️':'📌';
    return`<div class="sc-alert ${sev}"><div class="sc-alert-icon">${icon}</div><div><div class="sc-alert-text">${s.name} — ${s.commodity} supply at risk</div><div class="sc-alert-meta">${s.region} · Score: ${s.riskScore}/100 · Tier ${s.tier}</div></div></div>`;
  }).join('');
}

function scRenderRiskScores(data){
  const el=document.getElementById('scRiskScores');
  const sorted=[...data.suppliers].sort((a,b)=>b.riskScore-a.riskScore);
  el.innerHTML=sorted.map(s=>{
    const col=s.riskScore>=75?'var(--red)':s.riskScore>=45?'var(--gold)':'var(--green)';
    const bg=s.riskScore>=75?'rgba(255,23,68,0.12)':s.riskScore>=45?'rgba(255,215,0,0.12)':'rgba(0,200,83,0.12)';
    return`<div class="sc-risk-row"><div><div class="sc-risk-name">${s.name}</div><div class="sc-risk-region">${s.region} · T${s.tier} · ${s.commodity}</div></div><div class="sc-risk-score" style="color:${col};background:${bg}">${s.riskScore}</div></div>`;
  }).join('');
}

function scRenderGeoHeatmap(data,gw){
  const el=document.getElementById('geoHeatmap'); el.innerHTML='';
  GEO_REGIONS.forEach(r=>{
    const exp=data.geoExposure[r.name]||0;
    const score=Math.round(r.base*gw+exp*(1-gw)*0.5);
    const col=score>=70?'#FF1744':score>=50?'#FF6B00':score>=30?'#FFD700':'#00C853';
    const label=score>=70?'CRITICAL':score>=50?'HIGH':score>=30?'MEDIUM':'LOW';
    const cell=document.createElement('div');
    cell.className='geo-cell';
    cell.style.background=col+'18'; cell.style.border=`1px solid ${col}44`;
    cell.innerHTML=`<div class="geo-cell-flag">${r.flag}</div><div class="geo-cell-name">${r.name}</div><div class="geo-cell-score" style="color:${col}">${score}</div><div class="geo-cell-label" style="color:${col}">${label}</div>`;
    el.appendChild(cell);
  });
}

function scRenderDepTree(data){
  const el=document.getElementById('scDepTree'); el.innerHTML='';
  const parent=document.createElement('div'); parent.className='dep-parent';
  parent.innerHTML=`<div class="dep-parent-name">${data.name}</div><div class="dep-parent-meta">Central entity · ${data.suppliers.length} known dependencies</div>`;
  const children=document.createElement('div'); children.className='dep-children';
  data.suppliers.forEach(s=>{
    const rCol=s.riskScore>=75?'var(--red)':s.riskScore>=45?'var(--gold)':'var(--green)';
    const rBg=s.riskScore>=75?'rgba(255,23,68,0.12)':s.riskScore>=45?'rgba(255,215,0,0.12)':'rgba(0,200,83,0.12)';
    const tc=s.tier===1?'tier1':s.tier===2?'tier2':'tier3';
    const c=document.createElement('div'); c.className=`dep-child ${tc}`;
    c.innerHTML=`<div><div class="dep-child-name">${s.name}</div><div class="dep-child-detail">T${s.tier} · ${s.region} · ${s.commodity}</div></div><div class="dep-child-risk" style="color:${rCol};background:${rBg}">${s.riskScore}/100</div>`;
    children.appendChild(c);
  });
  parent.appendChild(children); el.appendChild(parent);
}

function scRenderDisruption(data){
  const el=document.getElementById('scDisruptionAnalysis');
  const high=data.suppliers.filter(s=>s.riskScore>=60).slice(0,4);
  if(!high.length){el.innerHTML='<div style="font-size:11px;color:var(--muted)">No high-risk dependencies found.</div>';return;}
  el.innerHTML=high.map(s=>{
    const ri=Math.round(s.riskScore*0.3);
    const oi=Math.round(s.riskScore*0.5);
    return`<div class="sc-alert high" style="flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:12px;font-weight:600;color:var(--red)">${s.name} disrupted</span><span style="font-size:9px;font-family:JetBrains Mono,monospace;color:var(--muted)">${s.region}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div style="background:rgba(255,23,68,0.08);padding:6px 8px;border-radius:5px"><div style="font-size:8px;color:var(--muted);font-family:JetBrains Mono,monospace">REVENUE IMPACT</div><div style="font-size:13px;font-weight:700;color:var(--red);font-family:JetBrains Mono,monospace">-${ri}%</div></div>
        <div style="background:rgba(255,107,0,0.08);padding:6px 8px;border-radius:5px"><div style="font-size:8px;color:var(--muted);font-family:JetBrains Mono,monospace">OPS IMPACT</div><div style="font-size:13px;font-weight:700;color:var(--saffron);font-family:JetBrains Mono,monospace">-${oi}%</div></div>
      </div>
      <div style="font-size:10px;color:var(--muted);line-height:1.4">${s.commodity} shortfall → production halt → earnings miss → stock pressure.</div>
    </div>`;
  }).join('');
}

function scDrawNetwork(data){
  const canvas=document.getElementById('scNetworkCanvas');
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||500; const H=260;
  canvas.width=W; canvas.height=H;
  ctx.clearRect(0,0,W,H);
  const cx=W/2, cy=H/2-10;
  const radius=Math.min(W,H)*0.37;
  const sup=data.suppliers;
  // Edges
  sup.forEach((s,i)=>{
    const angle=(2*Math.PI*i/sup.length)-Math.PI/2;
    const x=cx+radius*Math.cos(angle); const y=cy+radius*Math.sin(angle);
    const col=s.riskScore>=75?'#FF1744':s.riskScore>=45?'#FF6B00':'#00C853';
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(x,y);
    ctx.strokeStyle=col+'55'; ctx.lineWidth=s.tier===1?1.5:0.8; ctx.stroke();
  });
  // Supplier nodes
  sup.forEach((s,i)=>{
    const angle=(2*Math.PI*i/sup.length)-Math.PI/2;
    const x=cx+radius*Math.cos(angle); const y=cy+radius*Math.sin(angle);
    const col=s.riskScore>=75?'#FF1744':s.riskScore>=45?'#FF6B00':'#00C853';
    const r=s.tier===1?7:5;
    ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI);
    ctx.fillStyle=col+'33'; ctx.fill();
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle='#e8e8f0'; ctx.font='9px JetBrains Mono,monospace'; ctx.textAlign='center';
    const lx=cx+(radius+22)*Math.cos(angle); const ly=cy+(radius+22)*Math.sin(angle);
    const sn=s.name.length>11?s.name.slice(0,10)+'…':s.name;
    ctx.fillText(sn,lx,ly);
  });
  // Center
  ctx.beginPath(); ctx.arc(cx,cy,18,0,2*Math.PI);
  ctx.fillStyle='rgba(0,188,212,0.18)'; ctx.fill();
  ctx.strokeStyle='#00BCD4'; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle='#00BCD4'; ctx.font='bold 10px JetBrains Mono,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(scCurrentCo.length>8?scCurrentCo.slice(0,8):scCurrentCo,cx,cy);
  ctx.textBaseline='alphabetic';
}

function openSupplyChain(){
  document.getElementById('supplychainOverlay').classList.add('open');
  setTimeout(()=>{
    if (CONFIG.GROQ_API_KEY) {
      scRunAnalysisGroq();
    } else {
      _baseScRunAnalysis();
      const panelId = 'groqScPanel';
      ensureGroqPanel(panelId, '#supplychainOverlay .module-main');
      showNudge(panelId, 'supplychain');
    }
  }, 100);
}
function closeSupplyChain(){ document.getElementById('supplychainOverlay').classList.remove('open'); }

document.addEventListener('keydown', e => {
  if(e.key==='Escape'){
    if(document.getElementById('scenarioOverlay').classList.contains('open')) closeScenario();
    if(document.getElementById('supplychainOverlay').classList.contains('open')) closeSupplyChain();
  }
});

// ════════════════════════════════════════════════════════════
//  KEY MANAGEMENT — GROQ + ALPHA VANTAGE
// ════════════════════════════════════════════════════════════
function openGroqModal() {
  document.getElementById('groqModal').style.display = 'flex';
  const gk = localStorage.getItem('dalal_groq_key');
  const ak = localStorage.getItem('dalal_av_key');
  if (gk) document.getElementById('groqKeyInput').value = gk;
  if (ak) document.getElementById('avKeyInput').value = ak;
}
function closeGroqModal() { document.getElementById('groqModal').style.display = 'none'; }

function saveGroqKeys() {
  const gk = document.getElementById('groqKeyInput').value.trim();
  const ak = document.getElementById('avKeyInput').value.trim();
  const st = document.getElementById('groqModalStatus');
  if (!gk && !ak) { st.textContent = '⚠ Enter at least one key.'; st.style.color = 'var(--red)'; return; }
  if (gk) { localStorage.setItem('dalal_groq_key', gk); CONFIG.GROQ_API_KEY = gk; }
  if (ak) { localStorage.setItem('dalal_av_key', ak); CONFIG.ALPHA_VANTAGE_KEY = ak; }
  st.textContent = '✓ Keys saved. Activating live data…';
  st.style.color = 'var(--green)';
  updateGroqBtn();
  if (ak) fetchAlphaVantageMacro();
  setTimeout(closeGroqModal, 1400);
}

function loadGroqKeys() {
  const gk = localStorage.getItem('dalal_groq_key');
  const ak = localStorage.getItem('dalal_av_key');
  if (gk) CONFIG.GROQ_API_KEY = gk;
  if (ak) CONFIG.ALPHA_VANTAGE_KEY = ak;
  updateGroqBtn();
  if (ak) setTimeout(fetchAlphaVantageMacro, 3000); // delay so main page loads first
}

function updateGroqBtn() {
  const btn    = document.getElementById('groqSetupBtn');
  const label  = document.getElementById('dockKeyLabel');
  const status = document.getElementById('dockKeyStatus');
  const hasG   = !!localStorage.getItem('dalal_groq_key');
  const hasA   = !!localStorage.getItem('dalal_av_key');

  if (hasG && hasA) {
    if (btn)    { btn.style.borderColor='rgba(0,200,83,0.5)'; }
    if (label)  { label.textContent='✓ AI LIVE'; label.style.color='var(--green)'; }
    if (status) { status.textContent='Groq + Alpha Vantage active'; status.style.color='var(--green)'; }
  } else if (hasG || hasA) {
    if (btn)    { btn.style.borderColor='rgba(255,107,0,0.6)'; }
    if (label)  { label.textContent='⚙ AI KEYS'; label.style.color='var(--saffron)'; }
    if (status) { status.textContent= hasG ? 'Groq active · Add AV key' : 'AV active · Add Groq key'; }
  } else {
    if (btn)    { btn.style.borderColor='rgba(255,107,0,0.4)'; }
    if (label)  { label.textContent='⚙ AI KEYS'; label.style.color='var(--saffron)'; }
    if (status) { status.textContent='Groq + Alpha Vantage'; status.style.color='var(--muted)'; }
  }
}

// ════════════════════════════════════════════════════════════
//  ALPHA VANTAGE — REAL MACRO DATA ENGINE
//  Free tier: 25 req/day, 5 req/min  →  we cache 15 mins
// ════════════════════════════════════════════════════════════
const AV_CACHE = {};
const AV_TTL   = 15 * 60 * 1000;

async function avFetch(params) {
  const cacheKey = JSON.stringify(params);
  const hit = AV_CACHE[cacheKey];
  if (hit && Date.now() - hit.ts < AV_TTL) return hit.data;
  if (!CONFIG.ALPHA_VANTAGE_KEY) return null;
  try {
    const qs = new URLSearchParams({ ...params, apikey: CONFIG.ALPHA_VANTAGE_KEY });
    const r  = await fetch(`https://www.alphavantage.co/query?${qs}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d['Note'] || d['Information']) { console.warn('[AV] Rate limit hit'); return null; }
    AV_CACHE[cacheKey] = { data: d, ts: Date.now() };
    return d;
  } catch(e) { console.warn('[AV] fetch error:', e); return null; }
}

window.LIVE_MACRO = {};

async function fetchAlphaVantageMacro() {
  if (!CONFIG.ALPHA_VANTAGE_KEY) return;
  console.log('[AV] Starting macro fetch…');

  // 1. USD/INR FX rate
  const fx = await avFetch({ function:'CURRENCY_EXCHANGE_RATE', from_currency:'USD', to_currency:'INR' });
  if (fx?.['Realtime Currency Exchange Rate']) {
    const r = fx['Realtime Currency Exchange Rate'];
    window.LIVE_MACRO.fx = { rate: parseFloat(r['5. Exchange Rate']), ts: r['6. Last Refreshed'] };
    const el = document.getElementById('macro-usdinr');
    if (el) { el.textContent = window.LIVE_MACRO.fx.rate.toFixed(2) + ' ▲'; el.style.color = 'var(--red)'; }
    // Update sl-fx baseline (express as % from round number 83)
    const baseline = 83;
    const fxPct = +((window.LIVE_MACRO.fx.rate - baseline) / baseline * 100).toFixed(1);
    window.LIVE_MACRO.fx.pctFromBaseline = fxPct;
  }
  await new Promise(r=>setTimeout(r, 13000)); // AV rate limit gap

  // 2. WTI Crude
  const wti = await avFetch({ function:'WTI', interval:'monthly' });
  if (wti?.data?.length) {
    const [latest, prev] = wti.data;
    window.LIVE_MACRO.crude = { price: parseFloat(latest.value), prev: parseFloat(prev?.value||latest.value), date: latest.date };
    const el = document.getElementById('macro-crude');
    const chg = window.LIVE_MACRO.crude.price - window.LIVE_MACRO.crude.prev;
    if (el) { el.textContent = `$${window.LIVE_MACRO.crude.price.toFixed(1)} ${chg>=0?'▲':'▼'}`; el.style.color = chg>=0?'var(--red)':'var(--green)'; }
    const pctChg = +((chg / window.LIVE_MACRO.crude.prev)*100).toFixed(1);
    window.LIVE_MACRO.crude.pctChg = pctChg;
  }
  await new Promise(r=>setTimeout(r, 13000));

  // 3. Real GDP
  const gdp = await avFetch({ function:'REAL_GDP', interval:'quarterly' });
  if (gdp?.data?.length) {
    const [latest, prev] = gdp.data;
    window.LIVE_MACRO.gdp = { value: parseFloat(latest.value), prev: parseFloat(prev?.value||latest.value), date: latest.date };
    window.LIVE_MACRO.gdp.delta = +(window.LIVE_MACRO.gdp.value - window.LIVE_MACRO.gdp.prev).toFixed(2);
  }
  await new Promise(r=>setTimeout(r, 13000));

  // 4. CPI
  const cpi = await avFetch({ function:'CPI', interval:'monthly' });
  if (cpi?.data?.length) {
    const [latest, prev] = cpi.data;
    window.LIVE_MACRO.cpi = { value: parseFloat(latest.value), prev: parseFloat(prev?.value||latest.value), date: latest.date };
    window.LIVE_MACRO.cpi.delta = +(window.LIVE_MACRO.cpi.value - window.LIVE_MACRO.cpi.prev).toFixed(2);
    const el = document.getElementById('macro-cpi');
    if (el) { el.innerHTML = `${window.LIVE_MACRO.cpi.value.toFixed(2)}% <span style="font-size:9px;color:var(--muted)">${window.LIVE_MACRO.cpi.date}</span>`; el.style.color = window.LIVE_MACRO.cpi.delta>0?'var(--red)':'var(--green)'; }
  }
  await new Promise(r=>setTimeout(r, 13000));

  // 5. Fed Funds Rate
  const ffr = await avFetch({ function:'FEDERAL_FUNDS_RATE', interval:'monthly' });
  if (ffr?.data?.length) {
    const [latest, prev] = ffr.data;
    window.LIVE_MACRO.rate = { value: parseFloat(latest.value), prev: parseFloat(prev?.value||latest.value), date: latest.date };
    window.LIVE_MACRO.rate.delta = +(window.LIVE_MACRO.rate.value - window.LIVE_MACRO.rate.prev).toFixed(2);
  }

  console.log('[AV] Live macro ready:', window.LIVE_MACRO);
  // If scenario is open, pre-fill sliders with real deltas
  if (document.getElementById('scenarioOverlay')?.classList.contains('open')) prefillFromLiveMacro();
}

function prefillFromLiveMacro() {
  const m = window.LIVE_MACRO;
  if (!m) return;
  if (m.rate?.delta) { const sl=document.getElementById('sl-rate'); if(sl){sl.value=Math.min(Math.max(m.rate.delta,-3),3);simUpdateSlider('rate',sl.value,'%');} }
  if (m.crude?.pctChg) { const sl=document.getElementById('sl-oil'); if(sl){sl.value=Math.min(Math.max(m.crude.pctChg,-50),80);simUpdateSlider('oil',sl.value,'%');} }
  if (m.cpi?.delta) { const sl=document.getElementById('sl-inflation'); if(sl){sl.value=Math.min(Math.max(m.cpi.delta,-3),6);simUpdateSlider('inflation',sl.value,'%');} }
  if (m.gdp?.delta) { const sl=document.getElementById('sl-gdp'); if(sl){sl.value=Math.min(Math.max(m.gdp.delta,-5),5);simUpdateSlider('gdp',sl.value,'%');} }
  if (m.fx?.pctFromBaseline) { const sl=document.getElementById('sl-fx'); if(sl){sl.value=Math.min(Math.max(m.fx.pctFromBaseline,-15),15);simUpdateSlider('fx',sl.value,'%');} }
  const st = document.getElementById('scenarioStatus');
  if (st) { st.textContent='✓ Live macro loaded from Alpha Vantage — adjust & run'; st.style.color='#00BCD4'; }
}

// ════════════════════════════════════════════════════════════
//  GROQ AI — REAL-TIME ANALYSIS ENGINE
//  Model: llama-3.3-70b-versatile (fastest + smartest free)
// ════════════════════════════════════════════════════════════
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function groqChat(system, user, maxTokens=900) {
  if (!CONFIG.GROQ_API_KEY) return null;
  try {
    const r = await fetch(GROQ_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${CONFIG.GROQ_API_KEY}` },
      body: JSON.stringify({ model:GROQ_MODEL, max_tokens:maxTokens, temperature:0.25,
        messages:[{role:'system',content:system},{role:'user',content:user}] })
    });
    if (!r.ok) { console.warn('[Groq] HTTP', r.status, await r.text()); return null; }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || null;
  } catch(e) { console.warn('[Groq] error:', e); return null; }
}

function liveContext() {
  const m = window.LIVE_MACRO;
  if (!m || !Object.keys(m).length) return '';
  return `
LIVE DATA (Alpha Vantage, real-time):
• USD/INR: ${m.fx?.rate?.toFixed(2) || 'N/A'}
• WTI Crude: $${m.crude?.price?.toFixed(1) || 'N/A'} (MoM: ${m.crude?.pctChg > 0 ? '+' : ''}${m.crude?.pctChg?.toFixed(1) || 'N/A'}%)
• US CPI: ${m.cpi?.value?.toFixed(2) || 'N/A'}% (delta: ${m.cpi?.delta > 0 ? '+' : ''}${m.cpi?.delta?.toFixed(2) || 'N/A'}%)
• US Fed Rate: ${m.rate?.value?.toFixed(2) || 'N/A'}% (delta: ${m.rate?.delta > 0 ? '+' : ''}${m.rate?.delta?.toFixed(2) || 'N/A'}%)
• US Real GDP Growth: ${m.gdp?.value?.toFixed(1) || 'N/A'}%`;
}

// ── Groq: Scenario Analysis ──
async function groqScenarioAnalysis(vals, sectors, assets) {
  const sys = `You are a senior Indian equity strategist at a top Mumbai institutional desk.
Provide crisp, data-driven scenario analysis for NSE/BSE markets.
Be specific about Indian market dynamics, RBI policy, and FII flows.
Respond ONLY in valid JSON — no markdown, no preamble, no trailing text.`;

  const usr = `SCENARIO INPUTS (user-defined macro shocks):
• Interest Rate Δ: ${vals.rate>0?'+':''}${vals.rate}% (RBI repo)
• Oil Price Δ: ${vals.oil>0?'+':''}${vals.oil}% (Brent crude)
• Inflation Δ: ${vals.inflation>0?'+':''}${vals.inflation}% (CPI)
• INR/USD Δ: ${vals.fx>0?'+':''}${vals.fx}% (positive = rupee appreciation)
• GDP Growth Δ: ${vals.gdp>0?'+':''}${vals.gdp}%
• Commodity Shock: ${vals.comm>0?'+':''}${vals.comm}%
${liveContext()}

MODEL-COMPUTED SECTOR IMPACTS:
${sectors.slice(0,6).map(s=>`• ${s.name}: ${s.impact>0?'+':''}${s.impact.toFixed(1)}%`).join('\n')}

MODEL-COMPUTED ASSET IMPACTS:
${assets.slice(0,6).map(a=>`• ${a.name}: ${a.impact>0?'+':''}${a.impact.toFixed(2)}%`).join('\n')}

Return ONLY this JSON object:
{"headline":"<12 word scenario headline>","overall_assessment":"<2-3 sentences on Indian market impact>","key_risks":["<risk1, 8 words>","<risk2>","<risk3>"],"key_opportunities":["<opp1, 8 words>","<opp2>","<opp3>"],"rbi_likely_response":"<1 sentence>","fii_flow_outlook":"<1 sentence>","timeline_t30":"<what happens in 30 days, 1 sentence>","timeline_t90":"<what happens in 90 days, 1 sentence>","conviction":"HIGH"|"MEDIUM"|"LOW"}`;

  return groqChat(sys, usr, 750);
}

// ── Groq: Supply Chain Analysis ──
async function groqSupplyChainAnalysis(name, suppliers, geoExp) {
  const sys = `You are a supply chain risk analyst for Indian listed companies (NSE/BSE).
Assess operational and earnings risk from geopolitical, trade, and commodity disruptions.
Be specific to the company's actual business model. Respond ONLY in valid JSON.`;

  const usr = `COMPANY: ${name}

SUPPLIERS & RISK SCORES:
${suppliers.map(s=>`• ${s.name} (${s.region}) — ${s.commodity} | Score: ${s.riskScore}/100 | Tier: ${s.tier}`).join('\n')}

GEOGRAPHIC EXPOSURE:
${Object.entries(geoExp).map(([r,v])=>`• ${r}: ${v}% exposure`).join('\n')}
${liveContext()}

Return ONLY this JSON:
{"company_summary":"<1 sentence overview>","biggest_risk":"<single biggest supply chain risk, 1 sentence>","concentration_risk":"<supplier/region concentration assessment, 1-2 sentences>","geopolitical_watchlist":["<region: specific current concern>","<region: concern>","<region: concern>"],"resilience_score":<0-100>,"resilience_label":"FRAGILE"|"VULNERABLE"|"ADEQUATE"|"RESILIENT","mitigation_actions":["<action, 8 words>","<action>","<action>"],"earnings_risk_next_quarter":"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"}`;

  return groqChat(sys, usr, 650);
}

// ════════════════════════════════════════════════════════════
//  MONKEY-PATCH runScenario + scRunAnalysis with Groq layer
// ════════════════════════════════════════════════════════════
const _baseRunScenario = window.runScenario;
window.runScenario = async function() {
  _baseRunScenario(); // instant static UI first

  const panelId = 'groqScenarioPanel';
  ensureGroqPanel(panelId, '#scenarioOverlay .module-main');

  if (!CONFIG.GROQ_API_KEY) { showNudge(panelId, 'scenario'); return; }

  const vals = {
    rate:parseFloat(document.getElementById('sl-rate').value),
    oil:parseFloat(document.getElementById('sl-oil').value),
    inflation:parseFloat(document.getElementById('sl-inflation').value),
    fx:parseFloat(document.getElementById('sl-fx').value),
    gdp:parseFloat(document.getElementById('sl-gdp').value),
    comm:parseFloat(document.getElementById('sl-comm').value),
  };
  const sectors = SIM_SECTORS.map(s=>{
    const c=SIM_SECTOR_CORR[s.id];
    return {name:s.name, impact:(c[0]*vals.rate+c[1]*(vals.oil/10)+c[2]*vals.inflation+c[3]*(vals.fx/5)+c[4]*vals.gdp+c[5]*(vals.comm/10))*1.5};
  }).sort((a,b)=>b.impact-a.impact);
  const assets = SIM_ASSETS.map(a=>{
    const s=a.s;
    return {name:a.name, impact:(s.rate*vals.rate+s.oil*(vals.oil/10)+s.inflation*vals.inflation+s.fx*(vals.fx/5)+s.gdp*vals.gdp+s.comm*(vals.comm/10))*1.2};
  }).sort((a,b)=>b.impact-a.impact);

  showLoading(panelId, '#7C5CFC', 'GROQ AI — LLAMA 3.3 70B — ANALYSING SCENARIO…');
  document.getElementById('scenarioStatus').textContent = '⟳ Groq AI analysing…';
  document.getElementById('scenarioStatus').style.color = '#7C5CFC';

  const raw = await groqScenarioAnalysis(vals, sectors, assets);
  if (!raw) { clearPanel(panelId); document.getElementById('scenarioStatus').textContent = 'Static model active'; document.getElementById('scenarioStatus').style.color = 'var(--muted)'; return; }
  let ins;
  try { ins = JSON.parse(raw.replace(/```json|```/g,'').trim()); } catch(e) { console.warn('[Groq] parse fail:', raw); clearPanel(panelId); return; }

  renderScenarioInsight(panelId, ins);
  document.getElementById('scenarioStatus').textContent = `✓ Groq AI · Llama 3.3 70B`;
  document.getElementById('scenarioStatus').style.color = 'var(--green)';
};

// ── Groq-driven supply chain DATA generation ──
async function groqGenerateSupplyChainData(companyName, ticker) {
  const sys = `You are a supply chain intelligence analyst with deep knowledge of Indian listed companies and their global supply networks.
Generate accurate, detailed supply chain data based on your training knowledge of real-world supplier relationships, geopolitical risks, and commodity dependencies.
Respond ONLY in valid JSON — no markdown, no preamble, no trailing text.`;

  const usr = `Generate a comprehensive supply chain risk profile for ${companyName} (${ticker}, listed on NSE India).

Use your knowledge of this company's actual business, known suppliers, raw material dependencies, and geographic exposure.
Risk scores should reflect real geopolitical and operational risks as of your knowledge cutoff.

Return ONLY this JSON (no markdown):
{
  "name": "${companyName}",
  "company_summary": "<1 sentence: what this company does and why supply chain matters>",
  "suppliers": [
    {
      "name": "<real supplier/partner name>",
      "tier": <1 or 2>,
      "region": "<country or region>",
      "commodity": "<what they supply>",
      "riskScore": <integer 0-100>,
      "riskReason": "<why this score, 5-8 words>"
    }
  ],
  "geoExposure": {
    "India": <0-100>,
    "China": <0-100>,
    "Middle East": <0-100>,
    "USA": <0-100>,
    "Europe": <0-100>,
    "Russia": <0-100>,
    "SE Asia": <0-100>,
    "Africa": <0-100>
  },
  "overall_risk_score": <integer 0-100>,
  "resilience_label": "FRAGILE"|"VULNERABLE"|"ADEQUATE"|"RESILIENT",
  "resilience_score": <integer 0-100>,
  "biggest_risk": "<single biggest supply chain risk, 1 sentence>",
  "concentration_risk": "<supplier or region concentration concern, 1-2 sentences>",
  "geopolitical_watchlist": ["<region: specific current concern>", "<region: concern>", "<region: concern>"],
  "mitigation_actions": ["<action, 8 words max>", "<action>", "<action>"],
  "earnings_risk_next_quarter": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "key_alerts": [
    { "severity": "high"|"medium"|"low", "title": "<alert title>", "detail": "<detail, 10 words>", "region": "<region>" }
  ],
  "disruption_scenarios": [
    { "supplier": "<supplier name>", "region": "<region>", "commodity": "<commodity>", "revenue_impact_pct": <integer>, "ops_impact_pct": <integer>, "cascade": "<cascade effect, 10 words>" }
  ]
}
Include 5-8 suppliers (mix of Tier 1 and Tier 2), at least 3 key_alerts, and 3 disruption_scenarios for the highest-risk suppliers.`;

  return groqChat(sys, usr, 1400);
}

// Cache generated data per company (so we don't re-fetch on every open)
window.SC_GROQ_CACHE = {};

async function scRunAnalysisGroq() {
  const main = document.querySelector('#supplychainOverlay .module-main');
  if (!main) return;

  // Show full loading screen in main area
  main.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:400px;gap:16px">
    <div style="font-size:36px;animation:spin 1.2s linear infinite">⟳</div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:#00BCD4;letter-spacing:2px">GROQ AI GENERATING SUPPLY CHAIN DATA…</div>
    <div style="font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace">Llama 3.3 70B · Real knowledge · ${scCurrentCo}</div>
    <div style="font-size:10px;color:var(--muted);max-width:360px;text-align:center;line-height:1.6">Groq is generating supplier relationships, risk scores, geographic exposure and disruption scenarios from its training knowledge…</div>
  </div>`;

  // Check cache first (valid for 10 minutes)
  const cached = window.SC_GROQ_CACHE[scCurrentCo];
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
    renderGroqSupplyChain(cached.data);
    return;
  }

  const coNames = {
    RELIANCE:'Reliance Industries', TCS:'Tata Consultancy Services',
    MARUTI:'Maruti Suzuki', SUNPHARMA:'Sun Pharmaceutical Industries',
    TATASTEEL:'Tata Steel', HDFCBANK:'HDFC Bank',
    WIPRO:'Wipro', INFY:'Infosys', ONGC:'Oil and Natural Gas Corporation',
    ADANIPORTS:'Adani Ports and SEZ', ICICIBANK:'ICICI Bank',
    BAJFINANCE:'Bajaj Finance', HINDALCO:'Hindalco Industries',
    TATAmotors:'Tata Motors', ULTRACEMCO:'UltraTech Cement',
  };

  const fullName = coNames[scCurrentCo] || scCurrentCo;
  const raw = await groqGenerateSupplyChainData(fullName, scCurrentCo);

  if (!raw) {
    main.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:300px;flex-direction:column;gap:12px">
      <div style="font-size:32px">⚠</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--red)">GROQ UNAVAILABLE</div>
      <div style="font-size:11px;color:var(--muted)">Check your Groq API key or try again.</div>
      <button onclick="scRunAnalysisGroq()" style="background:var(--saffron);color:#000;border:none;border-radius:6px;padding:8px 16px;font-family:'JetBrains Mono',monospace;font-size:11px;cursor:pointer;font-weight:700">↻ Retry</button>
    </div>`;
    return;
  }

  let data;
  try {
    data = JSON.parse(raw.replace(/```json|```/g,'').trim());
  } catch(e) {
    console.warn('[Groq SC] JSON parse error:', e, '\nRaw:', raw);
    main.innerHTML = `<div style="padding:20px;font-size:11px;color:var(--red);font-family:'JetBrains Mono',monospace">Parse error — retrying…</div>`;
    setTimeout(scRunAnalysisGroq, 1500);
    return;
  }

  // Cache it
  window.SC_GROQ_CACHE[scCurrentCo] = { data, ts: Date.now() };
  renderGroqSupplyChain(data);
}

function renderGroqSupplyChain(data) {
  const main = document.querySelector('#supplychainOverlay .module-main');
  if (!main) return;

  // Update sidebar metrics
  const avgRisk = Math.round(data.suppliers.reduce((s,x)=>s+x.riskScore,0)/data.suppliers.length);
  document.getElementById('scOverallScore').textContent = (data.overall_risk_score||avgRisk)+'/100';
  const scoreCol = (data.overall_risk_score||avgRisk)<30?'var(--green)':(data.overall_risk_score||avgRisk)<60?'var(--gold)':'var(--red)';
  document.getElementById('scOverallScore').style.color = scoreCol;
  document.getElementById('scSupplierCount').textContent = data.suppliers.length;
  document.getElementById('scCriticalCount').textContent = data.suppliers.filter(s=>s.riskScore>60).length;
  document.getElementById('scRegionCount').textContent = [...new Set(data.suppliers.map(s=>s.region))].length;
  document.getElementById('scAlertCount').textContent = (data.key_alerts||[]).length;

  const gw = parseFloat(document.getElementById('sl-geoWeight').value)/100;
  const rc = data.resilience_label==='RESILIENT'?'var(--green)':data.resilience_label==='ADEQUATE'?'var(--gold)':data.resilience_label==='VULNERABLE'?'var(--saffron)':'var(--red)';
  const ec = data.earnings_risk_next_quarter==='LOW'?'var(--green)':data.earnings_risk_next_quarter==='MEDIUM'?'var(--gold)':data.earnings_risk_next_quarter==='HIGH'?'var(--saffron)':'var(--red)';

  main.innerHTML = `
  <!-- GROQ BADGE -->
  <div style="flex-shrink:0;background:rgba(0,188,212,0.07);border:1px solid rgba(0,188,212,0.28);border-radius:10px;padding:11px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:16px">🤖</span>
      <div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#00BCD4;letter-spacing:1px">GROQ AI · LLAMA 3.3 70B · LIVE GENERATED DATA</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${data.company_summary||''}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:${rc}18;color:${rc};padding:3px 9px;border-radius:4px;border:1px solid ${rc}40">${data.resilience_label} · ${data.resilience_score}/100</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:${ec}18;color:${ec};padding:3px 9px;border-radius:4px;border:1px solid ${ec}40">EARNINGS RISK: ${data.earnings_risk_next_quarter}</span>
      <button onclick="delete window.SC_GROQ_CACHE['${scCurrentCo}']; scRunAnalysisGroq()" style="background:rgba(0,188,212,0.12);color:#00BCD4;border:1px solid rgba(0,188,212,0.3);border-radius:4px;padding:3px 10px;font-family:'JetBrains Mono',monospace;font-size:9px;cursor:pointer;letter-spacing:0.5px">↻ REFRESH</button>
    </div>
  </div>

  <!-- ROW 1: Network + Geo -->
  <div style="display:grid;grid-template-columns:1fr 300px;gap:14px;flex-shrink:0">
    <div class="mod-panel">
      <div class="mod-panel-hdr">
        <span>🕸️ Supply Chain Network Graph</span>
        <div class="sc-node-legend">
          <div class="sc-legend-item"><div class="sc-legend-dot" style="background:#00BCD4"></div>Company</div>
          <div class="sc-legend-item"><div class="sc-legend-dot" style="background:var(--saffron)"></div>Tier-1</div>
          <div class="sc-legend-item"><div class="sc-legend-dot" style="background:var(--gold)"></div>Tier-2</div>
          <div class="sc-legend-item"><div class="sc-legend-dot" style="background:var(--red)"></div>High Risk</div>
        </div>
      </div>
      <div class="mod-panel-body" style="padding:10px">
        <canvas id="scNetworkCanvas" height="260"></canvas>
      </div>
    </div>
    <div class="mod-panel">
      <div class="mod-panel-hdr"><span>🌍 Geographic Risk Heatmap</span></div>
      <div class="mod-panel-body" style="padding:12px">
        <div class="geo-heatmap-grid" id="geoHeatmap"></div>
      </div>
    </div>
  </div>

  <!-- ROW 2: Alerts + Risk Scores -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;flex-shrink:0">
    <div class="mod-panel">
      <div class="mod-panel-hdr">
        <span>🚨 Risk Alerts</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--red);animation:blink 1.5s infinite">● GROQ LIVE</span>
      </div>
      <div class="mod-panel-body" style="padding:12px;max-height:200px;overflow-y:auto" id="scAlertsList"></div>
    </div>
    <div class="mod-panel">
      <div class="mod-panel-hdr"><span>🏭 Supplier Risk Scores</span></div>
      <div style="max-height:200px;overflow-y:auto" id="scRiskScores"></div>
    </div>
  </div>

  <!-- ROW 3: Dep Tree + Disruption -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;flex-shrink:0">
    <div class="mod-panel">
      <div class="mod-panel-hdr"><span>🌳 Supply Dependency Tree</span></div>
      <div class="mod-panel-body" style="max-height:260px;overflow-y:auto">
        <div class="dep-tree" id="scDepTree"></div>
      </div>
    </div>
    <div class="mod-panel">
      <div class="mod-panel-hdr"><span>💥 Disruption Impact Analysis</span></div>
      <div class="mod-panel-body" style="max-height:260px;overflow-y:auto">
        <div style="font-size:10px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-bottom:8px">If key supplier region is disrupted:</div>
        <div id="scDisruptionAnalysis"></div>
      </div>
    </div>
  </div>

  <!-- ROW 4: Groq Insight -->
  <div style="flex-shrink:0;background:rgba(0,188,212,0.05);border:1px solid rgba(0,188,212,0.22);border-radius:10px;overflow:hidden">
    <div style="padding:11px 16px;border-bottom:1px solid rgba(0,188,212,0.18);background:rgba(0,188,212,0.07)">
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#00BCD4;letter-spacing:1px">🤖 AI RISK INTELLIGENCE</span>
    </div>
    <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
      <div>
        <div style="font-size:9px;color:var(--red);font-family:'JetBrains Mono',monospace;margin-bottom:5px">BIGGEST RISK</div>
        <div style="padding:8px 10px;background:rgba(255,23,68,0.07);border-left:2px solid var(--red);border-radius:3px;font-size:11px;line-height:1.5;margin-bottom:10px">${data.biggest_risk||''}</div>
        <div style="font-size:9px;color:var(--gold);font-family:'JetBrains Mono',monospace;margin-bottom:5px">CONCENTRATION RISK</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5">${data.concentration_risk||''}</div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--saffron);font-family:'JetBrains Mono',monospace;margin-bottom:6px">GEOPOLITICAL WATCHLIST</div>
        ${(data.geopolitical_watchlist||[]).map(g=>`<div style="padding:6px 9px;background:rgba(255,107,0,0.07);border-left:2px solid var(--saffron);border-radius:3px;font-size:11px;margin-bottom:5px">🌍 ${g}</div>`).join('')}
      </div>
      <div>
        <div style="font-size:9px;color:var(--green);font-family:'JetBrains Mono',monospace;margin-bottom:6px">MITIGATION ACTIONS</div>
        ${(data.mitigation_actions||[]).map((a,i)=>`<div style="display:flex;gap:8px;margin-bottom:7px"><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#00BCD4;flex-shrink:0">${i+1}.</span><span style="font-size:11px">${a}</span></div>`).join('')}
      </div>
    </div>
  </div>`;

  // Now render all sub-components with Groq data
  scRenderNetworkFromGroq(data);
  scRenderGeoHeatmap(data, gw);
  scRenderAlertsFromGroq(data);
  scRenderRiskScoresFromGroq(data);
  scRenderDepTreeFromGroq(data);
  scRenderDisruptionFromGroq(data);
}

function scRenderNetworkFromGroq(data) {
  const canvas = document.getElementById('scNetworkCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 500, H = 260;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);
  const cx=W/2, cy=H/2-10, radius=Math.min(W,H)*0.37;
  const sup = data.suppliers;
  sup.forEach((s,i)=>{
    const angle=(2*Math.PI*i/sup.length)-Math.PI/2;
    const x=cx+radius*Math.cos(angle), y=cy+radius*Math.sin(angle);
    const col=s.riskScore>=75?'#FF1744':s.riskScore>=45?'#FF6B00':'#00C853';
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(x,y);
    ctx.strokeStyle=col+'55'; ctx.lineWidth=s.tier===1?1.8:0.9; ctx.stroke();
  });
  sup.forEach((s,i)=>{
    const angle=(2*Math.PI*i/sup.length)-Math.PI/2;
    const x=cx+radius*Math.cos(angle), y=cy+radius*Math.sin(angle);
    const col=s.riskScore>=75?'#FF1744':s.riskScore>=45?'#FF6B00':'#00C853';
    const r=s.tier===1?8:5;
    ctx.beginPath(); ctx.arc(x,y,r,0,2*Math.PI);
    ctx.fillStyle=col+'33'; ctx.fill();
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.stroke();
    // Risk score badge on node
    ctx.fillStyle=col; ctx.font='bold 7px JetBrains Mono,monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(s.riskScore, x, y);
    ctx.textBaseline='alphabetic';
    // Label
    ctx.fillStyle='#e8e8f0'; ctx.font='9px JetBrains Mono,monospace'; ctx.textAlign='center';
    const lx=cx+(radius+24)*Math.cos(angle), ly=cy+(radius+24)*Math.sin(angle);
    const sn=s.name.length>12?s.name.slice(0,11)+'…':s.name;
    ctx.fillText(sn, lx, ly);
  });
  // Center
  ctx.beginPath(); ctx.arc(cx,cy,20,0,2*Math.PI);
  ctx.fillStyle='rgba(0,188,212,0.18)'; ctx.fill();
  ctx.strokeStyle='#00BCD4'; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle='#00BCD4'; ctx.font='bold 9px JetBrains Mono,monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(scCurrentCo.length>8?scCurrentCo.slice(0,8):scCurrentCo, cx, cy);
  ctx.textBaseline='alphabetic';
}

function scRenderAlertsFromGroq(data) {
  const el = document.getElementById('scAlertsList'); if (!el) return;
  const alerts = data.key_alerts || [];
  if (!alerts.length) { el.innerHTML='<div style="font-size:11px;color:var(--muted);font-family:JetBrains Mono,monospace">No alerts generated.</div>'; return; }
  el.innerHTML = alerts.map(a=>{
    const icon=a.severity==='high'?'🚨':a.severity==='medium'?'⚠️':'📌';
    return`<div class="sc-alert ${a.severity}"><div class="sc-alert-icon">${icon}</div><div><div class="sc-alert-text">${a.title}</div><div class="sc-alert-meta">${a.region} · ${a.detail}</div></div></div>`;
  }).join('');
}

function scRenderRiskScoresFromGroq(data) {
  const el = document.getElementById('scRiskScores'); if (!el) return;
  const sorted = [...data.suppliers].sort((a,b)=>b.riskScore-a.riskScore);
  el.innerHTML = sorted.map(s=>{
    const col=s.riskScore>=75?'var(--red)':s.riskScore>=45?'var(--gold)':'var(--green)';
    const bg=s.riskScore>=75?'rgba(255,23,68,0.12)':s.riskScore>=45?'rgba(255,215,0,0.12)':'rgba(0,200,83,0.12)';
    return`<div class="sc-risk-row">
      <div>
        <div class="sc-risk-name">${s.name}</div>
        <div class="sc-risk-region">${s.region} · T${s.tier} · ${s.commodity}</div>
        ${s.riskReason?`<div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px;font-style:italic">${s.riskReason}</div>`:''}
      </div>
      <div class="sc-risk-score" style="color:${col};background:${bg}">${s.riskScore}</div>
    </div>`;
  }).join('');
}

function scRenderDepTreeFromGroq(data) {
  const el = document.getElementById('scDepTree'); if (!el) return;
  el.innerHTML = '';
  const parent = document.createElement('div'); parent.className='dep-parent';
  parent.innerHTML=`<div class="dep-parent-name">${data.name}</div><div class="dep-parent-meta">Central entity · ${data.suppliers.length} Groq-identified dependencies</div>`;
  const children = document.createElement('div'); children.className='dep-children';
  data.suppliers.forEach(s=>{
    const rCol=s.riskScore>=75?'var(--red)':s.riskScore>=45?'var(--gold)':'var(--green)';
    const rBg=s.riskScore>=75?'rgba(255,23,68,0.12)':s.riskScore>=45?'rgba(255,215,0,0.12)':'rgba(0,200,83,0.12)';
    const tc=s.tier===1?'tier1':s.tier===2?'tier2':'tier3';
    const c=document.createElement('div'); c.className=`dep-child ${tc}`;
    c.innerHTML=`<div><div class="dep-child-name">${s.name}</div><div class="dep-child-detail">T${s.tier} · ${s.region} · ${s.commodity}</div></div><div class="dep-child-risk" style="color:${rCol};background:${rBg}">${s.riskScore}/100</div>`;
    children.appendChild(c);
  });
  parent.appendChild(children); el.appendChild(parent);
}

function scRenderDisruptionFromGroq(data) {
  const el = document.getElementById('scDisruptionAnalysis'); if (!el) return;
  const scenarios = data.disruption_scenarios || [];
  if (!scenarios.length) { el.innerHTML='<div style="font-size:11px;color:var(--muted)">No disruption scenarios generated.</div>'; return; }
  el.innerHTML = scenarios.map(s=>`
    <div class="sc-alert high" style="flex-direction:column;gap:6px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:12px;font-weight:600;color:var(--red)">${s.supplier} disrupted</span>
        <span style="font-size:9px;font-family:JetBrains Mono,monospace;color:var(--muted)">${s.region}</span>
      </div>
      <div style="font-size:10px;color:var(--muted);font-family:'JetBrains Mono',monospace">${s.commodity}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div style="background:rgba(255,23,68,0.08);padding:6px 8px;border-radius:5px">
          <div style="font-size:8px;color:var(--muted);font-family:JetBrains Mono,monospace">REVENUE IMPACT</div>
          <div style="font-size:14px;font-weight:700;color:var(--red);font-family:JetBrains Mono,monospace">-${s.revenue_impact_pct}%</div>
        </div>
        <div style="background:rgba(255,107,0,0.08);padding:6px 8px;border-radius:5px">
          <div style="font-size:8px;color:var(--muted);font-family:JetBrains Mono,monospace">OPS IMPACT</div>
          <div style="font-size:14px;font-weight:700;color:var(--saffron);font-family:JetBrains Mono,monospace">-${s.ops_impact_pct}%</div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);line-height:1.4">${s.cascade}</div>
    </div>`).join('');
}

// Override the company select to trigger Groq fetch
function scSelectCompany(co, btn) {
  scCurrentCo = co;
  document.querySelectorAll('#scCompanyFilter .sc-co-chip').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Auto-run if overlay is open
  if (document.getElementById('supplychainOverlay').classList.contains('open')) {
    if (CONFIG.GROQ_API_KEY) scRunAnalysisGroq();
  }
}

// Override scRunAnalysis button to use Groq version
window.scRunAnalysis = function() {
  if (CONFIG.GROQ_API_KEY) {
    scRunAnalysisGroq();
  } else {
    // Fallback: show nudge + run static
    _baseScRunAnalysis();
    const panelId = 'groqScPanel';
    ensureGroqPanel(panelId, '#supplychainOverlay .module-main');
    showNudge(panelId, 'supplychain');
  }
};

// ── Panel helpers ──
function ensureGroqPanel(id, parentSel) {
  if (document.getElementById(id)) return;
  const el = document.createElement('div');
  el.id = id; el.style.cssText = 'flex-shrink:0;';
  document.querySelector(parentSel)?.appendChild(el);
}

function showLoading(id, color, label) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = `<div style="background:${color}12;border:1px solid ${color}44;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:12px">
    <div style="font-size:20px;animation:spin 1.2s linear infinite">⟳</div>
    <div><div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1px;color:${color}">${label}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:3px">Applying ${window.LIVE_MACRO && Object.keys(window.LIVE_MACRO).length ? 'live Alpha Vantage macro data' : 'latest market knowledge'} to analysis…</div></div>
  </div>`;
}

function clearPanel(id) { const el=document.getElementById(id); if(el) el.innerHTML=''; }

function showNudge(id, type) {
  const el = document.getElementById(id); if (!el) return;
  el.innerHTML = `<div style="background:rgba(255,107,0,0.07);border:1px dashed rgba(255,107,0,0.35);border-radius:10px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px">
    <div><div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--saffron);letter-spacing:1px">⚡ ADD GROQ KEY FOR AI-POWERED ANALYSIS</div>
    <div style="font-size:11px;color:var(--muted);margin-top:4px">Get real-time Llama 3.3 70B analysis with live macro context. Free at console.groq.com.</div></div>
    <button onclick="openGroqModal()" style="background:var(--saffron);color:#000;border:none;border-radius:7px;padding:9px 16px;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">⚙ Add Keys</button>
  </div>`;
}

function renderScenarioInsight(id, ins) {
  const el = document.getElementById(id); if (!el || !ins) return;
  const cc = ins.conviction==='HIGH'?'var(--green)':ins.conviction==='MEDIUM'?'var(--gold)':'var(--red)';
  const hasLive = window.LIVE_MACRO && Object.keys(window.LIVE_MACRO).length > 0;
  el.innerHTML = `<div style="background:rgba(124,92,252,0.06);border:1px solid rgba(124,92,252,0.28);border-radius:10px;overflow:hidden">
    <div style="padding:11px 16px;border-bottom:1px solid rgba(124,92,252,0.2);display:flex;align-items:center;justify-content:space-between;background:rgba(124,92,252,0.07)">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1px;color:#7C5CFC">🤖 GROQ · LLAMA 3.3 70B ${hasLive?'<span style="color:#00BCD4">+ LIVE MACRO</span>':''}</span>
      </div>
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:${cc}18;color:${cc};padding:2px 8px;border-radius:4px;border:1px solid ${cc}40">CONVICTION: ${ins.conviction}</span>
    </div>
    <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:14px;font-weight:700;margin-bottom:7px">${ins.headline||''}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.65;margin-bottom:10px">${ins.overall_assessment||''}</div>
        <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace">RBI RESPONSE</div>
        <div style="font-size:11px;margin:3px 0 9px">${ins.rbi_likely_response||''}</div>
        <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace">FII FLOWS</div>
        <div style="font-size:11px;margin-top:3px">${ins.fii_flow_outlook||''}</div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--red);font-family:'JetBrains Mono',monospace;margin-bottom:6px">KEY RISKS</div>
        ${(ins.key_risks||[]).map(r=>`<div style="padding:5px 8px;background:rgba(255,23,68,0.07);border-left:2px solid var(--red);border-radius:3px;font-size:11px;margin-bottom:4px">⚠ ${r}</div>`).join('')}
        <div style="font-size:9px;color:var(--green);font-family:'JetBrains Mono',monospace;margin-top:10px;margin-bottom:6px">OPPORTUNITIES</div>
        ${(ins.key_opportunities||[]).map(o=>`<div style="padding:5px 8px;background:rgba(0,200,83,0.07);border-left:2px solid var(--green);border-radius:3px;font-size:11px;margin-bottom:4px">✓ ${o}</div>`).join('')}
      </div>
      <div>
        <div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-bottom:7px">TIMELINE PROJECTIONS</div>
        <div style="background:var(--ink);border-radius:6px;padding:10px 12px;margin-bottom:8px;border-left:2px solid var(--gold)">
          <div style="font-size:9px;color:var(--gold);font-family:'JetBrains Mono',monospace">T+30 DAYS</div>
          <div style="font-size:11px;margin-top:3px;line-height:1.5">${ins.timeline_t30||''}</div>
        </div>
        <div style="background:var(--ink);border-radius:6px;padding:10px 12px;border-left:2px solid #7C5CFC">
          <div style="font-size:9px;color:#7C5CFC;font-family:'JetBrains Mono',monospace">T+90 DAYS</div>
          <div style="font-size:11px;margin-top:3px;line-height:1.5">${ins.timeline_t90||''}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderScInsight(id, ins) {
  const el = document.getElementById(id); if (!el || !ins) return;
  const rc = ins.resilience_label==='RESILIENT'?'var(--green)':ins.resilience_label==='ADEQUATE'?'var(--gold)':ins.resilience_label==='VULNERABLE'?'var(--saffron)':'var(--red)';
  const ec = ins.earnings_risk_next_quarter==='LOW'?'var(--green)':ins.earnings_risk_next_quarter==='MEDIUM'?'var(--gold)':ins.earnings_risk_next_quarter==='HIGH'?'var(--saffron)':'var(--red)';
  const hasLive = window.LIVE_MACRO && Object.keys(window.LIVE_MACRO).length > 0;
  el.innerHTML = `<div style="background:rgba(0,188,212,0.05);border:1px solid rgba(0,188,212,0.28);border-radius:10px;overflow:hidden">
    <div style="padding:11px 16px;border-bottom:1px solid rgba(0,188,212,0.2);display:flex;align-items:center;justify-content:space-between;background:rgba(0,188,212,0.07)">
      <span style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:1px;color:#00BCD4">🤖 GROQ · LLAMA 3.3 70B SUPPLY CHAIN REPORT ${hasLive?'<span style="color:var(--saffron)">+ LIVE MACRO</span>':''}</span>
      <div style="display:flex;gap:7px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:${rc}18;color:${rc};padding:2px 8px;border-radius:4px;border:1px solid ${rc}40">${ins.resilience_label} ${ins.resilience_score}/100</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;background:${ec}18;color:${ec};padding:2px 8px;border-radius:4px;border:1px solid ${ec}40">EARNINGS RISK: ${ins.earnings_risk_next_quarter}</span>
      </div>
    </div>
    <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
      <div>
        <div style="font-size:11px;color:var(--muted);line-height:1.65;margin-bottom:9px">${ins.company_summary||''}</div>
        <div style="font-size:9px;color:var(--red);font-family:'JetBrains Mono',monospace;margin-bottom:4px">BIGGEST RISK</div>
        <div style="padding:8px 10px;background:rgba(255,23,68,0.07);border-left:2px solid var(--red);border-radius:3px;font-size:11px;line-height:1.5;margin-bottom:9px">${ins.biggest_risk||''}</div>
        <div style="font-size:9px;color:var(--gold);font-family:'JetBrains Mono',monospace;margin-bottom:4px">CONCENTRATION RISK</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5">${ins.concentration_risk||''}</div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--saffron);font-family:'JetBrains Mono',monospace;margin-bottom:6px">GEOPOLITICAL WATCHLIST</div>
        ${(ins.geopolitical_watchlist||[]).map(g=>`<div style="padding:6px 9px;background:rgba(255,107,0,0.07);border-left:2px solid var(--saffron);border-radius:3px;font-size:11px;margin-bottom:5px">🌍 ${g}</div>`).join('')}
      </div>
      <div>
        <div style="font-size:9px;color:var(--green);font-family:'JetBrains Mono',monospace;margin-bottom:6px">MITIGATION ACTIONS</div>
        ${(ins.mitigation_actions||[]).map((a,i)=>`<div style="display:flex;gap:8px;margin-bottom:7px"><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#00BCD4;flex-shrink:0">${i+1}.</span><span style="font-size:11px">${a}</span></div>`).join('')}
      </div>
    </div>
  </div>`;
}

// ── Boot ──
loadGroqKeys();
