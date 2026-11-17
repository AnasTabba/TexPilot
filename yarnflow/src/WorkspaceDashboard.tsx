import { CheckCircle2, ClipboardList, TriangleAlert } from 'lucide-react';
import { qualityName, type Quality } from './inventory-client';
import { useLanguage } from './i18n';
import './WorkspaceDashboard.css';

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


