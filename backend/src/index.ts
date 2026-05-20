import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron, { ScheduledTask } from 'node-cron';
import { Database } from './Database';
import { geocodeAddress } from './GeocodingService';
import { RoutingService } from './RoutingService';
import { DiscordNotifier } from './DiscordNotifier';
import { ScraperManager } from './scrapers/ScraperManager';
import { LeboncoinScraper } from './scrapers/LeboncoinScraper';
import { BienIciScraper } from './scrapers/BienIciScraper';
import { createRouter } from './api/routes';
import { AppConfig, FilterCriteria, RawAd, CommuteTimes, GeoResult } from './types';
import { haversineKm } from './utils/geo';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const DISCORD_WEBHOOK_URL = requireEnv('DISCORD_WEBHOOK_URL');
const VALHALLA_URL = process.env['VALHALLA_URL'] ?? 'http://localhost:8002';
const PORT = parseInt(process.env['PORT'] ?? '3001');

const db = new Database();
const manager = new ScraperManager();
manager.register(new LeboncoinScraper());
manager.register(new BienIciScraper());

const notifier = new DiscordNotifier(DISCORD_WEBHOOK_URL);

let routing: RoutingService | null = null;
let targetGeo: GeoResult | null = null;
let cronTask: ScheduledTask | null = null;
let isRunning = false;

function passesFilter(ad: RawAd, f: FilterCriteria): boolean {
  return ad.price <= f.maxPrice && ad.surfaceArea >= f.minSurfaceM2 && ad.rooms >= f.minRooms;
}

function passesCommute(t: CommuteTimes, f: FilterCriteria): boolean {
  const checks: boolean[] = [];
  if (t.drivingMinutes >= 0) checks.push(t.drivingMinutes <= f.maxDriveMinutes);
  if (t.walkingMinutes >= 0) checks.push(t.walkingMinutes <= f.maxWalkMinutes);
  if (t.transitMinutes >= 0) checks.push(t.transitMinutes <= f.maxTransitMinutes);
  // No routing data at all → let through (can't judge)
  if (checks.length === 0) return true;
  // Pass if at least one travel mode is within its threshold
  return checks.some(Boolean);
}

async function runPipeline(): Promise<void> {
  if (isRunning) {
    console.log('[pipeline] already running, skipping');
    return;
  }

  const config = db.getConfig();

  if (!routing || !targetGeo) {
    console.log(`[pipeline] geocoding target: ${config.targetAddress}`);
    try {
      targetGeo = await geocodeAddress(config.targetAddress);
      console.log(`[pipeline] target resolved → ${targetGeo.displayName}`);
      routing = new RoutingService(targetGeo.lat, targetGeo.lon, VALHALLA_URL);
    } catch (err) {
      console.error('[pipeline] geocoding failed:', err);
      return;
    }
  }

  isRunning = true;
  console.log('[pipeline] starting run…');

  let adsFound = 0;
  let alertsSent = 0;

  try {
    const rawAds = await manager.runAll(config.filters, targetGeo ?? undefined);
    const preFiltered = rawAds.filter((ad) => passesFilter(ad, config.filters));

    // Geo pre-filter: drop ads outside maxDistanceKm or with no coords (can't verify distance)
    const inRange = preFiltered.filter((ad) => {
      const { latitude, longitude } = ad.location;
      if (latitude === undefined || longitude === undefined) return false;
      return haversineKm(latitude, longitude, targetGeo!.lat, targetGeo!.lon) <= config.filters.maxDistanceKm;
    });

    const newAds = inRange.filter((ad) => db.isNewAd(ad.id));

    console.log(
      `[pipeline] ${rawAds.length} raw → ${preFiltered.length} pass filter → ${inRange.length} in range → ${newAds.length} new`
    );

    adsFound = newAds.length;

    for (const ad of newAds) {
      const { latitude: lat, longitude: lon } = ad.location;

      if (lat === undefined || lon === undefined) {
        console.warn(`[pipeline] ${ad.id} has no coords — skipping`);
        db.markAsSeen(ad.id, ad.source);
        continue;
      }

      let commute: CommuteTimes;
      try {
        commute = await routing.getTravelTimes(lat, lon);
      } catch (err) {
        console.error(`[pipeline] routing failed for ${ad.id}:`, err);
        db.markAsSeen(ad.id, ad.source);
        continue;
      }

      if (!passesCommute(commute, config.filters)) {
        console.log(`[pipeline] ${ad.id} fails commute filter`);
        db.markAsSeen(ad.id, ad.source);
        continue;
      }

      db.markAsSeen(ad.id, ad.source);

      try {
        await notifier.send(ad, commute);
        alertsSent++;
        console.log(`[pipeline] alert sent for ${ad.id}`);
      } catch (err) {
        console.error(`[pipeline] Discord failed for ${ad.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[pipeline] unexpected error:', err);
  } finally {
    isRunning = false;
    db.logRun(adsFound, alertsSent);
    console.log(`[pipeline] done — ${alertsSent}/${adsFound} alerts sent`);
  }
}

function scheduleWith(cronExpr: string): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] invalid cron expression: "${cronExpr}"`);
    return;
  }

  cronTask = cron.schedule(cronExpr, () => {
    runPipeline().catch(console.error);
  });

  console.log(`[scheduler] scheduled with: ${cronExpr}`);
}

function handleConfigChange(config: AppConfig): void {
  routing = null;
  targetGeo = null;
  scheduleWith(config.cronSchedule);
  console.log('[config] updated — routing reset, schedule reloaded');
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(
  '/api',
  createRouter(db, handleConfigChange, () => ({ isRunning }), () => {
    runPipeline().catch(console.error);
  })
);

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);

  const config = db.getConfig();
  scheduleWith(config.cronSchedule);

  // Run immediately on startup
  runPipeline().catch(console.error);
});

process.on('SIGINT', () => {
  cronTask?.stop();
  db.close();
  process.exit(0);
});
