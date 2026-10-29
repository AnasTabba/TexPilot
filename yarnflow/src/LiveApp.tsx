import { useLanguage } from './i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AsyncForm, Field, errorMessage } from './forms';
import { ArrowLeft, ArrowRight, Boxes, Camera, Check, CheckCheck, ClipboardList, Download, Factory, LoaderCircle, Plus, Printer, RefreshCw, Ruler, ScanLine, Settings2, ShieldCheck, WifiOff, X, CheckCircle2, TriangleAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { QualityBadge, StockFlow, movedName, when, yarnName } from './WorkspaceDashboard';
import { moveIcon } from './icons';
import { Dashboard, Notifications, type Inbox } from './Notifications';
import Profile from './Profile';
import { portal } from './PortalCommon';
import { COMMON, NAV, type Section } from './roles';
import QualityScreens from './QualityScreens';
import Review from './Review';
import { SupervisorScreens } from './SupervisorScreens';
import { parseHash } from './routes.ts';
import SignIn, { Avatar } from './SignIn';
import { MODULES } from './ModuleViews';
import AdminScreens from './AdminScreens';
import { Menu, Package, Truck, Search, ChevronRight, ShieldAlert, ArrowRightLeft, ClipboardCheck, ScanBarcode, LogOut } from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';
import Scanner from './Scanner';
import SpecScan from './SpecScan';
import { Cone, materialHue } from './Cone';
import type { ScanResult } from './scanner-client';
import { roleLabel, gramsFromKg, InventoryError, inventoryRequest as api, stageName, timestamp, weight, type Role, type StockLot, type StockMovement, type StockStage, type WorkspaceState } from './inventory-client';

// Old pages that were filtered copies of the stock list (or of Home) now open Stock with that filter.
type View = 'all' | 'quality' | 'production' | 'dispatch';
const aliases: Record<string, [string, View]> = { materials: ['inventory', 'all'], production: ['inventory', 'production'], quality: ['inventory', 'quality'], overview: ['dashboard', 'all'] };
const sections = [...new Set([...Object.values(NAV).flat(), ...COMMON])];
const tabsOf = Object.fromEntries(sections.flatMap(section => section.tabs ? [[section.id, section.tabs.map(tab => tab.id)]] : []));
const MODULE_KEYS = ['purchase', 'quality', 'supervisor', 'sales', 'dispatch'];
const ROLE_OF_MODULE: Record<string, Role> = { purchase: 'purchase_manager', quality: 'quality_inspector', supervisor: 'supervisor', sales: 'sales_manager', dispatch: 'dispatch' };
const routeDetailsFromHash = () => {
  const pieces = location.hash.replace(/^#\/?/, '').split('/');
  const module = pieces[0] === 'modules' && MODULE_KEYS.includes(pieces[1]) ? pieces[1] : '';
  const source = module ? '#/' + pieces.slice(2).join('/') : location.hash;
  const parsed = parseHash(source, tabsOf);
  const section = aliases[parsed.section]?.[0] ?? (sections.some(known => known.id === parsed.section) ? parsed.section : 'dashboard');
  return { ...parsed, section, module };
};
const routeFromHash = () => routeDetailsFromHash().section;
const lotFromHash = () => location.hash.startsWith('#/inventory/') ? location.hash.split('/')[2] || '' : '';
function saveFile(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DispatchPanel({ state }: { state: WorkspaceState }) {
  const { t } = useLanguage();
  type Order = { id: string; reference: string; buyer_name: string; product_id: string | null; product_name: string; remaining_milli: number };
  type Dispatch = { id: string; status: string; order_reference: string; buyer_name: string; product_name: string; lot_id: string; lot_batch: string; quantity_milli: number; grams: number; approval_request_id: string | null; hold_notice_id: string | null };
  type StockIssue = { id: string; lot_id: string; stage: string; kind: string; difference_grams: number; description: string; status: string; lot_batch: string; product_name: string };
  const [orders, setOrders] = useState<Order[]>([]), [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [issues, setIssues] = useState<StockIssue[]>([]);
  const [orderId, setOrderId] = useState(''), [lotId, setLotId] = useState(''), [quantity, setQuantity] = useState('');
  const [term, setTerm] = useState('terms_not_met'), [message, setMessage] = useState(''), [reason, setReason] = useState('');
  const [correction, setCorrection] = useState('');
  const [issueStage, setIssueStage] = useState('finished'), [issueKind, setIssueKind] = useState('shortage');
  const [difference, setDifference] = useState(''), [description, setDescription] = useState(''), [deliveryProof, setDeliveryProof] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const dispatchRole = state.member.role === 'dispatch', salesRole = state.member.role === 'sales_manager', supervisorRole = state.member.role === 'supervisor';
  const dispatchStatus = (status: string) => ({
    pending_approval: t("Pending approval", "منظوری زیر التوا"), approved: t("Approved", "منظور شد"),
    on_hold: t("On hold", "روکا گیا"), dispatched: t("Dispatched", "ڈسپیچ ہو گیا"), delivered: t("Delivered", "پہنچایا گیا"),
    open: t("Open", "کھلا"), pending_approval_issue: t("Pending approval", "منظوری زیر التوا"),
    accepted: t("Accepted", "قبول شدہ"), rejected: t("Rejected", "مسترد"),
  }[status] || t(status));
  const selectedOrder = orders.find(order => order.id === orderId);
  const availableLots = state.lots.filter(lot => (!selectedOrder?.product_id || selectedOrder.product_id === lot.product_id) && (!lot.inventory_type || lot.inventory_type === 'finished') && lot.quality === 'approved' && (state.balances.find(b => b.lot_id === lot.id && b.stage === 'finished')?.grams || 0) > 0);
  async function refresh() {
    try {
      if (supervisorRole) setIssues((await api<{ issues: StockIssue[] }>('/erp/dispatch/stock-issues')).issues);
      else { const result = await api<{ orders: Order[]; dispatches: Dispatch[] }>('/erp/dispatch'); setOrders(result.orders); setDispatches(result.dispatches); }
      setError('');
    }
    catch (e) { setError(errorMessage(e)); }
  }
  useEffect(() => { void refresh(); }, []);
  async function act(path: string, body: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await api(path, body); setReason(''); setMessage(''); setQuantity(''); setDifference(''); setDescription(''); setDeliveryProof(''); await refresh(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="live-panel" aria-labelledby="dispatch-title">
    <div className="live-panel-heading"><h2 id="dispatch-title">{t("Dispatch workflow", "ڈسپیچ کا طریقۂ کار")}</h2><button className="button" disabled={busy} onClick={() => void refresh()}>{t("Refresh", "تازہ کریں")}</button></div>
    {error && <p role="alert" className="live-error">{t(error)}</p>}
    {dispatchRole && <section><h3>{t("Request a sale dispatch", "فروخت کی ڈسپیچ کی درخواست")}</h3>
      <Field>{t("Sale order", "فروخت کا آرڈر")}<select value={orderId} onChange={e => setOrderId(e.target.value)} required><option value="">{t("Choose an open order", "کھلا آرڈر منتخب کریں")}</option>{orders.map(order => <option key={order.id} value={order.id}>{order.reference} · {order.buyer_name} · {t("remaining", "باقی")} {weight(order.remaining_milli)} kg</option>)}</select></Field>
      <Field>{t("Finished batch", "تیار مال کا بیچ")}<select value={lotId} onChange={e => setLotId(e.target.value)} required><option value="">{t("Choose approved finished stock", "منظور شدہ تیار مال منتخب کریں")}</option>{availableLots.map(lot => <option key={lot.id} value={lot.id}>{lot.batch} · {state.products.find(p => p.id === lot.product_id)?.name}</option>)}</select></Field>
      <Field>{t("Quantity (kg)", "مقدار (کلوگرام)")}<input type="number" min="0.001" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} required /></Field>
      <button className="button primary" disabled={busy || !orderId || !lotId || !quantity || !availableLots.length} onClick={() => { const grams = gramsFromKg(quantity); void act('/erp/dispatch', { id: crypto.randomUUID(), orderId, lotId, quantityMilli: grams, grams, cartons: 0, cones: 0 }); }}>{t("Request approval", "منظوری کی درخواست")}</button>
    </section>}
    {dispatchRole && <section><h3>{t("Report a stock issue", "اسٹاک کا مسئلہ درج کریں")}</h3>
      <Field>{t("Batch", "بیچ")}<select value={lotId} onChange={e => setLotId(e.target.value)} required><option value="">{t("Choose a batch", "بیچ منتخب کریں")}</option>{state.lots.map(lot => <option key={lot.id} value={lot.id}>{lot.batch} · {state.products.find(p => p.id === lot.product_id)?.name}</option>)}</select></Field>
      <Field>{t("Stock stage", "اسٹاک کی قسم")}<select value={issueStage} onChange={e => setIssueStage(e.target.value)}><option value="finished">{t("Finished", "تیار مال")}</option><option value="raw">{t("Raw", "خام مال")}</option></select></Field>
      <Field>{t("Issue", "مسئلہ")}<select value={issueKind} onChange={e => setIssueKind(e.target.value)}><option value="shortage">{t("Shortage", "کمی")}</option><option value="mismatch">{t("Mismatch", "عدم مطابقت")}</option></select></Field>
      <Field>{t("Difference (grams)", "فرق (گرام)")}<input type="number" min="0" step="1" value={difference} onChange={e => setDifference(e.target.value)} required /></Field>
      <Field>{t("What did you find?", "کیا مسئلہ ملا؟")}<textarea minLength={5} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} required /></Field>
      <button className="button" disabled={busy || !lotId || !difference || description.trim().length < 5} onClick={() => void act('/erp/dispatch/stock-issues', { id: crypto.randomUUID(), lotId, stage: issueStage, kind: issueKind, differenceGrams: Number(difference), description })}>{t("Send to supervisor", "سپروائزر کو بھیجیں")}</button>
    </section>}
    {salesRole && <section><h3>{t("Sales manager decision", "سیلز مینیجر کا فیصلہ")}</h3><Field>{t("Hold reason", "روکنے کی وجہ")}<textarea minLength={5} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field><Field>{t("Hold term", "روکنے کی شرط")}<select value={term} onChange={e => setTerm(e.target.value)}><option value="payment_overdue">{t("Payment overdue", "ادائیگی واجب الادا")}</option><option value="terms_not_met">{t("Terms not met", "شرائط پوری نہیں ہوئیں")}</option><option value="other">{t("Other", "دیگر")}</option></select></Field></section>}
    {dispatchRole && <section><h3>{t("Hold notice", "روکنے کا پیغام")}</h3><Field>{t("Message from sales manager", "سیلز مینیجر کا پیغام")}<textarea minLength={1} maxLength={1000} value={message} onChange={e => setMessage(e.target.value)} /></Field><Field>{t("Hold reason", "روکنے کی وجہ")}<textarea minLength={5} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field></section>}
    {dispatchRole && <Field>{t("Delivery proof (optional)", "ترسیل کا ثبوت (اختیاری)")}<input value={deliveryProof} onChange={e => setDeliveryProof(e.target.value)} maxLength={500} /></Field>}
    {supervisorRole && <section><h3>{t("Stock issues", "اسٹاک کے مسائل")}</h3><Field>{t("Correction (grams, optional)", "درستگی (گرام، اختیاری)")}<input type="number" step="1" value={correction} onChange={e => setCorrection(e.target.value)} /></Field><Field>{t("Decision reason", "فیصلے کی وجہ")}<textarea minLength={5} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field></section>}
    <ol className="yf-timeline">{dispatches.map(row => <li key={row.id}><div><strong>{row.order_reference} · {row.buyer_name}</strong><span>{row.product_name} · {row.lot_batch} · {weight(row.grams)} kg · {dispatchStatus(row.status)}</span>
      {salesRole && row.status === 'pending_approval' && <div className="live-actions"><button className="button primary" disabled={busy} onClick={() => void act('/erp/dispatch/requests/decide', { requestId: row.approval_request_id, decision: 'approve' })}>{t("Approve", "منظور کریں")}</button><button className="button" disabled={busy || reason.trim().length < 5} onClick={() => void act('/erp/dispatch/requests/decide', { requestId: row.approval_request_id, decision: 'hold', term, reason })}>{t("Hold", "روکیں")}</button></div>}
      {salesRole && row.status === 'pending_approval' && <p>{t("A hold requires a reason and a valid hold term.", "روکنے کے لیے وجہ اور درست شرط ضروری ہے۔")}</p>}
      {salesRole && <div className="live-actions"><input aria-label={t("Hold message", "روکنے کا پیغام")} value={message} onChange={e => setMessage(e.target.value)} placeholder={t("Message dispatch about a terms issue", "شرائط کے مسئلے پر ڈسپیچ کو پیغام دیں")} /><button className="button" disabled={busy || message.trim().length < 1} onClick={() => void act('/erp/dispatch/hold-notices', { dispatchId: row.id, term, message })}>{t("Send hold notice", "روکنے کا پیغام بھیجیں")}</button></div>}
      {dispatchRole && row.status === 'approved' && <button className="button primary" disabled={busy} onClick={() => void act('/erp/dispatch/dispatched', { dispatchId: row.id })}>{t("Mark dispatched", "ڈسپیچ مکمل درج کریں")}</button>}
      {dispatchRole && row.status === 'dispatched' && <button className="button" disabled={busy} onClick={() => void act('/erp/dispatch/delivered', { dispatchId: row.id, deliveryProof })}>{t("Mark delivered", "ترسیل مکمل درج کریں")}</button>}
      {dispatchRole && row.status === 'on_hold' && <button className="button" disabled={busy} onClick={() => void act('/erp/dispatch/request', { dispatchId: row.id })}>{t("Request again", "دوبارہ درخواست")}</button>}
      {dispatchRole && ['approved', 'pending_approval'].includes(row.status) && row.hold_notice_id && <button className="button" disabled={busy || reason.trim().length < 5} onClick={() => void act('/erp/dispatch/hold', { dispatchId: row.id, noticeId: row.hold_notice_id, reason })}>{t("Acknowledge hold", "روکنے کی تصدیق")}</button>}
    </div></li>)}</ol>
    {supervisorRole && <ol className="yf-timeline">{issues.map(issue => <li key={issue.id}><div><strong>{issue.product_name} · {issue.lot_batch} · {issue.stage === 'raw' ? t("Raw", "خام مال") : t("Finished", "تیار مال")} · {issue.kind === 'shortage' ? t("Shortage", "کمی") : t("Mismatch", "عدم مطابقت")}</strong><span>{issue.description} · {t("Reported difference", "درج شدہ فرق")} {weight(issue.difference_grams)} kg · {dispatchStatus(issue.status)}</span>{issue.status === 'open' && <div className="live-actions"><button className="button primary" disabled={busy || reason.trim().length < 5} onClick={() => void act('/erp/dispatch/stock-issues/decide', { id: issue.id, decision: 'accept', reason, ...(correction ? { correctionGrams: Number(correction) } : {}) })}>{t("Accept", "قبول کریں")}</button><button className="button" disabled={busy || reason.trim().length < 5} onClick={() => void act('/erp/dispatch/stock-issues/decide', { id: issue.id, decision: 'reject', reason })}>{t("Reject", "رد کریں")}</button></div>}</div></li>)}</ol>}
    {!supervisorRole && !dispatches.length && <p className="live-muted">{t("No dispatch requests yet.", "ابھی کوئی ڈسپیچ درخواست نہیں۔")}</p>}
    {supervisorRole && !issues.length && <p className="live-muted">{t("No stock issues are waiting.", "کوئی اسٹاک مسئلہ زیرِ انتظار نہیں۔")}</p>}
  </section>;
}

function LotDetail({ lot, state, onBack }: { lot: StockLot; state: WorkspaceState; onBack: () => void }) {
  const { t, language } = useLanguage();
  const product = state.products.find(p => p.id === lot.product_id);
  const [qr, setQr] = useState(''); const [qrError, setQrError] = useState('');
  type Evidence = Pick<WorkspaceState, 'inspections' | 'qualityEvents' | 'photos'> & { nextOffset: number | null };
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evidenceError, setEvidenceError] = useState(''); const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceRetry, setEvidenceRetry] = useState(0);
  const merge = <T extends { id: string }>(latest: T[], older: T[]) => [...latest, ...older.filter(item => !latest.some(record => record.id === item.id))];
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    api<Evidence>(`/lots/${lot.id}/evidence`, undefined, controller.signal).then(page => {
      if (!alive) return;
      setEvidence(previous => previous ? { inspections: merge(page.inspections, previous.inspections), qualityEvents: merge(page.qualityEvents, previous.qualityEvents), photos: merge(page.photos, previous.photos), nextOffset: previous.nextOffset === null ? page.nextOffset : Math.max(page.nextOffset || 0, previous.nextOffset) || null } : page);
      setEvidenceError('');
    }).catch(error => { if (alive) setEvidenceError(errorMessage(error)); });
    return () => { alive = false; controller.abort(); };
  }, [lot.id, state.serverTime, evidenceRetry]);
  async function loadEvidence() {
    if (evidence?.nextOffset == null) return;
    setEvidenceBusy(true);
    try {
      const page = await api<Evidence>(`/lots/${lot.id}/evidence?offset=${evidence.nextOffset}`);
      setEvidence(previous => previous ? { inspections: merge(previous.inspections, page.inspections), qualityEvents: merge(previous.qualityEvents, page.qualityEvents), photos: merge(previous.photos, page.photos), nextOffset: page.nextOffset } : page);
      setEvidenceError('');
    } catch (error) { setEvidenceError(errorMessage(error)); } finally { setEvidenceBusy(false); }
  }
  useEffect(() => { let alive = true; QRCode.toDataURL(`YF:${lot.id}`, { width: 240, margin: 2, errorCorrectionLevel: 'M' }).then(value => { if (alive) setQr(value); }).catch(() => setQrError(t("Could not generate the QR image. Refresh to try again."))); return () => { alive = false; }; }, [lot.id]);
  const lotMoves = state.movements.filter(m => m.lot_id === lot.id);
  const lotBalances = state.balances.filter(b => b.lot_id === lot.id);
  const at = (...stages: StockStage[]) => lotBalances.filter(b => stages.includes(b.stage)).reduce((sum, b) => sum + b.grams, 0);
  const inspected = lot.quality !== 'uninspected' || !!evidence?.inspections.length;
  // Where this batch is in its life, and the one step that moves it on.
  const steps: [string, boolean][] = [
    [t("Received"), lotMoves.some(m => m.action === 'receive') || at('raw', 'wip', 'finished', 'cops') > 0],
    [t("Inspected"), inspected],
    [lot.quality === 'hold' ? t("On QC hold") : t("QC approved"), lot.quality === 'approved'],
    [t("In production"), at('wip', 'finished', 'cops') > 0],
    [t("Finished"), at('finished', 'cops') > 0],
    [t("Dispatched"), lotMoves.some(m => m.action === 'dispatch')],
  ];
  const current = steps.findIndex(([, done]) => !done);
  // Stock arrives, and a batch becomes QC-approved, only when the supervisor decides an inspection report.
  const next: [string, string] = !steps[0][1] ? [t("Waiting for the first delivery"), t("Stock appears here when the supervisor accepts an inspection report.")]
    : !inspected ? [t("Waiting for inspection"), t("The quality inspector records the care label and a physical check. QC approval comes after.")]
    : lot.quality !== 'approved' ? [lot.quality === 'hold' ? t("On QC hold") : t("Waiting for QC approval"), t("The supervisor approves a batch by accepting its inspection report.")]
    : [t("Ready for dispatch"), t("Request and approve a sale dispatch from the Dispatch page.")];
  const notes = [...(evidence?.inspections || []).map(i => ({ id: i.id, at: i.created_at, kind: 'inspection' as const, i })), ...(evidence?.qualityEvents || []).map(e => ({ id: e.id, at: e.created_at, kind: 'quality' as const, e }))].sort((a, b) => b.at - a.at);
  return <><button className="button yf-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />{t("All stock")}</button><div className="live-detail-grid">
    <section className="live-panel yf-batch"><div className="live-panel-heading"><div className="yf-batch-title"><Cone hue={materialHue(state.products, lot.product_id)} size={44} /><div><h2>{yarnName(product?.name || t("Material"))}</h2><p>{product?.sku} {t("· Batch")} {lot.batch} · {lot.supplier || t("Supplier not recorded")} {t("· since")} {when.format(lot.created_at, language)}</p></div></div><QualityBadge value={lot.quality} /></div>
      <ol className="yf-steps" aria-label={t("Batch progress")}>{steps.map(([label, done], i) => <li key={label} className={done ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}><span>{done ? <Check size={14} aria-hidden="true" /> : i + 1}</span>{label}</li>)}</ol>
      <div className={`yf-next is-inline ${lot.quality}`}><span className="yf-next-icon"><ShieldCheck size={24} aria-hidden="true" /></span><div className="yf-next-text"><h3>{next[0]}</h3><p>{next[1]}</p></div></div>
      <h3 className="live-subheading">{t("Stock in this batch")}</h3>
      <StockFlow balances={lotBalances} compact />
      <h3 className="live-subheading">{t("Inspection notes")}</h3>
      {evidenceError && <p className="live-error" role="alert">{t("Batch history could not be refreshed.")} {evidenceError}<button className="live-text-button" onClick={() => setEvidenceRetry(value => value + 1)}>{t("Retry history")}</button></p>}
      {!evidence && !evidenceError && <p role="status" className="live-muted">{t("Loading this batch’s inspection history…")}</p>}
      {notes.length ? <ol className="yf-timeline">{notes.map(n => n.kind === 'inspection'
        ? <li key={n.id}><span className="yf-tnode"><ClipboardCheck size={18} aria-hidden="true" /></span><div><strong>{n.i.source === 'manual' ? t("Manual inspection") : t("TexPilot evidence (client supplied)")}</strong><span>{n.i.note}{n.i.label_text ? ` · Label: ${n.i.label_text}` : ''}</span><span>{n.i.actor_name}</span></div><div className="yf-side"><time>{when.format(n.at, language)}</time></div></li>
        : <li key={n.id}><span className="yf-tnode"><ShieldCheck size={18} aria-hidden="true" /></span><div><strong><QualityBadge value={n.e.status} /></strong><span>{n.e.note}</span><span>{n.e.actor_name}</span></div><div className="yf-side"><time>{when.format(n.at, language)}</time></div></li>)}</ol>
        : evidence && !evidenceError && <p className="live-muted">{t("No inspection notes yet. Record the label and physical checks before approving the batch.")}</p>}
      {evidence?.photos.map(photo => <figure className="live-inspection-photo" key={photo.id}><a href={`/api/photos/${photo.id}`} target="_blank" rel="noreferrer"><img src={`/api/photos/${photo.id}`} alt={`Inspection evidence for batch ${lot.batch}`} width={420} height={320} loading="lazy" /></a><figcaption>{photo.actor_name} · {timestamp(photo.created_at)}</figcaption></figure>)}
      {evidence?.nextOffset != null && <button className="button" onClick={() => void loadEvidence()} disabled={evidenceBusy}>{evidenceBusy ? t("Loading…") : t("Load older batch evidence")}</button>}
    </section>
    <section className="live-panel live-qr-panel"><div className="live-print-label"><Cone hue={materialHue(state.products, lot.product_id)} size={32} /><h2>yarnflow</h2><strong>{product?.name}</strong><p>{t("Batch")} {lot.batch} · {product?.sku}</p>{qr && <img src={qr} alt={`QR code for batch ${lot.batch}`} width={240} height={240} className="live-qr" />}<code>YF:{lot.id}</code></div>{qrError && <p role="alert" className="live-error">{qrError}</p>}<p>{t("Print this label and attach it to the batch. Any phone signed in to Yarnflow can scan it to open this batch.")}</p><button className="button" onClick={() => window.print()} disabled={!qr}><Printer size={18} />{t("Print batch label")}</button></section>
  </div></>;
}

export default function LiveApp() {
  const { t, language } = useLanguage();
  const menuDialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState(''); const [authNeeded, setAuthNeeded] = useState(true);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [route, setRoute] = useState(routeFromHash); const [selectedId, setSelectedId] = useState(lotFromHash);
  const [routeInfo, setRouteInfo] = useState(routeDetailsFromHash);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => aliases[location.hash.split('/')[1]]?.[1] ?? 'all');
  const [online, setOnline] = useState(navigator.onLine); const [savedAt, setSavedAt] = useState(0);
  const [notice, setNotice] = useState(''); const [scanTab, setScanTab] = useState('fabric');
  const [matches, setMatches] = useState<{ id: string; batch: string; name: string }[]>([]);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false); const [integration, setIntegration] = useState('');
  const [inbox, setInbox] = useState<Inbox>({ notifications: [], unread: 0 });
  const [history, setHistory] = useState<StockMovement[]>([]); const [moreHistory, setMoreHistory] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false); 
  const theme = 'light';
  const requestSequence = useRef(0);
  const sessionLocked = useRef(false);
  const logoutRequest = useRef<Promise<void> | null>(null);
  const signOut = useCallback((force = false, preserveRoute = false) => {
    if (sessionLocked.current && !force) return logoutRequest.current ?? Promise.resolve();
    // Lock before any network work: a pending refresh or a failed logout must never reopen stock.
    sessionLocked.current = true; requestSequence.current++;
    menuDialog.current?.close(); setState(null); setAuthNeeded(true); setLoading(false); setRefreshing(false);
    setError(''); setNotice(''); setHistory([]); setMoreHistory(true);
    setLastResult(null); setMatches([]); setQuery(''); setIntegration(''); setInbox({ notifications: [], unread: 0 });
    if (!preserveRoute) location.hash = '/dashboard';
    if (logoutRequest.current) return logoutRequest.current;
    setEndingSession(true);
    // Explicit sign-out invalidates the session shared by all tabs.
    const request = fetch('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000),
    }).then(() => {}).catch(() => { /* The local lock survives an offline or interrupted logout. */ }).finally(() => {
      if (logoutRequest.current === request) { logoutRequest.current = null; setEndingSession(false); }
    });
    logoutRequest.current = request;
    return request;
  }, []);
  const refresh = useCallback(async (quiet = false) => {
    if (sessionLocked.current) { setLoading(false); setRefreshing(false); return; }
    const sequence = ++requestSequence.current;
    if (!quiet) setRefreshing(true);
    try {
      const result = await api<WorkspaceState>('/workspace');
      if (sequence !== requestSequence.current || sessionLocked.current) return;
      setState(result); setAuthNeeded(false); setSavedAt(Date.now()); setError('');
      // The inbox rides the same refresh; a failed read keeps the last count rather than blocking the workspace.
      void portal<Inbox>('/notifications').then(next => { if (sequence === requestSequence.current && !sessionLocked.current) setInbox(next); }, () => {});
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if (error instanceof InventoryError && error.status === 401) { sessionLocked.current = true; setState(null); setAuthNeeded(true); }
      setError(errorMessage(error));
    } finally { if (sequence === requestSequence.current) { setLoading(false); setRefreshing(false); } }
  }, []);
  useEffect(() => { void refresh(); const interval = setInterval(() => { if (!document.hidden) void refresh(true); }, 10000); const focus = () => { if (!document.hidden) void refresh(true); }; window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); return () => { clearInterval(interval); requestSequence.current++; window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); }; }, [refresh]);
  useEffect(() => { const update = () => { menuDialog.current?.close(); const alias = aliases[location.hash.split('/')[1]]; if (alias) setView(alias[1]); setRoute(routeFromHash()); setRouteInfo(routeDetailsFromHash()); setSelectedId(lotFromHash()); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { const network = () => { setOnline(navigator.onLine); void refresh(true); }; window.addEventListener('online', network); window.addEventListener('offline', network); return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); }; }, [refresh]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('yf-theme', theme); } catch { /* The theme can remain in memory. */ } }, [theme]);
  // A form or reversal opens at its top, not wherever the page was scrolled to when it was asked for.
  // The white pill in both navs glides to the current tab (yarnflow.css reads --glide-*); segmented controls glide the same way.
  const shellReady = !loading && !!state?.member;
  useLayoutEffect(() => {
    const place = () => document.querySelectorAll<HTMLElement>('.live-sidebar nav, .live-bottom-nav, .live-segments').forEach(nav => {
      const tab = nav.querySelector<HTMLElement>('.active, button[aria-pressed="true"]');
      nav.style.setProperty('--glide-w', (tab?.offsetWidth || 0) + 'px'); nav.style.setProperty('--glide-h', (tab?.offsetHeight || 0) + 'px');
      if (tab) { nav.style.setProperty('--glide-x', tab.offsetLeft + 'px'); nav.style.setProperty('--glide-y', tab.offsetTop + 'px'); }
      requestAnimationFrame(() => { nav.dataset.glide = 'on'; });
    });
    // Re-measure whenever a nav changes size: the window, and the web font arriving after first paint.
    const watch = new ResizeObserver(place); document.querySelectorAll('.live-sidebar nav, .live-bottom-nav, .live-segments').forEach(n => watch.observe(n));
    place(); return () => watch.disconnect();
  }, [route, scanTab, shellReady]);
  function navigate(to: string, tabOrId = '', detailId = '', fromModule = true) { menuDialog.current?.close(); const alias = aliases[to]; if (alias) { to = alias[0]; setView(alias[1]); } else if (to === 'inventory' && !tabOrId) setView('all'); const tabbed = !!tabsOf[to]?.includes(tabOrId); const target = to.includes('/') ? to : [to, ...(tabbed ? [tabOrId, detailId] : [tabOrId])].filter(Boolean).map(encodeURIComponent).join('/'); const targetSection = target.split('/')[0]; const moduleSections: Record<string, string[]> = { purchase: ['dashboard', 'suppliers', 'rfqs', 'orders', 'claims', 'analytics'], sales: ['dashboard', 'buyers', 'buyer-rfqs', 'invoices', 'dispatch-requests', 'analytics'], dispatch: ['dashboard', 'dispatches', 'new-dispatch', 'history'], supervisor: ['dashboard', 'reviews', 'inventory', 'requests', 'report', 'activity'], quality: ['dashboard', 'lots', 'submissions'] }; const keepModule = fromModule && routeInfo.module && moduleSections[routeInfo.module]?.includes(targetSection); location.hash = keepModule ? '/modules/' + routeInfo.module + '/' + target : '/' + target; const next = routeDetailsFromHash(); setRoute(next.section); setRouteInfo(next); setSelectedId(tabbed ? detailId : to.includes('/') ? '' : tabOrId); setMatches([]); setQuery(''); setNotice(''); window.scrollTo(0, 0); }
  if (loading || endingSession) return <main className="live-loading" aria-busy="true"><Cone hue="#2f6fd6" size={48} /><h1>{endingSession ? t('Signing out…', 'سائن آؤٹ ہو رہا ہے…') : t("Opening inventory…")}</h1><p>{endingSession ? t('Your PIN is needed to open the workspace again.', 'ورک اسپیس دوبارہ کھولنے کے لیے پن درج کرنا ہوگا۔') : t("Loading inventory records.")}</p></main>;
  if (!state && authNeeded) return <SignIn onSignedIn={async () => {
    await logoutRequest.current;
    if (document.hidden) { await signOut(true); return; }
    sessionLocked.current = false; await refresh();
  }} />;
  if (!state) return <main className="live-welcome"><Cone hue="#2f6fd6" size={48} /><h1>{t("Inventory is unavailable")}</h1><p role="alert">{t(error)}</p><button className="button primary" onClick={() => void refresh()}><RefreshCw size={18} />{t("Try connection again")}</button><p>{t("The shared records are safe on the server.")}</p></main>;
  const workspace = state;
  const me = workspace.member;
  const canAddBatch = me.admin || me.role === 'supervisor';
  const shown = [...NAV[me.role], ...COMMON];
  const adminPage = me.role === 'admin' && route === 'history' ? 'movement-history' : route;
  const page = shown.some(section => section.id === adminPage) || (me.role === 'admin' && ['movement-history', 'inventory'].includes(adminPage)) ? adminPage : 'dashboard';
  // Owner screens render for their role at its own sections, and for an admin under #/modules/<module>/….
  const ownerRole: Role | '' = routeInfo.module ? ROLE_OF_MODULE[routeInfo.module] : (['purchase_manager', 'sales_manager', 'dispatch'] as Role[]).includes(me.role) && NAV[me.role].some(section => section.id === routeInfo.section) ? me.role : '';
  const ownerModule = !!ownerRole;
  const { tab: routeTab, id: routeItemId } = parseHash(location.hash, tabsOf);
  const reloadInbox = async () => { setInbox(await portal<Inbox>('/notifications')); };
  const selected = workspace.lots.find(l => l.id === selectedId);
  const productName = (lotId: string) => workspace.products.find(p => p.id === workspace.lots.find(l => l.id === lotId)?.product_id)?.name || t("Material");
  const batchName = (lotId: string) => workspace.lots.find(l => l.id === lotId)?.batch || lotId;
  const total = (stockStage?: StockStage) => workspace.balances.filter(b => !stockStage || b.stage === stockStage).reduce((sum, b) => sum + b.grams, 0);
  const inView = (lot: StockLot, v: View) => v === 'all' || (v === 'quality' ? lot.quality !== 'approved' : v === 'dispatch' ? lot.quality === 'approved' : workspace.balances.some(b => b.lot_id === lot.id && b.stage === 'wip' && b.grams > 0));
  const filtered = workspace.lots.filter(lot => [lot.batch, lot.supplier, productName(lot.id), workspace.products.find(p => p.id === lot.product_id)?.sku].join(' ').toLowerCase().includes(query.toLowerCase()) && inView(lot, view));
  const views: [View, string, typeof Boxes][] = [['all', t("All"), Boxes], ['quality', t("Needs QC"), ShieldAlert], ['production', t("In production"), Factory], ['dispatch', t("To dispatch"), Truck]];
  const lotGrams = (lotId: string) => workspace.balances.filter(b => b.lot_id === lotId).reduce((sum, b) => sum + b.grams, 0);
  // One list: each material with its batches under it (a material is what you buy; a batch is one delivery of it).
  function stockList() {
    const q = query.toLowerCase();
    const groups = workspace.products.map(p => ({ p, lots: filtered.filter(l => l.product_id === p.id) }))
      .filter(({ p, lots }) => lots.length || (view === 'all' && [p.name, p.sku, p.barcode].join(' ').toLowerCase().includes(q)));
    return <div className="yf-stock-groups">{groups.map(({ p, lots }) => <section className="yf-stock-group" key={p.id} aria-label={p.name}>
      <header><Cone hue={materialHue(workspace.products, p.id)} size={36} /><div><strong>{yarnName(p.name)}</strong><span>{p.sku}{p.barcode ? ' · ' + p.barcode : ''}</span></div><strong className="live-row-weight">{weight(workspace.lots.filter(l => l.product_id === p.id).reduce((sum, l) => sum + lotGrams(l.id), 0))} <small>kg</small></strong></header>
      {lots.map(lot => <button key={lot.id} className="live-lot-row" onClick={() => { navigate('inventory', lot.id); }}><span className="live-lot-name"><strong>{t("Batch")} {lot.batch}</strong><span>{lot.supplier || 'Supplier not recorded'}</span></span><QualityBadge value={lot.quality} /><strong className="live-row-weight">{weight(lotGrams(lot.id))} <small>kg</small></strong><ChevronRight size={20} aria-hidden="true" /></button>)}
      {!lots.length && <p className="yf-stock-empty">{canAddBatch ? 'No batches yet. Tap + to add one.' : 'No batches yet.'}</p>}
    </section>)}{!groups.length && <div className="live-empty"><h3>{workspace.products.length ? 'Nothing matches' : 'Start with your first material'}</h3><p>{workspace.products.length ? 'Try another name, batch or filter.' : 'Add a material (for example Cotton 30/1), then add its batches.'}</p></div>}</div>;
  }
  function activityList(movements: StockMovement[]) {
    const hueOf = (lotId: string) => materialHue(workspace.products, workspace.lots.find(l => l.id === lotId)?.product_id);
    const day = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' });
    const clock = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
    const today = day.format(Date.now()); const yesterday = day.format(Date.now() - 86400000);
    const days: [string, StockMovement[]][] = [];
    for (const m of movements) { const label = day.format(m.created_at); const last = days[days.length - 1]; if (last?.[0] === label) last[1].push(m); else days.push([label, [m]]); }
    return movements.length ? <ol className="yf-timeline live-history">{days.map(([label, items]) => [<li className="yf-day" key={label}><h3>{label === today ? 'Today' : label === yesterday ? 'Yesterday' : label}</h3></li>, ...items.map(m => { const Icon = moveIcon[m.action] || ArrowRight; return <li key={m.id}>
      <span className="yf-tnode"><Icon size={18} aria-hidden="true" /></span>
      <div><strong>{t(movedName[m.action] || m.action)} · <button className="live-text-button" onClick={() => { navigate('inventory', m.lot_id); }}>{yarnName(productName(m.lot_id))} · {batchName(m.lot_id)}</button></strong>
        <span><Cone hue={hueOf(m.lot_id)} size={14} />{m.from_stage ? t(stageName[m.from_stage]) : t('External')} → {m.to_stage ? t(stageName[m.to_stage]) : m.action === 'waste' ? t('Waste') : t('Dispatched')} · {m.cartons} {t("cartons ·")} {m.cones} {t("cones")}{m.note ? ` · ${m.note}` : ''}</span>
        <span>{t("Recorded by")} {m.actor_name}</span></div>
      <div className="yf-side"><span className="yf-kg">{weight(m.grams)} <small>kg</small></span><time dateTime={new Date(m.created_at).toISOString()}>{clock.format(m.created_at)}</time></div></li>; })])}</ol> : <div className="live-empty"><ClipboardList size={32} aria-hidden="true" /><h3>{t("No movements yet")}</h3><p>{t("Receive stock into a batch to start its audit history.")}</p></div>;
  }
  async function lookup(code: string) {
    const found = await api<{ lotId?: string; lots?: typeof matches }>('/lookup?code=' + encodeURIComponent(code));
    await refresh();
    if (found.lotId) { navigate('inventory', found.lotId); }
    else { setMatches(found.lots || []); setNotice('This product has several batches. Choose the batch printed on the goods.'); }
  }
  async function backup() {
    setExportBusy(true);
    try {
      let offset: number | null = 0; let output: Record<string, unknown> = {}; const movements: StockMovement[] = [];
      const inspections: WorkspaceState['inspections'] = []; const qualityEvents: WorkspaceState['qualityEvents'] = []; const photos: WorkspaceState['photos'] = [];
      while (offset !== null) { const page: WorkspaceState & { nextOffset: number | null } = await api('/export?offset=' + offset); output = page as unknown as Record<string, unknown>; movements.push(...page.movements); inspections.push(...page.inspections); qualityEvents.push(...page.qualityEvents); photos.push(...page.photos); offset = page.nextOffset; }
      saveFile('yarnflow-backup-' + new Date().toISOString().slice(0, 10) + '.json', { ...output, movements, inspections, qualityEvents, photos }); setNotice('Inventory backup downloaded.');
    } catch (error) { setError(errorMessage(error)); } finally { setExportBusy(false); }
  }
  const today = new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Karachi' }).format(Date.now());
  const current = shown.find(section => section.id === page) ?? sections.find(section => section.id === page);
  const pageTitle = selected ? t("Batch details") : page === 'movement-history' ? t('History','ہسٹری') : page === 'inventory' && me.role === 'admin' ? t('Stock','اسٹاک') : page === 'admin-activity' ? t('Activity','سرگرمیاں') : t(current?.en || 'Dashboard', current?.ur);
  // Counts that wait on the person: unread notifications, and sign-in requests for admins in Team.
  const badge = (id: string) => id === 'notifications' && inbox.unread > 0 ? <b className="yf-nav-count" aria-label={`, ${inbox.unread} ${t('unread', 'نہ پڑھی ہوئی')}`}>{inbox.unread}</b>
    : id === 'settings' && workspace.pending > 0 && me.role === 'admin' ? <b className="yf-nav-count" aria-label={`, ${workspace.pending} waiting`}>{workspace.pending}</b> : null;
  const brand = <a className="live-brand" href="#/dashboard"><Cone hue="#2f6fd6" size={30} />yarnflow</a>;
  const whoAmI = <div className="yf-me"><Avatar name={me.name} /><span><strong>{me.name}</strong><span>{t(...roleLabel[me.role])}</span></span><button className="live-icon-button" onClick={() => void signOut()} aria-label={`${t('Sign out')} ${me.name}`} title={t("Sign out")}><LogOut size={20} aria-hidden="true" /></button></div>;
  return <div className="live-app"><a className="skip-link" href="#live-main" onClick={event => { event.preventDefault(); document.getElementById('live-main')?.focus(); }}>{t("Skip to content")}</a>
    <aside className="live-sidebar">{brand}<div className="live-factory">{workspace.workspace.name}<span>{t("Shared by the whole team")}</span></div><nav aria-label={t("Main navigation")}>{shown.map(({ id, en, ur, icon: Icon }) => [id === COMMON[0].id && <span className="yf-nav-gap" key="gap" />, <button key={id} aria-current={page===id?'page':undefined} className={page===id?'active':''} onClick={()=>navigate(id, '', '', false)}><Icon size={19} aria-hidden="true" /><span>{t(en, ur)}</span>{badge(id)}</button>])}</nav>{whoAmI}</aside>
    <dialog className="yf-mobile-menu" ref={menuDialog} onClick={e=>{if(e.target===e.currentTarget)menuDialog.current?.close();}} aria-label={t("Navigation menu")}><div>{brand}<button className="live-icon-button" onClick={()=>menuDialog.current?.close()} aria-label={t("Close navigation")}><X aria-hidden="true" /></button></div><nav aria-label={t("All pages")}>{shown.map(({ id, en, ur, icon: Icon }) => <button key={id} aria-current={page===id?'page':undefined} onClick={()=>navigate(id, '', '', false)}><Icon size={22} aria-hidden="true" />{t(en, ur)}{badge(id)}</button>)}</nav>{whoAmI}</dialog>
    <div className="live-main-shell"><header className="live-topbar">{brand}{shown.some(section => section.id === 'inventory') && <button className="live-icon-button" aria-label={t("Find a batch")} onClick={()=>{navigate('inventory');setTimeout(()=>document.querySelector<HTMLInputElement>('input[type="search"]')?.focus(),0);}}><Search size={22} aria-hidden="true" /></button>}</header>
    <main id="live-main" key={`${route}:${selected?.id || ''}`} className="live-content" data-page={selected ? 'batch' : page} tabIndex={-1}>
      <div className="live-page-heading"><div><h1>{pageTitle}</h1><p hidden={!!selected}>{page === 'dashboard' && !selected ? `${workspace.workspace.name} · ${today}` : page === 'inventory' ? t("Your materials and their batches, from delivery to dispatch.") : page === 'scanner' ? t("Photograph a fabric, measure its yarn, or scan a stock label.") : page === 'activity' ? t("Every stock movement, oldest records kept.") : page === 'notifications' ? t('What needs your attention, newest first.', 'جن چیزوں پر توجہ چاہیے، تازہ ترین پہلے۔') : page === 'help' ? t("Answers to common questions.") : page === 'lots' ? t("Arrived lots waiting for you, and your inspection drafts.", "آپ کے منتظر آمد شدہ لاٹس اور معائنے کے مسودے۔") : page === 'team' ? t("Who can sign in, and what each person can record.") : page === 'procurement' ? t("Buying from suppliers: directory, bids, orders and incoming stock.", "سپلائرز سے خریداری: ڈائریکٹری، بولیاں، آرڈر اور آنے والا اسٹاک۔") : t("Your access, and the records everyone shares.")}</p></div></div>
      {error && <div className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{t(error)}<button className="live-text-button" onClick={() => void refresh()}>{t("Retry connection")}</button></div>}
      {!online && <div className="live-warning" role="status"><WifiOff size={18} />{t("You are offline. Entries can be saved again once the connection is back.")}</div>}
      {notice && <div className="live-success" role="status"><CheckCheck size={19} /><span>{t(notice)}</span><button aria-label={t("Dismiss message")} className="live-icon-button" onClick={() => setNotice('')}><X size={17} /></button></div>}
      {ownerModule ? (() => { const Screen = MODULES[ownerRole as Role]!; return <>{ownerRole === 'purchase_manager' && routeInfo.section === 'dashboard' && me.role === 'purchase_manager' && <Dashboard member={me} inbox={inbox} reload={reloadInbox} />}<Screen member={me} section={routeInfo.section} tab={routeInfo.tab} id={routeInfo.id} navigate={navigate} state={workspace} onInventoryChanged={() => refresh(true)} /></>; })() : selected ? <LotDetail key={selected.id} lot={selected} state={workspace} onBack={() => navigate('inventory')} /> : <>
      {page === 'dashboard' && (me.role === 'supervisor' ? <SupervisorScreens section="dashboard" member={me} state={workspace} /> : <Dashboard member={me} inbox={inbox} reload={reloadInbox} />)}
      {page === 'dashboard' && me.role === 'quality_inspector' && <QualityScreens member={me} section="dashboard" />}
      {page === 'notifications' && <Notifications member={me} inbox={inbox} reload={reloadInbox} />}
      {page === 'dispatch' && <DispatchPanel state={workspace} />}{page === 'inventory' && (me.role === 'supervisor' ? <SupervisorScreens section="inventory" member={me} state={workspace} /> : <section className="yf-stock-panel" aria-label={t("Stock")}><div className="yf-views" role="group" aria-label={t("Show")}>{views.map(([id, label, Icon]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}><Icon size={20} aria-hidden="true" /><span>{t(label)}</span><b>{workspace.lots.filter(l => inView(l, id)).length}</b></button>)}</div><Field className="live-search-label">{t("Search")}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Material, batch or supplier")} /></Field>{stockList()}</section>)}
      {page==='help' && <section className="live-panel yf-help"><h2>{t("Common questions")}</h2>{[[t("How do I receive stock?"),t("The purchase manager registers an arrival, the inspector inspects it, and the supervisor accepts the report. Only then does the stock appear in the batch.")],[t("How does quality approval work?"),t("Record the care label and physical inspection. A QC decision is required before dispatch; a scan result alone never approves a batch.")],[t("How do corrections work?"),t("The supervisor adjusts or writes off stock with a reason. Large changes wait for admin approval, the original entries stay visible and stock cannot become negative.")],[t("Where is my data stored?"),t("In one shared database. Everyone who signs in sees the same stock, and every entry records who made it.")],[t("Who can do what?"),t("Everyone can view stock and use the scanner. The supervisor records finished goods and adjusts stock; materials are added by the supervisor or purchase manager.")],[t("How do new people join?"),t("Ask an admin to create your account. The admin chooses your role in Settings › Users and gives you a PIN.")],[t("Forgot your PIN?"),t("Ask an admin to set a new one in Settings › Users. Five wrong PINs lock a name for five minutes.")],[t("Phone and computer"),t("Open the same link on any phone or computer and sign in with your name and PIN. On iPhone, Share then Add to Home Screen makes it open like an app.")],[t("Camera and privacy"),t("Camera access is requested when you start a scan. The TexPilot service must be connected for model analysis.")]].map(([q,a])=><details key={q}><summary>{t(q)}</summary><p>{t(a)}</p></details>)}</section>}
      {page === 'scanner' && <><div className="live-segments yf-scan-tabs" aria-label={t("What to scan")}><button aria-pressed={scanTab === 'fabric'} onClick={() => setScanTab('fabric')}><Camera size={22} aria-hidden="true" /><span>{t("Fabric")}</span></button><button aria-pressed={scanTab === 'spec'} onClick={() => setScanTab('spec')}><Ruler size={22} aria-hidden="true" /><span>{t("Yarn count")}</span></button><button aria-pressed={scanTab === 'barcode'} onClick={() => setScanTab('barcode')}><ScanBarcode size={22} aria-hidden="true" /><span>{t("Stock label")}</span></button></div>{scanTab === 'spec' ? <SpecScan /> : scanTab === 'barcode' ? <><BarcodeScanner onFound={lookup} />{!!matches.length && <section className="live-panel"><h2>{t("Choose the batch")}</h2>{matches.map(lot => <button className="live-match" key={lot.id} onClick={() => { navigate('inventory', lot.id); }}><span>{lot.name} · {lot.batch}</span><ArrowRight size={18} /></button>)}</section>}</> : <><Scanner t={t} onInventory={() => navigate('inventory')} onResult={setLastResult} onMeasure={() => { setScanTab('spec'); scrollTo({ top: 0, behavior: 'smooth' }); }} /></>}</>}
      {page === 'activity' && (me.role === 'supervisor' ? <SupervisorScreens section="history" member={me} state={workspace} /> : <section className="live-panel"><div className="live-panel-heading"><h2>{t("Stock movement register")}</h2><span>Asia/Karachi</span></div>{activityList([...workspace.movements, ...history.filter(h => !workspace.movements.some(m => m.id === h.id))])}{workspace.movements.length >= 100 && moreHistory && <button className="button" disabled={historyBusy} onClick={async () => { setHistoryBusy(true); try { const page = await api<{ movements: StockMovement[] }>('/movements?offset=' + (100 + history.length)); setHistory(previous => [...previous, ...page.movements]); setMoreHistory(page.movements.length === 100); } catch (error) { setError(errorMessage(error)); } finally { setHistoryBusy(false); } }}>{historyBusy ? t("Loading…") : t("Load earlier movements")}</button>}</section>)}
      {page === 'movement-history' && <section className="live-panel"><div className="live-panel-heading"><h2>{t("Stock movement register")}</h2><span>Asia/Karachi</span></div>{activityList([...workspace.movements, ...history.filter(h => !workspace.movements.some(m => m.id === h.id))])}{workspace.movements.length >= 100 && moreHistory && <button className="button" disabled={historyBusy} onClick={async () => { setHistoryBusy(true); try { const page = await api<{ movements: StockMovement[] }>('/movements?offset=' + (100 + history.length)); setHistory(previous => [...previous, ...page.movements]); setMoreHistory(page.movements.length === 100); } catch (error) { setError(errorMessage(error)); } finally { setHistoryBusy(false); } }}>{historyBusy ? t("Loading…") : t("Load earlier movements")}</button>}</section>}
      {page === 'profile' && <Profile state={workspace} backupBusy={exportBusy} onBackup={() => void backup()} />}
            {me.role === 'admin' && ['dashboard','approvals','claims','admin-activity','reports','analytics','settings','modules'].includes(page) && <AdminScreens member={me} section={page} tab={routeInfo.tab} id={routeInfo.id} navigate={navigate} state={workspace} onInventoryChanged={() => refresh(true)} />}
      {page==='lots' && <QualityScreens member={me} section="lots" />}
      {page==='submissions' && <QualityScreens member={me} section="submissions" />}
      {page==='reviews' && <Review member={me} tab={routeTab} itemId={routeItemId} />}
      {page==='requests' && me.role === 'supervisor' && <SupervisorScreens section="requests" member={me} state={workspace} tab={routeTab} itemId={routeItemId} />}
      {page==='report' && me.role === 'supervisor' && <SupervisorScreens section="report" member={me} state={workspace} />}

      </>}
    </main><footer className="live-sync" role="status"><CheckCheck size={17} aria-hidden="true"/><span>{t("All changes saved")}{savedAt ? ' · '+t('checked', 'چیک کیا')+' '+new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Karachi'}).format(savedAt) : ''}</span></footer></div>
    <nav className="live-bottom-nav" aria-label={t("Phone navigation")}>{[...NAV[me.role].slice(0, 3), COMMON[0]].map(({ id, en, ur, icon: Icon }) => <button key={id} aria-current={page===id?'page':undefined} className={page===id?'active':''} onClick={()=>navigate(id, '', '', false)}><Icon size={23} aria-hidden="true" /><span>{t(en, ur)}</span>{badge(id)}</button>)}<button onClick={()=>menuDialog.current?.showModal()} aria-label={workspace.pending > 0 ? `More pages, ${workspace.pending} waiting in Settings` : t("More pages")}><Menu size={23} aria-hidden="true" /><span>{t("More")}</span>{workspace.pending > 0 && <b className="yf-nav-count" aria-hidden="true">{workspace.pending}</b>}</button></nav>
  </div>;
}
