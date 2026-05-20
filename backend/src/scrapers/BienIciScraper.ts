import axios from 'axios';
import { BaseScraper, RawAd, FilterCriteria } from '../types';
import { buildApiHeaders } from '../utils/headers';

interface BienIciPosition {
  lat?: number;
  lon?: number;
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
  };
  photos?: Array<{ url?: string }>;
  userRelativeUrl?: string;
}

interface BienIciResponse {
  realEstateAds: BienIciAd[];
}

export class BienIciScraper implements BaseScraper {
  readonly sourceName = 'bienici';

  async scrape(criteria: FilterCriteria): Promise<RawAd[]> {
    const filters = {
      filterType: 'rent',
      propertyType: ['flat', 'house'],
      maxPrice: criteria.maxPrice,
      minRooms: criteria.minRooms,
      minArea: criteria.minSurfaceM2,
    };

    const response = await axios.get<BienIciResponse>(
      'https://www.bienici.com/realEstateAds.json',
      {
        params: {
          filters: JSON.stringify(filters),
          size: 48,
          from: 0,
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

    return response.data.realEstateAds
      .map((ad) => this.mapAd(ad))
      .filter((ad): ad is RawAd => ad !== null);
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
        latitude: ad.blurInfo?.position?.lat,
        longitude: ad.blurInfo?.position?.lon,
      },
      imageUrl: ad.photos?.[0]?.url,
    };
  }
}
