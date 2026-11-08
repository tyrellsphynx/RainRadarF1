# RainRadarF1

**Will it rain during the sessions?** A PWA that answers the one question F1 fans actually care
about — rain radar and per-session rain forecasts for every circuit on the current F1 calendar,
aligned to FP1/FP2/FP3/Sprint/Qualifying/Race times.

## What it does

- **Next-race hero** — the upcoming (or live) race weekend with a countdown and a verdict per
  session: `Dry` / `Isolated showers` / `Showers` / `Rain`, plus rain probability % and expected
  accumulation (mm). Tap a session to expand a precipitation chart across its window.
- **Rain map** — every calendar circuit as a pin colored by "rain in the next 2 hours", over the
  animated radar layer.
- **Track dashboards** — per-circuit page with the full weekend forecast and the animated radar
  (past 2 h, 10-min steps) with the track outline drawn over it.
- **In-app rain alerts** — "Rain expected in ~20 min" banner for the featured circuit (forecast +
  radar-within-25-km probe). No push notifications, no accounts — by design.
- **PWA** — installable, works offline (cached shell, tiles and last-known data).
- Times shown in **your timezone** first, track-local second, with countdowns everywhere.

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | React + TypeScript + Vite | static SPA, no backend, no secrets |
| Map | MapLibre GL + OpenFreeMap vector tiles | keyless, unlimited, no credit card |
| Radar | RainViewer tiles | the only free keyless global radar tiles (past 2 h since 2026) |
| Forecast | Open-Meteo | free, keyless, 16-day hourly + 15-min precipitation |
| Schedule | Jolpica F1 API | free, keyless, sessions + circuit coordinates |
| Track outlines | bacinger/f1-circuits (MIT) | bundled at build time |

All API calls are browser-side (CORS-open sources). Everything is cached: schedule 24 h,
forecasts 1 h, radar frame lists 5 min, tiles via service worker — with a committed snapshot
(`src/data/jolpica/snapshot-*.json`) as the offline fallback. The season rolls over automatically:
data is fetched per year.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # vitest (domain logic: verdicts, aggregation, timezones/DST, cache)
npm run typecheck  # tsc -b
npm run lint       # eslint
npm run build      # production build into dist/
npm run snapshot   # refresh bundled schedule snapshot + track outlines
python3 scripts/gen_icons.py   # regenerate PWA icons
```

## Deployment

Pushes to `main` build and deploy to **GitHub Pages** via `.github/workflows/deploy.yml`
(remember to enable Pages → "GitHub Actions" in the repo settings). The app uses a relative
base path and hash routing, so it works from any Pages URL or custom domain unchanged.

## Architecture

```
src/
  data/     one module per external source (jolpica, openmeteo, rainviewer, circuits, map) —
            each replaceable behind its own client
  domain/   pure logic: session windows, verdict thresholds, window aggregation,
            timezone conversion, alert triggers (fully unit-tested)
  ui/       pages & components (home, map, track, alerts, shell)
```

The verdict thresholds live in `src/domain/verdict.ts`: ≥ 2.0 mm across the session → **Rain**,
≥ 0.2 mm → **Showers**, else ≥ 25 % probability → **Isolated showers**, else **Dry**; outside the
forecast horizon → **Too early to call**.

## Known limitations (by design, v1)

- RainViewer's free tiles top out at zoom 7 (≈1 km/px) — radar is soft right over a circuit. The
  forecast cards are the verdict; the radar is supporting evidence. (v2: DWD 1-km tiles for EU races.)
- RainViewer no longer provides nowcast frames (discontinued 2026-01); the "next hour" story comes
  from Open-Meteo's 15-minute data (available for Central Europe & North America, hourly elsewhere).
- Forecast model output is never a guarantee. Judge the sky with your own eyes.

## Credits & licenses

- Schedule data © [Jolpica F1 API](https://jolpi.ca/) — CC BY-NC-SA (Ergast-derived) — non-commercial use
- Weather forecasts by [Open-Meteo](https://open-meteo.com/) — CC BY 4.0
- Radar by [RainViewer](https://www.rainviewer.com/)
- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by [OpenFreeMap](https://openfreemap.org/)
- Track outlines from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) — MIT

Unofficial fan project. Not affiliated with Formula 1.
