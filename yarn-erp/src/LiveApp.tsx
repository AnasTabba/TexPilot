import { useCallback, useEffect, useLayoutEffect, useRef, useState, useId, Children, cloneElement, isValidElement, type ReactElement, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Boxes, Camera, CheckCheck, ClipboardList, Download, Factory, LoaderCircle, Plus, Printer, RefreshCw, Ruler, ScanLine, Settings2, ShieldCheck, WifiOff, X, CheckCircle2, TriangleAlert } from 'lucide-react';
import QRCode from 'qrcode';
import WorkspaceDashboard from './WorkspaceDashboard';
import { resetLocalInventory, restoreLocalInventory } from './local-inventory';
import { Menu, Package, Truck, CircleHelp, Search, ChevronRight, PanelLeftClose, Sun, ShieldAlert, PackagePlus, ArrowRightLeft, Trash2, ClipboardCheck, ScanBarcode, House, History } from 'lucide-react';
import BarcodeScanner from './BarcodeScanner';
import Scanner from './Scanner';
import { artwork } from './FabricHero';
import SpecScan from './SpecScan';
import type { ScanResult } from './scanner-client';
import { gramsFromKg, InventoryError, inventoryRequest as api, qualityName, stageName, stockStages, timestamp, weight, type Quality, type StockLot, type StockMovement, type StockStage, type Unjoined, type WorkspaceState } from './inventory-client';

type FormType = 'product' | 'lot' | 'receive' | 'dispatch' | 'transfer' | 'waste' | 'quality' | 'inspection';
type Action = { type: FormType; lotId?: string; productId?: string };
const tabs = [
  ['overview', 'Home', House], ['inventory', 'Stock', Boxes], ['scanner', 'Scan', ScanLine],
  ['activity', 'History', History], ['settings', 'Settings', Settings2], ['help', 'Help', CircleHelp],
] as const;
// Old pages that were filtered copies of the stock list (or of Home) now open Stock with that filter.
type View = 'all' | 'quality' | 'production' | 'dispatch';
const aliases: Record<string, [string, View]> = { materials: ['inventory', 'all'], production: ['inventory', 'production'], quality: ['inventory', 'quality'], dispatch: ['inventory', 'dispatch'], reports: ['overview', 'all'] };
const routeFromHash = () => {
  const route = location.hash.split('/')[1];
  return aliases[route]?.[0] ?? (tabs.some(([id]) => id === route) ? route : 'overview');
};
const lotFromHash = () => location.hash.startsWith('#/inventory/') ? location.hash.split('/')[2] || '' : '';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'This could not be saved. Try again.';
function saveFile(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function QualityBadge({ value }: { value: Quality }) {
  const Icon = value === 'approved' ? CheckCircle2 : value === 'hold' ? TriangleAlert : ClipboardList;
  return <span className={`live-quality ${value}`}><Icon size={18} aria-hidden="true" />{qualityName[value]}</span>;
}
function Field({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [error, setError] = useState('');
  const controlId = useId(); const errorId = useId();
  const nodes = Children.toArray(children);
  const label = nodes.filter(child => typeof child === 'string' || typeof child === 'number');
  function validate(target: EventTarget) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
    setError(target.validity.valid ? '' : target.validationMessage);
  }
  return <div className={`live-field ${className}`} onBlur={e => validate(e.target)} onInvalid={e => validate(e.target)} onChange={e => { if (error) validate(e.target); }}>
    <label htmlFor={controlId}>{label}</label>
    {nodes.filter(isValidElement).map(child => cloneElement(child as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, { id: controlId, 'aria-describedby': error ? errorId : undefined, 'aria-invalid': !!error }))}
    {error && <span id={errorId} className="live-field-error"><TriangleAlert size={18} aria-hidden="true" />{error}</span>}
  </div>;
}

function AsyncForm({ title, detail, children, submit, onSubmit, onCancel, review }: { title: string; detail?: string; children: ReactNode; submit: string; onSubmit: () => Promise<void>; onCancel?: () => void; review?: ReactNode }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [reviewing, setReviewing] = useState(false);
  const form = useRef<HTMLFormElement>(null); const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (matchMedia('(pointer: fine)').matches) form.current?.querySelector<HTMLInputElement>('input,select,textarea')?.focus(); }, []);
  useEffect(() => { if (reviewing) heading.current?.focus(); }, [reviewing]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (review && !reviewing) { setReviewing(true); setError(''); return; }
    setBusy(true); setError('');
    try { await onSubmit(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <form className="live-panel live-form" ref={form} onSubmit={save} aria-label={title}>
    <div className="live-panel-heading"><div><h2 ref={heading} tabIndex={-1}>{reviewing ? 'Review before saving' : title}</h2>{detail && !reviewing && <p>{detail}</p>}</div>{onCancel && <button className="live-icon-button" type="button" onClick={onCancel} disabled={busy} aria-label="Close form"><X aria-hidden="true" /></button>}</div>
    <fieldset disabled={busy} hidden={reviewing}>{children}</fieldset>
    {reviewing && <section className="live-review" aria-label="Entry summary"><h3>{title}</h3>{review}<p>Check these register values. Stock changes only after you save.</p></section>}
    {error && <p className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{error}</p>}
    <div className="live-actions"><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="live-spinning" size={20} aria-hidden="true" /> : <CheckCheck size={20} aria-hidden="true" />}{busy ? 'Saving…' : review && !reviewing ? 'Review entry' : submit}</button>{reviewing && <button className="button" type="button" disabled={busy} onClick={() => { setReviewing(false); setError(''); }}>Edit entry</button>}{onCancel && <button className="button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>}</div>
    <p className="live-form-note">{reviewing ? 'Review the entry before saving it.' : review ? 'Review the entry before saving it.' : 'Saved on this device when confirmed.'}</p>
  </form>;
}

function Welcome({ user, onJoined }: { user: string; onJoined: () => Promise<void> }) {
  const invite = location.hash.startsWith('#/join/') ? location.hash.slice(7) : '';
  const [mode, setMode] = useState(invite ? 'join' : 'create');
  const [name, setName] = useState(''); const [code, setCode] = useState(invite);
  return <main className="live-welcome"><img src="/brand/logo.png" alt="" width="58" height="58" /><h1>Set up your workspace</h1><p>Create your factory workspace, or use an invite to join your team.</p><p className="live-muted">Signed in as {user}</p>
    <div className="live-segments" aria-label="Workspace setup"><button onClick={() => setMode('create')} aria-pressed={mode === 'create'}>Create workspace</button><button onClick={() => setMode('join')} aria-pressed={mode === 'join'}>Join workspace</button></div>
    <AsyncForm key={mode} title={mode === 'create' ? 'Start your shared workspace' : 'Join your team'} detail={mode === 'create' ? 'Starts empty. Add your materials, batches and stock.' : 'The owner can create an invite in Workspace. You also need access to this private site.'} submit={mode === 'create' ? 'Create workspace' : 'Join workspace'} onSubmit={async () => { await api(mode === 'create' ? '/workspaces' : '/join', mode === 'create' ? { name } : { code: code.trim() }); location.hash = '/inventory'; await onJoined(); }}>
      {mode === 'create' ? <Field>Workspace name<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={100} placeholder="e.g. Crescent Mill" required /></Field> : <Field>Invite code<input value={code} onChange={e => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" minLength={8} maxLength={128} required /></Field>}
    </AsyncForm><p className="live-muted">Create a workspace to organise your materials, batches and stock.</p>
  </main>;
}

function InventoryForm({ action, state, result, onSaved, onCancel }: { action: Action; state: WorkspaceState; result: ScanResult | null; onSaved: (message: string, lotId?: string, movementId?: string) => Promise<void>; onCancel: () => void }) {
  const key = `yf-live-draft:${state.workspace.id}:${state.member.user_id}:${action.type}:${action.lotId || action.productId || ''}`;
  const initial = { id: crypto.randomUUID(), sku: '', name: '', barcode: '', productId: action.productId || state.products[0]?.id || '', batch: '', supplier: '', lotId: action.lotId || state.lots[0]?.id || '', stage: 'raw', toStage: 'wip', kg: '', cartons: '0', cones: '0', note: '', quality: 'approved', labelText: '' };
  const [draft, setDraft] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); return saved && typeof saved === 'object' ? { ...initial, ...Object.fromEntries(Object.keys(initial).filter(k => typeof saved[k] === 'string').map(k => [k, saved[k]])) } as typeof initial : initial; }
    catch { return initial; }
  });
  const set = (field: keyof typeof draft, value: string) => setDraft(old => ({ ...old, [field]: value, id: crypto.randomUUID() }));
  const [draftError, setDraftError] = useState(false);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(draft)); setDraftError(false); } catch { setDraftError(true); } }, [draft, key]);
  const selected = state.lots.find(lot => lot.id === draft.lotId);
  const available = state.balances.find(b => b.lot_id === draft.lotId && b.stage === draft.stage);
  const titles: Record<FormType, string> = { product: 'Add a material', lot: 'Create a batch', receive: 'Receive stock', dispatch: 'Dispatch stock', transfer: 'Move stock between stages', waste: 'Record waste', quality: 'Review batch quality', inspection: result ? 'Attach TexPilot evidence' : 'Record a manual inspection' };
  async function submit() {
    let lotId = draft.lotId;
    if (action.type === 'product') await api('/products', { sku: draft.sku, name: draft.name, barcode: draft.barcode });
    else if (action.type === 'lot') { const created = await api<{ id: string }>('/lots', { productId: draft.productId, batch: draft.batch, supplier: draft.supplier }); lotId = created.id; }
    else if (action.type === 'quality') await api('/quality', { lotId, status: draft.quality, note: draft.note });
    else if (action.type === 'inspection') {
      await api('/inspections', { id: draft.id, lotId, labelText: draft.labelText, note: draft.note, result });

    }
    else {
      if (!/^\d+$/.test(draft.cartons) || !/^\d+$/.test(draft.cones)) throw new Error('Cartons and cones must be whole numbers.');
      await api('/movements', { id: draft.id, lotId, action: action.type, stage: draft.stage, ...(action.type === 'transfer' ? { toStage: draft.toStage } : {}), grams: gramsFromKg(draft.kg), cartons: Number(draft.cartons), cones: Number(draft.cones), note: draft.note });
    }
    try { localStorage.removeItem(key); } catch { /* Saved inventory is not affected by draft storage. */ }
    await onSaved(action.type === 'inspection' ? 'Inspection saved. Owner QC approval is still required.' : 'Saved on this device.', lotId, ['receive', 'dispatch', 'transfer', 'waste'].includes(action.type) ? draft.id : undefined);
  }
  const summary: [string, string][] = action.type === 'product'
    ? [['Material', draft.name], ['SKU', draft.sku], ['Barcode', draft.barcode || 'Not recorded']]
    : action.type === 'lot' ? [['Material', state.products.find(p => p.id === draft.productId)?.name || ''], ['Batch / dye lot', draft.batch], ['Supplier', draft.supplier || 'Not recorded']]
    : [['Batch', state.lots.find(l => l.id === draft.lotId)?.batch || ''],
      ...(action.type === 'quality' ? [['QC decision', qualityName[draft.quality as Quality]]] : action.type === 'inspection' ? [['Care label', draft.labelText || 'Not recorded']] : [[action.type === 'receive' ? 'Receive into' : 'From stage', stageName[draft.stage as StockStage]], ...(action.type === 'transfer' ? [['To stage', stageName[draft.toStage as StockStage]]] : []), ['Weight', `${draft.kg} kg`], ['Cartons', draft.cartons], ['Cones', draft.cones]]), ['Notes', draft.note || 'None']] as [string, string][];
  return <AsyncForm title={titles[action.type]} detail={action.type === 'quality' ? 'A physical inspection and a reason are required. Approval allows dispatch; the original review remains in the audit history.' : 'Review the entry, then save it on this device.'} submit={action.type === 'quality' ? 'Save QC decision' : action.type === 'inspection' ? 'Save inspection' : 'Save entry'} onSubmit={submit} onCancel={onCancel} review={<dl>{summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}>
    {draftError && <p className="live-error" role="alert">This browser could not save the draft. Keep this form open until you finish.</p>}
    {action.type === 'product' && <><Field>Material name<input value={draft.name} onChange={e => set('name', e.target.value)} minLength={2} maxLength={160} placeholder="e.g. Cotton combed 30/1" required /></Field><Field>SKU<input value={draft.sku} onChange={e => set('sku', e.target.value)} maxLength={80} autoCapitalize="characters" placeholder="e.g. COT-30" required /></Field><Field>Product barcode (optional)<input value={draft.barcode} onChange={e => set('barcode', e.target.value)} maxLength={120} autoCapitalize="off" /></Field><p className="live-muted">All weights use kg, stored as whole grams. Each batch gets its own printable QR label.</p></>}
    {action.type === 'lot' && <><Field>Material<select value={draft.productId} onChange={e => set('productId', e.target.value)} required><option value="" disabled>Choose a material</option>{state.products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></Field><Field>Batch / dye lot<input value={draft.batch} onChange={e => set('batch', e.target.value)} maxLength={100} required /></Field><Field>Supplier (optional)<input value={draft.supplier} onChange={e => set('supplier', e.target.value)} maxLength={160} /></Field><p className="live-muted">New batches need inspection. Receive stock after creating the batch.</p></>}
    {!['product', 'lot'].includes(action.type) && <Field>Batch<select value={draft.lotId} onChange={e => set('lotId', e.target.value)} required><option value="" disabled>Choose a batch</option>{state.lots.map(l => <option key={l.id} value={l.id}>{l.batch} · {state.products.find(p => p.id === l.product_id)?.name}</option>)}</select></Field>}
    {['receive', 'dispatch', 'transfer', 'waste'].includes(action.type) && <><Field>{action.type === 'receive' ? 'Receive into' : 'From stage'}<select value={draft.stage} onChange={e => set('stage', e.target.value)}>{stockStages.map(s => <option key={s} value={s}>{stageName[s]}</option>)}</select></Field>{action.type === 'transfer' && <Field>To stage<select value={draft.toStage} onChange={e => set('toStage', e.target.value)}>{stockStages.map(s => <option key={s} value={s} disabled={s === draft.stage}>{stageName[s]}</option>)}</select></Field>}
      <div className="live-available">Available: <strong>{weight(available?.grams || 0)} kg</strong> · {available?.cartons || 0} cartons · {available?.cones || 0} cones{selected && <QualityBadge value={selected.quality} />}</div>
      {action.type === 'dispatch' && selected?.quality !== 'approved' && <p className="live-warning"><TriangleAlert size={20} aria-hidden="true" />This batch needs owner QC approval before it can be dispatched.</p>}
      <div className="live-fields"><Field>Weight (kg)<input value={draft.kg} onChange={e => set('kg', e.target.value)} inputMode="decimal" placeholder="0.000" required /></Field><Field>Cartons<input value={draft.cartons} onChange={e => set('cartons', e.target.value)} inputMode="numeric" pattern="[0-9]+" required /></Field><Field>Cones<input value={draft.cones} onChange={e => set('cones', e.target.value)} inputMode="numeric" pattern="[0-9]+" required /></Field></div>
    </>}
    {action.type === 'quality' && <Field>QC decision<select value={draft.quality} onChange={e => set('quality', e.target.value)}><option value="approved">Approve after physical inspection</option><option value="hold">Put on QC hold</option><option value="uninspected">Needs another inspection</option></select></Field>}
    {action.type === 'inspection' && <><Field>Care-label text (optional)<textarea value={draft.labelText} onChange={e => set('labelText', e.target.value)} maxLength={4000} rows={3} placeholder="Record what the care label actually states." /></Field><p className="live-muted">{result ? `Attaches scan ${result.scan_id}, model ${result.model_version}, verdict ${result.verdict}. This client-supplied evidence does not automatically approve stock.` : 'Manual evidence only. This does not create an AI prediction or release a QC hold.'}</p></>}
    {!['product', 'lot'].includes(action.type) && <Field>{action.type === 'quality' ? 'Inspection reason' : 'Notes'}<textarea value={draft.note} onChange={e => set('note', e.target.value)} rows={3} maxLength={1000} minLength={['quality', 'inspection'].includes(action.type) ? 3 : undefined} required={['quality', 'inspection'].includes(action.type)} placeholder={action.type === 'dispatch' ? 'Customer, delivery reference, or order number' : 'What should the next operator know?'} /></Field>}
  </AsyncForm>;
}

function LotDetail({ lot, state, onAction, onBack }: { lot: StockLot; state: WorkspaceState; onAction: (action: Action) => void; onBack: () => void }) {
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
  useEffect(() => { let alive = true; QRCode.toDataURL(`YF:${lot.id}`, { width: 240, margin: 2, errorCorrectionLevel: 'M' }).then(value => { if (alive) setQr(value); }).catch(() => setQrError('Could not generate the QR image. Refresh to try again.')); return () => { alive = false; }; }, [lot.id]);
  return <><button className="button" onClick={onBack}><ArrowLeft size={18} />All stock</button><div className="live-detail-grid">
    <section className="live-panel"><div className="live-panel-heading"><div><h2>{product?.name}</h2><p>{product?.sku} · Batch {lot.batch}</p></div><QualityBadge value={lot.quality} /></div>
      <dl className="live-facts"><div><dt>Supplier</dt><dd>{lot.supplier || 'Not recorded'}</dd></div><div><dt>Created</dt><dd>{timestamp(lot.created_at)}</dd></div></dl>
      <div className="live-stock-stages">{stockStages.map(stage => { const balance = state.balances.find(b => b.lot_id === lot.id && b.stage === stage); return <div key={stage}><span>{stageName[stage]}</span><strong>{weight(balance?.grams || 0)} <small>kg</small></strong><span>{balance?.cartons || 0} cartons · {balance?.cones || 0} cones</span></div>; })}</div>
      <div className="live-actions">{([['receive', 'Receive stock', PackagePlus], ['transfer', 'Move stage', ArrowRightLeft], ['dispatch', 'Dispatch', Truck], ['waste', 'Record waste', Trash2], ['inspection', 'Add inspection', ClipboardCheck]] as const).map(([type, label, Icon]) => <button className={`button ${type === 'receive' ? 'primary' : ''}`} key={type} onClick={() => onAction({ type, lotId: lot.id })} disabled={type === 'dispatch' && lot.quality !== 'approved'} title={type === 'dispatch' && lot.quality !== 'approved' ? 'Approve quality first' : undefined}><Icon size={18} aria-hidden="true" />{label}</button>)}{state.member.role === 'owner' && <button className="button" onClick={() => onAction({ type: 'quality', lotId: lot.id })}><ShieldCheck size={18} />Review quality</button>}</div>
      <h3 className="live-subheading">Inspection notes</h3>
      {evidenceError && <p className="live-error" role="alert">Batch history could not be refreshed. {evidenceError}<button className="live-text-button" onClick={() => setEvidenceRetry(value => value + 1)}>Retry history</button></p>}
      {!evidence && !evidenceError && <p role="status">Loading this batch’s inspection history…</p>}
      {evidence?.inspections.length ? evidence.inspections.map(i => <article className="live-event" key={i.id}><strong>{i.source === 'manual' ? 'Manual inspection' : 'TexPilot evidence (client supplied)'}</strong><p>{i.note}</p>{i.label_text && <p>Label: {i.label_text}</p>}<small>{i.actor_name} · {timestamp(i.created_at)}</small></article>) : evidence && !evidenceError && <p className="live-muted">No inspection notes yet. Record the label and physical checks before approving the batch.</p>}
      {evidence?.photos.map(photo => <figure className="live-inspection-photo" key={photo.id}><a href={`/api/photos/${photo.id}`} target="_blank" rel="noreferrer"><img src={`/api/photos/${photo.id}`} alt={`Inspection evidence for batch ${lot.batch}`} width={420} height={320} loading="lazy" /></a><figcaption>{photo.actor_name} · {timestamp(photo.created_at)}</figcaption></figure>)}
      {evidence?.qualityEvents.map(e => <article className="live-event" key={e.id}><QualityBadge value={e.status} /><p>{e.note}</p><small>{e.actor_name} · {timestamp(e.created_at)}</small></article>)}
      {evidence?.nextOffset != null && <button className="button" onClick={() => void loadEvidence()} disabled={evidenceBusy}>{evidenceBusy ? 'Loading…' : 'Load older batch evidence'}</button>}
    </section>
    <section className="live-panel live-qr-panel"><div className="live-print-label"><img src="/brand/logo.png" alt="" width={32} height={32} /><h2>Yarnflow</h2><strong>{product?.name}</strong><p>Batch {lot.batch} · {product?.sku}</p>{qr && <img src={qr} alt={`QR code for batch ${lot.batch}`} width={240} height={240} className="live-qr" />}<code>YF:{lot.id}</code></div>{qrError && <p role="alert" className="live-error">{qrError}</p>}<p>Print this label and attach it to the batch. Both phones can scan it to open the same stock record.</p><button className="button" onClick={() => window.print()} disabled={!qr}><Printer size={18} />Print batch label</button></section>
  </div></>;
}

export default function LiveApp() {
  const [collapsed,setCollapsed] = useState(false);
  const menuDialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<WorkspaceState | Unjoined | null>(null);
  const [error, setError] = useState(''); const [authNeeded, setAuthNeeded] = useState(false);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [route, setRoute] = useState(routeFromHash); const [selectedId, setSelectedId] = useState(lotFromHash);
  const [action, setAction] = useState<Action | null>(null); const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => aliases[location.hash.split('/')[1]]?.[1] ?? 'all');
  const [online, setOnline] = useState(navigator.onLine); const [savedAt, setSavedAt] = useState(0);
  const [notice, setNotice] = useState(''); const [undoId, setUndoId] = useState(''); const [scanTab, setScanTab] = useState('fabric');
  const [matches, setMatches] = useState<{ id: string; batch: string; name: string }[]>([]);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [invite, setInvite] = useState(''); const [inviteBusy, setInviteBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false); const [integration, setIntegration] = useState('');
  const [history, setHistory] = useState<StockMovement[]>([]); const [moreHistory, setMoreHistory] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false); const [reverse, setReverse] = useState<StockMovement | null>(null); const [reason, setReason] = useState(''); const reverseId = useRef(crypto.randomUUID());
  const theme = 'light';
  const requestSequence = useRef(0);
  const refresh = useCallback(async (quiet = false) => {
    const sequence = ++requestSequence.current;
    if (!quiet) setRefreshing(true);
    try {
      const result = await api<WorkspaceState | Unjoined>('/workspace');
      if (sequence !== requestSequence.current) return;
      setState(result); setAuthNeeded(false); setSavedAt(Date.now()); setError('');
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if (error instanceof InventoryError && error.status === 401) { setState(null); setAuthNeeded(true); }
      setError(errorMessage(error));
    } finally { if (sequence === requestSequence.current) { setLoading(false); setRefreshing(false); } }
  }, []);
  useEffect(() => { void refresh(); const interval = setInterval(() => { if (!document.hidden) void refresh(true); }, 10000); const focus = () => { if (!document.hidden) void refresh(true); }; window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus); return () => { clearInterval(interval); requestSequence.current++; window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); }; }, [refresh]);
  useEffect(() => { const update = () => { const alias = aliases[location.hash.split('/')[1]]; if (alias) setView(alias[1]); setRoute(routeFromHash()); setSelectedId(lotFromHash()); setAction(null); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { const network = () => { setOnline(navigator.onLine); void refresh(true); }; window.addEventListener('online', network); window.addEventListener('offline', network); return () => { window.removeEventListener('online', network); window.removeEventListener('offline', network); }; }, [refresh]);
  useEffect(() => { document.documentElement.dir = 'ltr'; document.documentElement.lang = 'en'; document.documentElement.dataset.theme = theme; try { localStorage.setItem('yf-theme', theme); } catch { /* The theme can remain in memory. */ } }, [theme]);
  // The gold pill in both navs glides to the current tab (theme.css reads --glide-*).
  const shellReady = !loading && !!state?.member;
  useLayoutEffect(() => {
    const place = () => document.querySelectorAll<HTMLElement>('.live-sidebar nav, .live-bottom-nav').forEach(nav => {
      const tab = nav.querySelector<HTMLElement>('button.active');
      nav.style.setProperty('--glide-w', (tab?.offsetWidth || 0) + 'px'); nav.style.setProperty('--glide-h', (tab?.offsetHeight || 0) + 'px');
      if (tab) { nav.style.setProperty('--glide-x', tab.offsetLeft + 'px'); nav.style.setProperty('--glide-y', tab.offsetTop + 'px'); }
      requestAnimationFrame(() => { nav.dataset.glide = 'on'; });
    });
    // Re-measure whenever a nav changes size: the window, and the web font arriving after first paint.
    const watch = new ResizeObserver(place); document.querySelectorAll('.live-sidebar nav, .live-bottom-nav, .live-bottom-nav > button').forEach(n => watch.observe(n));
    place(); return () => watch.disconnect();
  }, [route, shellReady]);
  function navigate(to: string, lotId = '') { menuDialog.current?.close(); const alias = aliases[to]; if (alias) { to = alias[0]; setView(alias[1]); } else if (to === 'inventory' && !lotId) setView('all'); location.hash = '/' + to + (lotId ? '/' + lotId : ''); setRoute(to); setSelectedId(lotId); setAction(null); setMatches([]); setQuery(''); setNotice(''); window.scrollTo(0, 0); }
  async function saved(message: string, lotId?: string, movementId?: string) { setAction(null); if (lotId) navigate('inventory', lotId); setNotice(message); setUndoId(movementId || ''); await refresh(); }
  if (loading) return <main className="live-loading" aria-busy="true"><img src="/brand/logo.png" width="48" height="48" alt="" /><h1>Opening inventory…</h1><p>Loading inventory records.</p></main>;
  if (!state) return <main className="live-welcome"><img src="/brand/logo.png" width="58" height="58" alt="" /><h1>{authNeeded ? 'Sign in to Yarnflow' : 'Inventory is unavailable'}</h1><p role="alert">{error}</p>{authNeeded ? <a className="button primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a> : <button className="button primary" onClick={() => void refresh()}><RefreshCw size={18} />Try connection again</button>}<p>Your existing records are preserved.</p></main>;
  if (!state.member) return <Welcome user={(state as Unjoined).user} onJoined={() => refresh()} />;
  const workspace = state as WorkspaceState;
  const owner = workspace.member.role === 'owner';
  const selected = workspace.lots.find(l => l.id === selectedId);
  const productName = (lotId: string) => workspace.products.find(p => p.id === workspace.lots.find(l => l.id === lotId)?.product_id)?.name || 'Material';
  const batchName = (lotId: string) => workspace.lots.find(l => l.id === lotId)?.batch || lotId;
  const total = (stockStage?: StockStage) => workspace.balances.filter(b => !stockStage || b.stage === stockStage).reduce((sum, b) => sum + b.grams, 0);
  const inView = (lot: StockLot, v: View) => v === 'all' || (v === 'quality' ? lot.quality !== 'approved' : v === 'dispatch' ? lot.quality === 'approved' : workspace.balances.some(b => b.lot_id === lot.id && b.stage === 'wip' && b.grams > 0));
  const filtered = workspace.lots.filter(lot => [lot.batch, lot.supplier, productName(lot.id), workspace.products.find(p => p.id === lot.product_id)?.sku].join(' ').toLowerCase().includes(query.toLowerCase()) && inView(lot, view));
  const views: [View, string, typeof Boxes][] = [['all', 'All', Boxes], ['quality', 'Needs QC', ShieldAlert], ['production', 'In production', Factory], ['dispatch', 'To dispatch', Truck]];
  const lotGrams = (lotId: string) => workspace.balances.filter(b => b.lot_id === lotId).reduce((sum, b) => sum + b.grams, 0);
  // One list: each material with its batches under it (a material is what you buy; a batch is one delivery of it).
  function stockList() {
    const q = query.toLowerCase();
    const groups = workspace.products.map(p => ({ p, lots: filtered.filter(l => l.product_id === p.id) }))
      .filter(({ p, lots }) => lots.length || (view === 'all' && [p.name, p.sku, p.barcode].join(' ').toLowerCase().includes(q)));
    return <div className="yf-stock-groups">{groups.map(({ p, lots }) => <section className="yf-stock-group" key={p.id} aria-label={p.name}>
      <header><span className="yf-material-symbol"><Package size={22} aria-hidden="true" /></span><div><strong>{p.name}</strong><span>{p.sku}{p.barcode ? ' · ' + p.barcode : ''}</span></div><strong className="live-row-weight">{weight(workspace.lots.filter(l => l.product_id === p.id).reduce((sum, l) => sum + lotGrams(l.id), 0))} <small>kg</small></strong>{owner && <button className="live-icon-button" aria-label={`New batch of ${p.name}`} title="New batch" onClick={() => setAction({ type: 'lot', productId: p.id })}><Plus size={20} aria-hidden="true" /></button>}</header>
      {lots.map(lot => <button key={lot.id} className="live-lot-row" onClick={() => { navigate('inventory', lot.id); }}><span className="live-lot-name"><strong>Batch {lot.batch}</strong><span>{lot.supplier || 'Supplier not recorded'}</span></span><QualityBadge value={lot.quality} /><strong className="live-row-weight">{weight(lotGrams(lot.id))} <small>kg</small></strong><ChevronRight size={20} aria-hidden="true" /></button>)}
      {!lots.length && <p className="yf-stock-empty">No batches yet. Tap + to add one.</p>}
    </section>)}{!groups.length && <div className="live-empty"><h3>{workspace.products.length ? 'Nothing matches' : 'Start with your first material'}</h3><p>{workspace.products.length ? 'Try another name, batch or filter.' : 'Add a material (for example Cotton 30/1), then add its batches.'}</p></div>}</div>;
  }
  function activityList(movements: StockMovement[]) {
    return movements.length ? <div className="live-history">{movements.map(m => <article className="live-event" key={m.id}><div className="live-event-top"><strong>{({ receive: 'Stock received', dispatch: 'Stock dispatched', transfer: 'Stock moved', waste: 'Waste recorded', reverse: 'Entry reversed' } as Record<string, string>)[m.action]} · {weight(m.grams)} kg</strong><time>{timestamp(m.created_at)}</time></div><p><button className="live-text-button" onClick={() => { navigate('inventory', m.lot_id); }}>{productName(m.lot_id)} · {batchName(m.lot_id)}</button></p><p>{m.from_stage ? stageName[m.from_stage] : 'External'} <ArrowRight size={14} aria-label="to" /> {m.to_stage ? stageName[m.to_stage] : m.action === 'waste' ? 'Waste' : 'Dispatched'} · {m.cartons} cartons · {m.cones} cones</p>{m.note && <p>{m.note}</p>}<small>Recorded by {m.actor_name}</small>{owner && m.action !== 'reverse' && ![...workspace.movements, ...history].some(r => r.reverses === m.id) && <button className="live-text-button live-reverse" onClick={() => { setReverse(m); setReason(''); reverseId.current = crypto.randomUUID(); }}>Reverse entry</button>}</article>)}</div> : <div className="live-empty"><ClipboardList size={34} /><h3>No movements yet</h3><p>Receive stock into a batch to start its audit history.</p></div>;
  }
  async function lookup(code: string) {
    const found = await api<{ lotId?: string; lots?: typeof matches }>('/lookup?code=' + encodeURIComponent(code));
    await refresh();
    if (found.lotId) { navigate('inventory', found.lotId); }
    else { setMatches(found.lots || []); setNotice('This product has several batches. Choose the batch printed on the goods.'); }
  }
  async function inviteFriend() {
    setInviteBusy(true); setError('');
    try { const result = await api<{ code: string }>('/invites', {}); setInvite(result.code); }
    catch (error) { setError(errorMessage(error)); } finally { setInviteBusy(false); }
  }
  async function shareInvite() {
    const url = location.origin + '/#/join/' + invite;
    try { if (navigator.share) await navigator.share({ title: 'Join my Yarnflow workspace', text: 'Use this single-use invite within 72 hours. The owner must also grant access to the private site.', url }); else { await navigator.clipboard.writeText(url); setNotice('Invite link copied.'); } }
    catch { setNotice('Copy the invite link shown below and share it with your colleague.'); }
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
  return <div className={`live-app ${collapsed ? 'yf-collapsed' : ''}`}><a className="skip-link" href="#live-main" onClick={event => { event.preventDefault(); document.getElementById('live-main')?.focus(); }}>Skip to content</a>
    <aside className="live-sidebar" aria-hidden={collapsed} inert={collapsed}><a className="live-brand" href="#/overview"><img src="/brand/logo.png" alt="" width="38" height="38" /><span>yarnflow.</span></a><div className="live-factory"><strong>FAZ Textile Factory</strong></div><nav aria-label="Main navigation"><span className="ref-nav-label">MENU</span>{tabs.map(([id,label,Icon], index)=><div className="ref-nav-item" key={id}>{index === 4 && <span className="ref-nav-label ref-nav-general">GENERAL</span>}<button aria-label={label} aria-current={route===id?'page':undefined} className={route===id?'active':''} onClick={()=>navigate(id)}><Icon size={19} aria-hidden="true" /><span>{label}</span></button></div>)}</nav></aside>
    <dialog className="yf-mobile-menu" ref={menuDialog} onClick={e=>{if(e.target===e.currentTarget)menuDialog.current?.close();}} aria-label="Navigation menu"><div><a className="live-brand" href="#/overview"><img src="/brand/logo.png" alt="" width="34" height="34" />yarnflow.</a><button className="live-icon-button" onClick={()=>menuDialog.current?.close()} aria-label="Close navigation"><X /></button></div><nav aria-label="Sidebar navigation">{tabs.map(([id,label,Icon])=><button key={id} aria-current={route===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={23} aria-hidden="true" />{label}</button>)}</nav></dialog>
    <div className="live-main-shell"><header className="live-topbar"><div><button className="live-icon-button yf-menu-toggle" aria-label={collapsed ? "Open sidebar" : "Close sidebar"} aria-expanded={!collapsed} onClick={()=>{if(matchMedia('(max-width: 900px)').matches)menuDialog.current?.showModal();else setCollapsed(v=>!v);}}>{collapsed ? <Menu size={22} aria-hidden="true" /> : <PanelLeftClose size={22} aria-hidden="true" />}</button><span className="ref-greeting"><Sun size={24} aria-hidden="true" /><strong>{route === 'overview' ? `Hello ${workspace.member.name.includes('@') ? 'there' : workspace.member.name.split(' ')[0]}` : tabs.find(t=>t[0]===route)?.[1]}</strong></span></div><div><button className="yf-header-search" aria-label="Find a batch" onClick={()=>{navigate('inventory');setTimeout(()=>document.querySelector<HTMLInputElement>('input[type="search"]')?.focus(),0);}}><Search size={19} aria-hidden="true" /><span>Find stock</span></button></div></header>
    <main id="live-main" key={route || 'overview'} className="live-content" tabIndex={-1}>
      <div className="live-page-heading"><div><h1>{action ? 'Stock entry' : selected ? 'Batch details' : (route === 'overview' ? 'A clear view of your mill.' : tabs.find(t=>t[0]===route)?.[1] || 'Stock')}</h1><p>{route === 'overview' ? 'Stock and batches that need attention.' : route === 'inventory' ? 'Your materials and their batches, from delivery to dispatch.' : route === 'scanner' ? 'Photograph a fabric, measure its yarn, or scan a stock label.' : route === 'activity' ? 'Every stock movement, oldest records kept.' : route === 'help' ? 'Answers to common questions.' : 'Backups and records on this device.'}</p></div>{!action && !selected && route === 'inventory' && owner && <div className="live-actions"><button className="button" onClick={() => setAction({ type: 'product' })}><Package size={18} aria-hidden="true" />New material</button>{workspace.products.length > 0 && <button className="button primary" onClick={() => setAction({ type: 'lot' })}><Plus size={18} aria-hidden="true" />New batch</button>}</div>}</div>
      {error && <div className="live-error" role="alert"><TriangleAlert size={20} aria-hidden="true" />{error}<button className="live-text-button" onClick={() => void refresh()}>Retry connection</button></div>}
      {!online && <div className="live-warning" role="status"><WifiOff size={18} />You are offline. Inventory still saves on this device. TexPilot scanning needs a connection.</div>}
      {notice && <div className="live-success" role="status"><CheckCheck size={19} /><span>{notice}</span>{undoId && <button className="live-text-button" onClick={() => { const movement = workspace.movements.find(m => m.id === undoId); if (movement) { navigate('activity'); setReverse(movement); setReason('Correction after saving'); reverseId.current = crypto.randomUUID(); } }}>Undo entry</button>}<button aria-label="Dismiss message" className="live-icon-button" onClick={() => setNotice('')}><X size={17} /></button></div>}
      {action ? <InventoryForm key={`${action.type}:${action.lotId || ''}`} action={action} state={workspace} result={action.type === 'inspection' ? lastResult : null} onSaved={saved} onCancel={() => setAction(null)} /> : selected ? <LotDetail key={selected.id} lot={selected} state={workspace} onAction={setAction} onBack={() => navigate('inventory')} /> : <>
      {route === 'overview' && <WorkspaceDashboard state={workspace} navigate={navigate} />}
      {route === 'inventory' && <section className="live-panel yf-stock-panel"><div className="yf-views" role="group" aria-label="Show">{views.map(([id, label, Icon]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}><Icon size={20} aria-hidden="true" /><span>{label}</span><b>{workspace.lots.filter(l => inView(l, id)).length}</b></button>)}</div><Field className="live-search-label">Search<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Material, batch or supplier" /></Field>{stockList()}</section>}
      {route==='help' && <section className="live-panel yf-help"><h2>A little guidance, a smoother day.</h2>{[['How do I receive stock?','Add a material, create its batch, then open the batch and choose Receive stock. Review the quantity before saving.'],['How does quality approval work?','Record the care label and physical inspection. A QC decision is required before dispatch; a scan result alone never approves a batch.'],['How do corrections work?','Open History and reverse the original movement with a reason. The original stays visible and stock cannot become negative.'],['Where is my data stored?','Inventory is stored in this browser. Download backups in Settings and restore them when moving devices.'],['Web and iOS','Use Yarnflow in your browser. Each device keeps its own inventory records unless you transfer a backup.'],['Camera and privacy','Camera access is requested when you start a scan. The TexPilot service must be connected for model analysis.']].map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>}
      {route === 'scanner' && <><div className="live-segments yf-scan-tabs" aria-label="What to scan"><button aria-pressed={scanTab === 'fabric'} onClick={() => setScanTab('fabric')}><Camera size={22} aria-hidden="true" /><span>Fabric</span></button><button aria-pressed={scanTab === 'spec'} onClick={() => setScanTab('spec')}><Ruler size={22} aria-hidden="true" /><span>Yarn count</span></button><button aria-pressed={scanTab === 'barcode'} onClick={() => setScanTab('barcode')}><ScanBarcode size={22} aria-hidden="true" /><span>Stock label</span></button></div>{scanTab === 'spec' ? <SpecScan /> : scanTab === 'barcode' ? <><BarcodeScanner onFound={lookup} />{!!matches.length && <section className="live-panel"><h2>Choose the batch</h2>{matches.map(lot => <button className="live-match" key={lot.id} onClick={() => { navigate('inventory', lot.id); }}><span>{lot.name} · {lot.batch}</span><ArrowRight size={18} /></button>)}</section>}</> : <><Scanner t={(en) => en} onInventory={() => navigate('inventory')} onResult={setLastResult} onMeasure={() => { setScanTab('spec'); scrollTo({ top: 0, behavior: 'smooth' }); }} />{lastResult && <section className="live-panel"><h2>Save this scan to a batch</h2><p>Keeps the result in the batch's QC history. It does not approve the batch by itself.</p><button className="button primary" disabled={!workspace.lots.length} onClick={() => setAction({ type: 'inspection' })}><ClipboardCheck size={18} aria-hidden="true" />Save to a batch</button>{!workspace.lots.length && <p>Add a batch in Stock first.</p>}</section>}</>}</>}
      {route === 'activity' && <section className="live-panel"><div className="live-panel-heading"><h2>Stock movement register</h2><span>Asia/Karachi</span></div>{reverse && <AsyncForm title="Reverse this movement" detail={`${weight(reverse.grams)} kg · ${batchName(reverse.lot_id)}. Reversal fails if the stock has already been consumed.`} submit="Save reversal" review={<dl><div><dt>Batch</dt><dd>{batchName(reverse.lot_id)}</dd></div><div><dt>Weight</dt><dd>{weight(reverse.grams)} kg</dd></div><div><dt>Reason</dt><dd>{reason}</dd></div></dl>} onCancel={() => setReverse(null)} onSubmit={async () => { await api('/reversals', { id: reverseId.current, movementId: reverse.id, note: reason }); setReverse(null); setHistory([]); await saved('Reversal saved. The original entry is preserved.'); }}><Field>Reason<textarea value={reason} onChange={e => { setReason(e.target.value); reverseId.current = crypto.randomUUID(); }} minLength={3} maxLength={1000} required /></Field></AsyncForm>}{activityList([...workspace.movements, ...history.filter(h => !workspace.movements.some(m => m.id === h.id))])}{workspace.movements.length >= 100 && moreHistory && <button className="button" disabled={historyBusy} onClick={async () => { setHistoryBusy(true); try { const page = await api<{ movements: StockMovement[] }>('/movements?offset=' + (100 + history.length)); setHistory(previous => [...previous, ...page.movements]); setMoreHistory(page.movements.length === 100); } catch (error) { setError(errorMessage(error)); } finally { setHistoryBusy(false); } }}>{historyBusy ? 'Loading…' : 'Load earlier movements'}</button>}</section>}
      {route==='settings'&&<><section className="live-panel"><h2>Backup and restore</h2><p>Your inventory stays on this device. Download a backup after each working day. Restore replaces the current inventory here.</p><div className="live-actions"><button className="button primary" onClick={()=>void backup()} disabled={exportBusy}><Download size={20} aria-hidden="true" />{exportBusy?'Preparing backup…':'Download backup'}</button><label className="ref-import-button">Restore backup<input type="file" accept="application/json,.json" onChange={async event=>{const file=event.target.files?.[0];if(!file)return;try{const parsed=JSON.parse(await file.text());if(!window.confirm('Replace inventory on this device with this backup? Download your current backup first.'))return;restoreLocalInventory(parsed);await refresh();setNotice('Backup restored on this device.');}catch(error){setError(errorMessage(error));}finally{event.target.value='';}}}/></label></div><button className="live-text-button" onClick={async()=>{if(!window.confirm('Clear all inventory on this device? Download a backup first.'))return;resetLocalInventory();await refresh();setNotice('Inventory cleared. Add materials to begin.');}}>Clear inventory</button></section></>}

      </>}
    </main><footer className="live-sync" role="status"><CheckCheck size={17} aria-hidden="true"/><span>All changes saved{savedAt ? ' · checked '+new Intl.DateTimeFormat('en',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Karachi'}).format(savedAt) : ''}</span></footer></div>
    <nav className="live-bottom-nav" aria-label="Phone navigation">{tabs.filter(t=>['overview','inventory','scanner','activity'].includes(t[0])).map(([id,label,Icon])=><button key={id} aria-current={route===id?'page':undefined} className={route===id?'active':''} onClick={()=>navigate(id)}><Icon size={23} aria-hidden="true" /><span>{label}</span></button>)}<button onClick={()=>menuDialog.current?.showModal()} aria-label="More pages"><Menu size={23} aria-hidden="true" /><span>More</span></button></nav>
  </div>;
}
