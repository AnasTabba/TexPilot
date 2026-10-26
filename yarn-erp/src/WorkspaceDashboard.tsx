import { ArrowRight, CheckCircle2, ChevronRight, CircleCheckBig, ClipboardCheck, ClipboardList, ScanSearch, TriangleAlert } from 'lucide-react';
import { Cone, materialHue } from './Cone';
import { moveIcon, stageIcon } from './icons';
import { qualityName, stageName, stockStages, weight, type Quality, type StockBalance, type WorkspaceState } from './inventory-client';

export function QualityBadge({ value }: { value: Quality }) {
  const Icon = value === 'approved' ? CheckCircle2 : value === 'hold' ? TriangleAlert : ClipboardList;
  return <span className={`live-quality ${value}`}><Icon size={18} aria-hidden="true" />{qualityName[value]}</span>;
}

// Keep a yarn count with its system on narrow screens: "Ne 30/1" never splits.
export const yarnName = (name: string) => name.replace(/\b(Ne|Nm|Tex) (?=\d)/g, '$1 ');
export const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
export const movedName: Record<string, string> = { receive: 'Received', dispatch: 'Dispatched', transfer: 'Moved', waste: 'Waste recorded', reverse: 'Reversed' };

/** Stock moving through the mill: one node per stage on a thread that keeps flowing toward dispatch. */
export function StockFlow({ balances, compact = false }: { balances: StockBalance[]; compact?: boolean }) {
  return <ol className={`yf-flow${compact ? ' is-compact' : ''}`} aria-label="Stock by stage">
    <svg className="yf-thread is-h" aria-hidden="true" viewBox="0 0 100 2" preserveAspectRatio="none"><line x1="0" y1="1" x2="100" y2="1" /><line className="yf-run" x1="0" y1="1" x2="100" y2="1" /></svg>
    <svg className="yf-thread is-v" aria-hidden="true" viewBox="0 0 2 100" preserveAspectRatio="none"><line x1="1" y1="0" x2="1" y2="100" /><line className="yf-run" x1="1" y1="0" x2="1" y2="100" /></svg>
    {stockStages.map(stage => {
      const here = balances.filter(b => b.stage === stage);
      const grams = here.reduce((sum, b) => sum + b.grams, 0);
      const Icon = stageIcon[stage];
      return <li key={stage} className={grams > 0 ? 'has-stock' : ''}>
        <span className="yf-node"><Icon size={compact ? 20 : 24} aria-hidden="true" /></span>
        <span className="yf-stage">{stageName[stage]}</span>
        <strong>{weight(grams)} <small>kg</small></strong>
        <span className="yf-cartons">{here.reduce((sum, b) => sum + b.cartons, 0)} cartons</span>
      </li>;
    })}
  </ol>;
}

/** Home: the one thing to do next, then stock flowing through its stages, materials, and the latest movements. */
export default function WorkspaceDashboard({ state, navigate }: { state: WorkspaceState; navigate: (route: string, lotId?: string) => void }) {
  const hue = (productId: string) => materialHue(state.products, productId);
  const product = (productId: string) => state.products.find(p => p.id === productId);
  const lotOf = (lotId: string) => state.lots.find(l => l.id === lotId);
  const lotGrams = (lotId: string) => state.balances.filter(b => b.lot_id === lotId).reduce((sum, b) => sum + b.grams, 0);
  const total = state.balances.reduce((sum, b) => sum + b.grams, 0);
  const byMaterial = state.products.map(p => ({ p, grams: state.lots.filter(l => l.product_id === p.id).reduce((sum, l) => sum + lotGrams(l.id), 0) })).filter(m => m.grams > 0);
  const lots = [...state.lots].sort((a, b) => lotGrams(b.id) - lotGrams(a.id));
  const waiting = state.lots.filter(l => l.quality !== 'approved').sort((a, b) => (a.quality === 'hold' ? 0 : 1) - (b.quality === 'hold' ? 0 : 1));
  const next = waiting[0];
  const nextName = next ? yarnName(product(next.product_id)?.name || 'this batch') : '';
  const others = waiting.length - 1;
  const recent = state.movements.slice(0, 5);
  return <div className="yf-home">
    <section className={`yf-next ${next ? next.quality : state.products.length ? 'clear' : 'empty'}`} aria-labelledby="yf-next-title">
      <span className="yf-next-icon">{next ? next.quality === 'hold' ? <TriangleAlert size={26} aria-hidden="true" /> : <ClipboardCheck size={26} aria-hidden="true" /> : <CircleCheckBig size={26} aria-hidden="true" />}</span>
      <div className="yf-next-text">
        <h2 id="yf-next-title">{next ? next.quality === 'hold' ? `Review the QC hold on ${nextName}` : `Inspect ${nextName} before dispatch` : state.products.length ? 'Every batch is QC approved' : 'Add your first material'}</h2>
        <p>{next ? `${next.batch} · ${next.supplier || 'supplier not recorded'} · ${weight(lotGrams(next.id))} kg${others > 0 ? ` · ${others} more ${others === 1 ? 'batch is' : 'batches are'} waiting for QC` : ''}`
          : state.products.length ? 'Approved stock can be moved into production or dispatched.' : 'Add a material such as Cotton Ne 30/1, then receive its first batch.'}</p>
      </div>
      <div className="yf-next-actions">
        {next ? <button className="button primary" onClick={() => navigate('inventory', next.id)}>{next.quality === 'hold' ? 'Review batch' : 'Inspect batch'}<ArrowRight size={18} aria-hidden="true" /></button>
          : <button className="button primary" onClick={() => navigate(state.products.length ? 'dispatch' : 'inventory')}>{state.products.length ? 'Stock to dispatch' : 'Open Stock'}<ArrowRight size={18} aria-hidden="true" /></button>}
        <button className="button" onClick={() => navigate('scanner')}><ScanSearch size={18} aria-hidden="true" />Scan fabric</button>
      </div>
    </section>

    <section className="yf-section" aria-labelledby="yf-flow-title">
      <div className="yf-head"><h2 id="yf-flow-title">Stock flow</h2><span>{weight(total)}{' '}kg on hand</span></div>
      <StockFlow balances={state.balances} />
    </section>

    <div className="yf-home-cols">
      <section className="yf-section" aria-labelledby="yf-materials-title">
        <div className="yf-head"><h2 id="yf-materials-title">Materials</h2><button className="live-text-button" onClick={() => navigate('inventory')}>Open Stock</button></div>
        {total > 0 && <div className="yf-mix" role="img" aria-label={byMaterial.map(m => `${m.p.name} ${weight(m.grams)} kg`).join(', ')}>
          {byMaterial.map(m => <i key={m.p.id} title={`${m.p.name} · ${weight(m.grams)} kg`} style={{ flex: m.grams, background: hue(m.p.id) }} />)}
        </div>}
        {lots.slice(0, 6).map(lot => <button className="yf-row" key={lot.id} onClick={() => navigate('inventory', lot.id)}>
          <Cone hue={hue(lot.product_id)} size={28} />
          <div><strong>{yarnName(product(lot.product_id)?.name || 'Material')}</strong><span>{lot.batch} · {lot.supplier || 'Supplier not recorded'}</span></div>
          <QualityBadge value={lot.quality} />
          <span className="yf-kg">{weight(lotGrams(lot.id))} <small>kg</small></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>)}
        {!lots.length && <p className="yf-none">No batches yet. Add a material in Stock, then its first batch.</p>}
        {lots.length > 6 && <button className="live-text-button yf-more" onClick={() => navigate('inventory')}>All {lots.length} batches in Stock</button>}
      </section>

      <section className="yf-section" aria-labelledby="yf-moves-title">
        <div className="yf-head"><h2 id="yf-moves-title">Recent movements</h2><button className="live-text-button" onClick={() => navigate('activity')}>History</button></div>
        <ol className="yf-timeline">
          {recent.map(m => { const lot = lotOf(m.lot_id); const Icon = moveIcon[m.action] || ArrowRight; return <li key={m.id}>
            <span className="yf-tnode"><Icon size={18} aria-hidden="true" /></span>
            <div><strong>{movedName[m.action] || m.action} · {lot?.batch || 'Batch'}</strong><span><Cone hue={hue(lot?.product_id || '')} size={14} />{m.action === 'transfer' && m.from_stage && m.to_stage ? `${stageName[m.from_stage]} → ${stageName[m.to_stage]}` : yarnName(product(lot?.product_id || '')?.name || '')}</span></div>
            <div className="yf-side"><span className="yf-kg">{weight(m.grams)} <small>kg</small></span><time dateTime={new Date(m.created_at).toISOString()}>{when.format(m.created_at)}</time></div>
          </li>; })}
        </ol>
        {!recent.length && <p className="yf-none">Movements appear here once stock is received.</p>}
      </section>
    </div>
  </div>;
}
