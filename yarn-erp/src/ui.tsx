import { useLayoutEffect, useRef, type ComponentType } from 'react';

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;

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
