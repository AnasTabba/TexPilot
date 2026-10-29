import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Delete, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { Cone } from './Cone';
import { errorMessage } from './forms';
import { inventoryRequest as api } from './inventory-client';
import { LanguageSelect, useLanguage } from './i18n';

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`yf-avatar${large ? ' is-large' : ''}`} aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
}
const pinInput = { type: 'password', inputMode: 'numeric', pattern: '[0-9]{4}', minLength: 4, maxLength: 4, autoComplete: 'off', required: true, dir: 'ltr' } as const;
type Step = { at: 'people' } | { at: 'pin'; name: string };

/** Sign-in: choose your name, enter your 4-digit PIN. Admins create accounts. */
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
      </div>}
      {step.at === 'pin' && <PinPad key={step.name} name={step.name} onBack={back} onSignedIn={onSignedIn} />}
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
