import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { AlertCircle, BellRing, Check, CheckCircle2, Factory, LoaderCircle } from 'lucide-react';
import { errorMessage } from './forms';
import { useLanguage } from './i18n';
import { portal } from './PortalCommon';
import { InventoryError, weight, type Member } from './inventory-client';
import ToProduction, { type ProductionJob } from './ToProduction';
import { when } from './WorkspaceDashboard';
import './attention-widget.css';

interface Report { inspectionId: string; lotReference: string; supplierName: string; acceptedMilli: number; unit: 'kg' | 'tonne'; submittedAt: number }
interface Attention { reports: Report[]; readyForProduction: ProductionJob[] }

const REFRESH_MS = 30000;
// Arrivals store milli-units of kg or tonne; the same conversion as the Stock page.
const kgOf = (milli: number, unit: 'kg' | 'tonne') => weight(milli * (unit === 'tonne' ? 1000 : 1));

/** Dashboard card of what waits on a supervisor or admin: QC reports to accept, and batches ready for production. */
export function AttentionWidget({ member, onChanged }: { member: Member; onChanged?: () => Promise<void> }) {
  const { t, language } = useLanguage();
  const canAct = member.role === 'supervisor' || member.role === 'admin';
  const isAdmin = member.role === 'admin';
  const [data, setData] = useState<Attention | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState('');
  const [rejecting, setRejecting] = useState<{ id: string; text: string } | null>(null);
  const [producing, setProducing] = useState<ProductionJob | null>(null);

  const load = useCallback(async () => {
    try { setData(await portal<Attention>('/stock/attention')); setError(''); }
    catch (caught) {
      // Roles without access, or a server that has not shipped the route yet, get no card at all.
      if (caught instanceof InventoryError && (caught.status === 403 || caught.status === 404)) { setHidden(true); return; }
      setError(errorMessage(caught, language));
    }
  }, [language]);

  useEffect(() => {
    if (!canAct) return;
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [canAct, load]);

  // The workspace (stock, balances) refreshes first, then this card reads the new queue.
  async function changed(message: string) {
    setNotice(message);
    await onChanged?.();
    await load();
  }

  async function decide(inspectionId: string, decision: 'accept' | 'reject', why = '') {
    const admin = isAdmin ? reason.trim() : '';
    if (isAdmin && admin.length < 5) { setError(t('Give a reason of at least 5 characters for this admin action.', 'ایڈمن کارروائی کی کم از کم 5 حروف کی وجہ لکھیں۔')); return; }
    setBusyId(inspectionId); setError(''); setNotice('');
    try {
      await portal('/qc/reports/decide', { inspectionId, decision, ...(decision === 'reject' ? { reason: why } : {}), ...(isAdmin ? { interventionReason: admin } : {}) });
      setRejecting(null);
      await changed(decision === 'accept'
        ? t('QC report accepted. The stock is now in raw material.', 'QC رپورٹ قبول ہو گئی۔ اسٹاک اب خام مال میں ہے۔')
        : t('QC report rejected.', 'QC رپورٹ مسترد ہو گئی۔'));
    } catch (caught) { setError(errorMessage(caught, language)); }
    finally { setBusyId(''); }
  }

  if (!canAct || hidden) return null;
  const reports = data?.reports ?? [], ready = data?.readyForProduction ?? [];
  const total = reports.length + ready.length;
  const rowDelay = (index: number) => ({ '--d': `${index * 60}ms` }) as CSSProperties;

  return <section className="att-card" aria-labelledby="att-title">
    <div className="att-head">
      <h2 id="att-title"><BellRing size={18} aria-hidden="true" />{t('Needs attention', 'توجہ طلب')}</h2>
      {total > 0 && <span className="att-count" aria-label={`${total} ${t('items', 'اشیاء')}`}>{total}</span>}
    </div>
    {isAdmin && total > 0 && <div className="att-reason">
      <label htmlFor="att-reason">{t('Admin reason', 'ایڈمن کی وجہ')}</label>
      <input id="att-reason" className="att-input" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} />
      <small>{t('Admins act outside their role, so each action needs a reason of at least 5 characters.', 'ایڈمن اپنے کردار سے باہر کام کرتے ہیں، اس لیے ہر کارروائی کے لیے کم از کم 5 حروف کی وجہ ضروری ہے۔')}</small>
    </div>}
    {error && <p className="live-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
    {notice && <p className="live-success" role="status">{notice}</p>}
    {!data && !error && <p className="att-muted" role="status">{t('Checking…', 'جانچ ہو رہی ہے…')}</p>}
    {data && total === 0 && <div className="att-empty"><CheckCircle2 size={28} aria-hidden="true" /><p>{t('Nothing needs attention', 'کسی چیز کو توجہ کی ضرورت نہیں')}</p></div>}

    {reports.length > 0 && <section className="att-section" aria-labelledby="att-reports">
      <h3 id="att-reports"><span className="att-tally">{reports.length}</span>{t('QC reports to accept', 'قبول کرنے کے لیے QC رپورٹیں')}</h3>
      <ul>{reports.map((report, index) => <li key={report.inspectionId} className="att-row" style={rowDelay(index)}>
        <div className="att-row-main">
          <strong>{report.lotReference}</strong>
          <span>{report.supplierName} · {kgOf(report.acceptedMilli, report.unit)} kg · {when.format(report.submittedAt, language)}</span>
        </div>
        <div className="att-row-actions">
          <button className="button primary" disabled={!!busyId} onClick={() => void decide(report.inspectionId, 'accept')} aria-label={`${t('Accept', 'قبول کریں')}: ${report.lotReference}`}>
            {busyId === report.inspectionId ? <LoaderCircle className="live-spinning" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}{t('Accept', 'قبول کریں')}
          </button>
          <button className="button" disabled={!!busyId} onClick={() => setRejecting({ id: report.inspectionId, text: '' })} aria-label={`${t('Reject', 'مسترد کریں')}: ${report.lotReference}`}>{t('Reject', 'مسترد کریں')}</button>
        </div>
        {rejecting?.id === report.inspectionId && <form className="att-reject" onSubmit={event => { event.preventDefault(); void decide(report.inspectionId, 'reject', rejecting.text.trim()); }}>
          <label htmlFor="att-reject-reason">{t('Reason for rejecting', 'مسترد کرنے کی وجہ')}</label>
          <input id="att-reject-reason" className="att-input" value={rejecting.text} maxLength={1000} onChange={e => setRejecting({ id: report.inspectionId, text: e.target.value })} />
          <small className="att-muted">{t('At least 5 characters.', 'کم از کم 5 حروف۔')}</small>
          <div className="att-row-actions">
            <button type="submit" className="button primary" disabled={rejecting.text.trim().length < 5 || !!busyId}>{t('Confirm rejection', 'مسترد کرنے کی تصدیق کریں')}</button>
            <button type="button" className="button" disabled={!!busyId} onClick={() => setRejecting(null)}>{t('Cancel', 'منسوخ کریں')}</button>
          </div>
        </form>}
      </li>)}</ul>
    </section>}

    {ready.length > 0 && <section className="att-section" aria-labelledby="att-ready">
      <h3 id="att-ready"><span className="att-tally">{ready.length}</span>{t('Ready for production', 'پیداوار کے لیے تیار')}</h3>
      <ul>{ready.map((batch, index) => <li key={batch.lotId} className="att-row" style={rowDelay(index)}>
        <div className="att-row-main">
          <strong>{t('Batch', 'بیچ')} {batch.batch}</strong>
          <span>{batch.productName} · {weight(batch.rawGrams)} kg {t('raw', 'خام')}</span>
        </div>
        <div className="att-row-actions">
          <button className="button primary" onClick={() => setProducing(batch)} aria-label={`${t('To production', 'پیداوار کے لیے')}: ${t('Batch', 'بیچ')} ${batch.batch}`}><Factory size={18} aria-hidden="true" />{t('To production', 'پیداوار کے لیے')}</button>
        </div>
      </li>)}</ul>
    </section>}

    {producing && <ToProduction {...producing} isAdmin={isAdmin} onClose={() => setProducing(null)}
      onDone={async message => { setProducing(null); await changed(message); }} />}
  </section>;
}
