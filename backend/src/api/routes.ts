import { Router, Request, Response } from 'express';
import { Database } from '../Database';
import { AppConfig } from '../types';

export function createRouter(
  db: Database,
  onConfigChange: (config: AppConfig) => void,
  getStatus: () => { isRunning: boolean },
  triggerRun: () => void
): Router {
  const router = Router();

  router.get('/config', (_req: Request, res: Response) => {
    res.json(db.getConfig());
  });

  router.put('/config', (req: Request, res: Response) => {
    const body = req.body as AppConfig;

    if (!body.targetAddress || !body.cronSchedule || !body.filters) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const rawFurnished = String(body.filters.furnished ?? 'any');
    const furnished = (['furnished', 'unfurnished', 'any'] as const).includes(
      rawFurnished as 'furnished' | 'unfurnished' | 'any'
    )
      ? (rawFurnished as 'furnished' | 'unfurnished' | 'any')
      : ('any' as const);

    const config: AppConfig = {
      targetAddress: String(body.targetAddress).trim(),
      cronSchedule: String(body.cronSchedule).trim(),
      filters: {
        maxPrice: Number(body.filters.maxPrice),
        minSurfaceM2: Number(body.filters.minSurfaceM2),
        minRooms: Number(body.filters.minRooms),
        maxDistanceKm: Number(body.filters.maxDistanceKm),
        maxDriveMinutes: Number(body.filters.maxDriveMinutes),
        maxWalkMinutes: Number(body.filters.maxWalkMinutes),
        maxTransitMinutes: Number(body.filters.maxTransitMinutes),
        furnished,
      },
    };

    db.saveConfig(config);
    onConfigChange(config);
    res.json({ ok: true, config });
  });

  router.get('/status', (_req: Request, res: Response) => {
    const lastRun = db.getLastRun();
    const { isRunning } = getStatus();

    res.json({
      lastRun: lastRun?.ran_at ?? null,
      lastRunAdsFound: lastRun?.ads_found ?? 0,
      lastRunAlertsSent: lastRun?.alerts_sent ?? 0,
      totalProcessed: db.getTotalProcessed(),
      isRunning,
    });
  });

  router.post('/run', (_req: Request, res: Response) => {
    const { isRunning } = getStatus();
    if (isRunning) {
      res.status(409).json({ error: 'Pipeline already running' });
      return;
    }
    triggerRun();
    res.json({ ok: true, message: 'Pipeline triggered' });
  });

  return router;
}
