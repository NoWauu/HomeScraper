import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { haversineKm } from '../utils/geo';
import { BrowserClient } from '../utils/BrowserClient';
import { inferFurnished, isColocation } from '../utils/text';

interface LbcAttribute {
  key: string;
  value: string;
}

interface LbcAd {
  list_id: number;
  subject: string;
  body?: string;
  url: string;
  price: number[];
  owner?: {
    type?: string; // "private" | "pro"
  };
  location: {
    city: string;
    zipcode: string;
    lat: number;
    lng: number;
  };
  attributes: LbcAttribute[];
  images?: {
    urls_large?: string[];
  };
}

interface LbcSearchResponse {
  total: number;
  ads?: LbcAd[];
}

const LBC_SITE_ORIGIN = 'https://www.leboncoin.fr';
const LBC_SEARCH_API = 'https://api.leboncoin.fr/finder/search';
// Long-lived public web api key sent by leboncoin's own SPA.
const LBC_API_KEY = 'ba0c2dad52b3ec';

// The finder API serves up to 100 ads per request (verified live: limit=100 →
// 100 ads, limit=200 clamps to 100). Bigger pages = 3× fewer requests than the
// SPA's own 35.
const LBC_PAGE_SIZE = 100;
// The API hard-rejects offset ≥ 3500 (verified live: offset 3450 → 100 ads,
// offset 3500 → total=0/no ads — matches the SPA's 100-page × 35 cap). With
// 100-ad pages the deepest usable offset is 3400, i.e. 3500 ads reachable per
// query. Past that a query's tail is unreachable by paging alone — we then
// slice the price range so every sub-query fits inside the window.
const LBC_MAX_OFFSET = 3_400;
// Hard safety cap on total requests per scrape so a pathological slice tree
// can't run forever (300 requests × 100 ads ≈ 30k ads capacity). Tune via env
// for dense metro areas where the full result set is bigger.
const LBC_MAX_REQUESTS = parseInt(process.env['LBC_MAX_REQUESTS'] ?? '300');

export class LeboncoinScraper implements BaseScraper {
  readonly sourceName = 'leboncoin';

  async scrape(criteria: FilterCriteria, center?: GeoCenter): Promise<RawAd[]> {
    // Exhaust the whole result set: page each query to the end, and when a
    // query's `total` exceeds what offset-paging can reach, recursively split
    // its price range until every slice fits. Union by list_id — slices share
    // boundary prices, and LBC occasionally re-serves an ad across pages.
    const byId = new Map<number, LbcAd>();
    const budget = { requests: 0 };

    await this.fetchSlice(criteria, center, 0, criteria.maxPrice, byId, budget);

    const all = [...byId.values()];
    console.log(`[leboncoin] raw ads: ${all.length} (${budget.requests} requests)`);
    const mapped = all.map((ad) => this.mapAd(ad)).filter((ad): ad is RawAd => ad !== null);
    console.log(`[leboncoin] mapped: ${mapped.length} (${all.length - mapped.length} null)`);

    if (!center) return mapped;

    const inRange = mapped.filter((ad) => {
      const { latitude, longitude } = ad.location;
      if (latitude === undefined || longitude === undefined) return false;
      return haversineKm(latitude, longitude, center.lat, center.lon) <= criteria.maxDistanceKm;
    });
    console.log(`[leboncoin] in range (${criteria.maxDistanceKm}km): ${inRange.length}`);
    return inRange;
  }

  /**
   * Fetch every ad whose price falls in [priceMin, priceMax], recursing into
   * halves when the slice's total exceeds the reachable paging window.
   */
  private async fetchSlice(
    criteria: FilterCriteria,
    center: GeoCenter | undefined,
    priceMin: number,
    priceMax: number,
    byId: Map<number, LbcAd>,
    budget: { requests: number }
  ): Promise<void> {
    const browser = BrowserClient.get();
    let total = Infinity;

    for (let offset = 0; offset <= LBC_MAX_OFFSET; offset += LBC_PAGE_SIZE) {
      if (offset >= total) return;
      if (budget.requests >= LBC_MAX_REQUESTS) {
        console.warn(`[leboncoin] request budget (${LBC_MAX_REQUESTS}) exhausted, stopping`);
        return;
      }

      budget.requests++;
      const data = await browser.apiFetch<LbcSearchResponse>({
        siteOrigin: LBC_SITE_ORIGIN,
        url: LBC_SEARCH_API,
        method: 'POST',
        headers: { api_key: LBC_API_KEY },
        body: this.buildSearchBody(criteria, center, offset, priceMin, priceMax),
      });

      if (offset === 0) {
        total = data.total ?? 0;
        console.log(`[leboncoin] slice ${priceMin}-${priceMax}€: total ${total}`);

        // Slice too deep to page through? Split the price range and recurse.
        // Only possible while the range can still be halved — a single-price
        // slice that big would be pathological (log + take what's reachable).
        if (total > LBC_MAX_OFFSET + LBC_PAGE_SIZE && priceMax - priceMin >= 2) {
          const mid = Math.floor((priceMin + priceMax) / 2);
          // LBC price bounds are inclusive → overlap at `mid` is deduped by id
          await this.fetchSlice(criteria, center, priceMin, mid, byId, budget);
          await this.fetchSlice(criteria, center, mid, priceMax, byId, budget);
          return;
        }
        if (total > LBC_MAX_OFFSET + LBC_PAGE_SIZE) {
          console.warn(`[leboncoin] slice ${priceMin}-${priceMax}€ unsplittable, tail past offset ${LBC_MAX_OFFSET} unreachable`);
        }
      }

      const ads = data.ads ?? [];
      if (!ads.length) return;
      for (const ad of ads) byId.set(ad.list_id, ad);

      if (ads.length < LBC_PAGE_SIZE) return;
      // pause between pages so pagination doesn't look like a burst
      await new Promise((r) => setTimeout(r, 1_200 + Math.random() * 1_800));
    }
  }

  private buildSearchBody(
    c: FilterCriteria,
    center: GeoCenter | undefined,
    offset: number,
    priceMin: number,
    priceMax: number
  ): unknown {
    const enums: Record<string, string[]> = {
      ad_type: ['offer'],
      real_estate_type: ['2'], // apartment
    };
    // leboncoin furnished attribute: "1" = meublé, "2" = non meublé
    if (c.furnished === 'furnished') enums['furnished'] = ['1'];
    else if (c.furnished === 'unfurnished') enums['furnished'] = ['2'];

    const location: Record<string, unknown> = {};
    if (center) {
      location['area'] = {
        lat: center.lat,
        lng: center.lon,
        radius: Math.round(c.maxDistanceKm * 1000), // meters
      };
    }

    const price: Record<string, number> = { max: priceMax };
    if (priceMin > 0) price['min'] = priceMin;

    return {
      filters: {
        category: { id: '10' }, // Locations (rentals)
        enums,
        ranges: {
          price,
          square: { min: c.minSurfaceM2 },
          rooms: { min: c.minRooms },
        },
        location,
      },
      limit: LBC_PAGE_SIZE,
      limit_alu: 3,
      offset,
      // fixed recency sort → stable pagination across pages (no reshuffle → no
      // dupes/gaps while exhausting the result set)
      sort_by: 'time',
      sort_order: 'desc',
    };
  }

  private mapAd(ad: LbcAd): RawAd | null {
    if (!ad.price?.[0] || !ad.location) return null;

    const getAttr = (key: string): string =>
      ad.attributes?.find((a) => a.key === key)?.value ?? '';

    const isPro = (ad.owner?.type ?? '').toLowerCase() === 'pro';

    const furnishedAttr = getAttr('furnished');
    // structured attribute first (1 = meublé, 2 = non meublé); fall back to
    // scanning the title + body when the attribute is absent (common on pro ads)
    const isFurnished =
      furnishedAttr === '1'
        ? true
        : furnishedAttr === '2'
        ? false
        : inferFurnished(`${ad.subject} ${ad.body ?? ''}`);

    return {
      id: `lbc-${ad.list_id}`,
      source: this.sourceName,
      title: ad.subject,
      url: ad.url || `https://www.leboncoin.fr/ad/locations/${ad.list_id}`,
      price: ad.price[0],
      surfaceArea: parseFloat(getAttr('square')) || 0,
      rooms: parseInt(getAttr('rooms')) || 0,
      isPro,
      isFurnished,
      isColocation: isColocation(`${ad.subject} ${ad.body ?? ''}`),
      location: {
        city: ad.location.city,
        zipCode: ad.location.zipcode,
        latitude: ad.location.lat,
        longitude: ad.location.lng,
      },
      imageUrl: ad.images?.urls_large?.[0],
    };
  }
}
