import axios from 'axios';
import { RoutingService } from '../RoutingService';
import { formatDuration } from '../DiscordNotifier';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  test('negative → N/A', () => {
    expect(formatDuration(-1)).toBe('N/A');
    expect(formatDuration(-99)).toBe('N/A');
  });

  test('< 60 min', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(25)).toBe('25 min');
    expect(formatDuration(59)).toBe('59 min');
  });

  test('whole hours', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
  });

  test('hours + minutes', () => {
    expect(formatDuration(75)).toBe('1h 15min');
    expect(formatDuration(90)).toBe('1h 30min');
    expect(formatDuration(125)).toBe('2h 5min');
  });
});

// ── RoutingService ────────────────────────────────────────────────────────────

const TARGET_LAT = 48.3902;
const TARGET_LON = -4.4833;
const VALHALLA_URL = 'http://localhost:8002';

describe('RoutingService.getTravelTimes', () => {
  const svc = new RoutingService(TARGET_LAT, TARGET_LON, VALHALLA_URL);

  const ORIGIN_LAT = 48.41;
  const ORIGIN_LON = -4.50;

  beforeEach(() => jest.clearAllMocks());

  test('returns parsed minutes when all APIs succeed', async () => {
    // OSRM get → driving; Valhalla post ×2 → walking (pedestrian), then transit (multimodal)
    mockedAxios.get.mockResolvedValueOnce({ data: { routes: [{ duration: 900 }] } }); // driving 15 min
    mockedAxios.post
      .mockResolvedValueOnce({ data: { trip: { summary: { time: 1800 } } } })  // walking 30 min
      .mockResolvedValueOnce({ data: { trip: { summary: { time: 1200 } } } }); // transit 20 min

    const result = await svc.getTravelTimes(ORIGIN_LAT, ORIGIN_LON);

    expect(result.drivingMinutes).toBe(15);
    expect(result.walkingMinutes).toBe(30);
    expect(result.transitMinutes).toBe(20);
  });

  test('returns -1 for walking and transit when Valhalla fails', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { routes: [{ duration: 600 }] } }); // driving 10 min
    mockedAxios.post.mockRejectedValue(new Error('Valhalla unreachable'));

    const result = await svc.getTravelTimes(ORIGIN_LAT, ORIGIN_LON);

    expect(result.drivingMinutes).toBe(10);
    expect(result.walkingMinutes).toBe(-1);
    expect(result.transitMinutes).toBe(-1);
  });

  test('returns -1 for driving when OSRM fails', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('OSRM driving down'));
    mockedAxios.post
      .mockResolvedValueOnce({ data: { trip: { summary: { time: 3600 } } } })  // walking 60 min
      .mockResolvedValueOnce({ data: { trip: { summary: { time: 2400 } } } }); // transit 40 min

    const result = await svc.getTravelTimes(ORIGIN_LAT, ORIGIN_LON);

    expect(result.drivingMinutes).toBe(-1);
    expect(result.walkingMinutes).toBe(60);
    expect(result.transitMinutes).toBe(40);
  });

  test('returns all -1 when all APIs fail', async () => {
    mockedAxios.get.mockRejectedValue(new Error('OSRM down'));
    mockedAxios.post.mockRejectedValue(new Error('Valhalla down'));

    const result = await svc.getTravelTimes(ORIGIN_LAT, ORIGIN_LON);

    expect(result.drivingMinutes).toBe(-1);
    expect(result.walkingMinutes).toBe(-1);
    expect(result.transitMinutes).toBe(-1);
  });

  test('skips Valhalla (walking+transit) when origin > 100km from target', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { routes: [{ duration: 7200 }] } });

    // No Valhalla call expected — haversine guard fires for both walking and transit
    const farLat = 51.5;  // London-ish, way outside 100km
    const farLon = -0.12;
    const result = await svc.getTravelTimes(farLat, farLon);

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(result.walkingMinutes).toBe(-1);
    expect(result.transitMinutes).toBe(-1);
  });

  test('rounds sub-minute durations correctly', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { routes: [{ duration: 89 }] } }); // 1.48 min → 1
    mockedAxios.post
      .mockResolvedValueOnce({ data: { trip: { summary: { time: 91 } } } })   // 1.52 min → 2
      .mockResolvedValueOnce({ data: { trip: { summary: { time: 119 } } } }); // 1.98 min → 2

    const result = await svc.getTravelTimes(ORIGIN_LAT, ORIGIN_LON);

    expect(result.drivingMinutes).toBe(1);
    expect(result.walkingMinutes).toBe(2);
    expect(result.transitMinutes).toBe(2);
  });
});
