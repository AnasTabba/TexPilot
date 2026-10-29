import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCheck, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import './erp.css';
import { Field, errorMessage } from './forms';
import { InterventionField, NextStep, SectionTabs, StatusTag, portal } from './PortalCommon';
import { StockFlow } from './WorkspaceDashboard';
import { stageName, weight, type Member, type StockBalance, type WorkspaceState } from './inventory-client';
import { quantity } from './erp-client';
import { useLanguage } from './i18n';

type Section = 'dashboard' | 'inventory' | 'requests' | 'report' | 'history';
type StockLot = {
  id: string; batch: string; product_name: string; inventory_type: 'raw' | 'finished' | null;
  source: 'qc_lot' | 'production' | null; quality: string; raw_grams: number; cops_grams: number;
  wip_grams: number; finished_grams: number; legacyReadOnly: boolean;
};
type StockQuery = { id: string; product_name: string; quantity_milli: number | null; question: string; status: string; available_grams: number | null; answer: string | null; asked_by_name: string };
type StockIssue = { id: string; lot_id: string; lot_batch: string; product_name: string; stage: 'raw' | 'finished'; kind: string; difference_grams: number; description: string; status: string; decision_reason: string | null; created_at: number };
type Threshold = { dispatchStockIssueGrams: number | null; inventoryAdjustmentGrams: number | null };
type QcItem = { id: string; lot_reference: string; product_name: string; rejected_milli: number; unit: string; rejection_reason: string | null; issues: { type: string; severity: string; description: string }[]; photos: (string | { id: string; taken_at: number })[] };
type Adjustment = { id: string; batch: string; product_name: string; stage: string; kind: string; delta_grams: number; reason: string; status: string; created_at: number };
type ReportDraft = { confirmedRejections: QcItem[]; escalations: QcItem[]; adjustments: Adjustment[] };
type SavedReport = { id: string; period_from: number; period_to: number; content: ReportDraft; flagged: { objectType: string; objectId: string; note: string }[]; note: string; created_by_name: string; created_at: number };
type HistoryRow = { id: string; action: string; record_id: string; object_type: string | null; reason: string | null; created_at: number };
type Gate = { amount: number; threshold: number | null; required: boolean };

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
const periodBounds = (from: string, to: string) => {
  const start = Date.parse(`${from}T00:00:00+05:00`), end = Date.parse(`${to}T00:00:00+05:00`) + 86400000 - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Choose a valid report period.');
  return { from: start, to: end };
};
const balanceRows = (lot: StockLot): StockBalance[] => [
  { lot_id: lot.id, stage: 'raw', grams: lot.raw_grams, cartons: 0, cones: 0 },
  { lot_id: lot.id, stage: 'cops', grams: lot.cops_grams, cartons: 0, cones: 0 },
  { lot_id: lot.id, stage: 'wip', grams: lot.wip_grams, cartons: 0, cones: 0 },
  { lot_id: lot.id, stage: 'finished', grams: lot.finished_grams, cartons: 0, cones: 0 },
];
const stageUr: Record<string, string> = { raw: 'خام مال', cops: 'کاپس', wip: 'زیرِ تیاری', finished: 'تیار مال' };
const kindWords: Record<string, [string, string]> = { write_off: ['Write-off', 'ضائع'], adjustment: ['Correction', 'درستگی'], shortage: ['Shortage', 'کمی'], mismatch: ['Mismatch', 'عدم مطابقت'] };
const severityUr: Record<string, string> = { minor: 'معمولی', major: 'بڑا', critical: 'سنگین' };
const actionWords: Record<string, [string, string]> = {
  'inspection_report.accepted': ['Inspection report accepted', 'معائنہ رپورٹ قبول'], 'inspection_report.rejected': ['Inspection report returned', 'معائنہ رپورٹ واپس'],
  'rejection.confirmed': ['Rejection confirmed', 'مسترد مقدار کی تصدیق'], 'rejection.dismissed': ['Rejection dismissed', 'مسترد مقدار خارج'], 'rejection.escalated': ['Rejection escalated to admin', 'مسترد مقدار ایڈمن کو بھیجی'],
  'inventory.received': ['Finished goods recorded', 'تیار مال درج'], 'inventory.adjusted': ['Stock adjusted', 'اسٹاک کی درستگی'], 'inventory.adjustment_requested': ['Stock adjustment sent for approval', 'درستگی منظوری کے لیے بھیجی'],
  'stock_issue.accepted': ['Stock issue accepted', 'اسٹاک مسئلہ قبول'], 'stock_issue.rejected': ['Stock issue rejected', 'اسٹاک مسئلہ مسترد'],
  'stock_query.answered': ['Stock query answered', 'اسٹاک درخواست کا جواب'], 'stock_report.submitted': ['Report to admin submitted', 'ایڈمن کو رپورٹ جمع'],
};
const keyOf = (type: string, id: string) => `${type}:${id}`;
const errorText = (caught: unknown) => errorMessage(caught);

export function SupervisorScreens({ section, member, state, tab = '', itemId = '' }: { section: Section; member: Member; state: WorkspaceState; tab?: string; itemId?: string }) {
  const { t } = useLanguage();
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [intervention, setIntervention] = useState(''), [loaded, setLoaded] = useState(false);
  const stepIn = member.role === 'admin' ? { interventionReason: intervention } : {};
  const [stock, setStock] = useState<{ lots: StockLot[]; adjustmentThreshold: { value: number | null; unit: 'grams' } } | null>(null);
  const [queries, setQueries] = useState<StockQuery[]>([]), [issues, setIssues] = useState<StockIssue[]>([]), [thresholds, setThresholds] = useState<Threshold | null>(null);
  const [queryDrafts, setQueryDrafts] = useState<Record<string, { kg: string; answer: string }>>({});
  const [issueDrafts, setIssueDrafts] = useState<Record<string, { correctionKg: string; reason: string }>>({});
  const [productId, setProductId] = useState(state.products[0]?.id || ''), [batch, setBatch] = useState(''), [finishedKg, setFinishedKg] = useState(''), [cartons, setCartons] = useState('0'), [cones, setCones] = useState('0');
  const [selectedLot, setSelectedLot] = useState(''), [adjustStage, setAdjustStage] = useState<'raw' | 'finished'>('raw'), [adjustKind, setAdjustKind] = useState<'write_off' | 'adjustment'>('write_off'), [adjustDelta, setAdjustDelta] = useState(''), [adjustReason, setAdjustReason] = useState('');
  const [fromDate, setFromDate] = useState(() => { const now = dayInFactory(Date.now()); return `${now.slice(0, 7)}-01`; });
  const [toDate, setToDate] = useState(() => dayInFactory(Date.now()));
  const [draft, setDraft] = useState<ReportDraft | null>(null), [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [flags, setFlags] = useState<Record<string, { selected: boolean; note: string }>>({});
  const [reportNote, setReportNote] = useState(''), [reportId, setReportId] = useState(() => crypto.randomUUID());
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [nextItem, setNextItem] = useState<{ kind: 'report' | 'issue'; id: string; label: string; at: number } | null>(null);

  const loadStock = useCallback(async () => setStock(await portal<{ lots: StockLot[]; adjustmentThreshold: { value: number | null; unit: 'grams' } }>('/stock')), []);
  const loadRequests = useCallback(async () => {
    const [q, i] = await Promise.all([
      portal<{ queries: StockQuery[] }>('/stock/queries'),
      portal<{ issues: StockIssue[]; thresholds: Threshold }>('/dispatch/stock-issues'),
    ]);
    setQueries(q.queries); setIssues(i.issues); setThresholds(i.thresholds);
  }, []);
  const loadReports = useCallback(async () => setSavedReports((await portal<{ reports: SavedReport[] }>('/stock/reports')).reports), []);
  const loadHistory = useCallback(async () => setHistory((await portal<{ history: HistoryRow[] }>('/stock/history')).history), []);
  const loadDashboard = useCallback(async () => {
    const [reports, issuesResult] = await Promise.all([
      portal<{ reports: { id: string; lot_reference: string; product_name: string; submitted_at: number }[] }>('/qc/reports'),
      portal<{ issues: StockIssue[] }>('/dispatch/stock-issues?status=open'),
    ]);
    const candidates = [
      ...reports.reports.map(row => ({ kind: 'report' as const, id: row.id, label: `${row.product_name} · ${row.lot_reference}`, at: row.submitted_at })),
      ...issuesResult.issues.map(row => ({ kind: 'issue' as const, id: row.id, label: `${row.product_name} · ${row.lot_batch}`, at: row.created_at })),
    ].sort((a, b) => a.at - b.at);
    setNextItem(candidates[0] || null);
  }, []);

  useEffect(() => {
    setError(''); setNotice(''); setLoaded(false);
    const load = async () => {
      if (section === 'dashboard') await loadDashboard();
      else if (section === 'inventory') await loadStock();
      else if (section === 'requests') await loadRequests();
      else if (section === 'report') await loadReports();
      else await loadHistory();
    };
    void load().then(() => setLoaded(true)).catch(caught => { setError(errorText(caught)); setLoaded(true); });
  }, [section, loadDashboard, loadHistory, loadReports, loadRequests, loadStock]);
  useEffect(() => {
    if (!itemId) return;
    requestAnimationFrame(() => document.getElementById(itemId)?.scrollIntoView({ block: 'center' }));
  }, [itemId, queries, issues]);

  const refresh = async () => {
    setBusy(true); setError('');
    try {
      if (section === 'dashboard') await loadDashboard();
      else if (section === 'inventory') await loadStock();
      else if (section === 'requests') await loadRequests();
      else if (section === 'report') await loadReports();
      else await loadHistory();
      setLoaded(true);
    } catch (caught) { setError(errorText(caught)); setLoaded(true); } finally { setBusy(false); }
  };
  const finish = async (action: () => Promise<string | void>, message: string) => {
    setBusy(true); setError(''); setNotice('');
    try { setNotice((await action()) || message); }
    catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  };
  const navigate = (path: string) => { location.hash = `#/${path}`; };

  async function addFinished(event: FormEvent) {
    event.preventDefault();
    await finish(async () => {
      if (!/^\d+$/.test(cartons) || !/^\d+$/.test(cones)) throw new Error('Cartons and cones must be whole numbers.');
      await portal('/stock/finished', { id: crypto.randomUUID(), productId, batch, grams: kgToGrams(finishedKg), cartons: Number(cartons), cones: Number(cones), ...stepIn });
      setBatch(''); setFinishedKg(''); setCartons('0'); setCones('0'); await loadStock();
    }, t('Finished goods recorded.', 'تیار مال درج ہو گیا۔'));
  }
  async function adjust(event: FormEvent) {
    event.preventDefault();
    await finish(async () => {
      const grams = kgToGrams(adjustDelta), deltaGrams = adjustKind === 'write_off' ? -grams : grams;
      const saved = await portal<{ pendingApproval?: boolean }>('/stock/adjustments', { id: crypto.randomUUID(), lotId: selectedLot, stage: adjustStage, kind: adjustKind, deltaGrams, reason: adjustReason, ...stepIn });
      setAdjustDelta(''); setAdjustReason(''); await loadStock();
      return saved.pendingApproval ? t('Sent to the admin for approval. Stock has not changed.', 'ایڈمن کی منظوری کے لیے بھیج دیا۔ اسٹاک تبدیل نہیں ہوا۔') : undefined;
    }, t('Stock adjustment recorded.', 'اسٹاک کی درستگی درج ہو گئی۔'));
  }
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
      const correctionGrams = values.correctionKg.trim() ? kgToGrams(values.correctionKg, { signed: true }) : undefined;
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
    } catch (caught) { setError(errorText(caught)); }
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
  const queryTab = !issueTab;
  const adjustmentPreview = tryKgToGrams(adjustDelta);
  const visibleIssues = issues;
  const draftItems = draft ? [
    ...draft.confirmedRejections.map(row => ({ type: 'inspection', row, title: t('Confirmed rejection', 'تصدیق شدہ مسترد مقدار') })),
    ...draft.escalations.map(row => ({ type: 'inspection', row, title: t('Escalation', 'ایڈمن کو بھیجی گئی') })),
    ...draft.adjustments.map(row => ({ type: 'adjustment', row, title: t('Adjustment', 'اسٹاک کی درستگی') })),
  ] : [];

  const actions = <button className="button" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={18} aria-hidden="true" />{t('Refresh', 'تازہ کریں')}</button>;
  return <section className="live-panel" aria-label={t('Supervisor workspace', 'سپروائزر کا کام')}>
    <div className="live-panel-heading"><h2>{t(section === 'dashboard' ? 'Supervisor overview' : section === 'inventory' ? 'Inventory register' : section === 'requests' ? 'Requests' : section === 'report' ? 'Report to admin' : 'Your decisions', section === 'dashboard' ? 'سپروائزر کا جائزہ' : section === 'inventory' ? 'انوینٹری رجسٹر' : section === 'requests' ? 'درخواستیں' : section === 'report' ? 'ایڈمن کو رپورٹ' : 'آپ کے فیصلے')}</h2>{actions}</div>
    {section !== 'dashboard' && section !== 'history' && <InterventionField member={member} owners={['supervisor']} value={intervention} onChange={setIntervention} />}
    {error && <p className="live-error" role="alert"><TriangleAlert size={18} aria-hidden="true" />{t(error)}</p>}
    {notice && <p className="live-success" role="status"><CheckCheck size={18} aria-hidden="true" />{notice}</p>}

    {section === 'dashboard' && <>
      {nextItem ? <NextStep tone="warn" title={t(nextItem.kind === 'report' ? 'Next: Review an inspector report' : 'Next: Decide a stock issue', nextItem.kind === 'report' ? 'اگلا کام: انسپکٹر کی رپورٹ کا جائزہ لیں' : 'اگلا کام: اسٹاک کے مسئلے کا فیصلہ کریں')} reason={nextItem.label} action={<button className="button primary" onClick={() => navigate(nextItem.kind === 'report' ? `reviews/reports/${nextItem.id}` : `requests/stock-issues/${nextItem.id}`)}>{t('Open', 'کھولیں')}</button>} />
        : <NextStep tone="ok" title={t('Nothing is waiting for your decision', 'آپ کے فیصلے کا کوئی کام منتظر نہیں')} reason={t('New reports and stock issues will appear here.', 'نئی رپورٹس اور اسٹاک کے مسائل یہاں نظر آئیں گے۔')} />}
      <section className="yf-section"><h3 className="live-subheading">{t('Stock by stage', 'ہر مرحلے کا اسٹاک')}</h3><StockFlow balances={state.balances} /></section>
    </>}

    {section === 'inventory' && <>
      <p className="live-muted">{stock?.adjustmentThreshold.value === null ? t('Large changes require admin approval only when a threshold is configured.', 'بڑی تبدیلیاں صرف مقررہ حد پر ایڈمن کی منظوری مانگتی ہیں۔') : stock ? t(`Adjustment approval threshold: ${weight(stock.adjustmentThreshold.value)} kg.`, `درستگی کی منظوری کی حد: ${weight(stock.adjustmentThreshold.value)} کلوگرام۔`) : t('Loading inventory and approval threshold…', 'انوینٹری اور منظوری کی حد لوڈ ہو رہی ہے…')}</p>
      <div className="erp-records">{stock?.lots.map(lot => <article className="erp-record" key={lot.id} id={lot.id}>
        <h3>{lot.product_name} · {lot.batch}</h3><p>{t('Type', 'قسم')}: {lot.inventory_type || t('Legacy / untyped', 'پرانا / غیر متعین')} · {t('Source', 'ذریعہ')}: {lot.source || t('Legacy record', 'پرانا ریکارڈ')} · {lot.legacyReadOnly && <strong>{t('Legacy cops/WIP is read-only', 'پرانا کاپس/زیرِ تیاری اسٹاک صرف مطالعے کے لیے ہے')}</strong>}</p>
        <StockFlow balances={balanceRows(lot)} compact />
      </article>)}</div>
      {stock && !stock.lots.length && <p className="live-muted">{t('No inventory lots are recorded.', 'کوئی انوینٹری لاٹ درج نہیں۔')}</p>}
      <section className="yf-section"><h3 className="live-subheading">{t('Add finished goods', 'تیار مال شامل کریں')}</h3>
        <form onSubmit={event => void addFinished(event)} aria-label={t('Add finished goods', 'تیار مال شامل کریں')}>
          <Field>{t('Material', 'دھاگہ')}<select value={productId} onChange={event => setProductId(event.target.value)} required><option value="">{t('Choose material', 'دھاگہ منتخب کریں')}</option>{state.products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></Field>
          <Field>{t('Batch / dye lot', 'بیچ / رنگائی لاٹ')}<input value={batch} onChange={event => setBatch(event.target.value)} maxLength={100} required /></Field>
          <div className="live-fields"><Field>{t('Weight (kg)', 'وزن (کلوگرام)')}<input value={finishedKg} onChange={event => setFinishedKg(event.target.value)} inputMode="decimal" placeholder="0.000" required /></Field><Field>{t('Cartons', 'کارٹن')}<input value={cartons} onChange={event => setCartons(event.target.value)} inputMode="numeric" required /></Field><Field>{t('Cones', 'کون')}<input value={cones} onChange={event => setCones(event.target.value)} inputMode="numeric" required /></Field></div>
          <p className="live-muted">{t('Raw material enters inventory only when an inspection report is accepted.', 'خام مال صرف معائنہ رپورٹ قبول ہونے کے بعد انوینٹری میں آتا ہے۔')}</p>
          <button className="button primary" disabled={busy || !state.products.length}><Plus size={18} aria-hidden="true" />{t('Save finished goods', 'تیار مال محفوظ کریں')}</button>
        </form>
      </section>
      <section className="yf-section"><h3 className="live-subheading">{t('Adjust stock or write it off', 'اسٹاک درست یا ضائع درج کریں')}</h3>
        <form onSubmit={event => void adjust(event)} aria-label={t('Adjust stock', 'اسٹاک کی درستگی')}>
          <Field>{t('Batch', 'بیچ')}<select value={selectedLot} onChange={event => { setSelectedLot(event.target.value); const found = stock?.lots.find(lot => lot.id === event.target.value); if (found?.inventory_type === 'finished') setAdjustStage('finished'); else setAdjustStage('raw'); }} required><option value="">{t('Choose a batch', 'بیچ منتخب کریں')}</option>{stock?.lots.filter(lot => lot.inventory_type === null || ['raw', 'finished'].includes(lot.inventory_type)).map(lot => <option key={lot.id} value={lot.id}>{lot.batch} · {lot.product_name}</option>)}</select></Field>
          <Field>{t('Stage', 'مرحلہ')}<select value={adjustStage} onChange={event => setAdjustStage(event.target.value as 'raw' | 'finished')}><option value="raw">{t(stageName.raw, 'خام مال')}</option><option value="finished">{t(stageName.finished, 'تیار مال')}</option></select></Field>
          <Field>{t('Change', 'تبدیلی')}<select value={adjustKind} onChange={event => setAdjustKind(event.target.value as 'write_off' | 'adjustment')}><option value="write_off">{t('Write off stock', 'اسٹاک ضائع درج کریں')}</option><option value="adjustment">{t('Correction: add stock', 'درستگی: اسٹاک بڑھائیں')}</option></select></Field>
          <Field>{t('Weight (kg)', 'وزن (کلوگرام)')}<input value={adjustDelta} onChange={event => setAdjustDelta(event.target.value)} inputMode="decimal" placeholder="0.000" required /></Field>
          <Field>{t('Reason', 'وجہ')}<textarea value={adjustReason} onChange={event => setAdjustReason(event.target.value)} rows={3} minLength={5} maxLength={1000} required /></Field>
          {adjustmentPreview !== null && stock && <p className="live-muted" role="status">{t('Approval preview', 'منظوری کا پیش نظارہ')}: {thresholdText(adjustmentPreview, stock.adjustmentThreshold.value)}</p>}
          <button className="button primary" disabled={busy || !selectedLot}>{t('Save adjustment', 'درستگی محفوظ کریں')}</button>
        </form>
      </section>
    </>}

    {section === 'requests' && <>
      <SectionTabs tabs={[{ id: 'queries', en: 'Stock queries', ur: 'اسٹاک کی درخواستیں' }, { id: 'stock-issues', en: 'Stock issues', ur: 'اسٹاک کے مسائل' }]} value={issueTab ? 'stock-issues' : 'queries'} onChange={value => { location.hash = `#/requests/${value}`; }} />
      {queryTab && <>
        <h3 className="live-subheading">{t('Stock queries from sales', 'سیلز کی اسٹاک درخواستیں')}</h3>
        {!loaded && !error && <p role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>}
        {loaded && !error && !queries.length && <p className="live-muted">{t('No stock queries have been raised.', 'اسٹاک کی کوئی درخواست موصول نہیں ہوئی۔')}</p>}
        <div className="erp-records">{queries.map(query => <article className="erp-record" key={query.id} id={query.id}>
          <h3>{query.product_name}{query.quantity_milli !== null && ` · ${quantity(query.quantity_milli)} kg`}</h3><p>{query.question}</p><p>{query.asked_by_name} · <StatusTag status={query.status} /></p>
          {query.status === 'answered' ? <p>{t('Available', 'دستیاب')}: {weight(query.available_grams || 0)} kg{query.answer ? ` · ${query.answer}` : ''}</p> : <form onSubmit={event => void answer(query, event)}>
            <Field>{t('Available (kg)', 'دستیاب مقدار (کلوگرام)')}<input value={queryDrafts[query.id]?.kg || ''} onChange={event => setQueryDrafts(old => ({ ...old, [query.id]: { ...(old[query.id] || { kg: '', answer: '' }), kg: event.target.value } }))} inputMode="decimal" placeholder="0.000" required /></Field>
            <Field>{t('Answer', 'جواب')}<textarea value={queryDrafts[query.id]?.answer || ''} onChange={event => setQueryDrafts(old => ({ ...old, [query.id]: { ...(old[query.id] || { kg: '', answer: '' }), answer: event.target.value } }))} rows={2} maxLength={1000} /></Field>
            <button className="button primary" disabled={busy}>{t('Save answer', 'جواب محفوظ کریں')}</button>
          </form>}
        </article>)}</div>
      </>}
      {issueTab && <>
        <h3 className="live-subheading">{t('Stock issues from dispatch', 'ڈسپیچ کے اسٹاک مسائل')}</h3>
        {thresholds && <p className="live-muted">{t('Gate previews use the threshold snapshots returned by the stock issue service.', 'منظوری کے جائزے اسٹاک مسئلے کی سروس سے موصول شدہ حدوں کے مطابق ہیں۔')}</p>}
        {!loaded && !error && <p role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>}
        {loaded && !error && !visibleIssues.length && <p className="live-muted">{t('No dispatch stock issues are waiting.', 'ڈسپیچ کا کوئی اسٹاک مسئلہ منتظر نہیں۔')}</p>}
        <div className="erp-records">{visibleIssues.map(issue => {
          const values = issueDrafts[issue.id] || { correctionKg: '', reason: '' };
          const correction = tryKgToGrams(values.correctionKg, { signed: true }) || 0;
          return <article className="erp-record" key={issue.id} id={issue.id}>
            <h3>{issue.product_name} · {issue.lot_batch} · {t(issue.stage === 'raw' ? 'Raw' : 'Finished', issue.stage === 'raw' ? 'خام مال' : 'تیار مال')}</h3>
            <p>{t(...(kindWords[issue.kind] || [issue.kind, issue.kind]))} · {issue.description}</p>
            <p>{t('Reported difference', 'درج شدہ فرق')}: {weight(issue.difference_grams)} kg · <StatusTag status={issue.status} /></p>
            {issue.decision_reason && <p>{t('Decision reason', 'فیصلے کی وجہ')}: {issue.decision_reason}</p>}
            {issue.status === 'open' && thresholds && <div className="live-muted" aria-label={t('Approval previews', 'منظوری کا پیش نظارہ')}>
              <p>{t('Dispatch issue gate', 'ڈسپیچ مسئلے کی حد')}: {thresholdText(issue.difference_grams, thresholds.dispatchStockIssueGrams)}</p>
              <p>{correction ? t('Inventory correction gate', 'انوینٹری کی درستگی کی حد') : t('Inventory correction gate: no stock change proposed', 'انوینٹری کی درستگی کی حد: اسٹاک میں تبدیلی تجویز نہیں کی گئی')}{correction ? `: ${thresholdText(Math.abs(correction), thresholds.inventoryAdjustmentGrams)}` : ''}</p>
            </div>}
            {issue.status === 'open' && <>
              <Field>{t('Correction (kg, optional)', 'درستگی (کلوگرام، اختیاری)')}<input value={values.correctionKg} onChange={event => setIssueDrafts(old => ({ ...old, [issue.id]: { ...values, correctionKg: event.target.value } }))} inputMode="decimal" placeholder="+0.000 / -0.000" /></Field>
              <Field>{t('Decision reason', 'فیصلے کی وجہ')}<textarea value={values.reason} onChange={event => setIssueDrafts(old => ({ ...old, [issue.id]: { ...values, reason: event.target.value } }))} rows={2} minLength={5} maxLength={1000} required /></Field>
              <div className="live-actions"><button className="button primary" disabled={busy || values.reason.trim().length < 5} onClick={() => void decideIssue(issue, 'accept')}>{t('Accept', 'قبول کریں')}</button><button className="button" disabled={busy || values.reason.trim().length < 5} onClick={() => void decideIssue(issue, 'reject')}>{t('Reject', 'مسترد کریں')}</button></div>
            </>}
          </article>;
        })}</div>
      </>}
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
        {!draftItems.length && <p className="live-muted">{t('There are no report items in this period.', 'اس مدت میں رپورٹ کے لیے کوئی آئٹم نہیں۔')}</p>}
        <Field>{t('Note to admin (optional)', 'ایڈمن کے لیے نوٹ (اختیاری)')}<textarea value={reportNote} onChange={event => setReportNote(event.target.value)} rows={3} maxLength={1000} /></Field>
        <button className="button primary" disabled={busy}>{t('Submit report', 'رپورٹ جمع کریں')}</button>
      </form>}
      <h3 className="live-subheading">{t('Saved reports', 'محفوظ رپورٹس')}</h3>
      {loaded && !error && !savedReports.length && <p className="live-muted">{t('No reports have been submitted.', 'ابھی کوئی رپورٹ جمع نہیں ہوئی۔')}</p>}
      <div className="erp-records">{savedReports.map(report => <SavedReportView key={report.id} report={report} />)}</div>
    </>}

    {section === 'history' && <>
      <p className="live-muted">{t('Only decisions recorded by your supervisor account appear here.', 'یہاں صرف آپ کے سپروائزر اکاؤنٹ کے فیصلے دکھائے جاتے ہیں۔')}</p>
      {!loaded && !error && <p role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>}
      {loaded && !error && !history.length && <p className="live-muted">{t('No decisions recorded yet.', 'ابھی کوئی فیصلہ درج نہیں ہوا۔')}</p>}
      <ol className="yf-timeline">{history.map(row => <li key={row.id}><div><strong>{actionWords[row.action] ? t(...actionWords[row.action]) : row.action.replaceAll('_', ' ').replaceAll('.', ' · ')}</strong><span>{row.object_type || t('Record', 'ریکارڈ')} · {row.record_id}</span>{row.reason && <span>{t('Reason', 'وجہ')}: {row.reason}</span>}</div><time>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(row.created_at)}</time></li>)}</ol>
    </>}
  </section>;
}

function ReportItem({ type, item, flag, setFlag }: { type: 'inspection' | 'adjustment'; item: QcItem | Adjustment; flag?: { selected: boolean; note: string }; setFlag: (value: { selected: boolean; note: string }) => void }) {
  const { t } = useLanguage(); const chosen = flag || { selected: false, note: '' };
  if (type === 'inspection') {
    const qc = item as QcItem;
    return <article className="erp-record"><h4>{qc.product_name} · {qc.lot_reference} · {t('Rejected', 'مسترد')}: {quantity(qc.rejected_milli)} {qc.unit}</h4>
      {qc.rejection_reason && <p>{t('Decision reason', 'فیصلے کی وجہ')}: {qc.rejection_reason}</p>}
      {qc.issues.map((issue, i) => <p key={`${issue.type}-${i}`}><strong>{issue.type} · {t(issue.severity, severityUr[issue.severity] || issue.severity)}</strong> {issue.description}</p>)}
      {qc.photos.map(photo => { const id = typeof photo === 'string' ? photo : photo.id; return <a key={id} href={`/api/erp/qc/photos/${id}`} target="_blank" rel="noreferrer"><img src={`/api/erp/qc/photos/${id}`} alt={t('Inspection photo evidence', 'معائنے کی تصویری شہادت')} width={120} height={120} loading="lazy" /></a>; })}
      <label className="live-check"><input type="checkbox" checked={chosen.selected} onChange={event => setFlag({ ...chosen, selected: event.target.checked })} />{t('Flag for admin', 'ایڈمن کے لیے نشان زد کریں')}</label>
      {chosen.selected && <Field>{t('Flag note', 'نشان کی وجہ')}<textarea value={chosen.note} onChange={event => setFlag({ ...chosen, note: event.target.value })} minLength={3} maxLength={500} required /></Field>}
    </article>;
  }
  const adjustment = item as Adjustment;
  return <article className="erp-record"><h4>{adjustment.product_name} · {adjustment.batch}</h4><p>{t(...(kindWords[adjustment.kind] || [adjustment.kind, adjustment.kind]))} · {t(stageName[adjustment.stage as 'raw'] || adjustment.stage, stageUr[adjustment.stage] || adjustment.stage)} · {adjustment.delta_grams < 0 ? '−' : '+'}{weight(Math.abs(adjustment.delta_grams))} kg · <StatusTag status={adjustment.status} /></p><p>{adjustment.reason}</p>
    <label className="live-check"><input type="checkbox" checked={chosen.selected} onChange={event => setFlag({ ...chosen, selected: event.target.checked })} />{t('Flag for admin', 'ایڈمن کے لیے نشان زد کریں')}</label>
    {chosen.selected && <Field>{t('Flag note', 'نشان کی وجہ')}<textarea value={chosen.note} onChange={event => setFlag({ ...chosen, note: event.target.value })} minLength={3} maxLength={500} required /></Field>}
  </article>;
}

function SavedReportView({ report }: { report: SavedReport }) {
  const { t } = useLanguage();
  const content = report.content;
  return <article className="erp-record" id={report.id}><h3>{report.created_by_name} · {t('Submitted', 'جمع شدہ')} {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(report.created_at)}</h3>
    <p>{t('Period', 'مدت')}: {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium' }).format(report.period_from)} – {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium' }).format(report.period_to)}</p>
    {report.note && <p>{report.note}</p>}
    <p>{t('Snapshot', 'خلاصہ')}: {content.confirmedRejections.length} {t('confirmed rejections', 'تصدیق شدہ مسترد مقداریں')} · {content.escalations.length} {t('escalations', 'ایڈمن کو بھیجی گئی')} · {content.adjustments.length} {t('adjustments', 'درستگیاں')}</p>
    {report.flagged.map(item => <p key={`${item.objectType}:${item.objectId}`}><strong>{t('Flagged', 'نشان زد')}: </strong>{item.objectType === 'adjustment' ? t('Adjustment', 'درستگی') : t('Inspection', 'معائنہ')} · {item.objectId} · {item.note}</p>)}
  </article>;
}
