import { useEffect, useRef, useState, useId, Children, cloneElement, isValidElement, type ReactElement, type FormEvent, type ReactNode } from 'react';
import { Check, CheckCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react';

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'This could not be saved. Try again.';
export function Field({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [error, setError] = useState('');
  // A field is checked on blur only after it was edited: an untouched empty field that shouted on blur
  // shifted the form under the pointer, so the first click on Cancel or Close never landed.
  const [edited, setEdited] = useState(false);
  const controlId = useId(); const errorId = useId();
  const nodes = Children.toArray(children);
  const label = nodes.filter(child => typeof child === 'string' || typeof child === 'number');
  function validate(target: EventTarget) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    setError(target.validity.valid ? '' : target.validationMessage);
  }
  return <div className={`live-field ${className}`} onBlur={e => { if (edited) validate(e.target); }} onInvalid={e => validate(e.target)} onChange={e => { setEdited(true); if (error) validate(e.target); }}>
    <label htmlFor={controlId}>{label}</label>
    {nodes.filter(isValidElement).map(child => cloneElement(child as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, { id: controlId, 'aria-describedby': error ? errorId : undefined, 'aria-invalid': !!error }))}
    {error && <span id={errorId} className="live-field-error"><TriangleAlert size={18} aria-hidden="true" />{error}</span>}
  </div>;
}

export function AsyncForm({ title, detail, children, submit, onSubmit, onCancel, review, note }: { title: string; detail?: string; children: ReactNode; submit: string; onSubmit: () => Promise<void>; onCancel?: () => void; review?: ReactNode; note?: string }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [reviewing, setReviewing] = useState(false);
  const form = useRef<HTMLFormElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) form.current?.querySelector<HTMLInputElement>('input,select,textarea')?.focus(); }, []);
  useEffect(() => { if (reviewing) heading.current?.focus(); }, [reviewing]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (review && !reviewing) { setReviewing(true); setError(''); return; }
    setBusy(true); setError('');
    try { await onSubmit(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <form className="live-panel live-form" ref={form} onSubmit={save} aria-label={title}>
    <div className="live-panel-heading"><div><h2 ref={heading} tabIndex={-1}>{reviewing ? 'Review before saving' : title}</h2>{detail && !reviewing && <p>{detail}</p>}</div>{onCancel && <button className="live-icon-button" type="button" onClick={onCancel} disabled={busy} aria-label="Close form"><X aria-hidden="true" /></button>}</div>
    {review && <ol className="yf-steps yf-formsteps" aria-label="Entry steps"><li className={reviewing ? 'done' : 'current'} aria-current={reviewing ? undefined : 'step'}><span>{reviewing ? <Check size={14} aria-hidden="true" /> : 1}</span>Details</li><li className={reviewing ? 'current' : ''} aria-current={reviewing ? 'step' : undefined}><span>2</span>Review and save</li></ol>}
    <fieldset disabled={busy} hidden={reviewing}>{children}</fieldset>
    {reviewing && <section className="live-review" aria-label="Entry summary"><h3>{title}</h3>{review}<p>Check these register values. Stock changes only after you save.</p></section>}
    {error && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{error}</p>}
    <div className="live-actions"><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="live-spinning" size={20} aria-hidden="true" /> : <CheckCheck size={20} aria-hidden="true" />}{busy ? 'Saving…' : review && !reviewing ? 'Review entry' : submit}</button>{reviewing && <button className="button" type="button" disabled={busy} onClick={() => { setReviewing(false); setError(''); }}>Edit entry</button>}{onCancel && <button className="button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>}</div>
    <p className="live-form-note">{note ?? (review ? 'Review the entry before saving it.' : 'Saved for the whole team when confirmed.')}</p>
  </form>;
}
