import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, RefreshCw, TriangleAlert, Truck } from 'lucide-react';
import { AsyncForm, Field } from './forms';
import { useLanguage } from './i18n';
import { inventoryRequest, type Member, type WorkspaceState } from './inventory-client';
import { ReverseControl } from './ToProduction';
import { InterventionField, NextStep, ReasonField, SectionTabs, StatusTag, kg } from './PortalCommon';
import './sales-screens.css';

type Order = { id: string; reference: string; status: string; buyer_name: string; product_id: string | null; product_name: string | null; quantity_milli: number; remaining_milli: number };
type Dispatch = { id: string; sales_order_id: string; lot_id: string; status: string; order_reference: string; buyer_name: string; product_name: string; lot_batch: string; quantity_milli: number; grams: number; vehicle: string; transporter: string; delivery_proof: string; hold_reason: string | null; approval_request_id: string | null; hold_notice_id: string | null; remaining_milli: number; created_at: number; dispatched_at: number | null; delivered_at: number | null };
type Props = { member: Member; section: string; tab: string; id: string; navigate: (to: string) => void };

/** Sections this screen renders; LiveApp routes these to DispatchScreens for the dispatch role and admin. */
export const DISPATCH_SECTIONS = ['dashboard', 'new-dispatch', 'dispatches', 'history'];

const statusTabs = [
  { id: 'all', en: 'All', ur: 'سب' }, { id: 'pending_approval', en: 'Needs approval', ur: 'منظوری درکار' },
  { id: 'approved', en: 'Approved', ur: 'منظور شدہ' }, { id: 'on_hold', en: 'On hold', ur: 'روکی گئی' },
  { id: 'dispatched', en: 'Dispatched', ur: 'روانہ' }, { id: 'delivered', en: 'Delivered', ur: 'پہنچائی گئی' },
];
const when = (time: number | null) => time == null ? '—' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(time);
const steps = ['pending_approval', 'approved', 'dispatched', 'delivered'] as const;

export function DispatchScreens({ member, section, tab, id, navigate }: Props) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Dispatch[]>([]), [orders, setOrders] = useState<Order[]>([]), [stock, setStock] = useState<WorkspaceState | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [orderId, setOrderId] = useState(''), [lotId, setLotId] = useState(''), [quantity, setQuantity] = useState(''), [vehicle, setVehicle] = useState(''), [transporter, setTransporter] = useState('');
  const [dispatchVehicle, setDispatchVehicle] = useState(''), [dispatchTransporter, setDispatchTransporter] = useState('');
  const [proof, setProof] = useState(''), [holdReason, setHoldReason] = useState('');
  const [issueDescription, setIssueDescription] = useState(''), [issueGrams, setIssueGrams] = useState(''), [issueKind, setIssueKind] = useState<'shortage' | 'mismatch'>('shortage');
  const [issueIntervention, setIssueIntervention] = useState(''), [intervention, setIntervention] = useState('');
  const allowed = member.role === 'dispatch' || member.role === 'admin';

  const load = useCallback(async () => {
    if (!allowed) return;
    setBusy(true);
    try {
      const [data, workspace] = await Promise.all([inventoryRequest<{ dispatches: Dispatch[]; orders: Order[] }>('/erp/dispatch'), inventoryRequest<WorkspaceState>('/workspace')]);
      setRows(data.dispatches); setOrders(data.orders); setStock(workspace); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load dispatch records.'); }
    finally { setBusy(false); }
  }, [allowed]);
  useEffect(() => { void load(); }, [load, section, tab]);

  // Throws on failure so AsyncForm shows the reason next to the form.
  const call = async (path: string, data: unknown, done: string, next?: string) => {
    setError(''); setNotice('');
    await inventoryRequest('/erp/dispatch' + path, data);
    setNotice(t(done, 'محفوظ ہو گیا۔'));
    if (next) navigate(next);
    await load();
  };
  const adminIntervention = (value: string) => member.role === 'admin' && value ? { interventionReason: value } : {};

  if (!allowed) return <section className="live-panel" role="alert"><h2>{t('Dispatch access required', 'ڈسپیچ کی رسائی درکار ہے')}</h2><p>{t('Ask an admin to open this screen for your role.', 'ایڈمن سے اپنے کردار کے لیے یہ صفحہ کھولنے کو کہیں۔')}</p></section>;
  if (busy && !stock) return <p role="status">{t('Loading dispatch records…', 'ڈسپیچ ریکارڈ لوڈ ہو رہا ہے…')}</p>;
  if (!stock) return <section className="live-panel"><p className="live-error" role="alert">{t(error || 'Could not load dispatch records.', 'ڈسپیچ ریکارڈ لوڈ نہیں ہو سکا۔')}</p><button className="button" onClick={() => void load()}><RefreshCw size={18} aria-hidden="true" />{t('Retry', 'دوبارہ کوشش کریں')}</button></section>;

  const chosen = rows.find(row => row.id === id);
  const currentTab = tab || 'all';
  const filtered = rows.filter(row => section === 'history' ? row.status === 'delivered' : currentTab === 'all' || row.status === currentTab);
  const products = stock.products, lots = stock.lots, balances = stock.balances;
  const selectedOrder = orders.find(order => order.id === orderId);
  const availableLots = lots.filter(lot => {
    const own = balances.filter(item => item.lot_id === lot.id);
    const hasFinished = own.some(item => item.stage === 'finished' && item.grams > 0);
    return lot.quality === 'approved' && hasFinished && (!selectedOrder?.product_id || selectedOrder.product_id === lot.product_id);
  });
  // A batch is listed once some of it is finished, whatever its origin: the notes say which same-material batches are not ready yet.
  const sameMaterial = (lot: { product_id: string }) => !selectedOrder?.product_id || selectedOrder.product_id === lot.product_id;
  const heldIn = (lotId: string, stage: string) => balances.some(item => item.lot_id === lotId && item.stage === stage && item.grams > 0);
  const rawBatches = lots.filter(lot => sameMaterial(lot) && heldIn(lot.id, 'raw') && !heldIn(lot.id, 'finished')).length;
  const productionBatches = lots.filter(lot => sameMaterial(lot) && heldIn(lot.id, 'wip') && !heldIn(lot.id, 'finished')).length;
  const chooseOrder = (value: string) => {
    setOrderId(value); setLotId('');
    const order = orders.find(item => item.id === value);
    setQuantity(order ? String(order.remaining_milli / 1000) : '');
  };
  const productName = (productId: string) => products.find(product => product.id === productId)?.name ?? '';

  const dashboardView = () => {
    const approved = rows.find(row => row.status === 'approved');
    return <>
      <NextStep tone={approved ? 'ok' : 'warn'} title={t('Next dispatch action', 'اگلا ڈسپیچ کام')}
        reason={approved ? t('An approved dispatch is ready to leave the factory.', 'منظور شدہ ڈسپیچ روانگی کے لیے تیار ہے۔')
          : rows.some(row => row.status === 'on_hold') ? t('A dispatch is on hold. Re-request sales approval after the issue is resolved.', 'ڈسپیچ رکی ہوئی ہے۔ مسئلہ حل ہونے پر دوبارہ منظوری مانگیں۔')
          : t('Choose a confirmed sale to request dispatch approval.', 'ڈسپیچ کی منظوری کے لیے تصدیق شدہ فروخت منتخب کریں۔')}
        action={<button className="button primary" onClick={() => navigate('new-dispatch')}><ArrowRight size={18} aria-hidden="true" />{t('New dispatch', 'نئی ڈسپیچ')}</button>} />
      <section className="live-panel"><h2>{t('Dispatch status', 'ڈسپیچ کی حالت')}</h2><p>{rows.length} · {t('saved requests', 'محفوظ درخواستیں')}</p>
        <ul className="erp-facts">{statusTabs.filter(item => item.id !== 'all').map(item => <li key={item.id}><span>{t(item.en, item.ur)}</span><strong>{rows.filter(row => row.status === item.id).length}</strong></li>)}</ul></section>
    </>;
  };

  const newDispatchView = () => <section className="live-panel">
    <h2>{t('Request dispatch approval', 'ڈسپیچ کی منظوری مانگیں')}</h2>
    <p>{t('Only QC-approved finished stock can be dispatched. Stock still in raw or in production appears here once the supervisor marks it finished.', 'صرف کوالٹی منظور شدہ تیار اسٹاک ڈسپیچ ہو سکتا ہے۔ خام یا زیرِ پیداوار اسٹاک سپروائزر کے تیار نشان زد کرنے کے بعد یہاں آئے گا۔')}</p>
    {orders.length ? <AsyncForm title={t('New dispatch request', 'نئی ڈسپیچ درخواست')} submit={t('Request approval', 'منظوری مانگیں')}
      onSubmit={() => call('', { id: crypto.randomUUID(), orderId, lotId, quantityMilli: Math.round(Number(quantity) * 1000), grams: Math.round(Number(quantity) * 1000), vehicle, transporter, ...adminIntervention(intervention) }, 'Dispatch approval requested.', 'dispatches')}>
      <Field>{t('Confirmed sale', 'تصدیق شدہ فروخت')}<select value={orderId} onChange={event => chooseOrder(event.target.value)} required><option value="">{t('Choose a sale', 'فروخت منتخب کریں')}</option>{orders.map(order => <option key={order.id} value={order.id}>{order.reference} · {order.buyer_name} · {kg(order.remaining_milli)} {t('remaining', 'باقی')}</option>)}</select></Field>
      <Field>{t('Finished goods batch', 'تیار مال کا بیچ')}<select value={lotId} onChange={event => setLotId(event.target.value)} required><option value="">{t('Choose QC-approved finished goods', 'کوالٹی منظور شدہ تیار مال منتخب کریں')}</option>{availableLots.map(lot => <option key={lot.id} value={lot.id}>{productName(lot.product_id)} · {lot.batch} · {kg(balances.filter(b => b.lot_id === lot.id && b.stage === 'finished').reduce((sum, b) => sum + b.grams, 0))} {t('finished', 'تیار')}</option>)}</select>
        {orderId && (rawBatches > 0 || productionBatches > 0) && <span className="live-muted">{t(`Not listed yet: ${rawBatches} still raw material, ${productionBatches} in production.`, `ابھی شامل نہیں: ${rawBatches} خام مال، ${productionBatches} پیداوار میں۔`)}</span>}
        {orderId && !availableLots.length && <span className="live-muted">{t('No matching finished goods lot is available.', 'مطابق تیار مال دستیاب نہیں۔')}</span>}</Field>
      <Field>{t('Quantity (kg)', 'مقدار (کلوگرام)')}<input type="number" min="0.001" max={(selectedOrder?.remaining_milli ?? 0) / 1000} step="0.001" value={quantity} onChange={event => setQuantity(event.target.value)} required /></Field>
      <div className="live-fields"><Field>{t('Vehicle (optional)', 'گاڑی (اختیاری)')}<input value={vehicle} onChange={event => setVehicle(event.target.value)} maxLength={100} /></Field>
        <Field>{t('Transporter (optional)', 'ٹرانسپورٹر (اختیاری)')}<input value={transporter} onChange={event => setTransporter(event.target.value)} maxLength={100} /></Field></div>
      <InterventionField member={member} owners={['dispatch']} value={intervention} onChange={setIntervention} />
    </AsyncForm> : <p className="live-empty">{t('No confirmed sales are open for dispatch.', 'ڈسپیچ کے لیے کوئی تصدیق شدہ فروخت موجود نہیں۔')}</p>}
  </section>;

  const detailView = (row: Dispatch) => <section className="live-panel">
    <div className="live-panel-heading"><div><h2>{row.order_reference} · {row.buyer_name}</h2><p>{row.product_name} · {row.lot_batch} · {kg(row.grams)}</p></div><StatusTag status={row.status} /></div>
    <div className="yf-dispatch-thread" aria-label={t('Dispatch status history', 'ڈسپیچ کی حالت کی تاریخ')}><ol>{steps.map((step, i) => <li key={step} className={i <= steps.indexOf(row.status as typeof steps[number]) ? 'done' : ''} aria-current={row.status === step ? 'step' : undefined}>
      <StatusTag status={step} /> · {i === 0 ? when(row.created_at) : i === 2 ? when(row.dispatched_at) : i === 3 ? when(row.delivered_at) : row.status === 'approved' || row.status === 'dispatched' || row.status === 'delivered' ? t('Complete', 'مکمل') : t('Waiting', 'منتظر')}
    </li>)}</ol></div>
    {row.status === 'on_hold' && <p className="live-warning"><StatusTag status="on_hold" /> · {row.hold_reason}</p>}
    {(row.vehicle || row.transporter) && <p>{t('Vehicle', 'گاڑی')}: {row.vehicle || '—'} · {t('Transporter', 'ٹرانسپورٹر')}: {row.transporter || '—'}</p>}
    {row.status === 'delivered' && row.delivery_proof && <p>{t('Delivery proof', 'ترسیل کا ثبوت')}: {row.delivery_proof}</p>}
    {row.status === 'on_hold' && <AsyncForm title={t('Re-request dispatch approval', 'ڈسپیچ کی منظوری دوبارہ مانگیں')} submit={t('Re-request approval', 'دوبارہ منظوری مانگیں')}
      onSubmit={() => call('/request', { dispatchId: row.id, ...adminIntervention(intervention) }, 'Approval requested again.')}>
      <InterventionField member={member} owners={['dispatch']} value={intervention} onChange={setIntervention} />
    </AsyncForm>}
    {row.status === 'approved' && row.hold_notice_id && <AsyncForm title={t('A sales manager sent a hold notice', 'سیلز مینیجر نے روکنے کا نوٹس بھیجا')} submit={t('Place dispatch on hold', 'ڈسپیچ روکیں')}
      onSubmit={() => call('/hold', { dispatchId: row.id, noticeId: row.hold_notice_id, reason: holdReason, ...adminIntervention(intervention) }, 'Dispatch placed on hold.')}>
      <ReasonField label={t('Reason', 'وجہ')} value={holdReason} onChange={setHoldReason} />
      <InterventionField member={member} owners={['dispatch']} value={intervention} onChange={setIntervention} />
    </AsyncForm>}
    {row.status === 'approved' && <AsyncForm title={t('Record dispatch', 'روانگی درج کریں')} submit={t('Mark dispatched', 'روانہ درج کریں')}
      onSubmit={() => call('/dispatched', { dispatchId: row.id, vehicle: dispatchVehicle, transporter: dispatchTransporter, ...adminIntervention(intervention) }, 'Dispatch recorded; finished stock was deducted.')}>
      <Field>{t('Vehicle', 'گاڑی')}<input value={dispatchVehicle} onChange={event => setDispatchVehicle(event.target.value)} maxLength={100} /></Field>
      <Field>{t('Transporter', 'ٹرانسپورٹر')}<input value={dispatchTransporter} onChange={event => setDispatchTransporter(event.target.value)} maxLength={100} /></Field>
      <InterventionField member={member} owners={['dispatch']} value={intervention} onChange={setIntervention} />
    </AsyncForm>}
    {row.status === 'dispatched' && <AsyncForm title={t('Confirm delivery', 'ترسیل کی تصدیق')} submit={t('Mark delivered', 'پہنچائی گئی درج کریں')}
      onSubmit={() => call('/delivered', { dispatchId: row.id, deliveryProof: proof, ...adminIntervention(intervention) }, 'Delivery confirmed.')}>
      <Field>{t('Delivery proof (optional)', 'ترسیل کا ثبوت (اختیاری)')}<textarea value={proof} onChange={event => setProof(event.target.value)} maxLength={500} /></Field>
      <InterventionField member={member} owners={['dispatch']} value={intervention} onChange={setIntervention} />
    </AsyncForm>}
    {row.status === 'dispatched' && <ReverseControl label={t('Undo dispatch', 'ڈسپیچ واپس لیں')} confirm={t('Undo dispatch', 'ڈسپیچ واپس لیں')} isAdmin={member.role === 'admin'}
      impact={t(`Puts ${kg(row.grams)} back into Finished stock, batch ${row.lot_batch}, and returns this dispatch to approved.`, `بیچ ${row.lot_batch} کا ${kg(row.grams)} واپس تیار اسٹاک میں جائے گا، اور یہ ڈسپیچ منظور شدہ ہو جائے گی۔`)}
      run={async ({ id, reason, interventionReason }) => { await call('/dispatched/reverse', { id, dispatchId: row.id, reason, ...(interventionReason ? { interventionReason } : {}) }, 'Dispatch undone. Its stock is back in finished goods.'); }} />}
    {['pending_approval', 'approved', 'on_hold'].includes(row.status) && <details className="live-panel">
      <summary><TriangleAlert size={18} aria-hidden="true" /> {t('Raise a stock issue', 'اسٹاک کا مسئلہ درج کریں')}</summary>
      <AsyncForm title={t('Stock shortage or mismatch', 'اسٹاک کی کمی یا فرق')} submit={t('Send issue to supervisor', 'سپروائزر کو بھیجیں')}
        onSubmit={() => call('/stock-issues', { id: crypto.randomUUID(), dispatchId: row.id, lotId: row.lot_id, stage: 'finished', kind: issueKind, differenceGrams: Math.round(Number(issueGrams) * 1000), description: issueDescription, ...(member.role === 'admin' && issueIntervention ? { interventionReason: issueIntervention } : {}) }, 'Stock issue sent to the supervisor.')}>
        <Field>{t('Issue type', 'مسئلے کی قسم')}<select value={issueKind} onChange={event => setIssueKind(event.target.value as typeof issueKind)}><option value="shortage">{t('Shortage', 'کمی')}</option><option value="mismatch">{t('Mismatch', 'فرق')}</option></select></Field>
        <Field>{t('Difference (kg)', 'فرق (کلوگرام)')}<input type="number" min="0.001" step="0.001" value={issueGrams} onChange={event => setIssueGrams(event.target.value)} required /></Field>
        <Field>{t('Describe the mismatch', 'فرق کی تفصیل')}<textarea minLength={5} maxLength={2000} value={issueDescription} onChange={event => setIssueDescription(event.target.value)} required /></Field>
        <InterventionField member={member} owners={['dispatch']} value={issueIntervention} onChange={setIssueIntervention} />
      </AsyncForm>
    </details>}
    {row.status === 'pending_approval' && row.hold_notice_id && <p className="live-warning">{t('The sales manager sent a hold notice. Review it before proceeding.', 'سیلز مینیجر نے روکنے کا نوٹس بھیجا ہے۔ پہلے اسے دیکھیں۔')}</p>}
    {row.status === 'pending_approval' && <p>{t('Waiting for the sales manager to approve this request.', 'سیلز مینیجر کی منظوری کا انتظار ہے۔')}</p>}
    <button className="button" onClick={() => navigate('dispatches')}><ArrowRight size={18} aria-hidden="true" />{t('Back to dispatches', 'ڈسپیچ فہرست')}</button>
  </section>;

  const listView = () => {
    const tabsForView = section === 'history' ? [{ id: 'delivered', en: 'Delivered', ur: 'پہنچائی گئی' }] : statusTabs;
    const value = section === 'history' ? 'delivered' : currentTab;
    return <>
      <SectionTabs tabs={tabsForView} value={value} onChange={next => navigate(section === 'history' ? 'history' : 'dispatches/' + next)} />
      {filtered.length ? <div className="erp-records">{filtered.map(row => <article className="erp-record" key={row.id}>
        <div className="erp-record-head"><div><h2><button className="live-text-button" onClick={() => navigate('dispatches/' + row.id)}>{row.order_reference} · {row.buyer_name}</button></h2><p>{row.product_name} · {row.lot_batch} · {kg(row.grams)} · {when(row.created_at)}</p></div><StatusTag status={row.status} /></div>
        <button className="button" onClick={() => navigate('dispatches/' + row.id)}><Truck size={18} aria-hidden="true" />{t('Open dispatch', 'ڈسپیچ کھولیں')}</button>
      </article>)}</div>
        : <p className="live-empty">{t('No dispatches in this view.', 'اس حصے میں کوئی ڈسپیچ نہیں۔')}</p>}
    </>;
  };

  return <div className="erp-workspace yf-dispatch-screens">
    {error && <p className="live-error" role="alert">{t(error, 'درخواست مکمل نہیں ہوئی۔ دوبارہ کوشش کریں۔')} <button className="live-text-button" onClick={() => void load()}>{t('Retry', 'دوبارہ کوشش')}</button></p>}
    {notice && <p role="status" className="live-success">{notice}</p>}
    <div className="erp-toolbar"><span>{t('Dispatch changes are saved to the shared factory records.', 'ڈسپیچ کی تبدیلیاں مشترکہ فیکٹری ریکارڈ میں محفوظ ہوتی ہیں۔')}</span>
      <button className="button" onClick={() => void load()} disabled={busy}><RefreshCw size={18} aria-hidden="true" />{t('Refresh', 'تازہ کریں')}</button></div>
    {busy && <p role="status">{t('Refreshing dispatch records…', 'ڈسپیچ ریکارڈ تازہ ہو رہا ہے…')}</p>}
    {section === 'dashboard' && dashboardView()}
    {section === 'new-dispatch' && newDispatchView()}
    {(section === 'dispatches' || section === 'history') && (chosen ? detailView(chosen) : listView())}
  </div>;
}

export default DispatchScreens;
