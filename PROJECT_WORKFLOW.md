# DALAL.AI — Project Architecture, Workflow, and Debug Guide

This document explains the full project structure, runtime workflow, data flow, and a practical debug path for the **“site not loading”** issue.

---

## 1) Current Architecture (What runs where)

### Frontend (static pages)
- **`/index.html`** → premium homepage (root entrypoint)
- **`/homepage/index.html`** → homepage route
- **`/dashboard/index.html`** → dashboard route (composed from HTML components)
- **`/signup/index.html`** → signup route

### Shared frontend resources
- **`assets/css/styles.css`** → all global styles/theme
- **`assets/js/includes.js`** → component include loader
- **`assets/js/script.js`** → dashboard runtime logic (market refresh, widgets, AI features)
- **`components/*.html`** → reusable component fragments

### Backend proxy (Cloudflare Worker)
- **`cloudflare-worker.js`**
  - `?symbols=...` → Yahoo quote proxy
  - `?fiidii=1` → NSE FII/DII proxy
  - `?mmi=1` → Tickertape MMI proxy

---

## 2) Folder / File Structure

```text
dalal.ai/
├─ index.html
├─ homepage/
│  └─ index.html
├─ dashboard/
│  └─ index.html
├─ signup/
│  └─ index.html
├─ components/
│  ├─ header.html
│  ├─ dashboard.html
│  ├─ floating-dock.html
│  ├─ gemini-modal.html
│  ├─ groq-modal.html
│  ├─ globe-overlay.html
│  ├─ scenario-overlay.html
│  └─ supply-chain-overlay.html
├─ assets/
│  ├─ css/
│  │  └─ styles.css
│  ├─ js/
│  │  ├─ includes.js
│  │  └─ script.js
│  └─ favicon.svg
├─ cloudflare-worker.js
├─ README.md
└─ PROJECT_WORKFLOW.md
```

---

## 3) Runtime Workflow Charts

### A) Homepage flow

```text
User opens / (or /homepage/)
        │
        ├─ Browser loads static HTML
        ├─ Browser loads styles.css + fonts
        └─ Renders landing UI/animations (no component includes required)
```

### B) Dashboard flow

```text
User opens /dashboard/
        │
        ├─ dashboard/index.html loads includes.js
        │
        ├─ includes.js fetches each data-include component
        │      (header, dashboard panel, overlays, modals)
        │
        ├─ includes.js appends assets/js/script.js
        │
        ├─ script.js boots refreshAllLiveData()
        │
        └─ workerFetch() -> Cloudflare Worker (?symbols=...)
                  │
                  └─ Worker fetches Yahoo quote API, maps data, returns JSON
```

### C) Live market data flow

```text
Browser (script.js)
   -> WORKER_URL?symbols=...
      -> Cloudflare Worker handleSymbols()
         -> Yahoo /v7/finance/quote
         -> normalize {price, chgAmt, chgPct}
      <- JSON map by symbol
   -> applyToUI(stocks / indices / macro)
   -> render ticker, watchlist, index cards, macro values
```

---

## 4) Why “Not Loading” Usually Happens

Top real-world causes in this repo:

1. **Worker not redeployed after code update**
   - Frontend asks for `?symbols=...` but deployed worker still lacks `symbols` route.

2. **Wrong `WORKER_URL` in `assets/js/script.js`**
   - Frontend points to old/dead worker endpoint.

3. **Merge conflict damage in critical files**
   - Most sensitive: `assets/js/script.js`, `index.html`, `cloudflare-worker.js`.

4. **CDN/cache stale bundle**
   - New code merged, old cached assets still served.

---

## 5) Verified Path/Structure Checks

Local checks were run to verify route/file wiring:

- All `data-include` paths in `dashboard/index.html` resolve to existing files.
- All local `href/src` paths in `index.html`, `homepage/index.html`, and `dashboard/index.html` resolve correctly.

So, file path structure is currently consistent.

---

## 6) Deployment Workflow (Safe sequence)

1. Merge frontend changes.
2. Deploy **latest `cloudflare-worker.js`** to Cloudflare Workers.
3. Confirm worker URL in `assets/js/script.js` (`CONFIG.WORKER_URL`) matches deployed worker.
4. Deploy static site.
5. Hard refresh cache and retest:
   - `/`
   - `/homepage/`
   - `/dashboard/`

---

## 7) Quick Debug Commands

Run from repo root:

```bash
node --check assets/js/script.js
node --check cloudflare-worker.js
python3 -m http.server 4173
```

Then test:
- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/dashboard/`

---

## 8) Critical Merge-Conflict Keep Rules

If conflicts appear, preserve these:

- In `assets/js/script.js`
  - `workerFetch` uses URL-encoded symbols query.
  - Defensive null-checks before writing `tickerInner`.

- In `cloudflare-worker.js`
  - `symbols` route is routed before default `ok:true`.
  - `handleSymbols` returns `{ [symbol]: { price, chgAmt, chgPct } }`.

- In `index.html`
  - Root remains homepage entrypoint.
  - CTA links to `/dashboard/` and `/signup/`.

---

## 9) One-Line Root-Cause Heuristic

If homepage loads but dashboard market widgets stay in `loading...`, treat it as **worker deployment/config mismatch first**, not CSS/path issue.
