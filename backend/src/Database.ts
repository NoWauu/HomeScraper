import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import { AppConfig } from './types';

const DEFAULT_CONFIG: AppConfig = {
  targetAddress: process.env['DEFAULT_TARGET_ADDRESS'] ?? '6 Av. Victor le Gorgeu, 29200 Brest, France',
  cronSchedule: process.env['DEFAULT_CRON_SCHEDULE'] ?? '*/30 * * * *',
  filters: {
    maxPrice: parseInt(process.env['DEFAULT_MAX_PRICE'] ?? '1500'),
    minSurfaceM2: parseInt(process.env['DEFAULT_MIN_SURFACE_M2'] ?? '25'),
    minRooms: parseInt(process.env['DEFAULT_MIN_ROOMS'] ?? '1'),
    maxDistanceKm: parseInt(process.env['DEFAULT_MAX_DISTANCE_KM'] ?? '50'),
    maxDriveMinutes: parseInt(process.env['DEFAULT_MAX_DRIVE_MINUTES'] ?? '30'),
    maxWalkMinutes: parseInt(process.env['DEFAULT_MAX_WALK_MINUTES'] ?? '45'),
    maxTransitMinutes: parseInt(process.env['DEFAULT_MAX_TRANSIT_MINUTES'] ?? '45'),
    furnished: (process.env['DEFAULT_FURNISHED'] as 'furnished' | 'unfurnished' | 'any') ?? 'any',
  },
};

export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string = path.join(process.cwd(), 'data', 'homescraper.db')) {
    const dir = path.dirname(dbPath);
    const fs = require('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_ads (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ran_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ads_found INTEGER NOT NULL DEFAULT 0,
        alerts_sent INTEGER NOT NULL DEFAULT 0
      );
    `);

    this.seedConfig();
  }

  private seedConfig(): void {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)'
    );

    const entries: [string, string][] = [
      ['targetAddress', DEFAULT_CONFIG.targetAddress],
      ['cronSchedule', DEFAULT_CONFIG.cronSchedule],
      ['maxPrice', String(DEFAULT_CONFIG.filters.maxPrice)],
      ['minSurfaceM2', String(DEFAULT_CONFIG.filters.minSurfaceM2)],
      ['minRooms', String(DEFAULT_CONFIG.filters.minRooms)],
      ['maxDistanceKm', String(DEFAULT_CONFIG.filters.maxDistanceKm)],
      ['maxDriveMinutes', String(DEFAULT_CONFIG.filters.maxDriveMinutes)],
      ['maxWalkMinutes', String(DEFAULT_CONFIG.filters.maxWalkMinutes)],
      ['maxTransitMinutes', String(DEFAULT_CONFIG.filters.maxTransitMinutes)],
      ['furnished', DEFAULT_CONFIG.filters.furnished],
    ];

    const seed = this.db.transaction((rows: [string, string][]) => {
      for (const [k, v] of rows) insert.run(k, v);
    });

    seed(entries);
  }

  getConfig(): AppConfig {
    const rows = this.db.prepare('SELECT key, value FROM app_config').all() as {
      key: string;
      value: string;
    }[];

    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    return {
      targetAddress: map['targetAddress'] ?? DEFAULT_CONFIG.targetAddress,
      cronSchedule: map['cronSchedule'] ?? DEFAULT_CONFIG.cronSchedule,
      filters: {
        maxPrice: parseInt(map['maxPrice'] ?? '1500'),
        minSurfaceM2: parseInt(map['minSurfaceM2'] ?? '25'),
        minRooms: parseInt(map['minRooms'] ?? '1'),
        maxDistanceKm: parseInt(map['maxDistanceKm'] ?? '50'),
        maxDriveMinutes: parseInt(map['maxDriveMinutes'] ?? '30'),
        maxWalkMinutes: parseInt(map['maxWalkMinutes'] ?? '45'),
        maxTransitMinutes: parseInt(map['maxTransitMinutes'] ?? '45'),
        furnished: (map['furnished'] as 'furnished' | 'unfurnished' | 'any') ?? 'any',
      },
    };
  }

  saveConfig(config: AppConfig): void {
    const upsert = this.db.prepare(
      'INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)'
    );

    const save = this.db.transaction(() => {
      upsert.run('targetAddress', config.targetAddress);
      upsert.run('cronSchedule', config.cronSchedule);
      upsert.run('maxPrice', String(config.filters.maxPrice));
      upsert.run('minSurfaceM2', String(config.filters.minSurfaceM2));
      upsert.run('minRooms', String(config.filters.minRooms));
      upsert.run('maxDistanceKm', String(config.filters.maxDistanceKm));
      upsert.run('maxDriveMinutes', String(config.filters.maxDriveMinutes));
      upsert.run('maxWalkMinutes', String(config.filters.maxWalkMinutes));
      upsert.run('maxTransitMinutes', String(config.filters.maxTransitMinutes));
      upsert.run('furnished', config.filters.furnished);
    });

    save();
  }

  isNewAd(id: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM processed_ads WHERE id = ?')
      .get(id);
    return row === undefined;
  }

  markAsSeen(id: string, source: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO processed_ads (id, source) VALUES (?, ?)')
      .run(id, source);
  }

  logRun(adsFound: number, alertsSent: number): void {
    this.db
      .prepare('INSERT INTO run_log (ads_found, alerts_sent) VALUES (?, ?)')
      .run(adsFound, alertsSent);
  }

  getLastRun(): { ran_at: string; ads_found: number; alerts_sent: number } | null {
    return (
      (this.db
        .prepare('SELECT ran_at, ads_found, alerts_sent FROM run_log ORDER BY id DESC LIMIT 1')
        .get() as { ran_at: string; ads_found: number; alerts_sent: number } | undefined) ?? null
    );
  }

  getTotalProcessed(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM processed_ads')
      .get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}
