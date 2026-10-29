import { useEffect, useRef, useState, useId, Children, cloneElement, isValidElement, type ReactElement, type FormEvent, type ReactNode } from 'react';
import { Check, CheckCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { translate, useLanguage } from './i18n';
import { plainError } from './copy';

export const errorMessage = (error: unknown, language: 'en' | 'ur' = 'en') => {
  if (error instanceof Error) return plainError(error.message, language) ?? translate(language, error.message,
    error.message === 'The two PINs are different. Type the same 4 digits twice.' ? 'دونوں پن مختلف ہیں۔ ایک ہی چار ہندسے دو بار درج کریں۔' : undefined);
  return translate(language, 'This could not be saved. Try again.', 'محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں۔');
};
export function Field({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { t } = useLanguage();
  const [error, setError] = useState<{ english: string; urdu?: string } | null>(null);
  // A field is checked on blur only after it was edited: an untouched empty field that shouted on blur
  // shifted the form under the pointer, so the first click on Cancel or Close never landed.
  const [edited, setEdited] = useState(false);
  const controlId = useId(); const errorId = useId();
  const nodes = Children.toArray(children);
  const label = nodes.filter(child => typeof child === 'string' || typeof child === 'number');
  function validate(target: EventTarget) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    const validity = target.validity;
    setError(validity.valid ? null : { english: target.validationMessage, urdu:
      validity.valueMissing ? 'یہ خانہ پُر کریں۔'
      : validity.typeMismatch ? 'درست معلومات درج کریں۔'
      : validity.patternMismatch ? 'بتائے گئے طریقے سے درج کریں۔'
      : validity.tooShort ? 'مزید حروف یا ہندسے درج کریں۔'
      : validity.tooLong ? 'حروف یا ہندسے کم کریں۔'
      : validity.rangeUnderflow ? 'یہ عدد کم از کم حد سے کم ہے۔'
      : validity.rangeOverflow ? 'یہ عدد زیادہ سے زیادہ حد سے بڑا ہے۔'
      : validity.stepMismatch ? 'مقررہ وقفے کے مطابق عدد درج کریں۔'
      : validity.badInput ? 'درست عدد درج کریں۔' : undefined });
  }
  return <div className={`live-field ${className}`} onBlur={e => { if (edited) validate(e.target); }} onInvalid={e => validate(e.target)} onChange={e => { setEdited(true); if (error) validate(e.target); }}>
    <label htmlFor={controlId}>{label}</label>
    {nodes.filter(isValidElement).map(child => cloneElement(child as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, { id: controlId, 'aria-describedby': error ? errorId : undefined, 'aria-invalid': !!error }))}
    {error && <span id={errorId} className="live-field-error"><TriangleAlert size={18} aria-hidden="true" />{t(error.english, error.urdu)}</span>}
  </div>;
}

/**
 * A form that saves for the whole team. With `review`, the first press shows the review instead of saving.
 * `check` runs first and returns false to stay on the details (the form shows its own messages under the boxes).
 * `labels` replaces the generic wording for floor forms.
 */
export function AsyncForm({ title, detail, children, submit, onSubmit, onCancel, review, note, check, labels, className = '' }: { title: string; detail?: string; children: ReactNode; submit: string; onSubmit: () => Promise<void>; onCancel?: () => void; review?: ReactNode; note?: string; check?: () => boolean; labels?: { next: string; reviewTitle: string; reviewHint: string; change: string; cancel: string; saving: string; fixAbove: string }; className?: string }) {
  const { language, t } = useLanguage();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<{ cause: unknown } | null>(null); const [reviewing, setReviewing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const form = useRef<HTMLFormElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) form.current?.querySelector<HTMLInputElement>('input,select,textarea')?.focus(); }, []);
  useEffect(() => { if (reviewing) heading.current?.focus(); }, [reviewing]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    // Fields marked required or with a pattern are still checked by the browser, then the form's own check runs.
    const nativeOk = reviewing || !form.current || form.current.checkValidity();
    if (!reviewing && (!nativeOk || (check && !check()))) {
      setBlocked(true);
      // Bring the first problem into view: the worker may be below it with the keyboard open.
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }
    setBlocked(false);
    if (review && !reviewing) { setReviewing(true); setError(null); return; }
    setBusy(true); setError(null);
    try { await onSubmit(); } catch (error) { setError({ cause: error }); } finally { setBusy(false); }
  }
  const words = labels ?? { next: t('Review entry', 'اندراج کا جائزہ لیں'), reviewTitle: t('Review before saving', 'محفوظ کرنے سے پہلے جائزہ لیں'), reviewHint: t('Check these register values. Stock changes only after you save.', 'رجسٹر کی یہ تفصیلات جانچ لیں۔ اسٹاک صرف محفوظ کرنے کے بعد بدلے گا۔'), change: t('Edit entry', 'اندراج بدلیں'), cancel: t('Cancel', 'منسوخ کریں'), saving: t('Saving…', 'محفوظ ہو رہا ہے…'), fixAbove: '' };
  return <form className={`live-panel live-form ${className}`} ref={form} onSubmit={save} aria-label={t(title)} noValidate={!!check}>
    <div className="live-panel-heading"><div><h2 ref={heading} tabIndex={-1}>{reviewing ? words.reviewTitle : t(title)}</h2>{detail && !reviewing && <p>{t(detail)}</p>}</div>{onCancel && <button className="live-icon-button" type="button" onClick={onCancel} disabled={busy} aria-label={t('Close form', 'فارم بند کریں')}><X aria-hidden="true" /></button>}</div>
    {review && !labels && <ol className="yf-steps yf-formsteps" aria-label={t('Entry steps', 'اندراج کے مراحل')}><li className={reviewing ? 'done' : 'current'} aria-current={reviewing ? undefined : 'step'}><span>{reviewing ? <Check size={14} aria-hidden="true" /> : 1}</span>{t('Details', 'تفصیلات')}</li><li className={reviewing ? 'current' : ''} aria-current={reviewing ? 'step' : undefined}><span>2</span>{t('Review and save', 'جائزہ لیں اور محفوظ کریں')}</li></ol>}
    <fieldset disabled={busy} hidden={reviewing}>{children}</fieldset>
    {reviewing && <section className="live-review" aria-label={t('Entry summary', 'اندراج کا خلاصہ')}>{!labels && <h3>{t(title)}</h3>}{review}<p>{words.reviewHint}</p></section>}
    {blocked && !reviewing && words.fixAbove && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{words.fixAbove}</p>}
    {error && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{errorMessage(error.cause, language)}</p>}
    <div className="live-actions"><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="live-spinning" size={20} aria-hidden="true" /> : <CheckCheck size={20} aria-hidden="true" />}{busy ? words.saving : review && !reviewing ? words.next : t(submit)}</button>{reviewing && <button className="button" type="button" disabled={busy} onClick={() => { setReviewing(false); setError(null); }}>{words.change}</button>}{onCancel && <button className="button" type="button" disabled={busy} onClick={onCancel}>{words.cancel}</button>}</div>
    {!labels && <p className="live-form-note">{note != null ? t(note) : review ? t('Review the entry before saving it.', 'محفوظ کرنے سے پہلے اندراج کا جائزہ لیں۔') : t('Saved for the whole team when confirmed.', 'تصدیق کے بعد پوری ٹیم کے لیے محفوظ ہوگا۔')}</p>}
    {labels && note && <p className="live-form-note">{t(note)}</p>}
  </form>;
}
