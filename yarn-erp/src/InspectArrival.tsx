import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CheckCheck, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react';
import { errorMessage } from './forms';
import { useLanguage } from './i18n';
import { quantity } from './erp-client';
import { inventoryRequest as api, type WorkspaceState } from './inventory-client';
import { upload } from './Inspections';
import './inspect-arrival.css';

export type Arrival = NonNullable<WorkspaceState['qcArrivals']>[number];
interface Props { arrival: Arrival; isAdmin: boolean; onClose: () => void; onDone: (message: string) => Promise<void> }
type Severity = 'minor' | 'major' | 'critical';

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
/** Quantity typed in kg or tonnes as milli-units. Empty is zero; null is not a number with up to 3 decimals. */
function parseQuantity(value: string): number | null {
  const v = value.trim();
  if (v === '') return 0;
  return /^\d+(\.\d{1,3})?$/.test(v) ? Math.round(Number(v) * 1000) : null;
}
function usePreview(file: File | null) {
  const [url, setUrl] = useState('');
  useEffect(() => { if (!file) { setUrl(''); return; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url;
}

/**
 * Inspects a whole arrival in one go, through the same records the Inspections page makes: a draft with the accepted and
 * rejected quantities (together the open quantity), one issue for the rejected part, and the photos. The accepted part
 * needs a photo; the rejected part needs an issue. Submitting hands the rest to the supervisor, as the Inspections page does.
 */
export default function InspectArrival({ arrival, isAdmin, onClose, onDone }: Props) {
  const { t, language } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  // Ids live as long as the dialog, so a retry after a failed step replays the same records instead of duplicating them.
  // A saved draft (its photo failed earlier) is resumed under its own id and quantities.
  const resuming = !!arrival.draft_id;
  const ids = useRef({ inspection: arrival.draft_id || crypto.randomUUID(), issue: crypto.randomUUID(), photo: crypto.randomUUID(), issuePhoto: crypto.randomUUID() });
  const [accepted, setAccepted] = useState(resuming ? String((arrival.draft_accepted ?? 0) / 1000) : ''), [rejected, setRejected] = useState(resuming ? String((arrival.draft_rejected ?? 0) / 1000) : '');
  const [issueType, setIssueType] = useState(''), [severity, setSeverity] = useState<Severity>('major'), [description, setDescription] = useState(''), [comment, setComment] = useState(''), [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null), [issueFile, setIssueFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const preview = usePreview(file), issuePreview = usePreview(issueFile);
  useEffect(() => { const d = dialog.current; if (d && !d.open) d.showModal(); }, []);

  // A resumed draft keeps its saved quantities; otherwise the two inputs must add up to the open quantity.
  const open = arrival.open_milli, parsedAccepted = resuming ? (arrival.draft_accepted ?? 0) : parseQuantity(accepted), parsedRejected = resuming ? (arrival.draft_rejected ?? 0) : parseQuantity(rejected);
  const acc = parsedAccepted ?? 0, rej = parsedRejected ?? 0;
  const quantityMessage = resuming ? '' : parsedAccepted === null || parsedRejected === null
    ? t('Use numbers with up to 3 decimal places.', 'تین اعشاری مقامات تک کے اعداد لکھیں۔')
    : parsedAccepted + parsedRejected !== open ? t(`Accepted and rejected must add up to ${quantity(open)} ${arrival.unit}.`, `قبول اور مسترد مل کر ${quantity(open)} ${arrival.unit} ہونے چاہئیں۔`) : '';

  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const why = reason.trim(), type = issueType.trim(), text = description.trim();
    if (quantityMessage) { setError(quantityMessage); return; }
    if (acc > 0 && !file) { setError(t('Add a photo of the accepted goods.', 'قبول شدہ مال کی تصویر شامل کریں۔')); return; }
    if (rej > 0 && type.length < 2) { setError(t('Give the issue a type of at least 2 characters.', 'مسئلے کی قسم کم از کم 2 حروف میں لکھیں۔')); return; }
    if (rej > 0 && text.length < 5) { setError(t('Describe the rejected goods in at least 5 characters.', 'مسترد مال کی تفصیل کم از کم 5 حروف میں لکھیں۔')); return; }
    if (isAdmin && why.length < 5) { setError(t('Give a reason of at least 5 characters for this admin action.', 'ایڈمن کارروائی کی کم از کم 5 حروف کی وجہ لکھیں۔')); return; }
    setBusy(true); setError('');
    try {
      const { inspection, issue, photo, issuePhoto } = ids.current;
      // Admins act outside their role, and the server wants the reason on every step.
      const base = isAdmin ? { interventionReason: why } : {};
      if (!resuming) await api('/erp/qc/inspections', { id: inspection, lotId: arrival.id, acceptedMilli: acc, rejectedMilli: rej, note: comment.trim(), ...base });
      if (rej > 0) await api('/erp/qc/issues', { id: issue, inspectionId: inspection, type, severity, description: text, ...base });
      if (acc > 0 && file) await upload({ id: photo, inspectionId: inspection, ...(isAdmin ? { interventionReason: why } : {}) }, await shrink(file));
      if (rej > 0 && issueFile) await upload({ id: issuePhoto, issueId: issue, ...(isAdmin ? { interventionReason: why } : {}) }, await shrink(issueFile));
      await api('/erp/qc/inspections/submit', { id: inspection, ...base });
      await onDone(acc > 0 && rej > 0
        ? t(`Inspection of ${arrival.reference} submitted: part accepted, part rejected. The supervisor decides both.`, `${arrival.reference} کا معائنہ جمع ہو گیا: کچھ قبول، کچھ مسترد۔ دونوں کا فیصلہ سپروائزر کرے گا۔`)
        : rej > 0
          ? t(`Inspection of ${arrival.reference} submitted. The supervisor decides the rejection and any claim.`, `${arrival.reference} کا معائنہ جمع ہو گیا۔ مسترد کرنے اور کلیم کا فیصلہ سپروائزر کرے گا۔`)
          : t(`${arrival.reference} accepted in full. Supervisors have been told.`, `${arrival.reference} مکمل طور پر قبول۔ سپروائزرز کو بتا دیا گیا ہے۔`));
    } catch (e) {
      setError(errorMessage(e, language));
    } finally { setBusy(false); }
  }

  // A resumed draft that should not be kept: deleting it returns the arrival to the inspection queue untouched.
  async function deleteDraft() {
    if (busy) return;
    const why = reason.trim();
    if (isAdmin && why.length < 5) { setError(t('Give a reason of at least 5 characters for this admin action.', 'ایڈمن کارروائی کی کم از کم 5 حروف کی وجہ لکھیں۔')); return; }
    setBusy(true); setError('');
    try {
      await api('/erp/qc/inspections/delete', { id: arrival.draft_id, ...(isAdmin ? { interventionReason: why } : {}) });
      await onDone(t(`The draft of ${arrival.reference} was deleted. The arrival waits for inspection.`, `${arrival.reference} کا مسودہ حذف ہو گیا۔ آمد معائنے کا منتظر ہے۔`));
    } catch (e) { setError(errorMessage(e, language)); } finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="inspect-arrival" aria-labelledby="inspect-arrival-title" onClose={onClose}
    onCancel={e => { if (busy) e.preventDefault(); }} onClick={e => { if (e.target === e.currentTarget && !busy) dialog.current?.close(); }}>
    <form className="inspect-arrival-form" onSubmit={save} noValidate>
      <header><h2 id="inspect-arrival-title">{t('Inspect arrival', 'آمد کا معائنہ کریں')}</h2>
        <p>{arrival.reference} · {arrival.supplier_name}</p>
        <p>{t('Still to inspect:', 'معائنہ باقی:')} {quantity(open)} {arrival.unit}</p></header>
      <fieldset disabled={busy} className="inspect-arrival-fields">
        <div className="inspect-arrival-quantities">
          <div className="live-field">
            <label htmlFor="inspect-accepted">{t(`Accepted (${arrival.unit})`, `قبول شدہ (${arrival.unit})`)}</label>
            <input id="inspect-accepted" inputMode="decimal" value={accepted} disabled={resuming} onChange={e => setAccepted(e.target.value)} />
          </div>
          <div className="live-field">
            <label htmlFor="inspect-rejected">{t(`Rejected (${arrival.unit})`, `مسترد (${arrival.unit})`)}</label>
            <input id="inspect-rejected" inputMode="decimal" value={rejected} disabled={resuming} onChange={e => setRejected(e.target.value)} />
          </div>
        </div>
        {resuming
          ? <small className="live-muted">{t('Resuming the inspection saved earlier: add the photo and submit.', 'پہلے محفوظ کیا گیا معائنہ جاری ہے: تصویر شامل کر کے جمع کریں۔')}</small>
          : <small className="live-muted">{t(`Accepted and rejected must add up to ${quantity(open)} ${arrival.unit}.`, `قبول اور مسترد مل کر ${quantity(open)} ${arrival.unit} ہونے چاہئیں۔`)}</small>}
        {acc > 0 && <div className="live-field">
          <label htmlFor="inspect-photo">{t('Photo of the accepted goods', 'قبول شدہ مال کی تصویر')}</label>
          <input id="inspect-photo" type="file" accept="image/*" capture="environment" onChange={e => { ids.current.photo = crypto.randomUUID(); setFile(e.target.files?.[0] ?? null); }} />
          <small className="live-muted"><Camera size={16} aria-hidden="true" /> {t('Required with an accepted quantity. JPEG, PNG or WebP.', 'قبول شدہ مقدار کے ساتھ ضروری۔ JPEG، PNG یا WebP۔')}</small>
          {preview && <img className="inspect-arrival-preview" src={preview} alt={t('Preview of the selected photo', 'منتخب تصویر کا پیش نظارہ')} />}
        </div>}
        {rej > 0 && <div className="inspect-arrival-issue">
          <div className="live-field">
            <label htmlFor="inspect-issue-type">{t('Issue type', 'مسئلے کی قسم')}</label>
            <input id="inspect-issue-type" value={issueType} maxLength={80} onChange={e => setIssueType(e.target.value)} />
          </div>
          <div className="live-field">
            <label htmlFor="inspect-severity">{t('Severity', 'شدت')}</label>
            <select id="inspect-severity" value={severity} onChange={e => setSeverity(e.target.value as Severity)}>
              <option value="minor">{t('Minor', 'معمولی')}</option><option value="major">{t('Major', 'بڑا')}</option><option value="critical">{t('Critical', 'سنگین')}</option>
            </select>
          </div>
          <div className="live-field">
            <label htmlFor="inspect-description">{t('Description of the rejected goods', 'مسترد مال کی تفصیل')}</label>
            <textarea id="inspect-description" rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="live-field">
            <label htmlFor="inspect-issue-photo">{t('Photo of the issue (optional)', 'مسئلے کی تصویر (اختیاری)')}</label>
            <input id="inspect-issue-photo" type="file" accept="image/*" capture="environment" onChange={e => { ids.current.issuePhoto = crypto.randomUUID(); setIssueFile(e.target.files?.[0] ?? null); }} />
            {issuePreview && <img className="inspect-arrival-preview" src={issuePreview} alt={t('Preview of the issue photo', 'مسئلے کی تصویر کا پیش نظارہ')} />}
          </div>
        </div>}
        <div className="live-field">
          <label htmlFor="inspect-comment">{t('Comments (optional)', 'تبصرے (اختیاری)')}</label>
          <textarea id="inspect-comment" rows={2} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} />
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
        {resuming && <button type="button" className="button" disabled={busy} onClick={() => void deleteDraft()}><Trash2 size={18} aria-hidden="true" />{t('Delete draft', 'مسودہ حذف کریں')}</button>}
        <button type="button" className="button" disabled={busy} onClick={() => dialog.current?.close()}>{t('Cancel', 'منسوخ کریں')}</button>
      </div>
    </form>
  </dialog>;
}
