import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, LogOut, RefreshCw, Truck } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { LanguageSelect, useLanguage } from './i18n';
import { factoryInput, fixedInput, localFactoryInput, factoryTime, quantity, rate } from './erp-client';
import { Cone } from './Cone';
import { InventoryError } from './inventory-client';
import {
  buyerRequest,
  type BuyerIdentity, type BuyerWorkspace, type QuoteRevision,
} from './sales-client';
import { PdfDownloadButton } from './InvoiceDocument';
import { invoiceDocData, type BuyerSource, type InvoiceSource, type SaleLineSource } from './invoice-pdf';
import './erp.css';

type BuyerInvoiceResponse = { invoice: InvoiceSource; lines: SaleLineSource[]; buyer: BuyerSource; factoryName: string };
/** The buyer's own invoice with its balance, from the buyer invoice route; the PDF is built here from that data. */
const buyerInvoiceDocument = async (invoiceId: string) => {
  const result = await buyerRequest<BuyerInvoiceResponse>(`/invoices/${encodeURIComponent(invoiceId)}?format=json`);
  return invoiceDocData(result.invoice, result.lines, result.buyer, result.factoryName);
};

export default function BuyerPortal() {
  const { t } = useLanguage();
  const [identity, setIdentity] = useState<BuyerIdentity | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [config, setConfig] = useState<{ factory: string; registrationAvailable: boolean } | null>(null);
  const [mode, setMode] = useState<'login' | 'register' | 'sent'>('login');
  const [state, setState] = useState<BuyerWorkspace | null>(null), [open, setOpen] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const me = await buyerRequest<BuyerIdentity>('/me'); setIdentity(me);
      if (me.buyer.status === 'active') setState(await buyerRequest<BuyerWorkspace>('/workspace')); else setState(null);
      setError('');
    } catch (e) {
      if (e instanceof InventoryError && e.status === 401) { setIdentity(null); setState(null); } else setError(errorMessage(e));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void buyerRequest<typeof config>('/config').then(setConfig).catch(() => setConfig(null)); void load(); }, [load]);
  useEffect(() => {
    const focus = () => { if (!document.hidden) void load(); };
    const timer = setInterval(focus, 30000); window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [load]);
  const saved = async (message?: string) => { setOpen(''); setNotice(message ?? t('Saved.', 'محفوظ ہو گیا۔')); await load(); };
  const signOut = async () => { try { await buyerRequest('/logout', {}); setIdentity(null); setState(null); setNotice(''); } catch (e) { setError(errorMessage(e)); } };
  return <div className="erp-portal"><header className="erp-portal-header">
    <a href="#/overview" className="live-brand"><Cone size={28} hue="#2f6fd6" />yarnflow</a>
    <span>{t('Buyer portal', 'خریدار پورٹل')}</span><LanguageSelect />
    {identity && <button className="button" onClick={signOut}><LogOut size={18} />{t('Sign out', 'سائن آؤٹ')}</button>}
  </header>
   <main className={`erp-portal-main${!identity ? ' is-auth' : ''}`}>
    <div className="live-page-heading"><div><h1>{identity ? identity.buyer.name : t('Buy from our factory', 'ہماری فیکٹری سے خریداری کریں')}</h1>
      <p>{config?.factory || 'Yarnflow'} · {t('Your purchase orders, quotes and invoices', 'آپ کے آرڈرز، کوٹیشنز اور انوائسز')}</p></div>
     {identity && <button className="button" onClick={() => void load()}><RefreshCw size={18} />{t('Refresh', 'تازہ کریں')}</button>}</div>
    {error && <p className="live-error" role="alert">{t(error)}<button className="live-text-button" onClick={() => void load()}>{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}
    {notice && <p className="live-success" role="status">{notice}</p>}
    {loading ? <p role="status">{t('Opening your portal…', 'آپ کا پورٹل کھل رہا ہے…')}</p> : !identity ? <>
      <div className="live-segments" aria-label={t('Buyer account', 'خریدار اکاؤنٹ')}>
        <button aria-pressed={mode !== 'register'} onClick={() => setMode('login')}>{t('Buyer sign in', 'خریدار سائن اِن')}</button>
        <button aria-pressed={mode === 'register'} onClick={() => setMode('register')}>{t('Register company', 'کمپنی رجسٹر کریں')}</button></div>
      {mode === 'sent' && <p className="live-success" role="status">{t('Registration saved. Sign in to check your approval status.', 'رجسٹریشن محفوظ ہو گئی۔ منظوری کی حالت دیکھنے کے لیے سائن اِن کریں۔')}</p>}
      {mode === 'register' ? config?.registrationAvailable ? <BuyerRegistration onSent={() => setMode('sent')} />
        : <p>{t('Registration is not available for this factory. Contact the factory sales team.', 'اس فیکٹری کے لیے رجسٹریشن دستیاب نہیں۔ فیکٹری کی فروخت ٹیم سے رابطہ کریں۔')}</p>
        : <BuyerLogin onSignedIn={load} />}
      <a href="#/overview" className="button">{t('Factory team sign in', 'فیکٹری ٹیم سائن اِن')}</a>
    </> : identity.buyer.status !== 'active' ? <section className="live-panel erp-approval">
      <FileText size={36} />
      <h2>{t(identity.buyer.status === 'pending' ? 'Waiting for the sales team to activate your company' : 'Your company access is not active',
        identity.buyer.status === 'pending' ? 'فروخت ٹیم کی جانب سے آپ کی کمپنی کے فعال ہونے کا انتظار' : 'آپ کی کمپنی کی رسائی فعال نہیں')}</h2>
      <p>{t('The factory sales team reviews your company details. Quotes, orders and invoices appear here after activation. Your assigned sales manager is shown once active.',
        'فیکٹری کی فروخت ٹیم آپ کی کمپنی کی تفصیلات کا جائزہ لیتی ہے۔ فعال ہونے کے بعد کوٹیشنز، آرڈرز اور انوائسز یہاں نظر آئیں گے۔ مقررہ مینیگر فعال ہونے پر دکھے گا۔')}</p>
      <p className="live-muted">{identity.buyer.manager_name ? t('Sales manager:', 'فروخت مینیجر:').replace(':', '') + ' ' + identity.buyer.manager_name : ''}</p>
    </section> : state && <>
      <QuotesToApprove state={state} open={open} setOpen={setOpen} saved={saved} />
      <section className="live-panel"><h2>{t('Your purchase orders', 'آپ کے پرچیز آرڈرز')}</h2>
        {!state.pos.length && <p className="live-muted">{t('No purchase orders yet. Submit one from this screen; the factory quotes it.', 'ابھی کوئی آرڈر نہیں۔ اس اسکرین سے جمع کروائیں؛ فیکٹری کوٹیشن دے گی۔')}</p>}
        {open === 'po:new' ? <BuyerPoForm onSaved={saved} onCancel={() => setOpen('')} /> :
          <button className="button primary" onClick={() => setOpen('po:new')}>{t('Submit a purchase order', 'پرچیز آرڈر جمع کروائیں')}</button>}
        <div className="erp-records">{state.pos.map(p => <article className="erp-record" key={p.id}>
          <div className="erp-record-head"><div><h3>{p.reference}</h3><p>{quantity(p.quantity_milli)} {p.unit} · {t('requested', 'مطلوبہ')} {factoryTime(p.requested_delivery_at)}</p></div>
            <span className="erp-status">{t(p.status, { entered: 'موصول', quoted: 'کوٹیشن موصول', confirmed: 'مستقل', cancelled: 'منسوخ' }[p.status])}</span></div>
          <p className="erp-multiline">{p.specifications}</p><p className="live-muted">{t('Our payment terms:', 'ہماری ادائیگی کی شرائط:')} {p.payment_terms}</p>
        </article>)}</div>
      </section>
      <section className="live-panel"><h2>{t('Confirmed orders and invoices', 'مستقل آرڈرز اور انوائسز')}</h2>
        {!state.orders.length && <p className="live-muted">{t('Approved quotes appear here as confirmed orders with one invoice.', 'منظور شدہ کوٹیشنز یہاں مستقل آرڈرز کے طور پر ایک انوائس کے ساتھ نظر آئیں گے۔')}</p>}
        <div className="erp-records">{state.orders.map(o => <article className="erp-record" key={o.id}>
          <div className="erp-record-head"><div><h3>{o.reference}</h3><p>{t('Approved', 'منظور')} {factoryTime(o.terms.approved_at)} · {t('revision', 'ترمیم')} {o.terms.revision}</p></div>
            <span className="erp-status">{t(o.status, { confirmed: 'مستقل', partially_dispatched: 'جزوی روانگی', dispatched: 'روانہ', cancelled: 'منسوخ' }[o.status])}</span></div>
          <p>{quantity(o.terms.quantity_milli)} {o.terms.unit} × {rate(o.terms.price_minor, o.terms.currency)} = <b>{rate(o.terms.price_minor * o.terms.quantity_milli / 1000, o.terms.currency)}</b></p>
          <p className="live-muted">{t('Payment terms:', 'ادائیگی کی شرائط:')} {o.terms.payment_terms} · {t('requested delivery', 'مطلوبہ ترسیل')} {factoryTime(o.terms.requested_delivery_at)}</p>
          {state.invoices.filter(i => i.sales_order_id === o.id).map(i => <div className="sales-invoice" key={i.id}>
            <div className="erp-record-head"><div><h4><FileText size={18} /> {i.number}</h4><p>{rate(i.total_minor, i.currency)} · {factoryTime(i.issued_at)}</p></div>
              <PdfDownloadButton build={() => buyerInvoiceDocument(i.id)} /></div>
            <ul className="sales-lines">{(JSON.parse(i.lines_json) as { specifications: string; quantity_milli: number; unit: string; price_minor: number; amount_minor: number }[]).map((l, n) =>
              <li key={n}><span className="erp-multiline">{l.specifications}</span><span>{quantity(l.quantity_milli)} {l.unit} × {rate(l.price_minor, i.currency)} = <b>{rate(l.amount_minor, i.currency)}</b></span></li>)}</ul>
          </div>)}
          {state.dispatches.filter(d => d.sales_order_id === o.id).map(d => <div className="sales-dispatch" key={d.id}>
            <strong><Truck size={18} /> {quantity(d.quantity_milli)} {d.unit} · {d.carrier}</strong>
            <span>{t('Dispatched', 'روانہ')} {factoryTime(d.dispatched_at)}</span>
            {state.deliveries.filter(y => y.dispatch_id === d.id).map(y => <span key={y.id} className="live-muted">
              {t('Delivered', 'ترسیل')} {factoryTime(y.delivery_date)}{y.evidence_note ? ' · ' + y.evidence_note : ''}</span>)}
          </div>)}
        </article>)}</div>
      </section>
      <section className="live-panel"><h2>{t('Your account', 'آپ کا حساب')}</h2>
        {!state.receivables.length && <p className="live-muted">{t('Amounts appear when a delivery is confirmed. Payment is due 30 days after each delivery.', 'ترسیل کی تصدیق کے بعد رقم نظر آئے گی۔ ہر ترسیل سے ۳۰ دن بعد ادائیگی۔')}</p>}
        <div className="erp-records">{state.receivables.map(r => <article className="erp-record" key={r.id}>
          <div className="erp-record-head"><div><h3>{state.invoices.find(i => i.id === r.invoice_id)?.number ?? r.invoice_id}</h3>
            <p>{rate(r.amount_minor, r.currency)} · {t('paid', 'وصول')} {rate(r.paid_minor, r.currency)}</p></div>
            <span className={`erp-status is-${r.status}`}>{r.status === 'settled' ? t('Settled', 'مکمل وصول') : t('Open', 'بقایا')}</span></div>
          <p className="live-muted">{t('Due', 'آخری تاریخ')} {factoryTime(r.due_at)} · {t('revision', 'ترمیم')} {r.due_revision}</p>
          {state.payments.filter(p => p.invoice_id === r.invoice_id).map(p => <p className="live-muted" key={p.id}>
            {t('Payment', 'ادائیگی')} {rate(p.amount_minor, p.currency)} · {factoryTime(p.created_at)}</p>)}
        </article>)}</div>
      </section>
    </>}
   </main></div>;
}

function QuotesToApprove({ state, open, setOpen, saved }: { state: BuyerWorkspace; open: string; setOpen: (v: string) => void; saved: (message?: string) => Promise<void> }) {
  const { t } = useLanguage();
  const sent = state.revisions.filter(r => r.status === 'sent');
  return <section className="live-panel"><h2>{t('Quotes waiting for your approval', 'منظوری کے انتظار میں کوٹیشنز')}</h2>
    {!sent.length && <p className="live-muted">{t('Nothing to approve right now. New quotes from the factory appear here.', 'ابھی منظوری کے لیے کچھ نہیں۔ فیکٹری کے نئے کوٹیشنز یہاں آئیں گے۔')}</p>}
    <div className="erp-records">{sent.map(r => {
      const po = state.pos.find(p => p.id === r.buyer_po_id); const approved = state.revisions.some(x => x.status === 'approved' && x.buyer_po_id === r.buyer_po_id);
      const stale = state.revisions.some(x => x.buyer_po_id === r.buyer_po_id && x.version > r.version);
      if (approved || stale) return null;
      return <article className="erp-record" key={r.id}>
        <div className="erp-record-head"><div><h3>{po?.reference} · {t('revision', 'ترمیم')} {r.version}</h3>
          <p>{rate(r.price_minor, r.currency)} / {r.unit} · {t('total', 'کل')} <b>{rate(r.price_minor * r.quantity_milli / 1000, r.currency)}</b></p></div>
          <span className="erp-status is-pending">{t('Needs your approval', 'آپ کی منظوری درکار')}</span></div>
        <p className="erp-multiline">{r.specifications}</p>
        <p className="live-muted">{quantity(r.quantity_milli)} {r.unit} · {t('promised delivery', 'وعدہ شدہ ترسیل')} {factoryTime(r.requested_delivery_at)} · {t('payment terms', 'ادائیگی کی شرائط')}: {r.payment_terms}</p>
        {r.note && <p className="live-muted">{t('Note from the factory:', 'فیکٹری کا نوٹ:')} {r.note}</p>}
        {open === 'approve:' + r.id ? <ApproveForm revision={r} onSaved={saved} onCancel={() => setOpen('')} />
          : <button className="button primary" onClick={() => setOpen('approve:' + r.id)}><CheckCircle2 size={18} />{t('Review and approve', 'جائزہ لیں اور منظور کریں')}</button>}
      </article>;
    })}</div>
  </section>;
}

function ApproveForm({ revision, onSaved, onCancel }: { revision: QuoteRevision; onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [note, setNote] = useState('');
  const total = revision.price_minor * revision.quantity_milli / 1000;
  return <AsyncForm title={t('Approve this quote revision', 'اس کوٹیشن ترمیم کی منظوری دیں')} detail={`${t('Revision', 'ترمیم')} ${revision.version} · ${rate(total, revision.currency)}`}
    submit={t('Approve and confirm the order', 'منظور کریں اور آرڈر مستقل کریں')} onCancel={onCancel}
    note={t('Approval is final and cannot be undone: it confirms the order at these terms and issues one invoice number. Only the newest revision can be approved.', 'منظوری حتمی ہے اور واپس نہیں ہو سکتی: انہی شرائط پر آرڈر مستقل ہو گا اور ایک انوائس نمبر جاری ہو گا۔ صرف تازہ ترین ترمیم منظور ہو سکتی ہے۔')}
    onSubmit={async () => {
      const result = await buyerRequest<{ already: boolean; invoice: { number: string } | null }>('/approve', { revisionId: revision.id, version: revision.version, note });
      await onSaved(result.already ? t('This revision was already approved; the original invoice stands.', 'یہ ترمیم پہلے ہی منظور ہو چکی ہے؛ اصل انوائس برقرار ہے۔')
        : t('Approved. Order confirmed and invoice issued.', 'منظور۔ آرڈر مستقل اور انوائس جاری۔'));
    }}>
    <p>{quantity(revision.quantity_milli)} {revision.unit} × {rate(revision.price_minor, revision.currency)} = <b>{rate(total, revision.currency)}</b></p>
    <label className="erp-confirm"><input type="checkbox" required />{t('I accept these specifications, quantity, price and delivery date for our company.', 'میں ان تفصیلات، مقدار، قیمت اور ترسیل کی تاریخ کو اپنی کمپنی کی جانب سے قبول کرتا ہوں۔')}</label>
    <Field>{t('Approval note (optional)', 'منظوری نوٹ (اختیاری)')}<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} /></Field>
  </AsyncForm>;
}

function BuyerPoForm({ onSaved, onCancel }: { onSaved: (message?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID());
  const [reference, setReference] = useState(''), [specifications, setSpecifications] = useState('');
  const [qty, setQty] = useState(''), [unit, setUnit] = useState<'kg' | 'metre' | 'piece'>('kg');
  const [delivery, setDelivery] = useState(localFactoryInput(Date.now() + 21 * 86400000)), [terms, setTerms] = useState('');
  return <AsyncForm title={t('Submit a purchase order', 'پرچیز آرڈر جمع کروائیں')} submit={t('Send to the factory', 'فیکٹری کو بھیجیں')} onCancel={onCancel}
    note={t('The factory enters this order and quotes it. Submitted details cannot be edited; contact the sales team for changes.', 'فیکٹری یہ آرڈر درج کرکے کوٹیشن دے گی۔ جمع کروائی گئی تفصیلات تبدیل نہیں ہو سکتیں؛ تبدیلی کے لیے فروخت ٹیم سے رابطہ کریں۔')}
    onSubmit={async () => {
      await buyerRequest('/pos', { id, reference, specifications, quantityMilli: fixedInput(qty, 3, 'Quantity'), unit, requestedDeliveryAt: factoryInput(delivery), paymentTerms: terms });
      await onSaved(t('Purchase order submitted to the factory.', 'پرچیز آرڈر فیکٹری کو بھیج دیا گیا۔'));
    }}>
    <Field>{t('Your PO reference', 'آپ کا آرڈر نمبر')}<input value={reference} onChange={e => setReference(e.target.value)} required minLength={2} maxLength={100} dir="ltr" /></Field>
    <Field>{t('Specifications', 'تفصیلات')}<textarea value={specifications} onChange={e => setSpecifications(e.target.value)} required minLength={5} maxLength={4000} /></Field>
    <div className="live-fields"><Field>{t('Quantity', 'مقدار')}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} required /></Field>
      <Field>{t('Unit', 'اکائی')}<select value={unit} onChange={e => setUnit(e.target.value as 'kg' | 'metre' | 'piece')}><option value="kg">kg</option><option value="metre">metre</option><option value="piece">piece</option></select></Field></div>
    <Field>{t('Requested delivery (PKT)', 'مطلوبہ ترسیل (پاکستان)')}<input type="datetime-local" value={delivery} onChange={e => setDelivery(e.target.value)} required /></Field>
    <Field>{t('Your payment terms', 'آپ کی ادائیگی کی شرائط')}<textarea value={terms} onChange={e => setTerms(e.target.value)} required minLength={3} maxLength={1000} placeholder="Net 30 days after delivery" /></Field>
  </AsyncForm>;
}

function BuyerLogin({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const { t } = useLanguage(); const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  return <AsyncForm title={t('Buyer sign in', 'خریدار سائن اِن')} submit={t('Sign in', 'سائن اِن')} note={t('The factory sales team activates new companies after review.', 'فیکٹری کی فروخت ٹیم جانچ کے بعد نئی کمپنیاں فعال کرتی ہے۔')}
    onSubmit={async () => { await buyerRequest('/login', { email, password }); setPassword(''); await onSignedIn(); }}>
    <Field>{t('Email', 'ای میل')}<input type="email" autoComplete="username" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} /></Field>
    <Field>{t('Password', 'پاس ورڈ')}<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} /></Field>
  </AsyncForm>;
}

function BuyerRegistration({ onSent }: { onSent: () => void }) {
  const { t } = useLanguage();
  const [company, setCompany] = useState(''), [contactName, setContactName] = useState(''), [email, setEmail] = useState(''), [phone, setPhone] = useState(''), [city, setCity] = useState('');
  const [password, setPassword] = useState(''), [again, setAgain] = useState('');
  return <AsyncForm title={t('Register your company', 'اپنی کمپنی رجسٹر کریں')} submit={t('Request approval', 'منظوری کی درخواست کریں')} note={t('The factory sales team verifies your company details before activating the portal.', 'فیکٹری کی فروخت ٹیم پورٹل فعال کرنے سے پہلے آپ کی کمپنی کی تفصیلات کی تصدیق کرتی ہے۔')}
    onSubmit={async () => {
      if (password !== again) throw Error(t('The passwords do not match.', 'پاس ورڈ ایک جیسے نہیں ہیں۔'));
      await buyerRequest('/register', { company, contactName, email, phone, city, password }); setPassword(''); setAgain(''); onSent();
    }}>
    <Field>{t('Company name', 'کمپنی کا نام')}<input value={company} onChange={e => setCompany(e.target.value)} required minLength={2} maxLength={120} autoComplete="organization" /></Field>
    <Field>{t('Contact name', 'رابطے کا نام')}<input value={contactName} onChange={e => setContactName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" /></Field>
    <div className="live-fields"><Field>{t('Email', 'ای میل')}<input type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="username" /></Field>
      <Field>{t('Phone with country code', 'ملکی کوڈ کے ساتھ فون')}<input type="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} required maxLength={30} placeholder="+923001234567" autoComplete="tel" /></Field></div>
    <Field>{t('City', 'شہر')}<input value={city} onChange={e => setCity(e.target.value)} maxLength={100} autoComplete="address-level2" /></Field>
    <Field>{t('Choose password (12–128 characters)', 'پاس ورڈ منتخب کریں (۱۲ تا ۱۲۸ حروف)')}<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={128} required /></Field>
    <Field>{t('Repeat password', 'پاس ورڈ دوبارہ درج کریں')}<input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} minLength={12} maxLength={128} required /></Field>
  </AsyncForm>;
}
