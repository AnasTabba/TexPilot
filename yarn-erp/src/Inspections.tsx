import { useCallback, useEffect, useState } from 'react';
import { Camera, ClipboardCheck, Plus, RefreshCw, Send } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { inventoryRequest as api } from './inventory-client';
import { useLanguage } from './i18n';
import { factoryTime, fixedInput, quantity } from './erp-client';
import { NextStep, SectionTabs } from './PortalCommon';

type Severity = 'minor' | 'major' | 'critical';
interface Lot { id: string; reference: string; product_name: string; supplier_name: string; order_reference: string; quantity_milli: number; open_milli: number; unit: string; arrived_at: number; status: 'awaiting_inspection' | 'under_review' | 'settled' }
interface Photo { id: string; issue_id: string | null; taken_at: number }
interface Issue { id: string; type: string; severity: Severity; description: string; status: string }
interface Inspection { id: string; lot_id: string; lot_reference: string; product_name: string; unit: string; accepted_milli: number; rejected_milli: number; note: string; status: 'draft' | 'submitted'; report_status: string | null; report_reason: string | null; rejection_status: string | null; submitted_at: number | null; photos: Photo[]; issues: Issue[] }
const decision = (status: string | null) => status === null ? null : ({ pending: ['waiting for the supervisor', 'سپروائزر کے فیصلے کا منتظر'], accepted: ['accepted', 'قبول'], returned: ['returned for re-inspection', 'دوبارہ معائنے کے لیے واپس'], confirmed: ['rejection confirmed', 'مسترد کرنا تصدیق شدہ'], dismissed: ['rejection dismissed', 'مسترد کرنا خارج'], escalated: ['sent to the admin', 'ایڈمن کو بھیجا گیا'] } as Record<string, [string, string]>)[status];
const photoUrl = (id: string) => `/api/erp/qc/photos/${id}`;
async function upload(fields: Record<string, string>, file: File) {
  const form = new FormData(); for (const [key, value] of Object.entries(fields)) form.set(key, value); form.set('photo', file);
  const response = await fetch('/api/erp/qc/photos', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }).catch(() => null);
  if (!response) throw new Error('Could not confirm the upload. Check the connection and pick the photo again.');
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'The photo was not saved. Try again.');
}
export default function Inspections({ view = 'lots' }: { view?: 'dashboard' | 'lots' | 'submissions' }) {
  const { t } = useLanguage();
  const [lots, setLots] = useState<Lot[] | null>(null), [inspections, setInspections] = useState<Inspection[]>([]), [error, setError] = useState(''), [open, setOpen] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { const [a, b] = await Promise.all([api<{ lots: Lot[] }>('/erp/qc/lots'), api<{ inspections: Inspection[] }>('/erp/qc/inspections?mine=1')]); setLots(a.lots); setInspections(b.inspections); setError(''); } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const saved = (message: string) => async () => { setOpen(''); setNotice(message); await load(); };
  const drafts = inspections.filter(i => i.status === 'draft'), sent = inspections.filter(i => i.status === 'submitted');
  const waiting = [...(lots || [])].filter(l => l.open_milli > 0).sort((a, b) => a.arrived_at - b.arrived_at);
  const returned = sent.filter(i => i.report_status === 'returned');
  const [tab, setTab] = useState<'returned' | 'mine'>(() => location.hash.includes('/returned') ? 'returned' : 'mine');
  if (view === 'dashboard') return <section className="live-panel">{error && <p className="live-error" role="alert">{t(error)} <button className="live-text-button" onClick={() => void load()}>{t('Retry connection', 'دوبارہ رابطہ کریں')}</button></p>}{!lots && !error && <p role="status">{t('Loading lots…', 'لاٹس لوڈ ہو رہی ہیں…')}</p>}{lots && <NextStep tone={waiting.length ? 'warn' : 'ok'} title={waiting.length ? t('Next: inspect the oldest waiting lot', 'اگلا کام: سب سے پرانے منتظر لاٹ کا معائنہ کریں') : t('No lots are waiting for inspection', 'معائنے کے لیے کوئی لاٹ منتظر نہیں')} reason={waiting[0] ? `${waiting[0].reference} · ${waiting[0].product_name} · ${quantity(waiting[0].open_milli)} ${waiting[0].unit}` : t('New arrivals appear here when registered.', 'نئی آمد درج ہونے پر یہاں نظر آئے گی۔')} />}</section>;
  return <section className="live-panel"><div className="yf-head"><div><h2>{t(view === 'lots' ? 'Lots to inspect' : 'My submissions', view === 'lots' ? 'معائنے کے لاٹس' : 'میری رپورٹس')}</h2><p>{t('Count what you accept and reject, photograph accepted quantities, describe issues, then submit.', 'قبول اور مسترد مقدار درج کریں، قبول شدہ مقدار کی تصاویر اور مسائل شامل کر کے جمع کریں۔')}</p></div><button className="button" onClick={() => void load()}><RefreshCw size={18} />{t('Refresh', 'تازہ کریں')}</button></div>
    {error && <p className="live-error" role="alert">{t(error)}</p>}{notice && <p className="live-success" role="status">{notice}</p>}{!lots && !error && <p role="status">{t('Loading lots…', 'لاٹس لوڈ ہو رہی ہیں…')}</p>}
    {view === 'submissions' && <SectionTabs tabs={[{ id: 'mine', en: 'My submissions', ur: 'میری رپورٹس' }, { id: 'returned', en: 'Returned', ur: 'واپس شدہ' }]} value={tab} onChange={id => { const next = id === 'returned' ? 'returned' : 'mine'; setTab(next); location.hash = next === 'returned' ? '#/submissions/returned' : '#/submissions'; }} />}
    {view === 'submissions' && tab === 'returned' && <h3 className="live-subheading">{t('Returned items', 'واپس شدہ آئٹمز')}</h3>}
    {view === 'submissions' && tab === 'returned' && returned.length === 0 && <p className="live-empty">{t('No returned inspections.', 'کوئی معائنہ واپس نہیں آیا۔')}</p>}
    {view === 'submissions' && tab === 'mine' && sent.length === 0 && <p className="live-empty">{t('No submitted inspections yet.', 'ابھی کوئی معائنہ جمع نہیں ہوا۔')}</p>}
    {view === 'lots' && <><h3 className="live-subheading">{t('Lots to inspect', 'معائنے کی لاٹس')}</h3>
    {lots && !lots.some(l => l.open_milli > 0) && <p className="live-muted">{t('Lots appear here when the purchase manager registers an arrival.', 'خریداری مینیجر کی آمد درج کرنے پر لاٹس یہاں نظر آئیں گی۔')}</p>}
    <div className="erp-records">{lots?.filter(l => l.open_milli > 0).map(l => <article className="erp-record" key={l.id}><h3>{l.reference} · {l.product_name}</h3><p>{l.supplier_name} · {l.order_reference} · {factoryTime(l.arrived_at)}</p><p>{t('Still to inspect:', 'معائنہ باقی:')} {quantity(l.open_milli)} {t('of', 'میں سے')} {quantity(l.quantity_milli)} {l.unit}</p>
      {open === 'new:' + l.id ? <NewInspection lot={l} onSaved={saved(t('Draft saved. Add photos and issues, then submit it.', 'مسودہ محفوظ ہو گیا۔ تصاویر اور مسائل شامل کریں، پھر جمع کریں۔'))} onCancel={() => setOpen('')} /> : <button className="button primary" onClick={() => setOpen('new:' + l.id)}><Plus size={18} />{t('Record inspection', 'معائنہ درج کریں')}</button>}</article>)}</div></>}
    {drafts.length > 0 && <><h3 className="live-subheading">{t('Drafts', 'مسودے')}</h3><div className="erp-records">{drafts.map(i => <Draft key={i.id} inspection={i} open={open} setOpen={setOpen} onChanged={load} onSubmitted={saved(t('Inspection submitted. Supervisors have been told.', 'معائنہ جمع ہو گیا۔ سپروائزرز کو بتا دیا گیا ہے۔'))} />)}</div></>}
    {(view === 'lots' ? drafts : tab === 'returned' ? returned : sent).length > 0 && <><h3 className="live-subheading">{t(view === 'lots' ? 'Drafts' : tab === 'returned' ? 'Returned items' : 'Submitted', view === 'lots' ? 'مسودے' : tab === 'returned' ? 'واپس شدہ آئٹمز' : 'جمع شدہ')}</h3><div className="erp-records">{(view === 'lots' ? drafts : tab === 'returned' ? returned : sent).map(i => <article className="erp-record" key={i.id}><h3>{i.lot_reference} · {i.product_name}</h3><p><ClipboardCheck size={16} aria-hidden="true" /> {t('Accepted', 'قبول')} {quantity(i.accepted_milli)} {i.unit}{decision(i.report_status) && <> · {t(...decision(i.report_status)!)}</>}</p><p>{t('Rejected', 'مسترد')} {quantity(i.rejected_milli)} {i.unit}{decision(i.rejection_status) && <> · {t(...decision(i.rejection_status)!)}</>}</p>{i.report_status === 'returned' && <p className="live-error">{t('Supervisor reason:', 'سپروائزر کی وجہ:')} {i.report_reason || t('No reason provided.', 'کوئی وجہ فراہم نہیں کی گئی۔')}</p>}{i.submitted_at && <p>{factoryTime(i.submitted_at)}</p>}</article>)}</div></>}
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
function Draft({ inspection: i, open, setOpen, onChanged, onSubmitted }: { inspection: Inspection; open: string; setOpen: (value: string) => void; onChanged: () => Promise<void>; onSubmitted: () => Promise<void> }) {
  const { t } = useLanguage(); const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  const attach = (target: Record<string, string>) => (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => { await upload({ id: crypto.randomUUID(), ...target }, file); await onChanged(); }); };
  const shots = (issueId: string | null) => i.photos.filter(p => p.issue_id === issueId);
  const gallery = (issueId: string | null) => shots(issueId).length > 0 && <div className="live-actions">{shots(issueId).map(p => <a key={p.id} href={photoUrl(p.id)} target="_blank" rel="noreferrer"><img src={photoUrl(p.id)} alt={t(`Photo taken ${factoryTime(p.taken_at)}`, `تصویر ${factoryTime(p.taken_at)}`)} width={72} height={72} /></a>)}</div>;
  return <article className="erp-record"><h3>{i.lot_reference} · {i.product_name}</h3><p>{t('Accepted', 'قبول')} {quantity(i.accepted_milli)} · {t('Rejected', 'مسترد')} {quantity(i.rejected_milli)} {i.unit}</p>{i.note && <p className="erp-multiline">{i.note}</p>}
    <fieldset disabled={busy}>{i.accepted_milli > 0 && <><Field>{t('Photo of the accepted quantity', 'قبول شدہ مقدار کی تصویر')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={attach({ inspectionId: i.id })} /></Field>{gallery(null)}{!shots(null).length && <p className="live-muted"><Camera size={16} aria-hidden="true" /> {t('At least one photo is required.', 'کم از کم ایک تصویر ضروری ہے۔')}</p>}</>}
      {i.issues.map(x => <div className="erp-shipment" key={x.id}><strong>{x.type} · {t(x.severity, ({ minor: 'معمولی', major: 'بڑا', critical: 'سنگین' })[x.severity])}</strong><span className="erp-multiline">{x.description}</span><Field>{t('Photo of this issue (optional)', 'اس مسئلے کی تصویر (اختیاری)')}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={attach({ issueId: x.id })} /></Field>{gallery(x.id)}</div>)}
      {i.rejected_milli > 0 && !i.issues.length && <p className="live-muted">{t('Describe at least one issue for the rejected quantity.', 'مسترد مقدار کے لیے کم از کم ایک مسئلہ بیان کریں۔')}</p>}
      {open === 'issue:' + i.id ? <NewIssue inspectionId={i.id} onSaved={async () => { setOpen(''); await onChanged(); }} onCancel={() => setOpen('')} /> : <button className="button" onClick={() => setOpen('issue:' + i.id)}><Plus size={18} />{t('Add an issue', 'مسئلہ شامل کریں')}</button>}
      <button className="button primary" onClick={() => void run(async () => { await api('/erp/qc/inspections/submit', { id: i.id }); await onSubmitted(); })}><Send size={18} />{t('Submit inspection', 'معائنہ جمع کریں')}</button></fieldset>
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
