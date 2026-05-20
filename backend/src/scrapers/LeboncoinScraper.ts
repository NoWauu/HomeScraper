import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { buildBrowserHeaders } from '../utils/headers';

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

export class LeboncoinScraper implements BaseScraper {
  readonly sourceName = 'leboncoin';

  async scrape(criteria: FilterCriteria, center?: GeoCenter): Promise<RawAd[]> {
    const url = this.buildSearchUrl(criteria, center);

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
      return [];
    }

    const parsed: NextData = JSON.parse(nextDataText);
    const ads = parsed?.props?.pageProps?.searchData?.ads ?? [];

    return ads.map((ad) => this.mapAd(ad)).filter((ad): ad is RawAd => ad !== null);
  }

  private buildSearchUrl(c: FilterCriteria, center?: GeoCenter): string {
    const params = new URLSearchParams({
      category: '10',
      real_estate_type: '2',
      price: `min-max-${c.maxPrice}`,
      square: `min-${c.minSurfaceM2}`,
      rooms: `min-${c.minRooms}`,
    });

    if (center) {
      params.set('lat', String(center.lat));
      params.set('lng', String(center.lon));
      params.set('rad', String(c.maxDistanceKm));
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
      url: `https://www.leboncoin.fr/annonces/${ad.list_id}.htm`,
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
