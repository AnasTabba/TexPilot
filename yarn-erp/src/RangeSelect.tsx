import { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from './i18n';
import { RANGES, type Range } from './range-buckets';
import './range-select.css';

export { RANGES, buckets, bucketIndex, type Range, type Bucket } from './range-buckets';

const isRange = (value: string | null): value is Range => RANGES.some(r => r.value === value);

/** Time range state persisted in localStorage. Storage errors only mean the choice is not remembered. */
export function useRange(storageKey: string, fallback: Range = '14d') {
  const [range, setRange] = useState<Range>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return isRange(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback((next: Range) => {
    setRange(next);
    try { localStorage.setItem(storageKey, next); } catch { /* The choice still applies for this visit. */ }
  }, [storageKey]);
  return [range, update] as const;
}

export function RangeSelect({ value, onChange, label }: { value: Range; onChange: (range: Range) => void; label: string }) {
  const { t } = useLanguage();
  return (
    <span className="rs">
      <select className="rs-select" aria-label={label} value={value} onChange={e => onChange(e.target.value as Range)}>
        {RANGES.map(r => <option key={r.value} value={r.value}>{t(r.en, r.ur)}</option>)}
      </select>
      <ChevronDown className="rs-chev" size={12} aria-hidden />
    </span>
  );
}
