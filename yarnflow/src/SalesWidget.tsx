import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { factoryDay, salesRequest, type SalesOverview } from './sales-client';
import { RangeSelect, buckets, bucketIndex, useRange, type Bucket, type Range } from './RangeSelect';
import { useLanguage } from './i18n';
import { ErrorState, LoadingLines, RowCard, Section, Stat } from './ui';
import './sales-widget.css';

const VB_W = 700;
const VB_H = 240;
const PAD_X = 12;
const PAD_TOP = 38;
const PAD_BOTTOM = 40;
const BASELINE = VB_H - PAD_BOTTOM;
const PLOT_H = BASELINE - PAD_TOP;

type Point = Bucket & { total: number };
type Data = { invoices: (SalesOverview['invoices'][number] & { paid_minor: number; outstanding_minor: number; status: string })[]; settings: { currency: string } };
export type SalesState = { kind: 'loading' } | { kind: 'ready'; data: Data } | { kind: 'error' };

export const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);

function periodName(range: Range, t: (en: string, ur: string) => string) {
  const names: Record<Range, [string, string]> = {
    '14d': ['the last 14 days', 'گزشتہ 14 دن'], '30d': ['the last 30 days', 'گزشتہ 30 دن'],
    '6m': ['the last 6 months', 'گزشتہ 6 ماہ'], '1y': ['the last year', 'گزشتہ ایک سال'], all: ['all time', 'اب تک'],
  };
  return t(...names[range]);
}

function Chart({ days, currency }: { days: Point[]; currency: string }) {
  const { t } = useLanguage();
  const max = Math.max(1, ...days.map(day => day.total));
  const slot = (VB_W - PAD_X * 2) / days.length;
  const barWidth = Math.max(4, Math.min(24, slot * 0.58));
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));
  return <div className="sw-chart">
    <svg className="sw-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label={t('Sales by period, values shown on each bar', 'مدت کے لحاظ سے فروخت، ہر ستون پر رقم درج ہے')}>
      <line className="sw-base" x1={PAD_X} x2={VB_W - PAD_X} y1={BASELINE} y2={BASELINE} />
      {days.map((day, index) => {
        const x = PAD_X + slot * index + slot / 2;
        const barHeight = day.total ? Math.max(3, PLOT_H * day.total / max) : 0;
        const y = BASELINE - barHeight;
        return <g key={day.start}>
          {day.total > 0 && <>
            <rect className="sw-bar" x={x - barWidth / 2} y={y} width={barWidth} height={barHeight} rx="4" />
            <text className="sw-value" x={x} y={Math.max(18, y - 7)} textAnchor="middle">{money(day.total, currency)}</text>
          </>}
          {(index % labelEvery === 0 || index === days.length - 1) && <text className="sw-label" x={x} y={VB_H - 10} textAnchor="middle">{day.label}</text>}
        </g>;
      })}
    </svg>
  </div>;
}

function Latest({ invoices }: { invoices: Data['invoices'] }) {
  const { t } = useLanguage();
  const rows = [...invoices].sort((a, b) => b.issued_at - a.issued_at).slice(0, 3);
  if (!rows.length) return null;
  return <div className="sw-latest" aria-label={t('Latest invoices', 'تازہ انوائس')}>
    {rows.map(invoice => <RowCard key={invoice.id} title={invoice.number} detail={`${factoryDay(invoice.issued_at)} · ${invoice.order_reference ?? t('No order', 'کوئی آرڈر نہیں')}`} leading={<FileText aria-hidden="true" />} value={money(invoice.total_minor, invoice.currency)} onClick={() => { location.hash = '#/invoices/' + invoice.id; }} />)}
  </div>;
}

function Ready({ data }: { data: Data }) {
  const { t } = useLanguage();
  const [range, setRange] = useRange('yf-range-sales');
  const currency = data.settings.currency;
  const invoices = useMemo(() => data.invoices.filter(invoice => invoice.currency === currency && invoice.status !== 'void'), [data, currency]);
  const stats = useMemo(() => {
    const now = Date.now();
    const firstTime = invoices.reduce<number | undefined>((min, invoice) => (min === undefined || invoice.issued_at < min ? invoice.issued_at : min), undefined);
    const list = buckets(range, now, firstTime);
    const from = list[0].start, to = list[list.length - 1].end;
    const picked = range === 'all' ? invoices : invoices.filter(invoice => invoice.issued_at >= from && invoice.issued_at < to);
    const total = picked.reduce((sum, invoice) => sum + invoice.total_minor, 0);
    const days: Point[] = list.map(bucket => ({ ...bucket, total: 0 }));
    for (const invoice of picked) { const i = bucketIndex(list, invoice.issued_at); if (i >= 0) days[i].total += invoice.total_minor; }
    return { total, days };
  }, [invoices, range]);

  if (!invoices.length) return null;
  const period = periodName(range, t);
  return <Section title={t('Sales', 'فروخت')} className="sw">
    <div className="sw-head">
      <Stat label={t('Total sold', 'کل فروخت')} value={money(stats.total, currency)} unit={period} />
      <RangeSelect value={range} onChange={setRange} label={t('Sales period', 'فروخت کی مدت')} />
    </div>
    <p className="sw-caption">{t('Bars show sales for each date in {period}.', 'ہر ستون {period} کی فروخت دکھاتا ہے۔').replace('{period}', period)}</p>
    <Chart key={range} days={stats.days} currency={currency} />
    <Latest invoices={invoices} />
  </Section>;
}

/** The sales overview (every invoice with its paid and outstanding amounts), loaded once per mount and again when `retry` changes. */
export function useSalesData(retry = 0): SalesState {
  const [state, setState] = useState<SalesState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ kind: 'loading' });
    salesRequest<Data>('').then(data => { if (alive) setState({ kind: 'ready', data }); }, () => { if (alive) setState({ kind: 'error' }); });
    return () => { alive = false; };
  }, [retry]);
  return state;
}

export function SalesWidget() {
  const { t } = useLanguage();
  const [retry, setRetry] = useState(0);
  const state = useSalesData(retry);
  if (state.kind === 'loading') return <div className="sw"><LoadingLines lines={3} /></div>;
  if (state.kind === 'error') return <div className="sw"><ErrorState reason={t('Could not load sales.', 'فروخت لوڈ نہیں ہو سکی۔')} onRetry={() => setRetry(count => count + 1)} /></div>;
  return <Ready data={state.data} />;
}
