import { ArrowRight, CheckCircle2, ChevronRight, CircleCheckBig, ClipboardCheck, ClipboardList, ScanSearch, TriangleAlert } from 'lucide-react';
import { Cone, materialHue } from './Cone';
import { moveIcon, stageIcon } from './icons';
import { qualityName, stageName, stockStages, weight, type Quality, type StockBalance, type WorkspaceState } from './inventory-client';
import { useLanguage } from './i18n';
import type { ReactNode } from 'react';

export function QualityBadge({ value }: { value: Quality }) {
  const { t } = useLanguage();
  const Icon = value === 'approved' ? CheckCircle2 : value === 'hold' ? TriangleAlert : ClipboardList;
  const urdu = { uninspected: 'معائنہ درکار ہے', approved: 'کوالٹی منظور ہے', hold: 'کوالٹی پر روک' };
  return <span className={`live-quality ${value}`}><Icon size={18} aria-hidden="true" />{t(qualityName[value], urdu[value])}</span>;
}

// Keep a yarn count with its system on narrow screens: "Ne 30/1" never splits.
export const yarnName = (name: string) => name.replace(/\b(Ne|Nm|Tex) (?=\d)/g, '$1 ');
const dateOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' } as const;
const dateFormats = { en: new Intl.DateTimeFormat('en-GB', dateOptions), ur: new Intl.DateTimeFormat('ur-PK-u-nu-latn', dateOptions) };
export const when = { format: (value: number | Date, language: 'en' | 'ur' = 'en') => dateFormats[language].format(value) };
export const movedName: Record<string, string> = { receive: 'Received', dispatch: 'Dispatched', transfer: 'Moved', waste: 'Waste recorded', reverse: 'Reversed' };
const movedUrdu: Record<string, string> = { receive: 'وصول ہوا', dispatch: 'ڈسپیچ ہوا', transfer: 'منتقل ہوا', waste: 'ضائع شدہ مال درج ہوا', reverse: 'اندراج واپس ہوا' };
const stageUrdu = { raw: 'خام مال گودام', wip: 'پروڈکشن فلور', finished: 'تیار مال', cops: 'کاپس' };

/** Stock moving through the mill: one node per stage on a thread that keeps flowing toward dispatch. */
export function StockFlow({ balances, compact = false }: { balances: StockBalance[]; compact?: boolean }) {
  const { t } = useLanguage();
  return <ol className={`yf-flow${compact ? ' is-compact' : ''}`} aria-label={t('Stock by stage', 'ہر مرحلے کا اسٹاک')}>
    <svg className="yf-thread is-h" aria-hidden="true" viewBox="0 0 100 2" preserveAspectRatio="none"><line x1="0" y1="1" x2="100" y2="1" /><line className="yf-run" x1="0" y1="1" x2="100" y2="1" /></svg>
    <svg className="yf-thread is-v" aria-hidden="true" viewBox="0 0 2 100" preserveAspectRatio="none"><line x1="1" y1="0" x2="1" y2="100" /><line className="yf-run" x1="1" y1="0" x2="1" y2="100" /></svg>
    {stockStages.map(stage => {
      const here = balances.filter(b => b.stage === stage);
      const grams = here.reduce((sum, b) => sum + b.grams, 0);
      const Icon = stageIcon[stage];
      return <li key={stage} className={grams > 0 ? 'has-stock' : ''}>
        <span className="yf-node"><Icon size={compact ? 20 : 24} aria-hidden="true" /></span>
        <span className="yf-stage">{t(stageName[stage], stageUrdu[stage])}</span>
        <strong dir="ltr">{weight(grams)} <small>kg</small></strong>
        <span className="yf-cartons"><span dir="ltr">{here.reduce((sum, b) => sum + b.cartons, 0)}</span> {t('cartons', 'کارٹن')}</span>
      </li>;
    })}
  </ol>;
}

/** Home: the one thing to do next, then stock flowing through its stages, materials, and the latest movements. */
export default function WorkspaceDashboard({ state, navigate, daily }: { state: WorkspaceState; navigate: (route: string, lotId?: string) => void; daily?: ReactNode }) {
  const { language, t } = useLanguage();
  const hue = (productId: string) => materialHue(state.products, productId);
  const product = (productId: string) => state.products.find(p => p.id === productId);
  const lotOf = (lotId: string) => state.lots.find(l => l.id === lotId);
  const lotGrams = (lotId: string) => state.balances.filter(b => b.lot_id === lotId).reduce((sum, b) => sum + b.grams, 0);
  const total = state.balances.reduce((sum, b) => sum + b.grams, 0);
  const byMaterial = state.products.map(p => ({ p, grams: state.lots.filter(l => l.product_id === p.id).reduce((sum, l) => sum + lotGrams(l.id), 0) })).filter(m => m.grams > 0);
  const lots = [...state.lots].sort((a, b) => lotGrams(b.id) - lotGrams(a.id));
  const waiting = state.lots.filter(l => l.quality !== 'approved').sort((a, b) => (a.quality === 'hold' ? 0 : 1) - (b.quality === 'hold' ? 0 : 1));
  const next = waiting[0];
  const nextName = next ? yarnName(product(next.product_id)?.name || t('this batch', 'اس بیچ')) : '';
  const others = waiting.length - 1;
  const recent = state.movements.slice(0, 5);
  return <div className="yf-home">
    {daily}
    <section className={`yf-next ${next ? next.quality : state.products.length ? 'clear' : 'empty'}`} aria-labelledby="yf-next-title">
      <span className="yf-next-icon">{next ? next.quality === 'hold' ? <TriangleAlert size={26} aria-hidden="true" /> : <ClipboardCheck size={26} aria-hidden="true" /> : <CircleCheckBig size={26} aria-hidden="true" />}</span>
      <div className="yf-next-text">
        <h2 id="yf-next-title">{next ? next.quality === 'hold' ? t(`Review the QC hold on ${nextName}`, `${nextName} پر کوالٹی کی روک کا جائزہ لیں`) : t(`Inspect ${nextName} before dispatch`, `ڈسپیچ سے پہلے ${nextName} کا معائنہ کریں`) : state.products.length ? t('Every batch is QC approved', 'ہر بیچ کی کوالٹی منظور ہے') : t('Add your first material', 'اپنا پہلا میٹیریل شامل کریں')}</h2>
        <p>{next ? <>{next.batch} · {next.supplier || t('supplier not recorded', 'سپلائر درج نہیں')} · <span dir="ltr">{weight(lotGrams(next.id))} kg</span>{others > 0 ? t(` · ${others} more ${others === 1 ? 'batch is' : 'batches are'} waiting for QC`, ` · مزید ${others} بیچ کوالٹی چیک کے منتظر ہیں`) : ''}</>
          : state.products.length ? t('Approved stock can be moved into production or dispatched.', 'منظور شدہ اسٹاک پروڈکشن میں منتقل یا ڈسپیچ کیا جا سکتا ہے۔') : t('Add a material such as Cotton Ne 30/1, then receive its first batch.', 'مثلاً کاٹن Ne 30/1 شامل کریں، پھر اس کا پہلا بیچ وصول کریں۔')}</p>
      </div>
      <div className="yf-next-actions">
        {next ? <button className="button primary" onClick={() => navigate('inventory', next.id)}>{next.quality === 'hold' ? t('Review batch', 'بیچ کا جائزہ لیں') : t('Inspect batch', 'بیچ کا معائنہ کریں')}<ArrowRight size={18} aria-hidden="true" /></button>
          : <button className="button primary" onClick={() => navigate(state.products.length ? 'dispatch' : 'inventory')}>{state.products.length ? t('Stock to dispatch', 'ڈسپیچ کے لیے اسٹاک') : t('Open Stock', 'اسٹاک کھولیں')}<ArrowRight size={18} aria-hidden="true" /></button>}
        <button className="button" onClick={() => navigate('scanner')}><ScanSearch size={18} aria-hidden="true" />{t('Scan fabric', 'کپڑا اسکین کریں')}</button>
      </div>
    </section>

    <section className="yf-section" aria-labelledby="yf-flow-title">
      <div className="yf-head"><h2 id="yf-flow-title">{t('Stock flow', 'اسٹاک کے مراحل')}</h2><span><span dir="ltr">{weight(total)}{' '}kg</span> {t('on hand', 'موجود ہے')}</span></div>
      <StockFlow balances={state.balances} />
    </section>

    <div className="yf-home-cols">
      <section className="yf-section" aria-labelledby="yf-materials-title">
        <div className="yf-head"><h2 id="yf-materials-title">{t('Materials', 'میٹیریل')}</h2><button className="live-text-button" onClick={() => navigate('inventory')}>{t('Open Stock', 'اسٹاک کھولیں')}</button></div>
        {total > 0 && <div className="yf-mix" role="img" aria-label={byMaterial.map(m => `${m.p.name} ${weight(m.grams)} kg`).join(', ')}>
          {byMaterial.map(m => <i key={m.p.id} title={`${m.p.name} · ${weight(m.grams)} kg`} style={{ flex: m.grams, background: hue(m.p.id) }} />)}
        </div>}
        {lots.slice(0, 6).map(lot => <button className="yf-row" key={lot.id} onClick={() => navigate('inventory', lot.id)}>
          <Cone hue={hue(lot.product_id)} size={28} />
          <div><strong>{yarnName(product(lot.product_id)?.name || t('Material', 'میٹیریل'))}</strong><span>{lot.batch} · {lot.supplier || t('Supplier not recorded', 'سپلائر درج نہیں')}</span></div>
          <QualityBadge value={lot.quality} />
          <span className="yf-kg" dir="ltr">{weight(lotGrams(lot.id))} <small>kg</small></span>
          <ChevronRight size={18} aria-hidden="true" />
        </button>)}
        {!lots.length && <p className="yf-none">{t('No batches yet. Add a material in Stock, then its first batch.', 'ابھی کوئی بیچ نہیں۔ اسٹاک میں میٹیریل، پھر اس کا پہلا بیچ شامل کریں۔')}</p>}
        {lots.length > 6 && <button className="live-text-button yf-more" onClick={() => navigate('inventory')}>{t(`All ${lots.length} batches in Stock`, `اسٹاک کے تمام ${lots.length} بیچ`)}</button>}
      </section>

      <section className="yf-section" aria-labelledby="yf-moves-title">
        <div className="yf-head"><h2 id="yf-moves-title">{t('Recent movements', 'حالیہ نقل و حرکت')}</h2><button className="live-text-button" onClick={() => navigate('activity')}>{t('History', 'ہسٹری')}</button></div>
        <ol className="yf-timeline">
          {recent.map(m => { const lot = lotOf(m.lot_id); const Icon = moveIcon[m.action] || ArrowRight; return <li key={m.id}>
            <span className="yf-tnode"><Icon size={18} aria-hidden="true" /></span>
            <div><strong>{t(movedName[m.action] || m.action, movedUrdu[m.action])} · {lot?.batch || t('Batch', 'بیچ')}</strong><span><Cone hue={hue(lot?.product_id || '')} size={14} />{m.action === 'transfer' && m.from_stage && m.to_stage ? `${t(stageName[m.from_stage], stageUrdu[m.from_stage])} → ${t(stageName[m.to_stage], stageUrdu[m.to_stage])}` : yarnName(product(lot?.product_id || '')?.name || '')}</span></div>
            <div className="yf-side"><span className="yf-kg" dir="ltr">{weight(m.grams)} <small>kg</small></span><time dateTime={new Date(m.created_at).toISOString()}>{when.format(m.created_at, language)}</time></div>
          </li>; })}
        </ol>
        {!recent.length && <p className="yf-none">{t('Movements appear here once stock is received.', 'اسٹاک وصول ہونے کے بعد اس کی نقل و حرکت یہاں نظر آئے گی۔')}</p>}
      </section>
    </div>
  </div>;
}
