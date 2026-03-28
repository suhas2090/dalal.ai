# DALAL.AI

DALAL.AI is a multi-page market intelligence web app with a premium landing page and a live dashboard.

## Pages
- `/` → Homepage (premium brand + feature sections)
- `/homepage/` → Homepage (same visual system)
- `/dashboard/` → Live dashboard
- `/signup/` → Signup page

## Project Structure
- `index.html` — Root homepage entrypoint
- `homepage/index.html` — Homepage route
- `dashboard/index.html` — Dashboard route shell + component includes
- `components/*.html` — Shared UI fragments (header, dashboard panel, overlays, modals)
- `assets/css/styles.css` — Shared styles/theme
- `assets/js/includes.js` — HTML include loader
- `assets/js/script.js` — Main dashboard logic (market data, AI flows, widgets)
- `cloudflare-worker.js` — Worker API for symbols + MMI + FII/DII

## Live Data Flow (Cloudflare-first)
Frontend fetches live prices from:

`WORKER_URL?symbols=...`

The worker must support `symbols` route and return:
```json
{
  "TCS.NS": { "price": 3912.5, "chgAmt": -11.8, "chgPct": -0.30 }
}
```

### Worker routes
- `?symbols=TCS.NS,RELIANCE.NS,^NSEI` → Yahoo quote proxy
- `?fiidii=1` → NSE FII/DII proxy
- `?mmi=1` → Tickertape MMI proxy

## Required Config
In `assets/js/script.js`:
- `CONFIG.WORKER_URL` must point to your deployed worker URL.

Example:
```js
WORKER_URL: "https://dalal-prices.YOUR-NAME.workers.dev"
```

## Deploy / Update Checklist
1. Deploy latest `cloudflare-worker.js` to Cloudflare Workers.
2. Confirm worker endpoint returns symbols JSON for `?symbols=...`.
3. Deploy static site (GitHub Pages / Vercel / Cloudflare Pages).
4. Hard refresh browser cache.

## Merge Conflict Guidance (important)
If conflicts appear in `assets/js/script.js` and `index.html`, keep these behaviors:

### `assets/js/script.js`
- Keep worker fetch URL encoded:
  - `?symbols=${encodeURIComponent(symbols.join(','))}`
- Keep safe null-checks for ticker DOM writes.

### `index.html`
- Keep root as homepage (landing page), not forced redirect.
- Keep link/button path to `/dashboard/`.

## Quick Local Run
```bash
python3 -m http.server 4173
```
Then open:
- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/dashboard/`

## Troubleshooting
- Dashboard stuck at loading:
  - Worker likely missing `symbols` handler or stale deployment.
- Homepage works but dashboard data empty:
  - `WORKER_URL` incorrect or worker blocked.
- Merge conflict regressions:
  - Re-check `index.html`, `assets/js/script.js`, and `cloudflare-worker.js` first.
