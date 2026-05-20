import { RunStatus } from '../types';

interface Props {
  status: RunStatus | null;
  onRunNow: () => void;
  triggering: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function StatusBar({ status, onRunNow, triggering }: Props) {
  const running = status?.isRunning ?? false;

  return (
    <div className="relative scanlines border-b border-slate-700/50 bg-slate-800/40 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">

        {/* Left: logo + status badge */}
        <div className="flex items-center gap-4">
          <div>
            <h1 className="font-mono font-semibold text-slate-100 text-sm tracking-widest uppercase">
              Home<span className="text-amber-400">Scraper</span>
            </h1>
            <p className="text-xs text-slate-500 font-mono mt-0.5">Surveillance immobilière</p>
          </div>

          {running && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 pulse-dot" />
              <span className="font-mono text-xs text-amber-400">pipeline actif</span>
            </div>
          )}
        </div>

        {/* Center: stats */}
        <div className="flex items-center gap-6 sm:gap-8">
          <Stat value={status?.totalProcessed ?? 0} label="traités" />
          <Stat value={status?.lastRunAdsFound ?? 0} label="trouvés" />
          <Stat value={status?.lastRunAlertsSent ?? 0} label="alertes" />
          <div className="hidden sm:block">
            <p className="stat-value text-base">{formatDate(status?.lastRun ?? null)}</p>
            <p className="stat-label">dernier run</p>
          </div>
        </div>

        {/* Right: trigger button */}
        <button
          onClick={onRunNow}
          disabled={running || triggering}
          className="btn-ghost flex items-center gap-2 shrink-0"
        >
          {running ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 pulse-dot" />
              En cours…
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M2 1.5l8 4.5-8 4.5V1.5z" />
              </svg>
              Lancer
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="stat-value">{value.toLocaleString('fr-FR')}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}
