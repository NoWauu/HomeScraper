import { useState, useEffect } from 'react';
import { AppConfig, FilterCriteria } from '../types';
import { api } from '../api';

interface Props {
  onToast: (message: string, type: 'success' | 'error') => void;
}

const DEFAULTS: AppConfig = {
  targetAddress: '10 Rue de Rivoli, 75001 Paris, France',
  cronSchedule: '*/30 * * * *',
  filters: {
    maxPrice: 1500,
    minSurfaceM2: 25,
    minRooms: 1,
    maxDistanceKm: 50,
    maxDriveMinutes: 30,
    maxWalkMinutes: 45,
    maxTransitMinutes: 45,
    furnished: 'any',
    excludeColocation: true,
  },
};

export function ConfigForm({ onToast }: Props) {
  const [config, setConfig] = useState<AppConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.getConfig()
      .then((c) => { setConfig(c); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  function setField(key: keyof Omit<AppConfig, 'filters'>, value: string) {
    setConfig((c) => ({ ...c, [key]: value }));
    setDirty(true);
  }

  function setFilter(key: keyof FilterCriteria, value: string) {
    const num = parseInt(value) || 0;
    setConfig((c) => ({ ...c, filters: { ...c.filters, [key]: num } }));
    setDirty(true);
  }

  function setFilterStr(key: keyof FilterCriteria, value: string) {
    setConfig((c) => ({ ...c, filters: { ...c.filters, [key]: value } }));
    setDirty(true);
  }

  function setFilterBool(key: keyof FilterCriteria, value: boolean) {
    setConfig((c) => ({ ...c, filters: { ...c.filters, [key]: value } }));
    setDirty(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.saveConfig(config);
      onToast('Configuration sauvegardée', 'success');
      setDirty(false);
    } catch (err) {
      onToast(`Erreur: ${err instanceof Error ? err.message : 'inconnue'}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-16 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 font-mono text-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-500 pulse-dot" />
          Chargement…
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="max-w-5xl mx-auto px-6 py-8 space-y-6 animate-slide-up">

      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-slate-500">
            Configuration
          </h2>
          <p className="text-slate-300 font-sans text-sm mt-1">
            Paramètres de recherche et filtres de trajet
          </p>
        </div>
        <button
          type="submit"
          disabled={saving || !dirty}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-slate-900 pulse-dot" />
              Sauvegarde…
            </>
          ) : (
            'Sauvegarder'
          )}
        </button>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-700/50" />

      {/* Target & Schedule */}
      <div className="card space-y-4">
        <SectionTitle icon="◎" label="Destination & Planification" />

        <Field label="Adresse cible">
          <input
            type="text"
            className="field-input"
            value={config.targetAddress}
            onChange={(e) => setField('targetAddress', e.target.value)}
            placeholder="10 Rue de Rivoli, 75001 Paris"
          />
          <p className="text-xs text-slate-500 font-mono mt-1">
            Géocodée automatiquement via Nominatim au démarrage
          </p>
        </Field>

        <Field label="Planification (cron)">
          <input
            type="text"
            className="field-input"
            value={config.cronSchedule}
            onChange={(e) => setField('cronSchedule', e.target.value)}
            placeholder="*/30 * * * *"
          />
          <p className="text-xs text-slate-500 font-mono mt-1">
            Syntaxe cron standard — ex: <code className="text-amber-400/70">*/30 * * * *</code> = toutes les 30 min
          </p>
        </Field>
      </div>

      {/* Property filters */}
      <div className="card space-y-4">
        <SectionTitle icon="⬡" label="Filtres Annonce" />

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Field label="Prix max (€/mois)">
            <NumberInput
              value={config.filters.maxPrice}
              onChange={(v) => setFilter('maxPrice', v)}
              placeholder="1500"
              suffix="€"
            />
          </Field>

          <Field label="Surface min (m²)">
            <NumberInput
              value={config.filters.minSurfaceM2}
              onChange={(v) => setFilter('minSurfaceM2', v)}
              placeholder="25"
              suffix="m²"
            />
          </Field>

          <Field label="Pièces min">
            <NumberInput
              value={config.filters.minRooms}
              onChange={(v) => setFilter('minRooms', v)}
              placeholder="1"
              suffix="pcs"
            />
          </Field>

          <Field label="Rayon max">
            <NumberInput
              value={config.filters.maxDistanceKm}
              onChange={(v) => setFilter('maxDistanceKm', v)}
              placeholder="50"
              suffix="km"
              icon="📍"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
          <Field label="🛋️ Meublé">
            <select
              className="field-input"
              value={config.filters.furnished}
              onChange={(e) => setFilterStr('furnished', e.target.value)}
            >
              <option value="any">Indifférent</option>
              <option value="furnished">Meublé uniquement</option>
              <option value="unfurnished">Non meublé uniquement</option>
            </select>
          </Field>

          <Field label="👥 Colocations">
            <select
              className="field-input"
              value={config.filters.excludeColocation ? 'exclude' : 'include'}
              onChange={(e) => setFilterBool('excludeColocation', e.target.value === 'exclude')}
            >
              <option value="exclude">Exclure les colocations</option>
              <option value="include">Inclure les colocations</option>
            </select>
          </Field>
        </div>
      </div>

      {/* Commute filters */}
      <div className="card space-y-4">
        <SectionTitle icon="→" label="Filtres Trajet" />
        <p className="text-xs text-slate-500 font-mono -mt-1">
          Durées max depuis l'annonce jusqu'à l'adresse cible. -1 = ignoré.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Temps voiture max">
            <NumberInput
              value={config.filters.maxDriveMinutes}
              onChange={(v) => setFilter('maxDriveMinutes', v)}
              placeholder="30"
              suffix="min"
              icon="🚗"
            />
          </Field>

          <Field label="Temps à pied max">
            <NumberInput
              value={config.filters.maxWalkMinutes}
              onChange={(v) => setFilter('maxWalkMinutes', v)}
              placeholder="45"
              suffix="min"
              icon="🚶"
            />
          </Field>

          <Field label="Temps transit max">
            <NumberInput
              value={config.filters.maxTransitMinutes}
              onChange={(v) => setFilter('maxTransitMinutes', v)}
              placeholder="45"
              suffix="min"
              icon="🚇"
            />
          </Field>
        </div>

        {/* Visual commute comparison bar */}
        <CommuteBar
          drive={config.filters.maxDriveMinutes}
          walk={config.filters.maxWalkMinutes}
          transit={config.filters.maxTransitMinutes}
        />
      </div>

      {/* Footer save */}
      <div className="flex justify-end pt-2">
        <button type="submit" disabled={saving || !dirty} className="btn-primary">
          {saving ? 'Sauvegarde…' : dirty ? 'Sauvegarder les modifications' : 'Aucune modification'}
        </button>
      </div>
    </form>
  );
}

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <span className="text-amber-400 font-mono text-sm">{icon}</span>
      <h3 className="font-mono text-xs uppercase tracking-widest text-slate-400">{label}</h3>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

interface NumberInputProps {
  value: number;
  onChange: (v: string) => void;
  placeholder: string;
  suffix: string;
  icon?: string;
}

function NumberInput({ value, onChange, placeholder, suffix, icon }: NumberInputProps) {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm select-none">
          {icon}
        </span>
      )}
      <input
        type="number"
        className={`field-input pr-10 ${icon ? 'pl-8' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={0}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-mono pointer-events-none">
        {suffix}
      </span>
    </div>
  );
}

function CommuteBar({ drive, walk, transit }: { drive: number; walk: number; transit: number }) {
  const max = Math.max(drive, walk, transit, 1);

  return (
    <div className="mt-2 space-y-2 border-t border-slate-700/40 pt-4">
      <p className="text-xs font-mono text-slate-600 uppercase tracking-wider mb-3">Visualisation</p>
      {[
        { label: '🚗 Voiture', value: drive, color: 'bg-amber-500' },
        { label: '🚶 Marche', value: walk, color: 'bg-slate-400' },
        { label: '🚇 Transit', value: transit, color: 'bg-slate-500' },
      ].map(({ label, value, color }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500 w-24 shrink-0">{label}</span>
          <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${color} rounded-full transition-all duration-500`}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
          <span className="text-xs font-mono text-slate-400 w-14 text-right shrink-0">
            {value} min
          </span>
        </div>
      ))}
    </div>
  );
}
