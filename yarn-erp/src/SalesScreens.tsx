import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, Ban, Banknote, ChartNoAxesCombined, Download, FileText, Receipt, RefreshCw, Send, Truck } from 'lucide-react';
import { AnalyticsSection, BarList, KpiStrip, StackedBar, firstCurrency, type BarRow, type Tone } from './AnalyticsKit';
import { AsyncForm, Field } from './forms';
import { useLanguage } from './i18n';
import { InterventionField, NextStep, ReasonField, SectionTabs, StatusTag, kg, money } from './PortalCommon';
import { inventoryRequest, type Member } from './inventory-client';
import { factoryTime, fixedInput } from './erp-client';
import './sales.css';
import './sales-screens.css';

type Buyer = { id: string; name: string; contact_name: string; email: string; phone: string; city: string; notes: string; status: string; version: number; created_at: number };
type Rfq = { id: string; buyer_id: string; buyer_name: string; reference: string; specifications: string; quantity_milli: number; unit: string; requested_delivery_at: number; payment_terms: string; status: string; state: string; created_at: number };
type Revision = { id: string; buyer_po_id: string; version: number; quantity_milli: number; unit: string; price_minor: number; currency: string; specifications: string; requested_delivery_at: number; payment_terms: string; credit_days: number; note: string; status: string; created_at: number };
type Invoice = { id: string; number: string; sales_order_id: string; buyer_id: string; buyer_name?: string; order_reference?: string; subtotal_minor: number | null; tax_rate_bp: number | null; tax_minor: number | null; total_minor: number; currency: string; issued_at: number; due_at: number | null; payment_terms?: string; credit_days?: number; credited_minor: number; paid_minor: number; outstanding_minor: number; status: string; days_to_due: number | null; alerts: { id: string; kind: string; created_at: number }[] };
type CreditNote = { id: string; invoice_id: string; number: string; amount_minor: number; reason: string; created_at: number };
type SalesState = { buyers: Buyer[]; rfqs: Rfq[]; revisions: Revision[]; orders: { id: string; revision_id: string }[]; invoices: Invoice[]; creditNotes: CreditNote[]; products: { id: string; sku: string; name: string }[]; settings: { currency: string; tax_rate_bp: number } };
type DispatchRecord = { id: string; sales_order_id: string; status: 'pending_approval' | 'approved' | 'on_hold' | 'dispatched' | 'delivered'; order_reference: string; buyer_name: string; product_name: string; lot_batch: string; quantity_milli: number; grams: number; hold_reason: string | null; approval_request_id: string | null; hold_notice_id: string | null; created_at: number; dispatched_at: number | null; delivered_at: number | null };
type StockQuery = { id: string; product_id: string; product_name: string; quantity_milli: number | null; buyer_rfq_id: string | null; question: string; status: string; available_grams: number | null; answer: string | null; created_at: number };
type Props = { member: Member; section: string; tab: string; id: string; navigate: (to: string) => void };
type BuyerSummary = { id: string; name: string; contact_name: string; city: string; status: string; credit_limit_minor: number | null; credit_limit_currency: string | null; sold: { unit: string; quantity_milli: number }[]; invoiced: { currency: string; total_minor: number; invoices: number }[]; outstanding: { currency: string; outstanding_minor: number }[]; overdue: { currency: string; overdue_minor: number }[]; next_due_at: number | null; days_left: number | null; credit_used_minor: number | null; over_limit: boolean };
type SalesSettings = { currency: string; tax_rate_bp: number; invoice_format: string; reminder_hours: number; credit_alert_days: number[] };
type Analytics = { byPeriod: { period: string; currency: string; totalMinor: number }[]; byBuyer: { buyer: string; currency: string; totalMinor: number }[]; byProduct: { product: string | null; currency: string; totalMinor: number }[]; paymentStatus: Record<string, number>; overdueByCurrency: { currency: string; overdueMinor: number }[] };

/** Sections this screen renders; LiveApp routes these to SalesScreens for the sales manager and admin. */
export const SALES_SECTIONS = ['dashboard', 'buyers', 'buyer-rfqs', 'invoices', 'dispatch-requests', 'analytics'];

const owner = ['sales_manager'] as const;
const dateInput = (time: number) => new Date(time + 5 * 60 * 60_000).toISOString().slice(0, 10);
const dateAtNoon = (value: string) => Date.parse(value + 'T12:00:00+05:00');
const dateAtStart = (value: string) => Date.parse(value + 'T00:00:00+05:00');
const amountInput = (minor: number) => (minor / 100).toFixed(2);
const today = () => dateInput(Date.now());
const dueDate = (time: number | null) => time == null ? '—' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium' }).format(time);
const tabs: Record<string, { id: string; en: string; ur: string }[]> = {
  buyers: [{ id: 'pending', en: 'To approve', ur: 'منظوری کے لیے' }, { id: 'active', en: 'Buyers', ur: 'خریدار' }, { id: 'all', en: 'All', ur: 'سب' }, { id: 'settings', en: 'Settings', ur: 'ترتیبات' }],
  'buyer-rfqs': [{ id: 'open', en: 'To quote', ur: 'قیمت دینے کے لیے' }, { id: 'quoted', en: 'Quoted', ur: 'قیمت دی گئی' }, { id: 'sold', en: 'Sold', ur: 'فروخت شدہ' }, { id: 'all', en: 'All', ur: 'سب' }],
  invoices: [{ id: 'owed', en: 'To collect', ur: 'وصولی کے لیے' }, { id: 'paid', en: 'Paid', ur: 'ادا شدہ' }, { id: 'all', en: 'All', ur: 'سب' }],
  'dispatch-requests': [{ id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' }, { id: 'all', en: 'All', ur: 'سب' }],
};
const termOptions = [
  ['payment_overdue', 'Payment overdue', 'ادائیگی کی مدت گزر گئی'],
  ['terms_not_met', 'Terms not met', 'شرائط پوری نہیں ہوئیں'],
  ['other', 'Other', 'دیگر'],
] as const;

export function SalesScreens({ member, section, tab, id, navigate }: Props) {
  const { t } = useLanguage();
  const [state, setState] = useState<SalesState | null>(null);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [queries, setQueries] = useState<StockQuery[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [summaries, setSummaries] = useState<BuyerSummary[]>([]);
  const [salesSettings, setSalesSettings] = useState<SalesSettings | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine), [open, setOpen] = useState('');
  const [intervention, setIntervention] = useState(''), [running, setRunning] = useState('');
  const saleIds = useRef<Record<string, string>>({});
  const [from, setFrom] = useState(() => dateInput(Date.now() - 30 * 86400000)), [to, setTo] = useState(today);
  const allowed = member.role === 'sales_manager' || member.role === 'admin';

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const next = await inventoryRequest<SalesState>('/erp/sales');
      setState(next);
      if (section === 'buyers') setSummaries((await inventoryRequest<{ buyers: BuyerSummary[] }>('/erp/sales/buyers/summary')).buyers);
      if (section === 'buyers' && tab === 'settings') setSalesSettings((await inventoryRequest<{ settings: SalesSettings }>('/erp/sales/settings')).settings);
      if (section === 'buyer-rfqs') setQueries((await inventoryRequest<{ queries: StockQuery[] }>('/erp/stock/queries')).queries);
      if (section === 'dashboard' || section === 'dispatch-requests') setDispatches((await inventoryRequest<{ dispatches: DispatchRecord[] }>('/erp/dispatch')).dispatches);
      if (section === 'analytics') {
        const start = dateAtStart(from), end = dateAtStart(to) + 24 * 60 * 60_000 - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Choose a valid date range.');
        setAnalytics(await inventoryRequest<Analytics>(`/erp/analytics/sales?from=${start}&to=${end}`));
      }
      setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load sales records.'); }
    finally { setLoading(false); }
  }, [section, tab, from, to, allowed]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);

  const saved = async (message: string, urdu: string, path?: string) => { setOpen(''); setNotice(t(message, urdu)); if (path) navigate(path); await load(); };
  const act = async (message: string, urdu: string, run: () => Promise<unknown>, path?: string) => { setError(''); await run(); await saved(message, urdu, path); };
  // Button actions: show the failure and block repeat clicks while one is running.
  const quick = async (key: string, ...args: Parameters<typeof act>) => {
    if (running) return;
    setRunning(key);
    try { await act(...args); } catch (caught) { setError(caught instanceof Error ? caught.message : 'The change was not saved.'); }
    finally { setRunning(''); }
  };
  const salesPost = (path: string, body: unknown) => inventoryRequest(`/erp/sales${path}`, body);
  const dispatchPost = (path: string, body: unknown) => inventoryRequest(`/erp/dispatch${path}`, body);
  const adminIntervention = (value: string) => member.role === 'admin' && value ? { interventionReason: value } : {};

  if (!allowed) return <section className="live-panel" role="alert"><h2>{t('Sales access required', 'فروخت کی رسائی درکار ہے')}</h2><p>{t('Ask an admin to open this screen for your role.', 'ایڈمن سے اپنے کردار کے لیے یہ صفحہ کھولنے کو کہیں۔')}</p></section>;
  if (loading && !state) return <p role="status">{t('Loading sales records…', 'فروخت کا ریکارڈ لوڈ ہو رہا ہے…')}</p>;
  if (!state && error) return <section className="live-panel"><p className="live-error" role="alert">{t(error, 'ریکارڈ لوڈ نہیں ہو سکا۔')}</p><button className="button" onClick={() => void load()}><RefreshCw size={18} aria-hidden="true" />{t('Retry', 'دوبارہ کوشش کریں')}</button></section>;
  if (!state) return null;
  const s: SalesState = state;

  const pendingBuyer = s.buyers.find(buyer => buyer.status === 'pending');
  const openRfq = s.rfqs.find(rfq => rfq.state === 'open');
  const pendingDispatch = dispatches.find(item => item.status === 'pending_approval');
  const overdue = new Map<string, number>();
  for (const invoice of s.invoices.filter(item => item.status === 'overdue')) overdue.set(invoice.currency, (overdue.get(invoice.currency) ?? 0) + invoice.outstanding_minor);
  const selectedInvoice = s.invoices.find(invoice => invoice.id === id);
  // An unknown buyers tab (for example a stale link) falls back to the approval queue instead of an empty page.
  const currentTab = section === 'buyers' ? (tabs.buyers.some(item => item.id === tab) ? tab : 'pending') : tab || (section === 'buyer-rfqs' ? 'open' : section === 'invoices' ? 'owed' : 'pending_approval');
  const alerts = s.invoices.flatMap(invoice => invoice.alerts.map(alert => ({ invoice, alert })));

  const dashboardView = () => {
    const target: [string, string] = pendingBuyer ? ['buyers/' + pendingBuyer.id, 'Review pending buyer'] : openRfq ? ['buyer-rfqs/' + openRfq.id, 'Quote buyer request'] : pendingDispatch ? ['dispatch-requests/' + pendingDispatch.id, 'Review dispatch request'] : ['', 'No sales action is waiting'];
    return <div className="erp-workspace">
      <NextStep tone={target[0] ? 'warn' : 'ok'} title={t(target[1], target[0] ? 'زیرِ التوا فروخت کا اگلا کام' : 'فروخت کا کوئی کام منتظر نہیں')}
        reason={pendingBuyer?.name ?? openRfq?.reference ?? pendingDispatch?.order_reference ?? t('Buyer reviews, quotations and dispatch approvals appear here.', 'خریدار کی جانچ، قیمتیں اور ڈسپیچ کی منظوری یہاں دکھائی دیتی ہے۔')}
        action={target[0] ? <button className="button primary" onClick={() => navigate(target[0])}><ArrowRight size={18} aria-hidden="true" />{t('Open next item', 'اگلا کام کھولیں')}</button> : undefined} />
      <section className="live-panel"><h2>{t('Overdue invoices', 'مدت سے واجب انوائسز')}</h2>{overdue.size ? <ul className="erp-facts">{[...overdue].map(([currency, amount]) => <li key={currency}><span>{t('Outstanding', 'بقایا')} · {currency}</span><strong>{money(amount, currency)}</strong></li>)}</ul> : <p>{t('No overdue invoice balance.', 'کوئی واجب انوائس بقایا نہیں۔')}</p>}</section>
      <section className="live-panel"><h2>{t('Sales at a glance', 'فروخت کا خلاصہ')}</h2><ul className="erp-facts">
        <li><span>{t('Buyers awaiting review', 'جانچ کے منتظر خریدار')}</span><strong>{s.buyers.filter(b => b.status === 'pending').length}</strong></li>
        <li><span>{t('Buyer RFQs to quote', 'قیمت کے منتظر خریدار RFQ')}</span><strong>{s.rfqs.filter(r => r.state === 'open').length}</strong></li>
        <li><span>{t('Invoices still owed', 'بقایا انوائسز')}</span><strong>{s.invoices.filter(i => i.outstanding_minor > 0).length}</strong></li>
      </ul></section>
    </div>;
  };

  const buyerReview = (buyer: Buyer) => open === 'buyer:' + buyer.id && <BuyerReview buyer={buyer} member={member} onCancel={() => setOpen('')}
    onSave={(status, reason, decisionIntervention) => act(t('Buyer review saved.', 'خریدار کی جانچ محفوظ ہوئی۔'), 'خریدار کی جانچ محفوظ ہوئی۔', () => salesPost('/buyers/review', { id: buyer.id, status, version: buyer.version, ...(reason ? { reason } : {}), ...(decisionIntervention ? { interventionReason: decisionIntervention } : {}) }))} />;

  const buyersView = () => {
    if (currentTab === 'settings') return <div className="erp-workspace"><SectionTabs tabs={tabs.buyers} value={currentTab} onChange={value => navigate('buyers/' + value)} />
      <CreditLimitForm key={summaries.length} buyers={summaries} currency={s.settings.currency} member={member}
        onSave={payload => act(t('Credit limit saved.', 'ادھار کی حد محفوظ ہوئی۔'), 'ادھار کی حد محفوظ ہوئی۔', () => salesPost('/buyers/credit-limit', payload))} />
      {salesSettings && <InvoiceSettingsForm key={JSON.stringify(salesSettings)} settings={salesSettings} member={member}
        onSave={(changes, reason) => act(t('Settings saved.', 'ترتیبات محفوظ ہوئیں۔'), 'ترتیبات محفوظ ہوئیں۔', async () => { for (const change of changes) await salesPost('/settings', { ...change, ...(reason ? { interventionReason: reason } : {}) }); })} />}
    </div>;
    if (currentTab !== 'pending') {
      const rows = summaries.filter(row => currentTab === 'all' || row.status === currentTab);
      return <div className="erp-workspace"><SectionTabs tabs={tabs.buyers} value={currentTab} onChange={value => navigate('buyers/' + value)} />
        {rows.length ? <ul className="buyer-list">{rows.map(row => <BuyerPositionRow key={row.id} buyer={row} invoices={s.invoices.filter(invoice => invoice.buyer_id === row.id)}
          expanded={open === 'invoices:' + row.id} onToggle={() => setOpen(open === 'invoices:' + row.id ? '' : 'invoices:' + row.id)} navigate={navigate} />)}</ul>
          : <p className="live-empty">{t('No buyers in this view.', 'اس حصے میں کوئی خریدار نہیں۔')}</p>}
      </div>;
    }
    const filtered = s.buyers.filter(buyer => buyer.status === currentTab);
    const selected = filtered.find(buyer => buyer.id === id);
    return <div className="erp-workspace"><SectionTabs tabs={tabs.buyers} value={currentTab} onChange={value => navigate('buyers/' + value)} />
      {selected ? <section className="live-panel"><div className="live-panel-heading"><div><h2>{selected.name}</h2><p>{selected.contact_name} · {selected.email} · {selected.phone}</p></div><StatusTag status={selected.status} /></div>
        <p>{selected.city || '—'} · {selected.notes || t('No verification note supplied.', 'تصدیق کا نوٹ درج نہیں۔')}</p>
        {selected.status === 'pending' && <button className="button primary" onClick={() => setOpen('buyer:' + selected.id)}><BadgeCheck size={18} aria-hidden="true" />{t('Review buyer', 'خریدار کی جانچ')}</button>}
        {buyerReview(selected)}</section>
        : filtered.length ? <div className="erp-records">{filtered.map(buyer => <article className="erp-record" key={buyer.id}>
          <div className="erp-record-head"><div><h2><button className="live-text-button" onClick={() => navigate('buyers/' + buyer.id)}>{buyer.name}</button></h2><p>{buyer.contact_name} · {buyer.email} · {buyer.city}</p></div><StatusTag status={buyer.status} /></div>
          <p>{buyer.notes || t('No verification note supplied.', 'تصدیق کا نوٹ درج نہیں۔')}</p>
          {buyer.status === 'pending' && <div className="live-actions"><button className="button primary" onClick={() => setOpen(open === 'buyer:' + buyer.id ? '' : 'buyer:' + buyer.id)}><BadgeCheck size={18} aria-hidden="true" />{t('Review buyer', 'خریدار کی جانچ')}</button></div>}
          {buyerReview(buyer)}</article>)}</div>
        : <p className="live-empty">{t('No buyers in this view.', 'اس حصے میں کوئی خریدار نہیں۔')}</p>}
    </div>;
  };

  const buyerRfqsView = () => {
    const filtered = s.rfqs.filter(rfq => currentTab === 'all' || rfq.state === currentTab);
    const selected = filtered.find(rfq => rfq.id === id) ?? s.rfqs.find(rfq => rfq.id === id);
    const newest = selected ? s.revisions.filter(revision => revision.buyer_po_id === selected.id).sort((a, b) => b.version - a.version)[0] : undefined;
    const stockQueries = queries.filter(query => query.buyer_rfq_id === selected?.id);
    return <div className="erp-workspace"><SectionTabs tabs={tabs['buyer-rfqs']} value={currentTab} onChange={value => navigate('buyer-rfqs/' + value)} />
      {selected ? <section className="live-panel"><div className="live-panel-heading"><div><h2>{selected.reference} · {selected.buyer_name}</h2><p>{selected.quantity_milli / 1000} {selected.unit} · {selected.specifications}</p></div><StatusTag status={selected.state} /></div>
        {selected.state === 'awaiting_buyer_approval' && <p className="live-warning">{t('Awaiting buyer approval. A quotation cannot be sent yet.', 'خریدار کی منظوری کا انتظار ہے۔ ابھی قیمت نہیں بھیجی جا سکتی۔')}</p>}
        <dl className="erp-facts"><div><dt>{t('Delivery requested', 'مطلوبہ ترسیل')}</dt><dd>{dueDate(selected.requested_delivery_at)}</dd></div><div><dt>{t('Buyer terms', 'خریدار کی شرائط')}</dt><dd>{selected.payment_terms}</dd></div></dl>
        {selected.state === 'open' && !newest && <button className="button primary" onClick={() => setOpen(open === 'quote:' + selected.id ? '' : 'quote:' + selected.id)}><FileText size={18} aria-hidden="true" />{t('Create quotation', 'قیمت بنائیں')}</button>}
        {newest && <div className="sales-quote"><strong>{t('Quotation', 'قیمت')} · v{newest.version} <StatusTag status={newest.status} /></strong>
          <p>{money(newest.price_minor, newest.currency)} / {selected.unit} · {newest.credit_days} {t('days credit', 'دن ادھار')}</p><p>{newest.specifications} · {newest.payment_terms}</p>
          {newest.status === 'draft' && <><InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
            <button className="button primary" disabled={!!running} onClick={() => void quick('send:' + newest.id, t('Quotation sent to buyer.', 'قیمت خریدار کو بھیج دی گئی۔'), 'قیمت خریدار کو بھیج دی گئی۔', () => salesPost('/quotes/send', { id: newest.id, ...adminIntervention(intervention) }))}><Send size={18} aria-hidden="true" />{t('Send quotation', 'قیمت بھیجیں')}</button></>}
        </div>}
        {newest?.status === 'approved' && !s.orders.some(order => order.revision_id === newest.id) && <div>
          <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
          <button className="button primary" disabled={!!running} onClick={() => void quick('sale:' + newest.id, t('Sale and locked invoice recorded.', 'فروخت اور مقفل انوائس درج ہو گئی۔'), 'فروخت اور مقفل انوائس درج ہو گئی۔', () => salesPost('/sales', { id: (saleIds.current[newest.id] ??= crypto.randomUUID()), revisionId: newest.id, ...adminIntervention(intervention) }), 'invoices')}><Receipt size={18} aria-hidden="true" />{t('Note sale and issue invoice', 'فروخت درج کر کے انوائس جاری کریں')}</button>
        </div>}
        {open === 'quote:' + selected.id && <QuoteForm rfq={selected} currency={s.settings.currency} member={member} products={s.products} onCancel={() => setOpen('')} onSave={payload => act(t('Quotation saved as a draft.', 'قیمت کا مسودہ محفوظ ہوا۔'), 'قیمت کا مسودہ محفوظ ہوا۔', () => salesPost('/quotes', payload))} />}
        <section className="live-panel sales-query"><h3>{t('Check stock availability', 'اسٹاک کی دستیابی معلوم کریں')}</h3>
          <button className="button" onClick={() => setOpen(open === 'query:' + selected.id ? '' : 'query:' + selected.id)}><ArrowRight size={18} aria-hidden="true" />{t('Ask supervisor', 'سپروائزر سے پوچھیں')}</button>
          {open === 'query:' + selected.id && <StockQueryForm rfq={selected} products={s.products} member={member} onCancel={() => setOpen('')} onSave={payload => act(t('Stock question sent to the supervisor.', 'اسٹاک کا سوال سپروائزر کو بھیج دیا گیا۔'), 'اسٹاک کا سوال سپروائزر کو بھیج دیا گیا۔', () => inventoryRequest('/erp/stock/queries', payload))} />}
          {stockQueries.length > 0 && <div className="erp-records">{stockQueries.map(query => <article className="erp-record" key={query.id}><strong>{query.product_name} · {query.quantity_milli === null ? t('Quantity not specified', 'مقدار درج نہیں') : `${query.quantity_milli / 1000} ${selected.unit}`}</strong><p>{query.question}</p>{query.status === 'answered' ? <p role="status">{kg(query.available_grams ?? 0)} · {query.answer}</p> : <StatusTag status={query.status} />}</article>)}</div>}
        </section>
      </section>
        : filtered.length ? <div className="erp-records">{filtered.map(rfq => <article className="erp-record" key={rfq.id}><div className="erp-record-head"><div><h2><button className="live-text-button" onClick={() => navigate('buyer-rfqs/' + rfq.id)}>{rfq.reference} · {rfq.buyer_name}</button></h2><p>{rfq.quantity_milli / 1000} {rfq.unit} · {rfq.specifications}</p></div><StatusTag status={rfq.state} /></div>
          {rfq.state === 'awaiting_buyer_approval' ? <p>{t('Awaiting buyer approval', 'خریدار کی منظوری کا انتظار')}</p> : <button className="button" onClick={() => navigate('buyer-rfqs/' + rfq.id)}><ArrowRight size={18} aria-hidden="true" />{t('Open buyer request', 'خریدار کی درخواست کھولیں')}</button>}</article>)}</div>
        : <p className="live-empty">{t('No buyer RFQs in this view.', 'اس حصے میں خریدار کی کوئی درخواست نہیں۔')}</p>}
    </div>;
  };

  const invoicesView = () => {
    if (selectedInvoice) return <InvoiceDetail invoice={selectedInvoice} creditNotes={s.creditNotes.filter(note => note.invoice_id === selectedInvoice.id)} member={member}
      onPayment={payload => act(t('Payment recorded.', 'ادائیگی درج ہو گئی۔'), 'ادائیگی درج ہو گئی۔', () => salesPost('/payments', payload))}
      onCredit={payload => act(t('Credit note issued.', 'کریڈٹ نوٹ جاری ہو گیا۔'), 'کریڈٹ نوٹ جاری ہو گیا۔', () => salesPost('/credit-notes', payload))} />;
    const filtered = s.invoices.filter(invoice => currentTab === 'all' || (currentTab === 'paid' ? invoice.status === 'paid' : invoice.outstanding_minor > 0));
    return <div className="erp-workspace"><SectionTabs tabs={tabs.invoices} value={currentTab} onChange={value => navigate('invoices/' + value)} />
      {filtered.length ? <div className="erp-records">{filtered.map(invoice => <article className="erp-record" key={invoice.id}><div className="erp-record-head"><div><h2><button className="live-text-button" onClick={() => navigate('invoices/' + invoice.id)}>{invoice.number}</button></h2><p>{invoice.buyer_name} · {invoice.order_reference} · {dueDate(invoice.due_at)}</p></div><StatusTag status={invoice.status} /></div>
        <p>{t('Outstanding', 'بقایا')}: {money(invoice.outstanding_minor, invoice.currency)} · {t('Total', 'کل')}: {money(invoice.total_minor, invoice.currency)}</p>
        <button className="button" onClick={() => navigate('invoices/' + invoice.id)}><FileText size={18} aria-hidden="true" />{t('Open locked invoice', 'مقفل انوائس کھولیں')}</button></article>)}</div>
        : <p className="live-empty">{t('No invoices in this view.', 'اس حصے میں کوئی انوائس نہیں۔')}</p>}
      <section className="live-panel"><h2>{t('Credit alerts', 'ادائیگی کی یاددہانیاں')}</h2>{alerts.length ? <ul className="erp-records">{alerts.map(({ invoice, alert }) => <li className="erp-record" key={alert.id}><strong>{invoice.number} · {invoice.buyer_name}</strong><p><StatusTag status={alert.kind} /> · {money(invoice.outstanding_minor, invoice.currency)} · {dueDate(invoice.due_at)}</p></li>)}</ul> : <p>{t('No credit alerts.', 'ادائیگی کی کوئی یاددہانی نہیں۔')}</p>}</section>
    </div>;
  };

  const dispatchRequestsView = () => {
    const filtered = dispatches.filter(item => currentTab === 'all' || item.status === currentTab);
    const selected = filtered.find(item => item.id === id) ?? dispatches.find(item => item.id === id);
    return <div className="erp-workspace"><SectionTabs tabs={tabs['dispatch-requests']} value={currentTab} onChange={value => navigate('dispatch-requests/' + value)} />
      {selected ? <section className="live-panel"><div className="live-panel-heading"><div><h2>{selected.order_reference} · {selected.buyer_name}</h2><p>{selected.product_name} · {selected.lot_batch} · {kg(selected.grams)}</p></div><StatusTag status={selected.status} /></div>
        <DispatchThread status={selected.status} holdReason={selected.hold_reason} />
        {selected.status === 'pending_approval' && selected.approval_request_id && <>
          <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
          <div className="live-actions"><button className="button primary" disabled={!!running} onClick={() => void quick('approve:' + selected.id, t('Dispatch approved.', 'ڈسپیچ منظور ہو گیا۔'), 'ڈسپیچ منظور ہو گیا۔', () => dispatchPost('/requests/decide', { requestId: selected.approval_request_id, decision: 'approve', ...adminIntervention(intervention) }))}><BadgeCheck size={18} aria-hidden="true" />{t('Approve dispatch', 'ڈسپیچ منظور کریں')}</button>
            <button className="button" onClick={() => setOpen(open === 'hold:' + selected.id ? '' : 'hold:' + selected.id)}><Ban size={18} aria-hidden="true" />{t('Hold dispatch', 'ڈسپیچ روکیں')}</button></div>
        </>}
        {open === 'hold:' + selected.id && <DispatchHoldForm member={member} onCancel={() => setOpen('')} onSave={(term, reason, holdIntervention) => act(t('Dispatch placed on hold.', 'ڈسپیچ روک دی گئی۔'), 'ڈسپیچ روک دی گئی۔', () => dispatchPost('/requests/decide', { requestId: selected.approval_request_id, decision: 'hold', term, reason, ...(holdIntervention ? { interventionReason: holdIntervention } : {}) }))} />}
        {selected.status === 'approved' && <HoldNoticeForm member={member} onCancel={() => setOpen('')} onSave={(term, message, noticeIntervention) => act(t('Hold notice sent to dispatch.', 'ڈسپیچ کو روکنے کا نوٹس بھیج دیا گیا۔'), 'ڈسپیچ کو روکنے کا نوٹس بھیج دیا گیا۔', () => dispatchPost('/hold-notices', { dispatchId: selected.id, term, message, ...(noticeIntervention ? { interventionReason: noticeIntervention } : {}) }))} />}
        <button className="button" onClick={() => navigate('dispatch-requests')}><ArrowRight size={18} aria-hidden="true" />{t('Back to requests', 'درخواستوں کی فہرست')}</button>
      </section>
        : filtered.length ? <div className="erp-records">{filtered.map(item => <article className="erp-record" key={item.id}><div className="erp-record-head"><div><h2><button className="live-text-button" onClick={() => navigate('dispatch-requests/' + item.id)}>{item.order_reference} · {item.buyer_name}</button></h2><p>{item.product_name} · {item.lot_batch} · {kg(item.grams)}</p></div><StatusTag status={item.status} /></div>
          <button className="button" onClick={() => navigate('dispatch-requests/' + item.id)}><Truck size={18} aria-hidden="true" />{t('Review dispatch', 'ڈسپیچ دیکھیں')}</button></article>)}</div>
        : <p className="live-empty">{t('No dispatch requests in this view.', 'اس حصے میں کوئی ڈسپیچ درخواست نہیں۔')}</p>}
    </div>;
  };

  const analyticsView = () => {
    const currency = analytics ? firstCurrency(analytics.byPeriod, analytics.byBuyer, analytics.overdueByCurrency) : undefined;
    const invoiced = analytics && currency ? money(analytics.byPeriod.filter(row => row.currency === currency).reduce((sum, row) => sum + row.totalMinor, 0), currency) : null;
    const overdue = analytics && currency ? money(analytics.overdueByCurrency.find(row => row.currency === currency)?.overdueMinor ?? 0, currency) : null;
    const paymentTone: Record<string, Tone> = { unpaid: 'stone', partially_paid: 'warn', paid: 'ok', overdue: 'bad' };
    const grouped = (rows: { key: string; label: string; currency: string; amount: number }[]): BarRow[] => rows.map(row => ({ key: row.key, label: row.label, value: row.amount, text: money(row.amount, row.currency), group: row.currency }));
    return <div className="ak-page">
      <div className="ak-toolbar">
        <Field>{t('From', 'سے')}<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></Field>
        <Field>{t('To', 'تک')}<input type="date" value={to} onChange={event => setTo(event.target.value)} /></Field>
        <button className="button" onClick={() => void load()} disabled={loading}><ChartNoAxesCombined size={18} aria-hidden="true" />{t('Refresh analytics', 'تجزیہ تازہ کریں')}</button>
      </div>
      {!analytics ? <p role="status">{t('Choose a valid period to load analytics.', 'تجزیے کے لیے درست مدت منتخب کریں۔')}</p> : <>
        <KpiStrip items={[
          { label: t('Total invoiced', 'کل انوائس'), value: invoiced },
          { label: t('Overdue', 'مدت گزر گئی'), value: overdue },
          { label: t('Paid invoices', 'ادا شدہ انوائس'), value: String(analytics.paymentStatus.paid ?? 0) },
          { label: t('Unpaid invoices', 'غیر ادا شدہ انوائس'), value: String(analytics.paymentStatus.unpaid ?? 0) },
        ]} />
        <AnalyticsSection title={t('Sales by month', 'ماہانہ فروخت')}>
          <BarList rows={grouped(analytics.byPeriod.map(row => ({ key: `${row.period}-${row.currency}`, label: row.period, currency: row.currency, amount: row.totalMinor })))} empty={t('No invoiced sales in this period.', 'اس مدت میں کوئی انوائس شدہ فروخت نہیں۔')} />
        </AnalyticsSection>
        <AnalyticsSection title={t('Sales by buyer', 'خریدار کے لحاظ سے فروخت')}>
          <BarList rows={grouped(analytics.byBuyer.map(row => ({ key: `${row.buyer}-${row.currency}`, label: row.buyer, currency: row.currency, amount: row.totalMinor })))} empty={t('No buyer totals in this period.', 'اس مدت میں خریدار کا کوئی مجموعہ نہیں۔')} />
        </AnalyticsSection>
        <AnalyticsSection title={t('Sales by product', 'مصنوعات کے لحاظ سے فروخت')}>
          <BarList rows={grouped(analytics.byProduct.map((row, i) => ({ key: `${row.product}-${row.currency}-${i}`, label: row.product ?? t('Unassigned material', 'غیر مختص مواد'), currency: row.currency, amount: row.totalMinor })))} empty={t('No product totals in this period.', 'اس مدت میں مصنوعات کا کوئی مجموعہ نہیں۔')} />
        </AnalyticsSection>
        <AnalyticsSection title={t('Payment status', 'ادائیگی کی حالت')}>
          <StackedBar segments={Object.entries(analytics.paymentStatus).map(([status, count]) => ({ key: status, label: <StatusTag status={status} />, value: Number(count), text: String(count), tone: paymentTone[status] ?? 'stone' }))} />
        </AnalyticsSection>
      </>}
    </div>;
  };

  return <div className="erp-workspace yf-sales-screens">
    {!online && <p role="status" className="live-warning">{t('Offline. Sales records cannot be changed until the connection returns.', 'آف لائن ہیں۔ رابطہ بحال ہونے تک فروخت کا ریکارڈ تبدیل نہیں ہو سکتا۔')}</p>}
    {error && <p className="live-error" role="alert">{t(error, 'درخواست مکمل نہیں ہو سکی۔ رابطہ جانچ کر دوبارہ کوشش کریں۔')} <button className="live-text-button" onClick={() => void load()}>{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}
    {notice && <p role="status" className="live-success">{notice}</p>}
    <div className="erp-toolbar"><span>{t('Sales records update from the shared factory database.', 'فروخت کا ریکارڈ مشترکہ فیکٹری ڈیٹابیس سے تازہ ہوتا ہے۔')}</span>
      <button className="button" onClick={() => void load()} disabled={loading}><RefreshCw size={18} aria-hidden="true" />{loading ? t('Loading…', 'لوڈ ہو رہا ہے…') : t('Refresh', 'تازہ کریں')}</button></div>
    {loading && <p role="status">{t('Refreshing sales records…', 'فروخت کا ریکارڈ تازہ ہو رہا ہے…')}</p>}
    {section === 'dashboard' && dashboardView()}
    {section === 'buyers' && buyersView()}
    {section === 'buyer-rfqs' && buyerRfqsView()}
    {section === 'invoices' && invoicesView()}
    {section === 'dispatch-requests' && dispatchRequestsView()}
    {section === 'analytics' && analyticsView()}
  </div>;
}

function BuyerReview({ buyer, member, onSave, onCancel }: { buyer: Buyer; member: Member; onCancel: () => void; onSave: (status: string, reason: string, intervention: string) => Promise<void> }) {
  const { t } = useLanguage(); const [decision, setDecision] = useState<'active' | 'rejected'>('active'), [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
  return <AsyncForm title={t('Review buyer', 'خریدار کی جانچ')} detail={buyer.name} submit={decision === 'active' ? t('Approve buyer', 'خریدار منظور کریں') : t('Reject buyer', 'خریدار مسترد کریں')} onSubmit={() => onSave(decision, reason, intervention)} onCancel={onCancel}>
    <Field>{t('Decision', 'فیصلہ')}<select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="active">{t('Approve', 'منظور')}</option><option value="rejected">{t('Reject', 'مسترد')}</option></select></Field>
    {decision === 'rejected' && <ReasonField label={t('Review reason', 'جانچ کی وجہ')} value={reason} onChange={setReason} />}
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

function QuoteForm({ rfq, currency, member, products, onSave, onCancel }: { rfq: Rfq; currency: string; member: Member; products: SalesState['products']; onSave: (data: unknown) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [price, setPrice] = useState(''), [specs, setSpecs] = useState(rfq.specifications), [terms, setTerms] = useState(rfq.payment_terms), [delivery, setDelivery] = useState(dateInput(rfq.requested_delivery_at)), [creditDays, setCreditDays] = useState('30'), [productId, setProductId] = useState(''), [intervention, setIntervention] = useState('');
  return <AsyncForm title={t('Quotation terms', 'قیمت کی شرائط')} detail={t('The factory currency is fixed by settings.', 'فیکٹری کی کرنسی سیٹنگز میں مقرر ہے۔')} submit={t('Save draft quotation', 'قیمت کا مسودہ محفوظ کریں')} onCancel={onCancel}
    onSubmit={async () => onSave({ id: crypto.randomUUID(), poId: rfq.id, priceMinor: fixedInput(price, 2, 'Rate'), specifications: specs, requestedDeliveryAt: dateAtNoon(delivery), paymentTerms: terms, creditDays: Number(creditDays), ...(productId ? { productId } : {}), ...(intervention ? { interventionReason: intervention } : {}) })}>
    <p><strong>{t('Currency', 'کرنسی')}: {currency}</strong></p>
    <Field>{t('Rate per', 'فی شرح')} {rfq.unit} · {currency}<input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} required /></Field>
    <Field>{t('Specifications', 'تفصیلات')}<textarea value={specs} onChange={event => setSpecs(event.target.value)} minLength={5} maxLength={4000} required /></Field>
    <Field>{t('Delivery date', 'ترسیل کی تاریخ')}<input type="date" value={delivery} onChange={event => setDelivery(event.target.value)} required /></Field>
    <Field>{t('Payment terms', 'ادائیگی کی شرائط')}<input value={terms} onChange={event => setTerms(event.target.value)} minLength={3} maxLength={1000} required /></Field>
    <Field>{t('Credit days', 'ادھار کے دن')}<input type="number" min="0" max="365" value={creditDays} onChange={event => setCreditDays(event.target.value)} required /></Field>
    <Field>{t('Material, if specified', 'مواد، اگر طے ہو')}<select value={productId} onChange={event => setProductId(event.target.value)}><option value="">{t('Not assigned', 'مختص نہیں')}</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

function StockQueryForm({ rfq, products, member, onSave, onCancel }: { rfq: Rfq; products: SalesState['products']; member: Member; onSave: (data: unknown) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [productId, setProductId] = useState(products[0]?.id ?? ''), [question, setQuestion] = useState(t('Please confirm stock availability for this buyer request.', 'براہ کرم اس خریدار کی درخواست کے لیے اسٹاک کی دستیابی کی تصدیق کریں۔')), [intervention, setIntervention] = useState('');
  return <AsyncForm title={t('Stock availability question', 'اسٹاک کی دستیابی کا سوال')} submit={t('Send to supervisor', 'سپروائزر کو بھیجیں')} onCancel={onCancel}
    onSubmit={async () => { if (!productId) throw new Error('Choose a material first.'); await onSave({ id: crypto.randomUUID(), productId, quantityMilli: rfq.quantity_milli, buyerRfqId: rfq.id, question, ...(intervention ? { interventionReason: intervention } : {}) }); }}>
    <Field>{t('Material', 'مواد')}<select value={productId} onChange={event => setProductId(event.target.value)} required>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>
    <Field>{t('Question', 'سوال')}<textarea minLength={5} maxLength={1000} value={question} onChange={event => setQuestion(event.target.value)} required /></Field>
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

function InvoiceDetail({ invoice, creditNotes, member, onPayment, onCredit }: { invoice: Invoice; creditNotes: CreditNote[]; member: Member; onPayment: (data: unknown) => Promise<void>; onCredit: (data: unknown) => Promise<void> }) {
  const { t } = useLanguage(); const [open, setOpen] = useState(''), [payment, setPayment] = useState(amountInput(invoice.outstanding_minor)), [received, setReceived] = useState(today()), [paymentNote, setPaymentNote] = useState(''), [credit, setCredit] = useState(''), [creditReason, setCreditReason] = useState(''), [intervention, setIntervention] = useState('');
  return <section className="live-panel"><div className="live-panel-heading"><div><h2>{invoice.number}</h2><p>{invoice.buyer_name} · {invoice.order_reference} · {factoryTime(invoice.issued_at)}</p></div><StatusTag status={invoice.status} /></div>
    <section className="sales-invoice"><h3>{t('Locked invoice', 'مقفل انوائس')}</h3>
      <dl className="erp-facts">
        <div><dt>{t('Subtotal', 'ذیلی کل')}</dt><dd>{invoice.subtotal_minor == null ? '—' : money(invoice.subtotal_minor, invoice.currency)}</dd></div>
        <div><dt>{t(`GST (${(invoice.tax_rate_bp ?? 0) / 100}%)`, `جی ایس ٹی (${(invoice.tax_rate_bp ?? 0) / 100}%)`)}</dt><dd>{invoice.tax_minor == null ? '—' : money(invoice.tax_minor, invoice.currency)}</dd></div>
        <div><dt>{t('Total', 'کل')}</dt><dd>{money(invoice.total_minor, invoice.currency)}</dd></div>
        <div><dt>{t('Due date', 'آخری تاریخ')}</dt><dd>{dueDate(invoice.due_at)}</dd></div>
        <div><dt>{t('Paid', 'ادا شدہ')}</dt><dd>{money(invoice.paid_minor, invoice.currency)}</dd></div>
        <div><dt>{t('Credit notes', 'کریڈٹ نوٹس')}</dt><dd>{money(invoice.credited_minor, invoice.currency)}</dd></div>
        <div><dt>{t('Outstanding', 'بقایا')}</dt><dd>{money(invoice.outstanding_minor, invoice.currency)}</dd></div>
      </dl>
      <a className="button" href={`/api/erp/sales/invoices/${encodeURIComponent(invoice.id)}`} download><Download size={18} aria-hidden="true" />{t('Download invoice', 'انوائس ڈاؤن لوڈ کریں')}</a></section>
    <section className="live-panel"><h3>{t('Credit notes', 'کریڈٹ نوٹس')}</h3>
      {creditNotes.length ? creditNotes.map(note => <article className="erp-record" key={note.id}><strong>{note.number} · {money(note.amount_minor, invoice.currency)}</strong><p>{note.reason} · {dueDate(note.created_at)}</p></article>) : <p>{t('No credit notes.', 'کوئی کریڈٹ نوٹ نہیں۔')}</p>}
      {invoice.outstanding_minor > 0 && <button className="button" onClick={() => setOpen(open === 'credit' ? '' : 'credit')}><FileText size={18} aria-hidden="true" />{t('Issue credit note', 'کریڈٹ نوٹ جاری کریں')}</button>}
      {open === 'credit' && <AsyncForm title={t('Credit note', 'کریڈٹ نوٹ')} submit={t('Issue credit note', 'کریڈٹ نوٹ جاری کریں')} onCancel={() => setOpen('')}
        onSubmit={() => onCredit({ id: crypto.randomUUID(), invoiceId: invoice.id, amountMinor: fixedInput(credit, 2, 'Credit amount'), reason: creditReason, ...(intervention ? { interventionReason: intervention } : {}) })}>
        <Field>{t('Credit amount', 'کریڈٹ کی رقم')} · {invoice.currency}<input inputMode="decimal" value={credit} onChange={event => setCredit(event.target.value)} required /></Field>
        <ReasonField label={t('Reason', 'وجہ')} value={creditReason} onChange={setCreditReason} />
        <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
      </AsyncForm>}
    </section>
    <section className="live-panel"><h3>{t('Payment tracking', 'ادائیگی کا ریکارڈ')}</h3>
      <p>{t('Due', 'آخری تاریخ')}: {dueDate(invoice.due_at)} · {t('Outstanding', 'بقایا')}: {money(invoice.outstanding_minor, invoice.currency)}</p>
      {invoice.outstanding_minor > 0 && <button className="button primary" onClick={() => setOpen(open === 'payment' ? '' : 'payment')}><Banknote size={18} aria-hidden="true" />{t('Record payment', 'ادائیگی درج کریں')}</button>}
      {open === 'payment' && <AsyncForm title={t('Record payment', 'ادائیگی درج کریں')} submit={t('Save payment', 'ادائیگی محفوظ کریں')} onCancel={() => setOpen('')}
        onSubmit={() => onPayment({ id: crypto.randomUUID(), invoiceId: invoice.id, amountMinor: fixedInput(payment, 2, 'Payment amount'), receivedAt: dateAtNoon(received), note: paymentNote, ...(intervention ? { interventionReason: intervention } : {}) })}>
        <Field>{t('Amount received', 'وصول شدہ رقم')} · {invoice.currency}<input inputMode="decimal" value={payment} onChange={event => setPayment(event.target.value)} required /></Field>
        <Field>{t('Received on', 'وصولی کی تاریخ')}<input type="date" value={received} onChange={event => setReceived(event.target.value)} required /></Field>
        <Field>{t('Note', 'نوٹ')}<input value={paymentNote} onChange={event => setPaymentNote(event.target.value)} maxLength={2000} /></Field>
        <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
      </AsyncForm>}
    </section>
  </section>;
}

function DispatchHoldForm({ member, onSave, onCancel }: { member: Member; onSave: (term: string, reason: string, intervention: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [term, setTerm] = useState('payment_overdue'), [reason, setReason] = useState(''), [intervention, setIntervention] = useState('');
  return <AsyncForm title={t('Hold dispatch', 'ڈسپیچ روکیں')} submit={t('Place on hold', 'روکیں')} onCancel={onCancel} onSubmit={() => onSave(term, reason, intervention)}>
    <Field>{t('Hold term', 'روکنے کی شرط')}<select value={term} onChange={event => setTerm(event.target.value)}>{termOptions.map(([value, en, ur]) => <option key={value} value={value}>{t(en, ur)}</option>)}</select></Field>
    <ReasonField label={t('Reason', 'وجہ')} value={reason} onChange={setReason} />
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

function HoldNoticeForm({ member, onSave, onCancel }: { member: Member; onSave: (term: string, message: string, intervention: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [term, setTerm] = useState('terms_not_met'), [message, setMessage] = useState(''), [intervention, setIntervention] = useState('');
  return <AsyncForm title={t('Send a hold notice to dispatch', 'ڈسپیچ کو روکنے کا نوٹس بھیجیں')} submit={t('Send hold notice', 'نوٹس بھیجیں')} onCancel={onCancel} onSubmit={() => onSave(term, message, intervention)}>
    <Field>{t('Hold term', 'روکنے کی شرط')}<select value={term} onChange={event => setTerm(event.target.value)}>{termOptions.map(([value, en, ur]) => <option key={value} value={value}>{t(en, ur)}</option>)}</select></Field>
    <Field>{t('Message', 'پیغام')}<textarea minLength={1} maxLength={1000} value={message} onChange={event => setMessage(event.target.value)} required /></Field>
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

function DispatchThread({ status, holdReason }: { status: DispatchRecord['status']; holdReason: string | null }) {
  const { t } = useLanguage(); const nodes = ['pending_approval', 'approved', 'dispatched', 'delivered'] as const; const index = nodes.indexOf(status as typeof nodes[number]);
  return <div className="yf-dispatch-thread" aria-label={t('Dispatch status history', 'ڈسپیچ کی حالت کی تاریخ')}>
    <ol>{nodes.map((node, i) => <li key={node} className={i <= index ? 'done' : ''} aria-current={node === status ? 'step' : undefined}><span aria-hidden="true">{i + 1}</span><StatusTag status={node} /></li>)}</ol>
    {status === 'on_hold' && <p className="live-warning"><StatusTag status="on_hold" /> · {holdReason}</p>}
  </div>;
}

function BuyerPositionRow({ buyer, invoices, expanded, onToggle, navigate }: { buyer: BuyerSummary; invoices: Invoice[]; expanded: boolean; onToggle: () => void; navigate: (to: string) => void }) {
  const { t } = useLanguage();
  const days = buyer.days_left;
  const dueTone = days === null ? '' : days < 0 ? 'is-bad' : days <= 7 ? 'is-warn' : '';
  const dueText = days === null ? t('Nothing due', 'کوئی واجب رقم نہیں')
    : days < 0 ? t(`${-days} ${-days === 1 ? 'day' : 'days'} overdue`, `${-days} دن کی تاخیر`)
    : days === 0 ? t('Due today', 'آج واجب ہے')
    : t(`Due in ${days} ${days === 1 ? 'day' : 'days'}`, `${days} دن میں واجب`);
  const limit = buyer.credit_limit_minor, limitCurrency = buyer.credit_limit_currency, used = buyer.credit_used_minor ?? 0;
  const pct = !limit ? (used > 0 ? 100 : 0) : Math.min(100, (used / limit) * 100);
  const list = (values: string[]) => values.length ? values.join(' · ') : '—';
  return <li className="buyer-row">
    <div className="buyer-row-head"><div><h2>{buyer.name}</h2><p>{buyer.contact_name}{buyer.city ? ` · ${buyer.city}` : ''}</p></div><StatusTag status={buyer.status} /></div>
    <dl className="buyer-facts">
      <div><dt>{t('Total sold', 'کل فروخت')}</dt><dd>{buyer.sold.length ? buyer.sold.map(line => `${line.quantity_milli / 1000} ${line.unit}`).join(' · ') : t('Nothing sold yet', 'ابھی کوئی فروخت نہیں')}</dd></div>
      <div><dt>{t('Invoiced', 'انوائس شدہ')}</dt><dd>{list(buyer.invoiced.map(row => money(row.total_minor, row.currency)))}</dd></div>
      <div><dt>{t('Outstanding', 'بقایا')}</dt><dd>{list(buyer.outstanding.map(row => money(row.outstanding_minor, row.currency)))}</dd></div>
      {buyer.overdue.length > 0 && <div><dt>{t('Overdue', 'مدت گزر گئی')}</dt><dd className="is-bad">{list(buyer.overdue.map(row => money(row.overdue_minor, row.currency)))}</dd></div>}
      <div><dt>{t('Next payment', 'اگلی ادائیگی')}</dt><dd className={dueTone}>{dueText}{buyer.next_due_at !== null && ` · ${dueDate(buyer.next_due_at)}`}</dd></div>
    </dl>
    {limit === null || limitCurrency === null ? <p className="buyer-credit-note">{t('No credit limit set.', 'ادھار کی کوئی حد مقرر نہیں۔')}</p>
      : <div className="buyer-credit">
        <div className="buyer-credit-head"><span>{t('Credit used', 'استعمال شدہ ادھار')}: {money(used, limitCurrency)} / {money(limit, limitCurrency)}</span>{buyer.over_limit && <span className="buyer-over">{t('Over limit', 'حد سے زیادہ')}</span>}</div>
        <div className={`buyer-meter${buyer.over_limit ? ' is-warn' : ''}`} role="img" aria-label={`${t('Credit used', 'استعمال شدہ ادھار')}: ${Math.round(pct)}%`}><span style={{ width: `${pct}%` }} /></div>
      </div>}
    <div><button className="live-text-button" aria-expanded={expanded} onClick={onToggle}>{t('Invoices', 'انوائسز')} ({invoices.length})</button></div>
    {expanded && <ul className="buyer-invoices">{invoices.length ? invoices.map(invoice => <li key={invoice.id}><button className="live-text-button" onClick={() => navigate('invoices/' + invoice.id)}>{invoice.number}</button>
      <span>{money(invoice.outstanding_minor, invoice.currency)} {t('outstanding', 'بقایا')} · {dueDate(invoice.due_at)}</span></li>) : <li>{t('No invoices yet.', 'ابھی کوئی انوائس نہیں۔')}</li>}</ul>}
  </li>;
}

function CreditLimitForm({ buyers, currency, member, onSave }: { buyers: BuyerSummary[]; currency: string; member: Member; onSave: (payload: unknown) => Promise<void> }) {
  const { t } = useLanguage(); const first = buyers[0];
  const [buyerId, setBuyerId] = useState(first?.id ?? ''), [amount, setAmount] = useState(first?.credit_limit_minor == null ? '' : amountInput(first.credit_limit_minor)),
    [limitCurrency, setLimitCurrency] = useState(first?.credit_limit_currency ?? currency), [clear, setClear] = useState(false), [intervention, setIntervention] = useState('');
  const pick = (next: string) => {
    const buyer = buyers.find(item => item.id === next);
    setBuyerId(next); setClear(false); setAmount(buyer?.credit_limit_minor == null ? '' : amountInput(buyer.credit_limit_minor)); setLimitCurrency(buyer?.credit_limit_currency ?? currency);
  };
  if (!buyers.length) return <section className="live-panel"><h2>{t('Credit limit per buyer', 'خریدار کے مطابق ادھار کی حد')}</h2><p className="live-empty">{t('No buyers yet.', 'ابھی کوئی خریدار نہیں۔')}</p></section>;
  return <AsyncForm title={t('Credit limit per buyer', 'خریدار کے مطابق ادھار کی حد')} detail={t('A warning only. Quotations and invoices are never blocked.', 'صرف انتباہ۔ قیمتیں اور انوائسز کبھی نہیں رکتیں۔')} submit={t('Save credit limit', 'ادھار کی حد محفوظ کریں')}
    onSubmit={() => onSave({ id: buyerId, ...(clear ? { amountMinor: null } : { amountMinor: fixedInput(amount, 2, 'Credit limit'), currency: limitCurrency }), ...(intervention ? { interventionReason: intervention } : {}) })}>
    <Field>{t('Buyer', 'خریدار')}<select value={buyerId} onChange={event => pick(event.target.value)}>{buyers.map(buyer => <option key={buyer.id} value={buyer.id}>{buyer.name}</option>)}</select></Field>
    <label className="buyer-clear"><input type="checkbox" checked={clear} onChange={event => setClear(event.target.checked)} /> {t('Clear the limit (no limit for this buyer)', 'حد ہٹائیں (اس خریدار کی کوئی حد نہیں)')}</label>
    <Field>{t('Credit limit', 'ادھار کی حد')}<input inputMode="decimal" value={amount} disabled={clear} required={!clear} onChange={event => setAmount(event.target.value)} /></Field>
    <Field>{t('Currency', 'کرنسی')}<select value={limitCurrency} disabled={clear} onChange={event => setLimitCurrency(event.target.value)}>{['PKR', 'USD', 'EUR', 'GBP'].map(code => <option key={code} value={code}>{code}</option>)}</select></Field>
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

function InvoiceSettingsForm({ settings, member, onSave }: { settings: SalesSettings; member: Member; onSave: (changes: { key: string; value: unknown }[], reason: string) => Promise<void> }) {
  const { t } = useLanguage();
  const [currency, setCurrency] = useState(settings.currency), [gst, setGst] = useState(String(settings.tax_rate_bp / 100)), [format, setFormat] = useState(settings.invoice_format),
    [hours, setHours] = useState(String(settings.reminder_hours)), [days, setDays] = useState(settings.credit_alert_days.join(', ')), [intervention, setIntervention] = useState('');
  return <AsyncForm title={t('Invoice and factory settings', 'انوائس اور فیکٹری کی ترتیبات')} submit={t('Save settings', 'ترتیبات محفوظ کریں')} onSubmit={() => {
    // Only changed keys are sent, one at a time; the server validates each value with the admin rules.
    const changes: { key: string; value: unknown }[] = [], rate = Math.round(Number(gst) * 100), creditDays = days.split(',').map(item => item.trim()).filter(Boolean).map(Number);
    if (currency !== settings.currency) changes.push({ key: 'currency', value: currency });
    if (rate !== settings.tax_rate_bp) changes.push({ key: 'tax_rate_bp', value: rate });
    if (format !== settings.invoice_format) changes.push({ key: 'invoice_format', value: format });
    if (Number(hours) !== settings.reminder_hours) changes.push({ key: 'reminder_hours', value: Number(hours) });
    if (creditDays.join() !== settings.credit_alert_days.join()) changes.push({ key: 'credit_alert_days', value: creditDays });
    return onSave(changes, intervention);
  }}>
    <Field>{t('Currency', 'کرنسی')}<select value={currency} onChange={event => setCurrency(event.target.value)}>{['PKR', 'USD', 'EUR', 'GBP'].map(code => <option key={code} value={code}>{code}</option>)}</select></Field>
    <Field>{t('GST (%)', 'جی ایس ٹی (%)')}<input type="number" min="0" max="100" step="0.01" value={gst} onChange={event => setGst(event.target.value)} /></Field>
    <Field>{t('Invoice number format', 'انوائس نمبر کی ترتیب')}<input value={format} onChange={event => setFormat(event.target.value)} /></Field>
    <Field>{t('Reminder hours', 'یاددہانی کے گھنٹے')}<input type="number" min="1" max="720" value={hours} onChange={event => setHours(event.target.value)} /></Field>
    <Field>{t('Credit alert days (comma separated)', 'ادھار یاددہانی کے دن')}<input value={days} onChange={event => setDays(event.target.value)} /></Field>
    <InterventionField member={member} owners={[...owner]} value={intervention} onChange={setIntervention} />
  </AsyncForm>;
}

export default SalesScreens;
