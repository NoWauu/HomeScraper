import axios from 'axios';
import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { buildApiHeaders } from '../utils/headers';
import { polygonCentroid, haversineKm } from '../utils/geo';
import { inferFurnished, isColocation } from '../utils/text';

interface BienIciPosition {
  lat?: number;
  lon?: number; // BienIci uses `lon`, not `lng`
  lng?: number; // tolerate the other spelling just in case
}

interface BienIciAd {
  id: string;
  title?: string;
  description?: string;
  propertyType?: string;
  price?: number;
  surfaceArea?: number;
  roomsQuantity?: number;
  bedroomsQuantity?: number;
  furnished?: boolean;
  city?: string;
  postalCode?: string;
  blurInfo?: {
    position?: BienIciPosition;
    centroid?: BienIciPosition;
    shape?: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: [number, number][][] | [number, number][][][];
    };
  };
  photos?: Array<{ url?: string }>;
  userRelativeUrl?: string;
}

interface BienIciResponse {
  realEstateAds: BienIciAd[];
  total?: number;
}

interface BienIciSuggestion {
  id: string;
  name: string;
  type: string;
  postalCodes?: string[];
  zoneIds?: string[];
}

const PAGE_SIZE = 48;
const MAX_PAGES = 10;

export class BienIciScraper implements BaseScraper {
  readonly sourceName = 'bienici';

  private async lookupZoneId(query: string): Promise<string | null> {
    try {
      const r = await axios.get<BienIciSuggestion[]>('https://www.bienici.com/suggest.json', {
        params: { q: query, limit: 5 },
        headers: {
          ...buildApiHeaders(),
          Referer: 'https://www.bienici.com/',
        },
        timeout: 10_000,
      });
      const match = r.data.find((s) => s.postalCodes?.includes(query) || s.type === 'city');
      const suggestion = match ?? r.data[0];
      // Use the numeric zoneId (e.g. "-1076124") not the UUID-style id
      return suggestion?.zoneIds?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async scrape(criteria: FilterCriteria, center?: GeoCenter): Promise<RawAd[]> {
    const filters: Record<string, unknown> = {
      filterType: 'rent',
      propertyType: ['flat', 'house'],
      maxPrice: criteria.maxPrice,
      minRooms: criteria.minRooms,
      minArea: criteria.minSurfaceM2,
      // without onTheMarket the API also returns off-market ads whose page
      // shows "Cette annonce est indisponible"; newProperty:false drops
      // new-build programs — both match what bienici.com's own search sends
      onTheMarket: [true],
      newProperty: false,
    };

    if (center?.zipCode) {
      const zoneId = await this.lookupZoneId(center.zipCode);
      if (zoneId) {
        // BienIci ignores a flat `zoneIds` key — the geo zone must be nested as
        // `zoneIdsByTypes`, otherwise the search returns nationwide results.
        filters['zoneIdsByTypes'] = { zoneIds: [zoneId] };
        console.log(`[bienici] zone id for ${center.zipCode}: ${zoneId}`);
      } else {
        console.warn('[bienici] zone lookup failed, no geo filter applied');
      }
    }

    console.log('[bienici] filters:', JSON.stringify(filters));
    const all: BienIciAd[] = [];
    const seen = new Set<string>();

    // BienIci's `total` is an inflated global-ish counter, not the filtered
    // count, and it re-serves the same records once `from` runs past the real
    // results. So dedupe by id and stop as soon as a page adds nothing new.
    for (let from = 0; from < PAGE_SIZE * MAX_PAGES; from += PAGE_SIZE) {
      const response = await axios.get<BienIciResponse>(
        'https://www.bienici.com/realEstateAds.json',
        {
          params: {
            filters: JSON.stringify(filters),
            size: PAGE_SIZE,
            from,
            hasMarketingManager: false,
            priceByCurrency: 'eur',
          },
          headers: {
            ...buildApiHeaders(),
            Referer: 'https://www.bienici.com/',
            Origin: 'https://www.bienici.com',
          },
          timeout: 20_000,
        }
      );

      const page = response.data.realEstateAds;
      if (from === 0) console.log(`[bienici] total from api: ${response.data.total ?? 'unknown'}, page size: ${page.length}`);
      if (!page.length) break;

      const fresh = page.filter((ad) => ad.id && !seen.has(ad.id));
      for (const ad of fresh) seen.add(ad.id);
      all.push(...fresh);

      // no new ids on this page → we've exhausted the real results
      if (!fresh.length) break;
      if (page.length < PAGE_SIZE) break;
    }

    const mapped = all.map((ad) => this.mapAd(ad)).filter((ad): ad is RawAd => ad !== null);
    if (!center) return mapped;
    return mapped.filter((ad) => {
      const { latitude, longitude } = ad.location;
      if (latitude === undefined || longitude === undefined) return false;
      return haversineKm(latitude, longitude, center.lat, center.lon) <= criteria.maxDistanceKm;
    });
  }

  private extractPoint(ad: BienIciAd): { latitude?: number; longitude?: number } {
    // BienIci names the longitude `lon` (some payloads `lng`); every ad we see
    // carries blurInfo.position — falling back to centroid then polygon.
    const pt = ad.blurInfo?.position ?? ad.blurInfo?.centroid;
    const lon = pt?.lon ?? pt?.lng;
    if (pt?.lat !== undefined && lon !== undefined) {
      return { latitude: pt.lat, longitude: lon };
    }
    const shape = ad.blurInfo?.shape;
    if (shape) {
      const ring =
        shape.type === 'Polygon'
          ? (shape.coordinates as [number, number][][])[0]
          : (shape.coordinates as [number, number][][][])[0][0];
      if (ring?.length) {
        const { lat, lon } = polygonCentroid(ring);
        return { latitude: lat, longitude: lon };
      }
    }
    return {};
  }

  private mapAd(ad: BienIciAd): RawAd | null {
    if (!ad.price || !ad.city) return null;

    return {
      id: `bienici-${ad.id}`,
      source: this.sourceName,
      title: ad.title ?? `${ad.propertyType ?? 'Appartement'} ${ad.surfaceArea ?? '?'}m²`,
      url: this.buildAdUrl(ad),
      price: ad.price,
      surfaceArea: ad.surfaceArea ?? 0,
      rooms: ad.roomsQuantity ?? ad.bedroomsQuantity ?? 0,
      isPro: false,
      // bienici's list API omits a furnished flag → infer from title + description
      isFurnished: ad.furnished ?? inferFurnished(`${ad.title ?? ''} ${ad.description ?? ''}`),
      isColocation: isColocation(`${ad.title ?? ''} ${ad.description ?? ''}`),
      location: {
        city: ad.city,
        zipCode: ad.postalCode ?? '',
        ...this.extractPoint(ad),
      },
      imageUrl: ad.photos?.[0]?.url,
    };
  }

  /**
   * BienIci's bare `/annonce/{id}` route is unreliable (loads the generic
   * homepage for many ids). The canonical path always resolves:
   *   /annonce/{location|achat}/{city}/{appartement|maison}/{n}pieces/{id}
   * The slug words are cosmetic (the SPA routes on the trailing id), but the
   * full structure is required.
   */
  private buildAdUrl(ad: BienIciAd): string {
    const citySlug =
      (ad.city ?? 'ville')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ville';
    const type = ad.propertyType === 'house' ? 'maison' : 'appartement';
    const rooms = ad.roomsQuantity ?? ad.bedroomsQuantity ?? 1;
    return `https://www.bienici.com/annonce/location/${citySlug}/${type}/${rooms}pieces/${ad.id}`;
  }
}
