import axios from 'axios';
import { CommuteTimes } from './types';
import { haversineKm } from './utils/geo';

const VALHALLA_MAX_KM = 100;

interface OsrmResponse {
  routes: Array<{ duration: number }>;
}

interface ValhallaTripResponse {
  trip: {
    summary: { time: number };
  };
}

function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export class RoutingService {
  constructor(
    private readonly targetLat: number,
    private readonly targetLon: number,
    private readonly valhallaUrl: string
  ) {}

  async getTravelTimes(lat: number, lon: number): Promise<CommuteTimes> {
    // Driving via OSRM public demo (car network only — its /foot/ profile still
    // routes by car, which is why walking used to equal driving). Walking and
    // transit go through the local Valhalla instance, which has real pedestrian
    // and multimodal costings built from the OSM + GTFS tiles.
    const [driving, walking, transit] = await Promise.allSettled([
      this.osrmDriving(lat, lon),
      this.valhallaDuration('pedestrian', lat, lon),
      this.valhallaDuration('multimodal', lat, lon),
    ]);

    return {
      drivingMinutes: driving.status === 'fulfilled' ? driving.value : -1,
      walkingMinutes: walking.status === 'fulfilled' ? walking.value : -1,
      transitMinutes: transit.status === 'fulfilled' ? transit.value : -1,
    };
  }

  private async osrmDriving(lat: number, lon: number): Promise<number> {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${lon},${lat};${this.targetLon},${this.targetLat}?overview=false`;

    const res = await axios.get<OsrmResponse>(url, {
      headers: { 'User-Agent': 'HomeScraper/1.0' },
      timeout: 10_000,
    });

    return Math.round(res.data.routes[0].duration / 60);
  }

  private async valhallaDuration(
    costing: 'pedestrian' | 'multimodal',
    lat: number,
    lon: number
  ): Promise<number> {
    if (haversineKm(lat, lon, this.targetLat, this.targetLon) > VALHALLA_MAX_KM) {
      throw new Error('Valhalla: origin outside local tile coverage');
    }

    const costingOptions =
      costing === 'multimodal'
        ? {
            transit: { use_bus: true, use_rail: true },
            pedestrian: { walking_speed: 5.1 },
          }
        : { pedestrian: { walking_speed: 5.1 } };

    const res = await axios.post<ValhallaTripResponse>(
      `${this.valhallaUrl}/route`,
      {
        locations: [
          { lon, lat, type: 'break' },
          { lon: this.targetLon, lat: this.targetLat, type: 'break' },
        ],
        costing,
        costing_options: costingOptions,
        // date_time only matters for schedule-based transit routing
        ...(costing === 'multimodal' ? { date_time: { type: 1, value: nowIso() } } : {}),
      },
      { timeout: 15_000 }
    );

    return Math.round(res.data.trip.summary.time / 60);
  }
}
