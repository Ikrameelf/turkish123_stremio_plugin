# Turkish123 — Stremio Addon

Stream every Turkish series with English subtitles from **Turkish123** directly in Stremio. New shows appear automatically.

## What it does

- **Catalog** — lists all ~380 series from turkish123 (`/series-list/`), with posters scraped from the site.
- **Search** — uses the site's `?s=` search.
- **Seasons** — reconstructs season/episode numbering from the site's inline season markers, so episodes show up correctly as S1E1, S2E1, etc.
- **Streams** — resolves a playable URL for each episode from multiple "Server" sources.

## Stream sources

| Server | Host | How | Status |
|--------|------|-----|--------|
| 1 | engifuosi → tokvoy.com | Two-step form POST → direct `.mp4` | ✅ Primary, reliable, pure HTTP |
| 2 | vidmoly.me | JWPlayer `sources:` (Cloudflare-protected) | ⚠️ Needs headless browser |
| 3 | voe.sx | Obfuscated JWPlayer config | ⚠️ Needs headless browser |

The **tokvoy (engifuosi)** source is the primary and works with **no browser dependencies** — the addon is fully functional on a free Render instance. vidmoly and voe.sx are bonus sources that require Puppeteer (set `USE_PUPPETEER=true`) and degrade gracefully when unavailable.

## Run locally

```bash
npm install
npm start
```

Then open Stremio and add: `stremio://http://localhost:7000/manifest.json`

Or visit `http://localhost:7000/manifest.json` in a browser and click "Add to Stremio".

## Deploy to Render

**Lightweight (tokvoy only, no Chrome):** use `render.yaml`.
```bash
# In Render dashboard, create a new service from this repo and pick render.yaml
```

**Full (all three sources, with Chrome):** use `render-puppeteer.yaml`. Needs a paid plan with enough memory for Chromium.

## Test the extractors

```bash
npm run probe -- <episode-url>      # e.g. https://turkish123.pro/yemin-episode-503/
npm run probe -- yemin 503          # or by slug + episode number
```

This prints the resolved stream URL for each available source.

## Endpoints (for debugging)

- `GET /catalog/series/turkish123_catalog.json` — all series
- `GET /catalog/series/turkish123_catalog/search=QUERY.json` — search
- `GET /meta/series/turkish123:<slug>.json` — show metadata + episode list
- `GET /stream/series/turkish123:<slug>:<absEpisode>.json` — streams
- `GET /manifest.json` — addon manifest

## How it works

```
series-list page  ──▶  catalog  (all shows + posters)
   show page      ──▶  meta     (episode list, seasons reconstructed)
   episode page   ──▶  stream   (Server 1/2/3 download links parsed)
                          │
                          ├─ engifuosi/tokvoy  ─▶ GET form → POST hash ─▶ direct .mp4
                          ├─ vidmoly           ─▶ sources array (or headless capture)
                          └─ voe.sx            ─▶ obfuscated config (or headless capture)
```

The `/proxy` route wraps HLS playlists so the player sends the correct `Referer` to hotlink-protected CDNs and rewrites segment URLs to stay proxied.

## Notes

- The source site is `turkish123.pro` (the `.wtf` domain redirects there).
- Seasons on the site are stored as a flat episode list with inline markers; this addon maps them to Stremio's season/episode model.
- No data is stored; catalog/meta responses are cached in memory for ~30 min.
