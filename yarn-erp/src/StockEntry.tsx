import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, CheckCheck, Factory, PackageCheck, Trash2, Truck, type LucideIcon } from 'lucide-react';
import { AsyncForm } from './forms';
import { useLanguage } from './i18n';
import { useFloor, type FloorKey } from './copy';
import { Cone, materialHue } from './Cone';
import { QualityBadge, when, yarnName } from './WorkspaceDashboard';
import { ChoiceCards, EntrySentence } from './ui';
import { inventoryRequest as api, stockStages, weight, type StockStage, type WorkspaceState } from './inventory-client';

/** The stock jobs a worker does, each with its stages already decided. `move` is the free choice, for supervisors. */
export type Preset = 'receive' | 'issue' | 'return' | 'finish' | 'move' | 'waste' | 'dispatch';
type Movement = 'receive' | 'transfer' | 'waste' | 'dispatch';
export const presetInfo: Record<Preset, { movement: Movement; title: FloorKey; hint: FloorKey; icon: LucideIcon; from?: StockStage; to?: StockStage; permission: 'receive' | 'produce' | 'waste' | 'dispatch' }> = {
  receive: { movement: 'receive', title: 'receive', hint: 'receiveHint', icon: ArrowDownToLine, to: 'raw', permission: 'receive' },
  issue: { movement: 'transfer', title: 'issue', hint: 'issueHint', icon: Factory, from: 'raw', to: 'wip', permission: 'produce' },
  return: { movement: 'transfer', title: 'returnFloor', hint: 'returnHint', icon: ArrowUpFromLine, from: 'wip', to: 'raw', permission: 'produce' },
  finish: { movement: 'transfer', title: 'finish', hint: 'finishHint', icon: PackageCheck, from: 'wip', to: 'finished', permission: 'produce' },
  move: { movement: 'transfer', title: 'move', hint: 'moveHint', icon: ArrowRightLeft, permission: 'produce' },
  waste: { movement: 'waste', title: 'waste', hint: 'wasteHint', icon: Trash2, permission: 'waste' },
  dispatch: { movement: 'dispatch', title: 'dispatch', hint: 'dispatchHint', icon: Truck, permission: 'dispatch' },
};
// Where waste and dispatch usually come from, first choice first.
const usualFrom: Partial<Record<Preset, StockStage[]>> = { waste: ['wip', 'raw', 'finished', 'cops'], dispatch: ['finished', 'cops', 'wip', 'raw'], move: ['raw', 'wip', 'finished', 'cops'] };

/** Whether a batch can take this job now, and if not, the plain reason. Mirrors the server's QC rules. */
export function batchBlock(state: WorkspaceState, lotId: string, preset: Preset): FloorKey | null {
  const lot = state.lots.find(l => l.id === lotId); if (!lot) return 'noBatchFound';
  const info = presetInfo[preset];
  const has = (stage?: StockStage) => state.balances.some(b => b.lot_id === lotId && (!stage || b.stage === stage) && b.grams > 0);
  if (info.movement === 'receive') return null;
  if (info.movement === 'transfer' && lot.quality === 'hold') return 'onHold';
  if ((info.movement === 'dispatch' || (info.movement === 'transfer' && info.from === 'raw')) && lot.quality !== 'approved') return 'needsQc';
  if (!has(info.from)) return 'nothingHere';
  return null;
}

const blank = { cartons: '', cones: '', kg: '', note: '' };
type Draft = typeof blank & { id: string; from: StockStage | ''; to: StockStage | ''; startedAt: number };
const DRAFT_LIFE = 12 * 3600_000;

export default function StockEntry({ preset, lotId, state, onSaved, onCancel }: { preset: Preset; lotId: string; state: WorkspaceState; onSaved: (sentence: string, lotId: string, movementId: string) => Promise<void>; onCancel: () => void }) {
  const { language } = useLanguage(); const say = useFloor();
  const info = presetInfo[preset];
  const lot = state.lots.find(l => l.id === lotId)!;
  const product = state.products.find(p => p.id === lot.product_id);
  const yarn = yarnName(product?.name || '');
  const stock = (stage: StockStage) => state.balances.find(b => b.lot_id === lotId && b.stage === stage) ?? { grams: 0, cartons: 0, cones: 0 };
  const place = (stage: StockStage | '') => stage ? say(`stage_${stage}` as FloorKey) : '';
  const firstWithStock = (usualFrom[preset] ?? []).find(stage => stock(stage).grams > 0) ?? '';
  const fresh = (): Draft => ({ ...blank, id: crypto.randomUUID(), from: info.from ?? (info.movement === 'receive' ? '' : firstWithStock), to: info.to ?? '', startedAt: Date.now() });

  // An unfinished entry for this batch and job comes back only if it is recent, and the worker chooses to keep it.
  const key = `yf-entry:${state.workspace.id}:${state.member.user_id}:${preset}:${lotId}`;
  const stored = useMemo(() => {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null') as Draft | null; return value && Date.now() - value.startedAt < DRAFT_LIFE && (value.cartons || value.cones || value.kg || value.note) ? value : null; }
    catch { return null; }
  }, [key]);
  const [draft, setDraft] = useState<Draft>(fresh);
  const [offer, setOffer] = useState(!!stored);
  // The request id stays the same until the server answers, so a retry after a lost reply can never double-book.
  const set = (field: keyof typeof blank | 'from' | 'to', value: string) => { setOffer(false); setDraft(old => ({ ...old, [field]: value })); };
  useEffect(() => { if (offer) return; try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* The entry still works without a saved draft. */ } }, [draft, key, offer]);
  const forget = () => { try { localStorage.removeItem(key); } catch { /* nothing to forget */ } };

  const [shown, setShown] = useState(false); // problems appear once the worker has tried to continue
  const [changePlace, setChangePlace] = useState(false);
  const from = draft.from as StockStage | ''; const to = draft.to as StockStage | '';
  const have = from ? stock(from) : null;
  const kgOk = /^\d+(\.\d{1,3})?$/.test(draft.kg.trim());
  const grams = kgOk ? Math.round(Number(draft.kg.trim()) * 1000) : 0;
  const errors: Partial<Record<'cartons' | 'cones' | 'kg' | 'from' | 'to', string>> = {};
  if (info.movement !== 'receive' && !from) errors.from = say('pickFrom');
  if (info.movement === 'transfer' && (!to || to === from)) errors.to = say('pickTo');
  for (const unit of ['cartons', 'cones'] as const) {
    const value = draft[unit].trim();
    if (!value) errors[unit] = say('typeCount', { unit: say(unit).toLocaleLowerCase() });
    else if (!/^\d+$/.test(value)) errors[unit] = say('wholeNumber');
    else if (have && Number(value) > have[unit]) errors[unit] = say('tooMuch', { have: have[unit], unit: say(unit).toLocaleLowerCase(), place: place(from), typed: value });
  }
  if (!draft.kg.trim()) errors.kg = say('typeKg');
  else if (!/^\d+(\.\d+)?$/.test(draft.kg.trim())) errors.kg = say('typeKg');
  else if (!kgOk) errors.kg = say('kgDecimals');
  else if (grams <= 0) errors.kg = say('kgPositive');
  else if (have && grams > have.grams) errors.kg = say('tooMuch', { have: weight(have.grams), unit: 'kg', place: place(from), typed: weight(grams) });
  const problem = (field: keyof typeof errors) => shown ? errors[field] : undefined;

  const cartons = Number(draft.cartons) || 0; const cones = Number(draft.cones) || 0;
  const qty = say('qty', { cartons, cones, kg: weight(grams) });
  const sentenceKey = info.movement === 'receive' ? 's_receive' : info.movement === 'transfer' ? 's_transfer' : info.movement === 'waste' ? 's_waste' : 's_dispatch';
  const sentence = say(sentenceKey, { qty, yarn, batch: lot.batch, from: place(from), to: place(to) });
  const warnings: string[] = [];
  if (!cartons && !cones) warnings.push(say('zeroCounts'));
  else if (cartons && grams && (grams / cartons < 1000 || grams / cartons > 200_000)) warnings.push(say('oddWeight', { cartons, kg: weight(grams), each: weight(Math.round(grams / cartons)) }));

  async function submit() {
    await api('/movements', { id: draft.id, lotId, action: info.movement, stage: info.movement === 'receive' ? to : from, ...(info.movement === 'transfer' ? { toStage: to } : {}), grams, cartons, cones, note: draft.note.trim() });
    forget();
    await onSaved(sentence, lotId, draft.id);
  }

  const stageCards = (pick: 'from' | 'to') => stockStages.filter(stage => pick === 'to' ? stage !== from : true).map(stage => {
    const s = stock(stage);
    return { id: stage, label: place(stage), detail: <span dir="ltr">{weight(s.grams)} kg · {s.cartons} {say('cartons')}</span>, disabled: pick === 'from' && s.grams <= 0 };
  });
  const Icon = info.icon;
  // A plain function, not a component: a component defined here would remount the box and drop the keyboard on every key.
  const numberBox = (field: 'cartons' | 'cones' | 'kg', big = false) => {
    const id = `yf-${field}`; const err = problem(field);
    return <div className={`yf-qty${big ? ' is-big' : ''}`}>
      <label htmlFor={id}>{say(field)}</label>
      <input id={id} dir="ltr" inputMode={field === 'kg' ? 'decimal' : 'numeric'} enterKeyHint="next" autoComplete="off" value={draft[field]} aria-invalid={!!err} aria-describedby={err ? id + '-err' : undefined} onChange={e => set(field, e.target.value.replace(field === 'kg' ? /[^\d.]/g : /\D/g, ''))} />
      {err ? <p id={id + '-err'} className="live-field-error">{err}</p> : field !== 'kg' && <p className="yf-qty-help">{say('zeroIfNone')}</p>}
    </div>;
  };

  return <AsyncForm className="yf-entry" title={say(info.title)} submit={say('save')} onSubmit={submit} onCancel={() => { forget(); onCancel(); }}
    check={() => { setShown(true); return !Object.keys(errors).length; }}
    labels={{ next: say('next'), reviewTitle: say('checkThis'), reviewHint: say('checkThisHint'), change: say('change'), cancel: say('cancel'), saving: say('saving'), fixAbove: say('fixAbove') }}
    review={<EntrySentence sentence={sentence} numbers={[[say('cartons'), String(cartons)], [say('cones'), String(cones)], ['kg', weight(grams)]]} warnings={warnings} />}>
    <div className="yf-entry-batch"><span className="yf-entry-icon"><Icon size={26} aria-hidden="true" /></span><Cone hue={materialHue(state.products, lot.product_id)} size={40} /><div><strong>{yarn}</strong><span><bdi>{lot.batch}</bdi>{lot.supplier ? <> · <bdi>{lot.supplier}</bdi></> : ''}</span></div><QualityBadge value={lot.quality} /></div>
    {offer && stored && <div className="live-warning yf-draft-offer" role="status"><span>{say('draftBack', { time: when.format(stored.startedAt, language) })}</span><div className="live-actions"><button type="button" className="button" onClick={() => { setDraft(stored); setOffer(false); }}>{say('draftKeep')}</button><button type="button" className="button" onClick={() => { forget(); setOffer(false); }}>{say('draftFresh')}</button></div></div>}
    {info.movement === 'receive' && (changePlace
      ? <ChoiceCards label={say('to')} value={to} onChange={v => set('to', v)} options={stageCards('to')} />
      : <p className="yf-entry-route"><CheckCheck size={20} aria-hidden="true" />{say('to')}: <strong>{place(to)}</strong><button type="button" className="live-text-button" onClick={() => setChangePlace(true)}>{say('changeStage')}</button></p>)}
    {info.movement !== 'receive' && (info.from && !changePlace
      ? <p className="yf-entry-route"><ArrowRightLeft size={20} aria-hidden="true" /><span>{place(from)}{to && <> → <strong>{place(to)}</strong></>}</span></p>
      : <ChoiceCards label={say('from')} value={from} onChange={v => { set('from', v); if (v === to) set('to', ''); }} options={stageCards('from')} error={problem('from')} />)}
    {info.movement === 'transfer' && !info.to && <ChoiceCards label={say('to')} value={to} onChange={v => set('to', v)} options={stageCards('to')} error={problem('to')} />}
    {have && <p className="yf-entry-have" dir="auto">{say('inPlace', { place: place(from), kg: weight(have.grams), cartons: have.cartons, cones: have.cones })}</p>}
    <fieldset className="yf-qty-grid"><legend>{say('howMuch')}</legend>{numberBox('cartons')}{numberBox('cones')}{numberBox('kg', true)}</fieldset>
    <div className="live-field"><label htmlFor="yf-note">{say(preset === 'dispatch' ? 'noteDispatch' : 'note')}</label><textarea id="yf-note" rows={2} maxLength={1000} value={draft.note} onChange={e => set('note', e.target.value)} /></div>
  </AsyncForm>;
}

/** Choose the batch for a job: big rows, batches that can take the job first, most recently used first. */
export function BatchPicker({ preset, state, onPick, onBack, onNewBatch }: { preset: Preset | 'qc'; state: WorkspaceState; onPick: (lotId: string) => void; onBack: () => void; onNewBatch?: () => void }) {
  const say = useFloor();
  const [query, setQuery] = useState('');
  const lastUsed = (lotId: string) => state.movements.find(m => m.lot_id === lotId)?.created_at ?? state.lots.find(l => l.id === lotId)?.created_at ?? 0;
  const block = (lotId: string): FloorKey | null => preset === 'qc' ? null : batchBlock(state, lotId, preset);
  const name = (productId: string) => state.products.find(p => p.id === productId)?.name || '';
  const rows = state.lots
    .filter(lot => [lot.batch, lot.supplier, name(lot.product_id)].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
    .map(lot => ({ lot, why: block(lot.id), grams: state.balances.filter(b => b.lot_id === lot.id).reduce((n, b) => n + b.grams, 0) }))
    .sort((a, b) => Number(!!a.why) - Number(!!b.why) || (preset === 'qc' ? Number(a.lot.quality === 'approved') - Number(b.lot.quality === 'approved') : 0) || lastUsed(b.lot.id) - lastUsed(a.lot.id));
  const Icon = preset === 'qc' ? CheckCheck : presetInfo[preset].icon;
  return <section className="live-panel yf-picker" aria-labelledby="yf-picker-title">
    <div className="yf-picker-head"><span className="yf-entry-icon"><Icon size={26} aria-hidden="true" /></span><div><h2 id="yf-picker-title">{say(preset === 'qc' ? 'qc' : presetInfo[preset].title)}</h2><p>{say('pickBatch')} {say('pickBatchHint')}</p></div></div>
    {state.lots.length > 6 && <div className="live-field"><label htmlFor="yf-picker-find">{say('findBatch')}</label><input id="yf-picker-find" type="search" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" /></div>}
    {onNewBatch && <button type="button" className="yf-pick-row is-new" onClick={onNewBatch}><span className="yf-pick-plus" aria-hidden="true">+</span><strong>{say('newBatch')}</strong></button>}
    <ul className="yf-pick-list">{rows.map(({ lot, why, grams }) => <li key={lot.id}><button type="button" className="yf-pick-row" disabled={!!why} onClick={() => onPick(lot.id)}>
      <Cone hue={materialHue(state.products, lot.product_id)} size={36} />
      <span className="yf-pick-name"><strong>{yarnName(name(lot.product_id))}</strong><span><bdi>{lot.batch}</bdi>{lot.supplier ? <> · <bdi>{lot.supplier}</bdi></> : ''}</span>{why && <em>{say(why)}</em>}</span>
      <span className="yf-pick-kg" dir="ltr">{weight(grams)} <small>kg</small></span>
    </button></li>)}</ul>
    {!rows.length && <p className="live-muted">{say('noBatchFound')}</p>}
    <div className="live-actions"><button type="button" className="button" onClick={onBack}>{say('back')}</button></div>
  </section>;
}
