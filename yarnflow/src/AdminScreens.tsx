import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, ClipboardCheck, FileText, History, RotateCw, Save, X } from 'lucide-react';
import { AnalyticsSection, BarList, KpiStrip, StackedBar, firstCurrency, type BarRow, type Kpi, type Segment, type Tone } from './AnalyticsKit';
import { Field, errorMessage } from './forms';
import { useLanguage, type Language } from './i18n';
import { inventoryRequest as api, roleLabel, type Member, type Role, type WorkspaceState } from './inventory-client';
import { InterventionField, NextStep, ReasonField, SectionTabs, StatusTag, kg, money, portal } from './PortalCommon';
import { Correction } from './CorrectionForm';
import { when } from './WorkspaceDashboard';
import { ActionBar, EmptyState, KeyFacts, RowCard, Sheet, Step, Steps, Tabs } from './ui';
import './admin-screens.css';
import './approvals-ui.css';
import './sales-screens.css';

type Props = { member: Member; section: string; tab: string; id: string; navigate: (to: string, id?: string) => void; state?: WorkspaceState; onInventoryChanged?: () => Promise<void> };
type Navigate = Props['navigate'];
type Settings = { currency: string; tax_rate_bp: number; invoice_format: string; reminder_hours: number; credit_alert_days: number[] };
type Threshold = { type: string; value: number; currency: string | null; updated_by_name: string; updated_at: number };
type ThresholdHistory = { type: string; old_value: number | null; new_value: number; old_currency: string | null; new_currency: string | null; changed_by_name: string; changed_at: number };

/** Sections this screen serves. User management lives in Team; role modules are not ported. */
export const ADMIN_SECTIONS = ['approvals', 'thresholds', 'claims', 'admin-activity', 'reports', 'analytics', 'settings'];

const types = ['purchase', 'inventory_adjustment', 'claim', 'dispatch_stock_issue'];
const thresholdName: Record<string, [string, string]> = { purchase: ['Purchase threshold', 'خریداری کی حد'], inventory_adjustment: ['Inventory adjustment', 'اسٹاک کی تبدیلی'], claim: ['Claim threshold', 'دعوے کی حد'], dispatch_stock_issue: ['Dispatch stock issue', 'ڈسپیچ اسٹاک مسئلہ'] };
// Money thresholds are stored in minor units, stock thresholds in grams.
const isAmount = (type: string) => ['purchase', 'claim'].includes(type);
const scaleOf = (type: string) => (isAmount(type) ? 100 : 1000);
const groups = [{ id: 'purchase', en: 'Purchase awards', ur: 'خریداری ایوارڈ', types: ['purchase_award', 'po_change'] }, { id: 'inventory', en: 'Inventory adjustments', ur: 'اسٹاک کی تبدیلی', types: ['inventory_adjustment'] }, { id: 'claims', en: 'Claims', ur: 'دعوے', types: ['claim'] }, { id: 'dispatch', en: 'Dispatch issues', ur: 'ڈسپیچ مسائل', types: ['dispatch_stock_issue'] }, { id: 'escalation', en: 'Escalations', ur: 'اضافہ شدہ معاملات', types: ['escalation'] }];
const words: Record<string, [string, string]> = { purchase_award: ['Purchase award', 'خریداری ایوارڈ'], po_change: ['PO change', 'پی او تبدیلی'], inventory_adjustment: ['Inventory adjustment', 'اسٹاک کی تبدیلی'], claim: ['Claim', 'دعویٰ'], dispatch_stock_issue: ['Dispatch stock issue', 'ڈسپیچ اسٹاک مسئلہ'], escalation: ['Escalation', 'اضافہ شدہ معاملہ'] };
const named = (type: string): [string, string] => words[type] || [type, type];
const outcomes: [string, string, string][] = [['return', 'Return', 'واپسی'], ['replacement', 'Replacement', 'تبدیلی'], ['claim', 'Claim', 'دعویٰ']];
const auditRoutes: Record<string, string> = { approval: 'approvals', claim: 'claims', supervisor_report: 'reports', user: 'team', threshold: 'thresholds', setting: 'settings' };
const auditRoute = (event: any): [string, string | undefined] => [auditRoutes[event.object_type] || 'notifications', event.record_id || undefined];
const amountOf = (row: any, value: number, currency: string) => (row.unit === 'minor' ? money(value, row.currency || currency) : kg(value));
const dateOnly = (value: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium' }).format(value);
const factRows = (value: unknown): [string, unknown][] =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];

type Filter = { objectType: string; action: string; actor: string; from: string; to: string };
function auditQuery(filter: Filter, before?: string) {
  const query = new URLSearchParams();
  if (filter.objectType) query.set('objectType', filter.objectType);
  if (filter.action) query.set('action', filter.action);
  if (filter.actor) query.set('actor', filter.actor);
  if (filter.from) query.set('from', String(new Date(filter.from).getTime()));
  if (filter.to) query.set('to', String(new Date(filter.to).getTime() + 86399999));
  if (before) query.set('before', before);
  return query.toString();
}

function useLoad<T>(path: string) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<T>(path).then(next => { if (active) { setValue(next); setError(''); } }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [path, revision]);
  return { value, error, reload: () => { setError(''); setRevision(x => x + 1); } };
}

function RetryError({ error, reload }: { error: string; reload: () => void }) {
  const { t } = useLanguage();
  return <p className="live-error" role="alert">{t(error)} <button className="live-text-button" onClick={reload}><RotateCw size={16} aria-hidden="true" />{t('Retry', 'دوبارہ کوشش کریں')}</button></p>;
}

/** Loading, error (with retry) and then the loaded content. */
function Loaded<T>({ res, children }: { res: { value: T | null; error: string; reload: () => void }; children: (value: T) => ReactNode }) {
  const { t } = useLanguage();
  if (res.error) return <RetryError error={res.error} reload={res.reload} />;
  if (res.value === null) return <p className="live-muted" role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>;
  return <>{children(res.value)}</>;
}

export default function AdminScreens({ member, section, tab, id, navigate }: Props) {
  const { t } = useLanguage();
  // Currency comes from settings; the screens that show money need it, the rest do not.
  const settings = useLoad<{ settings: Settings }>('/erp/admin/settings');
  const currency = settings.value?.settings.currency || 'PKR';
  if (!ADMIN_SECTIONS.includes(section)) return null;
  const activeTab = tab === 'audit' ? 'audit' : 'monitor';
  return <div className="yf-admin">
    {['approvals', 'claims', 'thresholds'].includes(section) && settings.error && <RetryError error={settings.error} reload={settings.reload} />}
    {section === 'approvals' && <Approvals member={member} currency={currency} />}
    {section === 'thresholds' && <section className="yf-factory-limits"><h2>{t('Factory default limits', 'فیکٹری کی بنیادی حدیں')}</h2><p className="live-muted">{t('Used for anyone who has no approval limit of their own. Set a supervisor’s own limits by opening them above.', 'ان سب کے لیے جن کی اپنی منظوری کی حد نہیں۔ کسی سپروائزر کی اپنی حدیں اوپر ان کو کھول کر مقرر کریں۔')}</p><Thresholds currency={currency} /></section>}
    {section === 'claims' && <Claims member={member} id={id} currency={currency} navigate={navigate} />}
    {section === 'admin-activity' && <>
      <SectionTabs tabs={[{ id: 'monitor', en: 'Monitor', ur: 'نگرانی' }, { id: 'audit', en: 'Audit log', ur: 'آڈٹ لاگ' }]} value={activeTab} onChange={v => navigate('admin-activity', v)} />
      {activeTab === 'monitor' ? <AuditMonitor navigate={navigate} /> : <AuditLog />}
    </>}
    {section === 'reports' && <Reports id={id} navigate={navigate} />}
    {section === 'analytics' && <Analytics />}
    {section === 'settings' && <InvoiceSettings settings={settings.value?.settings ?? null} loadError={settings.error} reload={settings.reload} />}
  </div>;
}

/** Approvals as a split view: groups filter the list, the chosen request sits beside it with one Approve action. */
function Approvals({ member, currency }: { member: Member; currency: string }) {
  const { t } = useLanguage();
  const list = useLoad<{ approvals: any[] }>('/erp/approvals');
  const [group, setGroup] = useState('all');
  return <Loaded res={list}>{data => {
    const rows = (data.approvals || []).filter((row: any) => row.status === 'pending');
    const tabs = [{ id: 'all', label: t('All', 'سب'), count: rows.length }, ...groups.map(g => ({ id: g.id, label: t(g.en, g.ur), count: rows.filter((row: any) => g.types.includes(row.type)).length }))];
    const visible = rows.filter((row: any) => group === 'all' || !!groups.find(g => g.id === group)?.types.includes(row.type));
    return <section className="yf-approval-queue"><Tabs items={tabs} value={group} onChange={setGroup} label={t('Request kind', 'درخواست کی قسم')} className="yf-kind-tabs" />
      {visible.length ? visible.map((row: any) => <ApprovalDetail key={row.id} member={member} row={row} currency={currency} reload={list.reload} />) : <EmptyState emptyIso="inbox" message={t('Nothing to approve', 'منظوری کے لیے کچھ نہیں')} action={<button className="button" type="button" onClick={list.reload}><RotateCw size={18} aria-hidden="true" />{t('Refresh', 'تازہ کریں')}</button>} />}
    </section>;
  }}</Loaded>;
}

function ApprovalDetail({ member, row, currency, reload }: { member: Member; row: any; currency: string; reload: () => void }) {
  const { t, language } = useLanguage();
  const detail = useLoad<any>(`/erp/approvals/${row.id}`);
  const [reason, setReason] = useState(''), [showReject, setShowReject] = useState(false), [intervention, setIntervention] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function decide(decision: 'approve' | 'reject') {
    setError(''); setBusy(true);
    try { await portal('/approvals/decide', { id: row.id, decision, ...(decision === 'reject' ? { reason } : {}), ...(member.role === 'admin' ? { interventionReason: intervention } : {}) }); reload(); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return <article className="yf-approval-card">
    <div className="yf-request-head"><span className="yf-icon-chip" aria-hidden="true"><ClipboardCheck /></span>
      <div className="yf-request-copy"><p className="yf-request-sentence">{row.requested_by_name} {t('asks to approve', 'منظوری کی درخواست کرتے ہیں')} {t(...named(row.type))} {t('for', 'کے لیے')} {amountOf(row, row.amount, currency)}.</p>
      <p className="yf-request-meta">{when.format(row.created_at, language)}</p></div></div>
    <Loaded res={detail}>{data => data.object ? <KeyFacts items={[
      { label: t('Item', 'آئٹم'), value: data.object.label },
      { label: t('Request limit', 'درخواست کی حد'), value: amountOf(row, row.threshold, currency) },
      ...factRows(data.object.evidence).map(([label, value]) => ({ label: label || t('Evidence', 'ثبوت'), value })),
      ...factRows(data.object.proposed).map(([label, value]) => ({ label: label || t('Proposed change', 'مجوزہ تبدیلی'), value })),
    ]} /> : <p className="live-empty">{t('Request details are unavailable.', 'درخواست کی تفصیل دستیاب نہیں۔')}</p>}</Loaded>
    <InterventionField member={member} owners={['purchase_manager', 'supervisor', 'dispatch']} value={intervention} onChange={setIntervention} />
    {showReject && <ReasonField label={t('Reason for rejection', 'مسترد کرنے کی وجہ')} value={reason} onChange={setReason} required />}
    <div className="yf-approval-buttons">
      <button className="button primary" disabled={busy} onClick={() => void decide('approve')}><Check size={20} aria-hidden="true" />{t('Approve', 'منظور کریں')}</button>
      {showReject ? <button className="button" disabled={busy || reason.trim().length < 5} onClick={() => void decide('reject')}><X size={20} aria-hidden="true" />{t('Confirm reject', 'مسترد کریں')}</button> : <button className="button" disabled={busy} onClick={() => setShowReject(true)}><X size={20} aria-hidden="true" />{t('Reject', 'مسترد کریں')}</button>}
    </div>
    {row.status === 'approved' && row.undo && <UndoApproval member={member} row={row} reload={reload} />}
    {error && <p role="alert" className="live-error">{t(error)}</p>}
  </article>;
}

/** Undo is offered only where the server can compensate (an award, undone by cancelling its order). Other decisions say they are final. */
function UndoApproval({ member, row, reload }: { member: Member; row: any; reload: () => void }) {
  const { t } = useLanguage();
  if (!row.undo.available) return <p className="live-muted" role="status">{row.undo.message}</p>;
  return <Correction member={member} label={t('Undo this approval', 'یہ منظوری واپس لیں')} title={t('Undo this approval', 'یہ منظوری واپس لیں')} effect={t('The purchase order this approval created is cancelled and the RFQ reopens for awarding. Only possible before dispatch, arrival or a bill of lading.', 'اس منظوری سے بنا خریداری آرڈر منسوخ ہوگا اور درخواست دوبارہ منظوری کے لیے کھل جائے گی۔ صرف روانگی، آمد یا بل آف لیڈنگ سے پہلے ممکن ہے۔')} submit={t('Undo approval', 'منظوری واپس لیں')} owners={['admin']} path="/erp/approvals/undo" requestField="requestId" payload={() => ({ id: row.id })} onSaved={async () => reload()} />;
}

export function Thresholds({ currency }: { currency: string }) {
  const { t, language } = useLanguage();
  const data = useLoad<{ thresholds: Threshold[]; history: ThresholdHistory[] }>('/erp/admin/thresholds');
  const [values, setValues] = useState<Record<string, string>>({}), [error, setError] = useState('');
  useEffect(() => {
    if (!data.value) return;
    const next: Record<string, string> = {};
    for (const type of types) { const row = (data.value.thresholds || []).find(x => x.type === type); next[type] = row ? String(row.value / scaleOf(type)) : ''; }
    setValues(next);
  }, [data.value]);
  async function save(type: string) {
    setError('');
    try {
      const parsed = Number(values[type]);
      if (!values[type]?.trim() || !Number.isFinite(parsed) || parsed < 0) throw new Error('Enter a valid non-negative threshold.');
      await portal('/admin/thresholds', { type, value: Math.round(parsed * scaleOf(type)) });
      data.reload();
    } catch (e) { setError(errorMessage(e)); }
  }
  return <div className="yf-admin-sections">
    <p className="live-muted">{t('Amounts are entered in the displayed currency; stock limits are entered in kg.', 'رقم دکھائی گئی کرنسی میں اور اسٹاک کی حد کلوگرام میں درج کریں۔')}</p>
    <Loaded res={data}>{loaded => <>{types.map(type => {
      const row = (loaded.thresholds || []).find(x => x.type === type);
      const history = (loaded.history || []).filter(h => h.type === type);
      const show = (value: number, cur: string | null) => (isAmount(type) ? money(value, cur || currency) : kg(value));
      return <section className="yf-section" key={type}>
        <h2>{t(...thresholdName[type])}</h2>
        <div className="live-actions">
          <Field>{isAmount(type) ? t('Amount', 'رقم') : t('Weight (kg)', 'وزن (کلوگرام)')}<input aria-label={t(...thresholdName[type])} inputMode="decimal" value={values[type] ?? ''} onChange={e => setValues(v => ({ ...v, [type]: e.target.value }))} placeholder={t('Not configured', 'ترتیب نہیں دی گئی')} /></Field>
          <button className="button primary" onClick={() => void save(type)}><Save size={18} aria-hidden="true" />{t('Save', 'محفوظ کریں')}</button>
        </div>
        {row ? <p className="live-muted">{t('Last changed by', 'آخری تبدیلی')}: {row.updated_by_name} · {when.format(row.updated_at, language)}</p> : <p className="live-muted">{t('Not set', 'مقرر نہیں')}</p>}
        <h3>{t('Change history', 'تبدیلی کی تاریخ')}</h3>
        {history.length ? <ul className="yf-facts">{history.map((h, i) => <li key={`${h.changed_at}-${i}`}><span>{h.changed_by_name} · {when.format(h.changed_at, language)}</span><strong>{h.old_value === null ? '—' : show(h.old_value, h.old_currency)} → {show(h.new_value, h.new_currency)}</strong></li>)}</ul>
          : <p className="live-empty">{t('No changes recorded yet.', 'ابھی کوئی تبدیلی درج نہیں ہوئی۔')}</p>}
      </section>;
    })}</>}</Loaded>
    {error && <p role="alert" className="live-error">{t(error)}</p>}
  </div>;
}

export function InvoiceSettings({ settings, loadError, reload }: { settings: Settings | null; loadError: string; reload: () => void }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<Settings | null>(null), [creditText, setCreditText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [step, setStep] = useState(1);
  useEffect(() => { if (settings) { setDraft({ ...settings }); setCreditText(settings.credit_alert_days.join(', ')); } }, [settings]);
  if (!draft) return loadError ? <RetryError error={loadError} reload={reload} /> : <p className="live-muted" role="status">{t('Loading settings…', 'ترتیبات لوڈ ہو رہی ہیں…')}</p>;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (step === 1) { setStep(2); return; }
    const credit = creditText.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    const entries = [['currency', draft!.currency], ['tax_rate_bp', draft!.tax_rate_bp], ['invoice_format', draft!.invoice_format], ['reminder_hours', draft!.reminder_hours], ['credit_alert_days', credit]] as const;
    setError(''); setBusy(true);
    try { for (const [key, value] of entries) await portal('/admin/settings', { key, value }); reload(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="yf-section">
    <h2>{t('Invoice and factory settings', 'انوائس اور فیکٹری کی ترتیبات')}</h2>
    <form onSubmit={save}>
      <Steps label={t('Settings form', 'ترتیبات کا فارم')}><Step title={t('Invoice details', 'انوائس کی تفصیل')} state={step === 1 ? 'current' : 'done'}>{step === 1 && <><Field>{t('Currency', 'کرنسی')}<select value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value })}>{['PKR', 'USD', 'EUR', 'GBP'].map(v => <option key={v}>{v}</option>)}</select></Field>
      <Field>{t('GST (%)', 'جی ایس ٹی (%)')}<input type="number" min="0" max="100" step="0.01" value={draft.tax_rate_bp / 100} onChange={e => setDraft({ ...draft, tax_rate_bp: Math.round(Number(e.target.value) * 100) })} /></Field>
      <Field>{t('Invoice number format', 'انوائس نمبر کی ترتیب')}<input value={draft.invoice_format} onChange={e => setDraft({ ...draft, invoice_format: e.target.value })} /></Field></>}</Step><Step title={t('Payment reminders', 'ادائیگی کی یاددہانی')} state={step === 2 ? 'current' : 'later'}>{step === 2 && <><Field>{t('Reminder hours', 'یاددہانی کے گھنٹے')}<input type="number" min="1" max="720" value={draft.reminder_hours} onChange={e => setDraft({ ...draft, reminder_hours: Number(e.target.value) })} /></Field>
      <Field>{t('Credit alert days', 'ادھار یاددہانی کے دن')}<input inputMode="numeric" value={creditText} onChange={e => setCreditText(e.target.value)} /></Field></>}</Step></Steps>
      <p>{t('This saves invoice currency, tax, number format and payment reminders.', 'اس سے انوائس کی کرنسی، ٹیکس، نمبر کی ترتیب اور ادائیگی کی یاددہانیاں محفوظ ہوں گی۔')}</p>
      <ActionBar primary={{ label: step === 1 ? t('Next', 'اگلا') : t('Save settings', 'ترتیبات محفوظ کریں'), icon: step === 2 ? <Save aria-hidden="true" /> : undefined, type: step === 1 ? 'button' : 'submit', disabled: busy, onClick: step === 1 ? () => setStep(2) : () => undefined }} secondary={step === 2 ? { label: t('Back', 'واپس'), type: 'button', onClick: () => setStep(1) } : undefined} />
    </form>
    {error && <p className="live-error" role="alert">{t(error)}</p>}
  </section>;
}

function activitySentence(event: any, t: (en: string, ur?: string) => string, language: Language) {
  const action = t(event.action); const object = t(...named(event.object_type));
  return `${event.actor_name || '—'} ${action} ${object} · ${when.format(event.created_at, language)}`;
}

function AuditMonitor({ navigate }: { navigate: Navigate }) {
  const { t, language } = useLanguage();
  const audit = useLoad<{ events: any[] }>('/erp/admin/audit');
  return <section className="yf-section"><h2>{t('Recent activity', 'حالیہ سرگرمی')}</h2>
    <Loaded res={audit}>{data => {
      const events = data.events || [];
      if (!events.length) return <EmptyState emptyIso="inbox" message={t('No activity recorded yet.', 'ابھی کوئی سرگرمی درج نہیں ہوئی۔')} />;
      const days = new Map<string, any[]>();
      for (const event of events) {
        const label = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK-u-nu-latn' : 'en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'full' }).format(event.created_at);
        days.set(label, [...(days.get(label) || []), event]);
      }
      return [...days].map(([day, rows]) => <section key={day}><h3>{day}</h3><ul className="yf-admin-list">{rows.map(event => <li key={event.id}><button onClick={() => { const [to, recordId] = auditRoute(event); navigate(to, recordId); }}><span className="yf-icon-chip" aria-hidden="true"><History /></span><span className="yf-row-copy"><strong>{activitySentence(event, t, language)}</strong><small>{when.format(event.created_at, language)}</small></span><ChevronRight aria-hidden="true" /></button></li>)}</ul></section>);
    }}</Loaded>
  </section>;
}

/** Read-only, paged view of the audit trail: entries are only ever appended, never edited here. */
function AuditLog() {
  const { t, language } = useLanguage();
  const people = useLoad<{ users: { id: string; name: string }[] }>('/erp/admin/users');
  const [filter, setFilter] = useState<Filter>({ objectType: '', action: '', actor: '', from: '', to: '' });
  const [filterOpen, setFilterOpen] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null), [next, setNext] = useState<string | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const key = JSON.stringify(filter);
  useEffect(() => {
    let active = true; setRows(null); setError('');
    api<any>(`/erp/admin/audit?${auditQuery(filter)}`).then(page => { if (active) { setRows(page.events || []); setNext(page.next ?? null); } }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [key, revision]);
  async function loadOlder() {
    if (!next) return;
    setBusy(true); setError('');
    try { const page = await api<any>(`/erp/admin/audit?${auditQuery(filter, next)}`); setRows(old => [...(old || []), ...(page.events || [])]); setNext(page.next ?? null); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const retry = () => { setError(''); setRevision(x => x + 1); };
  return <section className="yf-section">
    <h2>{t('Activity', 'سرگرمی')}</h2>
    <button className="button" onClick={() => setFilterOpen(true)}>{t('Filter', 'فلٹر')}</button>
    <Sheet open={filterOpen} title={t('Filter activity', 'سرگرمی چھانٹیں')} onClose={() => setFilterOpen(false)}>
      <div className="live-fields">
        <Field>{t('Kind', 'قسم')}<select value={filter.objectType} onChange={e => setFilter({ ...filter, objectType: e.target.value })}><option value="">{t('All kinds', 'تمام اقسام')}</option>{Object.keys(words).map(kind => <option key={kind} value={kind}>{t(...named(kind))}</option>)}</select></Field>
        <Field>{t('Person', 'شخص')}<select value={filter.actor} onChange={e => setFilter({ ...filter, actor: e.target.value })}><option value="">{t('Everyone', 'سب')}</option>{(people.value?.users || []).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
        <Field>{t('From date', 'ابتدائی تاریخ')}<input type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} /></Field>
        <Field>{t('To date', 'آخری تاریخ')}<input type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} /></Field>
      </div><button className="button primary" onClick={() => setFilterOpen(false)}>{t('Done', 'مکمل')}</button>
    </Sheet>
    {error && <RetryError error={error} reload={retry} />}
    {!error && rows === null && <p className="live-muted" role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>}
    {rows && !rows.length && !error && <EmptyState emptyIso="inbox" message={t('No activity matches these filters.', 'ان فلٹرز سے کوئی سرگرمی نہیں ملی۔')} />}
    {rows && rows.length > 0 && <ul className="yf-admin-list">{rows.map(event => <li key={event.id}><div className="yf-activity-row">
      <span className="yf-icon-chip" aria-hidden="true"><History /></span>
      <span className="yf-row-copy"><strong>{activitySentence(event, t, language)}</strong>
      {event.reason && <small>{t('Reason', 'وجہ')}: {event.reason}</small>}
      {event.intervention_reason && <small>{t('Intervention', 'مداخلت')}: {event.intervention_reason}</small>}</span>
    </div></li>)}</ul>}
    {rows && next && <button className="button" disabled={busy} onClick={() => void loadOlder()}><ChevronDown size={18} aria-hidden="true" />{t('Load older', 'پرانے ریکارڈ')}</button>}
  </section>;
}

function Reports({ id, navigate }: { id: string; navigate: Navigate }) {
  const { t, language } = useLanguage();
  const list = useLoad<{ reports: any[] }>('/erp/stock/reports');
  return <section className="yf-section"><h2>{t('Saved reports', 'محفوظ رپورٹیں')}</h2><Loaded res={list}>{data => {
    const rows = data.reports || [];
    const report = id ? rows.find((item: any) => item.id === id) : undefined;
    if (report) return <div className="yf-report-detail"><button className="live-text-button" onClick={() => navigate('reports')}><ArrowLeft size={18} aria-hidden="true" />{t('All reports', 'تمام رپورٹیں')}</button>
      <h3>{dateOnly(report.period_from)} – {dateOnly(report.period_to)}</h3>
      <KeyFacts items={[
        { label: t('Created by', 'تیار کردہ'), value: report.created_by_name },
        { label: t('Created', 'تاریخ'), value: when.format(report.created_at, language) },
        { label: t('Confirmed rejections', 'تصدیق شدہ مسترد مقداریں'), value: report.content?.confirmedRejections?.length ?? 0 },
        { label: t('Escalations', 'ایڈمن کو بھیجی گئی'), value: report.content?.escalations?.length ?? 0 },
        { label: t('Adjustments', 'درستگیاں'), value: report.content?.adjustments?.length ?? 0 },
        { label: t('Flagged items', 'نشان زد آئٹمز'), value: (report.flagged || []).length ? (report.flagged as any[]).map((item: any) => item.note).join(' · ') : t('None', 'کوئی نہیں') },
      ]} />
    </div>;
    if (!rows.length) return <EmptyState emptyIso="inbox" message={t('No saved reports yet.', 'ابھی کوئی رپورٹ محفوظ نہیں۔')} />;
    return <div className="yf-admin-rows">{rows.map((r: any) => <RowCard key={r.id} title={`${dateOnly(r.period_from)} – ${dateOnly(r.period_to)}`} detail={`${r.created_by_name} · ${when.format(r.created_at, language)}`} leading={<FileText aria-hidden="true" />} onClick={() => navigate('reports', r.id)} />)}</div>;
  }}</Loaded></section>;
}

function Claims({ member, id, currency, navigate }: { member: Member; id: string; currency: string; navigate: Navigate }) {
  const { t } = useLanguage();
  const list = useLoad<{ claims: any[] }>('/erp/qc/claims');
  return <section className="yf-section"><h2>{t('Claims', 'دعوے')}</h2>
    <Loaded res={list}>{data => {
      const rows = data.claims || [];
      const claim = id ? rows.find(c => c.id === id) : undefined;
      if (!rows.length) return <EmptyState emptyIso="inbox" message={t('Nothing to approve', 'منظوری کے لیے کچھ نہیں')} />;
      const visible = claim ? [claim] : rows;
      return <div className="yf-claim-queue">{visible.map((c: any) => <ClaimDetail key={c.id} member={member} claim={c} currency={currency} navigate={id ? navigate : undefined} reload={list.reload} />)}</div>;
    }}</Loaded>
  </section>;
}

function ClaimDetail({ member, claim, currency, navigate, reload }: { member: Member; claim: any; currency: string; navigate?: Navigate; reload: () => void }) {
  const { t } = useLanguage();
  const [outcome, setOutcome] = useState('claim'), [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [intervention, setIntervention] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const facts: [string, string, ReactNode][] = [
    ['Supplier', 'سپلائر', claim.supplier_name], ['Product', 'پروڈکٹ', claim.product_name], ['Rejected', 'رد شدہ', kg(claim.rejected_milli)],
    ['Rate', 'ریٹ', money(claim.po_rate_minor, currency)], ['Calculated', 'حسابی رقم', money(claim.calculated_minor, currency)], ['Status', 'حالت', <StatusTag status={claim.status} />],
  ];
  async function decide(nextOutcome = outcome) {
    setError('');
    const adjusted = amount.trim();
    if (adjusted && (!Number.isFinite(Number(adjusted)) || Number(adjusted) < 0)) { setError('Enter a valid adjusted amount.'); return; }
    if (adjusted && reason.trim().length < 5) { setError('Give a reason of at least 5 characters for an adjusted amount.'); return; }
    setBusy(true);
    try {
      await portal('/qc/claims/decide', { id: claim.id, outcome: nextOutcome, ...(adjusted ? { adjustedMinor: Math.round(Number(adjusted) * 100), reason } : {}), ...(member.role === 'admin' ? { interventionReason: intervention } : {}) });
      reload();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <article className="yf-approval-card yf-claim-card">
    {navigate && <button className="live-text-button" onClick={() => navigate('claims')}><ArrowLeft size={18} aria-hidden="true" />{t('All claims', 'تمام دعوے')}</button>}
    <div className="yf-request-head"><span className="yf-icon-chip" aria-hidden="true"><ClipboardCheck /></span>
      <div className="yf-request-copy"><p className="yf-request-sentence">{claim.supplier_name} {t('asks for a claim for', 'کا دعویٰ')} {claim.product_name}, {kg(claim.rejected_milli)} {t('rejected', 'رد شدہ')}, {money(claim.calculated_minor, currency)}.</p></div></div>
    <dl className="yf-facts">{facts.map(([en, ur, value]) => <div key={en}><dt>{t(en, ur)}</dt><dd>{value}</dd></div>)}</dl>
    {claim.status !== 'decided' && <>
      <Field>{t('Outcome', 'نتیجہ')}<select value={outcome} onChange={e => setOutcome(e.target.value)}>{outcomes.map(([v, en, ur]) => <option key={v} value={v}>{t(en, ur)}</option>)}</select></Field>
      <Field>{t('Adjusted amount (optional)', 'تبدیل شدہ رقم (اختیاری)')}<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></Field>
      <ReasonField label={t('Decision reason', 'فیصلے کی وجہ')} value={reason} onChange={setReason} required={!!amount.trim()} />
      <InterventionField member={member} owners={['admin']} value={intervention} onChange={setIntervention} />
      <div className="yf-approval-buttons"><button className="button primary" disabled={busy} onClick={() => void decide()}><Check size={20} aria-hidden="true" />{t('Approve', 'منظور کریں')}</button><button className="button" disabled={busy} onClick={() => void decide('return')}><X size={20} aria-hidden="true" />{t('Reject', 'مسترد کریں')}</button></div>
    </>}
    {error && <p role="alert" className="live-error">{t(error)}</p>}
  </article>;
}

function Analytics() {
  const { t } = useLanguage();
  const data = useLoad<any>('/erp/analytics/admin');
  if (data.error) return <NextStep tone="warn" title={t('Analytics data is not available yet.', 'تجزیاتی ڈیٹا ابھی دستیاب نہیں۔')} reason={t(data.error)} action={<button className="button" onClick={data.reload}><RotateCw size={18} aria-hidden="true" />{t('Retry', 'دوبارہ کوشش کریں')}</button>} />;
  if (data.value === null) return <p className="live-muted" role="status">{t('Loading…', 'لوڈ ہو رہا ہے…')}</p>;
  const d = data.value;
  const buyers: any[] = d.sales?.byBuyer || [];
  const payments: any[] = d.payments?.byCurrency || [];
  const currency = firstCurrency(buyers, payments);
  const sumBuyers = currency ? money(buyers.filter(row => row.currency === currency).reduce((sum, row) => sum + row.totalMinor, 0), currency) : null;
  const owed = currency ? payments.find(row => row.currency === currency) : undefined;
  const kpis: Kpi[] = [
    { label: t('Sales total', 'کل فروخت'), value: sumBuyers },
    { label: t('Outstanding', 'بقایا'), value: currency ? money(owed?.outstandingMinor ?? 0, currency) : null },
    { label: t('Overdue', 'مدت گزر گئی'), value: currency ? money(owed?.overdueMinor ?? 0, currency) : null },
    { label: t('Finished stock', 'تیار مال'), value: kg(d.inventory?.finishedGrams || 0) },
  ];
  const roleText = (role: string) => (roleLabel[role as Role] ? t(...roleLabel[role as Role]) : role);
  const rfqTone: Record<string, Tone> = { draft: 'stone', open: 'warn', closed: 'ink', awarded: 'ok', cancelled: 'bad' };
  const dispatchTone: Record<string, Tone> = { pending_approval: 'warn', approved: 'kraft', on_hold: 'bad', dispatched: 'ink', delivered: 'ok' };
  const segmentsOf = (counts: Record<string, number> | undefined, tones: Record<string, Tone>): Segment[] => Object.entries(counts || {}).map(([status, count]) => ({ key: status, label: <StatusTag status={status} />, value: Number(count), text: String(count), tone: tones[status] ?? 'stone' }));
  const claimOutcomes: Segment[] = outcomes.map(([value, en, ur]) => ({ key: value, label: t(en, ur), value: Number(d.quality?.claims?.[value] ?? 0), text: String(d.quality?.claims?.[value] ?? 0), tone: value === 'return' ? 'bad' : value === 'replacement' ? 'warn' : 'kraft' }));
  const stock: Segment[] = [
    { key: 'raw', label: t('Raw material', 'خام مال'), value: d.inventory?.rawGrams || 0, text: kg(d.inventory?.rawGrams || 0), tone: 'kraft' },
    { key: 'wip', label: t('Work in progress', 'زیرِ تیاری'), value: d.inventory?.wipGrams || 0, text: kg(d.inventory?.wipGrams || 0), tone: 'stone' },
    { key: 'finished', label: t('Finished stock', 'تیار مال'), value: d.inventory?.finishedGrams || 0, text: kg(d.inventory?.finishedGrams || 0), tone: 'ink' },
  ];
  const people: BarRow[] = (d.users || []).map((row: any, i: number) => ({ key: `${row.name}-${i}`, label: row.name, sub: roleText(row.role), value: Number(row.actions), text: String(row.actions) }));
  return <div className="ak-page">
    <KpiStrip items={kpis} />
    <div className="ak-grid">
      <AnalyticsSection className="ak-money" title={t('Money', 'رقم')} note={t('Sales, balances and purchase values, each in its own currency. Amounts are never converted.', 'فروخت، بقایا اور خریداری کی قدریں، ہر کرنسی میں الگ۔ رقم کو تبدیل نہیں کیا جاتا۔')}>
        <BarList rows={buyers.map(row => ({ key: `${row.buyer}-${row.currency}`, label: row.buyer, value: row.totalMinor, text: money(row.totalMinor, row.currency), group: row.currency }))} empty={t('No sales in this period.', 'اس مدت میں کوئی فروخت نہیں۔')} />
        <BarList rows={payments.map(row => ({ key: `owed-${row.currency}`, label: t('Outstanding', 'بقایا'), sub: `${t('Overdue', 'مدت گزر گئی')}: ${money(row.overdueMinor, row.currency)}`, value: row.outstandingMinor, text: money(row.outstandingMinor, row.currency), group: row.currency }))} empty={t('No balances owed.', 'کوئی رقم بقایا نہیں۔')} />
        <BarList rows={(d.purchasing?.totalsByCurrency || []).map((row: any) => ({ key: `po-${row.currency}`, label: t('Purchase orders', 'خریداری آرڈر'), value: row.poTotalMinor, text: money(row.poTotalMinor, row.currency), group: row.currency }))} empty={t('No purchase orders in this period.', 'اس مدت میں کوئی خریداری آرڈر نہیں۔')} />
        <BarList rows={(d.quality?.totalsByCurrency || []).map((row: any) => ({ key: `claim-${row.currency}`, label: t('Claims decided', 'طے شدہ دعوے'), value: row.claimMinor, text: money(row.claimMinor, row.currency), group: row.currency }))} empty={t('No claims decided in this period.', 'اس مدت میں کوئی دعویٰ طے نہیں ہوا۔')} />
      </AnalyticsSection>
      <AnalyticsSection className="ak-ops" title={t('Operations', 'کاروبار')} note={t('Where requests, dispatches, claims and stock stand.', 'درخواستیں، ڈسپیچ، دعوے اور اسٹاک کہاں کھڑے ہیں۔')}>
        <h3 className="ak-group-title">{t('Purchasing: RFQs by status', 'خریداری: RFQ بلحاظ حالت')}</h3>
        <StackedBar segments={segmentsOf(d.purchasing?.rfqs, rfqTone)} />
        <h3 className="ak-group-title">{t('Dispatch', 'ڈسپیچ')}</h3>
        <StackedBar segments={segmentsOf(d.dispatch, dispatchTone)} />
        <h3 className="ak-group-title">{t('Quality: claims', 'معیار: دعوے')}</h3>
        <StackedBar segments={claimOutcomes} />
        <h3 className="ak-group-title">{t('Inventory', 'اسٹاک')}</h3>
        <StackedBar segments={stock} />
      </AnalyticsSection>
      <AnalyticsSection className="ak-people" title={t('People', 'عملہ')} note={t('Recorded actions by each team member in this period.', 'اس مدت میں ہر ٹیم ممبر کے ریکارڈ شدہ اعمال۔')}>
        <BarList rows={people} empty={t('No staff activity in this period.', 'اس مدت میں عملے کی کوئی سرگرمی نہیں۔')} />
      </AnalyticsSection>
    </div>
  </div>;
}
