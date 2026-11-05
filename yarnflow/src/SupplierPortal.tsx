import { useCallback, useEffect, useState } from 'react';
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { inventoryRequest as api, InventoryError } from './inventory-client';
import { LanguageSelect, useLanguage } from './i18n';
import { Cone } from './Cone';
import { BidForm, BidTerms, CategoryPicker, DispatchNotice, RfqSummary } from './ErpCommon';
import { factoryTime, quantity, type ProcurementState, type SupplierCategory, type SupplierIdentity } from './erp-client';
import './erp.css';

export default function SupplierPortal() {
 const { t } = useLanguage(); const [identity, setIdentity] = useState<SupplierIdentity | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
 const [config, setConfig] = useState<{ categories: SupplierCategory[]; factory: string; registrationAvailable: boolean } | null>(null);
 const [mode, setMode] = useState<'login' | 'register' | 'sent'>('login');
 const [state, setState] = useState<ProcurementState | null>(null), [open, setOpen] = useState(''), [notice, setNotice] = useState('');
 const load = useCallback(async () => {
  try { const me = await api<SupplierIdentity>('/portal/me'); setIdentity(me); if (me.supplier.status === 'approved') setState(await api<ProcurementState>('/portal/workspace')); else setState(null); setError(''); }
  catch (e) { if (e instanceof InventoryError && e.status === 401) { setIdentity(null); setState(null); } else setError(errorMessage(e)); }
  finally { setLoading(false); }
 }, []);
 useEffect(() => { void api<typeof config>('/portal/config').then(setConfig).catch(e => setError(errorMessage(e))); void load(); }, [load]);
 useEffect(() => { const focus = () => { if (!document.hidden) void load(); }; const timer = setInterval(focus, 30000); window.addEventListener('focus', focus); return () => { clearInterval(timer); window.removeEventListener('focus', focus); }; }, [load]);
 const saved = async () => { setOpen(''); setNotice(t('Saved.', 'محفوظ ہو گیا۔')); await load(); };
 return <div className="erp-portal"><header className="erp-portal-header"><a href="#/overview" className="live-brand"><Cone size={28} hue="#2f6fd6" />yarnflow</a><span>{t('Supplier portal', 'سپلائر پورٹل')}</span><LanguageSelect />{identity && <button className="button" onClick={async () => { try { await api('/portal/logout', {}); setIdentity(null); setState(null); setNotice(''); } catch (e) { setError(errorMessage(e)); } }}><LogOut size={18} />{t('Sign out', 'سائن آؤٹ')}</button>}</header>
  <main className={`erp-portal-main${!identity ? ' is-auth' : ''}`}>
   <div className="live-page-heading"><div><h1>{identity ? identity.supplier.name : t('Work with our factory', 'ہماری فیکٹری کے ساتھ کام کریں')}</h1><p>{config?.factory || 'Yarnflow'} · {t('Your RFQs, bids and purchase orders', 'آپ کی درخواستیں، بولیاں اور خریداری کے آرڈر')}</p></div>{identity && <button className="button" onClick={() => void load()}><RefreshCw size={18} />{t('Refresh', 'تازہ کریں')}</button>}</div>
   {error && <p className="live-error" role="alert">{t(error)}<button className="live-text-button" onClick={() => void load()}>{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}
   {notice && <p className="live-success" role="status">{notice}</p>}
   {loading ? <p role="status">{t('Opening your portal…', 'آپ کا پورٹل کھل رہا ہے…')}</p> : !identity ? <>
    <div className="live-segments" aria-label={t('Supplier account', 'سپلائر اکاؤنٹ')}><button aria-pressed={mode !== 'register'} onClick={() => setMode('login')}>{t('Supplier sign in', 'سپلائر سائن اِن')}</button><button aria-pressed={mode === 'register'} onClick={() => setMode('register')}>{t('Register company', 'کمپنی رجسٹر کریں')}</button></div>
    {mode === 'sent' && <p className="live-success" role="status">{t('Registration saved. Sign in to check your approval status.', 'رجسٹریشن محفوظ ہو گئی۔ منظوری کی حالت دیکھنے کے لیے سائن اِن کریں۔')}</p>}
    {mode === 'register' ? config?.registrationAvailable ? <SupplierRegistration categories={config.categories} onSent={() => setMode('sent')} /> : <p>{t('Registration is not available. Contact the factory admin.', 'رجسٹریشن دستیاب نہیں ہے۔ فیکٹری ایڈمن سے رابطہ کریں۔')}</p> : <SupplierLogin onSignedIn={load} />}
    <a href="#/overview" className="button">{t('Factory team sign in', 'فیکٹری ٹیم سائن اِن')}</a>
   </> : identity.supplier.status !== 'approved' ? <section className="live-panel erp-approval"><ShieldCheck size={36} /><h2>{t(identity.supplier.status === 'pending' ? 'Waiting for admin approval' : identity.supplier.status === 'suspended' ? 'Supplier access suspended' : 'Registration not approved', identity.supplier.status === 'pending' ? 'ایڈمن کی منظوری کا انتظار' : identity.supplier.status === 'suspended' ? 'سپلائر رسائی معطل ہے' : 'رجسٹریشن منظور نہیں ہوئی')}</h2><p>{t('The factory admin reviews your company and contact details. RFQs, bids and orders become available after approval. Contact the factory if your details need correcting.', 'فیکٹری ایڈمن آپ کی کمپنی اور رابطے کی تفصیلات کی جانچ کرتا ہے۔ منظوری کے بعد درخواستیں، بولیاں اور آرڈر دستیاب ہوں گے۔ تفصیلات درست کروانے کے لیے فیکٹری سے رابطہ کریں۔')}</p></section> : state && <>
    <section className="live-panel"><h2>{t('Requests for quotation', 'قیمت کی درخواستیں')}</h2>{!state.rfqs.length && <p className="live-muted">{t('No RFQs have been sent to your company yet.', 'ابھی آپ کی کمپنی کو کوئی درخواست نہیں بھیجی گئی۔')}</p>}
     <div className="erp-records">{state.rfqs.map(r => { const bid = state.bids.find(b => b.rfq_id === r.id); const editable = r.status === 'open' && r.deadline_at > Date.now(); return <article className="erp-record" key={r.id}><div className="erp-record-head"><h3>{r.reference}</h3><span className="erp-status">{t(r.status, {draft:'مسودہ',open:'کھلا',awarded:'منظور شدہ',closed:'بند',cancelled:'منسوخ'}[r.status])}</span></div><RfqSummary rfq={r} />{bid && <><h4>{t('Your bid', 'آپ کی بولی')} · {t('Revision', 'ترمیم')} {bid.version}</h4><BidTerms bid={bid} unit={r.unit} />{bid.status === 'rejected' && <p className="live-warning">{t('Bid rejected:', 'بولی مسترد:')} {bid.rejection_reason}</p>}</>}{open === 'bid:' + r.id ? <BidForm key={r.id + ':' + (bid?.version || 0)} rfq={r} previous={bid} onSaved={saved} onCancel={() => setOpen('')} /> : editable && <button className="button primary" onClick={() => setOpen('bid:' + r.id)}>{bid ? t('Revise your bid', 'بولی میں ترمیم کریں') : t('Submit your bid', 'اپنی بولی دیں')}</button>}</article>; })}</div>
    </section>
    <section className="live-panel"><h2>{t('Accepted purchase orders', 'منظور شدہ خریداری کے آرڈر')}</h2>{!state.orders.length && <p className="live-muted">{t('Accepted bids appear here as purchase orders.', 'منظور شدہ بولیاں یہاں خریداری کے آرڈر کے طور پر نظر آئیں گی۔')}</p>}<div className="erp-records">{state.orders.map(o => { const shipped = state.shipments.filter(s => s.purchase_order_id === o.id); const remaining = o.terms.quantity_milli - shipped.reduce((n, s) => n + s.quantity_milli, 0); return <article className="erp-record" key={o.id}><h3>{o.reference} · {o.terms.title}</h3><BidTerms bid={o.terms} unit={o.terms.unit} /><p>{t('Remaining to dispatch:', 'باقی روانگی:')} {quantity(remaining)} {o.terms.unit}</p>{shipped.map(s => <div className="erp-shipment" key={s.id}><strong>{t('Bill of lading', 'بل آف لیڈنگ')}: {s.bill_of_lading}</strong><span>{s.carrier} · {quantity(s.quantity_milli)} {o.terms.unit} · {factoryTime(s.dispatched_at)}</span><span className="live-muted">{t('Tracking connection pending', 'ٹریکنگ کنکشن زیرِ التوا')}</span></div>)}{open === 'dispatch:' + o.id ? <DispatchNotice order={o} shipments={state.shipments} onSaved={saved} onCancel={() => setOpen('')} /> : remaining > 0 && ['accepted', 'dispatched'].includes(o.status) && <button className="button primary" onClick={() => setOpen('dispatch:' + o.id)}>{t('Record dispatch and B/L', 'روانگی اور بل درج کریں')}</button>}</article>; })}</div></section>
   </>}
  </main>
 </div>;
}
function SupplierLogin({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
 const { t } = useLanguage(); const [email, setEmail] = useState(''), [password, setPassword] = useState('');
 return <AsyncForm title={t('Supplier sign in', 'سپلائر سائن اِن')} submit={t('Sign in', 'سائن اِن')} note={t('An admin approves new supplier registrations.', 'ایڈمن نئے سپلائر کی رجسٹریشن منظور کرتا ہے۔')} onSubmit={async () => { await api('/portal/login', { email, password }); setPassword(''); await onSignedIn(); }}>
  <Field>{t('Email', 'ای میل')}<input type="email" autoComplete="username" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} /></Field><Field>{t('Password', 'پاس ورڈ')}<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} maxLength={128} /></Field>
 </AsyncForm>;
}
function SupplierRegistration({ categories, onSent }: { categories: SupplierCategory[]; onSent: () => void }) {
 const { t } = useLanguage(); const [company, setCompany] = useState(''), [contactName, setContactName] = useState(''), [email, setEmail] = useState(''), [phone, setPhone] = useState(''), [city, setCity] = useState(''), [password, setPassword] = useState(''), [again, setAgain] = useState(''), [selected, setSelected] = useState<string[]>([]);
 return <AsyncForm title={t('Register your company', 'اپنی کمپنی رجسٹر کریں')} submit={t('Request approval', 'منظوری کی درخواست کریں')} note={t('The factory admin verifies your company and contact details before approving access.', 'فیکٹری ایڈمن رسائی کی منظوری سے پہلے آپ کی کمپنی اور رابطے کی تصدیق کرتا ہے۔')} onSubmit={async () => { if (password !== again) throw Error(t('The passwords do not match.', 'پاس ورڈ ایک جیسے نہیں ہیں۔')); await api('/portal/register', { company, contactName, email, phone, city, password, categories: selected }); setPassword(''); setAgain(''); onSent(); }}>
  <Field>{t('Company name', 'کمپنی کا نام')}<input value={company} onChange={e => setCompany(e.target.value)} required minLength={2} maxLength={120} autoComplete="organization" /></Field>
  <Field>{t('Contact name', 'رابطے کا نام')}<input value={contactName} onChange={e => setContactName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" /></Field>
  <div className="live-fields"><Field>{t('Email', 'ای میل')}<input type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} autoComplete="username" /></Field><Field>{t('Phone with country code', 'ملکی کوڈ کے ساتھ فون')}<input type="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} required maxLength={30} autoComplete="tel" placeholder="+923001234567" /></Field></div>
  <Field>{t('City', 'شہر')}<input value={city} onChange={e => setCity(e.target.value)} maxLength={100} autoComplete="address-level2" /></Field>
  <CategoryPicker categories={categories} value={selected} onChange={setSelected} />
  <Field>{t('Choose password (12–128 characters)', 'پاس ورڈ منتخب کریں (۱۲ تا ۱۲۸ حروف)')}<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={128} required /></Field><Field>{t('Repeat password', 'پاس ورڈ دوبارہ درج کریں')}<input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} minLength={12} maxLength={128} required /></Field>
 </AsyncForm>;
}
