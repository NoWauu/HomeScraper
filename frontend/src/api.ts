import { AppConfig, RunStatus } from './types';

const BASE = '/api';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getConfig: () => json<AppConfig>('/config'),
  saveConfig: (config: AppConfig) =>
    json<{ ok: boolean; config: AppConfig }>('/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  getStatus: () => json<RunStatus>('/status'),
  triggerRun: () => json<{ ok: boolean }>('/run', { method: 'POST' }),
};
