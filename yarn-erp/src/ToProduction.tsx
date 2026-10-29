import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Factory, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Field, errorMessage } from './forms';
import { useLanguage } from './i18n';
import { ReasonField, portal } from './PortalCommon';
import { gramsFromKg, InventoryError } from './inventory-client';
import './inspect-arrival.css';
import './attention-widget.css';

export interface ProductionJob { lotId: string; batch: string; productName: string; rawGrams: number }
interface Props extends ProductionJob { isAdmin: boolean; onClose: () => void; onDone: (message: string) => Promise<void> }

/** Whole grams as kg text: 1234 becomes "1.234". */
export const kgText = (grams: number) => String(grams / 1000);

/** Moves raw stock of one batch into production. Retrying with the same values replays the same request id. */
export default function ToProduction({ lotId, batch, productName, rawGrams, isAdmin, onClose, onDone }: Props) {
  const { t, language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useRef(crypto.randomUUID());
  const [kg, setKg] = useState(kgText(rawGrams)), [note, setNote] = useState(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const d = dialog.current; if (d && !d.open) d.showModal(); }, []);
  // Any change to the values makes a new request id, so an edited request is never mistaken for the old one.
  const edit = (change: () => void) => { id.current = crypto.randomUUID(); change(); };
  const quick = (share: number) => kgText(share === 1 ? rawGrams : Math.floor(rawGrams * share));
  const shares: [string, number][] = [['25%', 0.25], ['50%', 0.5], [t('All', 'سب'), 1]];

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const why = reason.trim(), text = note.trim();
    let grams: number;
    try { grams = gramsFromKg(kg); } catch (caught) { setError(errorMessage(caught, language)); return; }
    if (grams > rawGrams) { setError(t(`Only ${kgText(rawGrams)} kg of raw stock is on hand for this batch.`, `اس بیچ میں ${kgText(rawGrams)} کلوگرام خام اسٹاک موجود ہے۔`)); return; }
    if (isAdmin && why.length < 5) { setError(t('Give a reason of at least 5 characters for this admin action.', 'ایڈمن کارروائی کی کم از کم 5 حروف کی وجہ لکھیں۔')); return; }
    setBusy(true); setError('');
    try {
      await portal('/stock/production', { id: id.current, lotId, grams, ...(text ? { note: text } : {}), ...(isAdmin ? { interventionReason: why } : {}) });
      await onDone(t(`${kgText(grams)} kg of batch ${batch} sent to production.`, `بیچ ${batch} کے ${kgText(grams)} کلوگرام پیداوار کے لیے بھیج دیے گئے۔`));
    } catch (caught) {
      setError(caught instanceof InventoryError && caught.status === 404
        ? t('Sending to production is not available on the server yet.', 'پیداوار کے لیے بھیجنا ابھی سرور پر دستیاب نہیں۔')
        : errorMessage(caught, language));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="inspect-arrival to-production" aria-labelledby="to-production-title" onClose={onClose}
    onCancel={e => { if (busy) e.preventDefault(); }} onClick={e => { if (e.target === e.currentTarget && !busy) dialog.current?.close(); }}>
    <form className="inspect-arrival-form" onSubmit={submit} noValidate>
      <header><h2 id="to-production-title">{t('Send to production', 'پیداوار کے لیے بھیجیں')}</h2>
        <p>{productName} · {t('Batch', 'بیچ')} {batch}</p>
        <p>{t('Raw stock available:', 'دستیاب خام اسٹاک:')} <strong>{kgText(rawGrams)} kg</strong></p></header>
      <fieldset disabled={busy} className="inspect-arrival-fields">
        <Field>{t('Raw stock to send (kg)', 'بھیجا جانے والا خام اسٹاک (کلوگرام)')}<input type="number" inputMode="decimal" dir="ltr" min="0.001" max={kgText(rawGrams)} step="0.001" value={kg} onChange={e => edit(() => setKg(e.target.value))} required /></Field>
        <div className="live-segments" role="group" aria-label={t('Quick amounts', 'فوری مقدار')}>
          {shares.map(([label, share]) => <button key={label} type="button" aria-pressed={kg === quick(share)} onClick={() => edit(() => setKg(quick(share)))}>{label}</button>)}
        </div>
        <Field>{t('Note (optional)', 'نوٹ (اختیاری)')}<textarea rows={2} maxLength={1000} value={note} onChange={e => edit(() => setNote(e.target.value))} /></Field>
        {isAdmin && <ReasonField label={t('Reason for this admin action', 'ایڈمن کارروائی کی وجہ')} value={reason} onChange={value => edit(() => setReason(value))} />}
      </fieldset>
      {error && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{error}</p>}
      <div className="live-actions">
        <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="live-spinning" size={20} aria-hidden="true" /> : <Factory size={20} aria-hidden="true" />}{busy ? t('Sending…', 'بھیجا جا رہا ہے…') : t('Send to production', 'پیداوار کے لیے بھیجیں')}</button>
        <button type="button" className="button" disabled={busy} onClick={() => dialog.current?.close()}>{t('Cancel', 'منسوخ کریں')}</button>
      </div>
    </form>
  </dialog>;
}
