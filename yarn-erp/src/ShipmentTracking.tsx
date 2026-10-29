import { useEffect, useState, type CSSProperties } from 'react';
import { ChevronDown, RefreshCw, Ship } from 'lucide-react';
import { InventoryError } from './inventory-client';
import { portal } from './PortalCommon';
import { errorMessage } from './forms';
import { useLanguage } from './i18n';
import { factoryTime } from './erp-client';
import { trackingView, type Shipment, type TrackingStage } from './tracking';
import './shipment-tracking.css';

interface ShipmentsResponse { shipments: Shipment[]; tracking: { configured: boolean; provider: string } }
interface TrackResponse { shipment?: Shipment; error?: string }

const STAGE: Record<TrackingStage, { en: string; ur: string; colour: string; ink: string }> = {
  not_checked: { en: 'Not checked', ur: 'چیک نہیں ہوا', colour: '#8a8f98', ink: '#fff' },
  booked: { en: 'Booked', ur: 'بک ہوا', colour: '#5b6474', ink: '#fff' },
  departed: { en: 'Departed', ur: 'روانہ', colour: '#0f8b8d', ink: '#fff' },
  in_transit: { en: 'In transit', ur: 'راستے میں', colour: '#4f5bd5', ink: '#fff' },
  arrived: { en: 'Arrived', ur: 'پہنچ گیا', colour: '#f2a541', ink: '#2a1d05' },
  delivered: { en: 'Delivered', ur: 'ڈیلیور ہوا', colour: '#1d6b3e', ink: '#fff' },
  error: { en: 'Tracking error', ur: 'ٹریکنگ کی خرابی', colour: '#e4572e', ink: '#fff' },
};
const STEPS: [TrackingStage, string, string][] = [['booked', 'Booked', 'بک ہوا'], ['departed', 'Departed', 'روانہ'], ['in_transit', 'In transit', 'راستے میں'], ['arrived', 'Arrived', 'پہنچ گیا'], ['delivered', 'Delivered', 'ڈیلیور']];
const FILTERS: { id: string; en: string; ur: string; match: (stage: TrackingStage) => boolean }[] = [
  { id: 'all', en: 'All', ur: 'سب', match: () => true },
  { id: 'route', en: 'On route', ur: 'راستے میں', match: stage => stage === 'departed' || stage === 'in_transit' },
  { id: 'arrived', en: 'Arrived', ur: 'پہنچ گئے', match: stage => stage === 'arrived' },
  { id: 'delivered', en: 'Delivered', ur: 'ڈیلیور ہوئے', match: stage => stage === 'delivered' },
];

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useShipments() {
  const [data, setData] = useState<ShipmentsResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    portal<ShipmentsResponse>('/shipments')
      .then(result => { if (alive) setData(result); })
      .catch(failure => {
        if (!alive) return;
        if (failure instanceof InventoryError && failure.status === 403) setForbidden(true);
        else setError(errorMessage(failure));
      });
    return () => { alive = false; };
  }, []);
  return { data, setData, forbidden, error };
}

function StagePill({ stage }: { stage: TrackingStage }) {
  const { t } = useLanguage(); const s = STAGE[stage];
  return <span className="trk-pill" style={{ background: s.colour, color: s.ink }}>{t(s.en, s.ur)}</span>;
}

/** The lane is the full route width, so translateX(100%) moves the ship along the whole line. */
function Route({ stage, progress, origin, destination }: { stage: TrackingStage; progress: number; origin: string | null; destination: string | null }) {
  const { t } = useLanguage();
  const current = STEPS.findIndex(([id]) => id === stage);
  // Starts at the origin; the CSS transition carries it to `progress` once the first frame is painted.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setShown(progress); return; }
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(progress)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [progress]);
  return <div className="trk-route">
    <div className="trk-ends"><span>{origin || t('Origin not given', 'روانگی کی جگہ درج نہیں')}</span><span>{destination || t('Destination not given', 'منزل درج نہیں')}</span></div>
    <div className={`trk-track${stage === 'in_transit' ? ' is-moving' : ''}`} role="img" aria-label={t(`${STAGE[stage].en}, ${Math.round(progress * 100)}% of the route`, `${STAGE[stage].ur}، راستے کا ${Math.round(progress * 100)}%`)}>
      <span className="trk-dot is-origin" aria-hidden="true" /><span className="trk-line" aria-hidden="true" /><span className="trk-dot is-dest" aria-hidden="true" />
      <div className="trk-lane" style={{ transform: `translateX(${shown * 100}%)` }}><Ship className="trk-ship" size={22} aria-hidden="true" /></div>
    </div>
    <ol className="trk-steps">{STEPS.map(([id, en, ur], i) => <li key={id} className={current >= 0 && i <= current ? 'is-done' : ''}>{t(en, ur)}</li>)}</ol>
  </div>;
}

function ShipmentCard({ shipment, error, busy, onCheck }: { shipment: Shipment; error: string; busy: boolean; onCheck: () => void }) {
  const { t } = useLanguage(); const [open, setOpen] = useState(false);
  const view = trackingView(shipment);
  const note = error || (shipment.status === 'error' ? shipment.last_error || '' : '');
  return <article className="trk-card">
    <header className="trk-head">
      <div><code className="trk-bl">{shipment.bill_of_lading}</code><p className="trk-muted">{[shipment.reference ?? shipment.purchase_order_id, shipment.supplier_name].filter(Boolean).join(' · ')}</p></div>
      <StagePill stage={view.stage} />
    </header>
    <Route stage={view.stage} progress={view.progress} origin={view.origin} destination={view.destination} />
    <ul className="trk-chips">
      {view.eta !== null && <li className="trk-chip">{t('ETA', 'متوقع')}: {factoryTime(view.eta)}</li>}
      {view.vessel && <li className="trk-chip">{t('Vessel', 'جہاز')}: {view.vessel}</li>}
      {view.containers.map(c => <li className="trk-chip trk-mono" key={c}>{c}</li>)}
    </ul>
    <p className="trk-muted">{shipment.last_checked_at ? t('Checked', 'چیک کیا گیا') + ' ' + factoryTime(shipment.last_checked_at) : t('Not checked yet', 'ابھی چیک نہیں کیا گیا')}</p>
    {note && <p className="trk-error" role="alert">{t(note)}</p>}
    <div className="trk-actions">
      <button type="button" className="trk-btn" disabled={busy} onClick={onCheck}><RefreshCw size={16} aria-hidden="true" className={busy ? 'trk-spin' : undefined} />{t('Check tracking', 'ٹریکنگ چیک کریں')}</button>
      {view.events.length > 0 && <button type="button" className="trk-btn is-ghost" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={16} aria-hidden="true" className={open ? 'is-open' : undefined} />{open ? t('Hide timeline', 'ٹائم لائن چھپائیں') : t('Show timeline', 'ٹائم لائن دکھائیں')} ({view.events.length})</button>}
    </div>
    {open && <ol className="trk-events">{view.events.map((e, i) => <li key={i}><span className="trk-event-dot" aria-hidden="true" /><div><strong>{e.title || e.code || t('Update', 'اپ ڈیٹ')}</strong><span className="trk-muted">{[e.location, e.at ? factoryTime(e.at) : t('Time not given', 'وقت درج نہیں')].filter(Boolean).join(' · ')}</span></div></li>)}</ol>}
  </article>;
}

export function ShipmentTracking() {
  const { language, t } = useLanguage();
  const { data, setData, forbidden, error: loadError } = useShipments();
  const [filter, setFilter] = useState('all'), [busy, setBusy] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});
  if (forbidden) return null;

  const check = async (id: string) => {
    setBusy(id); setErrors(prev => ({ ...prev, [id]: '' }));
    try {
      const result = await portal<TrackResponse>('/shipments/track', { id });
      if (result.shipment) setData(prev => prev && { ...prev, shipments: prev.shipments.map(s => s.id === id ? result.shipment! : s) });
      if (result.error) setErrors(prev => ({ ...prev, [id]: result.error! }));
    } catch (failure) {
      setErrors(prev => ({ ...prev, [id]: errorMessage(failure, language) }));
    } finally { setBusy(''); }
  };

  const active = FILTERS.find(f => f.id === filter) ?? FILTERS[0];
  const shown = (data?.shipments ?? []).filter(s => active.match(trackingView(s).stage));
  return <section className="trk-wrap" aria-label={t('Shipment tracking', 'شپمنٹ ٹریکنگ')}>
    <div className="yf-head"><div><h2>{t('Shipment tracking', 'شپمنٹ ٹریکنگ')}</h2><p>{t('Where each bill of lading is on its route, from the carrier’s latest update.', 'کیریئر کی تازہ ترین اطلاع کے مطابق ہر بل آف لیڈنگ کی راستے میں موجودہ حالت۔')}</p></div></div>
    {data && !data.tracking.configured && <p className="trk-banner" role="status">{t('Tracking is not connected yet. Add the API key and it starts working.', 'ٹریکنگ ابھی منسلک نہیں ہے۔ API کی درج کریں تو یہ کام شروع کر دے گی۔')}</p>}
    {loadError && <p className="live-error" role="alert">{t(loadError)}</p>}
    {!data && !loadError && <p className="live-muted" role="status">{t('Loading shipments…', 'شپمنٹس لوڈ ہو رہی ہیں…')}</p>}
    {data && data.shipments.length > 0 && <div className="trk-filters live-segments" role="group" aria-label={t('Filter shipments', 'شپمنٹس فلٹر کریں')}>
      {FILTERS.map(f => <button type="button" key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{t(f.en, f.ur)}</button>)}
    </div>}
    {data && !data.shipments.length && <div className="trk-empty"><Ship size={32} aria-hidden="true" /><h3>{t('No shipments yet', 'ابھی کوئی شپمنٹ نہیں')}</h3></div>}
    {data && data.shipments.length > 0 && !shown.length && <p className="live-muted">{t('Nothing in this view yet.', 'اس فلٹر میں ابھی کچھ نہیں۔')}</p>}
    <div className="trk-list">{shown.map(s => <ShipmentCard key={s.id} shipment={s} error={errors[s.id] || ''} busy={busy === s.id} onCheck={() => void check(s.id)} />)}</div>
  </section>;
}

function useCountUp(target: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) { setValue(target); return; }
    const start = performance.now(); let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / 700);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

/** Dashboard card: shipments currently on the water, each linking to the full Tracking view. */
export function ShipmentsWidget() {
  const { t } = useLanguage();
  const { data, forbidden, error } = useShipments();
  const onRoute = (data?.shipments ?? []).map(s => ({ s, view: trackingView(s) })).filter(({ view }) => view.stage === 'departed' || view.stage === 'in_transit');
  const count = useCountUp(onRoute.length);
  if (forbidden) return null;
  return <section className="trk-w" aria-label={t('Shipments on route', 'راستے میں شپمنٹس')}>
    <h2 className="trk-w-title">{t('Shipments on route', 'راستے میں شپمنٹس')}</h2>
    <p className="trk-w-count"><strong>{count}</strong><span>{t('on the water or on the road', 'سمندر یا سڑک پر')}</span></p>
    {error && <p className="live-error" role="alert">{t(error)}</p>}
    {onRoute.length > 0 && <ul className="trk-w-list">{onRoute.slice(0, 5).map(({ s, view }) => <li key={s.id}>
      <button type="button" className="trk-w-row" onClick={() => { location.hash = '#/tracking'; }}>
        <code className="trk-bl">{s.bill_of_lading}</code><StagePill stage={view.stage} />
        <span className="trk-w-bar" aria-hidden="true"><span style={{ '--p': view.progress } as CSSProperties} /></span>
      </button>
    </li>)}</ul>}
    {data && !onRoute.length && <p className="trk-muted">{t('No shipments on route', 'راستے میں کوئی شپمنٹ نہیں')}</p>}
  </section>;
}
