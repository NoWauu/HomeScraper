export interface FilterCriteria {
  maxPrice: number;
  minSurfaceM2: number;
  minRooms: number;
  maxDistanceKm: number;
  maxDriveMinutes: number;
  maxWalkMinutes: number;
  maxTransitMinutes: number;
}

export interface AppConfig {
  targetAddress: string;
  cronSchedule: string;
  filters: FilterCriteria;
}

export interface RunStatus {
  lastRun: string | null;
  lastRunAdsFound: number;
  lastRunAlertsSent: number;
  totalProcessed: number;
  isRunning: boolean;
}

export type ToastType = 'success' | 'error';

export interface ToastState {
  message: string;
  type: ToastType;
  id: number;
}
