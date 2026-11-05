import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';
import { useLanguage } from './i18n';

/** `text` is what typing matches; the job group is shown beside a page but is not searched, so "stock" finds the Stock page, not every page in it. */
export interface PaletteItem { id: string; label: string; detail: string; text: string; icon: LucideIcon; run: () => void }

/** Cmd/Ctrl+K palette: pages the role can open, plus recent batches. Opens with no animation (keyboard actions must feel instant). */
export default function CommandPalette({ items, open, onOpenChange }: { items: PaletteItem[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => items.filter(item => !needle || item.text.toLowerCase().includes(needle)), [items, needle]);
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); onOpenChange(!open); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [open, onOpenChange]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) { setQuery(''); setActive(0); element.showModal(); input.current?.focus(); }
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => { document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: 'nearest' }); }, [current, listId]);

  const pick = (item: PaletteItem) => { onOpenChange(false); item.run(); };
  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (shown.length) setActive((current + 1) % shown.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (shown.length) setActive((current - 1 + shown.length) % shown.length); }
    else if (event.key === 'Enter') { event.preventDefault(); if (shown[current]) pick(shown[current]); }
  };

  return <dialog ref={dialog} className="yf-palette" aria-label={t('Search pages and batches')} onClose={() => onOpenChange(false)} onClick={event => { if (event.target === event.currentTarget) onOpenChange(false); }}>
    <div className="yf-palette-field"><Search size={20} aria-hidden="true" />
      <input ref={input} type="text" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={shown.length ? `${listId}-${current}` : undefined} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKey} placeholder={t('Go to a page or batch…')} aria-label={t('Search pages and batches')} autoComplete="off" />
    </div>
    <ul id={listId} role="listbox" className="yf-palette-list" aria-label={t('Results')}>
      {shown.map((item, index) => { const Icon = item.icon; return <li key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === current} onMouseEnter={() => setActive(index)} onClick={() => pick(item)}>
        <Icon size={20} aria-hidden="true" /><span className="yf-palette-label">{item.label}</span><span className="yf-palette-detail">{item.detail}</span>
      </li>; })}
      {!shown.length && <li role="status" className="yf-palette-empty">{t('No page or batch matches.')}</li>}
    </ul>
    <p className="yf-palette-hint" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> {t('move')}</span><span><kbd>Enter</kbd> {t('open')}</span><span><kbd>Esc</kbd> {t('close')}</span></p>
  </dialog>;
}
