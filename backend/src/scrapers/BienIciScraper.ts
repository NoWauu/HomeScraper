import axios from 'axios';
import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { buildApiHeaders } from '../utils/headers';
import { polygonCentroid, haversineKm } from '../utils/geo';

interface BienIciPosition {
  lat?: number;
  lng?: number;
}

interface BienIciAd {
  id: string;
  title?: string;
  propertyType?: string;
  price?: number;
  surfaceArea?: number;
  roomsQuantity?: number;
  bedroomsQuantity?: number;
  city?: string;
  postalCode?: string;
  blurInfo?: {
    position?: BienIciPosition;
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
    };

    if (center?.zipCode) {
      const zoneId = await this.lookupZoneId(center.zipCode);
      if (zoneId) {
        filters['zoneIds'] = [zoneId];
        console.log(`[bienici] zone id for ${center.zipCode}: ${zoneId}`);
      } else {
        console.warn('[bienici] zone lookup failed, no geo filter applied');
      }
    }

    console.log('[bienici] filters:', JSON.stringify(filters));
    const all: BienIciAd[] = [];
    let from = 0;
    let total = Infinity;

    while (from < total && from < PAGE_SIZE * MAX_PAGES) {
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

      all.push(...page);

      if (total === Infinity && response.data.total !== undefined) {
        total = response.data.total;
      }

      from += page.length;

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
    const pos = ad.blurInfo?.position;
    if (pos?.lat !== undefined && pos?.lng !== undefined) {
      return { latitude: pos.lat, longitude: pos.lng };
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
      url: ad.userRelativeUrl
        ? `https://www.bienici.com${ad.userRelativeUrl}`
        : `https://www.bienici.com/annonce/${ad.id}`,
      price: ad.price,
      surfaceArea: ad.surfaceArea ?? 0,
      rooms: ad.roomsQuantity ?? ad.bedroomsQuantity ?? 0,
      location: {
        city: ad.city,
        zipCode: ad.postalCode ?? '',
        ...this.extractPoint(ad),
      },
      imageUrl: ad.photos?.[0]?.url,
    };
  }
}
