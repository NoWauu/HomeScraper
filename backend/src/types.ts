export interface RawAd {
  id: string;
  source: string;
  title: string;
  url: string;
  price: number;
  surfaceArea: number;
  rooms: number;
  location: {
    city: string;
    zipCode: string;
    latitude?: number;
    longitude?: number;
  };
  imageUrl?: string;
}

export interface CommuteTimes {
  drivingMinutes: number;
  walkingMinutes: number;
  transitMinutes: number;
}

export interface BaseScraper {
  sourceName: string;
  scrape(criteria: FilterCriteria): Promise<RawAd[]>;
}

export interface FilterCriteria {
  maxPrice: number;
  minSurfaceM2: number;
  minRooms: number;
  maxDriveMinutes: number;
  maxWalkMinutes: number;
  maxTransitMinutes: number;
}

export interface AppConfig {
  targetAddress: string;
  cronSchedule: string;
  filters: FilterCriteria;
}

export interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
}

export interface RunStatus {
  lastRun: string | null;
  lastRunAdsFound: number;
  lastRunAlertsSent: number;
  totalProcessed: number;
  isRunning: boolean;
}
