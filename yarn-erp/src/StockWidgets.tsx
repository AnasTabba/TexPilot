import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { qualityName, stageName, stockStages, weight, type StockStage, type WorkspaceState } from './inventory-client';
import './stock-widgets.css';

const COLOUR: Record<StockStage, string> = { raw: '#f2a541', wip: '#4f5bd5', finished: '#0f8b8d', cops: '#e4572e' };
const DAY_MS = 86_400_000;
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' });
const dayNumber = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric' });
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// Animates a number from its previous value to the target over ~700ms with requestAnimationFrame.
function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (prefersReducedMotion() || from === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      fromRef.current = from + (target - from) * eased;
      setValue(fromRef.current);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

export function ProductionWidget({ state }: { state: WorkspaceState }) {
  const now = state.serverTime || Date.now();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = `stw-prod-${useId().replace(/:/g, '')}`;

  const { days, current, prior, allTime } = useMemo(() => {
    const reversed = new Set<string>();
    for (const m of state.movements) if (m.reverses) reversed.add(m.reverses);
    const byDay = new Map<string, number>();
    let allTime = 0;
    for (const m of state.movements) {
      if (m.action !== 'transfer' || reversed.has(m.id)) continue;
      if (m.to_stage !== 'finished' && m.to_stage !== 'cops') continue;
      allTime += m.grams;
      const key = dayKey.format(m.created_at);
      byDay.set(key, (byDay.get(key) ?? 0) + m.grams);
    }
    // 28 consecutive Karachi days ending today: first 14 are the prior period, last 14 the current one.
    const times = Array.from({ length: 28 }, (_, i) => now - (27 - i) * DAY_MS);
    const grams = times.map(t => byDay.get(dayKey.format(t)) ?? 0);
    const days = times.slice(14).map((time, i) => ({ time, grams: grams[14 + i] }));
    return { days, current: sum(grams.slice(14)), prior: sum(grams.slice(0, 14)), allTime };
  }, [state.movements, now]);

  const shown = useCountUp(current);
  const maxGrams = Math.max(1, ...days.map(d => d.grams));
  const W = 560, H = 190, PAD_TOP = 40, PAD_BOTTOM = 22;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const colW = W / days.length;
  const barW = colW * 0.62;
  const up = current >= prior;
  const pct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : null;

  return (
    <section className="stw-card stw-prod" aria-label="Production">
      <div className="stw-head">
        <div>
          <div className="stw-label">Total production</div>
          <div className="stw-kpi">{weight(Math.round(shown))}<small>kg</small></div>
        </div>
        <div className="stw-side">
          <span className={`stw-delta ${up ? 'up' : 'down'}`}>
            {up ? <ArrowUpRight size={15} aria-hidden /> : <ArrowDownRight size={15} aria-hidden />}
            {pct !== null ? `${Math.abs(pct)}%` : current > 0 ? 'new' : '—'}
          </span>
          <div className="stw-sub">all time {weight(allTime)} kg</div>
        </div>
      </div>

      <div className={`stw-chart${active !== null ? ' is-hover' : ''}`}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Production per day, last 14 days">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4fd1c5" />
              <stop offset="100%" stopColor={COLOUR.finished} />
            </linearGradient>
          </defs>
          {days.map((d, i) => {
            const x = i * colW;
            const h = d.grams === 0 ? 6 : Math.max(4, (d.grams / maxGrams) * plotH);
            const label = dayLabel.format(d.time);
            return (
              <g
                key={d.time}
                className={`stw-col${active === i ? ' is-on' : ''}`}
                tabIndex={0}
                role="img"
                aria-label={`${label}: ${weight(d.grams)} kg`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <rect className="stw-hit" x={x} y={0} width={colW} height={H} />
                <rect
                  className={`stw-bar${d.grams === 0 ? ' stw-bar--empty' : ''}`}
                  x={x + (colW - barW) / 2}
                  y={PAD_TOP + plotH - h}
                  width={barW}
                  height={h}
                  rx={5}
                  fill={d.grams === 0 ? undefined : `url(#${gradientId})`}
                  style={{ '--i': i } as CSSProperties}
                />
                <text className="stw-tick" x={x + colW / 2} y={H - 4} textAnchor="middle">{dayNumber.format(d.time)}</text>
              </g>
            );
          })}
        </svg>
        {active !== null && days[active] && (
          <div className="stw-tip is-on" style={{ left: `${((active + 0.5) / days.length) * 100}%` }}>
            <b>{dayLabel.format(days[active].time)}</b> {weight(days[active].grams)} kg
          </div>
        )}
      </div>
    </section>
  );
}

export function InventoryWidget({ state }: { state: WorkspaceState }) {
  const [selected, setSelected] = useState<StockStage | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const productName = useMemo(() => new Map(state.products.map(p => [p.id, p.name])), [state.products]);
  const lotById = useMemo(() => new Map(state.lots.map(l => [l.id, l])), [state.lots]);

  const stageGrams = useMemo(() => {
    const totals: Record<StockStage, number> = { raw: 0, wip: 0, finished: 0, cops: 0 };
    for (const b of state.balances) totals[b.stage] += b.grams;
    return totals;
  }, [state.balances]);
  const total = sum(stockStages.map(st => stageGrams[st]));

  let offset = 0;
  const segments = stockStages
    .map((stage, index) => {
      const pct = total ? (stageGrams[stage] / total) * 100 : 0;
      const seg = { stage, index, pct, offset };
      offset += pct;
      return seg;
    })
    .filter(s => s.pct > 0);

  const rows = useMemo(
    () => state.balances
      .flatMap(b => {
        const lot = lotById.get(b.lot_id);
        return lot && b.grams > 0 && (!selected || b.stage === selected) ? [{ b, lot }] : [];
      })
      .sort((x, y) => y.b.grams - x.b.grams)
      .slice(0, 6),
    [state.balances, lotById, selected],
  );

  const toggle = (stage: StockStage) => setSelected(s => (s === stage ? null : stage));
  const openInventory = () => { window.location.hash = '#/inventory'; };
  const onRowKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInventory(); }
  };

  return (
    <section className="stw-card stw-inv" aria-label="Inventory">
      <h2 className="stw-title">Inventory</h2>
      <div className="stw-donut-wrap">
        <div className="stw-donut">
          <svg viewBox="0 0 200 200" aria-hidden>
            <circle className="stw-donut-ring" cx={100} cy={100} r={80} />
            {segments.map(s => (
              <circle
                key={s.stage}
                className={`stw-seg${selected === s.stage ? ' is-on' : ''}${selected && selected !== s.stage ? ' is-dim' : ''}`}
                cx={100}
                cy={100}
                r={80}
                pathLength={100}
                stroke={COLOUR[s.stage]}
                strokeDasharray={ready ? `${s.pct} 100` : '0 100'}
                strokeDashoffset={-s.offset}
                style={{ transitionDelay: `${s.index * 120}ms` }}
                role="button"
                tabIndex={0}
                aria-label={`${stageName[s.stage]}: ${weight(stageGrams[s.stage])} kg`}
                aria-pressed={selected === s.stage}
                onClick={() => toggle(s.stage)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.stage); } }}
              />
            ))}
          </svg>
          <div className="stw-donut-centre">
            <b>{weight(total)}</b>
            <span>kg</span>
          </div>
        </div>

        <div className="stw-chips">
          {stockStages.map(st => (
            <button
              key={st}
              type="button"
              className={`stw-chip${selected === st ? ' is-on' : ''}`}
              style={{ '--c': COLOUR[st], '--ct': st === 'raw' ? '#1d1b19' : '#fff' } as CSSProperties}
              aria-pressed={selected === st}
              onClick={() => toggle(st)}
            >
              <i aria-hidden />
              <span>{stageName[st]}</span>
              <b>{weight(stageGrams[st])} kg</b>
            </button>
          ))}
        </div>
      </div>

      <div className="stw-scroll">
        <table className="stw-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Product</th>
              <th>Stage</th>
              <th className="num">kg</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody key={selected ?? 'all'}>
            {rows.length ? rows.map(({ b, lot }, i) => (
              <tr
                key={`${b.lot_id}-${b.stage}`}
                className="stw-row"
                style={{ '--i': i } as CSSProperties}
                tabIndex={0}
                onClick={openInventory}
                onKeyDown={onRowKey}
              >
                <td><span className="stw-cell">{lot.batch}</span></td>
                <td>{productName.get(lot.product_id) ?? '—'}</td>
                <td><span className="stw-stage" style={{ '--c': COLOUR[b.stage] } as CSSProperties}>{stageName[b.stage]}</span></td>
                <td className="num">{weight(b.grams)}</td>
                <td><span className={`stw-q stw-q--${lot.quality}`}>{qualityName[lot.quality]}</span></td>
              </tr>
            )) : (
              <tr className="stw-empty">
                <td colSpan={5}><span className="stw-empty-bar" /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
