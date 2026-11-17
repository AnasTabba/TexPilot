import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Delete, LockKeyhole, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { errorMessage } from './forms';
import { InventoryError, inventoryRequest as api, roleLabel, type Role } from './inventory-client';
import { useLanguage } from './i18n';
import './auth.css';

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`yf-avatar${large ? ' is-large' : ''}`} aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
}
const pinInput = { type: 'password', inputMode: 'numeric', pattern: '[0-9]{4}', minLength: 4, maxLength: 4, autoComplete: 'off', required: true, dir: 'ltr' } as const;
type Step = { at: 'people' } | { at: 'pin'; name: string };

/** Sign-in: choose your name, enter your 4-digit PIN. Admins create accounts. */
export default function SignIn({ onSignedIn, sessionEnded = false }: { onSignedIn: () => Promise<void>; sessionEnded?: boolean }) {
  const { t, language, setLanguage } = useLanguage();
  const [list, setList] = useState<{ workspace: string; people: { name: string; role: Role }[] } | null>(null);
  const [loadError, setLoadError] = useState(''); const [retry, setRetry] = useState(0);
  const [step, setStep] = useState<Step>({ at: 'people' });
  useEffect(() => {
    setLoadError('');
    api<{ workspace: string; people: { name: string; role: Role }[] }>('/auth/people').then(setList).catch(error => setLoadError(errorMessage(error)));
  }, [retry]);
  const back = () => setStep({ at: 'people' });
  return <main className="yf-signin">
    <header className="yf-signin-rail">
      <span className="live-brand">yarnflow</span>
      <div className="yf-signin-languages" role="group" aria-label={t('Language', 'زبان')} dir="ltr">
        <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
        <button type="button" aria-pressed={language === 'ur'} onClick={() => setLanguage('ur')}>اردو</button>
      </div>
    </header>
    <section className="yf-signin-sheet">
      {step.at === 'people' && <div className="yf-signin-step" key="people">
        <h1>{t('Who are you?', 'آپ کون ہیں؟')}</h1>
        <p className="yf-signin-welcome">{t('Choose your name to get started.', 'شروع کرنے کے لیے اپنا نام منتخب کریں۔')}</p>
        {sessionEnded && <p className="live-warning" role="status">{t('Your session ended. Sign in again to continue.', 'آپ کا سیشن ختم ہو گیا۔ جاری رکھنے کے لیے دوبارہ سائن اِن کریں۔')}</p>}
        {loadError && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{t(loadError)}<button className="live-text-button" onClick={() => setRetry(n => n + 1)}><RefreshCw size={16} aria-hidden="true" />{t('Retry', 'دوبارہ کوشش کریں')}</button></p>}
        {!list && !loadError && <p role="status" className="live-muted">{t('Loading names…', 'نام لوڈ ہو رہے ہیں…')}</p>}
        {list && <ul className="yf-people">{list.people.map(({ name, role }) => <li key={name}><button className="yf-person" onClick={() => setStep({ at: 'pin', name })}><Avatar name={name} /><span><strong>{name}</strong><small>{t(...roleLabel[role])}</small></span><ChevronRight size={20} aria-hidden="true" /></button></li>)}</ul>}
      </div>}
      {step.at === 'pin' && <PinPad key={step.name} name={step.name} onBack={back} onSignedIn={onSignedIn} />}
    </section>
  </main>;
}

function PinPad({ name, onBack, onSignedIn }: { name: string; onBack: () => void; onSignedIn: () => Promise<void> }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [shake, setShake] = useState(false);
  const [locked, setLocked] = useState(false); // The server locks this name after repeated wrong PINs (HTTP 429).
  const input = useRef<HTMLInputElement>(null); const errorId = useId();
  const fine = () => matchMedia('(pointer: fine)').matches;
  useEffect(() => { if (fine()) input.current?.focus(); }, []);
  useEffect(() => { if (!busy && !locked && fine()) input.current?.focus(); }, [busy, locked]);
  // The fourth digit signs in; no separate button to find.
  async function type(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setPin(digits); if (digits) setError('');
    if (digits.length < 4 || busy || locked) return;
    setBusy(true);
    try { await api('/auth/login', { name, pin: digits }); await onSignedIn(); }
    catch (error) { setError(errorMessage(error)); setLocked(error instanceof InventoryError && error.status === 429); setPin(''); setShake(true); setBusy(false); }
  }
  // The server states the minutes left in English; keep the number and translate the sentence around it.
  const lockMessage = (text: string) => {
    const minutes = text.match(/(\d+) min/)?.[1];
    return minutes ? t(`Too many wrong PINs. Try again in ${minutes} min.`, `بہت زیادہ غلط پن درج ہوئے۔ ${minutes} منٹ بعد دوبارہ کوشش کریں۔`) : t(text);
  };
  const state = busy ? 'busy' : locked ? 'locked' : error ? 'error' : undefined;
  return <form className="yf-signin-step yf-pin" data-state={state} onSubmit={event => { event.preventDefault(); void type(pin); }}>
    <button type="button" className="live-text-button yf-signin-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />{t(`Not ${name}?`, `آپ ${name} نہیں ہیں؟`)}</button>
    <div className="yf-pin-person"><Avatar name={name} large /><h1>{name}</h1></div>
    <p className="yf-pin-next">{t('Enter your 4-digit PIN.', 'اپنا چار ہندسوں کا پن درج کریں۔')}</p>
    <label className="yf-pin-dots" data-shake={shake || undefined} onAnimationEnd={() => setShake(false)}>
      <span className="control-label">{t('4-digit PIN', 'چار ہندسوں کا پن')}</span>
      <input ref={input} className="yf-pin-input" {...pinInput} required={false} value={pin} onChange={event => void type(event.target.value)} disabled={busy || locked} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} />
      {[0, 1, 2, 3].map(i => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
    </label>
    <p className="yf-pin-status" data-state={state} role={error ? 'alert' : 'status'} id={errorId}>
      {busy ? <><LoaderCircle className="live-spinning" size={18} aria-hidden="true" />{t('Signing in…', 'سائن اِن ہو رہا ہے…')}</>
        : locked ? <><LockKeyhole size={18} aria-hidden="true" />{lockMessage(error)}<button type="button" className="live-text-button" onClick={() => { setLocked(false); setError(''); }}><RefreshCw size={16} aria-hidden="true" />{t('Try again', 'دوبارہ کوشش کریں')}</button></>
        : error && <><TriangleAlert size={18} aria-hidden="true" />{t(error)}</>}
    </p>
    <div className="yf-keypad" dir="ltr">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'].map(key => key === ''
      ? <span key="gap" />
      : <button type="button" key={key} className={key === 'delete' ? 'is-delete' : undefined} disabled={busy || locked} aria-label={key === 'delete' ? t('Delete last digit', 'آخری ہندسہ مٹائیں') : undefined} onClick={() => key === 'delete' ? setPin(old => old.slice(0, -1)) : void type(pin + key)}>{key === 'delete' ? <Delete size={26} aria-hidden="true" /> : key}</button>)}</div>
  </form>;
}
