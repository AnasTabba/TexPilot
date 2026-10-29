import { useCallback, useEffect, useState } from 'react';
import { Banknote, Download, ExternalLink, FileText, Plus, RefreshCw, Send, ShieldCheck, Truck, UserPlus } from 'lucide-react';
import { type Member } from './inventory-client';
import { AsyncForm, Field, errorMessage } from './forms';
import { useLanguage } from './i18n';
import { factoryInput, factoryTime, fixedInput, localFactoryInput, quantity, rate } from './erp-client';
import {
  buyerStatusName, canSell, canBill, canDispatchSales, dueLabel, factoryDateValue, invoiceDownloadHref, invoiceLines,
  localFactoryDateValue, orderStatusName, outboxStateName, outboxWhen, salesRequest, type Buyer, type Invoice,
  type SalesOrder, type SalesOverview, type SalesDispatch, type QuoteRevision, type Receivable,
} from './sales-client';
import './sales.css';

type Overview = SalesOverview;

export default function Sales({ member, onInventoryChanged }: { member: Member; onInventoryChanged: () => Promise<void> }) {
  const { t } = useLanguage();
  const selling = canSell(member), billing = canBill(member), movingStock = canDispatchSales(member);
  const views = [
    ...(selling ? ['buyers', 'orders'] : []), ...(movingStock ? ['dispatches'] : []), ...(billing ? ['money'] : []),
  ] as const;
  const [view, setView] = useState<(typeof views)[number] | ''>(views[0] ?? '');
  const [state, setState] = useState<Overview | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [open, setOpen] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { setState(await salesRequest<Overview>('')); setError(''); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!views.length) return <div className="erp-workspace"><section className="live-panel">
    <h2>{t('Sales', 'فروخت')}</h2>
    <p className="live-muted">{t('Your account does not have sales, dispatch or payments permission. Ask an admin.', 'آپ کے اکاؤنٹ میں فروخت، روانگی یا ادائیگی کی اجازت نہیں ہے۔ ایڈمن سے رابطہ کریں۔')}</p>
  </section></div>;
  const saved = async (message?: string) => { setOpen(''); setNotice(message ?? t('Saved.', 'محفوظ ہو گیا۔')); await load(); };
  const serverTime = state?.serverTime ?? Date.now();
  const line = (orderId: string) => state?.lines.find(l => l.sales_order_id === orderId);
  const remaining = (order: SalesOrder) => {
    const l = line(order.id); if (!l) return 0;
    return l.quantity_milli - state!.dispatches.filter(d => d.sales_order_id === order.id && !d.movement_reversed).reduce((n, d) => n + d.quantity_milli, 0);
  };
  const invoiceOf = (orderId: string) => state?.invoices.find(i => i.sales_order_id === orderId);
  return <div className="erp-workspace">
    <div className="erp-toolbar"><div className="live-segments" aria-label={t('Sales views', 'فروخت کے حصے')}>
      {selling && <button aria-pressed={view === 'buyers'} onClick={() => { setView('buyers'); setOpen(''); }}>{t('Buyers', 'خریدار')}</button>}
      {selling && <button aria-pressed={view === 'orders'} onClick={() => { setView('orders'); setOpen(''); }}>{t('Orders and quotes', 'آرڈرز اور کوٹیشنز')}</button>}
      {movingStock && <button aria-pressed={view === 'dispatches'} onClick={() => { setView('dispatches'); setOpen(''); }}>{t('Dispatches', 'روانگیاں')}</button>}
      {billing && <button aria-pressed={view === 'money'} onClick={() => { setView('money'); setOpen(''); }}>{t('Money', 'مالی')}</button>}
    </div><button className="button" onClick={() => void load()}><RefreshCw size={18} />{t('Refresh', 'تازہ کریں')}</button></div>
    {error && <p className="live-error" role="alert">{t(error)}<button className="live-text-button" onClick={() => void load()}>{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}
    {notice && <p className="live-success" role="status">{notice}</p>}
    {loading && <p role="status">{t('Loading sales records…', 'فروخت کے ریکارڈ لوڈ ہو رہے ہیں…')}</p>}
    {state && !loading && state.outbox.some(m => m.state === 'queued') && !state.emailConfigured &&
      <p className="live-warning">{t('Buyer email notifications are queued but sending is not configured yet. Share quotes and invoices from this screen meanwhile.', 'خریداروں کی ای میل اطلاعات قطار میں ہیں لیکن بھیجنے کی ترتیب ابھی نہیں دی گئی۔ اس وقت اس اسکرین سے کوٹیشنز اور انوائسز شیئر کریں۔')}</p>}
    {view === 'buyers' && selling && state && <BuyersView state={state} member={member} open={open} setOpen={setOpen} saved={saved} loading={loading} />}
    {view === 'orders' && selling && state && <OrdersView state={state} open={open} setOpen={setOpen} saved={saved} serverTime={serverTime} loading={loading} />}
    {view === 'dispatches' && movingStock && state && <DispatchesView state={state} member={member} open={open} setOpen={setOpen} saved={saved} onInventoryChanged={onInventoryChanged} serverTime={serverTime} loading={loading} />}
    {view === 'money' && billing && state && <MoneyView state={state} open={open} setOpen={setOpen} saved={saved} serverTime={serverTime} loading={loading} />}
  </div>;
}

function BuyersView({ state, member, open, setOpen, saved, loading }: {
  state: Overview; member: Member; open: string; setOpen: (v: string) => void; saved: (message?: string) => Promise<void>; loading: boolean;
}) {
  const { t } = useLanguage();
  const managerName = (id: string | null) => id ? state.managers.find(m => m.id === id)?.name ?? t('Former team member', 'سابقہ ساتھی') : t('Unassigned', 'مقرر نہیں');
  return <section className="live-panel"><div className="yf-head"><div>
    <h2>{t('Buyers', 'خریدار')}</h2>
    <p>{t('Companies that buy from the factory. Portal buyers see only their own orders and invoices.', 'وہ کمپنیاں جو فیکٹری سے خریدتی ہیں۔ پورٹل خریدار صرف اپنے آرڈرز اور انوائسز دیکھتے ہیں۔')}</p>
  </div><button className="button primary" onClick={() => setOpen('buyer:new')}><UserPlus size={18} />{t('Add buyer', 'خریدار شامل کریں')}</button></div>
   {open === 'buyer:new' && <BuyerForm onSaved={saved} onCancel={() => setOpen('')} />}
   {!loading && !state.buyers.length && <p className="live-muted">{t('No buyers yet. Add the first company, or share the buyer portal link so they can register.', 'ابھی کوئی خریدار نہیں۔ پہلی کمپنی شامل کریں، یا خریدار پورٹل کا لنک شیئر کریں تاکہ وہ خود رجسٹر ہوں۔')}</p>}
   <div className="erp-records">{state.buyers.map(b => <article className="erp-record" key={b.id}>
    <div className="erp-record-head"><div><h3>{b.name}</h3><p>{b.contact_name}{b.city ? ' · ' + b.city : ''}</p></div>
     <span className={`erp-status is-${b.status}`}>{t(buyerStatusName[b.status], { pending: 'زیرِ التوا', active: 'فعال', rejected: 'مسترد', suspended: 'معطل', archived: 'محفوظ شدہ' }[b.status])}</span></div>
    <p className="live-muted">{t('Sales manager:', 'فروخت مینیجر:')} {managerName(b.assigned_manager_id)} · {b.email} · <bdi>{b.phone}</bdi></p>
    {b.notes && <p className="erp-multiline">{b.notes}</p>}
    {member.admin && (open === 'buyer:' + b.id ? <BuyerReview buyer={b} managers={state.managers} onSaved={saved} onCancel={() => setOpen('')} />
      : <button className="button" onClick={() => setOpen('buyer:' + b.id)}><ShieldCheck size={18} />{t('Review buyer access', 'خریدار کی رسائی کا جائزہ لیں')}</button>)}
   </article>)}</div>
  </section>;
}

function OrdersView({ state, open, setOpen, saved, serverTime, loading }: {
  state: Overview; open: string; setOpen: (v: string) => void; saved: (message?: string) => Promise<void>; serverTime: number; loading: boolean;
}) {
  const { t } = useLanguage();
  const buyer = (id: string) => state.buyers.find(b => b.id === id)?.name ?? '';
  const revisionsOf = (poId: string) => state.revisions.filter(r => r.buyer_po_id === poId);
  return <section className="live-panel"><div className="yf-head"><div>
    <h2>{t('Buyer orders and quotes', 'خریدار کے آرڈرز اور کوٹیشنز')}</h2>
    <p>{t('Enter the buyer purchase order, quote it, and the buyer approves in their portal. Approval confirms the order and issues one invoice.', 'خریدار کی پرچیز آرڈر درج کریں، کوٹیشن دیں، اور خریدار اپنے پورٹل میں منظوری دے گا۔ منظوری آرڈر مستقل کرکے ایک انوائس جاری کرے گی۔')}</p>
  </div><button className="button primary" onClick={() => setOpen('po:new')}><Plus size={18} />{t('Enter buyer PO', 'خریدار کی پرچیز آرڈر درج کریں')}</button></div>
   {open === 'po:new' && <PoForm buyers={state.buyers} onSaved={saved} onCancel={() => setOpen('')} />}
   {!loading && !state.pos.length && <p className="live-muted">{t('No buyer orders yet. Enter the first buyer purchase order to start a quote.', 'ابھی کوئی آرڈر نہیں۔ کوٹیشن شروع کرنے کے لیے پہلی خریدار پرچیز آرڈر درج کریں۔')}</p>}
   <div className="erp-records">{state.pos.map(po => {
     const revisions = revisionsOf(po.id); const approved = revisions.find(r => r.status === 'approved');
     const order = state.orders.find(o => o.buyer_po_id === po.id); const invoice = order && state.invoices.find(i => i.sales_order_id === order.id);
     const latest = revisions[revisions.length - 1];
     return <article className="erp-record" key={po.id}>
      <div className="erp-record-head"><div><h3>{po.reference} · {po.buyer_name || buyer(po.buyer_id)}</h3>
       <p>{quantity(po.quantity_milli)} {po.unit} · {t('requested', 'مطلوبہ')} {factoryTime(po.requested_delivery_at)}</p></div>
       <span className="erp-status">{t(po.status, { entered: 'درج', quoted: 'کوٹیشن بھیجا', confirmed: 'مستقل', cancelled: 'منسوخ' }[po.status])}</span></div>
      <p className="erp-multiline">{po.specifications}</p>
      <p className="live-muted">{t('Payment terms:', 'ادائیگی کی شرائط:')} {po.payment_terms}</p>
      {revisions.map(r => <div className="sales-quote" key={r.id}>
        <strong>{t('Quote revision', 'کوٹیشن ترمیم')} {r.version} · <span className={`erp-status is-${r.status}`}>{t(r.status, { draft: 'مسودہ', sent: 'خریدار کے پاس', approved: 'منظور' }[r.status])}</span></strong>
        <p>{rate(r.price_minor, r.currency)} / {r.unit} · {t('total', 'کل')} <b>{rate(r.price_minor * r.quantity_milli / 1000, r.currency)}</b></p>
        <p className="live-muted">{r.specifications}</p>
        {r.note && <p className="live-muted">{r.note}</p>}
        {r.status === 'draft' && (open === 'send:' + r.id ? <SendQuote revision={r} onSaved={saved} onCancel={() => setOpen('')} />
          : <button className="button primary" onClick={() => setOpen('send:' + r.id)}><Send size={18} />{t('Send quote to buyer portal', 'کوٹیشن خریدار پورٹل کو بھیجیں')}</button>)}
      </div>)}
      {!revisions.length && (open === 'quote:' + po.id ? <QuoteForm po={po} currency={state.currency} onSaved={saved} onCancel={() => setOpen('')} />
        : po.status === 'entered' && <button className="button primary" onClick={() => setOpen('quote:' + po.id)}><FileText size={18} />{t('Draft quote', 'کوٹیشن کا مسودہ')}</button>)}
      {approved && !order && <p className="live-warning">{t('Approved but the order is still confirming. Refresh in a moment.', 'منظور شدہ لیکن آرڈر ابھی مستقل ہو رہا ہے۔ تھوڑی دیر میں تازہ کریں۔')}</p>}
      {order && <div className="sales-order">
        <div className="erp-record-head"><div><h4>{order.reference}</h4><p>{t('Approved', 'منظور')} {factoryTime(order.created_at)}</p></div>
         <span className="erp-status">{t(orderStatusName[order.status], { confirmed: 'مستقل', partially_dispatched: 'جزوی روانگی', dispatched: 'روانہ', cancelled: 'منسوخ' }[order.status])}</span></div>
        {invoice && <InvoiceCard invoice={invoice} order={order} />}
      </div>}
      {po.status !== 'confirmed' && !approved && latest?.status === 'sent' &&
        <p className="live-muted">{t('Waiting for the buyer to approve in their portal.', 'خریدار کی پورٹل میں منظوری کا انتظار۔')}</p>}
     </article>;
   })}</div>
  </section>;
}

function SendQuote({ revision, onSaved, onCancel }: { revision: QuoteRevision; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage();
  return <AsyncForm title={t('Send this quote to the buyer portal', 'یہ کوٹیشن خریدار پورٹل کو بھیجیں')} detail={`${t('Revision', 'ترمیم')} ${revision.version} · ${rate(revision.price_minor, revision.currency)} / ${revision.unit}`}
    submit={t('Send quote', 'کوٹیشن بھیجیں')} onCancel={onCancel}
    note={t('The buyer signs into their portal to approve. Only the newest revision can be approved; sent terms cannot be edited.', 'خریدار اپنے پورٹل میں سائن اِن کرکے منظوری دے گا۔ صرف تازہ ترین ترمیم منظور ہو سکتی ہے؛ بھیجی ہوئی شرائط تبدیل نہیں ہو سکتیں۔')}
    onSubmit={async () => { await salesRequest('/quotes/send', { id: revision.id }); await onSaved(t('Quote sent to the buyer portal.', 'کوٹیشن خریدار پورٹل کو بھیج دیا گیا۔')); }}>
    <label className="erp-confirm"><input type="checkbox" required />{t('I checked the price, specifications and delivery date.', 'میں نے قیمت، تفصیلات اور ترسیل کی تاریخ جانچ لی ہے۔')}</label>
  </AsyncForm>;
}

function InvoiceCard({ invoice, order }: { invoice: Invoice; order: SalesOrder }) {
  const { t } = useLanguage();
  const terms = JSON.parse(order.terms_snapshot) as { payment_terms: string; requested_delivery_at: number };
  return <div className="sales-invoice">
    <div className="erp-record-head"><div><h4><FileText size={18} /> {invoice.number}</h4>
      <p>{rate(invoice.total_minor, invoice.currency)} · {t('issued', 'جاری شدہ')} {factoryTime(invoice.issued_at)}</p></div>
     <a className="button" href={invoiceDownloadHref(invoice.id)} download><Download size={18} />{t('Download invoice', 'انوائس ڈاؤن لوڈ کریں')}</a></div>
    <ul className="sales-lines">{invoiceLines(invoice).map((l, i) => <li key={i}>
      <span className="erp-multiline">{l.specifications}</span>
      <span>{quantity(l.quantity_milli)} {l.unit} × {rate(l.price_minor, invoice.currency)} = <b>{rate(l.amount_minor, invoice.currency)}</b></span></li>)}</ul>
    <p className="live-muted">{t('Payment terms:', 'ادائیگی کی شرائط:')} {terms.payment_terms} · {t('requested delivery', 'مطلوبہ ترسیل')} {factoryTime(terms.requested_delivery_at)}</p>
    <p className="live-muted">{t('The invoice document is final; corrections are recorded on the delivery, not the invoice.', 'انوائس دستاویز حتمی ہے؛ درستگی ترسیل پر درج ہوتی ہے، انوائس پر نہیں۔')}</p>
  </div>;
}

function DispatchesView({ state, member, open, setOpen, saved, onInventoryChanged, serverTime, loading }: {
  state: Overview; member: Member; open: string; setOpen: (v: string) => void; saved: (message?: string) => Promise<void>;
  onInventoryChanged: () => Promise<void>; serverTime: number; loading: boolean;
}) {
  const { t } = useLanguage();
  const active = state.orders.filter(o => o.status === 'confirmed' || o.status === 'partially_dispatched');
  const deliveryOf = (dispatchId: string) => state.deliveries.find(d => d.dispatch_id === dispatchId);
  return <section className="live-panel"><div className="yf-head"><div>
    <h2>{t('Dispatches and deliveries', 'روانگیاں اور ترسیلات')}</h2>
    <p>{t('Issue confirmed goods from QC-approved finished stock. Recording delivery starts the 30-day payment window.', 'منظور شدہ آرڈرز کا قمیت کا تیار اسٹاک جاری کریں۔ ترسیل درج کرنے سے ۳۰ دن کی ادائیگی کی مدت شروع ہوتی ہے۔')}</p>
  </div></div>
   {!loading && !active.length && <p className="live-muted">{t('No confirmed orders are waiting for dispatch.', 'کوئی مستقل آرڈر روانگی کے انتظار میں نہیں۔')}</p>}
   <div className="erp-records">{active.map(o => {
     const l = state.lines.find(line => line.sales_order_id === o.id); if (!l) return null;
     const left = l.quantity_milli - state.dispatches.filter(d => d.sales_order_id === o.id && !d.movement_reversed).reduce((n, d) => n + d.quantity_milli, 0);
     const invoice = state.invoices.find(i => i.sales_order_id === o.id);
     return <article className="erp-record" key={o.id}>
      <div className="erp-record-head"><div><h3>{o.reference} · {state.buyers.find(b => b.id === o.buyer_id)?.name}</h3>
       <p>{quantity(left)} / {quantity(l.quantity_milli)} {l.unit} {t('remaining to dispatch', 'روانگی باقی')}</p></div>
       <span className="erp-status">{t(orderStatusName[o.status], { confirmed: 'مستقل', partially_dispatched: 'جزوی روانگی', dispatched: 'روانہ', cancelled: 'منسوخ' }[o.status])}</span></div>
      <p className="erp-multiline">{l.specifications}</p>
      {left > 0 && (open === 'dispatch:' + o.id ? <DispatchForm order={o} line={l} state={state} member={member} onSaved={async m => { await onInventoryChanged(); await saved(m); }} onCancel={() => setOpen('')} />
        : <button className="button primary" onClick={() => setOpen('dispatch:' + o.id)}><Truck size={18} />{t('Dispatch stock', 'اسٹاک روانہ کریں')}</button>)}
      {state.dispatches.filter(d => d.sales_order_id === o.id).map(d => {
        const delivered = deliveryOf(d.id);
        return <div className="sales-dispatch" key={d.id}>
          <strong><Truck size={18} /> {quantity(d.quantity_milli)} {d.unit} · {d.carrier}</strong>
          <span>{factoryTime(d.dispatched_at)}{d.movement_reversed ? ' · ' + t('reversed in inventory', 'انوینٹری میں واپس') : ''}</span>
          {d.documents_note && <span className="live-muted">{d.documents_note}</span>}
          {JSON.parse(d.packages_json).length > 0 && <span className="live-muted">{t('Packages:', 'پیکجز:')} {(JSON.parse(d.packages_json) as string[]).join(', ')}</span>}
          {delivered
            ? <span className="live-muted">{t('Delivered', 'ترسیل ہو چکی')} {factoryTime(delivered.delivery_date)} · {t('payment due', 'ادائیگی کی آخری تاریخ')} {state.receivables.filter(r => r.delivery_id === delivered.id).map(r => dueLabel(r, serverTime)).join(' ')}</span>
            : canSell(member) && (open === 'deliver:' + d.id ? <DeliveryForm dispatch={d} onSaved={saved} onCancel={() => setOpen('')} />
              : <button className="button" onClick={() => setOpen('deliver:' + d.id)}>{t('Record delivery', 'ترسیل درج کریں')}</button>)}
          {delivered && canSell(member) && (open === 'correct:' + delivered.id ? <CorrectionForm delivery={delivered} onSaved={saved} onCancel={() => setOpen('')} />
            : <button className="button" onClick={() => setOpen('correct:' + delivered.id)}>{t('Correct delivery date', 'ترسیل کی تاریخ درست کریں')}</button>)}
          {state.corrections.filter(c => c.delivery_id === delivered?.id).map(c => <p className="live-muted" key={c.id}>
            {t('Corrected', 'درست کیا گیا')} {factoryTime(c.previous_date)} → {factoryTime(c.corrected_date)}: {c.reason}</p>)}
          {invoice ? null : <p className="live-warning">{t('No invoice yet — the buyer must approve the quote first.', 'انوائس ابھی نہیں — پہلے خریدار کی منظوری درکار ہے۔')}</p>}
        </div>;
      })}
     </article>;
   })}</div>
   {state.dispatches.length > 0 && <p className="live-muted"><ExternalLink size={14} /> {t('Dispatched stock is issued from the same inventory ledger the stock screen shows.', 'روانہ اسٹاک اسی انوینٹری لیجر سے جاری ہوتا ہے جو اسٹاک اسکرین دکھاتی ہے۔')}</p>}
  </section>;
}

function MoneyView({ state, open, setOpen, saved, serverTime, loading }: {
  state: Overview; open: string; setOpen: (v: string) => void; saved: (message?: string) => Promise<void>; serverTime: number; loading: boolean;
}) {
  const { t } = useLanguage();
  const outstanding = state.receivables.filter(r => r.status === 'open').reduce((n, r) => n + r.amount_minor - r.paid_minor, 0);
  return <section className="live-panel"><div className="yf-head"><div>
    <h2>{t('Invoices and receivables', 'انوائسز اور وصولیات')}</h2>
    <p>{t('One invoice per approved quote revision. Each delivery creates its own receivable, due 30 days later in Pakistan time.', 'ہر منظور شدہ کوٹیشن ترمیم کی ایک انوائس۔ ہر ترسیل کی اپنی وصولی بنتے ہیں، پاکستان کے وقت سے ۳۰ دن بعد۔')}</p>
  </div><div className="sales-total"><Banknote size={22} /><div><strong>{state.receivables.length ? outstanding.toLocaleString() + ' ' + (state.receivables[0]?.currency ?? 'PKR') : '—'}</strong><span>{t('outstanding, integer minor units', 'باقی رقم')}</span></div></div></div>
   {!loading && !state.invoices.length && <p className="live-muted">{t('No invoices yet. Invoices appear when a buyer approves a quote.', 'ابھی کوئی انوائس نہیں۔ خریدار کی منظوری پر انوائس بنے گی۔')}</p>}
   <div className="erp-records">{state.invoices.map(i => <article className="erp-record" key={i.id}>
    <div className="erp-record-head"><div><h3>{i.number}</h3><p>{state.buyers.find(b => b.id === i.buyer_id)?.name} · {i.order_reference}</p></div>
     <a className="button" href={invoiceDownloadHref(i.id)} download><Download size={18} />{t('Download', 'ڈاؤن لوڈ')}</a></div>
    <p>{rate(i.total_minor, i.currency)} · {t('issued', 'جاری شدہ')} {factoryTime(i.issued_at)}</p>
   </article>)}</div>
   <h3>{t('Receivables', 'وصولیات')}</h3>
   {!loading && !state.receivables.length && <p className="live-muted">{t('Receivables are created when a delivery is recorded.', 'ترسیل درج ہونے پر وصولیات بنتی ہیں۔')}</p>}
   <div className="erp-records">{state.receivables.map(r => <article className={`erp-record sales-receivable is-${r.status}`} key={r.id}>
    <div className="erp-record-head"><div><h3>{r.invoice_number}</h3>
      <p>{rate(r.amount_minor, r.currency)} · {t('paid', 'وصول')} {rate(r.paid_minor, r.currency)}</p></div>
     <span className={`erp-status is-${r.status}`}>{r.status === 'settled' ? t('Settled', 'مکمل وصول') : t('Open', 'بقایا')}</span></div>
    <p className={r.status === 'open' && r.due_at <= serverTime ? 'live-warning' : 'live-muted'}>{t('Due', 'آخری تاریخ')} {dueLabel(r, serverTime)} · {t('due revision', 'ترمیم')} {r.due_revision}</p>
    {r.status === 'open' && (open === 'pay:' + r.id ? <PaymentForm receivable={r} onSaved={saved} onCancel={() => setOpen('')} />
      : <button className="button primary" onClick={() => setOpen('pay:' + r.id)}><Banknote size={18} />{t('Record payment', 'ادائیگی درج کریں')}</button>)}
   </article>)}</div>
   <h3>{t('Queued buyer messages', 'خریدار کے پیغامات')}</h3>
   <p className="live-muted">{state.outbox.filter(m => m.state === 'queued').length} {t('queued', 'قطار میں')} · {state.outbox.filter(m => m.state === 'sent').length} {t('sent', 'بھیجے گئے')}</p>
   <div className="erp-records">{state.outbox.map(m => <article className="erp-record" key={m.id}>
    <div className="erp-record-head"><div><h4>{m.kind === 'invoice_document' ? t('Invoice document', 'انوائس دستاویز') : t('Quote notification', 'کوٹیشن اطلاع')}</h4>
      <p>{state.buyers.find(b => b.id === m.buyer_id)?.name} · {factoryTime(m.created_at)}</p></div>
     <span className="erp-status">{t(outboxStateName[m.state], { queued: 'قطار میں، ابھی نہیں بھیجا', sent: 'بھیجا گیا', failed: 'ناکام' }[m.state])}</span></div>
    <p className="live-muted">{t('Attempts:', 'کوششیں:')} {m.attempts} · {outboxWhen(m)}{m.last_error ? ' · ' + m.last_error : ''}</p>
    {m.state === 'queued' && (open === 'retry:' + m.id ? <RetryOutbox message={m} onSaved={saved} onCancel={() => setOpen('')} />
      : <button className="button" onClick={() => setOpen('retry:' + m.id)}>{t('Retry sending', 'دوبارہ بھیجنے کی کوشش')}</button>)}
   </article>)}</div>
  </section>;
}

function RetryOutbox({ message, onSaved, onCancel }: { message: Overview['outbox'][number]; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage();
  return <AsyncForm title={t('Retry this queued message', 'اس قطار میں پیغام کو دوبارہ بھیجیں')} submit={t('Attempt sending', 'بھیجنے کی کوشش')} onCancel={onCancel}
    note={t('Without a configured email adapter the message stays queued and the attempt is recorded.', 'ای میل ایڈاپٹر ترتیب کے بغیر پیغام قطار میں رہے گا اور کوشش درج ہو گی۔')}
    onSubmit={async () => { await salesRequest('/outbox/retry', { id: message.id }); await onSaved(); }}>
    <label className="erp-confirm"><input type="checkbox" required />{t('I understand the attempt is recorded even when email sending stays unconfigured.', 'میں سمجھتا/سمجھتی ہوں کہ ای میل کی ترتیب نہ ہونے پر بھی کوشش درج ہو گی۔')}</label>
  </AsyncForm>;
}

function BuyerForm({ onSaved, onCancel }: { onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const [name, setName] = useState(''), [contactName, setContact] = useState(''), [email, setEmail] = useState(''), [phone, setPhone] = useState(''), [city, setCity] = useState(''), [notes, setNotes] = useState('');
  return <AsyncForm title={t('Add buyer company', 'خریدار کمپنی شامل کریں')} submit={t('Save buyer', 'خریدار محفوظ کریں')} onCancel={onCancel}
    note={t('The buyer registers in the portal with the same company email to see their orders.', 'خریدار اسی کمپنی ای میل سے پورٹل میں رجسٹر ہو کر اپنے آرڈرز دیکھے گا۔')}
    onSubmit={async () => { await salesRequest('/buyers', { id, name, contactName, email, phone, city, notes }); await onSaved(t('Buyer saved. Review their portal registration to activate.', 'خریدار محفوظ ہو گیا۔ پورٹل رجسٹریشن کا جائزہ لے کر فعال کریں۔')); }}>
    <Field>{t('Company name', 'کمپنی کا نام')}<input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="organization" /></Field>
    <Field>{t('Contact name', 'رابطے کا نام')}<input value={contactName} onChange={e => setContact(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" /></Field>
    <div className="live-fields"><Field>{t('Email', 'ای میل')}<input type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="email" /></Field>
      <Field>{t('Phone with country code', 'ملکی کوڈ کے ساتھ فون')}<input type="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} required maxLength={30} placeholder="+923001234567" autoComplete="tel" /></Field></div>
    <Field>{t('City', 'شہر')}<input value={city} onChange={e => setCity(e.target.value)} maxLength={100} autoComplete="address-level2" /></Field>
    <Field>{t('Notes (optional)', 'نوٹس (اختیاری)')}<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} /></Field>
  </AsyncForm>;
}

function BuyerReview({ buyer, managers, onSaved, onCancel }: { buyer: Buyer; managers: Overview['managers']; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState(buyer.status === 'active' ? 'active' : 'active'), [manager, setManager] = useState(buyer.assigned_manager_id ?? ''), [reason, setReason] = useState('');
  return <AsyncForm title={t('Review buyer access', 'خریدار کی رسائی کا جائزہ لیں')} detail={buyer.name} submit={t('Save decision', 'فیصلہ محفوظ کریں')} onCancel={onCancel}
    note={t('Rejecting or suspending ends the buyer portal sessions immediately. Their past orders and invoices stay on record.', 'مسترد یا معطل کرنے سے خریدار پورٹل سیشن فوراً ختم ہو جائیں گے۔ پرانے آرڈرز اور انوائسز ریکارڈ پر رہیں گے۔')}
    onSubmit={async () => { await salesRequest('/buyers/review', { id: buyer.id, status, reason, version: buyer.version, assignedManagerId: manager || null }); await onSaved(); }}>
    <Field>{t('Decision', 'فیصلہ')}<select value={status} onChange={e => setStatus(e.target.value)}>
      <option value="active">{t('Activate / keep active', 'فعال کریں')}</option><option value="rejected">{t('Reject registration', 'رجسٹریشن مسترد')}</option><option value="suspended">{t('Suspend access', 'رسائی معطل')}</option></select></Field>
    <Field>{t('Assigned sales manager', 'مقررہ فروخت مینیجر')}<select value={manager} onChange={e => setManager(e.target.value)}>
      <option value="">{t('Unassigned (admin gets reminders)', 'مقرر نہیں (ایڈمن کو یاد دہانیاں ملیں گی)')}</option>
      {managers.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select></Field>
    <Field>{t('Verification details / reason', 'تصدیق کی تفصیلات / وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={5} maxLength={1000} /></Field>
    {status === 'active' && <label className="erp-confirm"><input type="checkbox" required />{t('I verified the company, contact and phone details.', 'میں نے کمپنی، رابطے اور فون کی تفصیلات کی تصدیق کی ہے۔')}</label>}
  </AsyncForm>;
}

function PoForm({ buyers, onSaved, onCancel }: { buyers: Buyer[]; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const [buyerId, setBuyer] = useState(buyers.find(b => b.status === 'active')?.id ?? ''), [reference, setReference] = useState(''), [specifications, setSpecifications] = useState('');
  const [qty, setQty] = useState(''), [unit, setUnit] = useState<'kg' | 'metre' | 'piece'>('kg'), [delivery, setDelivery] = useState(localFactoryInput(Date.now() + 21 * 86400000)), [terms, setTerms] = useState('');
  const active = buyers.filter(b => b.status === 'active');
  return <AsyncForm title={t('Enter buyer purchase order', 'خریدار کی پرچیز آرڈر درج کریں')} submit={t('Save PO', 'پرچیز آرڈر محفوظ کریں')} onCancel={onCancel}
    note={t('Entered PO terms cannot be edited later. Quote against it next.', 'درج شدہ آرڈر کی شرائط بعد میں تبدیل نہیں ہو سکتیں۔ اس کے بعد کوٹیشن دیں۔')}
    onSubmit={async () => {
      if (!buyerId) throw Error(t('Choose an active buyer.', 'ایک فعال خریدار منتخب کریں۔'));
      await salesRequest('/pos', { id, buyerId, reference, specifications, quantityMilli: fixedInput(qty, 3, 'Quantity'), unit, requestedDeliveryAt: factoryInput(delivery), paymentTerms: terms });
      await onSaved(t('Buyer PO saved. Draft the quote next.', 'پرچیز آرڈر محفوظ۔ اب کوٹیشن کا مسودہ بنائیں۔'));
    }}>
    <Field>{t('Active buyer', 'فعال خریدار')}<select value={buyerId} onChange={e => setBuyer(e.target.value)} required>
      {!active.length && <option value="">{t('No active buyers — add one first', 'کوئی فعال خریدار نہیں — پہلے شامل کریں')}</option>}
      {active.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></Field>
    <Field>{t('Buyer PO reference', 'خریدار آرڈر نمبر')}<input value={reference} onChange={e => setReference(e.target.value)} required minLength={2} maxLength={100} dir="ltr" /></Field>
    <Field>{t('Specifications', 'تفصیلات')}<textarea value={specifications} onChange={e => setSpecifications(e.target.value)} required minLength={5} maxLength={4000} /></Field>
    <div className="live-fields"><Field>{t('Quantity', 'مقدار')}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required /></Field>
      <Field>{t('Unit', 'اکائی')}<select value={unit} onChange={e => setUnit(e.target.value as 'kg' | 'metre' | 'piece')}><option value="kg">kg</option><option value="metre">metre</option><option value="piece">piece</option></select></Field></div>
    <Field>{t('Requested delivery (PKT)', 'مطلوبہ ترسیل (پاکستان)')}<input type="datetime-local" value={delivery} onChange={e => setDelivery(e.target.value)} required /></Field>
    <Field>{t('Payment terms from the buyer', 'خریدار کی ادائیگی کی شرائط')}<textarea value={terms} onChange={e => setTerms(e.target.value)} required minLength={3} maxLength={1000} placeholder="Net 30 days after delivery" /></Field>
  </AsyncForm>;
}

function QuoteForm({ po, currency, onSaved, onCancel }: { currency: string; po: Overview['pos'][number]; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const [price, setPrice] = useState(''), [specifications, setSpecifications] = useState(po.specifications);
  const [delivery, setDelivery] = useState(localFactoryInput(po.requested_delivery_at)), [terms, setTerms] = useState(po.payment_terms), [note, setNote] = useState('');
  return <AsyncForm title={t('Draft quote revision 1', 'کوٹیشن ترمیم ۱ کا مسودہ')} detail={po.reference} submit={t('Save draft', 'مسودہ محفوظ کریں')} onCancel={onCancel}
    note={t('Saving a draft does not show it to the buyer. Send it after checking. Quoted terms freeze once saved; later changes need a new revision.', 'مسودہ محفوظ کرنے سے خریدار کو نہیں دکھے گا۔ جانچ کے بعد بھیجیں۔ شرائط محفوظ ہوتے ہی منجمد ہو جائیں گی؛ بعد کی تبدیلی کے لیے نئی ترمیم درکار ہے۔')}
    onSubmit={async () => {
      await salesRequest('/quotes', { id, poId: po.id, priceMinor: fixedInput(price, 2, 'Unit price'), currency, specifications, requestedDeliveryAt: factoryInput(delivery), paymentTerms: terms, note });
      await onSaved(t('Draft saved. Send it when the terms are checked.', 'مسودہ محفوظ۔ شرائط کی جانچ کے بعد بھیجیں۔'));
    }}>
    <div className="live-fields"><Field>{t('Unit price (per unit)', 'فی اکائی قیمت')}<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} required placeholder="1250.00" /></Field>
      <Field>{t('Currency', 'کرنسی')}<input value={currency} readOnly /></Field></div>
    <p className="live-muted">{t('Order quantity:', 'آرڈر کی مقدار:')} {quantity(po.quantity_milli)} {po.unit} — {t('the price multiplies exactly into the invoice total.', 'قیمت × مقدار انوائس کل پر بالکل درست ہو گی۔')}</p>
    <Field>{t('Specifications', 'تفصیلات')}<textarea value={specifications} onChange={e => setSpecifications(e.target.value)} required minLength={5} maxLength={4000} /></Field>
    <Field>{t('Promised delivery (PKT)', 'وعدہ شدہ ترسیل (پاکستان)')}<input type="datetime-local" value={delivery} onChange={e => setDelivery(e.target.value)} required /></Field>
    <Field>{t('Payment terms', 'ادائیگی کی شرائط')}<textarea value={terms} onChange={e => setTerms(e.target.value)} required minLength={3} maxLength={1000} /></Field>
    <Field>{t('Note for the buyer (optional)', 'خریدار کے لیے نوٹ (اختیاری)')}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></Field>
  </AsyncForm>;
}

function DispatchForm({ order, line, state, member, onSaved, onCancel }: {
  order: SalesOrder; line: Overview['lines'][number]; state: Overview; member: Member;
  onSaved: (message?: string) => Promise<void>; onCancel: () => void;
}) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const already = state.dispatches.filter(d => d.sales_order_id === order.id && !d.movement_reversed).reduce((n, d) => n + d.quantity_milli, 0);
  const remaining = line.quantity_milli - already;
  const usable = state.finishedStock.filter(s => s.quality === 'approved' && (!line.product_id || s.product_id === line.product_id));
  const stage = 'finished' as const;
  const options = usable.filter(s => s.stage === stage);
  const [lotId, setLot] = useState(options[0]?.lot_id ?? ''), [qty, setQty] = useState(''), [grams, setGrams] = useState('');
  const [cartons, setCartons] = useState('0'), [cones, setCones] = useState('0'), [carrier, setCarrier] = useState('');
  const [packages, setPackages] = useState(''), [note, setNote] = useState(''), [dispatchedAt, setDispatchedAt] = useState(localFactoryInput(Date.now()));
  const kg = line.unit === 'kg';
  const chosen = options.find(s => s.lot_id === lotId);
  return <AsyncForm title={t('Dispatch from stock', 'اسٹاک سے روانگی')} detail={`${order.reference} · ${quantity(remaining)} ${line.unit} ${t('remaining', 'باقی')}`} submit={t('Record dispatch', 'روانگی درج کریں')} onCancel={onCancel}
    note={t('Dispatch issues the stock from the inventory ledger immediately and is permanent. QC-approved lots only.', 'روانگی اسٹاک فوراً انوینٹری لیجر سے جاری کرتی ہے اور واپس نہیں ہوتی۔ صرف ق-ج منظور شدہ لوٹس۔')}
    onSubmit={async () => {
      if (!lotId) throw Error(t('Choose a QC-approved lot with finished stock.', 'قمیت منظور شدہ لوٹ منتخب کریں جس میں تیار اسٹاک ہو۔'));
      const whole = (value: string, label: string) => { if (!/^\d+$/.test(value.trim())) throw Error(`${label}: ${t('use a whole number.', 'پورا عدد درج کریں۔')}`); return Number(value); };
      await salesRequest('/dispatches', {
        id, orderId: order.id, lotId, stage, quantityMilli: fixedInput(qty, 3, 'Dispatched quantity'),
        ...(kg ? {} : { grams: fixedInput(grams, 0, 'Weight in grams') }), cartons: whole(cartons || '0', 'Cartons'), cones: whole(cones || '0', 'Cones'),
        carrier, packages: packages.split('\n').map(s => s.trim()).filter(Boolean), documentsNote: note, dispatchedAt: factoryInput(dispatchedAt),
      });
      await onSaved(t('Dispatch recorded and stock issued.', 'روانگی درج اور اسٹاک جاری ہو گیا۔'));
    }}>
    <div className="live-fields">
      <Field>{t('QC-approved lot', 'قمیت منظور شدہ لوٹ')}<select value={lotId} onChange={e => setLot(e.target.value)} required>
        {!options.length && <option value="">{t('No approved stock at this stage', 'اس اسٹیج پر منظور شدہ اسٹاک نہیں')}</option>}
        {options.map(s => <option value={s.lot_id} key={s.lot_id}>{s.product_name} · {s.batch} · {s.grams.toLocaleString()} g</option>)}</select></Field>
    </div>
    {chosen && <p className="live-muted">{t('Available:', 'دستیاب:')} {chosen.grams.toLocaleString()} g{chosen.cartons ? ` · ${chosen.cartons} ${t('cartons', 'کارٹن')}` : ''}{chosen.cones ? ` · ${chosen.cones} ${t('cones', 'کونز')}` : ''}</p>}
    <div className="live-fields"><Field>{t('Dispatched quantity', 'روانہ مقدار')}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required placeholder={String(remaining / 1000)} /></Field>
      {kg ? <p className="live-muted">{t('The ledger keeps exact mass: for kg orders the weighed grams equal the quantity in thousandths (62.5 kg = 62500 g).', 'لیجر گرام بالکل درست رکھتا ہے: کلو آرڈرز میں تُلا ہوا گرام مقدار (ہزارویں حصوں میں) کے برابر ہوتا ہے (62.5 کلو = 62500 گرام)۔')}</p>
        : <Field>{t('Weighed grams (whole)', 'تُلے گئے گرام (پورے)')}<input inputMode="numeric" value={grams} onChange={e => setGrams(e.target.value)} required /></Field>}</div>
    <div className="live-fields"><Field>{t('Cartons', 'کارٹن')}<input inputMode="numeric" value={cartons} onChange={e => setCartons(e.target.value)} /></Field>
      <Field>{t('Cones', 'کونز')}<input inputMode="numeric" value={cones} onChange={e => setCones(e.target.value)} /></Field></div>
    <Field>{t('Carrier', 'کیریئر')}<input value={carrier} onChange={e => setCarrier(e.target.value)} required minLength={2} maxLength={100} /></Field>
    <Field>{t('Package QR codes (one per line, optional)', 'پیکج کوآر (ایک فی لائن، اختیاری)')}<textarea value={packages} onChange={e => setPackages(e.target.value)} dir="ltr" /></Field>
    <Field>{t('Documents note (optional)', 'دستاویز نوٹ (اختیاری)')}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} /></Field>
    <Field>{t('Dispatch time (PKT)', 'روانگی کا وقت (پاکستان)')}<input type="datetime-local" value={dispatchedAt} onChange={e => setDispatchedAt(e.target.value)} required /></Field>
    {canSell(member) && <p className="live-muted">{t('After dispatching, record the delivery to start the payment window.', 'روانگی کے بعد ترسیل درج کریں تاکہ ادائیگی کی مدت شروع ہو۔')}</p>}
  </AsyncForm>;
}

function DeliveryForm({ dispatch, onSaved, onCancel }: { dispatch: SalesDispatch; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const [deliveryDate, setDate] = useState(localFactoryDateValue(Date.now())), [evidenceNote, setNote] = useState('');
  return <AsyncForm title={t('Record delivery', 'ترسیل درج کریں')} detail={dispatch.carrier} submit={t('Confirm delivery', 'ترسیل کی تصدیق کریں')} onCancel={onCancel}
    note={t('Confirming delivery creates the receivable: invoice amount for this delivery, due 30 days later (Pakistan time). It cannot be edited afterwards, only corrected with an audited note.', 'ترسیل کی تصدیق وصولی بناتی ہے: اس ترسیل کی انوائس رقم، ۳۰ دن بعد (پاکستان وقت)۔ اس کے بعد تبدیلی نہیں، صرف باقاعدہ درستگی ہو سکتی ہے۔')}
    onSubmit={async () => { await salesRequest('/deliveries', { id, dispatchId: dispatch.id, deliveryDate: factoryDateValue(deliveryDate), evidenceNote }); await onSaved(t('Delivery recorded. The receivable is due in 30 days.', 'ترسیل درج۔ وصولی ۳۰ دن بعد واجب الادا ہو گی۔')); }}>
    <Field>{t('Delivery date', 'ترسیل کی تاریخ')}<input type="date" value={deliveryDate} onChange={e => setDate(e.target.value)} required min={localFactoryDateValue(dispatch.dispatched_at)} max={localFactoryDateValue(Date.now())} /></Field>
    <Field>{t('Delivery evidence (optional)', 'ترسیل کا ثبوت (اختیاری)')}<textarea value={evidenceNote} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder={t('Signed challan number, receiver name', 'دستخط شدہ چالان نمبر، وصول کنندہ کا نام')} /></Field>
  </AsyncForm>;
}

function CorrectionForm({ delivery, onSaved, onCancel }: { delivery: Overview['deliveries'][number]; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const [deliveryDate, setDate] = useState(localFactoryDateValue(delivery.delivery_date)), [reason, setReason] = useState('');
  return <AsyncForm title={t('Correct the recorded delivery date', 'درج شدہ ترسیل کی تاریخ درست کریں')} submit={t('Save correction', 'درستگی محفوظ کریں')} onCancel={onCancel}
    note={t('The original delivery stays unchanged on record with the correction and its reason; the payment due date moves to the corrected date.', 'اصل ترسیل ریکارڈ پر درستگی اور وجہ کے ساتھ رہے گی؛ ادائیگی کی آخری تاریخ درست تاریخ پر منتقل ہو گی۔')}
    onSubmit={async () => { await salesRequest('/deliveries/correct', { id, deliveryId: delivery.id, deliveryDate: factoryDateValue(deliveryDate), reason }); await onSaved(t('Correction saved. The due date moved with it.', 'درستگی محفوظ۔ آخری تاریخ بھی منتقل ہو گئی۔')); }}>
    <Field>{t('Corrected delivery date', 'درست ترسیل کی تاریخ')}<input type="date" value={deliveryDate} onChange={e => setDate(e.target.value)} required /></Field>
    <Field>{t('Reason for the correction', 'درستگی کی وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={5} maxLength={1000} /></Field>
  </AsyncForm>;
}

function PaymentForm({ receivable, onSaved, onCancel }: { receivable: Receivable; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const [amount, setAmount] = useState(''), [note, setNote] = useState('');
  const outstanding = receivable.amount_minor - receivable.paid_minor;
  return <AsyncForm title={t('Record a payment', 'ادائیگی درج کریں')} detail={receivable.invoice_number ?? ''} submit={t('Save payment', 'ادائیگی محفوظ کریں')} onCancel={onCancel}
    note={t('Payments are immutable once saved. Partial payments are allowed; the receivable settles when fully paid.', 'ادائیگی محفوظ ہونے کے بعد تبدیل نہیں ہوتی۔ جزوی ادائیگی جائز ہے؛ پوری رقم وصول ہونے پر وصولی مکمل ہو گی۔')}
    onSubmit={async () => { await salesRequest('/payments', { id, receivableId: receivable.id, amountMinor: fixedInput(amount, 2, 'Payment amount'), note }); await onSaved(t('Payment recorded.', 'ادائیگی درج ہو گئی۔')); }}>
    <p className="live-muted">{t('Outstanding:', 'باقی:')} <b>{rate(outstanding, receivable.currency)}</b></p>
    <Field>{t('Amount received', 'وصول شدہ رقم')}<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required placeholder={(outstanding / 100).toFixed(2)} /></Field>
    <Field>{t('Reference / note (optional)', 'حوالہ / نوٹ (اختیاری)')}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} /></Field>
  </AsyncForm>;
}
