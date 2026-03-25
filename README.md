# DALAL.AI — Master Context Prompt for Claude
# Use this at the start of any new chat to give Claude full project context

---

## PASTE THIS INTO A NEW CLAUDE CHAT:

---

I am continuing development on **DALAL.AI** — a single-file HTML Indian stock market intelligence dashboard I built previously. Here is the complete project context so you have a full headstart:

---

### WHAT IT IS
A single HTML file (`index.html`) deployed on GitHub Pages. It is an Indian stock market research dashboard with:
- Live NSE/BSE stock prices, indices, watchlist, sectors, macro indicators
- AI research agent (Google Gemini) for stock analysis queries
- Live news from ET Markets (RSS via Cloudflare Worker)
- FII/DII flow data from NSE India
- Auto-refresh every 5 minutes
- Mobile responsive (768px, 400px breakpoints)

---

### LIVE DEPLOYMENT
- **GitHub:** `https://github.com/suhas2090/dalal-ai` (PUBLIC repo)
- **Live URL:** `https://suhasr780.github.io/dalal-ai`
- **Cloudflare Worker:** `https://dalal-prices.suhasnrao.workers.dev`

---

### TECH STACK & ARCHITECTURE
```
Browser (GitHub Pages)
    │
    ├── Gemini API (direct) ──── AI research queries ONLY
    │   └── model: gemini-2.5-flash
    │
    └── Cloudflare Worker ──── ALL market data (CORS proxy)
        ├── ?symbols=TCS.NS,...  → Yahoo Finance prices
        ├── ?news=1              → ET Markets RSS parsed server-side
        └── ?fiidii=1            → NSE India FII/DII API
```

---

### FILES
1. `index.html` — entire app, single file, ~84KB
2. `cloudflare-worker.js` — deployed to Cloudflare Workers, handles 3 routes

---

### API KEYS & WHERE THEY LIVE
| Key | Location | Notes |
|---|---|---|
| Gemini API Key | Browser localStorage (`dalal_gemini_key`) | NEVER in code — entered via popup on first use |
| Cloudflare Worker URL | `index.html` CONFIG block | Public, safe to expose |
| Yahoo Finance | No key needed | Via Worker |
| NSE India | No key needed | Via Worker |
| Finnhub | NOT USED — abandoned (free tier blocked NSE stocks) |
| RapidAPI Yahoo Finance | NOT USED — abandoned (CORS blocked from browser) |

**CRITICAL:** Never put Gemini key in the HTML file or share it in chat. Google auto-revokes leaked keys. Always use the localStorage popup approach.

---

### CLOUDFLARE WORKER ROUTES
```javascript
?symbols=TCS.NS,RELIANCE.NS  // Yahoo Finance v8 chart API, returns price/chgAmt/chgPct
?news=1                       // Fetches ET Markets RSS, parses XML server-side, returns JSON items[]
?fiidii=1                     // Fetches NSE /api/fiidiiTradeReact, returns fpi_net/dii_net/date
```

---

### HTML CONFIG BLOCK (top of script section)
```javascript
const CONFIG = {
  GEMINI_API_KEY: "",  // loaded from localStorage at runtime
  WORKER_URL: "https://dalal-prices.suhasnrao.workers.dev",
  // ... custom URLs for BSE, NSE, TradingView etc.
};
```

---

### KEY JAVASCRIPT FUNCTIONS
| Function | Purpose |
|---|---|
| `refreshAllLiveData()` | Master refresh — called on load + every 5 min |
| `workerFetch(symbols[])` | Fetches stock prices via Worker |
| `applyToUI(raw, type)` | Updates DOM for stocks/indices/macro |
| `refreshNews()` | Fetches news via Worker `?news=1` |
| `fetchFIIDII()` | Fetches FII/DII via Worker `?fiidii=1`, called once daily |
| `checkFIIDII()` | Called in refresh loop, triggers fetchFIIDII once per day |
| `runQuery(query)` | Main AI query handler |
| `callClaudeAgent(query, liveData)` | Calls Gemini API with live price context |
| `extractSymbol(query)` | Detects NSE symbol from natural language (50+ companies mapped) |
| `renderCompanyResearch(data)` | Renders full research report UI |
| `updateClock()` | Updates IST clock every second |
| `loadGeminiKey()` | Loads key from localStorage or shows modal |
| `saveGeminiKey()` | Saves key to localStorage from modal input |

---

### DOM ELEMENT IDs (live data targets)
```
Indices:   nifty-val, nifty-chg, sensex-val, sensex-chg, banknifty-val, banknifty-chg
Watchlist: wl-tcs-price, wl-tcs-chg, wl-reliance-price, wl-reliance-chg,
           wl-hdfcbank-price, wl-hdfcbank-chg, wl-infy-price, wl-infy-chg,
           wl-adaniports-price, wl-adaniports-chg
Sectors:   sector-it, sector-bank, sector-pharma, sector-auto, sector-energy
Macro:     macro-usdinr, macro-crude, macro-gold, macro-gsec, macro-vix, macro-cpi
FII/DII:   fii-bar, fii-val, dii-bar, dii-val, fii-date
News:      news-container, news-refresh-time
Ticker:    tickerInner
Clock:     istTime
```

---

### YAHOO FINANCE SYMBOL FORMAT
```
NSE stocks:  TCS.NS, RELIANCE.NS, HDFCBANK.NS etc.
Indices:     ^NSEI (Nifty50), ^BSESN (Sensex), NIFTYBANK.NS (Bank Nifty)
Forex:       USDINR=X
Commodities: BZ=F (Brent Crude), GC=F (Gold USD/oz)
G-Sec:       IN10Y=X
VIX:         ^VIX (US VIX used as proxy — India VIX not on Yahoo free)
```

---

### MISTAKES TO NEVER REPEAT
1. **Never use `AbortSignal.timeout()`** — not supported in all browsers. Always use `new AbortController()` + `setTimeout()` instead
2. **Never use apostrophes in JS strings** — `Jan'25` breaks JS. Use `Jan 25` instead
3. **Never declare same variable twice in same scope** — caused `const vix` duplicate crash that broke entire app
4. **Never patch on top of patches** — always find root cause first with `node --check` syntax validation
5. **Always run `node --check /tmp/test.js`** before deploying — catches all syntax errors instantly
6. **RapidAPI Yahoo Finance is CORS-blocked from browsers** — do not use it
7. **rss2json.com returns 422 for all Indian news feeds** — use Cloudflare Worker server-side RSS instead
8. **Finnhub free tier blocks NSE: symbols (403)** — Indian stocks need paid Finnhub plan
9. **Gemini free tier = 25 RPD, 5 RPM** — never call Gemini in refresh loops, only on user query
10. **GitHub public repo + API key in code = Google auto-revokes key** — always use localStorage for keys
11. **GitHub Pages requires public repo on free plan** — private repo breaks Pages
12. **NSE India blocks direct browser calls (CORS)** — always route through Cloudflare Worker
13. **Never use `gemini-1.5-flash-latest` or `gemini-1.0-pro`** — not found in v1beta. Use `gemini-2.5-flash` or `gemini-2.0-flash`

---

### GEMINI RATE LIMITS (free tier)
- 5 RPM (resets every 60 seconds)
- 25 RPD (resets at midnight Pacific = 1:30 PM IST)
- 250K TPM daily
- ~3,000 tokens per TCS research query (1,500 in + 1,500 out)
- Max ~83 queries/day within token budget

---

### CSS BREAKPOINTS
```css
@media (max-width: 1100px)  /* Tablet — hide sidebars */
@media (max-width: 768px)   /* Mobile — stack layout */
@media (max-width: 400px)   /* Small mobile */
```

---

### CURRENT KNOWN ISSUES / FUTURE WORK
- VIX India shows US VIX (^VIX) — India VIX not available on Yahoo Finance free
- CPI Inflation is hardcoded (4.31% Feb 2025) — needs manual update each RBI release
- FII/DII: NSE occasionally blocks the Worker request — shows `—` when this happens
- 10Y G-Sec (IN10Y=X) sometimes returns 0 from Yahoo Finance

---

### ROADMAP (features to build next)
- TradingView chart widget embed for Nifty 50 / Sensex
- News video panel (YouTube/Moneycontrol video RSS)
- Portfolio tracker with P&L calculation
- Earnings calendar (upcoming results)
- Alert system for watchlist price targets
- Options chain viewer
- More stocks in watchlist (currently fixed at 5)

---

Now help me build: **[DESCRIBE WHAT YOU WANT TO ADD/CHANGE]**

## 2026 Update: Vercel deployment + server-side keys

- Added `api/ai.js` proxy route so Gemini/Groq keys can be stored in Vercel environment variables (`GEMINI_API_KEY`, `GROQ_API_KEY`) instead of browser localStorage.
- Added `api/chart.js` route to proxy Yahoo Finance OHLC data for the open-source chart panel.
- Frontend D.AI defaults to Gemini and auto-routes `dbt` queries to Groq.
- Added `cloudflare-worker.js` fixed version for MMI + FII/DII parsing (number/date compatibility).
