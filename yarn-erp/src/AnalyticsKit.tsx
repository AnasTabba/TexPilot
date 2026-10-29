import type { ReactNode } from 'react';
import { useLanguage } from './i18n';
import './analytics.css';

export type Kpi = { label: string; value: string | null };
export type BarRow = { key: string; label: string; sub?: string; value: number; text: string; group?: string };
export type Tone = 'ok' | 'warn' | 'bad' | 'kraft' | 'ink' | 'stone';
export type Segment = { key: string; label: ReactNode; value: number; text: string; tone: Tone };

/** Money never converts between currencies, so headline figures read one currency: the first one alphabetically. */
export function firstCurrency(...lists: (readonly { currency?: string | null }[] | undefined)[]): string | undefined {
  return lists.flatMap(list => list ?? []).map(row => row.currency).filter((code): code is string => !!code).sort()[0];
}

function EmptyLine({ text }: { text?: string }) {
  const { t } = useLanguage();
  return <p className="ak-empty">{text ?? t('No data for this period.', 'اس مدت کا کوئی ڈیٹا نہیں۔')}</p>;
}

export function AnalyticsSection({ title, note, className, children }: { title: string; note?: string; className?: string; children: ReactNode }) {
  return <section className={className ? `ak-section ${className}` : 'ak-section'}>
    <h2>{title}</h2>
    {note && <p className="ak-note">{note}</p>}
    {children}
  </section>;
}

/** Headline figures on one sheet line, separated by hairlines rather than boxed cards. */
export function KpiStrip({ items }: { items: Kpi[] }) {
  if (!items.length) return <EmptyLine />;
  return <dl className="ak-kpis">{items.map(item => <div className="ak-kpi" key={item.label}><dt>{item.label}</dt><dd>{item.value ?? '—'}</dd></div>)}</dl>;
}

/** Ranked rows. Bars scale within a group (one currency), so amounts in different currencies never share a scale. */
export function BarList({ rows, empty }: { rows: BarRow[]; empty?: string }) {
  if (!rows.length) return <EmptyLine text={empty} />;
  const groups = [...new Set(rows.map(row => row.group ?? ''))];
  const max = new Map<string, number>();
  for (const row of rows) max.set(row.group ?? '', Math.max(max.get(row.group ?? '') ?? 0, row.value));
  return <div className="ak-bars">{groups.map(group => <div className="ak-group" key={group || 'all'}>
    {group && <h3 className="ak-group-title">{group}</h3>}
    <ol className="ak-bar-list">{rows.filter(row => (row.group ?? '') === group).map(row => {
      const top = max.get(group) ?? 0;
      const ratio = top > 0 ? Math.max(0, row.value) / top : 0;
      return <li className="ak-bar-row" key={row.key}>
        <div className="ak-bar-label"><span>{row.label}</span>{row.sub && <small>{row.sub}</small>}</div>
        <span className="ak-bar-value">{row.text}</span>
        <span className="ak-bar-track" aria-hidden="true"><span className="ak-bar-fill" style={{ width: `${ratio * 100}%` }} /></span>
      </li>;
    })}</ol>
  </div>)}</div>;
}

/** One segmented bar for a set of counts or weights, with a legend beneath that carries the real figures. */
export function StackedBar({ segments, empty }: { segments: Segment[]; empty?: string }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (!total) return <EmptyLine text={empty} />;
  return <div className="ak-stack">
    <div className="ak-stack-bar" aria-hidden="true">{segments.filter(segment => segment.value > 0).map(segment => <span key={segment.key} className={`ak-seg is-${segment.tone}`} style={{ flexGrow: segment.value }} />)}</div>
    <dl className="ak-legend">{segments.map(segment => <div key={segment.key}>
      <dt><span className={`ak-swatch is-${segment.tone}`} aria-hidden="true" />{segment.label}</dt>
      <dd>{segment.text}</dd>
    </div>)}</dl>
  </div>;
}
