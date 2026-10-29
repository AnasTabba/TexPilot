import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Mail, Phone, Plus, RefreshCw, Ship, ShieldCheck, Star, Truck } from 'lucide-react';
import { inventoryRequest as api, can, type Member } from './inventory-client';
import { AsyncForm, Field, errorMessage } from './forms';
import { InterventionField } from './PortalCommon';
import { useLanguage } from './i18n';
import { BidTerms, CategoryPicker, RfqSummary } from './ErpCommon';
import { PurchaseOrders } from './PurchaseOrders';
import { type SupplierCategory, type Supplier, type SupplierRating, type ProcurementState, type ProcurementRfq, type SupplierBid, type PendingPurchasing, type PurchaseOrder, rate, factoryTime, quantity, factoryInput, localFactoryInput, fixedInput } from './erp-client';
import './erp.css';
import IncomingStock from './IncomingStock';
import { ShipmentTracking } from './ShipmentTracking';

export default function Procurement({ member, onInventoryChanged }: { member: Member; onInventoryChanged: () => Promise<void> }) {
 const { language, t } = useLanguage(); const directoryAllowed = can(member, 'suppliers'), buyingAllowed = can(member, 'procure');
 const [view, setView] = useState(() => buyingAllowed && (location.hash.split('/')[2] === 'tracking' || location.hash.startsWith('#/tracking')) ? 'tracking' : directoryAllowed ? 'suppliers' : buyingAllowed ? 'rfqs' : 'incoming'), [category, setCategory] = useState('all'), [search, setSearch] = useState('');
 const [suppliers, setSuppliers] = useState<Supplier[]>([]), [categories, setCategories] = useState<SupplierCategory[]>([]), [state, setState] = useState<ProcurementState>({ rfqs: [], bids: [], orders: [], shipments: [] });
 const [pending, setPending] = useState<PendingPurchasing>({ awards: [], changes: [] }), [loading, setLoading] = useState(true), [error, setError] = useState(''), [open, setOpen] = useState(''), [notice, setNotice] = useState('');
 const load = useCallback(async () => {
  try {
   const [cat, list, procurement, waiting] = await Promise.all([api<{ categories: SupplierCategory[] }>('/erp/categories'), directoryAllowed ? api<{ suppliers: Supplier[] }>('/erp/suppliers') : Promise.resolve({ suppliers: [] }), buyingAllowed ? api<ProcurementState>('/erp/procurement') : Promise.resolve({ rfqs: [], bids: [], orders: [], shipments: [] }), buyingAllowed ? api<PendingPurchasing>('/erp/orders/pending-approvals') : Promise.resolve({ awards: [], changes: [] })]);
   setPending(waiting); setCategories(cat.categories); setSuppliers(list.suppliers); setState(procurement); setError('');
  } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
 }, [directoryAllowed, buyingAllowed]);
 useEffect(() => { void load(); }, [load]);
 const saved = async (message?: string) => { setOpen(''); setNotice(message ?? t('Saved.', 'محفوظ ہو گیا۔')); await load(); };

 const title = (id: string) => { const c = categories.find(c => c.id === id); return c ? language === 'ur' ? c.urdu_name : c.name : id; };
 return <div className="erp-workspace">
  <div className="erp-toolbar"><div className="live-segments" aria-label={t('Procurement views', 'خریداری کے حصے')}>{directoryAllowed && <button aria-pressed={view === 'suppliers'} onClick={() => { setView('suppliers'); setOpen(''); }}>{t('Suppliers', 'سپلائرز')}</button>}{buyingAllowed && <><button aria-pressed={view === 'rfqs'} onClick={() => { setView('rfqs'); setOpen(''); }}>{t('RFQs and bids', 'درخواستیں اور بولیاں')}</button><button aria-pressed={view === 'orders'} onClick={() => { setView('orders'); setOpen(''); }}>{t('Purchase orders', 'خریداری کے آرڈر')}</button><button aria-pressed={view === 'tracking'} onClick={() => { setView('tracking'); setOpen(''); }}><Ship size={18} />{t('Tracking', 'ٹریکنگ')}</button></>}</div><button className="button" onClick={() => void load()}><RefreshCw size={18} />{t('Refresh', 'تازہ کریں')}</button></div>
  {error && <p className="live-error" role="alert">{t(error)}</p>}{notice && <p className="live-success" role="status">{notice}</p>}{loading && <p role="status">{t('Loading procurement…', 'خریداری کی تفصیلات لوڈ ہو رہی ہیں…')}</p>}
  {(can(member,'receive')||buyingAllowed)&&<button className="button" aria-pressed={view==='incoming'} onClick={()=>{setView('incoming');setOpen('');}}><Truck size={18}/>{t('Incoming stock','آنے والا اسٹاک')}</button>}
  {view==='incoming'&&<IncomingStock member={member} onInventoryChanged={onInventoryChanged}/>}
  {view === 'suppliers' && directoryAllowed && <>
   <section className="live-panel"><div className="yf-head"><div><h2>{t('Supplier directory', 'سپلائر ڈائریکٹری')}</h2><p>{t('Registered suppliers by yarn category. The purchase manager approves them before they can bid.', 'دھاگے کی اقسام کے مطابق رجسٹرڈ سپلائرز۔ بولی سے پہلے خریداری مینیجر انہیں منظور کرتا ہے۔')}</p></div></div>
    <a className="button" href="#/supplier" target="_blank" rel="noreferrer"><ExternalLink size={18} />{t('Open supplier registration portal', 'سپلائر رجسٹریشن پورٹل کھولیں')}</a>
    <div className="live-fields erp-filters"><Field>{t('Yarn category', 'دھاگے کی قسم')}<select value={category} onChange={e => setCategory(e.target.value)}><option value="all">{t('All categories', 'تمام اقسام')}</option>{categories.map(c => <option value={c.id} key={c.id}>{title(c.id)}</option>)}</select></Field><Field>{t('Search suppliers', 'سپلائر تلاش کریں')}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Company, contact, city', 'کمپنی، رابطہ، شہر')} /></Field></div>
    {!loading && !suppliers.length && <p className="live-muted">{t('Share the registration portal link with your suppliers.', 'اپنے سپلائرز کو رجسٹریشن پورٹل کا لنک دیں۔')}</p>}
    <div className="erp-records">{suppliers.filter(s => (category === 'all' || s.categories.includes(category)) && [s.name, s.contact_name, s.city, s.email].join(' ').toLowerCase().includes(search.toLowerCase())).map(s => <article className="erp-record" key={s.id}><div className="erp-record-head"><div><h3>{s.name}</h3><p>{s.contact_name}{s.city ? ' · ' + s.city : ''}</p></div><span className={`erp-status is-${s.status}`}>{t(s.status, {pending:'زیرِ التوا',approved:'منظور',rejected:'مسترد',suspended:'معطل'}[s.status])}</span></div><p className="live-muted">{s.categories.map(title).join(' · ')}</p><StarSummary rating={s.rating} /><div className="live-actions"><a className="button" href={`tel:${s.phone}`}><Phone size={18} />{t('Call', 'کال کریں')} <bdi>{s.phone}</bdi></a><a className="button" href={`mailto:${encodeURIComponent(s.email)}`}><Mail size={18} />{s.email}</a>{s.website && <a className="button" href={s.website} target="_blank" rel="noreferrer">{t('Website', 'ویب سائٹ')}<ExternalLink size={16} /></a>}</div>{s.source_url && <p className="live-muted"><a href={s.source_url} target="_blank" rel="noreferrer">{t('Published contact source', 'شائع شدہ رابطے کا ذریعہ')}</a>{s.source_checked_at ? ' · ' + factoryTime(s.source_checked_at) : ''}</p>}
     {(member.role === 'purchase_manager' || member.admin) && s.status === 'approved' && (open === 'rate:' + s.id ? <RateSupplier member={member} supplier={s} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('rate:' + s.id)}><Star size={18} />{t('Rate supplier', 'سپلائر کی ریٹنگ دیں')}</button>)}
     {(member.role === 'purchase_manager' || member.admin) && SUPPLIER_MOVES[s.status].length > 0 && (open === 'review:' + s.id ? <SupplierReview supplier={s} admin={member.admin} categories={categories} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('review:' + s.id)}><ShieldCheck size={18} />{t('Review supplier access', 'سپلائر رسائی کا جائزہ لیں')}</button>)}
    </article>)}</div>
   </section>
  </>}
  {view === 'rfqs' && buyingAllowed && <section className="live-panel"><div className="yf-head"><div><h2>{t('RFQs and supplier bids', 'قیمت کی درخواستیں اور سپلائر بولیاں')}</h2><p>{t('Publish one request to approved suppliers in the selected category.', 'منتخب قسم کے منظور شدہ سپلائرز کو ایک درخواست بھیجیں۔')}</p></div><button className="button primary" onClick={() => setOpen('rfq:new')}><Plus size={18} />{t('New RFQ', 'نئی درخواست')}</button></div>
   {open === 'rfq:new' && <RfqForm member={member} categories={categories} onSaved={saved} onCancel={() => setOpen('')} />}
   {!state.rfqs.length && !loading && <p className="live-muted">{t('Create the first procurement request.', 'پہلی خریداری کی درخواست بنائیں۔')}</p>}
   <div className="erp-records">{state.rfqs.map(r => <article className="erp-record" key={r.id}><div className="erp-record-head"><strong>{title(r.category_id)}</strong><span className="erp-status">{t(r.status, {draft:'مسودہ',open:'کھلا',awarded:'منظور شدہ',closed:'بند',cancelled:'منسوخ'}[r.status])}</span></div><RfqSummary rfq={r} /><p className="live-muted">{r.recipient_count || 0} {t('supplier portal recipients', 'سپلائر پورٹل وصول کنندگان')} · {r.bid_count || 0} {t('bids', 'بولیاں')}</p>
    {r.status === 'draft' && <RfqStep member={member} kind="publish" rfq={r} onSaved={saved} />}
    {r.status === 'open' && <RfqStep member={member} kind="close" rfq={r} onSaved={saved} />}
    {['draft', 'open', 'closed'].includes(r.status) && <RfqStep member={member} kind="cancel" rfq={r} onSaved={saved} />}
    {state.bids.filter(b => b.rfq_id === r.id).map(b => <div className="erp-bid" key={b.id}><h4>{b.supplier_name} · {t('Revision', 'ترمیم')} {b.version}</h4><BidTerms bid={b} unit={r.unit} />{b.status === 'rejected' && <p className="live-warning">{t('Rejected:', 'مسترد:')} {b.rejection_reason}</p>}{r.status === 'cancelled' || r.status === 'awarded' || r.status === 'draft' || b.status !== 'submitted' ? null : pending.awards.some(a => a.bidId === b.id) ? <p className="live-warning">{t('Waiting for admin approval. The purchase order is created once approved.', 'ایڈمن کی منظوری کا انتظار ہے۔ منظوری کے بعد خریداری آرڈر بنے گا۔')}</p> : (open === 'award:' + b.id || open === 'reject:' + b.id ? <BidDecision member={member} bid={b} rfq={r} accepting={open.startsWith('award:')} onSaved={saved} onCancel={() => setOpen('')} /> : <div className="live-actions"><button className="button primary" onClick={() => setOpen('award:' + b.id)}>{t('Review and accept bid', 'بولی کا جائزہ اور منظوری')}</button><button className="button" onClick={() => setOpen('reject:' + b.id)}>{t('Reject bid', 'بولی مسترد کریں')}</button></div>)}</div>)}
   </article>)}</div>
  </section>}
  {view === 'tracking' && buyingAllowed && <ShipmentTracking member={member} />}
  {view === 'orders' && buyingAllowed && <section className="live-panel"><h2>{t('Purchase orders and inbound shipments', 'خریداری کے آرڈر اور آنے والی کھیپ')}</h2>{!state.orders.length && <p className="live-muted">{t('Accept a supplier bid to create a purchase order.', 'خریداری کا آرڈر بنانے کے لیے سپلائر کی بولی منظور کریں۔')}</p>}
   <PurchaseOrders orders={state.orders} shipments={state.shipments}
    renderDetail={o => <><BidTerms bid={o.terms} unit={o.terms.unit} />{o.approval_status === 'pending_admin' && <p className="live-warning">{t('Quantity change waiting for admin approval', 'مقدار کی تبدیلی ایڈمن کی منظوری کی منتظر ہے')}</p>}</>}
    renderActions={o => <div className="live-actions">{o.approval_status === 'approved' && o.status !== 'cancelled' && (open === 'qty:' + o.id ? <QuantityForm member={member} order={o} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('qty:' + o.id)}>{t('Change quantity', 'مقدار تبدیل کریں')}</button>)}{o.approval_status === 'approved' && ['accepted', 'dispatched'].includes(o.status) && (member.role === 'purchase_manager' || member.admin) && (open === 'bl:' + o.id ? <BillOfLadingForm member={member} order={o} onSaved={saved} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('bl:' + o.id)}><Truck size={18} />{t('Attach bill of lading')}</button>)}</div>} />
  </section>}
 </div>;
}
// Mirrors the server: pending→approved|rejected, approved↔suspended; rejected is final.
const SUPPLIER_MOVES: Record<string, string[]> = { pending: ['approved', 'rejected'], approved: ['suspended'], suspended: ['approved'], rejected: [] };
function SupplierReview({ supplier, admin, categories, onSaved, onCancel }: { supplier: Supplier; admin: boolean; categories: SupplierCategory[]; onSaved: () => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const moves = SUPPLIER_MOVES[supplier.status]; const [status, setStatus] = useState(moves[0]), [reason, setReason] = useState(''), [intervention, setIntervention] = useState(''), [selected, setSelected] = useState(supplier.categories);
 return <AsyncForm title={t('Review supplier access', 'سپلائر رسائی کا جائزہ لیں')} detail={supplier.name} submit={t('Save decision', 'فیصلہ محفوظ کریں')} onCancel={onCancel} note={t('Access changes end existing supplier sessions. Past bids and dispatches stay in the audit history.', 'رسائی کی تبدیلی سے موجودہ سپلائر سیشن ختم ہو جائیں گے۔ پرانی بولیاں اور روانگی ہسٹری میں رہیں گی۔')} onSubmit={async () => { await api('/erp/suppliers/review', { id: supplier.id, version: supplier.version, status, reason, categories: selected, ...(admin ? { interventionReason: intervention } : {}) }); await onSaved(); }}>
  <Field>{t('Decision', 'فیصلہ')}<select value={status} onChange={e => setStatus(e.target.value)}>{moves.map(m => <option value={m} key={m}>{m === 'approved' ? t('Approve access', 'رسائی منظور کریں') : m === 'rejected' ? t('Reject registration', 'رجسٹریشن مسترد کریں') : t('Suspend access', 'رسائی معطل کریں')}</option>)}</select></Field><CategoryPicker categories={categories} value={selected} onChange={setSelected} /><Field>{t('Verification details / reason', 'تصدیق کی تفصیلات / وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={1000} required /></Field>{admin && <Field>{t('Intervention reason', 'مداخلت کی وجہ')}<textarea value={intervention} onChange={e => setIntervention(e.target.value)} minLength={5} maxLength={1000} required /></Field>}{status === 'approved' && <label className="erp-confirm"><input type="checkbox" required />{t('I verified the company, contact and selected yarn categories.', 'میں نے کمپنی، رابطے اور منتخب اقسام کی تصدیق کی ہے۔')}</label>}
 </AsyncForm>;
}
// Half-star precision: the number shows one decimal, the stars round to the nearest half.
function StarMeter({ value, label }: { value: number; label: string }) {
 const half = Math.round(value * 2) / 2;
 return <span className="erp-stars" role="img" aria-label={label}>{[0, 1, 2, 3, 4].map(i => <span className="erp-star" key={i} aria-hidden="true"><Star size={18} /><span className="erp-star-fill" style={{ width: `${Math.min(1, Math.max(0, half - i)) * 100}%` }}><Star size={18} /></span></span>)}</span>;
}
function StarSummary({ rating }: { rating: SupplierRating | null }) {
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
  if (CRITERIA.some(c => !scores[c.key])) throw new Error('Rate delivery, quality and terms before saving.');
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
function RfqForm({ member, categories, onSaved, onCancel }: { member: Member; categories: SupplierCategory[]; onSaved: () => Promise<void>; onCancel: () => void }) {
 const { language, t } = useLanguage(); const [id] = useState(crypto.randomUUID()); const [title, setTitle] = useState(''), [categoryId, setCategory] = useState(categories[0]?.id || ''), [specifications, setSpecifications] = useState(''), [qty, setQty] = useState(''), [unit, setUnit] = useState('kg'), [deliveryLocation, setLocation] = useState(''), [intervention, setIntervention] = useState('');
 const [deadline, setDeadline] = useState(localFactoryInput(Date.now() + 2 * 86400000)), [delivery, setDelivery] = useState(localFactoryInput(Date.now() + 14 * 86400000));
 return <AsyncForm title={t('New procurement RFQ', 'نئی خریداری کی درخواست')} submit={t('Save draft RFQ', 'درخواست کا مسودہ محفوظ کریں')} onCancel={onCancel} note={t('Saving a draft does not send it. Publish after reviewing the requirements.', 'مسودہ محفوظ کرنے سے نہیں بھیجا جائے گا۔ ضروریات کا جائزہ لے کر شائع کریں۔')} onSubmit={async () => { await api('/erp/rfqs', { id, title, categoryId, specifications, quantityMilli: fixedInput(qty, 3, 'Quantity'), unit, deliveryLocation, deadlineAt: factoryInput(deadline), requestedDeliveryAt: factoryInput(delivery), ...(intervention ? { interventionReason: intervention } : {}) }); await onSaved(); }}>
  <Field>{t('RFQ title', 'درخواست کا عنوان')}<input value={title} onChange={e => setTitle(e.target.value)} minLength={3} maxLength={120} required /></Field><Field>{t('Yarn category', 'دھاگے کی قسم')}<select value={categoryId} onChange={e => setCategory(e.target.value)} required>{categories.map(c => <option value={c.id} key={c.id}>{language === 'ur' ? c.urdu_name : c.name}</option>)}</select></Field><Field>{t('Specifications (count, composition, quality)', 'تفصیلات (کاؤنٹ، مرکب، معیار)')}<textarea value={specifications} onChange={e => setSpecifications(e.target.value)} minLength={5} maxLength={4000} required /></Field><div className="live-fields"><Field>{t('Required quantity', 'مطلوبہ مقدار')}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required /></Field><Field>{t('Unit', 'اکائی')}<select value={unit} onChange={e => setUnit(e.target.value)}><option value="kg">kg</option><option value="tonne">tonne</option></select></Field></div><Field>{t('Delivery location', 'ترسیل کی جگہ')}<input value={deliveryLocation} onChange={e => setLocation(e.target.value)} minLength={3} maxLength={200} required /></Field><div className="live-fields"><Field>{t('Bid deadline (PKT)', 'بولی کی آخری تاریخ (پاکستان)')}<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} required /></Field><Field>{t('Requested delivery (PKT)', 'مطلوبہ ترسیل (پاکستان)')}<input type="datetime-local" value={delivery} onChange={e => setDelivery(e.target.value)} required /></Field></div><InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
function BidDecision({ member, bid, rfq, accepting, onSaved, onCancel }: { member: Member; bid: SupplierBid; rfq: ProcurementRfq; accepting: boolean; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
 const { t } = useLanguage(); const [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
 return <AsyncForm title={accepting ? t('Accept this supplier bid', 'اس سپلائر کی بولی منظور کریں') : t('Reject this bid', 'یہ بولی مسترد کریں')} detail={bid.supplier_name} submit={accepting ? t('Accept and create purchase order', 'منظور کریں اور خریداری آرڈر بنائیں') : t('Confirm rejection', 'مسترد کرنے کی تصدیق کریں')} onCancel={onCancel} note={accepting ? t('Only one bid can win this RFQ. The accepted rate, terms and delivery date are preserved.', 'اس درخواست میں صرف ایک بولی منظور ہو سکتی ہے۔ منظور شدہ قیمت، شرائط اور ترسیل کی تاریخ محفوظ رہیں گی۔') : undefined} onSubmit={async () => {
  const answer = await api<{ pendingApproval?: boolean }>(accepting ? '/erp/bids/award' : '/erp/bids/reject', { id: bid.id, version: bid.version, ...(accepting ? {} : { reason }), ...(intervention ? { interventionReason: intervention } : {}) });
  await onSaved(answer.pendingApproval ? t('Sent to the admin for approval. The purchase order is created once approved.', 'منظوری کے لیے ایڈمن کو بھیج دیا گیا۔ منظوری کے بعد خریداری آرڈر بنے گا۔') : undefined); }}>
  <BidTerms bid={bid} unit={rfq.unit} />{accepting ? <label className="erp-confirm"><input type="checkbox" required />{t('I accept this bid revision and its commercial terms.', 'میں اس بولی کی ترمیم اور تجارتی شرائط قبول کرتا ہوں۔')}</label> : <Field>{t('Rejection reason', 'مسترد کرنے کی وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={5} maxLength={1000} required /></Field>}
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
// Publish, close and cancel are one small form each, so every purchasing write asks admins for the intervention reason.
function RfqStep({ member, kind, rfq, onSaved }: { member: Member; kind: 'publish' | 'close' | 'cancel'; rfq: ProcurementRfq; onSaved: () => Promise<void> }) {
 const { t } = useLanguage(); const [shown, setShown] = useState(kind === 'publish'), [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
 if (!shown) return <button className="button" onClick={() => setShown(true)}>{kind === 'close' ? t('Close bidding', 'بولی بند کریں') : t('Cancel RFQ', 'درخواست منسوخ کریں')}</button>;
 const titles = { publish: t('Publish to supplier portals', 'سپلائر پورٹلز پر شائع کریں'), close: t('Close bidding now', 'بولی ابھی بند کریں'), cancel: t('Cancel this RFQ', 'یہ درخواست منسوخ کریں') };
 const submits = { publish: t('Publish RFQ', 'درخواست شائع کریں'), close: t('Close bidding', 'بولی بند کریں'), cancel: t('Confirm cancellation', 'منسوخی کی تصدیق کریں') };
 return <AsyncForm title={titles[kind]} detail={kind === 'publish' ? t('This sends the RFQ to every currently approved supplier in this category. Published requirements cannot be edited.', 'یہ درخواست اس قسم کے ہر موجودہ منظور شدہ سپلائر کو ملے گی۔ شائع شدہ ضروریات تبدیل نہیں ہو سکتیں۔') : undefined} submit={submits[kind]} onCancel={kind === 'publish' ? undefined : () => setShown(false)}
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
 return <AsyncForm title={t('Attach bill of lading')} detail={order.reference} submit={t('Save bill of lading')} onCancel={onCancel} note={t('Attach the shipment before registering its arrival for inspection.')}
  onSubmit={async () => { await api('/erp/shipments', { id, orderId: order.id, billOfLading, ...(intervention ? { interventionReason: intervention } : {}) }); await onSaved(t('Bill of lading attached.')); }}>
  <Field>{t('Bill of lading number')}<input value={billOfLading} onChange={e => setBillOfLading(e.target.value)} minLength={3} maxLength={100} required /></Field>
  <InterventionField member={member} owners={['purchase_manager']} value={intervention} onChange={setIntervention} />
 </AsyncForm>;
}
