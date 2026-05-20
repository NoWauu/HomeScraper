import { useState, useEffect, useCallback } from 'react';
import { StatusBar } from './components/StatusBar';
import { ConfigForm } from './components/ConfigForm';
import { Toast } from './components/Toast';
import { RunStatus, ToastState } from './types';
import { api } from './api';

export function App() {
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type, id: Date.now() });
  }, []);

  const fetchStatus = useCallback(() => {
    api.getStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function handleRunNow() {
    setTriggering(true);
    try {
      await api.triggerRun();
      showToast('Pipeline lancé', 'success');
      setTimeout(fetchStatus, 800);
    } catch (err) {
      showToast(`Erreur: ${err instanceof Error ? err.message : 'inconnue'}`, 'error');
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-300">
      <StatusBar status={status} onRunNow={handleRunNow} triggering={triggering} />
      <ConfigForm onToast={showToast} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <footer className="max-w-5xl mx-auto px-6 pb-8">
        <p className="text-xs font-mono text-slate-700 text-center">
          HomeScraper · Sources: Leboncoin, BienIci · Routing: OSRM + Navitia
        </p>
      </footer>
    </div>
  );
}
