import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { useLanguage } from './i18n';
import { StageIcon, stageState, type StageIconName } from './iso/StageIcons';
import './sales-ui.css';

export type SplitTab = { id: string; label: string; count?: number };
export type SplitItem = { id: string; title: string; meta: string; status?: ReactNode; text?: string };

/** Filterable list on the left, the selected record on the right. Phones show the record as a sheet with a back button. */
export function SplitView({ label, tabs, tab, onTab, items, selectedId, onSelect, renderDetail, empty, emptyDetail }: {
  label: string; tabs?: SplitTab[]; tab?: string; onTab?: (id: string) => void;
  items: SplitItem[]; selectedId: string; onSelect: (id: string) => void;
  renderDetail: (id: string) => ReactNode; empty: string; emptyDetail: string;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const detailRef = useRef<HTMLElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = needle ? items.filter(item => `${item.title} ${item.meta} ${item.text ?? ''}`.toLowerCase().includes(needle)) : items;
  // Desktop always shows a record (the first one by default); a phone only opens the sheet on an explicit choice.
  const active = selectedId || shown[0]?.id || '';
  // Moving focus into the sheet keeps keyboard and screen reader users inside it on phones.
  useEffect(() => {
    if (selectedId && window.matchMedia('(max-width: 860px)').matches) detailRef.current?.focus({ preventScroll: true });
  }, [selectedId]);

  return <div className={`yf-split${selectedId ? ' has-detail' : ''}`}>
    <div className="split-list-pane">
      {tabs && tabs.length > 0 && <div className="split-tabs" role="group" aria-label={label}>
        {tabs.map(item => <button key={item.id} type="button" aria-pressed={item.id === tab} onClick={() => onTab?.(item.id)}>
          {item.label}{item.count !== undefined && <span className="split-count">{item.count}</span>}
        </button>)}
      </div>}
      <div className="split-search">
        <Search size={18} aria-hidden="true" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Search this list', 'اس فہرست میں تلاش کریں')} placeholder={t('Search', 'تلاش')} />
      </div>
      {shown.length ? <ol className="split-list" aria-label={label}>{shown.map(item => <li key={item.id}>
        <button type="button" className="split-row" aria-current={item.id === active ? 'true' : undefined} onClick={() => onSelect(item.id)}>
          <span className="split-row-text"><strong>{item.title}</strong><small>{item.meta}</small></span>
          {item.status}
        </button>
      </li>)}</ol>
        : <p className="split-none">{needle ? t('Nothing matches this search.', 'اس تلاش سے کچھ نہیں ملا۔') : empty}</p>}
    </div>
    <section className="split-detail" ref={detailRef} tabIndex={-1} aria-label={t('Selected record', 'منتخب ریکارڈ')}>
      <button type="button" className="button split-back" onClick={() => onSelect('')}><ArrowLeft size={18} aria-hidden="true" />{t('Back to list', 'فہرست پر واپس')}</button>
      {active ? renderDetail(active) : <p className="split-none">{emptyDetail}</p>}
    </section>
  </div>;
}

/** Step flow for a request: numbered by stage with the stage icon, the current step marked by text as well as shape. */
export function StepFlow({ label, steps, current }: { label: string; steps: { icon: StageIconName; label: string; note?: string }[]; current: number }) {
  const { t } = useLanguage();
  return <div className="yf-dispatch-thread" aria-label={label}>
    <ol>{steps.map((step, i) => {
      const state = stageState(i, current);
      return <li key={step.label} className={i <= current ? 'done' : ''} aria-current={state === 'current' ? 'step' : undefined}>
        <StageIcon name={step.icon} state={state} />
        <strong>{step.label}</strong>
        <small>{step.note ?? (state === 'done' ? t('Done', 'مکمل') : state === 'current' ? t('Now', 'اب') : t('Waiting', 'منتظر'))}</small>
      </li>;
    })}</ol>
  </div>;
}
