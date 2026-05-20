### [2026-05-20] Scrapers search France-wide, not geographically filtered

- **What happened:** Both scrapers returned nationwide ads → city centroids of Paris/Lyon/etc all >50km from Brest target → 0 pass geo pre-filter.
- **Why it happened:** `buildSearchUrl` / BienIci filters had no geographic constraint; `FilterCriteria` center lat/lon never passed to scrapers.
- **How it was fixed:** Added `GeoCenter` type. Changed `BaseScraper.scrape()` and `ScraperManager.runAll()` to accept optional `center`. LBC: adds `lat`, `lng`, `rad` (km) URL params. BienIci: adds `circle: { lat, lng, radius }` (meters) to filters JSON. `index.ts` passes `targetGeo` down.
- **Prevention:** Whenever adding a new scraper, check that geographic filter is wired up before querying.

### [2026-05-20] Pipeline: 0 ads in range despite 49 passing filter

- **What happened:** `84 raw → 49 pass filter → 0 in range → 0 new`. All ads dropped at geo pre-filter step.
- **Why it happened:** Two root causes:
  1. BienIci `blurInfo.position` absent for many ads; interface didn't capture `blurInfo.shape` (GeoJSON polygon), so no fallback centroid existed → all BienIci ads had `undefined` lat/lon → dropped by `latitude === undefined` guard.
  2. Both scrapers search France-wide (no geographic filter in query) → LBC returns city centroids of Paris/Lyon/etc, all >50km from Brest target.
- **How it was fixed:** Expanded `BienIciAd.blurInfo` interface to include `shape: Polygon | MultiPolygon`. Added `polygonCentroid(ring)` to `geo.ts`. Added `extractPoint()` helper in `BienIciScraper` — tries `blurInfo.position` first, falls back to polygon centroid.
- **Prevention:** When scraper returns optional coordinate fields, always check what fallback location data the API provides (polygon/bbox) and model it in the interface. Root cause #2 (nationwide search) still unresolved — scrapers need geographic bounding box in query params.
