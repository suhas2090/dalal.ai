# DALAL.AI — Indian Stock Market Intelligence Agent

A single-file HTML dashboard for NSE/BSE research, live prices, and AI-powered stock analysis — powered by Google Gemini and Yahoo Finance via Cloudflare Worker.

---

## Live Demo

**[https://suhasr780.github.io/dalal-ai](https://suhasr780.github.io/dalal-ai)**

---

## What It Does

- **Live Prices** — NSE stocks, indices (Nifty 50, Sensex, Bank Nifty), forex (USD/INR), commodities (Brent Crude, Gold MCX), 10Y G-Sec, VIX — all via Yahoo Finance fetched through a Cloudflare Worker
- **AI Research Agent** — Ask any question about NSE/BSE listed companies. Get fundamental analysis, technical signals, competitor comparisons, concall summaries, macro impact — all in seconds
- **Live News** — Real-time ET Markets headlines fetched via Cloudflare Worker (server-side RSS parsing, no third-party service)
- **FII/DII Flow** — FPI and DII net values from NSE, updated daily
- **Watchlist** — 5 stocks with live CMP and % change
- **Sector Performance** — IT, Banking, Pharma, Auto, Energy
- **Macro Indicators** — USD/INR, Brent Crude, Gold (MCX ₹/10g), 10Y G-Sec, VIX India, CPI
- **Auto-refresh** — Every 5 minutes across all panels


---

## Architecture

```
Browser (GitHub Pages)
    │
    ├── Gemini API (direct) ──────────── AI research queries only
    │   └── gemini-2.5-flash
    │
    └── Cloudflare Worker ────────────── All market data
        ├── ?symbols=TCS.NS,...  →  Yahoo Finance (prices)
        ├── ?news=1              →  ET Markets RSS (news)
        └── ?fiidii=1            →  NSE API (FII/DII flows)
```

**Key design decision:** Cloudflare Worker acts as a CORS proxy — fetches Yahoo Finance and NSE server-side (no CORS blocking), returns clean JSON to the browser. Free tier = 100,000 requests/day, deployed once forever.

---

## Stack

| Component | Service | Cost |
|---|---|---|
| Hosting | GitHub Pages | Free |
| AI Agent | Google Gemini 2.5 Flash | Free (25 RPD / 5 RPM) |
| Stock Prices | Yahoo Finance via Cloudflare Worker | Free |
| News | ET Markets RSS via Cloudflare Worker | Free |
| FII/DII | NSE India API via Cloudflare Worker | Free |
| CORS Proxy | Cloudflare Worker | Free (100k req/day) |

**Total cost: ₹0**

---

## Setup

### 1. Deploy Cloudflare Worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create Worker
2. Name it `dalal-prices`
3. Paste the contents of `cloudflare-worker.js`
4. Click Deploy
5. Your Worker URL: `https://dalal-prices.YOUR-NAME.workers.dev`

### 2. Update Worker URL in HTML

Open `index.html`, find:
```javascript
WORKER_URL: "https://dalal-prices.suhasnrao.workers.dev",
```
Replace with your Worker URL.

### 3. Deploy to GitHub Pages

1. Push `index.html` to your repo (must be public for free GitHub Pages)
2. Settings → Pages → Deploy from branch → main → Save
3. Your site is live at `https://YOUR-USERNAME.github.io/REPO-NAME`

### 4. Add Gemini API Key

1. Get a free key at [aistudio.google.com](https://aistudio.google.com)
2. Open your dashboard → a popup will ask for the key
3. Paste it → saved in your browser's localStorage only
4. Never stored in code — safe for public repos

---

## API Keys & Security

| Key | Where Stored | Exposed? |
|---|---|---|
| Gemini API Key | Browser localStorage only | ❌ Never in code |
| Cloudflare Worker URL | index.html | ✅ Safe (public endpoint) |
| Yahoo Finance | No key needed | — |
| NSE India | No key needed | — |

**Important:** Never paste your Gemini API key in a public chat (Claude, ChatGPT, etc.) — Google actively scans for leaked keys and auto-revokes them. Always enter it directly through the dashboard popup or edit locally.

---

## Known Limitations

- **Gemini free tier:** 25 requests/day (RPD), 5 requests/minute (RPM) — resets at midnight Pacific (1:30 PM IST). Enough for personal research use.
- **Market hours only:** Prices update every 5 min but Yahoo Finance shows delayed data outside NSE trading hours (9:15 AM – 3:30 PM IST)
- **FII/DII:** NSE sometimes blocks automated requests — data may show `—` if NSE's API is unavailable
- **VIX India:** Uses `^VIX` (US VIX) as proxy — India VIX not available on Yahoo Finance free tier
- **CPI Inflation:** Hardcoded to latest RBI release (4.31% Feb 2025) — update manually each month

---

## File Structure

```
dalal-ai/
├── index.html           # Entire app — single file, no dependencies
└── cloudflare-worker.js # Deploy this to Cloudflare Workers once
```

---

## Extending This Project

When adding new features, key things to know:

- All data flows through the Cloudflare Worker — add new routes there first (`?route=1`)
- Gemini is called **only** in `callClaudeAgent()` — never add Gemini calls to refresh loops
- The 5-minute refresh runs `refreshAllLiveData()` — add new panel updates there
- Mobile CSS breakpoints are at 768px and 400px
- All live element IDs follow pattern: `macro-usdinr`, `wl-tcs-price`, `sector-it` etc.

---

## Roadmap Ideas

- [ ] Chart view for Nifty 50 / Sensex (TradingView widget embed)
- [ ] News video sources panel (YouTube financial channels)
- [ ] Portfolio tracker with P&L
- [ ] Earnings calendar
- [ ] Options chain viewer
- [ ] Alert system for watchlist price targets

---

## Credits

Built with Claude (Anthropic) as AI coding assistant. Powered by Google Gemini, Yahoo Finance, NSE India, and Cloudflare Workers.
