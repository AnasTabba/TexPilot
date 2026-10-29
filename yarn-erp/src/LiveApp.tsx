import { useLanguage } from './i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AsyncForm, Field, errorMessage } from './forms';
import { ArrowLeft, ArrowRight, Boxes, Camera, Check, CheckCheck, ClipboardList, Download, Factory, LoaderCircle, Plus, Printer, RefreshCw, Ruler, ScanLine, Settings2, ShieldCheck, WifiOff, X, CheckCircle2, TriangleAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { QualityBadge, StockFlow, movedName, when, yarnName } from './WorkspaceDashboard';
import { moveIcon } from './icons';
import { Dashboard, Notifications, type Inbox, type Notice } from './Notifications';
import { NoticeToast } from './NoticeToast';
import { ShipmentTracking } from './ShipmentTracking';
import Profile from './Profile';
import { portal } from './PortalCommon';
import { COMMON, NAV } from './roles';
import Inspections from './Inspections';
import InspectArrival, { type Arrival } from './InspectArrival';
import Review from './Review';
import { parseHash } from './routes.ts';
import SignIn, { Avatar } from './SignIn';
import Team, { permissionInfo } from './Team';
import Procurement from './Procurement';
import { Menu, Package, Truck, Search, ChevronRight, ShieldAlert, ArrowRightLeft, ClipboardCheck, ScanBarcode, LogOut } from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';
import Scanner from './Scanner';
import SpecScan from './SpecScan';
import { Cone, materialHue } from './Cone';
import type { ScanResult } from './scanner-client';
import { roleLabel, can, gramsFromKg, InventoryError, inventoryRequest as api, stageName, stockStages, timestamp, weight, type Permission, type Role, type StockLot, type StockMovement, type StockStage, type WorkspaceState } from './inventory-client';

type FormType = 'product' | 'finished' | 'dispatch' | 'adjust' | 'inspection';
type Action = { type: FormType; lotId?: string; productId?: string };
// Old pages that were filtered copies of the stock list (or of Home) now open Stock with that filter.
type View = 'all' | 'quality' | 'production' | 'dispatch';
const aliases: Record<string, [string, View]> = { materials: ['inventory', 'all'], production: ['inventory', 'production'], quality: ['inventory', 'quality'], dispatch: ['inventory', 'dispatch'], reports: ['dashboard', 'all'], overview: ['dashboard', 'all'], settings: ['profile', 'all'] };
const sections = [...new Set([...Object.values(NAV).flat(), ...COMMON])];
const tabsOf = Object.fromEntries(sections.flatMap(section => section.tabs ? [[section.id, section.tabs.map(tab => tab.id)]] : []));
const routeFromHash = () => {
  const { section } = parseHash(location.hash, tabsOf);
  return aliases[section]?.[0] ?? (sections.some(known => known.id === section) ? section : 'dashboard');
};
const lotFromHash = () => location.hash.startsWith('#/inventory/') ? location.hash.split('/')[2] || '' : '';
function saveFile(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function InventoryForm({ action, state, result, onSaved, onCancel }: { action: Action; state: WorkspaceState; result: ScanResult | null; onSaved: (message: string, lotId?: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useLanguage();
  const key = `yf-live-draft:${state.workspace.id}:${state.member.user_id}:${action.type}:${action.lotId || action.productId || ''}`;
  const initial = { id: crypto.randomUUID(), sku: '', name: '', barcode: '', productId: action.productId || state.products[0]?.id || '', batch: '', supplier: '', lotId: action.lotId || state.lots[0]?.id || '', stage: 'raw', toStage: 'wip', kg: '', cartons: '0', cones: '0', note: '', quality: 'approved', labelText: '', change: 'write_off', reason: '', intervention: '' };
  const [draft, setDraft] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); return saved && typeof saved === 'object' ? { ...initial, ...Object.fromEntries(Object.keys(initial).filter(k => typeof saved[k] === 'string').map(k => [k, saved[k]])) } as typeof initial : initial; }
    catch { return initial; }
  });
  const set = (field: keyof typeof draft, value: string) => setDraft(old => ({ ...old, [field]: value, id: crypto.randomUUID() }));
  const [draftError, setDraftError] = useState(false);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(draft)); setDraftError(false); } catch { setDraftError(true); } }, [draft, key]);
  const selected = state.lots.find(lot => lot.id === draft.lotId);
  // A lot created by the supervisor or a report decision holds one kind of stock; only raw and finished stock can be adjusted.
  const adjustStages: StockStage[] = selected?.inventory_type ? [selected.inventory_type] : ['raw', 'finished'];
  const stage = action.type === 'adjust' && !adjustStages.includes(draft.stage as StockStage) ? adjustStages[0] : draft.stage as StockStage;
  const available = state.balances.find(b => b.lot_id === draft.lotId && b.stage === stage);
  const stepIn = state.member.role === 'admin' ? { interventionReason: draft.intervention } : {};
  const titles: Record<FormType, string> = { product: t("Add a material"), finished: t("Add finished goods"), dispatch: t("Dispatch stock"), adjust: t("Adjust stock"), inspection: result ? t("Attach TexPilot evidence") : t("Record a manual inspection") };
  async function submit() {
    let lotId = draft.lotId, pending = false;
    const counted = () => { if (!/^\d+$/.test(draft.cartons) || !/^\d+$/.test(draft.cones)) throw new Error('Cartons and cones must be whole numbers.'); return { cartons: Number(draft.cartons), cones: Number(draft.cones) }; };
    if (action.type === 'product') await api('/products', { sku: draft.sku, name: draft.name, barcode: draft.barcode, ...stepIn });
    else if (action.type === 'finished') { lotId = (await api<{ lotId: string }>('/erp/stock/finished', { id: draft.id, productId: draft.productId, batch: draft.batch, grams: gramsFromKg(draft.kg), ...counted(), note: draft.note, ...stepIn })).lotId; }
    else if (action.type === 'adjust') {
      const grams = gramsFromKg(draft.kg);
      pending = !!(await api<{ pendingApproval?: boolean }>('/erp/stock/adjustments', { id: draft.id, lotId, stage, kind: draft.change === 'write_off' ? 'write_off' : 'adjustment', deltaGrams: draft.change === 'add' ? grams : -grams, reason: draft.reason, ...stepIn })).pendingApproval;
    }
    else if (action.type === 'inspection') {
      await api('/inspections', { id: draft.id, lotId, labelText: draft.labelText, note: draft.note, result });

    }
    else await api('/movements', { id: draft.id, lotId, action: 'dispatch', stage: draft.stage, grams: gramsFromKg(draft.kg), ...counted(), note: draft.note });
    try { localStorage.removeItem(key); } catch { /* Saved inventory is not affected by draft storage. */ }
    // A new material has no batch yet: stay on Stock instead of opening whichever batch the draft defaulted to.
    await onSaved(action.type === 'inspection' ? 'Inspection saved. QC approval is still required.' : pending ? 'Sent to the admin for approval. The stock changes only after they approve.' : 'Saved. Everyone on the team sees it now.', action.type === 'product' ? undefined : lotId);
  }
  const summary: [string, string][] = action.type === 'product'
    ? [[t("Material"), draft.name], [t("SKU"), draft.sku], [t("Barcode"), draft.barcode || t("Not recorded")]]
    : action.type === 'finished' ? [[t("Material"), state.products.find(p => p.id === draft.productId)?.name || ''], [t("Batch / dye lot"), draft.batch], [t("Weight"), `${draft.kg} kg`], [t("Cartons"), draft.cartons], [t("Cones"), draft.cones], [t("Notes"), draft.note || t("None")]]
    : action.type === 'adjust' ? [[t("Batch"), state.lots.find(l => l.id === draft.lotId)?.batch || ''], [t("Stage"), t(stageName[stage])], [t("Change"), `${draft.change === 'add' ? '+' : '−'}${draft.kg} kg`], [t("Reason"), draft.reason]]
    : [[t("Batch"), state.lots.find(l => l.id === draft.lotId)?.batch || ''],
      ...(action.type === 'inspection' ? [[t("Care label"), draft.labelText || t("Not recorded")]] : [[t("From stage"), t(stageName[draft.stage as StockStage])], [t("Weight"), `${draft.kg} kg`], [t("Cartons"), draft.cartons], [t("Cones"), draft.cones]]), [t("Notes"), draft.note || t("None")]] as [string, string][];
  return <AsyncForm title={titles[action.type]} detail={t("Review the entry, then save it for the whole team.")} submit={action.type === 'inspection' ? t("Save inspection") : t("Save entry")} onSubmit={submit} onCancel={onCancel} review={<dl>{summary.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>}>
    {draftError && <p className="live-error" role="alert">{t("This browser could not save the draft. Keep this form open until you finish.")}</p>}
    {action.type === 'product' && <><Field>{t("Material name")}<input value={draft.name} onChange={e => set('name', e.target.value)} minLength={2} maxLength={160} placeholder={t("e.g. Cotton combed 30/1")} required /></Field><Field>{t("SKU")}<input value={draft.sku} onChange={e => set('sku', e.target.value)} maxLength={80} autoCapitalize="characters" placeholder="e.g. COT-30" required /></Field><Field>{t("Product barcode (optional)")}<input value={draft.barcode} onChange={e => set('barcode', e.target.value)} maxLength={120} autoCapitalize="off" /></Field><p className="live-muted">{t("All weights use kg, stored as whole grams. Each batch gets its own printable QR label.")}</p></>}
    {action.type === 'finished' && <><Field>{t("Material")}<select value={draft.productId} onChange={e => set('productId', e.target.value)} required><option value="" disabled>{t("Choose a material")}</option>{state.products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></Field><Field>{t("Batch / dye lot")}<input value={draft.batch} onChange={e => set('batch', e.target.value)} maxLength={100} required /></Field><div className="live-fields"><Field>{t("Weight (kg)")}<input value={draft.kg} onChange={e => set('kg', e.target.value)} dir="ltr" inputMode="decimal" placeholder="0.000" required /></Field><Field>{t("Cartons")}<input value={draft.cartons} onChange={e => set('cartons', e.target.value)} dir="ltr" inputMode="numeric" pattern="[0-9]+" required /></Field><Field>{t("Cones")}<input value={draft.cones} onChange={e => set('cones', e.target.value)} dir="ltr" inputMode="numeric" pattern="[0-9]+" required /></Field></div><p className="live-muted">{t("Raw stock arrives when you accept an inspection report. Finished goods are recorded here.")}</p></>}
    {['dispatch', 'adjust', 'inspection'].includes(action.type) && <Field>{t("Batch")}<select value={draft.lotId} onChange={e => set('lotId', e.target.value)} required><option value="" disabled>{t("Choose a batch")}</option>{state.lots.map(l => <option key={l.id} value={l.id}>{l.batch} · {state.products.find(p => p.id === l.product_id)?.name}</option>)}</select></Field>}
    {action.type === 'adjust' && <><Field>{t("Stage")}<select value={stage} onChange={e => set('stage', e.target.value)}>{adjustStages.map(s => <option key={s} value={s}>{t(stageName[s])}</option>)}</select></Field><Field>{t("Change")}<select value={draft.change} onChange={e => set('change', e.target.value)}><option value="write_off">{t("Write off (remove stock)")}</option><option value="remove">{t("Correction: remove stock")}</option><option value="add">{t("Correction: add stock")}</option></select></Field>
      <div className="live-available">{t("Available:")} <strong>{weight(available?.grams || 0)} kg</strong></div>
      <Field>{t("Weight (kg)")}<input value={draft.kg} onChange={e => set('kg', e.target.value)} dir="ltr" inputMode="decimal" placeholder="0.000" required /></Field>
      <Field>{t("Reason")}<textarea value={draft.reason} onChange={e => set('reason', e.target.value)} minLength={5} maxLength={1000} rows={3} required placeholder={t("What happened to this stock?")} /></Field>
      <p className="live-muted">{t("Large changes wait for admin approval and take effect only once approved.")}</p></>}
    {action.type === 'dispatch' && <><Field>{t("From stage")}<select value={draft.stage} onChange={e => set('stage', e.target.value)}>{stockStages.map(s => <option key={s} value={s}>{t(stageName[s])}</option>)}</select></Field>
      <div className="live-available">{t("Available:")} <strong>{weight(available?.grams || 0)} kg</strong> · {available?.cartons || 0} {t("cartons ·")} {available?.cones || 0} {t("cones")}{selected && <QualityBadge value={selected.quality} />}</div>
      {selected?.quality !== 'approved' && <p className="live-warning"><TriangleAlert size={20} aria-hidden="true" />{t("This batch needs QC approval before it can be dispatched.")}</p>}
      <div className="live-fields"><Field>{t("Weight (kg)")}<input value={draft.kg} onChange={e => set('kg', e.target.value)} dir="ltr" inputMode="decimal" placeholder="0.000" required /></Field><Field>{t("Cartons")}<input value={draft.cartons} onChange={e => set('cartons', e.target.value)} dir="ltr" inputMode="numeric" pattern="[0-9]+" required /></Field><Field>{t("Cones")}<input value={draft.cones} onChange={e => set('cones', e.target.value)} dir="ltr" inputMode="numeric" pattern="[0-9]+" required /></Field></div>
    </>}
    {action.type === 'inspection' && <><Field>{t("Care-label text (optional)")}<textarea value={draft.labelText} onChange={e => set('labelText', e.target.value)} maxLength={4000} rows={3} placeholder={t("Record what the care label actually states.")} /></Field><p className="live-muted">{result ? `Attaches scan ${result.scan_id}, model ${result.model_version}, verdict ${result.verdict}. This client-supplied evidence does not automatically approve stock.` : t("Manual evidence only. This does not create an AI prediction or release a QC hold.")}</p></>}
    {state.member.role === 'admin' && ['product', 'finished', 'adjust'].includes(action.type) && <Field>{t("Why are you stepping in?")}<textarea value={draft.intervention} onChange={e => set('intervention', e.target.value)} minLength={5} maxLength={1000} rows={2} required placeholder={t("The reason an admin does this instead of the usual role")} /></Field>}
    {['dispatch', 'finished', 'inspection'].includes(action.type) && <Field>{t("Notes")}<textarea value={draft.note} onChange={e => set('note', e.target.value)} rows={3} maxLength={1000} minLength={action.type === 'inspection' ? 3 : undefined} required={action.type === 'inspection'} placeholder={action.type === 'dispatch' ? t("Customer, delivery reference, or order number") : t("What should the next operator know?")} /></Field>}
  </AsyncForm>;
}

function LotDetail({ lot, state, onAction, onBack }: { lot: StockLot; state: WorkspaceState; onAction: (action: Action) => void; onBack: () => void }) {
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
  const actions = { inspection: [t("Add inspection"), ClipboardCheck, 'inspect'], dispatch: [t("Dispatch"), Truck, 'dispatch'], adjust: [t("Adjust stock"), ArrowRightLeft, 'waste'] } as const;
  type Step = keyof typeof actions;
  // Inspectors inspect through the Inspections page, so the old inspection note is not offered to them.
  const closed: Partial<Record<Role, Step[]>> = { quality_inspector: ['inspection'] };
  const allowed = (type: Step) => can(state.member, actions[type][2] as Permission) && !closed[state.member.role]?.includes(type);
  // Stock arrives, and a batch becomes QC-approved, only when the supervisor decides an inspection report.
  const next: [string, string, Step | null] = !steps[0][1] ? [t("Waiting for the first delivery"), t("Stock appears here when the supervisor accepts an inspection report."), null]
    : !inspected ? [t("Inspect this batch"), t("Record the care label and a physical check. QC approval comes after."), 'inspection']
    : lot.quality !== 'approved' ? [lot.quality === 'hold' ? t("On QC hold") : t("Waiting for QC approval"), t("The supervisor approves a batch by accepting its inspection report."), null]
    : [t("Dispatch finished stock"), t("Send approved stock out with its delivery reference."), 'dispatch'];
  const NextIcon = next[2] ? actions[next[2]][1] : ShieldCheck;
  // Someone without the permission for the next step still sees it, with who can do it instead of a button.
  const nextAllowed = !!next[2] && allowed(next[2]);
  const permissionName = next[2] ? permissionInfo.find(([id]) => id === actions[next[2]!][2])![1] : '';
  const whoCan = next[2] ? t(`Someone with “${permissionName}” access records this step.`, `یہ کام “${t(permissionName)}” کی اجازت رکھنے والا ممبر درج کرے گا۔`) : '';
  const others = (Object.keys(actions) as Step[]).filter(type => type !== next[2] && allowed(type));
  const notes = [...(evidence?.inspections || []).map(i => ({ id: i.id, at: i.created_at, kind: 'inspection' as const, i })), ...(evidence?.qualityEvents || []).map(e => ({ id: e.id, at: e.created_at, kind: 'quality' as const, e }))].sort((a, b) => b.at - a.at);
  return <><button className="button yf-back" onClick={onBack}><ArrowLeft size={18} aria-hidden="true" />{t("All stock")}</button><div className="live-detail-grid">
    <section className="live-panel yf-batch"><div className="live-panel-heading"><div className="yf-batch-title"><Cone hue={materialHue(state.products, lot.product_id)} size={44} /><div><h2>{yarnName(product?.name || t("Material"))}</h2><p>{product?.sku} {t("· Batch")} {lot.batch} · {lot.supplier || t("Supplier not recorded")} {t("· since")} {when.format(lot.created_at, language)}</p></div></div><QualityBadge value={lot.quality} /></div>
      <ol className="yf-steps" aria-label={t("Batch progress")}>{steps.map(([label, done], i) => <li key={label} className={done ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}><span>{done ? <Check size={14} aria-hidden="true" /> : i + 1}</span>{label}</li>)}</ol>
      <div className={`yf-next is-inline ${lot.quality}`}><span className="yf-next-icon"><NextIcon size={24} aria-hidden="true" /></span><div className="yf-next-text"><h3>{next[0]}</h3><p>{nextAllowed || !next[2] ? next[1] : whoCan}</p></div>{nextAllowed && <div className="yf-next-actions"><button className="button primary" onClick={() => onAction({ type: next[2]!, lotId: lot.id })}>{actions[next[2]!][0]}<ArrowRight size={18} aria-hidden="true" /></button></div>}</div>
      <h3 className="live-subheading">{t("Stock in this batch")}</h3>
      <StockFlow balances={lotBalances} compact />
      {others.length > 0 && <div className="live-actions yf-other-actions" aria-label={t("Other actions")}>{others.map(type => { const [label, Icon] = actions[type]; const blocked = type === 'dispatch' && lot.quality !== 'approved'; return <button className="button" key={type} onClick={() => onAction({ type, lotId: lot.id })} disabled={blocked} title={blocked ? t("Approve quality first") : undefined}><Icon size={18} aria-hidden="true" />{label}</button>; })}</div>}
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
  const [action, setAction] = useState<Action | null>(null); const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => aliases[location.hash.split('/')[1]]?.[1] ?? 'all');
  const [online, setOnline] = useState(navigator.onLine); const [savedAt, setSavedAt] = useState(0);
  const [notice, setNotice] = useState(''); const [scanTab, setScanTab] = useState('fabric');
  const [inspecting, setInspecting] = useState<Arrival | null>(null);
  const [matches, setMatches] = useState<{ id: string; batch: string; name: string }[]>([]);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [exportBusy, setExportBusy] = useState(false); const [integration, setIntegration] = useState('');
  const [inbox, setInbox] = useState<Inbox>({ notifications: [], unread: 0 });
  const [toast, setToast] = useState<Notice | null>(null); const inboxSeen = useRef<number | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
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
    setError(''); setNotice(''); setAction(null); setHistory([]); setMoreHistory(true);
    setLastResult(null); setMatches([]); setQuery(''); setIntegration(''); setInbox({ notifications: [], unread: 0 }); inboxSeen.current = null; setToast(null);
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
  // Other people's changes raise notices: poll the inbox lightly, toast when unread rises, and refresh the workspace so the new data shows. Skipped while hidden or signed out.
  useEffect(() => {
    const check = () => {
      if (document.hidden || sessionLocked.current) return;
      const sequence = requestSequence.current;
      void portal<Inbox>('/notifications').then(next => {
        if (sequence !== requestSequence.current || sessionLocked.current) return;
        const previous = inboxSeen.current; inboxSeen.current = next.unread; setInbox(next);
        if (previous !== null && next.unread > previous) { setToast(next.notifications.find(n => n.status === 'unread') ?? null); void refresh(true); }
      }, () => { /* A failed poll keeps the last inbox; the next tick retries. */ });
    };
    const interval = setInterval(check, 20000);
    const wake = () => { if (!document.hidden) check(); };
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(interval); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); };
  }, [refresh]);
  useEffect(() => { const update = () => { menuDialog.current?.close(); const alias = aliases[location.hash.split('/')[1]]; if (alias) setView(alias[1]); setRoute(routeFromHash()); setSelectedId(lotFromHash()); setAction(null); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { const network = () => { setOnline(navigator.onLine); void refresh(true); }; window.addEventListener('online', network); window.addEventListener('offline', network); return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); }; }, [refresh]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('yf-theme', theme); } catch { /* The theme can remain in memory. */ } }, [theme]);
  // A form or reversal opens at its top, not wherever the page was scrolled to when it was asked for.
  useLayoutEffect(() => { if (action) window.scrollTo(0, 0); }, [action]);
  // The white pill in both navs glides to the current tab (yarnflow.css reads --glide-*); segmented controls glide the same way.
  useLayoutEffect(() => {
    // Re-measure whenever a nav changes size: the window, and the web font arriving after first paint.
    const watch = new ResizeObserver(() => place());
    const place = () => document.querySelectorAll<HTMLElement>('.live-sidebar nav, .live-bottom-nav, .live-segments').forEach(nav => {
      watch.observe(nav);
      const tab = nav.querySelector<HTMLElement>('.active, button[aria-pressed="true"]');
      nav.style.setProperty('--glide-w', (tab?.offsetWidth || 0) + 'px'); nav.style.setProperty('--glide-h', (tab?.offsetHeight || 0) + 'px');
      if (tab) { nav.style.setProperty('--glide-x', tab.offsetLeft + 'px'); nav.style.setProperty('--glide-y', tab.offsetTop + 'px'); }
      requestAnimationFrame(() => { nav.dataset.glide = 'on'; });
    });
    // Tabs inside a page (Procurement, Sales, the portals) switch without a route change, and segmented controls mount after this runs: follow those too.
    const flips = new MutationObserver(place); flips.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'class'] });
    place(); return () => { watch.disconnect(); flips.disconnect(); };
  }, []);
  function navigate(to: string, lotId = '') { menuDialog.current?.close(); const alias = aliases[to]; if (alias) { to = alias[0]; setView(alias[1]); } else if (to === 'inventory' && !lotId) setView('all'); location.hash = '/' + to + (lotId ? '/' + lotId : ''); setRoute(to); setSelectedId(lotId); setAction(null); setMatches([]); setQuery(''); setNotice(''); window.scrollTo(0, 0); }
  async function saved(message: string, lotId?: string) { setAction(null); if (lotId) navigate('inventory', lotId); setNotice(message); await refresh(); }
  if (loading || endingSession) return <main className="live-loading" aria-busy="true"><Cone hue="#2f6fd6" size={48} /><h1>{endingSession ? t('Signing out…', 'سائن آؤٹ ہو رہا ہے…') : t("Opening inventory…")}</h1><p>{endingSession ? t('Your PIN is needed to open the workspace again.', 'ورک اسپیس دوبارہ کھولنے کے لیے پن درج کرنا ہوگا۔') : t("Loading inventory records.")}</p></main>;
  if (!state && authNeeded) return <SignIn onSignedIn={async () => {
    await logoutRequest.current;
    if (document.hidden) { await signOut(true); return; }
    sessionLocked.current = false; await refresh();
  }} />;
  if (!state) return <main className="live-welcome"><Cone hue="#2f6fd6" size={48} /><h1>{t("Inventory is unavailable")}</h1><p role="alert">{t(error)}</p><button className="button primary" onClick={() => void refresh()}><RefreshCw size={18} />{t("Try connection again")}</button><p>{t("The shared records are safe on the server.")}</p></main>;
  const workspace = state;
  const me = workspace.member;
  const allow = (permission: Permission) => can(me, permission);
  const shown = [...NAV[me.role], ...COMMON];
  const page = shown.some(section => section.id === route) ? route : 'dashboard';
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
    const arrivals = view === 'all' || view === 'quality' ? (workspace.qcArrivals ?? []).filter(a => [a.reference, a.supplier_name].join(' ').toLowerCase().includes(q)) : [];
    const groups = workspace.products.map(p => ({ p, lots: filtered.filter(l => l.product_id === p.id), waiting: arrivals.filter(a => a.product_id === p.id) }))
      .filter(({ p, lots, waiting }) => lots.length || waiting.length || (view === 'all' && [p.name, p.sku, p.barcode].join(' ').toLowerCase().includes(q)));
    return <div className="yf-stock-groups">{groups.map(({ p, lots, waiting }) => <section className="yf-stock-group" key={p.id} aria-label={p.name}>
      <header><Cone hue={materialHue(workspace.products, p.id)} size={36} /><div><strong>{yarnName(p.name)}</strong><span>{p.sku}{p.barcode ? ' · ' + p.barcode : ''}</span></div><strong className="live-row-weight">{weight(lots.reduce((sum, l) => sum + lotGrams(l.id), 0) + waiting.reduce((sum, a) => sum + a.open_milli * (a.unit === 'tonne' ? 1000 : 1), 0))} <small>kg</small></strong></header>
      {lots.map(lot => <button key={lot.id} className="live-lot-row" onClick={() => { navigate('inventory', lot.id); }}><span className="live-lot-name"><strong>{t("Batch")} {lot.batch}</strong><span>{lot.supplier || 'Supplier not recorded'}</span></span><QualityBadge value={lot.quality} /><strong className="live-row-weight">{weight(lotGrams(lot.id))} <small>kg</small></strong><ChevronRight size={20} aria-hidden="true" /></button>)}
      {waiting.map(a => <button key={a.id} className="live-lot-row" onClick={() => { if (me.role === 'quality_inspector' || me.role === 'admin') setInspecting(a); else location.hash = '#/procurement'; }}><span className="live-lot-name"><strong>{t("Arrival")} {a.reference}</strong><span>{a.supplier_name} · {t("Awaiting inspection", "معائنے کا منتظر")}</span></span><QualityBadge value="uninspected" /><strong className="live-row-weight">{weight(a.open_milli * (a.unit === 'tonne' ? 1000 : 1))} <small>kg</small></strong><ChevronRight size={20} aria-hidden="true" /></button>)}
      {!lots.length && !waiting.length && <p className="yf-stock-empty">{t('No batches yet.')}</p>}
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
  const current = shown.find(section => section.id === page);
  const pageTitle = action ? t("Stock entry") : selected ? t("Batch details") : t(current?.en || 'Dashboard', current?.ur);
  // Counts that wait on the person: unread notifications, and sign-in requests for admins in Team.
  const badge = (id: string) => id === 'notifications' && inbox.unread > 0 ? <b className="yf-nav-count" aria-label={`, ${inbox.unread} ${t('unread', 'نہ پڑھی ہوئی')}`}>{inbox.unread}</b>
    : id === 'team' && workspace.pending > 0 ? <b className="yf-nav-count" aria-label={`, ${workspace.pending} waiting`}>{workspace.pending}</b> : null;
  const brand = <a className="live-brand" href="#/dashboard"><Cone hue="#2f6fd6" size={30} />yarnflow</a>;
  const whoAmI = <div className="yf-me"><Avatar name={me.name} /><span><strong>{me.name}</strong><span>{t(...roleLabel[me.role])}</span></span><button className="live-icon-button" onClick={() => void signOut()} aria-label={`${t('Sign out')} ${me.name}`} title={t("Sign out")}><LogOut size={20} aria-hidden="true" /></button></div>;
  return <div className="live-app"><a className="skip-link" href="#live-main" onClick={event => { event.preventDefault(); document.getElementById('live-main')?.focus(); }}>{t("Skip to content")}</a>
    <aside className="live-sidebar">{brand}<div className="live-factory">{workspace.workspace.name}<span>{t("Shared by the whole team")}</span></div><nav aria-label={t("Main navigation")}>{shown.map(({ id, en, ur, icon: Icon }) => [id === COMMON[0].id && <span className="yf-nav-gap" key="gap" />, <button key={id} aria-current={page===id?'page':undefined} className={page===id?'active':''} onClick={()=>navigate(id)}><Icon size={19} aria-hidden="true" /><span>{t(en, ur)}</span>{badge(id)}</button>])}</nav>{whoAmI}</aside>
    {inspecting && <InspectArrival arrival={inspecting} isAdmin={me.role === 'admin'} onClose={() => setInspecting(null)} onDone={async message => { setInspecting(null); setNotice(message); await refresh(true); }} />}
    <dialog className="yf-mobile-menu" ref={menuDialog} onClick={e=>{if(e.target===e.currentTarget)menuDialog.current?.close();}} aria-label={t("Navigation menu")}><div>{brand}<button className="live-icon-button" onClick={()=>menuDialog.current?.close()} aria-label={t("Close navigation")}><X aria-hidden="true" /></button></div><nav aria-label={t("All pages")}>{shown.map(({ id, en, ur, icon: Icon }) => <button key={id} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={22} aria-hidden="true" />{t(en, ur)}{badge(id)}</button>)}</nav>{whoAmI}</dialog>
    <div className="live-main-shell"><header className="live-topbar">{brand}{shown.some(section => section.id === 'inventory') && <button className="live-icon-button" aria-label={t("Find a batch")} onClick={()=>{navigate('inventory');setTimeout(()=>document.querySelector<HTMLInputElement>('input[type="search"]')?.focus(),0);}}><Search size={22} aria-hidden="true" /></button>}</header>
    <main id="live-main" key={`${route}:${selected?.id || ''}:${action?.type || ''}`} className="live-content" data-page={action ? 'form' : selected ? 'batch' : page} tabIndex={-1}>
      <div className="live-page-heading"><div><h1>{pageTitle}</h1><p hidden={!!(action || selected)}>{page === 'dashboard' && !action && !selected ? `${workspace.workspace.name} · ${today}` : page === 'inventory' ? t("Your materials and their batches, from delivery to dispatch.") : page === 'scanner' ? t("Photograph a fabric, measure its yarn, or scan a stock label.") : page === 'activity' ? t("Every stock movement, oldest records kept.") : page === 'notifications' ? t('What needs your attention, newest first.', 'جن چیزوں پر توجہ چاہیے، تازہ ترین پہلے۔') : page === 'help' ? t("Answers to common questions.") : page === 'lots' ? t("Arrived lots waiting for you, and your inspection drafts.", "آپ کے منتظر آمد شدہ لاٹس اور معائنے کے مسودے۔") : page === 'team' ? t("Who can sign in, and what each person can record.") : page === 'procurement' ? t("Buying from suppliers: directory, bids, orders and incoming stock.", "سپلائرز سے خریداری: ڈائریکٹری، بولیاں، آرڈر اور آنے والا اسٹاک۔") : t("Your access, and the records everyone shares.")}</p></div>{!action && !selected && page === 'inventory' && (allow('catalog') || me.role === 'purchase_manager') && <div className="live-actions"><button className="button" onClick={() => setAction({ type: 'product' })}><Package size={18} aria-hidden="true" />{t("New material")}</button>{workspace.products.length > 0 && allow('catalog') && <button className="button primary" onClick={() => setAction({ type: 'finished' })}><Plus size={18} aria-hidden="true" />{t("Finished goods")}</button>}</div>}</div>
      {error && <div className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{t(error)}<button className="live-text-button" onClick={() => void refresh()}>{t("Retry connection")}</button></div>}
      {!online && <div className="live-warning" role="status"><WifiOff size={18} />{t("You are offline. Entries can be saved again once the connection is back.")}</div>}
      {notice && <div className="live-success" role="status"><CheckCheck size={19} /><span>{t(notice)}</span><button aria-label={t("Dismiss message")} className="live-icon-button" onClick={() => setNotice('')}><X size={17} /></button></div>}
      {action ? <InventoryForm key={`${action.type}:${action.lotId || ''}`} action={action} state={workspace} result={action.type === 'inspection' ? lastResult : null} onSaved={saved} onCancel={() => setAction(null)} /> : selected ? <LotDetail key={selected.id} lot={selected} state={workspace} onAction={setAction} onBack={() => navigate('inventory')} /> : <>
      {page === 'dashboard' && <Dashboard member={me} inbox={inbox} reload={reloadInbox} state={state} />}
      {page === 'notifications' && <Notifications member={me} inbox={inbox} reload={reloadInbox} />}
      {page === 'inventory' && <section className="yf-stock-panel" aria-label={t("Stock")}><div className="yf-views" role="group" aria-label={t("Show")}>{views.map(([id, label, Icon]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}><Icon size={20} aria-hidden="true" /><span>{t(label)}</span><b>{workspace.lots.filter(l => inView(l, id)).length + (id === 'all' || id === 'quality' ? workspace.qcArrivals?.length ?? 0 : 0)}</b></button>)}</div><Field className="live-search-label">{t("Search")}<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t("Material, batch or supplier")} /></Field>{stockList()}</section>}
      {page==='help' && <section className="live-panel yf-help"><h2>{t("Common questions")}</h2>{[[t("How do I receive stock?"),t("The purchase manager registers an arrival, the inspector inspects it, and the supervisor accepts the report. Only then does the stock appear in the batch.")],[t("How does quality approval work?"),t("Record the care label and physical inspection. A QC decision is required before dispatch; a scan result alone never approves a batch.")],[t("How do corrections work?"),t("The supervisor adjusts or writes off stock with a reason. Large changes wait for admin approval, the original entries stay visible and stock cannot become negative.")],[t("Where is my data stored?"),t("In one shared database. Everyone who signs in sees the same stock, and every entry records who made it.")],[t("Who can do what?"),t("Everyone can view stock and use the scanner. The supervisor records finished goods and adjusts stock; materials are added by the supervisor or purchase manager.")],[t("How do new people join?"),t("Ask an admin to create your account. The admin chooses your role in Team and gives you your PIN.")],[t("Forgot your PIN?"),t("Ask an admin to set a new one in Team. Five wrong PINs lock a name for five minutes.")],[t("Phone and computer"),t("Open the same link on any phone or computer and sign in with your name and PIN. On iPhone, Share then Add to Home Screen makes it open like an app.")],[t("Camera and privacy"),t("Camera access is requested when you start a scan. The TexPilot service must be connected for model analysis.")]].map(([q,a])=><details key={q}><summary>{t(q)}</summary><p>{t(a)}</p></details>)}</section>}
      {page === 'scanner' && <><div className="live-segments yf-scan-tabs" aria-label={t("What to scan")}><button aria-pressed={scanTab === 'fabric'} onClick={() => setScanTab('fabric')}><Camera size={22} aria-hidden="true" /><span>{t("Fabric")}</span></button><button aria-pressed={scanTab === 'spec'} onClick={() => setScanTab('spec')}><Ruler size={22} aria-hidden="true" /><span>{t("Yarn count")}</span></button><button aria-pressed={scanTab === 'barcode'} onClick={() => setScanTab('barcode')}><ScanBarcode size={22} aria-hidden="true" /><span>{t("Stock label")}</span></button></div>{scanTab === 'spec' ? <SpecScan /> : scanTab === 'barcode' ? <><BarcodeScanner onFound={lookup} />{!!matches.length && <section className="live-panel"><h2>{t("Choose the batch")}</h2>{matches.map(lot => <button className="live-match" key={lot.id} onClick={() => { navigate('inventory', lot.id); }}><span>{lot.name} · {lot.batch}</span><ArrowRight size={18} /></button>)}</section>}</> : <><Scanner t={t} onInventory={() => navigate('inventory')} onResult={setLastResult} onMeasure={() => { setScanTab('spec'); scrollTo({ top: 0, behavior: 'smooth' }); }} />{lastResult && me.role !== 'quality_inspector' && <section className="live-panel"><h2>{t("Save this scan to a batch")}</h2><p>{t("Keeps the result in the batch's QC history. It does not approve the batch by itself.")}</p>{allow('inspect') ? <><button className="button primary" disabled={!workspace.lots.length} onClick={() => setAction({ type: 'inspection' })}><ClipboardCheck size={18} aria-hidden="true" />{t("Save to a batch")}</button>{!workspace.lots.length && <p>{t("Add a batch in Stock first.")}</p>}</> : <p className="live-muted">{t("Someone with “Inspections” access can save scans to a batch.")}</p>}</section>}</>}</>}
      {page === 'activity' && <section className="live-panel"><div className="live-panel-heading"><h2>{t("Stock movement register")}</h2><span>Asia/Karachi</span></div>{activityList([...workspace.movements, ...history.filter(h => !workspace.movements.some(m => m.id === h.id))])}{workspace.movements.length >= 100 && moreHistory && <button className="button" disabled={historyBusy} onClick={async () => { setHistoryBusy(true); try { const page = await api<{ movements: StockMovement[] }>('/movements?offset=' + (100 + history.length)); setHistory(previous => [...previous, ...page.movements]); setMoreHistory(page.movements.length === 100); } catch (error) { setError(errorMessage(error)); } finally { setHistoryBusy(false); } }}>{historyBusy ? t("Loading…") : t("Load earlier movements")}</button>}</section>}
      {page === 'profile' && <Profile state={workspace} backupBusy={exportBusy} onBackup={() => void backup()} />}
      {page==='team' && <Team me={me} onChanged={() => refresh(true)} />}
      {page==='lots' && <Inspections />}
      {page==='reviews' && <Review />}
      {page==='procurement' && <Procurement member={me} onInventoryChanged={() => refresh(true)} />}
      {page==='tracking' && <ShipmentTracking />}

      </>}
    </main><footer className="live-sync" role="status"><CheckCheck size={17} aria-hidden="true"/><span>{t("All changes saved")}{savedAt ? ' · '+t('checked', 'چیک کیا')+' '+new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Karachi'}).format(savedAt) : ''}</span></footer></div>
    <nav className="live-bottom-nav" aria-label={t("Phone navigation")}>{[...NAV[me.role].slice(0, 3), COMMON[0]].map(({ id, en, ur, icon: Icon }) => <button key={id} aria-current={page===id?'page':undefined} className={page===id?'active':''} onClick={()=>navigate(id)}><Icon size={23} aria-hidden="true" /><span>{t(en, ur)}</span>{badge(id)}</button>)}<button onClick={()=>menuDialog.current?.showModal()} aria-label={workspace.pending > 0 ? `More pages, ${workspace.pending} waiting in Team` : t("More pages")}><Menu size={23} aria-hidden="true" /><span>{t("More")}</span>{workspace.pending > 0 && <b className="yf-nav-count" aria-hidden="true">{workspace.pending}</b>}</button></nav>
  <NoticeToast notice={toast} onDismiss={dismissToast} />
  </div>;
}
