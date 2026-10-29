import { CheckCircle2, ClipboardList, TriangleAlert } from 'lucide-react';
import { stageIcon } from './icons';
import { qualityName, stageName, stockStages, weight, type Quality, type StockBalance } from './inventory-client';
import { useLanguage } from './i18n';

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
const stageUrdu = { raw: 'خام مال', wip: 'زیرِ تیاری', finished: 'تیار مال', cops: 'کاپس' };

/** Stock moving through the mill: one node per stage on a thread that keeps flowing toward dispatch. */
export function StockFlow({ balances, compact = false }: { balances: StockBalance[]; compact?: boolean }) {
  const { t } = useLanguage();
  const moving = balances.some(b => b.stage === 'wip' && b.grams > 0);
  return <ol className={`yf-flow${compact ? ' is-compact' : ''}${moving ? ' is-moving' : ''}`} aria-label={t('Stock by stage', 'ہر مرحلے کا اسٹاک')}>
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
