import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Ban, Check, CheckCheck, CircleX, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import { AsyncForm, Field, errorMessage } from './forms';
import { SectionTabs } from './PortalCommon';
import { inventoryRequest as api } from './inventory-client';
import { useLanguage } from './i18n';
import { factoryTime, quantity, rate } from './erp-client';

interface Photo { id: string; issue_id: string | null; taken_at: number }
interface Issue { id: string; type: string; severity: string; description: string }
interface Submission { id: string; lot_reference: string; product_name: string; supplier_name: string; unit: string; accepted_milli: number; rejected_milli: number; note: string; submitted_at: number; photos: Photo[]; issues: Issue[]; claim_minor?: number }
type Decision = { kind: 'report-reject' | 'dismiss'; id: string } | null;
type Decided = { kind: 'accepted' | 'returned' | 'dismissed'; item: Submission };
// Each decided kind is undone through the endpoint that made it: a report decision or a rejection decision.
const undoPath = { accepted: '/erp/qc/reports/undo', returned: '/erp/qc/reports/undo', dismissed: '/erp/qc/rejections/undo' } as const;

/** The supervisor's work: accept or return each inspection report, confirm, dismiss or escalate each rejection. Every action is one server decision. */
export default function Review() {
  const { t } = useLanguage();
  const [reports, setReports] = useState<Submission[] | null>(null), [rejections, setRejections] = useState<Submission[]>([]), [currency, setCurrency] = useState('PKR');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [form, setForm] = useState<Decision>(null), [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(''), [outcome, setOutcome] = useState('re_inspect');
  const [view, setView] = useState<'pending' | 'escalated' | 'decided'>('pending'), [escalated, setEscalated] = useState<Submission[] | null>(null);
  const [decided, setDecided] = useState<Decided[] | null>(null), [undo, setUndo] = useState<(Decided & { id: string }) | null>(null), [undoReason, setUndoReason] = useState('');
  const load = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([api<{ reports: Submission[] }>('/erp/qc/reports'), api<{ rejections: Submission[]; currency: string }>('/erp/qc/rejections'), api<{ rejections: Submission[] }>('/erp/qc/rejections?status=escalated')]);
      const [acc, ret, dis] = await Promise.all([api<{ reports: Submission[] }>('/erp/qc/reports?status=accepted'), api<{ reports: Submission[] }>('/erp/qc/reports?status=returned'), api<{ rejections: Submission[] }>('/erp/qc/rejections?status=dismissed')]);
      setReports(a.reports); setRejections(b.rejections); setEscalated(c.rejections); setCurrency(b.currency); setError('');
      setDecided([...acc.reports.map(item => ({ kind: 'accepted' as const, item })), ...ret.reports.map(item => ({ kind: 'returned' as const, item })), ...dis.rejections.map(item => ({ kind: 'dismissed' as const, item }))]);
    } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const decide = async (path: string, body: Record<string, string>, message: string) => {
    setBusy(true); setError('');
    try { await api(path, body); setNotice(message); setForm(null); setReason(''); await load(); } catch (e) { setError(errorMessage(e)); await load(); } finally { setBusy(false); }
  };
  const evidence = (i: Submission) => <><p>{i.supplier_name} · {t('submitted', 'جمع')} {factoryTime(i.submitted_at)}</p>{i.note && <p className="erp-multiline">{i.note}</p>}
    {i.photos.length > 0 && <div className="live-actions">{i.photos.map(p => <a key={p.id} href={`/api/erp/qc/photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/erp/qc/photos/${p.id}`} alt={t(`Photo taken ${factoryTime(p.taken_at)}`, `تصویر ${factoryTime(p.taken_at)}`)} width={96} height={96} loading="lazy" /></a>)}</div>}
    {i.issues.map(x => <p key={x.id} className="erp-shipment"><strong>{x.type} · {x.severity}</strong> <span className="erp-multiline">{x.description}</span></p>)}</>;
  const reasonForm = (i: Submission, kind: 'report-reject' | 'dismiss') => <AsyncForm title={kind === 'dismiss' ? t('Dismiss the rejection', 'مسترد کرنا خارج کریں') : t('Return the report', 'رپورٹ واپس کریں')} detail={i.lot_reference} submit={t('Save decision', 'فیصلہ محفوظ کریں')} onCancel={() => setForm(null)}
    onSubmit={() => decide(kind === 'dismiss' ? '/erp/qc/rejections/decide' : '/erp/qc/reports/decide', kind === 'dismiss' ? { inspectionId: i.id, decision: 'dismiss', dismissOutcome: outcome, reason } : { inspectionId: i.id, decision: 'reject', reason }, kind === 'dismiss' ? t('Rejection dismissed.', 'مسترد کرنا خارج ہو گیا۔') : t('Report returned for re-inspection.', 'رپورٹ دوبارہ معائنے کے لیے واپس کر دی گئی۔'))}>
    {kind === 'dismiss' && <Field>{t('What happens to the rejected quantity', 'مسترد مقدار کا کیا ہوگا')}<select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="re_inspect">{t('Inspect it again', 'دوبارہ معائنہ')}</option><option value="accept_with_deviation">{t('Accept it with a deviation', 'انحراف کے ساتھ قبول کریں')}</option></select></Field>}
    <Field>{t('Reason', 'وجہ')}<textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} minLength={5} maxLength={1000} required /></Field>
  </AsyncForm>;
  return <section className="live-panel"><div className="yf-head"><div><h2>{t('Inspection review', 'معائنے کا جائزہ')}</h2><p>{t('Accept the quantity the inspector approved, and decide what happens to every rejected quantity.', 'انسپکٹر کی قبول کردہ مقدار منظور کریں اور ہر مسترد مقدار کا فیصلہ کریں۔')}</p></div>
    <button className="button" onClick={() => void load()}><RefreshCw size={18} aria-hidden="true" />{t('Refresh', 'تازہ کریں')}</button></div>
    {error && <p className="live-error" role="alert"><TriangleAlert size={18} aria-hidden="true" />{t(error)}</p>}{notice && <p className="live-success" role="status">{notice}</p>}{!reports && !error && <p role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>}
    <h3 className="live-subheading">{t('Reports to accept', 'قبولیت کی رپورٹس')}</h3>
    {reports && !reports.length && <p className="live-muted">{t('No inspection reports are waiting.', 'کوئی معائنہ رپورٹ منتظر نہیں۔')}</p>}
    <div className="erp-records">{reports?.map(i => <article className="erp-record" key={i.id}><h3>{i.lot_reference} · {i.product_name}</h3><p>{t('Accepted by the inspector', 'انسپکٹر نے قبول کیا')}: <strong>{quantity(i.accepted_milli)} {i.unit}</strong></p>{evidence({ ...i, issues: [] })}
      {form?.id === i.id && form.kind === 'report-reject' ? reasonForm(i, 'report-reject') : <div className="live-actions"><button className="button primary" disabled={busy} onClick={() => void decide('/erp/qc/reports/decide', { inspectionId: i.id, decision: 'accept' }, t('Report accepted. The stock is in the raw store.', 'رپورٹ قبول۔ اسٹاک خام اسٹور میں ہے۔'))}><Check size={18} aria-hidden="true" />{t('Accept report', 'رپورٹ قبول کریں')}</button>
        <button className="button" disabled={busy} onClick={() => { setReason(''); setForm({ kind: 'report-reject', id: i.id }); }}><CircleX size={18} aria-hidden="true" />{t('Return for re-inspection', 'دوبارہ معائنے کے لیے واپس')}</button></div>}</article>)}</div>
    <h3 className="live-subheading">{view === 'pending' ? t('Rejections to decide', 'مسترد مقداروں کے فیصلے') : view === 'escalated' ? t('Escalated to admin', 'ایڈمن کو بھیجی گئی مسترد مقداریں') : t('Decided', 'فیصلہ شدہ')}</h3>
    <SectionTabs tabs={[{ id: 'pending', en: 'To decide', ur: 'فیصلہ باقی' }, { id: 'escalated', en: 'Escalated to admin', ur: 'ایڈمن کو بھیجی گئی' }, { id: 'decided', en: 'Decided', ur: 'فیصلہ شدہ' }]} value={view} onChange={id => setView(id as 'pending' | 'escalated' | 'decided')} />
    {view === 'decided' && <>
      {!decided && !error && <p role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>}
      {decided && !decided.length && <p className="live-muted">{t('No decisions to undo.', 'واپس لینے کے لیے کوئی فیصلہ نہیں۔')}</p>}
      <div className="erp-records">{decided?.map(({ kind, item }) => <article className="erp-record" key={`${kind}-${item.id}`}><h3>{item.lot_reference} · {item.product_name}</h3>
        <p>{kind === 'accepted' ? t('Accepted', 'قبول') : kind === 'returned' ? t('Returned for re-inspection', 'دوبارہ معائنے کے لیے واپس') : t('Rejection dismissed', 'مسترد کرنا خارج')}: <strong>{quantity(kind === 'dismissed' ? item.rejected_milli : item.accepted_milli)} {item.unit}</strong></p>
        {undo?.item.id === item.id && undo.kind === kind ? <AsyncForm title={t('Undo this decision', 'یہ فیصلہ واپس لیں')} detail={item.lot_reference} submit={t('Undo decision', 'فیصلہ واپس لیں')} onCancel={() => setUndo(null)}
          note={kind === 'accepted' ? t('The stock received for this report is reversed. Refused once any of that stock has moved or been used.', 'اس رپورٹ کا وصول شدہ اسٹاک واپس ہوگا۔ اگر اس اسٹاک میں سے کچھ حرکت یا استعمال ہو چکا ہو تو منظور نہیں ہوگا۔') : kind === 'returned' ? t('The report goes back to waiting for a decision.', 'رپورٹ دوبارہ فیصلے کے انتظار میں چلی جائے گی۔') : t('The rejected quantity goes back to waiting for a decision. Refused if the lot was inspected again.', 'مسترد مقدار دوبارہ فیصلے کے انتظار میں چلی جائے گی۔ اگر لاٹ دوبارہ معائنہ ہو چکی ہو تو منظور نہیں ہوگا۔')}
          onSubmit={async () => { await api(undoPath[kind], { id: undo.id, inspectionId: item.id, reason: undoReason }); setUndo(null); setUndoReason(''); setNotice(t('Decision undone. It is waiting for a decision again.', 'فیصلہ واپس ہو گیا۔ دوبارہ فیصلے کے انتظار میں ہے۔')); await load(); }}>
          <Field>{t('Reason (3 to 500 characters)', 'وجہ (3 سے 500 حروف)')}<textarea value={undoReason} onChange={e => setUndoReason(e.target.value)} minLength={3} maxLength={500} required rows={3} /></Field>
        </AsyncForm> : <div className="live-actions"><button className="button" disabled={busy} onClick={() => { setUndoReason(''); setUndo({ kind, item, id: crypto.randomUUID() }); }}><RotateCcw size={18} aria-hidden="true" />{t('Undo decision', 'فیصلہ واپس لیں')}</button></div>}
      </article>)}</div>
    </>}
    {view === 'escalated' && <>
      {!escalated && !error && <p role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>}
      {escalated && !escalated.length && <p className="live-muted">{t('No rejections are waiting for the admin.', 'ایڈمن کے فیصلے کے منتظر کوئی مسترد مقدار نہیں۔')}</p>}
      <div className="erp-records">{escalated?.map(i => <article className="erp-record" key={i.id}><h3>{i.lot_reference} · {i.product_name}</h3><p>{t('Rejected', 'مسترد')}: <strong>{quantity(i.rejected_milli)} {i.unit}</strong> · {t('claim if confirmed', 'تصدیق پر دعویٰ')} {rate(i.claim_minor ?? 0, currency)}</p>{evidence({ ...i, photos: i.photos.filter(p => p.issue_id) })}
        <p className="live-muted">{t('Waiting for the admin decision.', 'ایڈمن کے فیصلے کا انتظار ہے۔')}</p></article>)}</div>
    </>}
    {view === 'pending' && <>
    {reports && !rejections.length && <p className="live-muted">{t('No rejections are waiting.', 'کوئی مسترد مقدار منتظر نہیں۔')}</p>}
    <div className="erp-records">{rejections.map(i => <article className="erp-record" key={i.id}><h3>{i.lot_reference} · {i.product_name}</h3><p>{t('Rejected', 'مسترد')}: <strong>{quantity(i.rejected_milli)} {i.unit}</strong> · {t('claim if confirmed', 'تصدیق پر دعویٰ')} {rate(i.claim_minor ?? 0, currency)}</p>{evidence({ ...i, photos: i.photos.filter(p => p.issue_id) })}
      {form?.id === i.id && form.kind === 'dismiss' ? reasonForm(i, 'dismiss') : <div className="live-actions"><button className="button primary" disabled={busy} onClick={() => void decide('/erp/qc/rejections/decide', { inspectionId: i.id, decision: 'confirm' }, t('Rejection confirmed. A claim was raised.', 'مسترد کرنا تصدیق شدہ۔ دعویٰ درج ہو گیا۔'))}><CheckCheck size={18} aria-hidden="true" />{t('Confirm rejection', 'مسترد کرنا تصدیق کریں')}</button>
        <button className="button" disabled={busy} onClick={() => { setReason(''); setOutcome('re_inspect'); setForm({ kind: 'dismiss', id: i.id }); }}><Ban size={18} aria-hidden="true" />{t('Dismiss', 'خارج کریں')}</button>
        <button className="button" disabled={busy} onClick={() => void decide('/erp/qc/rejections/decide', { inspectionId: i.id, decision: 'escalate' }, t('Sent to the admin to decide.', 'ایڈمن کو فیصلے کے لیے بھیج دیا گیا۔'))}><ArrowUpRight size={18} aria-hidden="true" />{t('Escalate to admin', 'ایڈمن کو بھیجیں')}</button></div>}</article>)}</div>
    </>}
  </section>;
}
