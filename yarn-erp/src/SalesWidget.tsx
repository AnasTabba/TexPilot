import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { factoryDay, salesRequest, type SalesOverview } from './sales-client';
import './sales-widget.css';

const DAY = 86_400_000;
const DAYS = 14;
const VB_W = 1000;
const VB_H = 200;
const PAD_X = 14;
const PAD_TOP = 18;
const PAD_BOTTOM = 14;
const BASELINE = VB_H - PAD_BOTTOM;
const PLOT_H = VB_H - PAD_TOP - PAD_BOTTOM;

type Day = { key: string; time: number; total: number };
// The sales API returns invoices with their balances (invoice_balances + balanceData), not separate receivables.
type Data = { invoices: (SalesOverview['invoices'][number] & { paid_minor: number; outstanding_minor: number; status: string })[] };

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);

/** Civil date in the factory zone, used as the day-bucket key. */
const dayKey = (time: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Counts from 0 to target over ~700ms with requestAnimationFrame; jumps straight there for reduced motion. */
function useCountUp(target: number) {
  const [value, setValue] = useState(() => (reduceMotion() ? target : 0));
  useEffect(() => {
    if (reduceMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function Kpi({ label, target, currency, tone, alert = false }: {
  label: string; target: number; currency: string; tone: 'teal' | 'indigo' | 'coral'; alert?: boolean;
}) {
  const value = useCountUp(target);
  return (
    <div className={`sw-kpi sw-kpi--${tone}${alert ? ' is-alert' : ''}`}>
      <span className="sw-kpi-label">{label}</span>
      <strong className="sw-kpi-value">{money(value, currency)}</strong>
    </div>
  );
}

function Chart({ days, currency }: { days: Day[]; currency: string }) {
  const uid = useId().replace(/:/g, '');
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map(d => d.total));
  const xs = days.map((_, i) => PAD_X + (i * (VB_W - 2 * PAD_X)) / (days.length - 1));
  const ys = days.map(d => PAD_TOP + PLOT_H * (1 - d.total / max));
  const points = days.map((_, i) => [xs[i], ys[i]] as const);

  // Smooth cubic segments with horizontal tangents at the midpoints, so the curve never overshoots a day.
  const linePath = points
    .map(([x, y], i) => {
      if (i === 0) return `M${x},${y}`;
      const [px, py] = points[i - 1];
      const mx = (px + x) / 2;
      return `C${mx},${py} ${mx},${y} ${x},${y}`;
    })
    .join(' ');
  const areaPath = `${linePath} L${xs[xs.length - 1]},${BASELINE} L${xs[0]},${BASELINE} Z`;

  const current = active === null ? null : days[active];
  const leftPct = active === null ? 0 : (xs[active] / VB_W) * 100;
  const topPct = active === null ? 0 : (ys[active] / VB_H) * 100;
  const shift = leftPct > 80 ? '-100%' : leftPct < 20 ? '0' : '-50%';

  return (
    <div className="sw-chart">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="sw-svg" role="group" aria-label={`Invoiced per day, last ${DAYS} days`}>
        <defs>
          <linearGradient id={`${uid}-line`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#0f8b8d" />
            <stop offset="1" stopColor="#4f5bd5" />
          </linearGradient>
          <linearGradient id={`${uid}-area`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#0f8b8d" stopOpacity="0.28" />
            <stop offset="1" stopColor="#4f5bd5" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="sw-base" x1={PAD_X} x2={VB_W - PAD_X} y1={BASELINE} y2={BASELINE} />
        <path className="sw-area" d={areaPath} fill={`url(#${uid}-area)`} />
        <path className="sw-line" d={linePath} pathLength={1} fill="none" stroke={`url(#${uid}-line)`} />
        {active !== null && (
          <line className="sw-guide" x1={xs[active]} x2={xs[active]} y1={PAD_TOP} y2={BASELINE} />
        )}
        {days.map((day, i) => (
          <g
            key={day.key}
            role="img"
            tabIndex={0}
            aria-label={`${factoryDay(day.time)}: ${money(day.total, currency)}`}
            className={`sw-point${active === i ? ' is-active' : ''}`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <circle className="sw-hit" cx={xs[i]} cy={ys[i]} r={14} />
            <circle className="sw-dot" cx={xs[i]} cy={ys[i]} r={active === i ? 6 : 4} />
          </g>
        ))}
      </svg>
      {current && (
        <div className="sw-tip" style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: `translate(${shift}, calc(-100% - 12px))` }}>
          <span>{factoryDay(current.time)}</span>
          <strong>{money(current.total, currency)}</strong>
        </div>
      )}
      <div className="sw-axis">
        <span>{factoryDay(days[0].time)}</span>
        <span>{factoryDay(days[days.length - 1].time)}</span>
      </div>
    </div>
  );
}

function Latest({ data }: { data: Data }) {
  const open = () => {
    location.hash = '#/sales';
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  const rows = [...data.invoices].sort((a, b) => b.issued_at - a.issued_at).slice(0, 5);
  return (
    <div className="sw-table-wrap">
      <table className="sw-table">
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Order</th>
            <th scope="col" className="sw-col-date">Date</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(invoice => (
            <tr key={invoice.id} tabIndex={0} onClick={open} onKeyDown={onKey}>
              <td>{invoice.number}</td>
              <td>{invoice.order_reference ?? '—'}</td>
              <td className="sw-col-date">{factoryDay(invoice.issued_at)}</td>
              <td>{money(invoice.total_minor, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ready({ data }: { data: Data }) {
  const now = Date.now(), currency = data.invoices[0]?.currency ?? 'PKR';
  const stats = useMemo(() => {
    const invoiced = data.invoices.reduce((sum, invoice) => sum + invoice.total_minor, 0);
    const collected = data.invoices.reduce((sum, invoice) => sum + invoice.paid_minor, 0);
    const outstanding = data.invoices.reduce((sum, invoice) => sum + invoice.outstanding_minor, 0);
    const overdue = data.invoices.some(invoice => invoice.status === 'overdue');

    const totals = new Map<string, number>();
    for (const invoice of data.invoices) {
      const key = dayKey(invoice.issued_at);
      totals.set(key, (totals.get(key) ?? 0) + invoice.total_minor);
    }
    const days: Day[] = Array.from({ length: DAYS }, (_, i) => {
      const time = now - (DAYS - 1 - i) * DAY;
      const key = dayKey(time);
      return { key, time, total: totals.get(key) ?? 0 };
    });
    return { invoiced, collected, outstanding, overdue, days };
  }, [data]);

  return (
    <section className="sw" aria-label="Total sales">
      <div className="sw-head">
        <h2>Total sales</h2>
        <span className="sw-pill">{DAYS} days</span>
      </div>
      <div className="sw-kpis">
        <Kpi label="Invoiced" target={stats.invoiced} currency={currency} tone="indigo" />
        <Kpi label="Collected" target={stats.collected} currency={currency} tone="teal" />
        <Kpi label="Outstanding" target={stats.outstanding} currency={currency} tone="coral" alert={stats.overdue} />
      </div>
      <Chart days={stats.days} currency={currency} />
      <Latest data={data} />
    </section>
  );
}

function Skeleton() {
  return (
    <section className="sw sw--loading" aria-busy="true" aria-label="Total sales loading">
      <div className="sw-head">
        <div className="sw-skel" style={{ width: 110, height: 20 }} />
      </div>
      <div className="sw-kpis">
        <div className="sw-skel sw-skel--kpi" />
        <div className="sw-skel sw-skel--kpi" />
        <div className="sw-skel sw-skel--kpi" />
      </div>
      <div className="sw-skel sw-skel--chart" />
      <div className="sw-skel sw-skel--row" />
      <div className="sw-skel sw-skel--row" />
      <div className="sw-skel sw-skel--row" />
    </section>
  );
}

export function SalesWidget() {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ready'; data: Data } | { kind: 'error' }>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    salesRequest<Data>('').then(
      data => { if (alive) setState({ kind: 'ready', data }); },
      () => { if (alive) setState({ kind: 'error' }); },
    );
    return () => { alive = false; };
  }, []);

  if (state.kind === 'error') return null;
  if (state.kind === 'loading') return <Skeleton />;
  return <Ready data={state.data} />;
}
