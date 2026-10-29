import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, Clock, TriangleAlert } from 'lucide-react';
import { Field, errorMessage } from './forms';
import { useLanguage } from './i18n';
import { inventoryRequest, type Member, type Role } from './inventory-client';

/** One call to an /api/erp route: GET without data, POST with it. */
export const portal = <T,>(path: string, data?: unknown) => inventoryRequest<T>('/erp' + path, data);

export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setData(await portal<T>(path)); setError(''); } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

export const money = (minor: number, currency = 'PKR') => `${currency} ${new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
export const kg = (grams: number) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(grams / 1000)} kg`;

export function ReasonField({ label, value, onChange, required = true }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <Field>{label}<textarea value={value} onChange={event => onChange(event.target.value)} minLength={5} maxLength={1000} required={required} /></Field>;
}

/** An admin acting on a screen another role owns must say why; the owner role's own users are never asked. */
export function InterventionField({ member, owners, value, onChange }: { member: Member; owners: Role[]; value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage();
  return member.role === 'admin' && !owners.includes('admin') ? <ReasonField label={t('Intervention reason', 'مداخلت کی وجہ')} value={value} onChange={onChange} /> : null;
}

const words: Record<string, [string, string]> = {
  approved: ['Approved', 'منظور'], accepted: ['Accepted', 'قبول'], paid: ['Paid', 'ادا شدہ'], delivered: ['Delivered', 'پہنچ گیا'], settled: ['Settled', 'طے شدہ'],
  pending: ['Pending', 'زیرِ التوا'], pending_admin: ['Waiting for admin', 'ایڈمن کا انتظار'], submitted: ['Submitted', 'جمع شدہ'], open: ['Open', 'کھلا'], unread: ['New', 'نیا'],
  rejected: ['Rejected', 'مسترد'], held: ['Held', 'روکا گیا'], overdue: ['Overdue', 'مدت گزر گئی'], on_hold: ['On hold', 'روکا گیا'],
};
const tone = (status: string) => ['approved', 'accepted', 'paid', 'delivered', 'settled'].includes(status) ? 'ok' : ['rejected', 'held', 'overdue', 'on_hold'].includes(status) ? 'bad' : /^pending|^submitted$|^open$|^unread$/.test(status) ? 'warn' : 'stone';
const icons = { ok: CheckCircle2, warn: Clock, bad: TriangleAlert, stone: Circle };
/** Status as tint, word and icon together, never colour alone. */
export function StatusTag({ status }: { status: string }) {
  const { t } = useLanguage(); const kind = tone(status); const Icon = icons[kind];
  return <span className={`yf-status is-${kind}`}><Icon size={16} aria-hidden="true" />{words[status] ? t(...words[status]) : status.replace(/_/g, ' ')}</span>;
}

/** The one thing to do next: a tinted field with a title, the reason, and the action that does it. */
export function NextStep({ tone: kind, title, reason, action }: { tone: 'ok' | 'warn' | 'bad'; title: string; reason?: string; action?: ReactNode }) {
  const Icon = kind === 'ok' ? CheckCircle2 : TriangleAlert;
  return <section className={`yf-next is-${kind}`} aria-labelledby="yf-next-title">
    <span className="yf-next-icon"><Icon size={26} aria-hidden="true" /></span>
    <div className="yf-next-text"><h2 id="yf-next-title">{title}</h2>{reason && <p>{reason}</p>}</div>
    {action && <div className="yf-next-actions">{action}</div>}
  </section>;
}

/** Sub-screens of a section as a segmented control; the glide measurement in the shell picks it up. */
export function SectionTabs({ tabs, value, onChange }: { tabs: { id: string; en: string; ur: string }[]; value: string; onChange: (id: string) => void }) {
  const { t } = useLanguage();
  return <div className="live-segments" role="group">{tabs.map(tab => <button key={tab.id} type="button" aria-pressed={value === tab.id} onClick={() => onChange(tab.id)}><span>{t(tab.en, tab.ur)}</span></button>)}</div>;
}
