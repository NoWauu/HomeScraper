import axios from 'axios';
import { CommuteTimes } from './types';

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
    const [driving, walking, transit] = await Promise.allSettled([
      this.osrmDuration('driving', lat, lon),
      this.osrmDuration('foot', lat, lon),
      this.valhallaTransitDuration(lat, lon),
    ]);

    return {
      drivingMinutes: driving.status === 'fulfilled' ? driving.value : -1,
      walkingMinutes: walking.status === 'fulfilled' ? walking.value : -1,
      transitMinutes: transit.status === 'fulfilled' ? transit.value : -1,
    };
  }

  private async osrmDuration(
    profile: 'driving' | 'foot',
    lat: number,
    lon: number
  ): Promise<number> {
    const url =
      `https://router.project-osrm.org/route/v1/${profile}/` +
      `${lon},${lat};${this.targetLon},${this.targetLat}?overview=false`;

    const res = await axios.get<OsrmResponse>(url, {
      headers: { 'User-Agent': 'HomeScraper/1.0' },
      timeout: 10_000,
    });

    return Math.round(res.data.routes[0].duration / 60);
  }

  private async valhallaTransitDuration(lat: number, lon: number): Promise<number> {
    const res = await axios.post<ValhallaTripResponse>(
      `${this.valhallaUrl}/route`,
      {
        locations: [
          { lon, lat, type: 'break' },
          { lon: this.targetLon, lat: this.targetLat, type: 'break' },
        ],
        costing: 'multimodal',
        costing_options: {
          transit: { use_bus: true, use_rail: true },
          pedestrian: { walking_speed: 5.1 },
        },
        date_time: { type: 1, value: nowIso() },
      },
      { timeout: 15_000 }
    );

    return Math.round(res.data.trip.summary.time / 60);
  }
}
