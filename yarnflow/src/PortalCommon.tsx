import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import { Field, errorMessage } from './forms';
import { useLanguage } from './i18n';
import { inventoryRequest, type Member, type Role } from './inventory-client';
import { Section, StatusTag as KitStatusTag, Tabs } from './ui';

/** One call to an /api/erp route: GET without data, POST with it. */
export const portal = <T,>(path: string, data?: unknown) => inventoryRequest<T>('/erp' + path, data);

export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { try { setData(await portal<T>(path)); setError(''); } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); } }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

export const money = (minor: number, currency = 'PKR') => `${currency} ${new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
export const kg = (grams: number) => `${new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(grams / 1000)} kg`;

export function ReasonField({ label, value, onChange, required = true }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <Field>{label}<textarea value={value} onChange={event => onChange(event.target.value)} minLength={required ? 5 : undefined} maxLength={1000} required={required} /></Field>;
}

/** An admin acting on a screen another role owns must say why; the owner role's own users are never asked. */
export function InterventionField({ member, owners, value, onChange }: { member: Member; owners: Role[]; value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage();
  return member.role === 'admin' && !owners.includes('admin') ? <ReasonField label={t('Why you are acting for this role', 'آپ اس کردار کی جگہ کیوں کام کر رہے ہیں')} value={value} onChange={onChange} /> : null;
}

const words: Record<string, [string, string]> = {
  approved: ['Approved', 'منظور'], accepted: ['Accepted', 'قبول'], paid: ['Paid', 'ادا شدہ'], delivered: ['Delivered', 'پہنچ گیا'], settled: ['Settled', 'طے شدہ'],
  pending: ['Pending', 'زیرِ التوا'], active: ['Active', 'فعال'], pending_admin: ['Waiting for admin', 'ایڈمن کا انتظار'], submitted: ['Submitted', 'جمع شدہ'], open: ['Open', 'کھلا'], unread: ['New', 'نیا'], draft: ['Draft', 'مسودہ'], cancelled: ['Cancelled', 'منسوخ'], closed: ['Closed', 'بند'],
  rejected: ['Rejected', 'مسترد'], held: ['Held', 'روکا گیا'], overdue: ['Overdue', 'مدت گزر گئی'], on_hold: ['On hold', 'روکا گیا'], awarded: ['Awarded', 'آرڈر دیا گیا'],
};
export function StatusTag({ status }: { status: string }) {
  const { t } = useLanguage(); const tone = ['approved', 'accepted', 'paid', 'delivered', 'settled'].includes(status) ? 'ok' : ['rejected', 'held', 'overdue', 'on_hold'].includes(status) ? 'bad' : /^pending|^submitted$|^open$|^unread$/.test(status) ? 'warn' : 'neutral';
  return <KitStatusTag tone={tone} label={words[status] ? t(...words[status]) : status.replace(/_/g, ' ')} icon={tone === 'ok' ? CheckCircle2 : tone === 'warn' ? Clock : tone === 'bad' ? TriangleAlert : undefined} />;
}

/** The one thing to do next: a titled kit section with the reason and action. */
export function NextStep({ tone: kind, title, reason, action }: { tone: 'ok' | 'warn' | 'bad'; title: string; reason?: string; action?: ReactNode }) {
  const Icon = kind === 'ok' ? CheckCircle2 : TriangleAlert;
  return <Section title={title} className={`yf-next is-${kind}`}><div className="yf-next-text">{reason && <p>{reason}</p>}</div>{action}<Icon aria-hidden="true" /></Section>;
}

/** Sub-screens of a section as a segmented control. */
export function SectionTabs({ tabs, value, onChange }: { tabs: { id: string; en: string; ur: string }[]; value: string; onChange: (id: string) => void }) {
  const { t } = useLanguage();
  return <Tabs items={tabs.map(tab => ({ id: tab.id, label: t(tab.en, tab.ur) }))} value={value} onChange={onChange} label={t('Sections', 'حصے')} />;
}
