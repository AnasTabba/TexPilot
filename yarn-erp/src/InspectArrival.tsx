import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CheckCheck, LoaderCircle, TriangleAlert } from 'lucide-react';
import { errorMessage } from './forms';
import { useLanguage } from './i18n';
import { quantity } from './erp-client';
import { inventoryRequest as api, type WorkspaceState } from './inventory-client';
import { upload } from './Inspections';
import './inspect-arrival.css';

export type Arrival = NonNullable<WorkspaceState['qcArrivals']>[number];
interface Props { arrival: Arrival; isAdmin: boolean; onClose: () => void; onDone: (message: string) => Promise<void> }

/**
 * Inspects a whole arrival in one go, through the same records the Inspections page makes:
 * No claim = draft accepting the open quantity (photo required), Yes claim = draft rejecting it with one issue
 * (the comment, severity major). Submitting hands the rest to the supervisor, as the Inspections page does.
 */
/** Phone photos are often several MB; send a JPEG of at most 2000 px so uploads are quick and fit the photo store. */
async function shrink(file: File): Promise<File> {
  if (file.size < 1.5 * 1024 * 1024) return file;
  try {
    const image = await createImageBitmap(file), scale = Math.min(1, 2000 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export default function InspectArrival({ arrival, isAdmin, onClose, onDone }: Props) {
  const { t, language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  // Ids live as long as the dialog, so a retry after a failed step replays the same records instead of duplicating them.
  // A saved draft (its photo failed earlier) is resumed under its own id with its own choice.
  const resuming = !!arrival.draft_id;
  const ids = useRef({ inspection: arrival.draft_id || crypto.randomUUID(), issue: crypto.randomUUID(), photo: crypto.randomUUID() });
  const [claim, setClaim] = useState((arrival.draft_rejected ?? 0) > 0), [comment, setComment] = useState(''), [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const d = dialog.current; if (d && !d.open) d.showModal(); }, []);
  useEffect(() => { if (!file) return; const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);

  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const text = comment.trim(), why = reason.trim(), open = arrival.open_milli;
    if (claim && text.length < 5) { setError(t('Describe the problem in at least 5 characters to raise a claim.', 'کلیم دائر کرنے کے لیے مسئلہ کم از کم 5 حروف میں بیان کریں۔')); return; }
    if (!claim && !file) { setError(t('Add a photo of the accepted goods, or raise a claim.', 'قبول شدہ مال کی تصویر شامل کریں، یا کلیم دائر کریں۔')); return; }
    if (isAdmin && why.length < 5) { setError(t('Give a reason of at least 5 characters for this admin action.', 'ایڈمن کارروائی کی کم از کم 5 حروف کی وجہ لکھیں۔')); return; }
    setBusy(true); setError('');
    try {
      const { inspection, issue, photo } = ids.current;
      // Admins act outside their role, and the server wants the reason on every step.
      const base = isAdmin ? { interventionReason: why } : {};
      if (!resuming) await api('/erp/qc/inspections', { id: inspection, lotId: arrival.id, acceptedMilli: claim ? 0 : open, rejectedMilli: claim ? open : 0, note: text, ...base });
      let target: Record<string, string> = { inspectionId: inspection };
      if (claim) {
        await api('/erp/qc/issues', { id: issue, inspectionId: inspection, type: 'Rejected at inspection', severity: 'major', description: text, ...base });
        target = { issueId: issue };
      }
      if (file) await upload({ id: photo, ...target, ...(isAdmin ? { interventionReason: why } : {}) }, await shrink(file));
      await api('/erp/qc/inspections/submit', { id: inspection, ...base });
      await onDone(claim
        ? t(`Inspection of ${arrival.reference} submitted. The supervisor decides the rejection and any claim.`, `${arrival.reference} کا معائنہ جمع ہو گیا۔ مسترد کرنے اور کلیم کا فیصلہ سپروائزر کرے گا۔`)
        : t(`${arrival.reference} accepted in full. Supervisors have been told.`, `${arrival.reference} مکمل طور پر قبول۔ سپروائزرز کو بتا دیا گیا ہے۔`));
    } catch (e) {
      setError(errorMessage(e, language));
    } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="inspect-arrival" aria-labelledby="inspect-arrival-title" onClose={onClose}
    onCancel={e => { if (busy) e.preventDefault(); }} onClick={e => { if (e.target === e.currentTarget && !busy) dialog.current?.close(); }}>
    <form className="inspect-arrival-form" onSubmit={save} noValidate>
      <header><h2 id="inspect-arrival-title">{t('Inspect arrival', 'آمد کا معائنہ کریں')}</h2>
        <p>{arrival.reference} · {arrival.supplier_name}</p>
        <p>{t('Still to inspect:', 'معائنہ باقی:')} {quantity(arrival.open_milli)} {arrival.unit}</p></header>
      <fieldset disabled={busy} className="inspect-arrival-fields">
        <div className="live-field">
          <label htmlFor="inspect-photo">{t('Photo', 'تصویر')}</label>
          <input id="inspect-photo" type="file" accept="image/*" capture="environment" onChange={e => { ids.current.photo = crypto.randomUUID(); setFile(e.target.files?.[0] ?? null); }} />
          <small className="live-muted"><Camera size={16} aria-hidden="true" /> {claim ? t('Optional with a claim. JPEG, PNG or WebP.', 'کلیم کے ساتھ اختیاری۔ JPEG، PNG یا WebP۔') : t('Required without a claim: a photo of the accepted goods.', 'بغیر کلیم کے تصویر ضروری ہے: قبول شدہ مال کی تصویر۔')}</small>
          {preview && <img className="inspect-arrival-preview" src={preview} alt={t('Preview of the selected photo', 'منتخب تصویر کا پیش نظارہ')} />}
        </div>
        <div className="live-field">
          <span id="inspect-claim-label" className="inspect-arrival-label">{t('Raise a claim?', 'کیا کلیم دائر کریں؟')}</span>
          <div className="live-segments" role="group" aria-labelledby="inspect-claim-label">
            <button type="button" aria-pressed={!claim} disabled={resuming} onClick={() => setClaim(false)}>{t('No', 'نہیں')}</button>
            <button type="button" aria-pressed={claim} disabled={resuming} onClick={() => setClaim(true)}>{t('Yes', 'ہاں')}</button>
          </div>
          {resuming && <small className="live-muted">{t('Resuming the inspection saved earlier: add the photo and submit.', 'پہلے محفوظ کیا گیا معائنہ جاری ہے: تصویر شامل کر کے جمع کریں۔')}</small>}
          {claim && <small className="live-muted">{t('A claim rejects the whole open quantity as a major issue, for the supervisor to decide.', 'کلیم میں باقی پوری مقدار بڑے مسئلے کے طور پر مسترد ہوگی، جس کا فیصلہ سپروائزر کرے گا۔')}</small>}
        </div>
        <div className="live-field">
          <label htmlFor="inspect-comment">{claim ? t('Reason for the claim', 'کلیم کی وجہ') : t('Comments', 'تبصرے')}</label>
          <textarea id="inspect-comment" rows={3} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} />
        </div>
        {isAdmin && <div className="live-field">
          <label htmlFor="inspect-reason">{t('Reason for this admin action', 'ایڈمن کارروائی کی وجہ')}</label>
          <input id="inspect-reason" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} required />
          <small className="live-muted">{t('Admins record inspections as an intervention, so a reason is required.', 'ایڈمن معائنہ مداخلت کے طور پر درج کرتے ہیں، اس لیے وجہ ضروری ہے۔')}</small>
        </div>}
      </fieldset>
      {error && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{error}</p>}
      <div className="live-actions">
        <button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="live-spinning" size={20} aria-hidden="true" /> : <CheckCheck size={20} aria-hidden="true" />}{busy ? t('Saving…', 'محفوظ ہو رہا ہے…') : t('Submit inspection', 'معائنہ جمع کریں')}</button>
        <button type="button" className="button" disabled={busy} onClick={() => dialog.current?.close()}>{t('Cancel', 'منسوخ کریں')}</button>
      </div>
    </form>
  </dialog>;
}
