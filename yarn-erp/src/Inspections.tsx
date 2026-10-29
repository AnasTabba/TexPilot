import { useCallback, useEffect, useState } from 'react';
import { Camera, ClipboardCheck, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { inventoryRequest as api } from './inventory-client';
import { useLanguage } from './i18n';
import { factoryTime, fixedInput, quantity } from './erp-client';

type Severity = 'minor' | 'major' | 'critical';
interface Lot { id: string; reference: string; product_name: string; supplier_name: string; order_reference: string; quantity_milli: number; open_milli: number; unit: string; arrived_at: number; status: 'awaiting_inspection' | 'under_review' | 'settled' }
interface Photo { id: string; issue_id: string | null; taken_at: number }
interface Issue { id: string; type: string; severity: Severity; description: string; status: string }
interface Inspection { id: string; lot_id: string; lot_reference: string; product_name: string; unit: string; accepted_milli: number; rejected_milli: number; note: string; status: 'draft' | 'submitted'; report_status: string | null; rejection_status: string | null; submitted_at: number | null; photos: Photo[]; issues: Issue[] }
const decision = (status: string | null) => status === null ? null : ({ pending: ['waiting for the supervisor', 'سپروائزر کے فیصلے کا منتظر'], accepted: ['accepted', 'قبول'], returned: ['returned for re-inspection', 'دوبارہ معائنے کے لیے واپس'], confirmed: ['rejection confirmed', 'مسترد کرنا تصدیق شدہ'], dismissed: ['rejection dismissed', 'مسترد کرنا خارج'], escalated: ['sent to the admin', 'ایڈمن کو بھیجا گیا'] } as Record<string, [string, string]>)[status];
const photoUrl = (id: string) => `/api/erp/qc/photos/${id}`;
// Undo and void requests carry their own ID so a retry after a dropped response replays the same change.
const newId = () => crypto.randomUUID();
const undecided = (value: string | null) => value === null || value === 'pending';
export async function upload(fields: Record<string, string>, file: File) {
  const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value); form.set('photo', file);
  const response = await fetch('/api/erp/qc/photos', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }).catch(() => null);
  if (!response) throw new Error('Could not confirm the upload. Check the connection and pick the photo again.');
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'The photo was not saved. Try again.');
}
export default function Inspections() {
  const { t } = useLanguage();
  const [lots, setLots] = useState<Lot[] | null>(null), [inspections, setInspections] = useState<Inspection[]>([]), [error, setError] = useState(''), [open, setOpen] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { const [a, b] = await Promise.all([api<{ lots: Lot[] }>('/erp/qc/lots'), api<{ inspections: Inspection[] }>('/erp/qc/inspections?mine=1')]); setLots(a.lots); setInspections(b.inspections); setError(''); } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const saved = (message: string) => async () => { setOpen(''); setNotice(message); await load(); };
  const drafts = inspections.filter(i => i.status === 'draft'), sent = inspections.filter(i => i.status === 'submitted');
  return <section className="live-panel"><div className="yf-head"><div><h2>{t('Inspections', 'معائنے')}</h2><p>{t('Count what you accept and what you reject, photograph the accepted quantity, describe every rejection, then submit.', 'جو قبول اور جو مسترد کریں اسے گنیں، قبول شدہ مقدار کی تصویر لیں، ہر مسترد مال کی وجہ لکھیں، پھر جمع کریں۔')}</p></div><button className="button" onClick={() => void load()}><RefreshCw size={18} />{t('Refresh', 'تازہ کریں')}</button></div>
    {error && <p className="live-error" role="alert">{t(error)}</p>}{notice && <p className="live-success" role="status">{notice}</p>}{!lots && !error && <p role="status">{t('Loading lots…', 'لاٹس لوڈ ہو رہی ہیں…')}</p>}
    <h3 className="live-subheading">{t('Lots to inspect', 'معائنے کی لاٹس')}</h3>
    {lots && !lots.some(l => l.open_milli > 0) && <p className="live-muted">{t('Lots appear here when the purchase manager registers an arrival.', 'خریداری مینیجر کی آمد درج کرنے پر لاٹس یہاں نظر آئیں گی۔')}</p>}
    <div className="erp-records">{lots?.filter(l => l.open_milli > 0).map(l => <article className="erp-record" key={l.id}><h3>{l.reference} · {l.product_name}</h3><p>{l.supplier_name} · {l.order_reference} · {factoryTime(l.arrived_at)}</p><p>{t('Still to inspect:', 'معائنہ باقی:')} {quantity(l.open_milli)} {t('of', 'میں سے')} {quantity(l.quantity_milli)} {l.unit}</p>
      {open === 'new:' + l.id ? <NewInspection lot={l} onSaved={saved(t('Draft saved. Add photos and issues, then submit it.', 'مسودہ محفوظ ہو گیا۔ تصاویر اور مسائل شامل کریں، پھر جمع کریں۔'))} onCancel={() => setOpen('')} /> : <button className="button primary" onClick={() => setOpen('new:' + l.id)}><Plus size={18} />{t('Record inspection', 'معائنہ درج کریں')}</button>}</article>)}</div>
    {drafts.length > 0 && <><h3 className="live-subheading">{t('Drafts', 'مسودے')}</h3><div className="erp-records">{drafts.map(i => <Draft key={i.id} inspection={i} open={open} setOpen={setOpen} onChanged={load} onSubmitted={saved(t('Inspection submitted. Supervisors have been told.', 'معائنہ جمع ہو گیا۔ سپروائزرز کو بتا دیا گیا ہے۔'))} onDeleted={saved(t('Draft deleted.', 'مسودہ حذف ہو گیا۔'))} />)}</div></>}
    {sent.length > 0 && <><h3 className="live-subheading">{t('Submitted', 'جمع شدہ')}</h3><div className="erp-records">{sent.map(i => <article className="erp-record" key={i.id}><h3>{i.lot_reference} · {i.product_name}</h3><p><ClipboardCheck size={16} aria-hidden="true" /> {t('Accepted', 'قبول')} {quantity(i.accepted_milli)} {i.unit}{decision(i.report_status) && <> · {t(...decision(i.report_status)!)}</>}</p><p>{t('Rejected', 'مسترد')} {quantity(i.rejected_milli)} {i.unit}{decision(i.rejection_status) && <> · {t(...decision(i.rejection_status)!)}</>}</p>{i.submitted_at && <p>{factoryTime(i.submitted_at)}</p>}
      {open === 'reopen:' + i.id ? <Reopen inspection={i} onSaved={saved(t('Inspection reopened. Correct it, then submit again.', 'معائنہ دوبارہ کھولا گیا۔ درست کریں، پھر دوبارہ جمع کریں۔'))} onCancel={() => setOpen('')} />
        : undecided(i.report_status) && undecided(i.rejection_status) && <button className="button" onClick={() => setOpen('reopen:' + i.id)}><RotateCcw size={18} />{t('Reopen to correct', 'درست کرنے کے لیے دوبارہ کھولیں')}</button>}
    </article>)}</div></>}
  </section>;
}
function NewInspection({ lot, onSaved, onCancel }: { lot: Lot; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID()), [accepted, setAccepted] = useState(''), [rejected, setRejected] = useState(''), [note, setNote] = useState('');
  const milli = (value: string, name: string) => value.trim() === '' || /^0(\.0+)?$/.test(value.trim()) ? 0 : fixedInput(value, 3, name);
  return <AsyncForm title={t('Record inspection', 'معائنہ درج کریں')} detail={lot.reference} submit={t('Save draft', 'مسودہ محفوظ کریں')} onCancel={onCancel} note={t('Nothing is final until you submit. Accepted quantity needs a photo; rejected quantity needs an issue.', 'جمع کرنے تک کچھ حتمی نہیں۔ قبول شدہ مقدار کے لیے تصویر اور مسترد مقدار کے لیے مسئلہ درکار ہے۔')}
    onSubmit={async () => { await api('/erp/qc/inspections', { id, lotId: lot.id, acceptedMilli: milli(accepted, t('Accepted quantity')), rejectedMilli: milli(rejected, t('Rejected quantity')), note }); await onSaved(); }}>
    <div className="live-fields"><Field>{t(`Accepted quantity (${lot.unit})`, `قبول شدہ مقدار (${lot.unit})`)}<input inputMode="decimal" value={accepted} onChange={e => setAccepted(e.target.value)} /></Field><Field>{t(`Rejected quantity (${lot.unit})`, `مسترد مقدار (${lot.unit})`)}<input inputMode="decimal" value={rejected} onChange={e => setRejected(e.target.value)} /></Field></div>
    <Field>{t('Note (optional)', 'نوٹ (اختیاری)')}<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000} /></Field>
  </AsyncForm>;
}
function Draft({ inspection: i, open, setOpen, onChanged, onSubmitted, onDeleted }: { inspection: Inspection; open: string; setOpen: (value: string) => void; onChanged: () => Promise<void>; onSubmitted: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const { t } = useLanguage(); const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const attach = (target: Record<string, string>) => (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => { await upload({ id: crypto.randomUUID(), ...target }, file); await onChanged(); }); };
  const shots = (issueId: string | null) => i.photos.filter(p => p.issue_id === issueId);
  const gallery = (issueId: string | null) => shots(issueId).length > 0 && <div className="live-actions">{shots(issueId).map(p => <span key={p.id}><a href={photoUrl(p.id)} target="_blank" rel="noreferrer"><img src={photoUrl(p.id)} alt={t(`Photo taken ${factoryTime(p.taken_at)}`, `تصویر ${factoryTime(p.taken_at)}`)} width={72} height={72} /></a>
    {open === 'void:' + p.id ? <VoidPhoto photo={p} onSaved={async () => { setOpen(''); await onChanged(); }} onCancel={() => setOpen('')} />
      : <button className="live-text-button" onClick={() => setOpen('void:' + p.id)}>{t('Void this photo', 'یہ تصویر منسوخ کریں')}</button>}</span>)}</div>;
  return <article className="erp-record"><h3>{i.lot_reference} · {i.product_name}</h3><p>{t('Accepted', 'قبول')} {quantity(i.accepted_milli)} · {t('Rejected', 'مسترد')} {quantity(i.rejected_milli)} {i.unit}</p>{i.note && <p className="erp-multiline">{i.note}</p>}
    <fieldset disabled={busy}>{i.accepted_milli > 0 && <><Field>{t('Photo of the accepted quantity', 'قبول شدہ مقدار کی تصویر')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={attach({ inspectionId: i.id })} /></Field>{gallery(null)}{!shots(null).length && <p className="live-muted"><Camera size={16} aria-hidden="true" /> {t('At least one photo is required.', 'کم از کم ایک تصویر ضروری ہے۔')}</p>}</>}
      {i.issues.map(x => <div className="erp-shipment" key={x.id}><strong>{x.type} · {t(x.severity, ({ minor: 'معمولی', major: 'بڑا', critical: 'سنگین' })[x.severity])}</strong><span className="erp-multiline">{x.description}</span><Field>{t('Photo of this issue (optional)', 'اس مسئلے کی تصویر (اختیاری)')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={attach({ issueId: x.id })} /></Field>{gallery(x.id)}
        {open === 'remove:' + x.id ? <DiscardForm title={t('Remove this issue', 'یہ مسئلہ ہٹائیں')} note={t('The issue and its photos are removed from this draft. Nothing has been submitted.', 'یہ مسئلہ اور اس کی تصاویر مسودے سے ہٹ جائیں گی۔ کچھ بھی جمع نہیں ہوا۔')} submit={t('Remove issue', 'مسئلہ ہٹائیں')} path="/erp/qc/issues/delete" body={{ id: x.id }} onDone={async () => { setOpen(''); await onChanged(); }} onCancel={() => setOpen('')} />
          : <button className="live-text-button" onClick={() => setOpen('remove:' + x.id)}><Trash2 size={16} aria-hidden="true" /> {t('Remove issue', 'مسئلہ ہٹائیں')}</button>}</div>)}
      {i.rejected_milli > 0 && !i.issues.length && <p className="live-muted">{t('Describe at least one issue for the rejected quantity.', 'مسترد مقدار کے لیے کم از کم ایک مسئلہ بیان کریں۔')}</p>}
      {open === 'issue:' + i.id ? <NewIssue inspectionId={i.id} onSaved={async () => { setOpen(''); await onChanged(); }} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('issue:' + i.id)}><Plus size={18} />{t('Add an issue', 'مسئلہ شامل کریں')}</button>}
      {open === 'edit:' + i.id ? <EditDraft inspection={i} onSaved={async () => { setOpen(''); await onChanged(); }} onCancel={() => setOpen('')} />
        : <button className="button" onClick={() => setOpen('edit:' + i.id)}><Pencil size={18} />{t('Edit quantities', 'مقداریں بدلیں')}</button>}
      <button className="button primary" onClick={() => void run(async () => { await api('/erp/qc/inspections/submit', { id: i.id }); await onSubmitted(); })}><Send size={18} />{t('Submit inspection', 'معائنہ جمع کریں')}</button>
      {open === 'delete:' + i.id ? <DiscardForm title={t('Delete this draft', 'یہ مسودہ حذف کریں')} note={t('The draft, its photos and its issues are deleted. Nothing has been submitted, so nothing on record is lost.', 'مسودہ، اس کی تصاویر اور مسائل حذف ہو جائیں گے۔ کچھ بھی جمع نہیں ہوا، اس لیے ریکارڈ میں کچھ کھوئے گا نہیں۔')} submit={t('Delete draft', 'مسودہ حذف کریں')} path="/erp/qc/inspections/delete" body={{ id: i.id }} onDone={onDeleted} onCancel={() => setOpen('')} />
        : <button className="live-text-button" onClick={() => setOpen('delete:' + i.id)}><Trash2 size={16} aria-hidden="true" /> {t('Delete draft', 'مسودہ حذف کریں')}</button>}</fieldset>
    {error && <p className="live-error" role="alert">{t(error)}</p>}</article>;
}
function NewIssue({ inspectionId, onSaved, onCancel }: { inspectionId: string; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(crypto.randomUUID()), [type, setType] = useState(''), [severity, setSeverity] = useState<Severity>('minor'), [description, setDescription] = useState('');
  return <AsyncForm title={t('Add an issue', 'مسئلہ شامل کریں')} submit={t('Save issue', 'مسئلہ محفوظ کریں')} onCancel={onCancel} note={t('Describe what is wrong so the supervisor can decide without seeing the lot.', 'بتائیں کیا خرابی ہے تاکہ سپروائزر لاٹ دیکھے بغیر فیصلہ کر سکے۔')} onSubmit={async () => { await api('/erp/qc/issues', { id, inspectionId, type, severity, description }); await onSaved(); }}>
    <Field>{t('Issue type', 'مسئلے کی قسم')}<input value={type} onChange={e => setType(e.target.value)} required minLength={2} maxLength={80} /></Field>
    <Field>{t('Severity', 'شدت')}<select value={severity} onChange={e => setSeverity(e.target.value as Severity)}><option value="minor">{t('Minor', 'معمولی')}</option><option value="major">{t('Major', 'بڑا')}</option><option value="critical">{t('Critical', 'سنگین')}</option></select></Field>
    <Field>{t('Description', 'تفصیل')}<textarea value={description} onChange={e => setDescription(e.target.value)} required minLength={5} maxLength={2000} rows={3} /></Field>
  </AsyncForm>;
}
// Changing a draft's quantities: the server keeps them within the lot's uninspected quantity.
function EditDraft({ inspection: i, onSaved, onCancel }: { inspection: Inspection; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [accepted, setAccepted] = useState(String(i.accepted_milli / 1000)), [rejected, setRejected] = useState(String(i.rejected_milli / 1000)), [note, setNote] = useState(i.note);
  const milli = (value: string, name: string) => value.trim() === '' || /^0(\.0+)?$/.test(value.trim()) ? 0 : fixedInput(value, 3, name);
  return <AsyncForm title={t('Edit the draft quantities', 'مسودے کی مقداریں بدلیں')} detail={i.lot_reference} submit={t('Save changes', 'تبدیلیاں محفوظ کریں')} onCancel={onCancel} note={t('Still a draft: nothing is final until you submit. Changing the quantities keeps the photos and issues already added.', 'ابھی مسودہ ہے: جمع کرنے تک کچھ حتمی نہیں۔ مقداریں بدلنے سے پہلے سے شامل تصاویر اور مسائل برقرار رہتے ہیں۔')}
    onSubmit={async () => { await api('/erp/qc/inspections/update', { id: i.id, acceptedMilli: milli(accepted, t('Accepted quantity')), rejectedMilli: milli(rejected, t('Rejected quantity')), note }); await onSaved(); }}>
    <div className="live-fields"><Field>{t(`Accepted quantity (${i.unit})`, `قبول شدہ مقدار (${i.unit})`)}<input inputMode="decimal" value={accepted} onChange={e => setAccepted(e.target.value)} /></Field><Field>{t(`Rejected quantity (${i.unit})`, `مسترد مقدار (${i.unit})`)}<input inputMode="decimal" value={rejected} onChange={e => setRejected(e.target.value)} /></Field></div>
    <Field>{t('Note (optional)', 'نوٹ (اختیاری)')}<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000} /></Field>
  </AsyncForm>;
}
// Voiding a photo needs a reason; the photo stays on record and leaves the report.
function VoidPhoto({ photo, onSaved, onCancel }: { photo: Photo; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(newId), [reason, setReason] = useState('');
  return <AsyncForm title={t('Void this photo', 'یہ تصویر منسوخ کریں')} submit={t('Void photo', 'تصویر منسوخ کریں')} onCancel={onCancel}
    note={t('The photo is hidden from the report and kept on record. Upload the right photo afterwards.', 'تصویر رپورٹ سے ہٹ جائے گی اور ریکارڈ میں محفوظ رہے گی۔ بعد میں درست تصویر شامل کریں۔')}
    onSubmit={async () => { await api('/erp/qc/photos/void', { id, photoId: photo.id, reason }); await onSaved(); }}>
    <Field>{t('Reason (3 to 500 characters)', 'وجہ (3 سے 500 حروف)')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} required rows={2} /></Field>
  </AsyncForm>;
}
// Reopening a submitted inspection needs a reason; the supervisor's decision must not have been made yet.
function Reopen({ inspection: i, onSaved, onCancel }: { inspection: Inspection; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage(); const [id] = useState(newId), [reason, setReason] = useState('');
  return <AsyncForm title={t('Reopen to correct', 'درست کرنے کے لیے دوبارہ کھولیں')} detail={i.lot_reference} submit={t('Reopen inspection', 'معائنہ دوبارہ کھولیں')} onCancel={onCancel}
    note={t('It returns to a draft you can edit, photograph and submit again. Only possible before the supervisor decides.', 'یہ مسودے میں واپس آ جائے گا جسے آپ بدل، تصویر لے اور دوبارہ جمع کر سکتے ہیں۔ صرف سپروائزر کے فیصلے سے پہلے ممکن ہے۔')}
    onSubmit={async () => { await api('/erp/qc/inspections/reopen', { id, inspectionId: i.id, reason }); await onSaved(); }}>
    <Field>{t('Reason (3 to 500 characters)', 'وجہ (3 سے 500 حروف)')}<textarea value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={500} required rows={2} /></Field>
  </AsyncForm>;
}
// A confirmation for removing a draft or one of its issues: nothing has been submitted, so no reason is asked.
function DiscardForm({ title, note, submit, path, body, onDone, onCancel }: { title: string; note: string; submit: string; path: string; body: Record<string, string>; onDone: () => Promise<void>; onCancel: () => void }) {
  return <AsyncForm title={title} submit={submit} note={note} onCancel={onCancel} onSubmit={async () => { await api(path, body); await onDone(); }}><></></AsyncForm>;
}
