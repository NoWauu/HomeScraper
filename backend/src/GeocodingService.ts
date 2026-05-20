import axios from 'axios';
import { GeoResult } from './types';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export async function geocodeAddress(address: string): Promise<GeoResult> {
  const response = await axios.get<NominatimResult[]>(
    'https://nominatim.openstreetmap.org/search',
    {
      params: { q: address, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'HomeScraper/1.0 (github.com/NoWauu/HomeScraper)' },
      timeout: 10_000,
    }
  );

  if (!response.data.length) {
    throw new Error(`Nominatim: no results for address "${address}"`);
  }

  const r = response.data[0];
  return {
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    displayName: r.display_name,
  };
}
