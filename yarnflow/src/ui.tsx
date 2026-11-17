import { Children, cloneElement, isValidElement, useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronRight, Circle, Info, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguage } from './i18n';
import { Field } from './forms';
import { EmptyIso } from './iso/EmptyIso';
import './ui.css';

/** Use to introduce a titled group. Example: `<Section title={t('Stock')}>…</Section>`. */
export function Section({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ui-section ${className}`}><div className="ui-section-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}

/** Use for a tappable list item. Example: `<RowCard title="Cotton" detail="12 kg" onClick={open} />`. */
export function RowCard({ title, detail, leading, status, value, onClick, action, className = '' }: { title: string; detail: string; leading?: ReactNode; status?: ReactNode; value?: ReactNode; onClick?: () => void; action?: ReactNode; className?: string }) {
  const content = <><span className="ui-row-leading">{leading}</span><span className="ui-row-copy"><strong>{title}</strong><span>{detail}</span></span>{status && <span className="ui-row-status">{status}</span>}{value != null && <span className="ui-row-value">{value}</span>}{onClick && <span className="ui-row-chevron" aria-hidden="true"><ChevronRight /></span>}</>;
  return <div className={`ui-row-wrap ${className}`}>{onClick ? <button type="button" className="ui-row" onClick={onClick}>{content}</button> : <div className="ui-row">{content}</div>}{action && <span className="ui-row-action">{action}</span>}</div>;
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
const statusIcons: Record<StatusTone, LucideIcon> = { ok: CheckCircle2, warn: AlertCircle, bad: AlertCircle, info: Info, neutral: Circle };
/** Use for a worded status. Example: `<StatusTag tone="ok" label={t('Saved','محفوظ')} />`. */
export function StatusTag({ tone, label, icon: Icon }: { tone: StatusTone; label: string; icon?: LucideIcon }) {
  const Mark = Icon || statusIcons[tone];
  return <span className={`ui-status ui-status-${tone}`}><Mark size={18} aria-hidden="true" />{label}</span>;
}

/** Use for one prominent value. Example: `<Stat label={t('Orders')} value="12" unit={t('open')} />`. */
export function Stat({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return <div className="ui-stat"><span className="ui-stat-label">{label}</span><strong>{value}</strong>{unit && <span className="ui-stat-unit">{unit}</span>}</div>;
}

/** Use for a compact group of two to four values. Example: `<StatRow><Stat … /><Stat … /></StatRow>`. */
export function StatRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`ui-stat-row ${className}`}>{children}</div>;
}

export type Action = { label: string; onClick: () => void; icon?: ReactNode; disabled?: boolean; type?: 'button' | 'submit' };
/** Use for the screen's main action. Example: `<ActionBar primary={{label:t('Save'),onClick:save}} />`. */
export function ActionBar({ primary, secondary, className = '' }: { primary: Action; secondary?: Action; className?: string }) {
  const button = (action: Action, variant: string) => <button type={action.type || 'button'} className={`ui-action ${variant}`} onClick={action.onClick} disabled={action.disabled}>{action.icon}{action.label}</button>;
  return <div className={`ui-action-bar ${className}`}>{secondary && button(secondary, 'ui-action-secondary')}{button(primary, 'ui-action-primary')}</div>;
}

/** Use for a prominent destination in a two to four column job grid. */
export function JobTile({ icon, label, count, hint, onClick, className = '' }: { icon: ReactNode; label: string; count?: ReactNode; hint?: string; onClick: () => void; className?: string }) {
  return <button type="button" className={`ui-job-tile ${className}`} onClick={onClick}><span className="ui-job-tile-icon" aria-hidden="true">{icon}</span><span className="ui-job-tile-label">{label}</span>{count != null && <span className="ui-job-tile-count">{count}</span>}{hint && <span className="ui-job-tile-hint">{hint}</span>}</button>;
}

/** Use for the screen's focal message, with an optional stat and action. */
export function Banner({ tone = 'tint', title, text, stat, action, className = '' }: { tone?: 'brand' | 'tint'; title: string; text?: string; stat?: ReactNode; action?: Action; className?: string }) {
  return <section className={`ui-banner ui-banner-${tone} ${className}`}><div className="ui-banner-copy"><h2>{title}</h2>{text && <p>{text}</p>}</div>{stat != null && <div className="ui-banner-stat">{stat}</div>}{action && <button type={action.type || 'button'} className="ui-action ui-banner-action" onClick={action.onClick} disabled={action.disabled}>{action.icon}{action.label}</button>}</section>;
}

export type StepState = 'done' | 'current' | 'later';
/** Use as a stage in `Steps`. Example: `<Step title={t('Review')} state="current">…</Step>`. */
export function Step({ title, state, number, children }: { title: string; state: StepState; number?: number; children?: ReactNode }) {
  return <li className={`ui-step ui-step-${state}`} aria-current={state === 'current' ? 'step' : undefined}><span className="ui-step-marker">{state === 'done' ? <Check aria-hidden="true" /> : number}</span><div className="ui-step-body"><h3>{title}</h3>{state === 'current' && children && <div className="ui-step-content">{children}</div>}</div></li>;
}

/** Use for a numbered workflow. Example: `<Steps><Step title="…" state="current">…</Step></Steps>`. */
export function Steps({ children, label, className = '' }: { children: ReactNode; label?: string; className?: string }) {
  const { t } = useLanguage();
  return <ol className={`ui-steps ${className}`} aria-label={label || t('Steps', 'مراحل')}>{Children.map(children, (child, index) => isValidElement<{ number?: number }>(child) ? cloneElement(child, { number: index + 1 }) : child)}</ol>;
}

export type Choice = { value: string; title: string; icon: ReactNode; hint?: string };
/** Use for a large radio choice. Example: `<ChoiceTiles label={t('Type')} value={v} onChange={setV} options={choices} />`. */
export function ChoiceTiles({ label, value, onChange, options, name }: { label: string; value: string; onChange: (value: string) => void; options: Choice[]; name?: string }) {
  const id = useId();
  return <fieldset className="ui-choice-group"><legend>{label}</legend><div className="ui-choice-tiles">{options.map((option, index) => {
    const inputId = `${id}-${index}`;
    return <label className={`ui-choice ${value === option.value ? 'is-selected' : ''}`} htmlFor={inputId} key={option.value}><input id={inputId} type="radio" name={name || id} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span className="ui-choice-icon">{option.icon}</span><span className="ui-choice-copy"><strong>{option.title}</strong>{option.hint && <span>{option.hint}</span>}</span></label>;
  })}</div></fieldset>;
}

/** Use when a list has no items. Example: `<EmptyState message={t('No batches yet.')} action={…} />`. */
export function EmptyState({ message, icon: Icon, emptyIso, action, className = '' }: { message: string; icon?: LucideIcon; emptyIso?: 'stock' | 'orders' | 'shipments' | 'inbox' | 'people'; action?: ReactNode; className?: string }) {
  return <div className={`ui-empty ${className}`}>{emptyIso ? <EmptyIso kind={emptyIso} /> : Icon ? <Icon className="ui-empty-icon" aria-hidden="true" /> : null}<p>{message}</p>{action && <div>{action}</div>}</div>;
}

/** Use while content loads. Example: `<LoadingLines lines={3} />`. */
export function LoadingLines({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  const count = Math.min(8, Math.max(1, Math.floor(lines)));
  return <div className={`ui-loading ${className}`} aria-busy="true" aria-label="Loading"><span className="ui-sr-only">Loading</span>{Array.from({ length: count }, (_, i) => <span key={i} className="ui-loading-line" style={{ '--ui-line-index': i } as React.CSSProperties} />)}</div>;
}

/** Use to show a recoverable error. Example: `<ErrorState reason={t('Could not load stock.')} onRetry={load} />`. */
export function ErrorState({ reason, onRetry, className = '' }: { reason: string; onRetry: () => void; className?: string }) {
  const { t } = useLanguage();
  return <div className={`ui-error ${className}`} role="alert"><p><AlertCircle aria-hidden="true" />{reason}</p><button className="ui-action ui-action-secondary" type="button" onClick={onRetry}>{t('Try again', 'دوبارہ کوشش کریں')}</button></div>;
}

/** Use for model confidence. Example: `<Confidence value={0.91} />`. */
export function Confidence({ value, className = '' }: { value: number; className?: string }) {
  const { t } = useLanguage();
  const safe = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const percent = Math.round(safe * 100);
  const tone = percent >= 85 ? 'ok' : percent >= 60 ? 'warn' : 'bad';
  const label = tone === 'ok' ? t('Very sure', 'بہت یقین') : tone === 'warn' ? t('Fairly sure', 'کافی یقین') : t('Not sure', 'یقین نہیں');
  return <div className={`ui-confidence ui-confidence-${tone} ${className}`}><div className="ui-confidence-line"><strong>{label}</strong><span>{percent}%</span></div><div className="ui-confidence-track" role="meter" aria-label={t('Confidence', 'اعتماد')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div></div>;
}

/** Use for focused modal content. Example: `<Sheet open={open} title={t('Details')} onClose={close}>…</Sheet>`. */
export function Sheet({ open, title, onClose, children, className = '' }: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={`ui-sheet ${className}`} aria-labelledby={titleId} onClose={() => { if (open) onClose(); }} onClick={event => { if (event.target === ref.current) onClose(); }}><div className="ui-sheet-panel"><header><h2 id={titleId}>{title}</h2><button type="button" className="ui-close" aria-label={t('Close', 'بند کریں')} onClick={onClose}><X aria-hidden="true" /></button></header><div className="ui-sheet-content">{children}</div></div></dialog>;
}

export type TabItem = { id: string; label: string; count?: number };
/** Use for switching between sibling views. Example: `<Tabs items={tabs} value={tab} onChange={setTab} />`. */
export function Tabs({ items, value, onChange, label, className = '' }: { items: TabItem[]; value: string; onChange: (value: string) => void; label: string; className?: string }) {
  const { t } = useLanguage();
  return <div className={`ui-tabs ${className}`} role="tablist" aria-label={label}>{items.map((item, index) => <button key={item.id} type="button" role="tab" id={`ui-tab-${item.id}`} aria-controls={`ui-panel-${item.id}`} aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault(); const direction = event.key === 'ArrowRight' ? 1 : -1; const next = (index + direction + items.length) % items.length; onChange(items[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }}>{item.label}{item.count != null && <span className="ui-tab-count" aria-label={t(`${item.count} items`, `${item.count} اشیا`)}>{item.count}</span>}</button>)}</div>;
}

/** Use for a short label and value list. Example: `<KeyFacts items={[{label:t('Lot'),value:'A12'}]} />`. */
export function KeyFacts({ items, className = '' }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return <dl className={`ui-key-facts ${className}`}>{items.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

/** Use for a decimal amount with its unit in the field. Example: `<NumberWithUnit label={t('Weight')} value={v} unit="kg" onChange={setV} />`. */
export function NumberWithUnit({ label, value, unit, onChange, name, required = false, min, max, step = 'any' }: { label: string; value: string; unit: string; onChange: (value: string) => void; name?: string; required?: boolean; min?: number; max?: number; step?: number | 'any' }) {
  return <div className="ui-number-with-unit"><Field>{label}<input name={name} type="number" inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} required={required} min={min} max={max} step={step} /></Field><span aria-hidden="true">{unit}</span></div>;
}
