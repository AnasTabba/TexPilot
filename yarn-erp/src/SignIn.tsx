import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Clock3, Delete, LoaderCircle, RefreshCw, TriangleAlert, UserPlus } from 'lucide-react';
import { Cone } from './Cone';
import { AsyncForm, Field, errorMessage } from './forms';
import { inventoryRequest as api } from './inventory-client';
import { LanguageSelect, useLanguage } from './i18n';

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`yf-avatar${large ? ' is-large' : ''}`} aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
}
const pinInput = { type: 'password', inputMode: 'numeric', pattern: '[0-9]{4}', minLength: 4, maxLength: 4, autoComplete: 'off', required: true, dir: 'ltr' } as const;
type Step = { at: 'people' } | { at: 'pin'; name: string } | { at: 'request' } | { at: 'sent'; name: string };

/** Sign-in: choose your name, enter your 4-digit PIN. New people ask for an account; an admin approves it. */
export default function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const { t } = useLanguage();
  const [list, setList] = useState<{ workspace: string; people: string[] } | null>(null);
  const [loadError, setLoadError] = useState(''); const [retry, setRetry] = useState(0);
  const [step, setStep] = useState<Step>({ at: 'people' });
  useEffect(() => {
    setLoadError('');
    api<{ workspace: string; people: string[] }>('/auth/people').then(setList).catch(error => setLoadError(errorMessage(error)));
  }, [retry]);
  const back = () => setStep({ at: 'people' });
  return <main className="yf-signin">
    <header className="yf-signin-rail">
      <span className="live-brand"><Cone hue="#2f6fd6" size={30} />yarnflow</span>
      <LanguageSelect />
      <div className="yf-signin-cones" aria-hidden="true">{['#2f6fd6', '#c2417f', '#0f8a8a', '#4a4540', '#a4502a', '#5b6b7a'].map(hue => <Cone key={hue} hue={hue} size={84} />)}</div>
      <p><strong>{list?.workspace}</strong>{t('Stock, scans and QC for the whole factory, shared by everyone who signs in.', 'پوری فیکٹری کا اسٹاک، اسکین اور کوالٹی چیک، سائن اِن کرنے والی پوری ٹیم کے لیے۔')}</p>
    </header>
    <section className="yf-signin-sheet">
      {step.at === 'people' && <div className="yf-signin-step" key="people">
        <h1>{t('Who’s signing in?', 'کون سائن اِن کر رہا ہے؟')}</h1>
        <p>{t('Choose your name, then enter your PIN.', 'اپنا نام چنیں، پھر پن درج کریں۔')}</p>
        {loadError && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{t(loadError)}<button className="live-text-button" onClick={() => setRetry(n => n + 1)}><RefreshCw size={16} aria-hidden="true" />{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}
        {!list && !loadError && <p role="status" className="live-muted">{t('Loading names…', 'نام لوڈ ہو رہے ہیں…')}</p>}
        {list && <ul className="yf-people">{list.people.map(name => <li key={name}><button className="yf-person" onClick={() => setStep({ at: 'pin', name })}><Avatar name={name} /><strong>{name}</strong><ChevronRight size={20} aria-hidden="true" /></button></li>)}</ul>}
        <button className="live-text-button yf-signin-ask" onClick={() => setStep({ at: 'request' })}><UserPlus size={18} aria-hidden="true" />{t('New here? Ask for an account', 'نئے ہیں؟ اکاؤنٹ کی درخواست کریں')}</button>
        <a className="live-text-button yf-supplier-entry" href="#/supplier">{t('Supplier sign in or register', 'سپلائر سائن اِن یا رجسٹریشن')}</a>
        <a className="live-text-button yf-supplier-entry" href="#/buyer">{t('Buyer portal', 'خریدار پورٹل')}</a>
      </div>}
      {step.at === 'pin' && <PinPad key={step.name} name={step.name} onBack={back} onSignedIn={onSignedIn} />}
      {step.at === 'request' && <Request onSent={name => setStep({ at: 'sent', name })} onCancel={back} />}
      {step.at === 'sent' && <div className="yf-signin-step yf-signin-sent" key="sent">
        <span className="yf-signin-icon"><Clock3 size={28} aria-hidden="true" /></span>
        <h1>{t('Request sent', 'درخواست بھیج دی گئی')}</h1>
        <p>{t('An admin will approve', 'ایڈمن منظوری دے گا:')} <strong>{step.name}</strong> {t('and choose what you can record. After that, sign in here with your name and PIN.', 'اور طے کرے گا کہ آپ کیا درج کر سکتے ہیں۔ اس کے بعد اپنے نام اور پن سے یہاں سائن اِن کریں۔')}</p>
        <button className="button primary" onClick={() => { setRetry(n => n + 1); back(); }}>{t('Back to sign-in', 'سائن اِن پر واپس جائیں')}</button>
      </div>}
    </section>
  </main>;
}

function PinPad({ name, onBack, onSignedIn }: { name: string; onBack: () => void; onSignedIn: () => Promise<void> }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [shake, setShake] = useState(false);
  const input = useRef<HTMLInputElement>(null); const errorId = useId();
  const fine = () => matchMedia('(pointer: fine)').matches;
  useEffect(() => { if (fine()) input.current?.focus(); }, []);
  useEffect(() => { if (!busy && fine()) input.current?.focus(); }, [busy]);
  // The fourth digit signs in; no separate button to find.
  async function type(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setPin(digits); if (digits) setError('');
    if (digits.length < 4 || busy) return;
    setBusy(true);
    try { await api('/auth/login', { name, pin: digits }); await onSignedIn(); }
    catch (error) { setError(errorMessage(error)); setPin(''); setShake(true); setBusy(false); }
  }
  return <form className="yf-signin-step yf-pin" onSubmit={event => { event.preventDefault(); void type(pin); }}>
    <button type="button" className="live-text-button yf-signin-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />{t(`Not ${name}?`, `آپ ${name} نہیں ہیں؟`)}</button>
    <Avatar name={name} large />
    <h1>{t(`Hi, ${name}`, `السلام علیکم، ${name}`)}</h1>
    <p>{t('Enter your 4-digit PIN.', 'اپنا چار ہندسوں کا پن درج کریں۔')}</p>
    <label className="yf-pin-dots" data-shake={shake || undefined} onAnimationEnd={() => setShake(false)}>
      <span className="control-label">{t('4-digit PIN', 'چار ہندسوں کا پن')}</span>
      <input ref={input} className="yf-pin-input" {...pinInput} required={false} value={pin} onChange={event => void type(event.target.value)} disabled={busy} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />
      {[0, 1, 2, 3].map(i => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
    </label>
    <p className="yf-pin-status" role={error ? 'alert' : 'status'} id={errorId}>{busy ? <><LoaderCircle className="live-spinning" size={18} aria-hidden="true" />{t('Signing in…', 'سائن اِن ہو رہا ہے…')}</> : error && <><TriangleAlert size={18} aria-hidden="true" />{t(error)}</>}</p>
    <div className="yf-keypad" dir="ltr">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'].map(key => key === ''
      ? <span key="gap" />
      : <button type="button" key={key} className={key === 'delete' ? 'is-delete' : undefined} disabled={busy} aria-label={key === 'delete' ? t('Delete last digit', 'آخری ہندسہ مٹائیں') : undefined} onClick={() => key === 'delete' ? setPin(old => old.slice(0, -1)) : void type(pin + key)}>{key === 'delete' ? <Delete size={26} aria-hidden="true" /> : key}</button>)}</div>
  </form>;
}

function Request({ onSent, onCancel }: { onSent: (name: string) => void; onCancel: () => void }) {
  const { t } = useLanguage();
  const [name, setName] = useState(''); const [pin, setPin] = useState(''); const [again, setAgain] = useState('');
  return <div className="yf-signin-step" key="request">
    <AsyncForm title={t('Ask for an account', 'اکاؤنٹ کی درخواست کریں')} detail={t('An admin approves new accounts and chooses what you can record. Everyone can view stock and scan.', 'ایڈمن نئے اکاؤنٹ منظور کرتا ہے اور اندراج کے اختیارات دیتا ہے۔ سب اسٹاک دیکھ سکتے ہیں اور اسکین کر سکتے ہیں۔')} submit={t('Send request', 'درخواست بھیجیں')} note={t('Your PIN is stored scrambled. Nobody can read it, not even an admin.', 'آپ کا پن خفیہ شکل میں محفوظ ہوتا ہے۔ اسے ایڈمن بھی نہیں پڑھ سکتا۔')} onCancel={onCancel} onSubmit={async () => {
      if (pin !== again) throw new Error('The two PINs are different. Type the same 4 digits twice.');
      await api('/auth/signup', { name, pin }); onSent(name.trim());
    }}>
      <Field>{t('Your name', 'آپ کا نام')}<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={40} autoComplete="name" placeholder={t('As your team knows you', 'وہ نام جس سے ٹیم آپ کو جانتی ہے')} required /></Field>
      <div className="live-fields yf-pin-fields"><Field>{t('Choose a 4-digit PIN', 'چار ہندسوں کا پن چنیں')}<input {...pinInput} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} /></Field><Field>{t('Type it again', 'دوبارہ درج کریں')}<input {...pinInput} value={again} onChange={e => setAgain(e.target.value.replace(/\D/g, ''))} /></Field></div>
    </AsyncForm>
  </div>;
}
