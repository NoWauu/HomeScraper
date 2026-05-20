import { useEffect, useState } from 'react';
import { ToastState } from '../types';

interface Props {
  toast: ToastState | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) { setVisible(false); return; }
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 200); }, 3500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const isSuccess = toast.type === 'success';

  return (
    <div
      className={`
        fixed bottom-6 right-6 z-50 flex items-center gap-3
        px-4 py-3 rounded border font-mono text-sm
        transition-all duration-200
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
        ${isSuccess
          ? 'bg-slate-800 border-amber-500/60 text-amber-400'
          : 'bg-slate-800 border-red-500/60 text-red-400'
        }
      `}
    >
      <span className="text-base">{isSuccess ? '✓' : '✗'}</span>
      <span>{toast.message}</span>
      <button
        onClick={() => { setVisible(false); setTimeout(onDismiss, 200); }}
        className="ml-2 text-slate-500 hover:text-slate-300 transition-colors"
      >
        ×
      </button>
    </div>
  );
}
