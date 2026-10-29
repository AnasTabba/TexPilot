import { useEffect, useId, useLayoutEffect, useRef, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';

type Icon = ComponentType<{ size?: number | string; 'aria-hidden'?: boolean | 'true' }>;

/** Measure the pressed item so the CSS pill (reads --glide-*) sits under it, and follow it on every change. */
export function useGlide<T extends HTMLElement>(selector: string, key: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const host = ref.current; if (!host) return;
    const place = () => {
      const item = host.querySelector<HTMLElement>(selector);
      host.style.setProperty('--glide-w', (item?.offsetWidth || 0) + 'px'); host.style.setProperty('--glide-h', (item?.offsetHeight || 0) + 'px');
      if (item) { host.style.setProperty('--glide-x', item.offsetLeft + 'px'); host.style.setProperty('--glide-y', item.offsetTop + 'px'); }
      // Turn the glide on only after the first placement, so the pill never slides in from the corner.
      requestAnimationFrame(() => { host.dataset.glide = 'on'; });
    };
    place();
    // Re-measure when the control changes size: the window, the language, the web font arriving.
    const watch = new ResizeObserver(place); watch.observe(host); host.querySelectorAll('button').forEach(b => watch.observe(b));
    return () => watch.disconnect();
  }, [selector, key]);
  return ref;
}

/** A row of tabs with one pressed; the ink pill slides to it. */
export function Segments<V extends string>({ label, value, onChange, options, className = '' }: {
  label: string; value: V; onChange: (value: V) => void; options: { id: V; label: string; icon?: Icon; hidden?: boolean }[]; className?: string;
}) {
  const shown = options.filter(o => !o.hidden);
  const ref = useGlide<HTMLDivElement>('button[aria-pressed="true"]', `${value}:${shown.map(o => o.id + o.label).join()}`);
  return <div ref={ref} className={`live-segments ${className}`} role="group" aria-label={label}>
    {shown.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{Icon && <Icon size={22} aria-hidden="true" />}<span>{label}</span></button>)}
  </div>;
}

export type { Icon };

/** Big tappable cards instead of a dropdown: every choice is visible, with an optional line under it. */
export function ChoiceCards<V extends string>({ label, value, onChange, options, error, columns = 2 }: {
  label: string; value: V | ''; onChange: (value: V) => void; error?: string; columns?: 1 | 2 | 3;
  options: { id: V; label: string; detail?: ReactNode; icon?: Icon; disabled?: boolean; tone?: 'good' | 'warn' | 'bad' }[];
}) {
  const id = useId();
  return <fieldset className={`yf-choices cols-${columns}`} aria-describedby={error ? id : undefined} aria-invalid={!!error}>
    <legend>{label}</legend>
    <div>{options.map(({ id: option, label, detail, icon: Icon, disabled, tone }) => <button type="button" key={option} className={`yf-choice${tone ? ' is-' + tone : ''}`} aria-pressed={value === option} disabled={disabled} onClick={() => onChange(option)}>
      {Icon && <Icon size={26} aria-hidden="true" />}<span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      <i className="yf-choice-tick" aria-hidden="true"><Check size={18} /></i>
    </button>)}</div>
    {error && <p id={id} className="live-field-error"><TriangleAlert size={18} aria-hidden="true" />{error}</p>}
  </fieldset>;
}

/** The big icon + word buttons on Home: one per daily task. */
export function Tiles({ label, items }: { label: string; items: { id: string; label: string; hint?: string; icon: Icon; onClick: () => void; tone?: string }[] }) {
  // One row when the screen is wide enough, otherwise two equal rows (the CSS reads these counts).
  return <nav className="yf-tiles" aria-label={label} style={{ '--tiles': items.length, '--half': items.length <= 4 ? items.length : Math.ceil(items.length / 2) } as CSSProperties}>{items.map(({ id, label, hint, icon: Icon, onClick, tone }) => <button type="button" key={id} className={`yf-tile${tone ? ' is-' + tone : ''}`} onClick={onClick}>
    <span className="yf-tile-icon"><Icon size={30} aria-hidden="true" /></span><strong>{label}</strong>{hint && <small>{hint}</small>}
  </button>)}</nav>;
}

/** Buttons that fill a reason in one tap; the text box stays for anything else. */
export function QuickReasons({ label, reasons, value, onPick }: { label: string; reasons: string[]; value: string; onPick: (reason: string) => void }) {
  return <div className="yf-reasons" role="group" aria-label={label}>{reasons.map(reason => <button type="button" key={reason} aria-pressed={value === reason} onClick={() => onPick(reason)}>{reason}</button>)}</div>;
}

/** What is about to be written in the register, as one sentence, with the numbers large. */
export function EntrySentence({ sentence, numbers, warnings = [] }: { sentence: string; numbers: [string, string][]; warnings?: string[] }) {
  return <div className="yf-sentence">
    <dl className="yf-big-numbers">{numbers.map(([unit, value]) => <div key={unit}><dd dir="ltr">{value}</dd><dt>{unit}</dt></div>)}</dl>
    <p>{sentence}</p>
    {warnings.map(w => <p key={w} className="live-warning" role="status"><TriangleAlert size={20} aria-hidden="true" />{w}</p>)}
  </div>;
}

/** After a save: a clear tick, the sentence that was saved, and what to do next. */
export function SavedCard({ title, sentence, hint, actions, onDismiss, dismissLabel }: { title: string; sentence: string; hint: string; actions: { label: string; icon?: Icon; onClick: () => void; primary?: boolean }[]; onDismiss: () => void; dismissLabel: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <section ref={ref} tabIndex={-1} className="yf-saved" role="status" aria-live="polite">
    <span className="yf-saved-tick" aria-hidden="true"><Check size={34} strokeWidth={3} /></span>
    <div><h2>{title}</h2><p className="yf-saved-sentence">{sentence}</p><p>{hint}</p>
      <div className="live-actions">{actions.map(({ label, icon: Icon, onClick, primary }) => <button type="button" key={label} className={`button${primary ? ' primary' : ''}`} onClick={onClick}>{Icon && <Icon size={20} aria-hidden="true" />}{label}</button>)}</div></div>
    <button type="button" className="live-icon-button" onClick={onDismiss} aria-label={dismissLabel}><X size={20} aria-hidden="true" /></button>
  </section>;
}
