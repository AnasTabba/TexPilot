import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import './erp.css';
import './supervisor-screens.css';
import { Field, errorMessage } from './forms';
import { InterventionField, SectionTabs, StatusTag, portal } from './PortalCommon';
import { stageName, weight, type Member, type WorkspaceState } from './inventory-client';
import { quantity } from './erp-client';
import { useLanguage } from './i18n';

export const SUPERVISOR_SECTIONS = ['requests', 'report'] as const;
export type SupervisorSection = (typeof SUPERVISOR_SECTIONS)[number];

type StockQuery = { id: string; product_name: string; quantity_milli: number | null; question: string; status: string; available_grams: number | null; answer: string | null; asked_by_name: string };
type StockIssue = { id: string; lot_id: string; lot_batch: string; product_name: string; stage: 'raw' | 'finished'; kind: string; difference_grams: number; description: string; status: string; decision_reason: string | null; created_at: number };
type Threshold = { dispatchStockIssueGrams: number | null; inventoryAdjustmentGrams: number | null };
type QcItem = { id: string; lot_reference: string; product_name: string; rejected_milli: number; unit: string; rejection_reason: string | null; issues: { type: string; severity: string; description: string }[]; photos: (string | { id: string; taken_at: number })[] };
type Adjustment = { id: string; batch: string; product_name: string; stage: string; kind: string; delta_grams: number; reason: string; status: string; created_at: number };
type ReportDraft = { confirmedRejections: QcItem[]; escalations: QcItem[]; adjustments: Adjustment[] };
type SavedReport = { id: string; period_from: number; period_to: number; content: ReportDraft; flagged: { objectType: string; objectId: string; note: string }[]; note: string; created_by_name: string; created_at: number };

const kgToGrams = (value: string, { signed = false, allowZero = false } = {}) => {
  const trimmed = value.trim();
  if (!(signed ? /^-?\d+(?:\.\d{1,3})?$/ : /^\d+(?:\.\d{1,3})?$/).test(trimmed)) throw new Error('Enter kilograms with up to three decimal places.');
  const negative = trimmed.startsWith('-'), [whole, part = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  const grams = Number(whole) * 1000 + Number(part.padEnd(3, '0'));
  const result = negative ? -grams : grams;
  if (!Number.isSafeInteger(result) || Math.abs(result) > 9e12 || (!allowZero && result === 0)) throw new Error('Enter a supported weight in kilograms.');
  return result;
};
const tryKgToGrams = (value: string, options: { signed?: boolean; allowZero?: boolean } = {}) => {
  if (!value.trim()) return null;
  try { return kgToGrams(value, options); } catch { return null; }
};
const dayInFactory = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
// Factory days (UTC+5) become a whole-day window: the server stores decided_at in epoch milliseconds.
const periodBounds = (from: string, to: string) => {
  const start = Date.parse(`${from}T00:00:00+05:00`), end = Date.parse(`${to}T00:00:00+05:00`) + 86400000 - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Choose a valid report period.');
  return { from: start, to: end };
};
const stageUr: Record<string, string> = { raw: 'خام مال', cops: 'کاپس', wip: 'زیرِ تیاری', finished: 'تیار مال' };
const kindWords: Record<string, [string, string]> = { write_off: ['Write-off', 'ضائع'], adjustment: ['Correction', 'درستگی'], shortage: ['Shortage', 'کمی'], mismatch: ['Mismatch', 'عدم مطابقت'] };
const severityUr: Record<string, string> = { minor: 'معمولی', major: 'بڑا', critical: 'سنگین' };
const pair = (table: Record<string, [string, string]>, key: string): [string, string] => table[key] ?? [key, key];
const keyOf = (type: string, id: string) => `${type}:${id}`;
const dateTime = (value: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(value);
const dateOnly = (value: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium' }).format(value);

export function SupervisorScreens({ section, member, tab = '', itemId = '' }: { section: SupervisorSection; member: Member; state?: WorkspaceState; tab?: string; itemId?: string }) {
  const { t } = useLanguage();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [intervention, setIntervention] = useState(''), [loaded, setLoaded] = useState(false);
  const stepIn = member.role === 'admin' ? { interventionReason: intervention } : {};
  const [queries, setQueries] = useState<StockQuery[]>([]), [issues, setIssues] = useState<StockIssue[]>([]), [thresholds, setThresholds] = useState<Threshold | null>(null);
  const [queryDrafts, setQueryDrafts] = useState<Record<string, { kg: string; answer: string }>>({});
  const [issueDrafts, setIssueDrafts] = useState<Record<string, { correctionKg: string; reason: string }>>({});
  const [fromDate, setFromDate] = useState(() => `${dayInFactory(Date.now()).slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(() => dayInFactory(Date.now()));
  const [draft, setDraft] = useState<ReportDraft | null>(null), [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [flags, setFlags] = useState<Record<string, { selected: boolean; note: string }>>({});
  const [reportNote, setReportNote] = useState(''), [reportId, setReportId] = useState(() => crypto.randomUUID());

  const loadRequests = useCallback(async () => {
    const [q, i] = await Promise.all([
      portal<{ queries: StockQuery[] }>('/stock/queries'),
      portal<{ issues: StockIssue[]; thresholds: Threshold }>('/dispatch/stock-issues'),
    ]);
    setQueries(q.queries); setIssues(i.issues); setThresholds(i.thresholds);
  }, []);
  const loadReports = useCallback(async () => setSavedReports((await portal<{ reports: SavedReport[] }>('/stock/reports')).reports), []);
  const loadCurrent = useCallback(() => section === 'requests' ? loadRequests() : loadReports(), [section, loadRequests, loadReports]);

  useEffect(() => {
    setError(''); setNotice(''); setLoaded(false);
    void loadCurrent().catch(caught => setError(errorMessage(caught))).finally(() => setLoaded(true));
  }, [loadCurrent]);
  useEffect(() => {
    if (!itemId) return;
    requestAnimationFrame(() => document.getElementById(itemId)?.scrollIntoView({ block: 'center' }));
  }, [itemId, queries, issues]);

  const refresh = async () => {
    setBusy(true); setError('');
    try { await loadCurrent(); } catch (caught) { setError(errorMessage(caught)); } finally { setLoaded(true); setBusy(false); }
  };
  const finish = async (action: () => Promise<string | void>, message: string) => {
    setBusy(true); setError(''); setNotice('');
    try { setNotice((await action()) || message); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  };

  // Shared list status: loading, error with a retry, or the empty message. Null when there are rows to show.
  const listStatus = (count: number, empty: string) => {
    if (!loaded) return <p role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>;
    if (error && !count) return <button className="button" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} aria-hidden="true" />{t('Try again', 'دوبارہ کوشش کریں')}</button>;
    if (!count) return <p className="live-muted">{empty}</p>;
    return null;
  };

  async function answer(query: StockQuery, event: FormEvent) {
    event.preventDefault(); const values = queryDrafts[query.id] || { kg: '', answer: '' };
    await finish(async () => {
      await portal('/stock/queries/answer', { id: query.id, availableGrams: kgToGrams(values.kg, { allowZero: true }), ...(values.answer.trim() ? { answer: values.answer.trim() } : {}), ...stepIn });
      await loadRequests();
    }, t('Stock query answered.', 'اسٹاک کی درخواست کا جواب دے دیا گیا۔'));
  }
  async function decideIssue(issue: StockIssue, decision: 'accept' | 'reject') {
    const values = issueDrafts[issue.id] || { correctionKg: '', reason: '' };
    await finish(async () => {
      // Only an accepted issue can carry a stock correction; the server ignores one sent with a rejection.
      const correctionGrams = decision === 'accept' && values.correctionKg.trim() ? kgToGrams(values.correctionKg, { signed: true }) : undefined;
      const result = await portal<{ pendingApproval?: boolean }>('/dispatch/stock-issues/decide', { id: issue.id, decision, reason: values.reason, ...(correctionGrams === undefined ? {} : { correctionGrams }), ...stepIn });
      await loadRequests();
      if (result.pendingApproval) return t('The decision and stock correction are waiting for admin approval.', 'فیصلہ اور اسٹاک کی درستگی ایڈمن کی منظوری کے منتظر ہیں۔');
    }, t(decision === 'accept' ? 'Stock issue accepted.' : 'Stock issue rejected.', decision === 'accept' ? 'اسٹاک کا مسئلہ قبول کیا گیا۔' : 'اسٹاک کا مسئلہ مسترد کیا گیا۔'));
  }
  async function previewReport() {
    setBusy(true); setError(''); setNotice('');
    try {
      const bounds = periodBounds(fromDate, toDate);
      setDraft(await portal<ReportDraft>(`/stock/reports/draft?from=${bounds.from}&to=${bounds.to}`)); setFlags({});
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(false); }
  }
  async function submitReport(event: FormEvent) {
    event.preventDefault(); if (!draft) return;
    await finish(async () => {
      const bounds = periodBounds(fromDate, toDate);
      const flagged = [...draft.confirmedRejections.map(row => ({ objectType: 'inspection', objectId: row.id })), ...draft.escalations.map(row => ({ objectType: 'inspection', objectId: row.id })), ...draft.adjustments.map(row => ({ objectType: 'adjustment', objectId: row.id }))]
        .flatMap(item => { const value = flags[keyOf(item.objectType, item.objectId)]; return value?.selected ? [{ ...item, note: value.note }] : []; });
      await portal('/stock/reports', { id: reportId, ...bounds, flagged, note: reportNote, ...stepIn });
      setDraft(null); setFlags({}); setReportNote(''); setReportId(crypto.randomUUID()); await loadReports();
    }, t('Report submitted and saved.', 'رپورٹ جمع اور محفوظ ہو گئی۔'));
  }

  const thresholdText = (amount: number, threshold: number | null) => threshold === null
    ? t(`${weight(amount)} kg · no approval threshold configured`, `${weight(amount)} کلوگرام · منظوری کی حد مقرر نہیں`)
    : t(`${weight(amount)} kg against ${weight(threshold)} kg · ${amount >= threshold ? 'admin approval required' : 'no admin approval'}`, `${weight(amount)} کلوگرام، حد ${weight(threshold)} کلوگرام · ${amount >= threshold ? 'ایڈمن کی منظوری درکار' : 'ایڈمن کی منظوری درکار نہیں'}`);
  const issueTab = tab === 'stock-issues';
  const draftCount = draft ? draft.confirmedRejections.length + draft.escalations.length + draft.adjustments.length : 0;

  const actions = <button className="button" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} aria-hidden="true" />{t('Refresh', 'تازہ کریں')}</button>;
  return <section className="live-panel" aria-label={t('Supervisor workspace', 'سپروائزر کا کام')}>
    <div className="live-panel-heading"><h2>{section === 'requests' ? t('Requests', 'درخواستیں') : t('Report to admin', 'ایڈمن کو رپورٹ')}</h2>{actions}</div>
    <InterventionField member={member} owners={['supervisor']} value={intervention} onChange={setIntervention} />
    {error && <p className="live-error" role="alert"><TriangleAlert size={18} aria-hidden="true" />{t(error)}</p>}
    {notice && <p className="live-success" role="status"><CheckCheck size={18} aria-hidden="true" />{notice}</p>}

    {section === 'requests' && <>
      <SectionTabs tabs={[{ id: 'queries', en: 'Stock queries', ur: 'اسٹاک کی درخواستیں' }, { id: 'stock-issues', en: 'Stock issues', ur: 'اسٹاک کے مسائل' }]} value={issueTab ? 'stock-issues' : 'queries'} onChange={value => { location.hash = `#/requests/${value}`; }} />
      {!issueTab && <section className="yf-section">
        <h3 className="live-subheading">{t('Stock queries from sales', 'سیلز کی اسٹاک درخواستیں')}</h3>
        {listStatus(queries.length, t('No stock queries have been raised.', 'اسٹاک کی کوئی درخواست موصول نہیں ہوئی۔'))}
        <div className="erp-records">{queries.map(query => <article className="erp-record" key={query.id} id={query.id}>
          <h3>{query.product_name}{query.quantity_milli !== null && ` · ${quantity(query.quantity_milli)} kg`}</h3><p>{query.question}</p><p>{query.asked_by_name} · <StatusTag status={query.status} /></p>
          {query.status === 'answered' ? <p>{t('Available', 'دستیاب')}: {weight(query.available_grams || 0)} kg{query.answer ? ` · ${query.answer}` : ''}</p> : <form onSubmit={event => void answer(query, event)} aria-label={t('Answer stock query', 'اسٹاک کی درخواست کا جواب')}>
            <Field>{t('Available (kg)', 'دستیاب مقدار (کلوگرام)')}<input value={queryDrafts[query.id]?.kg || ''} onChange={event => setQueryDrafts(old => ({ ...old, [query.id]: { ...(old[query.id] || { kg: '', answer: '' }), kg: event.target.value } }))} inputMode="decimal" placeholder="0.000" required /></Field>
            <Field>{t('Answer', 'جواب')}<textarea value={queryDrafts[query.id]?.answer || ''} onChange={event => setQueryDrafts(old => ({ ...old, [query.id]: { ...(old[query.id] || { kg: '', answer: '' }), answer: event.target.value } }))} rows={2} maxLength={1000} /></Field>
            <button className="button primary" disabled={busy}>{t('Save answer', 'جواب محفوظ کریں')}</button>
          </form>}
        </article>)}</div>
      </section>}
      {issueTab && <section className="yf-section">
        <h3 className="live-subheading">{t('Stock issues from dispatch', 'ڈسپیچ کے اسٹاک مسائل')}</h3>
        {thresholds && <p className="live-muted">{t('Gate previews use the threshold snapshots returned by the stock issue service.', 'منظوری کے جائزے اسٹاک مسئلے کی سروس سے موصول شدہ حدوں کے مطابق ہیں۔')}</p>}
        {listStatus(issues.length, t('No dispatch stock issues are waiting.', 'ڈسپیچ کا کوئی اسٹاک مسئلہ منتظر نہیں۔'))}
        <div className="erp-records">{issues.map(issue => {
          const values = issueDrafts[issue.id] || { correctionKg: '', reason: '' };
          const correction = tryKgToGrams(values.correctionKg, { signed: true }) || 0;
          return <article className="erp-record" key={issue.id} id={issue.id}>
            <h3>{issue.product_name} · {issue.lot_batch} · {t(issue.stage === 'raw' ? 'Raw' : 'Finished', issue.stage === 'raw' ? 'خام مال' : 'تیار مال')}</h3>
            <p>{t(...pair(kindWords, issue.kind))} · {issue.description}</p>
            <p>{t('Reported difference', 'درج شدہ فرق')}: {weight(issue.difference_grams)} kg · <StatusTag status={issue.status} /></p>
            {issue.decision_reason && <p>{t('Decision reason', 'فیصلے کی وجہ')}: {issue.decision_reason}</p>}
            {issue.status === 'open' && thresholds && <div className="live-muted" aria-label={t('Approval previews', 'منظوری کا پیش نظارہ')}>
              <p>{t('Dispatch issue gate', 'ڈسپیچ مسئلے کی حد')}: {thresholdText(issue.difference_grams, thresholds.dispatchStockIssueGrams)}</p>
              <p>{correction ? t('Inventory correction gate', 'انوینٹری کی درستگی کی حد') : t('Inventory correction gate: no stock change proposed', 'انوینٹری کی درستگی کی حد: اسٹاک میں تبدیلی تجویز نہیں کی گئی')}{correction ? `: ${thresholdText(Math.abs(correction), thresholds.inventoryAdjustmentGrams)}` : ''}</p>
            </div>}
            {issue.status === 'open' && <>
              <Field>{t('Correction (kg, optional)', 'درستگی (کلوگرام، اختیاری)')}<input value={values.correctionKg} onChange={event => setIssueDrafts(old => ({ ...old, [issue.id]: { ...values, correctionKg: event.target.value } }))} inputMode="decimal" placeholder="+0.000 / -0.000" /></Field>
              <Field>{t('Decision reason', 'فیصلے کی وجہ')}<textarea value={values.reason} onChange={event => setIssueDrafts(old => ({ ...old, [issue.id]: { ...values, reason: event.target.value } }))} rows={2} minLength={5} maxLength={1000} required /></Field>
              <div className="live-actions"><button className="button primary" disabled={busy || values.reason.trim().length < 5} onClick={() => void decideIssue(issue, 'accept')}><CheckCheck size={18} aria-hidden="true" />{t('Accept', 'قبول کریں')}</button><button className="button" disabled={busy || values.reason.trim().length < 5} onClick={() => void decideIssue(issue, 'reject')}>{t('Reject', 'مسترد کریں')}</button></div>
            </>}
          </article>;
        })}</div>
      </section>}
    </>}

    {section === 'report' && <>
      <p className="live-muted">{t('Choose a factory date period, preview its evidence, flag items that need attention, then submit an immutable snapshot.', 'فیکٹری کی تاریخیں منتخب کریں، شواہد دیکھیں، ضروری آئٹمز نشان زد کریں اور محفوظ رپورٹ جمع کریں۔')}</p>
      <div className="live-fields"><Field>{t('From (factory date)', 'سے (فیکٹری تاریخ)')}<input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} required /></Field><Field>{t('To (factory date)', 'تک (فیکٹری تاریخ)')}<input type="date" value={toDate} onChange={event => setToDate(event.target.value)} required /></Field></div>
      <button className="button" type="button" disabled={busy} onClick={() => void previewReport()}>{t('Preview period', 'مدت کا جائزہ')}</button>
      {draft && <form onSubmit={event => void submitReport(event)} aria-label={t('Report snapshot', 'رپورٹ کا خلاصہ')}>
        <h3 className="live-subheading">{t('Confirmed rejections', 'تصدیق شدہ مسترد مقداریں')} · {draft.confirmedRejections.length}</h3>
        {draft.confirmedRejections.map(item => <ReportItem key={item.id} type="inspection" item={item} flag={flags[keyOf('inspection', item.id)]} setFlag={value => setFlags(old => ({ ...old, [keyOf('inspection', item.id)]: value }))} />)}
        <h3 className="live-subheading">{t('Escalations', 'ایڈمن کو بھیجی گئی')} · {draft.escalations.length}</h3>
        {draft.escalations.map(item => <ReportItem key={item.id} type="inspection" item={item} flag={flags[keyOf('inspection', item.id)]} setFlag={value => setFlags(old => ({ ...old, [keyOf('inspection', item.id)]: value }))} />)}
        <h3 className="live-subheading">{t('Inventory adjustments', 'انوینٹری کی درستگیاں')} · {draft.adjustments.length}</h3>
        {draft.adjustments.map(item => <ReportItem key={item.id} type="adjustment" item={item} flag={flags[keyOf('adjustment', item.id)]} setFlag={value => setFlags(old => ({ ...old, [keyOf('adjustment', item.id)]: value }))} />)}
        {!draftCount && <p className="live-muted">{t('There are no report items in this period.', 'اس مدت میں رپورٹ کے لیے کوئی آئٹم نہیں۔')}</p>}
        <Field>{t('Note to admin (optional)', 'ایڈمن کے لیے نوٹ (اختیاری)')}<textarea value={reportNote} onChange={event => setReportNote(event.target.value)} rows={3} maxLength={1000} /></Field>
        <button className="button primary" disabled={busy}><CheckCheck size={18} aria-hidden="true" />{t('Submit report', 'رپورٹ جمع کریں')}</button>
      </form>}
      <section className="yf-section">
        <h3 className="live-subheading">{t('Saved reports', 'محفوظ رپورٹس')}</h3>
        {listStatus(savedReports.length, t('No reports have been submitted.', 'ابھی کوئی رپورٹ جمع نہیں ہوئی۔'))}
        <div className="erp-records">{savedReports.map(report => <SavedReportView key={report.id} report={report} />)}</div>
      </section>
    </>}
  </section>;
}

function ReportItem({ type, item, flag, setFlag }: { type: 'inspection' | 'adjustment'; item: QcItem | Adjustment; flag?: { selected: boolean; note: string }; setFlag: (value: { selected: boolean; note: string }) => void }) {
  const { t } = useLanguage(); const chosen = flag || { selected: false, note: '' };
  const flagControls = <>
    <label className="live-check"><input type="checkbox" checked={chosen.selected} onChange={event => setFlag({ ...chosen, selected: event.target.checked })} />{t('Flag for admin', 'ایڈمن کے لیے نشان زد کریں')}</label>
    {chosen.selected && <Field>{t('Flag note', 'نشان کی وجہ')}<textarea value={chosen.note} onChange={event => setFlag({ ...chosen, note: event.target.value })} minLength={3} maxLength={500} required /></Field>}
  </>;
  if (type === 'inspection') {
    const qc = item as QcItem;
    return <article className="erp-record"><h4>{qc.product_name} · {qc.lot_reference} · {t('Rejected', 'مسترد')}: {quantity(qc.rejected_milli)} {qc.unit}</h4>
      {qc.rejection_reason && <p>{t('Decision reason', 'فیصلے کی وجہ')}: {qc.rejection_reason}</p>}
      {qc.issues.map((issue, i) => <p key={`${issue.type}-${i}`}><strong>{issue.type} · {t(issue.severity, severityUr[issue.severity] || issue.severity)}</strong> {issue.description}</p>)}
      {qc.photos.map(photo => { const id = typeof photo === 'string' ? photo : photo.id; return <a key={id} href={`/api/erp/qc/photos/${id}`} target="_blank" rel="noreferrer"><img src={`/api/erp/qc/photos/${id}`} alt={t('Inspection photo evidence', 'معائنے کی تصویری شہادت')} width={120} height={120} loading="lazy" /></a>; })}
      {flagControls}
    </article>;
  }
  const adjustment = item as Adjustment;
  return <article className="erp-record"><h4>{adjustment.product_name} · {adjustment.batch}</h4><p>{t(...pair(kindWords, adjustment.kind))} · {t(stageName[adjustment.stage as 'raw'] || adjustment.stage, stageUr[adjustment.stage] || adjustment.stage)} · {adjustment.delta_grams < 0 ? '−' : '+'}{weight(Math.abs(adjustment.delta_grams))} kg · <StatusTag status={adjustment.status} /></p><p>{adjustment.reason}</p>
    {flagControls}
  </article>;
}

function SavedReportView({ report }: { report: SavedReport }) {
  const { t } = useLanguage();
  const content = report.content;
  return <article className="erp-record" id={report.id}><h3>{report.created_by_name} · {t('Submitted', 'جمع شدہ')} {dateTime(report.created_at)}</h3>
    <p>{t('Period', 'مدت')}: {dateOnly(report.period_from)} – {dateOnly(report.period_to)}</p>
    {report.note && <p>{report.note}</p>}
    <p>{t('Snapshot', 'خلاصہ')}: {content.confirmedRejections.length} {t('confirmed rejections', 'تصدیق شدہ مسترد مقداریں')} · {content.escalations.length} {t('escalations', 'ایڈمن کو بھیجی گئی')} · {content.adjustments.length} {t('adjustments', 'درستگیاں')}</p>
    {report.flagged.map(item => <p key={`${item.objectType}:${item.objectId}`}><strong>{t('Flagged', 'نشان زد')}: </strong>{item.objectType === 'adjustment' ? t('Adjustment', 'درستگی') : t('Inspection', 'معائنہ')} · {item.objectId} · {item.note}</p>)}
  </article>;
}
