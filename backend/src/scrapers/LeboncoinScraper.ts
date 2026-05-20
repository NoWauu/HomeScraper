import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { buildBrowserHeaders } from '../utils/headers';
import { haversineKm } from '../utils/geo';

interface LbcAttribute {
  key: string;
  value: string;
}

interface LbcAd {
  list_id: number;
  subject: string;
  url: string;
  price: number[];
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

interface NextData {
  props?: {
    pageProps?: {
      searchData?: {
        ads?: LbcAd[];
      };
    };
  };
}

const LBC_MAX_PAGES = 10;

export class LeboncoinScraper implements BaseScraper {
  readonly sourceName = 'leboncoin';

  async scrape(criteria: FilterCriteria, center?: GeoCenter): Promise<RawAd[]> {
    const all: LbcAd[] = [];

    for (let page = 1; page <= LBC_MAX_PAGES; page++) {
      const url = this.buildSearchUrl(criteria, center, page);
      if (page === 1) console.log('[leboncoin] search url:', url);

      const response = await axios.get<string>(url, {
        headers: {
          ...buildBrowserHeaders(),
          Referer: 'https://www.leboncoin.fr/',
        },
        timeout: 20_000,
        responseType: 'text',
      });

      const $ = cheerio.load(response.data);
      const nextDataText = $('#__NEXT_DATA__').text();

      if (!nextDataText) {
        console.warn('[Leboncoin] __NEXT_DATA__ not found — page structure may have changed');
        break;
      }

      const parsed: NextData = JSON.parse(nextDataText);
      const ads = parsed?.props?.pageProps?.searchData?.ads ?? [];

      if (!ads.length) break;
      all.push(...ads);

      // LBC returns ≤35 ads/page; fewer means last page
      if (ads.length < 35) break;
    }

    console.log(`[leboncoin] raw ads from api: ${all.length}`);
    if (all.length > 0) {
      const sample = all[0]!;
      console.log(`[leboncoin] sample ad attrs:`, JSON.stringify(sample.attributes?.slice(0, 6)));
      console.log(`[leboncoin] sample price:`, sample.price, `location:`, sample.location);
    }

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

  private buildSearchUrl(c: FilterCriteria, center: GeoCenter | undefined, page: number): string {
    const params = new URLSearchParams({
      category: '10',
      real_estate_type: '2',
      price: `-${c.maxPrice}`,
      square: `${c.minSurfaceM2}-9999`,
      rooms: `${c.minRooms}-9`,
      page: String(page),
    });

    if (center) {
      const locationObj: Record<string, unknown> = {
        lat: center.lat,
        lng: center.lon,
        rad: c.maxDistanceKm,
        source: 'city',
      };
      if (center.city) locationObj['city'] = center.city;
      if (center.zipCode) {
        locationObj['zipcode'] = center.zipCode;
        locationObj['label'] = center.city
          ? `${center.city} (${center.zipCode})`
          : center.zipCode;
        locationObj['department_id'] = center.zipCode.slice(0, 2);
      }
      params.set('location', JSON.stringify([locationObj]));
    }

    return `https://www.leboncoin.fr/recherche?${params.toString()}`;
  }

  private mapAd(ad: LbcAd): RawAd | null {
    if (!ad.price?.[0] || !ad.location) return null;

    const getAttr = (key: string): string =>
      ad.attributes.find((a) => a.key === key)?.value ?? '0';

    return {
      id: `lbc-${ad.list_id}`,
      source: this.sourceName,
      title: ad.subject,
      url: `https://www.leboncoin.fr/ad/locations/${ad.list_id}`,
      price: ad.price[0],
      surfaceArea: parseFloat(getAttr('square')) || 0,
      rooms: parseInt(getAttr('rooms')) || 0,
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
