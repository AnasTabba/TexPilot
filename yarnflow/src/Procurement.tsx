import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, Building2, ClipboardList, ExternalLink, Lock, Mail, Pencil, Phone, Plus, RefreshCw, Scale, Ship, ShieldCheck, Star, Truck } from 'lucide-react';
import { inventoryRequest as api, can, type Member } from './inventory-client';
import { AsyncForm, Field, errorMessage } from './forms';
import { InterventionField } from './PortalCommon';
import { useLanguage } from './i18n';
import { urdu } from './translations';
import { BidTerms, CategoryPicker, RfqSummary } from './ErpCommon';
import { ORDER_LABEL, OrderFacts, type OrderRecord } from './PurchaseOrders';
import { type SupplierCategory, type Supplier, type SupplierRating, type ProcurementState, type ProcurementRfq, type SupplierBid, type PendingPurchasing, type PurchaseOrder, rate, factoryTime, quantity, factoryInput, localFactoryInput, fixedInput } from './erp-client';
import './erp.css';
import './people-ui.css';
import IncomingStock, { type QcLot } from './IncomingStock';
import { ShipmentTracking } from './ShipmentTracking';
import { Correction } from './CorrectionForm';
import { StageIcon, type StageIconName } from './iso/StageIcons';
import { ActionBar, EmptyState, RowCard, StatusTag, Tabs, Sheet, Section } from './ui';

type View = 'board' | 'suppliers' | 'tracking' | 'incoming';
type Stage = 'rfq' | 'bids' | 'po' | 'incoming' | 'inspect';
type Rec = { kind: 'rfq'; rfq: ProcurementRfq } | { kind: 'bid'; bid: SupplierBid; rfq: ProcurementRfq } | { kind: 'order'; order: OrderRecord } | { kind: 'lot'; lot: QcLot };
// One card. `stage` is the column it sits in; null means finished, kept so an open sheet survives a status change.
interface Item { key: string; stage: Stage | null; title: string; meta: string; tag: string; supplier: string; material: string; amount: string; date: string; action: string; overdue: boolean; mine: boolean; rec: Rec }

const pipelineIcon: Record<Stage, StageIconName> = { rfq: 'rfq', bids: 'bid', po: 'po', incoming: 'incoming', inspect: 'inspect' };
const EMPTY: Record<Stage, { kind: 'inbox' | 'people' | 'orders' | 'shipments' | 'stock'; en: string; ur: string }> = {
 rfq: { kind: 'inbox', en: 'No price requests yet. Publish one to ask approved suppliers for a price.', ur: 'ابھی قیمت کی کوئی درخواست نہیں۔ منظور شدہ سپلائرز سے قیمت کے لیے درخواست شائع کریں۔' },
 bids: { kind: 'people', en: 'Supplier bids appear here as they arrive.', ur: 'سپلائر کی بولیاں آتے ہی یہاں نظر آئیں گی۔' },
 po: { kind: 'orders', en: 'Accepting a bid creates a purchase order here.', ur: 'بولی منظور کرنے پر یہاں خریداری کا آرڈر بنے گا۔' },
 incoming: { kind: 'shipments', en: 'Dispatched orders stay here until their arrival is registered.', ur: 'روانہ شدہ آرڈر یہاں اس وقت تک رہیں گے جب تک ان کی آمد درج نہ ہو۔' },
 inspect: { kind: 'stock', en: 'Arrivals waiting for a quality inspector show here.', ur: 'معائنہ کار کے منتظر مال کی آمد یہاں نظر آئے گی۔' },
};
const RFQ_UR: Record<string, string> = { draft: 'مسودہ', open: 'کھلا', awarded: 'منظور شدہ', closed: 'بند', cancelled: 'منسوخ' };

export default function Procurement({ member, onInventoryChanged }: { member: Member; onInventoryChanged: () => Promise<void> }) {
 const { language, t } = useLanguage(); const directoryAllowed = can(member, 'suppliers'), buyingAllowed = can(member, 'procure');
 const canManage = member.role === 'purchase_manager' || member.admin, canAct = buyingAllowed && canManage;
 const [view, setView] = useState<View>(() => buyingAllowed && (location.hash.split('/')[2] === 'tracking' || location.hash.startsWith('#/tracking')) ? 'tracking' : buyingAllowed ? 'board' : directoryAllowed ? 'suppliers' : 'incoming');
 const [category, setCategory] = useState('all'), [search, setSearch] = useState('');
 const [suppliers, setSuppliers] = useState<Supplier[]>([]), [categories, setCategories] = useState<SupplierCategory[]>([]), [state, setState] = useState<ProcurementState>({ rfqs: [], bids: [], orders: [], shipments: [] }), [lots, setLots] = useState<QcLot[]>([]);
 const [pending, setPending] = useState<PendingPurchasing>({ awards: [], changes: [] }), [loading, setLoading] = useState(true), [error, setError] = useState(''), [open, setOpen] = useState(''), [notice, setNotice] = useState('');
 const [sel, setSel] = useState(''), [chip, setChip] = useState<'all' | 'mine' | 'overdue'>('all'), [supplierFilter, setSupplierFilter] = useState('');
 const [stage, setStage] = useState<Stage>('rfq'), [filtersOpen, setFiltersOpen] = useState(false);
 const load = useCallback(async () => {
  try {
   const [cat, list, procurement, waiting, qc] = await Promise.all([api<{ categories: SupplierCategory[] }>('/erp/categories'), directoryAllowed ? api<{ suppliers: Supplier[] }>('/erp/suppliers') : Promise.resolve({ suppliers: [] }), buyingAllowed ? api<ProcurementState>('/erp/procurement') : Promise.resolve({ rfqs: [], bids: [], orders: [], shipments: [] }), buyingAllowed ? api<PendingPurchasing>('/erp/orders/pending-approvals') : Promise.resolve({ awards: [], changes: [] }), buyingAllowed ? api<{ lots: QcLot[] }>('/erp/qc/lots') : Promise.resolve({ lots: [] })]);
   setPending(waiting); setCategories(cat.categories); setSuppliers(list.suppliers); setState(procurement); setLots(qc.lots); setError('');
  } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
 }, [directoryAllowed, buyingAllowed]);
 useEffect(() => { void load(); }, [load]);
 const close = () => { setSel(''); setOpen(''); };
 const select = (key: string) => { setOpen(''); setSel(key); };
 const saved = async (message?: string, key?: string) => { setOpen(''); if (key) setSel(key); setNotice(message ?? t('Saved.', 'محفوظ ہو گیا۔')); await load(); };
 // Opening a card moves focus into its sheet; Escape closes it.
 // Closing hands focus back to the card or button that opened the sheet.
 const opener = useRef<HTMLElement | null>(null);
 useEffect(() => {
  if (!sel) { opener.current?.focus({ preventScroll: true }); opener.current = null; return; }
  opener.current ??= document.activeElement as HTMLElement;
  document.getElementById('pb-sheet-title')?.focus({ preventScroll: true });
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSel(''); setOpen(''); } };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
 }, [sel]);

 const title = (id: string) => { const c = categories.find(c => c.id === id); return c ? language === 'ur' ? c.urdu_name : c.name : t('Unknown category', 'نامعلوم قسم'); };
 const rfqLabel = (status: string) => t(status.charAt(0).toUpperCase() + status.slice(1), RFQ_UR[status] ?? status);
 const now = Date.now();
 // Every record becomes a card; `stage` decides the column. Counts and filters come from this list only.
 const items: Item[] = [
  ...state.rfqs.map((r): Item => {
   const live = ['draft', 'open', 'closed'].includes(r.status);
   return { key: `rfq:${r.id}`, stage: live ? 'rfq' : null, title: r.title, meta: `${r.reference} · ${title(r.category_id)}`, tag: rfqLabel(r.status), supplier: '', material: title(r.category_id), amount: `${quantity(r.quantity_milli)} ${r.unit}`, date: factoryTime(r.requested_delivery_at), action: r.status === 'draft' ? t('Publish price request', 'قیمت کی درخواست شائع کریں') : t('Open price request', 'قیمت کی درخواست کھولیں'), overdue: r.status === 'open' && r.deadline_at < now, mine: canAct && live, rec: { kind: 'rfq', rfq: r } };
  }),
  ...state.bids.flatMap((b): Item[] => {
   const r = state.rfqs.find(x => x.id === b.rfq_id);
   if (!r) return [];
   const live = b.status === 'submitted' && ['open', 'closed'].includes(r.status);
   return [{ key: `bid:${b.id}`, stage: live ? 'bids' : null, title: b.supplier_name ?? t('Unknown supplier', 'نامعلوم سپلائر'), meta: `${r.title} · ${rate(b.price_minor, b.currency)} / ${r.unit}`, tag: b.status === 'rejected' ? t('Rejected', 'مسترد') : t('Submitted', 'جمع شدہ'), supplier: b.supplier_name ?? t('Unknown supplier', 'نامعلوم سپلائر'), material: title(r.category_id), amount: `${quantity(b.quantity_milli)} ${r.unit}`, date: factoryTime(b.delivery_at), action: t('Review bid', 'بولی کا جائزہ لیں'), overdue: live && b.valid_until < now, mine: canAct && live, rec: { kind: 'bid', bid: b, rfq: r } }];
  }),
  ...state.orders.map((o): Item => {
   const order = o as OrderRecord, stage: Stage | null = o.status === 'accepted' ? 'po' : o.status === 'dispatched' ? 'incoming' : null, label = ORDER_LABEL[o.status];
   return { key: `order:${o.id}`, stage, title: o.terms.title, meta: `${o.reference} · ${o.supplier_name ?? ''} · ${quantity(o.quantity_milli)} ${o.terms.unit}`, tag: label ? t(label[0], label[1]) : o.status, supplier: o.supplier_name ?? t('Unknown supplier', 'نامعلوم سپلائر'), material: o.terms.title, amount: `${quantity(o.quantity_milli)} ${o.terms.unit}`, date: factoryTime(o.terms.delivery_at), action: stage === 'incoming' ? t('Register arrival', 'آمد درج کریں') : t('Open purchase order', 'خریداری آرڈر کھولیں'), overdue: stage !== null && o.terms.delivery_at < now, mine: canAct && stage !== null && (stage === 'incoming' || !order.bill_of_lading), rec: { kind: 'order', order } };
  }),
  ...lots.map((l): Item => {
   const live = !l.cancelled_at && l.status !== 'settled', supplier = state.orders.find(o => o.id === l.purchase_order_id)?.supplier_name ?? '';
   const label = l.cancelled_at ? t('Cancelled', 'منسوخ') : l.status === 'awaiting_inspection' ? t('Awaiting inspection', 'معائنے کا منتظر') : t('Under review', 'جائزے میں');
   return { key: `lot:${l.id}`, stage: live ? 'inspect' : null, title: l.product_name, meta: `${l.reference} · ${quantity(l.quantity_milli)} ${l.unit}`, tag: label, supplier: supplier || t('Unknown supplier', 'نامعلوم سپلائر'), material: l.product_name, amount: `${quantity(l.quantity_milli)} ${l.unit}`, date: factoryTime(l.arrived_at), action: t('View inspection', 'معائنہ دیکھیں'), overdue: false, mine: false, rec: { kind: 'lot', lot: l } };
  }),
 ];
 const count = (stage: Stage) => items.filter(i => i.stage === stage).length;
 const pass = (i: Item) => (chip === 'all' || (chip === 'mine' ? i.mine : i.overdue)) && (!supplierFilter || i.supplier === supplierFilter);
 const supplierNames = [...new Set(items.map(i => i.supplier).filter(Boolean))].sort();
 const drafts = state.rfqs.filter(r => r.status === 'draft').length, openRfqs = state.rfqs.filter(r => r.status === 'open').length;
 const bidsToReview = count('bids'), accepted = count('po'), dispatched = count('incoming');
 const COLUMNS: { stage: Stage; name: string; next: string }[] = [
  { stage: 'rfq', name: t('Price requests', 'قیمت کی درخواستیں'), next: drafts ? t(`Publish ${drafts} draft${drafts === 1 ? '' : 's'}`, `${drafts} مسودہ شائع کریں`) : openRfqs ? t('Bidding is open. Review bids as they arrive.', 'بولی کھلی ہے۔ بولیاں آتے ہی جائزہ لیں۔') : t('Create the first price request', 'پہلی قیمت کی درخواست بنائیں') },
  { stage: 'bids', name: t('Bids', 'بولیاں'), next: bidsToReview ? t('Review and accept a bid', 'بولی کا جائزہ لے کر منظور کریں') : t('Waiting for supplier bids', 'سپلائر کی بولیوں کا انتظار') },
  { stage: 'po', name: t('Orders', 'آرڈر'), next: accepted ? t('Attach the bill of lading at dispatch', 'روانگی پر بل آف لیڈنگ لگائیں') : t('An order is created when a bid is accepted', 'بولی منظور ہونے پر آرڈر بنتا ہے') },
  { stage: 'incoming', name: t('Arriving', 'راستے میں'), next: dispatched ? t('Register the arrival for inspection', 'معائنے کے لیے آمد درج کریں') : t('Nothing is on the way', 'ابھی کچھ راستے میں نہیں') },
  { stage: 'inspect', name: t('To inspect', 'معائنے کے لیے'), next: t('The inspector records the report, then the supervisor decides', 'معائنہ کار رپورٹ درج کرے، پھر سپروائزر فیصلہ کرے') },
 ];

 // The sheet body for the selected card: its facts, its own timeline and one primary next step (--pop).
 const detail = (): { kicker: string; heading: string; body: ReactNode } | null => {
  if (sel === 'new') return { kicker: t('Price request', 'قیمت کی درخواست'), heading: t('Ask for prices', 'قیمت پوچھیں'), body: <RfqForm member={member} categories={categories} onSaved={id => saved(undefined, `rfq:${id}`)} onCancel={close} /> };
  const current = items.find(i => i.key === sel);
  if (!current) return null;
  const rec = current.rec;
  if (rec.kind === 'rfq') {
   const r = rec.rfq;
   return { kicker: t('Price request', 'قیمت کی درخواست'), heading: r.title, body: <>
    <span className="erp-status">{rfqLabel(r.status)}</span>
    <RfqSummary rfq={r} />
    <p className="live-muted">{t(`Sent to ${r.recipient_count || 0} supplier${r.recipient_count === 1 ? '' : 's'}`, `${r.recipient_count || 0} سپلائرز کو بھیجا گیا`)} · {t(`${r.bid_count || 0} bid${r.bid_count === 1 ? '' : 's'}`, `${r.bid_count || 0} بولیاں`)}</p>
    {r.status === 'draft' && <RfqStep member={member} kind="publish" rfq={r} onSaved={saved} />}
    {r.status === 'open' && <RfqStep member={member} kind="close" rfq={r} onSaved={saved} />}
    {r.status === 'closed' && r.deadline_at > Date.now() && <Correction member={member} label={t('Reopen bidding', 'بولی دوبارہ کھولیں')} title={t('Reopen bidding', 'بولی دوبارہ کھولیں')} effect={t('Suppliers can bid again until the deadline. Nothing is awarded by this.', 'deadline تک سپلائر دوبارہ بولی دے سکیں گے۔ اس سے کچھ منظور نہیں ہوتا۔')} submit={t('Reopen bidding', 'بولی دوبارہ کھولیں')} owners={['purchase_manager']} path="/erp/rfqs/reopen" payload={() => ({ rfqId: r.id })} onSaved={saved} />}
    {['draft', 'open', 'closed'].includes(r.status) && <RfqStep member={member} kind="cancel" rfq={r} onSaved={saved} />}
    <h3 className="pb-sub">{t('Supplier bids', 'سپلائر بولیاں')}</h3>
    {state.bids.filter(b => b.rfq_id === r.id).map(b => <button key={b.id} type="button" className="pb-bid-link" onClick={() => select(`bid:${b.id}`)}><span>{b.supplier_name} · {t('Revision', 'ترمیم')} {b.version}</span><span className="pb-row-meta">{rate(b.price_minor, b.currency)} / {r.unit} · {b.status === 'rejected' ? t('Rejected', 'مسترد') : t('Submitted', 'جمع شدہ')}</span></button>)}
    {!state.bids.some(b => b.rfq_id === r.id) && <p className="live-muted">{t('No bids yet.', 'ابھی کوئی بولی نہیں۔')}</p>}
   </> };
  }
  if (rec.kind === 'bid') {
   const b = rec.bid, r = rec.rfq;
   const waiting = pending.awards.some(a => a.bidId === b.id);
   return { kicker: t('Bid', 'بولی'), heading: b.supplier_name ?? '', body: <>
    <span className="erp-status">{rfqLabel(r.status)}</span>
    <p className="live-muted">{r.reference} · {r.title} · {t('Revision', 'ترمیم')} {b.version}</p>
    <BidTerms bid={b} unit={r.unit} />
    {b.status === 'rejected' && <p className="live-warning">{t('Rejected:', 'مسترد:')} {b.rejection_reason}</p>}
    {b.status === 'rejected' && ['open', 'closed'].includes(r.status) && <Correction member={member} label={t('Undo rejection', 'مسترد کرنا واپس لیں')} title={t('Undo rejection', 'مسترد کرنا واپس لیں')} effect={t('The bid goes back to submitted, so it can be reviewed and awarded again.', 'بولی دوبارہ جمع شدہ ہو جائے گی، تاکہ دوبارہ جائزہ لے کر منظور کی جا سکے۔')} submit={t('Restore bid', 'بولی بحال کریں')} owners={['purchase_manager']} path="/erp/bids/reject/undo" payload={() => ({ bidId: b.id, version: b.version })} onSaved={saved} />}
    {r.status === 'cancelled' || r.status === 'awarded' || r.status === 'draft' || b.status !== 'submitted' ? null : waiting ? <>
     <p className="live-warning">{t('Waiting for admin approval. The purchase order is created once approved.', 'ایڈمن کی منظوری کا انتظار ہے۔ منظوری کے بعد خریداری آرڈر بنے گا۔')}</p>
     <Correction member={member} label={t('Withdraw this award', 'یہ منظوری واپس لیں')} title={t('Withdraw this award', 'یہ منظوری واپس لیں')} effect={t('The award request is cancelled and nothing is ordered. The price request can then be awarded to another bid.', 'منظوری کی درخواست منسوخ ہو جائے گی اور کچھ نہیں منگوایا جائے گا۔ اس کے بعد کسی اور بولی کو منظور کیا جا سکتا ہے۔')} submit={t('Withdraw award', 'منظوری واپس لیں')} owners={['purchase_manager']} path="/erp/orders/cancel" payload={() => ({ approvalId: pending.awards.find(a => a.bidId === b.id)?.approvalId })} onSaved={saved} />
    </> : open === 'award:' + b.id || open === 'reject:' + b.id ? <BidDecision member={member} bid={b} rfq={r} accepting={open.startsWith('award:')} onSaved={saved} onCancel={() => setOpen('')} />
     : <div className="live-actions">{canAct && <button className="button primary" onClick={() => setOpen('award:' + b.id)}>{t('Review and accept bid', 'بولی کا جائزہ اور منظوری')}</button>}{canAct && <button className="button" onClick={() => setOpen('reject:' + b.id)}>{t('Reject bid', 'بولی مسترد کریں')}</button>}</div>}
   </> };
  }
  if (rec.kind === 'order') {
   const o = rec.order;
   return { kicker: t('Purchase order', 'خریداری آرڈر'), heading: o.terms.title, body: <>
    <OrderFacts order={o} shipments={state.shipments} />
    <BidTerms bid={o.terms} unit={o.terms.unit} />
    {o.approval_status === 'pending_admin' && <p className="live-warning">{t('Quantity change waiting for admin approval', 'مقدار کی تبدیلی ایڈمن کی منظوری کی منتظر ہے')}</p>}
    <div className="live-actions">{o.approval_status === 'approved' && o.status !== 'cancelled' && (open === 'qty:' + o.id ? <QuantityForm member={member} order={o} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('qty:' + o.id)}><Scale size={18} />{t('Change quantity', 'مقدار تبدیل کریں')}</button>)}{o.approval_status === 'approved' && ['accepted', 'dispatched'].includes(o.status) && !o.bill_of_lading && canManage && (open === 'bl:' + o.id ? <BillOfLadingForm member={member} order={o} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button primary" onClick={() => setOpen('bl:' + o.id)}><Truck size={18} />{t('Attach bill of lading', 'بل آف لیڈنگ لگائیں')}</button>)}</div>
    {o.status === 'accepted' && !o.bill_of_lading && canManage && <Correction member={member} label={t('Cancel this order', 'یہ آرڈر منسوخ کریں')} title={t('Cancel this order', 'یہ آرڈر منسوخ کریں')} effect={t('The order is cancelled and the price request is reopened for awarding, so another bid can win. Only possible before goods are dispatched, arrive or have a bill of lading.', 'آرڈر منسوخ ہو جائے گا اور درخواست دوبارہ منظوری کے لیے کھل جائے گی۔ صرف روانگی، آمد یا بل آف لیڈنگ سے پہلے ممکن ہے۔')} submit={t('Cancel order', 'آرڈر منسوخ کریں')} owners={['purchase_manager']} path="/erp/orders/cancel" payload={() => ({ orderId: o.id })} onSaved={saved} />}
    {o.status === 'dispatched' && <IncomingStock member={member} onInventoryChanged={onInventoryChanged} orderId={o.id} />}
   </> };
  }
  const l = rec.lot;
  return { kicker: t('Inspect', 'معائنہ'), heading: l.product_name, body: <>
   <span className="pb-tag">{current.tag}</span>
   <p className="live-muted">{l.reference}</p>
   <dl className="erp-facts"><div><dt>{t('Quantity', 'مقدار')}</dt><dd>{quantity(l.quantity_milli)} {l.unit}</dd></div><div><dt>{t('Supplier lot', 'سپلائر لاٹ')}</dt><dd>{l.supplier_lot || '—'}</dd></div><div><dt>{t('Arrived', 'آمد')}</dt><dd>{factoryTime(l.arrived_at)}</dd></div></dl>
   <p className="live-muted">{t('The inspector records the report, then the supervisor decides.', 'معائنہ کار رپورٹ درج کرے، پھر سپروائزر فیصلہ کرے۔')}</p>
  </> };
 };
 const shown = detail();
 const matches = suppliers.filter(s => (category === 'all' || s.categories.includes(category)) && [s.name, s.contact_name, s.city, s.email].join(' ').toLowerCase().includes(search.toLowerCase()));

 const portal = <a className="button" href="#/supplier" target="_blank" rel="noreferrer"><ExternalLink size={18} />{t('Open supplier registration portal', 'سپلائر رجسٹریشن پورٹل کھولیں')}</a>;
 return <div className="erp-workspace pb">
  <div className="pb-bar"><div className="live-segments" aria-label={t('Procurement views', 'خریداری کے حصے')}>{buyingAllowed && <button aria-pressed={view === 'board'} onClick={() => { setView('board'); setOpen(''); }}>{t('Buying', 'خریداری')}</button>}{directoryAllowed && <button aria-pressed={view === 'suppliers'} onClick={() => { setView('suppliers'); setOpen(''); }}>{t('Suppliers', 'سپلائرز')}</button>}{buyingAllowed && <button aria-pressed={view === 'tracking'} onClick={() => { setView('tracking'); setOpen(''); }}><Ship size={18} />{t('Tracking', 'ٹریکنگ')}</button>}{!buyingAllowed && can(member, 'receive') && <button aria-pressed={view === 'incoming'} onClick={() => { setView('incoming'); setOpen(''); }}><Truck size={18} />{t('Incoming stock', 'آنے والا اسٹاک')}</button>}</div></div>
  {error && <p className="live-error" role="alert">{t(error, urdu[error] || 'کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔')}<button className="live-text-button" onClick={() => void load()}>{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}{notice && <p className="live-success" role="status">{notice}</p>}{loading && <p role="status">{t('Loading procurement…', 'خریداری کی تفصیلات لوڈ ہو رہی ہیں…')}</p>}
  {view === 'board' && buyingAllowed && !loading && <>
   <Tabs label={t('Buying stages', 'خریداری کے مراحل')} value={stage} onChange={v => setStage(v as Stage)} items={COLUMNS.map(c => ({ id: c.stage, label: c.name, count: count(c.stage) }))} />
   <div className={`pb-layout${shown ? ' has-sheet' : ''}`}>
    <div className="pb-main">
     {(() => { const col = COLUMNS.find(c => c.stage === stage)!, n = count(stage), rows = items.filter(i => i.stage === stage && pass(i)); return <>
      <Section title={col.name} action={<div className="pb-list-actions"><button type="button" className="pb-refresh" onClick={() => void load()}><RefreshCw size={18} aria-hidden="true" />{t('Refresh', 'تازہ کریں')}</button><button type="button" className="button" onClick={() => setFiltersOpen(true)}>{t('Filter', 'فلٹر')}</button></div>}>
       <p className="pb-next">{col.next}</p>
       <div className="pb-list-view" data-stage={stage}>
        {rows.length ? rows.map(i => <RowCard key={i.key} title={i.title} detail={`${i.supplier || t('Approved suppliers', 'منظور سپلائرز')} · ${i.material} · ${i.amount} · ${i.date}`} leading={<StageIcon name={pipelineIcon[stage]} state="current" />} status={<StatusTag tone={i.overdue ? 'warn' : stage === 'incoming' ? 'ok' : 'info'} label={i.overdue ? `${i.tag} · ${t('Overdue', 'تاخیر شدہ')}` : i.tag} />} value={i.action} onClick={() => select(i.key)} />)
         : error ? null : <EmptyState message={n ? t('Nothing matches these filters.', 'ان فلٹرز سے کوئی مطابقت نہیں۔') : t(EMPTY[stage].en, EMPTY[stage].ur)} emptyIso={EMPTY[stage].kind} action={stage === 'rfq' && canAct && !n ? <button type="button" className="button primary" onClick={() => select('new')}><Plus size={18} />{t('Ask for prices', 'قیمت پوچھیں')}</button> : undefined} />}
       </div>
      </Section>
      {stage === 'rfq' && canAct && n > 0 && <ActionBar primary={{ label: t('Ask for prices', 'قیمت پوچھیں'), icon: <Plus />, onClick: () => select('new') }} />}
     </>; })()}
     <Sheet open={filtersOpen} title={t('Filter', 'فلٹر')} onClose={() => setFiltersOpen(false)}><div className="pb-filter-options"><button className="button" aria-pressed={chip === 'all'} onClick={() => setChip('all')}>{t('All', 'سب')}</button><button className="button" aria-pressed={chip === 'mine'} onClick={() => setChip('mine')}>{t('Needs my action', 'میرے عمل کا منتظر')}</button><button className="button" aria-pressed={chip === 'overdue'} onClick={() => setChip('overdue')}>{t('Overdue', 'تاخیر شدہ')}</button><Field>{t('Supplier', 'سپلائر')}<select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}><option value="">{t('All suppliers', 'تمام سپلائرز')}</option>{supplierNames.map(name => <option key={name}>{name}</option>)}</select></Field></div></Sheet>
    </div>
    {shown && <aside className="pb-sheet" role="dialog" aria-labelledby="pb-sheet-title">
     <header className="pb-sheet-head"><div><p className="pb-kicker">{shown.kicker}</p><h2 id="pb-sheet-title" tabIndex={-1}>{shown.heading}</h2></div><button type="button" className="button pb-close" onClick={close}>{t('Close', 'بند کریں')}</button></header>
     <div className="pb-sheet-body">{shown.body}</div>
    </aside>}
   </div>
  </>}
  {view === 'suppliers' && directoryAllowed && <>
   <section className="live-panel pb-directory">
    <div className="yf-head"><div><h2>{t('Supplier directory', 'سپلائر ڈائریکٹری')}</h2><p>{t('Registered suppliers by yarn category. The purchase manager approves them before they can bid.', 'دھاگے کی اقسام کے مطابق رجسٹرڈ سپلائرز۔ بولی سے پہلے خریداری مینیجر انہیں منظور کرتا ہے۔')}</p></div>{suppliers.length > 0 && portal}</div>
    <div className="live-fields erp-filters"><Field>{t('Yarn category', 'دھاگے کی قسم')}<select value={category} onChange={e => setCategory(e.target.value)}><option value="all">{t('All categories', 'تمام اقسام')}</option>{categories.map(c => <option value={c.id} key={c.id}>{title(c.id)}</option>)}</select></Field><Field>{t('Search suppliers', 'سپلائر تلاش کریں')}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Company, contact, city', 'کمپنی، رابطہ، شہر')} /></Field></div>
    {!loading && !error && !suppliers.length && <EmptyState message={t('Share the registration portal link with your suppliers.', 'اپنے سپلائرز کو رجسٹریشن پورٹل کا لنک دیں۔')} emptyIso="people" action={portal} />}
    {suppliers.length > 0 && !matches.length && <p className="live-muted">{t('No supplier matches this search.', 'اس تلاش سے کوئی سپلائر نہیں ملا۔')}</p>}
    <div className="erp-records">{matches.map(s => <article className="erp-record" key={s.id}><div className="erp-record-head"><div className="pb-record-title"><span className="pb-chip-icon"><Building2 aria-hidden="true" /></span><div><h3>{s.name}</h3><p>{s.contact_name}{s.city ? ' · ' + s.city : ''}</p></div></div><span className={`erp-status is-${s.status}`}>{t({pending:'Pending',approved:'Approved',rejected:'Rejected',suspended:'Suspended'}[s.status] ?? s.status, {pending:'زیرِ التوا',approved:'منظور',rejected:'مسترد',suspended:'معطل'}[s.status])}</span></div><p className="live-muted">{s.categories.map(title).join(' · ')}</p><StarSummary rating={s.rating} /><div className="live-actions"><a className="button" href={`tel:${s.phone}`}><Phone size={18} />{t('Call', 'کال کریں')} <bdi>{s.phone}</bdi></a><a className="button" href={`mailto:${encodeURIComponent(s.email)}`}><Mail size={18} />{s.email}</a>{s.website && <a className="button" href={s.website} target="_blank" rel="noreferrer">{t('Website', 'ویب سائٹ')}<ExternalLink size={16} /></a>}</div>{s.source_url && <p className="live-muted"><a href={s.source_url} target="_blank" rel="noreferrer">{t('Published contact source', 'شائع شدہ رابطے کا ذریعہ')}</a>{s.source_checked_at ? ' · ' + factoryTime(s.source_checked_at) : ''}</p>}
     {member.admin && s.status === 'rejected' && (open === 'reopen:' + s.id ? <ReinstateSupplier supplier={s} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('reopen:' + s.id)}>{t('Reopen supplier', 'سپلائر دوبارہ کھولیں')}</button>)}
     {(member.role === 'purchase_manager' || member.admin) && s.status === 'approved' && (open === 'rate:' + s.id ? <RateSupplier member={member} supplier={s} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('rate:' + s.id)}><Star size={18} />{t('Rate supplier', 'سپلائر کی ریٹنگ دیں')}</button>)}
     {(member.role === 'purchase_manager' || member.admin) && SUPPLIER_MOVES[s.status].length > 0 && (open === 'review:' + s.id ? <SupplierReview supplier={s} admin={member.admin} categories={categories} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('review:' + s.id)}><ShieldCheck size={18} />{t('Review supplier access', 'سپلائر رسائی کا جائزہ لیں')}</button>)}
     {(member.role === 'purchase_manager' || member.admin) && (open === 'profile:' + s.id ? <SupplierProfileForm member={member} supplier={s} categories={categories} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('profile:' + s.id)}><Pencil size={18} />{t('Edit profile', 'پروفائل میں ترمیم')}</button>)}
     <button className="button" aria-expanded={open === 'detail:' + s.id} onClick={() => setOpen(open === 'detail:' + s.id ? '' : 'detail:' + s.id)}><ClipboardList size={18} />{t('Supplier details', 'سپلائر کی تفصیلات')}</button>
     {open === 'detail:' + s.id && <SupplierDetails member={member} supplierId={s.id} />}
    </article>)}</div>
   </section>
  </>}
  {view === 'tracking' && buyingAllowed && <ShipmentTracking member={member} />}
  {view === 'incoming' && !buyingAllowed && <IncomingStock member={member} onInventoryChanged={onInventoryChanged} />}
 </div>;
}
// Mirrors the server: pending→approved|rejected, approved↔suspended; rejected is final.
const SUPPLIER_MOVES: Record<string, string[]> = { pending: ['approved', 'rejected'], approved: ['suspended'], suspended: ['approved'], rejected: [] };
function SupplierReview({ supplier, admin, categories, onSaved, onCancel }: { supplier: Supplier; admin: boolean; categories: SupplierCategory[]; onSaved: () => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const moves = SUPPLIER_MOVES[supplier.status]; const [status, setStatus] = useState(moves[0]), [reason, setReason] = useState(''), [intervention, setIntervention] = useState(''), [selected, setSelected] = useState(supplier.categories);
 return <AsyncForm title={t('Review supplier access', 'سپلائر رسائی کا جائزہ لیں')} detail={supplier.name} submit={t('Save decision', 'فیصلہ محفوظ کریں')} onCancel={onCancel} note={t('Access changes end existing supplier sessions. Past bids and dispatches stay in the audit history.', 'رسائی کی تبدیلی سے موجودہ سپلائر سیشن ختم ہو جائیں گے۔ پرانی بولیاں اور روانگی ہسٹری میں رہیں گی۔')} onSubmit={async () => { await api('/erp/suppliers/review', { id: supplier.id, version: supplier.version, status, reason, categories: selected, ...(admin ? { interventionReason: intervention } : {}) }); await onSaved(); }}>
  <Field>{t('Decision', 'فیصلہ')}<select value={status} onChange={e => setStatus(e.target.value)}>{moves.map(m => <option value={m} key={m}>{m === 'approved' ? t('Approve access', 'رسائی منظور کریں') : m === 'rejected' ? t('Reject registration', 'رجسٹریشن مسترد کریں') : t('Suspend access', 'رسائی معطل کریں')}</option>)}</select></Field><CategoryPicker categories={categories} value={selected} onChange={setSelected} /><Field>{status === 'approved' ? t('Verification details (optional)', 'تصدیق کی تفصیلات (اختیاری)') : t('Verification details / reason', 'تصدیق کی تفصیلات / وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={1000} required={status !== 'approved'} /></Field>{admin && <Field>{t('Why you are acting for this role', 'آپ اس کردار کی جگہ کیوں کام کر رہے ہیں')}<textarea value={intervention} onChange={e => setIntervention(e.target.value)} minLength={5} maxLength={1000} required /></Field>}{status === 'approved' && <label className="erp-confirm"><input type="checkbox" required />{t('I verified the company, contact and selected yarn categories.', 'میں نے کمپنی، رابطے اور منتخب اقسام کی تصدیق کی ہے۔')}</label>}
 </AsyncForm>;
}
// Half-star precision: the number shows one decimal, the stars round to the nearest half.
export function StarMeter({ value, label }: { value: number; label: string }) {
 const half = Math.round(value * 2) / 2;
 return <span className="erp-stars" role="img" aria-label={label}>{[0, 1, 2, 3, 4].map(i => <span className="erp-star" key={i} aria-hidden="true"><Star size={18} /><span className="erp-star-fill" style={{ width: `${Math.min(1, Math.max(0, half - i)) * 100}%` }}><Star size={18} /></span></span>)}</span>;
}
export function StarSummary({ rating }: { rating: SupplierRating | null }) {
 const { t } = useLanguage();
 if (!rating) return <p className="erp-rating live-muted">{t('No ratings yet', 'ابھی کوئی ریٹنگ نہیں')}</p>;
 const label = t(`${rating.average.toFixed(1)} out of 5 from ${rating.count} ratings`, `5 میں سے ${rating.average.toFixed(1)}، ${rating.count} ریٹنگز`);
 return <p className="erp-rating"><StarMeter value={rating.average} label={label} /><strong>{rating.average.toFixed(1)}</strong><span className="live-muted">({rating.count})</span></p>;
}
const CRITERIA = [
 { key: 'delivery', en: 'Delivery (on time, as promised)', ur: 'ترسیل (وقت پر، وعدے کے مطابق)' },
 { key: 'quality', en: 'Product quality', ur: 'مصنوعات کا معیار' },
 { key: 'terms', en: 'Following agreed terms', ur: 'طے شدہ شرائط کی پابندی' },
] as const;
type Criterion = typeof CRITERIA[number]['key'];
function RateSupplier({ member, supplier, onSaved, onCancel }: { member: Member; supplier: Supplier; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
 const [scores, setScores] = useState<Record<Criterion, number>>({ delivery: 0, quality: 0, terms: 0 }), [hover, setHover] = useState<Partial<Record<Criterion, number>>>({});
 const [comment, setComment] = useState(''), [intervention, setIntervention] = useState('');
 return <AsyncForm title={t('Rate supplier', 'سپلائر کی ریٹنگ دیں')} detail={supplier.name} submit={t('Save rating', 'ریٹنگ محفوظ کریں')} onCancel={onCancel} note={t('Ratings stay in the supplier history and cannot be edited afterwards.', 'ریٹنگ سپلائر کی تاریخ میں محفوظ رہے گی اور بعد میں بدلی نہیں جا سکتی۔')} onSubmit={async () => {
  if (CRITERIA.some(c => !scores[c.key])) throw new Error(t('Rate delivery, quality and terms before saving.', 'محفوظ کرنے سے پہلے ڈیلیوری، معیار اور شرائط کی ریٹنگ دیں۔'));
  await api('/erp/suppliers/ratings', { id, supplierId: supplier.id, ...scores, comment, ...(intervention ? { interventionReason: intervention } : {}) });
  await onSaved(t('Rating saved.', 'ریٹنگ محفوظ ہو گئی۔'));
 }}>
  {CRITERIA.map(c => { const shown = hover[c.key] ?? scores[c.key]; return <fieldset className="erp-rating-row" key={c.key} onPointerLeave={() => setHover(h => ({ ...h, [c.key]: undefined }))}>
   <legend>{t(c.en, c.ur)}</legend>
   <div className="erp-rating-stars">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} className={`erp-star-button${n <= shown ? ' is-on' : ''}`} aria-label={t(`${n} of 5 stars`, `5 میں سے ${n} ستارے`)} aria-pressed={scores[c.key] === n} onPointerEnter={() => setHover(h => ({ ...h, [c.key]: n }))} onClick={() => setScores(s => ({ ...s, [c.key]: n }))}><Star size={28} /></button>)}</div>
  </fieldset>; })}
  <Field>{t('Comment (optional)', 'تبصرہ (اختیاری)')}<textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={500} /></Field>
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
function SupplierProfileForm({ member, supplier, categories, onSaved, onCancel }: { member: Member; supplier: Supplier; categories: SupplierCategory[]; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [contactName, setContactName] = useState(supplier.contact_name), [phone, setPhone] = useState(supplier.phone), [city, setCity] = useState(supplier.city), [website, setWebsite] = useState(supplier.website), [selected, setSelected] = useState(supplier.categories), [intervention, setIntervention] = useState('');
 return <AsyncForm title={t('Edit supplier profile', 'سپلائر پروفائل میں ترمیم')} detail={supplier.name} submit={t('Save profile', 'پروفائل محفوظ کریں')} onCancel={onCancel} note={t('Changing the profile does not change the supplier’s access.', 'پروفائل بدلنے سے سپلائر کی رسائی نہیں بدلتی۔')} onSubmit={async () => { await api('/erp/suppliers/profile', { id: supplier.id, version: supplier.version, contactName, phone, city, website, categories: selected, ...(intervention ? { interventionReason: intervention } : {}) }); await onSaved(t('Profile saved.', 'پروفائل محفوظ ہو گیا۔')); }}>
  <Field>{t('Contact name', 'رابطہ کار')}<input value={contactName} onChange={e => setContactName(e.target.value)} minLength={2} maxLength={80} required /></Field>
  <Field>{t('Phone (with country code)', 'فون (ملک کے کوڈ کے ساتھ)')}<input dir="ltr" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} required /></Field>
  <Field>{t('City', 'شہر')}<input value={city} onChange={e => setCity(e.target.value)} maxLength={100} /></Field>
  <Field>{t('Website', 'ویب سائٹ')}<input dir="ltr" type="url" value={website} onChange={e => setWebsite(e.target.value)} maxLength={500} /></Field>
  <CategoryPicker categories={categories} value={selected} onChange={setSelected} />
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
interface SupplierDetail {
 ratings: { id: string; rating: number; delivery: number | null; quality: number | null; terms: number | null; feedback: string; created_by_name: string | null; created_at: number; void_reason: string | null; voided_at: number | null }[];
 performance: { qcPassRate: number | null; onTimeRate: number | null; claims: { return: number; replacement: number; claim: number } };
}
function SupplierDetails({ member, supplierId }: { member: Member; supplierId: string }) {
 const { t } = useLanguage(); const [detail, setDetail] = useState<SupplierDetail | null>(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
 useEffect(() => { let alive = true; api<SupplierDetail>('/erp/suppliers/' + supplierId).then(d => { if (alive) setDetail(d); }).catch(e => { if (alive) setError(errorMessage(e)); }); return () => { alive = false; }; }, [supplierId, version]);
 if (error) return <p className="live-error" role="alert">{t(error)}</p>;
 if (!detail) return <p className="live-muted" role="status">{t('Loading supplier details…', 'سپلائر کی تفصیلات لوڈ ہو رہی ہیں…')}</p>;
 const pct = (value: number | null) => value === null ? t('No data yet', 'ابھی ڈیٹا نہیں') : `${Math.round(value * 100)}%`, p = detail.performance;
 return <div className="erp-bid">
  <h4>{t('Performance', 'کارکردگی')}</h4>
  <dl className="erp-facts"><div><dt>{t('QC pass rate', 'QC پاس ریٹ')}</dt><dd>{pct(p.qcPassRate)}</dd></div><div><dt>{t('On-time arrivals', 'وقت پر پہنچنے کی شرح')}</dt><dd>{pct(p.onTimeRate)}</dd></div><div><dt>{t('Returns / replacements / claims', 'واپسی / متبادل / دعوے')}</dt><dd>{p.claims.return} / {p.claims.replacement} / {p.claims.claim}</dd></div></dl>
  <h4>{t('Ratings and feedback', 'ریٹنگز اور رائے')}</h4>
  {!detail.ratings.length && <p className="live-muted">{t('No ratings yet', 'ابھی کوئی ریٹنگ نہیں')}</p>}
  <ul>{detail.ratings.map((r, i) => <li key={i}><span style={r.void_reason ? { textDecoration: 'line-through' } : undefined}><strong>{r.rating}/5</strong> · {factoryTime(r.created_at)}{r.created_by_name ? ' · ' + r.created_by_name : ''}{r.delivery !== null && <span className="live-muted"> · {t('Delivery', 'ترسیل')} {r.delivery} · {t('Quality', 'معیار')} {r.quality} · {t('Terms', 'شرائط')} {r.terms}</span>}{r.feedback && <span className="erp-multiline">{r.feedback}</span>}</span>{r.void_reason ? <span className="live-muted"> · {t('Voided', 'منسوخ')}: {r.void_reason}</span> : (member.role === 'purchase_manager' || member.admin) && <Correction member={member} label={t('Void this rating', 'یہ ریٹنگ منسوخ کریں')} title={t('Void this rating', 'یہ ریٹنگ منسوخ کریں')} effect={t('The rating stays on record struck through and no longer counts in the supplier average.', 'ریٹنگ ریکارڈ میں کٹی ہوئی رہے گی اور سپلائر کی اوسط میں شامل نہیں ہوگی۔')} submit={t('Void rating', 'ریٹنگ منسوخ کریں')} owners={['purchase_manager']} path="/erp/suppliers/ratings/void" payload={() => ({ ratingId: r.id })} onSaved={async () => setVersion(v => v + 1)} />}</li>)}</ul>
 </div>;
}
function ReinstateSupplier({ supplier, onSaved, onCancel }: { supplier: Supplier; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [reason, setReason] = useState('');
 return <AsyncForm title={t('Reopen this supplier', 'یہ سپلائر دوبارہ کھولیں')} detail={supplier.name} submit={t('Move back to pending', 'زیر التواء میں واپس لائیں')} onCancel={onCancel} note={t('Back to pending, then approve again before it can bid. Only an admin can do this.', 'زیر التواء میں واپس، پھر بولی سے پہلے دوبارہ منظور کریں۔ یہ صرف ایڈمن کر سکتا ہے۔')}
  onSubmit={async () => { await api('/erp/suppliers/review', { id: supplier.id, status: 'pending', version: supplier.version, reason }); await onSaved(t('Supplier moved back to pending.', 'سپلائر زیر التواء میں واپس ہو گیا۔')); }}>
  <Field>{t('Reason', 'وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={1000} required /></Field>
 </AsyncForm>;
}
function RfqForm({ member, categories, onSaved, onCancel }: { member: Member; categories: SupplierCategory[]; onSaved: (id: string) => Promise<void>; onCancel: () => void }) {
 const { language, t } = useLanguage(); const [id] = useState(crypto.randomUUID()); const [title, setTitle] = useState(''), [categoryId, setCategory] = useState(categories[0]?.id || ''), [specifications, setSpecifications] = useState(''), [qty, setQty] = useState(''), [unit, setUnit] = useState('kg'), [deliveryLocation, setLocation] = useState(''), [intervention, setIntervention] = useState('');
 const [deadline, setDeadline] = useState(localFactoryInput(Date.now() + 2 * 86400000)), [delivery, setDelivery] = useState(localFactoryInput(Date.now() + 14 * 86400000));
 return <AsyncForm title={t('New price request', 'نئی قیمت کی درخواست')} submit={t('Save draft price request', 'قیمت کی درخواست کا مسودہ محفوظ کریں')} onCancel={onCancel} note={t('Saving a draft does not send it. Publish after reviewing the requirements.', 'مسودہ محفوظ کرنے سے نہیں بھیجا جائے گا۔ ضروریات کا جائزہ لے کر شائع کریں۔')} onSubmit={async () => { await api('/erp/rfqs', { id, title, categoryId, specifications, quantityMilli: fixedInput(qty, 3, 'Quantity'), unit, deliveryLocation, deadlineAt: factoryInput(deadline), requestedDeliveryAt: factoryInput(delivery), ...(intervention ? { interventionReason: intervention } : {}) }); await onSaved(id); }}>
  <Field>{t('Price request title', 'قیمت کی درخواست کا عنوان')}<input value={title} onChange={e => setTitle(e.target.value)} minLength={3} maxLength={120} required /></Field><Field>{t('Yarn category', 'دھاگے کی قسم')}<select value={categoryId} onChange={e => setCategory(e.target.value)} required>{categories.map(c => <option value={c.id} key={c.id}>{language === 'ur' ? c.urdu_name : c.name}</option>)}</select></Field><Field>{t('Specifications (count, composition, quality)', 'تفصیلات (کاؤنٹ، مرکب، معیار)')}<textarea value={specifications} onChange={e => setSpecifications(e.target.value)} minLength={5} maxLength={4000} required /></Field><div className="live-fields"><Field>{t('Required quantity', 'مطلوبہ مقدار')}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required /></Field><Field>{t('Unit', 'اکائی')}<select value={unit} onChange={e => setUnit(e.target.value)}><option value="kg">kg</option><option value="tonne">tonne</option></select></Field></div><Field>{t('Delivery location', 'ترسیل کی جگہ')}<input value={deliveryLocation} onChange={e => setLocation(e.target.value)} minLength={3} maxLength={200} required /></Field><div className="live-fields"><Field>{t('Bid deadline (PKT)', 'بولی کی آخری تاریخ (پاکستان)')}<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} required /></Field><Field>{t('Requested delivery (PKT)', 'مطلوبہ ترسیل (پاکستان)')}<input type="datetime-local" value={delivery} onChange={e => setDelivery(e.target.value)} required /></Field></div><InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
function BidDecision({ member, bid, rfq, accepting, onSaved, onCancel }: { member: Member; bid: SupplierBid; rfq: ProcurementRfq; accepting: boolean; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
 return <AsyncForm title={accepting ? t('Accept this supplier bid', 'اس سپلائر کی بولی منظور کریں') : t('Reject this bid', 'یہ بولی مسترد کریں')} detail={bid.supplier_name} submit={accepting ? t('Accept and create purchase order', 'منظور کریں اور خریداری آرڈر بنائیں') : t('Confirm rejection', 'مسترد کرنے کی تصدیق کریں')} onCancel={onCancel} note={accepting ? t('Only one bid can win this price request. The accepted rate, terms and delivery date are preserved.', 'اس درخواست میں صرف ایک بولی منظور ہو سکتی ہے۔ منظور شدہ قیمت، شرائط اور ترسیل کی تاریخ محفوظ رہیں گی۔') : undefined} onSubmit={async () => {
  const answer = await api<{ pendingApproval?: boolean }>(accepting ? '/erp/bids/award' : '/erp/bids/reject', { id: bid.id, version: bid.version, ...(accepting ? {} : { reason }), ...(intervention ? { interventionReason: intervention } : {}) });
  await onSaved(answer.pendingApproval ? t('Sent to the admin for approval. The purchase order is created once approved.', 'منظوری کے لیے ایڈمن کو بھیج دیا گیا۔ منظوری کے بعد خریداری آرڈر بنے گا۔') : undefined); }}>
  <BidTerms bid={bid} unit={rfq.unit} />{accepting ? <label className="erp-confirm"><input type="checkbox" required />{t('I accept this bid revision and its commercial terms.', 'میں اس بولی کی ترمیم اور تجارتی شرائط قبول کرتا ہوں۔')}</label> : <Field>{t('Rejection reason', 'مسترد کرنے کی وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={1000} required /></Field>}
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
// Publish, close and cancel are one small form each, so every purchasing write asks admins for the intervention reason.
function RfqStep({ member, kind, rfq, onSaved }: { member: Member; kind: 'publish' | 'close' | 'cancel'; rfq: ProcurementRfq; onSaved: () => Promise<void> }) {
 const { t } = useLanguage(); const [shown, setShown] = useState(kind === 'publish'), [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
 if (!shown) return <button className="button" onClick={() => setShown(true)}>{kind === 'close' ? <Lock size={18} aria-hidden /> : <Ban size={18} aria-hidden />}{kind === 'close' ? t('Close bidding', 'بولی بند کریں') : t('Cancel price request', 'قیمت کی درخواست منسوخ کریں')}</button>;
 const titles = { publish: t('Publish to supplier portals', 'سپلائر پورٹلز پر شائع کریں'), close: t('Close bidding now', 'بولی ابھی بند کریں'), cancel: t('Cancel this price request', 'یہ قیمت کی درخواست منسوخ کریں') };
 const submits = { publish: t('Publish price request', 'قیمت کی درخواست شائع کریں'), close: t('Close bidding', 'بولی بند کریں'), cancel: t('Confirm cancellation', 'منسوخی کی تصدیق کریں') };
 return <AsyncForm title={titles[kind]} detail={kind === 'publish' ? t('This sends the price request to every currently approved supplier in this category. Published requirements cannot be edited.', 'یہ درخواست اس قسم کے ہر موجودہ منظور شدہ سپلائر کو ملے گی۔ شائع شدہ ضروریات تبدیل نہیں ہو سکتیں۔') : undefined} submit={submits[kind]} onCancel={kind === 'publish' ? undefined : () => setShown(false)}
  note={kind === 'publish' ? t('Delivered to supplier portal inboxes. Email notifications are not configured.', 'سپلائر پورٹل ان باکس میں پہنچایا جائے گا۔ ای میل اطلاعات ابھی ترتیب نہیں دی گئیں۔') : undefined}
  onSubmit={async () => { await api('/erp/rfqs/' + kind, { id: rfq.id, ...(kind === 'cancel' ? { reason } : {}), ...(intervention ? { interventionReason: intervention } : {}) }); await onSaved(); }}>
  {kind === 'publish' && <label className="erp-confirm"><input type="checkbox" required />{t('I checked the specifications, quantity and deadline.', 'میں نے تفصیلات، مقدار اور آخری تاریخ جانچ لی ہے۔')}</label>}
  {kind === 'cancel' && <Field>{t('Cancellation reason', 'منسوخی کی وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={1000} required /></Field>}
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
function QuantityForm({ member, order, onSaved, onCancel }: { member: Member; order: PurchaseOrder; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [qty, setQty] = useState(String(order.quantity_milli / 1000)), [intervention, setIntervention] = useState('');
 return <AsyncForm title={t('Change order quantity', 'آرڈر کی مقدار تبدیل کریں')} detail={order.reference} submit={t('Save quantity', 'مقدار محفوظ کریں')} onCancel={onCancel} note={t('A large order waits for admin approval before the quantity changes.', 'بڑے آرڈر کی مقدار تبدیل ہونے سے پہلے ایڈمن کی منظوری درکار ہے۔')}
  onSubmit={async () => { const answer = await api<{ pendingApproval?: boolean }>('/erp/orders/quantity', { id: order.id, version: order.version, quantityMilli: fixedInput(qty, 3, 'Quantity'), ...(intervention ? { interventionReason: intervention } : {}) });
   await onSaved(answer.pendingApproval ? t('Sent to the admin for approval. The quantity changes once approved.', 'منظوری کے لیے ایڈمن کو بھیج دیا گیا۔ منظوری کے بعد مقدار تبدیل ہو گی۔') : undefined); }}>
  <Field>{t('New quantity', 'نئی مقدار')}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required /></Field>
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}

function BillOfLadingForm({ member, order, onSaved, onCancel }: { member: Member; order: PurchaseOrder; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [id] = useState(crypto.randomUUID()), [billOfLading, setBillOfLading] = useState(''), [intervention, setIntervention] = useState('');
 return <AsyncForm title={t('Attach bill of lading', 'بل آف لیڈنگ لگائیں')} detail={order.reference} submit={t('Save bill of lading', 'بل آف لیڈنگ محفوظ کریں')} onCancel={onCancel} note={t('Attach the shipment before registering its arrival for inspection.', 'معائنے کے لیے آمد درج کرنے سے پہلے مال کا بل آف لیڈنگ لگائیں۔')}
  onSubmit={async () => { await api('/erp/shipments', { id, orderId: order.id, billOfLading, ...(intervention ? { interventionReason: intervention } : {}) }); await onSaved(t('Bill of lading attached.', 'بل آف لیڈنگ لگا دیا گیا۔')); }}>
  <Field>{t('Bill of lading number', 'بل آف لیڈنگ نمبر')}<input value={billOfLading} onChange={e => setBillOfLading(e.target.value)} minLength={3} maxLength={100} required /></Field>
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
